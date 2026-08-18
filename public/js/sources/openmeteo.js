/* =========================================================================
   רדאר קייט — שכבת Open-Meteo
   -------------------------------------------------------------------------
   הדפדפן קורא ישירות. במכוון, ולא דרך proxy:
   מכסת Open-Meteo נספרת **לפי IP של הקורא**, כך שכל משתמש נושא את המכסה
   שלו. proxy היה מרכז את כולם על כתובת אחת ויוצר צוואר בקבוק יש מאין.
   ========================================================================= */

import { API, FORECAST_DAYS } from '../config.js';

const HOURLY = 'wind_speed_10m,wind_gusts_10m,wind_direction_10m';

/** מרחק בקילומטרים בין שתי נקודות — לחשיפת מרחק נקודת הרשת */
export function haversineKm(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (c - a) * r, dLon = (d - b) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * כל הספוטים בבקשת HTTP אחת.
 * Open-Meteo מקבל רשימות קואורדינטות מופרדות בפסיק ומחזיר מערך מקבילי.
 */
export async function fetchAllSpots(spots, { signal } = {}) {
  const url = new URL(API.forecast);
  url.searchParams.set('latitude', spots.map(s => s.lat).join(','));
  url.searchParams.set('longitude', spots.map(s => s.lon).join(','));
  url.searchParams.set('hourly', HOURLY);
  url.searchParams.set('wind_speed_unit', 'kn');
  url.searchParams.set('timezone', 'Asia/Jerusalem');
  url.searchParams.set('forecast_days', String(FORECAST_DAYS));

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();
  const arr = Array.isArray(json) ? json : [json];

  if (arr.length !== spots.length) {
    throw new Error(`Open-Meteo החזיר ${arr.length} מיקומים במקום ${spots.length}`);
  }

  const out = {};
  arr.forEach((d, i) => {
    const spot = spots[i];
    out[spot.id] = {
      hours: parseHourly(d),
      ageMin: 0,
      fetchedAt: Date.now(),
      grid: {
        lat: d.latitude, lon: d.longitude,
        distanceKm: haversineKm(spot.lat, spot.lon, d.latitude, d.longitude),
      },
      utcOffsetSeconds: d.utc_offset_seconds,
    };
  });
  return out;
}

/**
 * ממיר את המערכים המקבילים של Open-Meteo לרשימת שעות.
 * dayIndex נגזר מהתאריך המקומי בתגובה עצמה — ה-API כבר החזיר
 * זמנים בשעון ישראל, כך שאין כאן שום המרת אזור זמן שיכולה להישבר.
 */
export function parseHourly(d) {
  const h = d.hourly;
  if (!h?.time?.length) return [];
  const day0 = h.time[0].slice(0, 10);
  const dayOf = new Map([[day0, 0]]);
  let next = 1;

  return h.time.map((t, i) => {
    const dateStr = t.slice(0, 10);
    if (!dayOf.has(dateStr)) dayOf.set(dateStr, next++);
    return {
      tsMs: Date.parse(t + ':00' + offsetIso(d.utc_offset_seconds)),
      hour: +t.slice(11, 13),
      dayIndex: dayOf.get(dateStr),
      dateStr,
      speedKt: h.wind_speed_10m?.[i] ?? null,
      gustKt: h.wind_gusts_10m?.[i] ?? null,
      dirDeg: h.wind_direction_10m?.[i] ?? null,
    };
  });
}

function offsetIso(sec) {
  if (sec == null) return 'Z';
  const s = sec < 0 ? '-' : '+';
  const a = Math.abs(sec);
  return `${s}${String(Math.floor(a / 3600)).padStart(2, '0')}:${String(Math.floor((a % 3600) / 60)).padStart(2, '0')}`;
}

/** ריבוי מודלים לספוט אחד — נמשך רק בפתיחת כרטיס (שלב 3) */
export async function fetchModels(spot, modelIds, { signal } = {}) {
  const url = new URL(API.forecast);
  url.searchParams.set('latitude', String(spot.lat));
  url.searchParams.set('longitude', String(spot.lon));
  url.searchParams.set('hourly', HOURLY);
  url.searchParams.set('wind_speed_unit', 'kn');
  url.searchParams.set('timezone', 'Asia/Jerusalem');
  url.searchParams.set('forecast_days', String(FORECAST_DAYS));
  url.searchParams.set('models', modelIds.join(','));

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo models ${res.status}`);
  const d = await res.json();

  const out = {};
  for (const m of modelIds) {
    out[m] = parseHourlySuffixed(d, `_${m}`);
  }
  return out;
}

function parseHourlySuffixed(d, suffix) {
  const h = d.hourly;
  if (!h?.time?.length) return [];
  const day0 = h.time[0].slice(0, 10);
  const dayOf = new Map([[day0, 0]]);
  let next = 1;
  return h.time.map((t, i) => {
    const dateStr = t.slice(0, 10);
    if (!dayOf.has(dateStr)) dayOf.set(dateStr, next++);
    return {
      hour: +t.slice(11, 13),
      dayIndex: dayOf.get(dateStr),
      speedKt: h[`wind_speed_10m${suffix}`]?.[i] ?? null,
      gustKt: h[`wind_gusts_10m${suffix}`]?.[i] ?? null,
      dirDeg: h[`wind_direction_10m${suffix}`]?.[i] ?? null,
    };
  });
}

/** אילו מודלים לבקש עבור ספוט, בהתאם ל-force/exclude ברג'יסטר */
export function modelsForSpot(spot, allModelIds) {
  const force = spot.models?.force || [];
  if (force.length) return force;
  const exclude = new Set(spot.models?.exclude || []);
  return allModelIds.filter(m => !exclude.has(m));
}
