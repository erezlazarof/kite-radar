/* =========================================================================
   רדאר קייט — שכבת התחבורה מול Bot API של טלגרם
   -------------------------------------------------------------------------
   שני עקרונות שמקודדים כאן ואסור לעקוף:

   1. **הטוקן הוא ארגומנט, לעולם לא מודול־גלובל.**
      אין כאן `const TOKEN = ...` ואין קריאה ל-`env` ברמת המודול. סוד
      שיושב במודול נגמר בכך שמישהו מייבא אותו מקוד שלא אמור לגעת בו,
      או מדפיס אותו בלוג. כל פונקציה מקבלת `token` מפורשות מהקורא.

   2. **טלגרם אינה תומכת ב-`dir="ltr"`.**
      מצב HTML שלה מכיר ברשימה סגורה של תגים (b, i, u, s, a, code, pre,
      blockquote, span class="tg-spoiler"). `<span dir="ltr">` — העטיפה
      שכל הפרויקט משתמש בה כדי שטווח מספרי לא יתהפך בעברית — מוחזרת
      בשגיאת 400 ומפילה את ההודעה כולה.
      התחליף הוא **בידוד יוניקוד**: U+2066 (LRI) … U+2069 (PDI). זה אותו
      אלגוריתם bidi בדיוק, רק שהוא מסומן בתווים ולא בתגית — ולכן עובר
      דרך כל לקוח טלגרם.  ראה `ltr()` ו-`toTelegramHtml()`.
   ========================================================================= */

const API_BASE = 'https://api.telegram.org/bot';

/* ---------------- טקסט ---------------- */

/** בריחת HTML לפי מה שטלגרם מפרשת ב-parse_mode=HTML */
export function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** LRI … PDI. הרצף נקרא משמאל לימין ולא נשען על ההקשר סביבו. */
export const LRI = '⁦';
export const PDI = '⁩';

/**
 * עוטף רצף לטיני/מספרי שיושב בתוך משפט עברי.
 * בלי זה "12–18" מוצג "18–12", כי המקף הוא תו ניטרלי ומקבל את כיוון
 * הפסקית. אותה בעיה בדיוק גם ב"10:00" וב-URL.
 */
export const ltr = s => (s == null || s === '' ? '' : `${LRI}${s}${PDI}`);

/** טווח מספרי — הצורה שהכי הרבה פעמים התהפכה בפרויקט הזה */
export const ltrRange = (a, b) => ltr(`${Math.round(a)}–${Math.round(b)}`);

/** שעה */
export const ltrHour = h => ltr(`${String(h).padStart(2, '0')}:00`);

/**
 * ממיר טקסט שהגיע ממנוע פסק הדין לטקסט שטלגרם מוכנה לקבל.
 *
 * המנוע ו-`phrases.he.js` פולטים `<span dir="ltr">…</span>` — נכון לדפדפן,
 * קטלני לטלגרם. כאן ההמרה נעשית **על המחרוזת הגולמית ולפני הבריחה**,
 * בדיוק כמו ב-`heText()` של הכרטיס: הסדר ההפוך היה מוצא את התגית אחרי
 * שכבר קודדה ל-`&lt;span…` ומחמיץ אותה.
 *
 * זו הגנת עומק. הקוד כאן בונה את ההודעה בעצמו עם `ltr()`, אבל ברגע
 * שמישהו יוסיף `range()` לכותרת ב-phrases.he.js — ההודעה תמשיך לעבוד.
 */
export function toTelegramHtml(s) {
  const SPAN = /<span\s+dir=["']ltr["']\s*>([\s\S]*?)<\/span>/gi;
  const src = String(s ?? '');
  let out = '', last = 0, m;
  while ((m = SPAN.exec(src)) !== null) {
    out += esc(src.slice(last, m.index)) + ltr(esc(m[1]));
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

/* ---------------- השוואה בזמן קבוע ---------------- */

/**
 * השוואת שתי מחרוזות בלי לדלוף כמה תווים התאימו.
 *
 * `a === b` יוצא ברגע ההבדל הראשון, ולכן זמן התגובה מסגיר את אורך
 * הקידומת הנכונה — מספיק כדי לנחש סוד תו-אחר-תו מול נקודת קצה ציבורית.
 * ל-Cloudflare יש `crypto.subtle.timingSafeEqual`, אבל היא לא קיימת
 * ב-Node ולכן הבדיקות לא היו יכולות לגעת בה. המימוש כאן זהה בהתנהגות
 * ורץ בשני המקומות.
 *
 * אורך שונה כן מדליף — הוא נכנס ל-diff מיד, וזה מקובל: אורך הסוד אינו
 * הסוד.
 */
export function timingSafeEqualStr(a, b) {
  const enc = new TextEncoder();
  const A = enc.encode(String(a ?? ''));
  const B = enc.encode(String(b ?? ''));
  let diff = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) diff |= (A[i] ?? 0) ^ (B[i] ?? 0);
  return diff === 0;
}

/* ---------------- קריאות API ---------------- */

/**
 * קריאה גולמית. **לעולם לא מדפיסה את הטוקן** — גם לא בהודעת שגיאה,
 * כי הודעות שגיאה נגמרות בלוגים של Cloudflare.
 */
export async function tgCall(token, method, payload) {
  if (!token) throw new Error('telegram: missing token');
  const res = await fetch(`${API_BASE}${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let json = null;
  try { json = await res.json(); } catch { /* גוף לא-JSON — נופל לשגיאה למטה */ }
  if (!res.ok || !json?.ok) {
    const why = json?.description || `HTTP ${res.status}`;
    throw new Error(`telegram ${method}: ${why}`);
  }
  return json.result;
}

export function sendMessage(token, chatId, text, opts = {}) {
  return tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    // 26 ספוטים בהודעה אחת עם תצוגה מקדימה של קישור = קיר תמונות.
    link_preview_options: { is_disabled: true },
    ...opts,
  });
}

export function editMessageText(token, chatId, messageId, text, opts = {}) {
  return tgCall(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...opts,
  });
}

/**
 * חובה לענות על כל callback_query, אחרת הכפתור נשאר עם חיווי טעינה
 * מסתובב אצל המשתמש עד שהוא מוותר.
 */
export function answerCallbackQuery(token, callbackQueryId, opts = {}) {
  return tgCall(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...opts,
  });
}

/* ---------------- מקלדות ---------------- */

export function inlineKeyboard(rows) {
  return { inline_keyboard: rows };
}

/** קידומת ה-callback לכפתור מתג ספוט. `callback_data` מוגבל ל-64 בתים. */
export const CB_TOGGLE = 't:';
export const CB_DONE = 'done';
export const CB_ALL = 'all';
export const CB_NONE = 'none';

/**
 * מקלדת בחירת ספוטים — כפתור לשורה.
 * שתי שורות בשורה אחת היה חוסך גובה, אבל שמות החופים בעברית ארוכים
 * ("חוף הסטודנטים — חיפה (דדו)") ומתקצצים באמצע. עדיף גלילה על שם חתוך.
 */
export function spotsKeyboard(spots, selectedIds) {
  const sel = new Set(selectedIds || []);
  const rows = spots.map(s => [{
    text: `${sel.has(s.id) ? '✅' : '⬜'} ${s.name_he}`,
    callback_data: CB_TOGGLE + s.id,
  }]);
  rows.push([
    { text: 'הכל', callback_data: CB_ALL },
    { text: 'נקה', callback_data: CB_NONE },
    { text: 'סיום', callback_data: CB_DONE },
  ]);
  return inlineKeyboard(rows);
}
