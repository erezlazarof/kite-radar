/* =========================================================================
   רדאר קייט — מנויי ההתראות ב-KV
   -------------------------------------------------------------------------
   ⚠️ עיצוב המפתחות כאן נגזר ממגבלה אחת ואמיתית של המסלול החינמי של KV:
   **1,000 כתיבות ביום** (מול 100,000 קריאות). קריאה כמעט חינם, כתיבה לא.

   | מפתח              | ערך                                   | כתיבות |
   |-------------------|---------------------------------------|--------|
   | `sub:<chat_id>`   | המנוי עצמו                            | רק על פעולת משתמש |
   | `index:subs`      | מערך chat_id                          | רק בהרשמה/ביטול   |
   | `sent:<YYYY-MM-DD>` | **מפה אחת לכל היום** של מה כבר נשלח | ≤ 5 ביום          |

   ⛔ **לא לפצל את `sent:` למפתח לכל זוג צ'אט־ספוט.** זה נראה נקי יותר,
   וזה מפוצץ את המכסה: 26 ספוטים × 3 ריצות = 78 כתיבות למשתמש ליום,
   כלומר המכסה נגמרת ב-**13 משתמשים**. המפה היומית היא read-modify-write
   אחד לכל ריצת cron — שלוש כתיבות ביום, לא משנה כמה משתמשים יש.

   ⛔ **לא להחליף את `index:subs` ב-`list()`.** list אמנם זולה בקריאות,
   אבל היא מחזירה עמודים ומחייבת את ה-cron להכיר את מרחב המפתחות. האינדקס
   נכתב רק כשמישהו נרשם או עוזב — כלומר כמה כתיבות ביום, לכל היותר.
   ========================================================================= */

import { israelDateParts } from '../public/js/verdict/engine.js';

export const INDEX_KEY = 'index:subs';
export const subKey = chatId => `sub:${chatId}`;
export const sentKey = dayISO => `sent:${dayISO}`;

/** מפת ה"נשלח" חיה שלושה ימים ואז נעלמת מעצמה — בלי כתיבת ניקוי */
export const SENT_TTL_SEC = 3 * 24 * 3600;

export const DEFAULT_MIN_KT = 14;
export const DEFAULT_QUIET = { from: 22, to: 6 };
export const MIN_KT_RANGE = { lo: 8, hi: 35 };

/* ---------------- טהור: מבנה המנוי ---------------- */

export function newSub(chatId, nowMs) {
  return {
    chatId: Number(chatId),
    spots: [],
    minKt: DEFAULT_MIN_KT,
    quiet: { ...DEFAULT_QUIET },
    createdAt: nowMs,
    lang: 'he',
  };
}

/** משלים שדות חסרים במנוי שנכתב בגרסה קודמת */
export function normalizeSub(raw, chatId, nowMs) {
  const base = newSub(chatId, nowMs);
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    chatId: Number(raw.chatId ?? chatId),
    spots: Array.isArray(raw.spots) ? [...new Set(raw.spots.map(String))] : [],
    minKt: Number.isFinite(raw.minKt) ? raw.minKt : DEFAULT_MIN_KT,
    // quiet:null הוא מצב תקף — "בלי שעות שקט". undefined הוא שדה חסר.
    quiet: raw.quiet === null ? null : (raw.quiet || { ...DEFAULT_QUIET }),
    lang: raw.lang || 'he',
  };
}

/** מתג ספוט. מחזיר מנוי חדש — לא משנה את הקיים במקום. */
export function toggleSpot(sub, spotId) {
  const has = sub.spots.includes(spotId);
  return {
    ...sub,
    spots: has ? sub.spots.filter(s => s !== spotId) : [...sub.spots, spotId],
  };
}

/* ---------------- טהור: פענוח ארגומנטים של פקודות ---------------- */

/**
 * `/threshold 16` → 16.
 * מוצמד לתחום שיש לו משמעות: מתחת ל-8 קשר אין על מה לרכוב, ומעל 35
 * המנוע ממילא לא מייצר ירוק. סף מחוץ לתחום הוא כמעט תמיד הקלדה.
 */
export function parseThreshold(arg) {
  const v = Number(String(arg ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(v)) return { ok: false };
  const kt = Math.round(v);
  if (kt < MIN_KT_RANGE.lo || kt > MIN_KT_RANGE.hi) return { ok: false, outOfRange: true };
  return { ok: true, minKt: kt };
}

/**
 * `/quiet 22-06` → { from: 22, to: 6 }.  `/quiet off` → null.
 * מקבל את כל סוגי המקפים, כי מקלדת עברית בנייד מייצרת מקף אחר.
 */
export function parseQuiet(arg) {
  const t = String(arg ?? '').trim().toLowerCase();
  if (t === 'off' || t === 'כבוי' || t === 'ללא' || t === '-') return { ok: true, quiet: null };
  const m = t.match(/^(\d{1,2})\s*(?::00)?\s*[-–—]\s*(\d{1,2})\s*(?::00)?$/);
  if (!m) return { ok: false };
  const from = Number(m[1]), to = Number(m[2]);
  if (from > 23 || to > 23) return { ok: false };
  // טווח באורך אפס אינו "בלי שקט" — הוא כמעט תמיד הקלדה
  if (from === to) return { ok: false };
  return { ok: true, quiet: { from, to } };
}

/**
 * האם שעה נופלת בתוך חלון השקט.
 * ⚠️ החלון **חוצה חצות** במקרה הרגיל (22–06), ולכן `from <= h && h < to`
 * לבדו מחזיר תמיד false בדיוק כשהוא הכי צריך לעבוד.
 */
export function hourInQuiet(hour, quiet) {
  if (!quiet) return false;
  const { from, to } = quiet;
  if (from == null || to == null || from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** שעות שקט לפי שעון ישראל — לעולם לא לפי השעון של ה-Worker */
export function isQuietNow(nowMs, quiet) {
  return hourInQuiet(israelDateParts(nowMs).hour, quiet);
}

/* ---------------- טהור: קידוד רשומת "נשלח" ---------------- */

/**
 * הערך במפת היום הוא חתימה **ועוד חותמת זמן**, מופרדות ב-`@`.
 *
 * הרצון היה להשאיר את הערך חתימה נקייה, אבל רצפת ה-12 שעות מחייבת לדעת
 * *מתי* נשלח, וממפתח יומי אי אפשר לגזור את זה: שתי ריצות באותו יום
 * (07:00 ו-18:00) נראות זהות. `@` לא מופיע בשום חתימה — היא מורכבת
 * ממזהה ספוט, תאריך ISO, מספר ורמה.
 */
export function encodeSent(sig, atMs) {
  return `${sig}@${atMs}`;
}

export function decodeSent(value) {
  if (typeof value !== 'string') return null;
  const i = value.lastIndexOf('@');
  if (i < 0) return { sig: value, atMs: 0 };
  const atMs = Number(value.slice(i + 1));
  return { sig: value.slice(0, i), atMs: Number.isFinite(atMs) ? atMs : 0 };
}

export const pairKey = (chatId, spotId) => `${chatId}:${spotId}`;

/* ---------------- KV ---------------- */

export async function getSub(env, chatId) {
  const raw = await env.KITE_SUBS.get(subKey(chatId), 'json');
  return raw ? normalizeSub(raw, chatId, Date.now()) : null;
}

export async function putSub(env, sub) {
  await env.KITE_SUBS.put(subKey(sub.chatId), JSON.stringify(sub));
}

export async function getIndex(env) {
  const raw = await env.KITE_SUBS.get(INDEX_KEY, 'json');
  return Array.isArray(raw) ? raw : [];
}

/** מחזיר true רק אם באמת נכתב — כדי שלא נבזבז כתיבה על no-op */
export async function addToIndex(env, chatId) {
  const ids = await getIndex(env);
  const id = Number(chatId);
  if (ids.includes(id)) return false;
  ids.push(id);
  await env.KITE_SUBS.put(INDEX_KEY, JSON.stringify(ids));
  return true;
}

export async function removeFromIndex(env, chatId) {
  const ids = await getIndex(env);
  const id = Number(chatId);
  if (!ids.includes(id)) return false;
  await env.KITE_SUBS.put(INDEX_KEY, JSON.stringify(ids.filter(x => x !== id)));
  return true;
}

export async function deleteSub(env, chatId) {
  await env.KITE_SUBS.delete(subKey(chatId));
  await removeFromIndex(env, chatId);
}

/** כל המנויים, לפי האינדקס. ה-cron לעולם לא קורא ל-list(). */
export async function getAllSubs(env) {
  const ids = await getIndex(env);
  const out = [];
  for (const id of ids) {
    const s = await getSub(env, id);
    // רשומה שנמחקה והאינדקס לא עודכן — מדלגים בשקט, לא מפילים ריצה
    if (s) out.push(s);
  }
  return out;
}

export async function getSentMap(env, dayISO) {
  const raw = await env.KITE_SUBS.get(sentKey(dayISO), 'json');
  return raw && typeof raw === 'object' ? raw : {};
}

export async function putSentMap(env, dayISO, map) {
  await env.KITE_SUBS.put(sentKey(dayISO), JSON.stringify(map), {
    expirationTtl: SENT_TTL_SEC,
  });
}
