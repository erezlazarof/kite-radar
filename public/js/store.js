/* =========================================================================
   רדאר קייט — מצב, מטמון ו"אחרון תקין"
   -------------------------------------------------------------------------
   כל מקור עטוף באותה מעטפת, וכל מעטפת נושאת את הגיל שלה.
   הכלל: טריות פוגעת בפסק הדין באופן גלוי, לעולם לא בשקט.
   ========================================================================= */

import { TTL_MIN, MAX_AGE_MIN } from './config.js';

const LS_PREFIX = 'kite.lkg.';

export const state = {
  spots: [],
  defaults: null,
  forecast: null,      // { data:{spotId:…}, fetchedAt, ok, error }
  obs: null,          // { payload, fetchedAt, ok, restored, error }
  models: {},          // spotId → { data, fetchedAt }
  day: 0,
  region: 'all',
  expanded: null,
  prefs: loadPrefs(),
  now: () => Date.now(),
};

export function loadPrefs() {
  try {
    return { weightKg: 75, quiver: [], ...JSON.parse(localStorage.getItem('kite.prefs') || '{}') };
  } catch { return { weightKg: 75, quiver: [] }; }
}

export function savePrefs(p) {
  state.prefs = { ...state.prefs, ...p };
  try { localStorage.setItem('kite.prefs', JSON.stringify(state.prefs)); } catch {}
}

/** גיל בדקות */
export function ageMin(fetchedAt) {
  return fetchedAt == null ? Infinity : Math.max(0, (Date.now() - fetchedAt) / 60000);
}

export function isStale(kind, fetchedAt) {
  return ageMin(fetchedAt) > (TTL_MIN[kind] ?? 15);
}

export function isDead(kind, fetchedAt) {
  return ageMin(fetchedAt) > (MAX_AGE_MIN[kind] ?? 1440);
}

/* ---------------- אחרון תקין ---------------- */

export function saveLKG(key, payload) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify({ fetchedAt: Date.now(), payload }));
  } catch {}
}

export function loadLKG(key, kind) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (isDead(kind, o.fetchedAt)) return null;
    return o;
  } catch { return null; }
}

/**
 * עוטף משיכה: מצליח → שומר כאחרון-תקין. נכשל → מחזיר את האחרון התקין
 * ומסמן אותו כמושחזר, כדי שה-UI יוכל לומר את זה למשתמש.
 */
export async function withFallback(key, kind, fn) {
  try {
    const payload = await fn();
    saveLKG(key, payload);
    return { payload, fetchedAt: Date.now(), ok: true, restored: false, error: null };
  } catch (err) {
    const lkg = loadLKG(key, kind);
    if (lkg) {
      return { payload: lkg.payload, fetchedAt: lkg.fetchedAt, ok: false, restored: true, error: String(err.message || err) };
    }
    return { payload: null, fetchedAt: null, ok: false, restored: false, error: String(err.message || err) };
  }
}
