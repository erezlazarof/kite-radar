/* =========================================================================
   רדאר קייט — כרטיס ספוט
   -------------------------------------------------------------------------
   חוק ויזואלי אחד: דגל סכנה לעולם לא מודחק ע"י מספר טוב.
   חוק ויזואלי שני: אפור (unknown) נראה אחרת מאדום ומ-blocked.
   ========================================================================= */

import { compassHe, DIR_CLASS_HE, matchQuiver, kiteRange } from '../verdict/bands.js';
import { FLAG_HE, n } from '../verdict/phrases.he.js';
import { renderSparklineSVG } from './sparkline.js';
import { renderCompass } from './compass.js';
import { renderModelStrip, modelMeanKt } from './modelstrip.js';
import { renderChart } from './chart.js';
import { modelInfo } from '../config.js';

export const LEVEL_META = {
  green:   { cls: 'lv-green',   icon: '🟢', label: 'יש רוח' },
  yellow:  { cls: 'lv-yellow',  icon: '🟡', label: 'גבולי' },
  red:     { cls: 'lv-red',     icon: '🔴', label: 'לא ללכת' },
  blocked: { cls: 'lv-blocked', icon: '⛔', label: 'אסור' },
  unknown: { cls: 'lv-unknown', icon: '⚪', label: 'אין נתונים' },
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * טקסט עברי שעשוי להכיל מילה לטינית או טווח מספרי.
 *
 * רצף לטיני בתוך פסקית עברית נשען על ה-bidi של הדפדפן, ושם הוא נשבר:
 * סימני פיסוק ניטרליים סביבו נודדים לצד הלא נכון, ושתי מילים לטיניות
 * שנפגשות מעבר לגבול פסוקית מתהפכות. עטיפה מפורשת מסלקת את התלות.
 */
export function heText(str) {
  // סדר הפעולות קריטי: מזהים את הרצפים הלטיניים על המחרוזת הגולמית ורק
  // אז מקודדים כל חלק בנפרד. הסדר ההפוך היה מוצא "lt" בתוך &lt; ושובר
  // את הישויות שה-escape בדיוק יצר.
  //
  // נקודה נספרת כחלק מהרצף רק כשאחריה תו לטיני (ims.gov.il), ולא כשהיא
  // נקודת סוף משפט — שם מקומה עם המשפט העברי, בצד שמאל.
  const LATIN = /[A-Za-z][A-Za-z0-9]*(?:[._%+-][A-Za-z0-9]+)*/g;
  const src = String(str ?? '');
  let out = '', last = 0, m;
  while ((m = LATIN.exec(src)) !== null) {
    out += esc(src.slice(last, m.index)) + `<span dir="ltr">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

/**
 * מחרוזת לטינית שלמה כבלוק LTR **אחד**.
 *
 * ⚠️ `heText()` עוטף כל מילה בנפרד, ושני רצפי LTR שנפגשים מעבר לרווח
 * ניטרלי מתהפכים: "TEL AVIV COAST" נקרא "COAST AVIV TEL". קוד תחנה,
 * שם מודל וכל צירוף לטיני רב-מילי עוברים דרך כאן.
 */
export function ltr(s) {
  return `<span dir="ltr">${esc(s)}</span>`;
}

/**
 * ההפרש בין מדוד לחזוי. מתחת לשני קשר זה רעש מדידה ולא אי-הסכמה,
 * ולכן הוא נאמר כ"תואם" ולא כמספר — מספר קטן מזמין פרשנות שאין לה כיסוי.
 */
function deltaCls(d) {
  if (Math.abs(d) < 2) return 'same';
  return d > 0 ? 'up' : 'down';
}

/**
 * המשפט שנקרא פעם אחת. "מול 12 חזוי −4" הוא נכון ודורש פענוח;
 * הפער נגזר משני המספרים ולכן אין צורך להציג גם אותו.
 */
function vsText(m) {
  const f = `<span class="num" dir="ltr">${Math.round(m.forecastAtObsKt)}</span>`;
  if (Math.abs(m.deltaKt) < 2) return `התחזית אמרה ${f} — תואם`;
  return `התחזית אמרה ${f}`;
}

/** חץ כיוון. הקונבנציה: החץ מצביע לאן הרוח *הולכת*, כלומר dirFrom + 180. */
function arrow(dirDeg) {
  if (dirDeg == null) return '';
  return `<span class="arrow" style="--rot:${(dirDeg + 180) % 360}deg" aria-hidden="true">↑</span>`;
}

/**
 * @param {object} extra  { hours, nowHour } — שעות היום המוצג וקו ה"עכשיו".
 *                        אופציונלי: בלעדיו הכרטיס פשוט לא מצייר מטאוגרם.
 */
export function renderCard(spot, v, extra = {}) {
  const meta = LEVEL_META[v.level] || LEVEL_META.unknown;
  const w = v.window || {};
  const hasWind = w.meanKt != null;

  // רק דגלים קריטיים מגיעים לכרטיס. השאר יורדים לפאנל הפירוט.
  const flags = (v.flags || [])
    .map(f => FLAG_HE[f])
    .filter(f => f && f.severity === 'critical')
    .map(f => `<span class="chip chip-alert" title="${esc(f.text)}">${f.icon} ${esc(f.short || f.text)}</span>`)
    .join('');

  const skill = spot.skill_floor === 'advanced'
    ? '<span class="chip chip-skill">⚑ למתקדמים</span>' : '';

  const cand = spot.status === 'candidate'
    ? '<span class="chip chip-cand" title="לא נמצאה עדות שגולשים כאן בפועל. כיוון החוף נגזר ממפה.">◎ מועמד</span>' : '';

  return `
<article class="card ${meta.cls}" id="${esc(spot.id)}" data-spot="${esc(spot.id)}" tabindex="0" role="button"
         aria-expanded="false" aria-label="${esc(spot.name_he)} — ${esc(meta.label)}">
  <header class="card-head">
    <div class="spot-id">
      <h2 class="spot-name">${esc(spot.name_he)}</h2>
      <span class="region">${esc(REGION_HE[spot.region] || '')}</span>
    </div>
    <span class="verdict-badge">${esc(meta.label)}</span>
  </header>

  <div class="card-main">
    <div class="wind">
      ${hasWind
        ? `<span class="kt num">${n(w.meanKt)}</span>
           <span class="wind-meta">
             <span class="unit">קשר</span>
             ${w.gustKt != null ? `<span class="gust num">משב ${n(w.gustKt)}</span>` : ''}
           </span>`
        : `<span class="kt num muted">—</span>`}
    </div>
    ${w.startHour != null ? `
    <div class="when">
      <span class="when-range num" dir="ltr">${String(w.startHour).padStart(2, '0')}:00–${String(w.endHour).padStart(2, '0')}:00</span>
      ${w.hoursRideable > 0
        ? `<span class="when-hours">${n(w.hoursRideable)} שעות מעל הסף</span>`
        : `<span class="when-hours">החלון הטוב ביותר</span>`}
    </div>` : ''}
    ${w.dirDeg != null ? `
    <div class="dir">
      ${renderCompass(w.dirDeg, spot, { dirClass: v.dirCls })}
      <span class="dir-txt">
        <span class="dir-name">${esc(compassHe(w.dirDeg))}</span>
        ${DIR_CLASS_HE[v.dirCls]
          ? `<span class="dir-shore" data-dircls="${esc(v.dirCls)}">${esc(DIR_CLASS_HE[v.dirCls])}</span>`
          : ''}
      </span>
    </div>` : ''}
  </div>

  ${v.measured ? `
  <div class="measured">
    <span class="m-dot" aria-hidden="true"></span>
    <span class="m-label">נמדד עכשיו</span>
    <span class="m-kt num">${n(v.measured.speedKt)}</span>
    <span class="m-unit">קשר</span>
    ${v.measured.gustKt != null ? `<span class="m-gust num">משב ${n(v.measured.gustKt)}</span>` : ''}
    <span class="m-vs ${deltaCls(v.measured.deltaKt)}">${vsText(v.measured)}</span>
    ${v.measured.ageMin != null ? `<span class="m-age num">לפני ${n(v.measured.ageMin)} דק׳</span>` : ''}
  </div>` : ''}

  ${hasWind && extra.hours?.length ? `
  <div class="spark-wrap">
    ${renderSparklineSVG(extra.hours, {
      window: w,
      nowHour: extra.nowHour ?? null,
      dayStart: spot.daytime_window?.start ?? 6,
      dayEnd: spot.daytime_window?.end ?? 21,
    })}
  </div>` : ''}

  <p class="headline">${v.reason.headline}</p>
  ${v.reason.detail[0] ? `<p class="detail">${v.reason.detail[0]}</p>` : ''}

  ${flags || skill || cand ? `<div class="chips">${flags}${skill}${cand}</div>` : ''}
</article>`;
}

export const REGION_HE = {
  north: 'צפון',
  center: 'מרכז',
  south: 'דרום',
  kinneret: 'כנרת',
  eilat: 'אילת',
  // ספוטים שהמשתמש הוסיף יושבים בקבוצה משלהם ולא מעורבבים בין החופים
  // המאומתים. ההפרדה היא חלק מהמסר: אלה לא אותו סוג של ידיעה.
  mine: 'שלי',
};

/**
 * הסעיף שנוסף לפאנל הפירוט של ספוט משתמש.
 * שכבת האירועים יושבת ב-ui/addspot.js ומאזינה ל-data-user-action.
 */
export function renderUserSpotActions(spot) {
  if (spot.source !== 'user') return '';
  return `
  <div class="user-actions">
    <h3 class="d-h">הספוט הזה שלך</h3>
    <p class="d-line d-muted">הוא נשמר במכשיר הזה בלבד, ולא יגיע ל"יש רוח" —
      כיוון החוף שלו לא אומת בידי אדם.</p>
    <div class="ua-row">
      <button type="button" class="ua-btn" data-user-action="share" data-spot-id="${esc(spot.id)}">שתף</button>
      <button type="button" class="ua-btn" data-user-action="propose" data-spot-id="${esc(spot.id)}">הצע לרג'יסטר</button>
      <button type="button" class="ua-btn ua-danger" data-user-action="delete" data-spot-id="${esc(spot.id)}">מחק</button>
    </div>
  </div>`;
}

/**
 * מפרט המטאוגרם. מיוצא כי הסקראבר חייב להאכיל את chartHitTest
 * *באותם* opts שבהם צויר הגרף — אחרת האצבע והציור מדברים על צירים שונים.
 */
export function chartOpts(spot, v, extra) {
  return {
    width: 340, height: 172, days: 3,
    nowHour: extra.nowHour ?? null, nowDayIndex: 0,
    windows: extra.windows || [],
    level: v.level,
    idPrefix: 'ch' + String(spot.id).replace(/[^A-Za-z0-9]/g, ''),
  };
}

/** פאנל הפירוט שנפתח מתחת לכרטיס */
export function renderDetail(spot, v, extra = {}) {
  const rows = [];

  // המטאוגרם ראשון: מי שלחץ על כרטיס רוצה לראות *מתי*, לא לקרוא.
  if (extra.allHours?.length) {
    rows.push(`<div class="chart-wrap" data-chart="${esc(spot.id)}">
      ${renderChart(extra.allHours, chartOpts(spot, v, extra))}
      <div class="chart-read" data-read="${esc(spot.id)}" aria-live="polite"></div>
    </div>`);
  }

  for (const line of v.reason.detail.slice(1)) rows.push(`<p class="d-line">${line}</p>`);

  if (v.reason.caveats.length) {
    rows.push('<h3 class="d-h">לשים לב</h3>');
    rows.push('<ul class="d-caveats">' +
      v.reason.caveats.map(c => `<li>${heText(c)}</li>`).join('') + '</ul>');
  }

  if (spot.notes_he) rows.push(`<p class="d-note">${heText(spot.notes_he)}</p>`);

  // נימוק ניצב-החוף. הוא באנגלית וטכני, והוא המספר היחיד ברג'יסטר
  // שטעות בו מסוכנת — ולכן הוא מוצג, אבל כבלוק LTR נפרד. משפט אנגלי
  // שלם בתוך פסקה עברית מתפרק ומתהפך.
  if (spot.shore_normal_basis) {
    rows.push('<h3 class="d-h">איך נגזר כיוון החוף</h3>');
    rows.push(`<p class="d-basis" dir="ltr" lang="en">${esc(spot.shore_normal_basis)}</p>`);
  }

  if (extra.grid) {
    // המודל נאמר בשם רק כשהוא **אינו** ברירת המחדל. בכל שאר הספוטים זו
    // רעש: אף אחד לא בא לכאן לקרוא שמות מודלים. אבל בספוט שהרג'יסטר
    // הסיט ממנו את ברירת המחדל, המספר בכרטיס מגיע ממקום אחר — ואי-אמירה
    // שלו הופכת את רצועת ההשוואה מתחתיו לבלתי ניתנת לפענוח.
    const mi = modelInfo(extra.model);
    rows.push(`<p class="d-src">התחזית היא לנקודת רשת במרחק <span dir="ltr">${extra.grid.distanceKm.toFixed(1)}</span> ק"מ מהחוף` +
      (mi.resKm ? `, ברזולוציה של כ-<span dir="ltr">${mi.resKm}</span> ק"מ` : '') +
      (mi.isDefault ? '' : `, לפי <span dir="ltr">${esc(mi.label)}</span>`) + '.</p>');
    if (!mi.isDefault && spot.models?.reason_he) {
      rows.push(`<p class="d-src d-muted">${heText(spot.models.reason_he)}</p>`);
    }
  }

  // ----- השוואת מודלים -----
  if (extra.models !== undefined && v.window) {
    rows.push('<h3 class="d-h">מה המודלים אומרים</h3>');
    if (extra.models === null) {
      rows.push('<p class="d-line d-muted">טוען השוואה…</p>');
    } else {
      const points = {};
      for (const [id, hrs] of Object.entries(extra.models)) {
        const mean = modelMeanKt(hrs, v.window, v.day ?? 0);
        if (mean != null) points[id] = mean;
      }
      rows.push(renderModelStrip(points, v.window.meanKt, {
        excluded: spot.models?.exclude || [],
        reason_he: spot.models?.reason_he,
      }));
    }
  }

  // ----- שכבת התכנון. מופרדת במכוון: היא אישית, והיא לא חלק מפסק הדין -----
  const kt = v.window?.meanKt;
  // רק ירוק וצהוב. "לא ללכת" ואחריו "מהעפיפונים שלך: 7 מטר" הוא מסר
  // מעורב, ומסר מעורב בהקשר בטיחותי נקרא כעידוד.
  if (kt != null && (v.level === 'green' || v.level === 'yellow')) {
    const prefs = extra.prefs || {};
    const r = kiteRange(kt, prefs.weightKg);
    const q = matchQuiver(kt, prefs.weightKg, prefs.quiver);
    if (r) {
      rows.push('<h3 class="d-h">מה לקחת</h3>');
      const bits = [];
      if (r.overMax) {
        bits.push(`<p class="d-gear d-gear-no">רוח שולית — הגדול ביותר שיש לך ` +
          `(<span dir="ltr">${r.lo}–${r.hi}</span> מ׳), או פויל.</p>`);
      } else if (r.underMin) {
        bits.push(`<p class="d-gear d-gear-no">מתחת לגדלים הרגילים — ` +
          `<span dir="ltr">${r.lo}</span> מ׳ ומטה, למומחים בלבד.</p>`);
      } else {
        bits.push(
          `<p class="d-gear">לפי <span dir="ltr">${Math.round(prefs.weightKg ?? 75)}</span> ק״ג: ` +
          `עפיפון <b><span dir="ltr">${r.lo}–${r.hi}</span></b> מטר.</p>`);
      }
      if (q.best != null) {
        bits.push(q.fits
          ? `<p class="d-gear d-gear-ok">מהעפיפונים שלך: <b><span dir="ltr">${q.best}</span></b> מטר.</p>`
          : `<p class="d-gear d-gear-no">אין לך עפיפון בגודל הזה. הקרוב ביותר הוא ` +
            `<span dir="ltr">${q.best}</span> מטר, ${q.reason === 'too_small' ? 'קטן מדי' : 'גדול מדי'}.</p>`);
      }
      rows.push(bits.join(''));
    }
  }

  if (spot.sub_spots?.length) {
    rows.push('<h3 class="d-h">חופים נוספים באזור</h3>');
    rows.push('<ul class="d-caveats">' + spot.sub_spots
      .map(s => `<li><b>${heText(s.name_he)}</b> — ${heText(s.note_he || '')}</li>`).join('') + '</ul>');
  }

  rows.push(renderUserSpotActions(spot));

  // הפאנל אינו צאצא של הכרטיס בעץ ה-DOM, ולכן --lv אינו יורש אליו.
  // בלי מחלקת הדרגה כאן, המטאוגרם מצויר בצבע הטקסט במקום בצבע פסק הדין.
  const meta = LEVEL_META[v.level] || LEVEL_META.unknown;
  return `<div class="detail-panel ${meta.cls}" data-detail="${esc(spot.id)}">${rows.join('')}</div>`;
}
