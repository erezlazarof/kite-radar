/* =========================================================================
   רדאר קייט — מנוע פסק הדין
   -------------------------------------------------------------------------
   ⚠️ מודול טהור. בלי DOM, בלי fetch, בלי Date.now — הזמן מוזרק תמיד.
   הקובץ הזה רץ גם בדפדפן וגם ב-Worker של ההתראות, כדי ששניהם לא יוכלו
   לחלוק על השאלה אם היום טוב.

   חמישה כללי בטיחות שמקודדים כאן ואסור לעקוף:
   1. אין מסלול קוד מנתון ישן או חסר אל ירוק.
   2. `unknown` (אפור) אינו `red`. "לא יודעים" ≠ "יודעים שרע".
   3. `blocked` (אסור/מחוץ לעונה) אינו `red`. אסור ≠ מסוכן.
   4. רוח מהחוף החוצה היא אדום, ואי אפשר לעקוף אותה בניקוד גבוה.
      החריג היחיד הוא direction_overrides — נתון, לא ענף בקוד.
   5. דגלי סכנה מוצגים תמיד, גם כשהמספר טוב.
   ========================================================================= */

import {
  directionClass, speedScore, gustScore, cap, downgrade,
} from './bands.js';
import { seasonGate, legalGate, israelDateParts } from './calendar.js';
import { HEADLINE, buildDetail, buildCaveats } from './phrases.he.js';

export const MAX_FORECAST_AGE_MIN = 180;
export const STALE_FORECAST_MIN = 90;
export const MODEL_SPREAD_DEMOTE_KT = 8;
export const MIN_RIDEABLE_KT = 12;

/** ספי ניקוד המהירות שמשמשים כשער. תואמים ל-12 ו-15 קשר אפקטיביים. */
export const SPEED_GATE = { noGo: 40, marginal: 60 };

/**
 * @param {object} spot        רשומה מ-spots.json
 * @param {object} forecast    { hours: [{tsMs, hour, dayIndex, speedKt, gustKt, dirDeg}], ageMin, models? }
 * @param {object|null} obs    מדידה חיה (שלב 4); null בשלב 1
 * @param {number} nowMs       הזמן — מוזרק, לא נקרא
 * @param {object} prefs       { weightKg }
 * @param {number} day         0 = היום, 1 = מחר …
 */
export function scoreSpot(spot, forecast, obs, nowMs, prefs = {}, day = 0) {
  const base = {
    spotId: spot.id, day, prefs,
    freshness: {
      ageMin: forecast?.ageMin ?? null,
      stale: (forecast?.ageMin ?? 0) > STALE_FORECAST_MIN,
    },
  };

  /* ---- שלב 0: שער מספיקות. הראשון, כי הוא ליבת הבטיחות ---- */
  if (!forecast || !Array.isArray(forecast.hours) || forecast.hours.length === 0) {
    return unknownVerdict(spot, base, 'no_wind_data');
  }
  if ((forecast.ageMin ?? 0) > MAX_FORECAST_AGE_MIN) {
    return unknownVerdict(spot, base, 'stale');
  }

  const window = pickWindow(spot, forecast, day);
  if (!window || window.meanKt == null || Number.isNaN(window.meanKt)) {
    return unknownVerdict(spot, base, 'no_wind_data');
  }

  /* ---- שלב 1: שערים קשיחים → blocked, מצב נפרד מאדום ---- */
  const gate = seasonGate(spot, nowMs, day) || legalGate(spot, nowMs, day);
  if (gate) {
    const dirB = directionClass(window.dirDeg, spot);
    const v = {
      ...base, level: 'blocked', score: null, window, gate,
      dirCls: dirB.cls, dirNote: null,
      components: { speed: null, direction: null, gust: null, water: null },
      flags: [], confidence: { level: 'low', modelSpreadKt: null, runDeltaKt: null },
    };
    return finish(v, spot);
  }

  /* ---- שלב 3: רכיבים ---- */
  const dir = directionClass(window.dirDeg, spot);
  const speed = speedScore(window.meanKt, prefs);
  const gust = gustScore(window.meanKt, window.gustKt, dir.cls);

  const flags = [...dir.flags];
  if (gust.tierDowngrade) flags.push('gusty');

  /* ---- שלב 4: שקלול ואז מגבילים קשיחים ---- */
  let score = 0.55 * speed + 0.30 * dir.score + 0.15 * gust.score;
  let level = score >= 70 ? 'green' : score >= 45 ? 'yellow' : 'red';

  if (gust.tierDowngrade) level = downgrade(level, 1);

  // ⚠️ מהירות היא שער, לא רק רכיב.
  // כיוון מושלם ומשב חלק לא הופכים 10 קשר לרכיבים. כשהרוח מתחת לסף,
  // היא האילוץ המוחלט — וכל שאר הרכיבים יכולים רק להוריד, לא להעלות.
  if (speed < SPEED_GATE.noGo) level = 'red';
  else if (speed < SPEED_GATE.marginal) level = cap(level, 'yellow');

  // מהחוף החוצה — אדום מוחלט. לא ניתן לעקיפה בניקוד.
  if (dir.cls === 'offshore') { level = 'red'; score = Math.min(score, 30); }
  if (dir.cls === 'side_offshore') level = cap(level, 'yellow');
  if (dir.cls === 'onshore') score = Math.min(score, 78);

  // גיאומטריה שלא נבדקה ע"י אדם לא מייצרת ירוק
  if (spot.source === 'user') level = cap(level, 'yellow');

  const spreadKt = forecast.models ? modelSpreadKt(forecast.models, window) : null;
  if (spreadKt != null && spreadKt > MODEL_SPREAD_DEMOTE_KT) {
    level = cap(level, 'yellow');
    flags.push('model_spread');
  }

  // כלל 1: אין מסלול מנתון ישן אל ירוק
  if (base.freshness.stale) { level = cap(level, 'yellow'); flags.push('stale'); }

  if (spot.skill_floor === 'advanced' && level === 'green') flags.push('skill_advanced');

  const v = {
    ...base,
    level,
    score: Math.round(score),
    window,
    gate: null,
    dirCls: dir.cls,
    dirNote: dir.note,
    components: { speed, direction: dir.score, gust: gust.score, water: null },
    gustRatio: gust.ratio,
    flags: [...new Set(flags)],
    confidence: {
      level: spreadKt == null ? 'med' : spreadKt <= 3 ? 'high' : spreadKt <= 6 ? 'med' : 'low',
      modelSpreadKt: spreadKt,
      runDeltaKt: null,
    },
  };
  return finish(v, spot);
}

/* ------------------------------------------------------------------ */

function unknownVerdict(spot, base, reasonCode) {
  const v = {
    ...base, level: 'unknown', score: null,
    window: { meanKt: null, gustKt: null, dirDeg: null, hoursRideable: 0 },
    gate: null, dirCls: null, dirNote: null,
    components: { speed: null, direction: null, gust: null, water: null },
    flags: [], reasonCode,
    confidence: { level: 'low', modelSpreadKt: null, runDeltaKt: null },
  };
  return finish(v, spot);
}

function finish(v, spot) {
  v.reason = {
    headline: (HEADLINE[v.level] || HEADLINE.unknown)(v),
    detail: buildDetail(v, spot),
    caveats: buildCaveats(v, spot),
  };
  return v;
}

/**
 * בחירת החלון.
 * מנקדים את **הבלוק הרצוף הטוב ביותר של שעתיים** בתוך חלון היום —
 * לעולם לא ממוצע יממה. גולש הולך לסשן, לא ליום. עבור ספוטים תרמיים
 * (כנרת, אילת) ממוצע שכולל שעות לילה נקרא נמוך שקרית.
 */
export function pickWindow(spot, forecast, day = 0, defaults = null) {
  const w = spot.daytime_window || defaults?.daytime_window || { start: 7, end: 19 };
  const blockLen = 2;

  const hours = forecast.hours
    .filter(h => h.dayIndex === day && h.hour >= w.start && h.hour < w.end)
    .sort((a, b) => a.hour - b.hour);

  if (hours.length === 0) return null;

  let best = null;
  for (let i = 0; i + blockLen <= hours.length; i++) {
    const blk = hours.slice(i, i + blockLen);
    if (blk.some(h => h.speedKt == null)) continue;
    // רצף בפועל, לא רק סמיכות במערך
    if (blk[blk.length - 1].hour - blk[0].hour !== blockLen - 1) continue;
    const mean = blk.reduce((s, h) => s + h.speedKt, 0) / blk.length;
    if (!best || mean > best.meanKt) {
      best = {
        meanKt: mean,
        gustKt: Math.max(...blk.map(h => h.gustKt ?? h.speedKt)),
        dirDeg: circularMean(blk.map(h => h.dirDeg).filter(d => d != null)),
        startHour: blk[0].hour,
        endHour: blk[blk.length - 1].hour + 1,
        startISO: blk[0].tsMs ? new Date(blk[0].tsMs).toISOString() : null,
      };
    }
  }

  // גיבוי: שעה בודדת, אם אין שום בלוק רצוף
  if (!best) {
    const valid = hours.filter(h => h.speedKt != null);
    if (!valid.length) return null;
    const h = valid.reduce((a, b) => (b.speedKt > a.speedKt ? b : a));
    best = {
      meanKt: h.speedKt, gustKt: h.gustKt ?? h.speedKt, dirDeg: h.dirDeg,
      startHour: h.hour, endHour: h.hour + 1,
      startISO: h.tsMs ? new Date(h.tsMs).toISOString() : null,
    };
  }

  best.hoursRideable = hours.filter(h => (h.speedKt ?? 0) >= MIN_RIDEABLE_KT).length;
  return best;
}

/** ממוצע כיווני — ממוצע חשבוני של 350° ו-10° היה נותן 180°, כלומר ההפך */
export function circularMean(degs) {
  if (!degs.length) return null;
  let x = 0, y = 0;
  for (const d of degs) {
    const r = (d * Math.PI) / 180;
    x += Math.cos(r); y += Math.sin(r);
  }
  const a = (Math.atan2(y / degs.length, x / degs.length) * 180) / Math.PI;
  return (a + 360) % 360;
}

/** פער המהירות בין המודלים בחלון הנבחר — אות ביטחון */
export function modelSpreadKt(models, window) {
  const vals = Object.values(models)
    .map(m => meanForHours(m, window.startHour, window.endHour))
    .filter(v => v != null && !Number.isNaN(v));
  if (vals.length < 2) return null;
  return Math.max(...vals) - Math.min(...vals);
}

function meanForHours(modelHours, startHour, endHour) {
  const sel = (modelHours || []).filter(
    h => h.dayIndex === 0 && h.hour >= startHour && h.hour < endHour && h.speedKt != null
  );
  if (!sel.length) return null;
  return sel.reduce((s, h) => s + h.speedKt, 0) / sel.length;
}

export { israelDateParts };
