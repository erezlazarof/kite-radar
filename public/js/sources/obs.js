/* =========================================================================
   רדאר קייט — שכבת המדידה החיה בצד הלקוח
   ========================================================================= */

import { API } from '../config.js';
import { measuredVsForecast } from './ims-parse.js';

export async function fetchObs({ signal } = {}) {
  const r = await fetch(API.obs, { signal, cache: 'no-store' });
  if (!r.ok) throw new Error(`observations ${r.status}`);
  return r.json();
}

/**
 * המדידה שמשרתת ספוט מסוים — **בסדר עדיפות, עם נפילה מדורגת.**
 *
 * העדיפות היא נתון ברג'יסטר, לא ענף כאן: תחנת מועדון שעל החוף עצמו
 * (`club`) גוברת על תחנה אזורית, והשרשרת נופלת הלאה כשמקור שותק —
 * ריף רף: Surf Center (21 מ') → IUI (1.6 ק"מ); קריית ים: סורפו (1 ק"מ)
 * → AFEQ של השמ"ט (4.6 ק"מ בעמק). כך אף ספוט אינו תלוי במקור יחיד,
 * וזה גם מנגנון הגיבוי שסעיף 10 ברישיון השמ"ט דורש.
 *
 * מקור שנפל אינו מוצג "ריק" אלא פשוט מפנה את מקומו — והדגל ב-feed
 * כבר אומר למעלה שמשהו מושבת.
 */
export function obsForSpot(spot, payload) {
  if (!payload) return null;
  const ls = spot.live_stations || {};

  // 1. תחנת מועדון על החוף עצמו — המקור הקרוב ביותר כשהוא חי
  if (ls.club && payload.clubs?.[ls.club]) {
    return {
      ...payload.clubs[ls.club],
      source: 'club',
      stationName_he: ls.club_name_he || 'מד רוח על החוף',
      distanceKm: ls.club_distance_km ?? null,
      representative: true,
      feed: payload.feed?.[ls.club_feed] || null,
    };
  }

  if (ls.meteotech === 'eilat_iui' && payload.eilat) {
    return {
      ...payload.eilat,
      source: 'meteotech',
      stationName_he: 'תחנת IUI, אילת',
      distanceKm: null,
      feed: payload.feed?.eilat || null,
    };
  }

  if (ls.ims && payload.stations?.[ls.ims]) {
    return {
      ...payload.stations[ls.ims],
      source: 'ims',
      stationName_he: `תחנת ${ls.ims}`,
      distanceKm: ls.distance_km ?? null,
      representative: ls.representative === true,
      feed: payload.feed?.ims || null,
    };
  }

  return null;
}

/** גלים מדודים — רלוונטי רק לחוף הים התיכון, ורק כשהמצוף חי */
export function marineForSpot(spot, payload) {
  const key = spot.live_stations?.isramar;
  if (!key || !payload?.marine?.[key]) return null;
  return { ...payload.marine[key], feed: payload.feed?.isramar || null };
}

/**
 * מדוד מול חזוי לשעה הנוכחית.
 * ההשוואה נעשית מול **השעה שבה נמדד**, לא מול החלון הנבחר — אחרת
 * היינו משווים מדידה של 15:00 לתחזית של 17:00 וקוראים לזה אי-דיוק.
 */
export function compareToForecast(obs, hours, nowMs) {
  if (!obs || obs.tsMs == null || !Array.isArray(hours)) return null;
  const target = new Date(obs.tsMs);
  const hour = Number(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false,
  }).format(target));
  const h = hours.find(x => x.dayIndex === 0 && x.hour === hour);
  if (!h || h.speedKt == null) return null;
  return measuredVsForecast(obs, h.speedKt);
}

/** גיל המדידה בדקות, לתצוגה */
export function obsAgeMin(obs, nowMs) {
  if (!obs || obs.tsMs == null) return null;
  return Math.max(0, Math.round((nowMs - obs.tsMs) / 60000));
}
