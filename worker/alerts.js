/* =========================================================================
   רדאר קייט — Worker ההתראות בטלגרם (שלב 7)
   -------------------------------------------------------------------------
   שני מסלולים בקובץ אחד:

   `fetch`      → ה-webhook של טלגרם. כאן קורות ההרשמות.
   `scheduled`  → שלוש ריצות cron ביום. כאן נשלחות ההתראות.

   ארבעה עקרונות שמקודדים כאן:

   1. **אין ממשק הרשמה באתר.** ההרשמה קורית כולה בתוך טלגרם, דרך קישור
      עומק `https://t.me/<bot>?start=<spot_id>`. זה מוחק מחלקה שלמה של
      התעללות (טפסים פתוחים, ספאם, אימות בעלות) ומחלקה שלמה של קוד.

   2. **המנוע כאן הוא אותו מנוע שרץ בדפדפן.** `scoreSpot` מיובא כמו
      שהוא מ-`public/js/verdict/engine.js`. אסור להעתיק ממנו לוגיקה
      לכאן: הרגע שבו ההתראה והאתר חלוקים על השאלה אם היום טוב הוא הרגע
      שבו אי אפשר להסתמך על אף אחד מהם.

   3. **הודעה אחת לצ'אט, לא הודעה לספוט.** ביום שבו כל החוף נדלק, זו
      ההחלטה היחידה שמפרידה בין בוט שימושי לבין בוט שמושתק.

   4. **כשל בצ'אט אחד לא עוצר את הריצה.** `Promise.allSettled`, תמיד.

   ⚠️ סודות מגיעים אך ורק מ-`env` (`TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`).
      אין ערכי ברירת מחדל, אין הדפסה ללוג, אין קריאה ברמת המודול.
   ========================================================================= */

import { scoreSpot, israelDateParts } from '../public/js/verdict/engine.js';
import { compassHe, DIR_CLASS_HE } from '../public/js/verdict/bands.js';
import { FLAG_HE, n } from '../public/js/verdict/phrases.he.js';
import { fetchAllSpots } from '../public/js/sources/openmeteo.js';
import { obsForSpot, compareToForecast, obsAgeMin } from '../public/js/sources/obs.js';
import { DISCLAIMER } from '../public/js/config.js';

import {
  esc, ltr, toTelegramHtml, timingSafeEqualStr,
  sendMessage, editMessageText, answerCallbackQuery,
  spotsKeyboard, CB_TOGGLE, CB_DONE, CB_ALL, CB_NONE,
} from './telegram.js';

import {
  getSub, putSub, deleteSub, addToIndex, getAllSubs,
  getSentMap, putSentMap, normalizeSub, newSub, toggleSpot,
  parseThreshold, parseQuiet, isQuietNow, hourInQuiet,
  encodeSent, decodeSent, pairKey, DEFAULT_MIN_KT,
} from './subs.js';

export const SITE_FALLBACK = 'https://kite-radar.pages.dev';

/** עד לאן קדימה מסתכלת התראה. 36 שעות = היום ומחר, לא "השבוע". */
export const WINDOW_AHEAD_MS = 36 * 3600 * 1000;

/** רצפה קשיחה: הודעה אחת לצ'אט לספוט ב-12 שעות, גם אם התחזית קפצה */
export const SEND_FLOOR_MS = 12 * 3600 * 1000;

/** דלי הקשרים בחתימה — תזוזה קטנה מזה אינה סיבה להודעה נוספת */
export const KT_BUCKET = 3;

/** מגבלת טלגרם היא 4096 תווים. 3800 משאיר מקום לכותרת ולסיומת. */
export const MAX_MESSAGE_CHARS = 3800;

/** הסיומת הקבועה. כל הודעת התראה נגמרת בה, בלי יוצא מן הכלל. */
export const ALERT_FOOTER = DISCLAIMER;

const SKILL_HE = {
  beginner: '⚑ מתאים גם למתחילים',
  intermediate: '⚑ דורש שליטה בסיסית',
  advanced: '⚑ למתקדמים בלבד',
};

const DAY_HE = ['היום', 'מחר', 'מחרתיים'];

/* =========================================================================
   טהור — הליבה שהבדיקות נוגעות בה
   ========================================================================= */

/**
 * חתימת ניכוי כפילויות.
 * שינוי בתאריך או תזוזה של 3 קשר ומעלה מייצרים חתימה חדשה; רעש קטן
 * יותר לא. הרמה נכנסת כדי שמעבר ירוק→ירוק אחרי הפסקה לא ייבלע.
 */
export function dedupeSignature(spotId, dayISO, meanKt, level) {
  return `${spotId}|${dayISO}|${Math.round(meanKt / KT_BUCKET) * KT_BUCKET}|${level}`;
}

/** האם הספוט מנוי אצל המשתמש והמספר עובר את הסף שלו */
export function matchesSub(sub, m) {
  if (!sub || !m) return false;
  if (!sub.spots.includes(m.spotId)) return false;
  const min = Number.isFinite(sub.minKt) ? sub.minKt : DEFAULT_MIN_KT;
  return m.meanKt >= min;
}

/**
 * קיבוץ לפי צ'אט — **הודעה אחת לכל צ'אט**.
 * מיון: מה שקורה קודם למעלה, ובאותה שעה החזק יותר קודם.
 */
export function groupByChat(subs, matches) {
  const out = [];
  for (const sub of subs || []) {
    const entries = (matches || [])
      .filter(m => matchesSub(sub, m))
      .sort((a, b) => (a.startMs - b.startMs) || (b.meanKt - a.meanKt));
    if (entries.length) out.push({ sub, entries });
  }
  return out;
}

/**
 * מסנן מה מותר לשלוח: רצפת 12 השעות קודם, ואז זהות חתימה.
 * `sent` הוא מיזוג של מפת היום ומפת אתמול — ראה `runAlerts`.
 */
export function selectSendable({ sub, entries, sent = {}, nowMs }) {
  const keep = [];
  for (const e of entries) {
    const prev = decodeSent(sent[pairKey(sub.chatId, e.spotId)]);
    if (prev) {
      if (nowMs - prev.atMs < SEND_FLOOR_MS) continue;
      if (prev.sig === e.sig) continue;
    }
    keep.push(e);
  }
  return { entries: keep };
}

/** רשומות ה"נשלח" — נכתבות רק אחרי שההודעה באמת יצאה */
export function sentUpdates(chatId, entries, nowMs) {
  const up = {};
  for (const e of entries) up[pairKey(chatId, e.spotId)] = encodeSent(e.sig, nowMs);
  return up;
}

/* ---------------- ניסוח ההודעה ---------------- */

const pad = h => String(h).padStart(2, '0');

export function spotUrl(siteUrl, spotId) {
  return `${String(siteUrl || SITE_FALLBACK).replace(/\/+$/, '')}/#${spotId}`;
}

/**
 * שורת הבטיחות של הספוט.
 * לעולם לא ריקה: רצפת המיומנות מהרג'יסטר תמיד נאמרת, גם כשאין דגלים.
 *
 * ⚠️ **כל המפגעים בדרגה high נאמרים, בלי חיתוך.** הפיתוי לקצר לשניים
 * גדול — שורה ארוכה, וקיר אזהרות מאמן את העין לדלג. אבל בבת גלים
 * הרשומה השלישית היא "אין מציל ואין חילוץ", והשתקתה בשם קיצור היא
 * בדיוק מה שכלל הבטיחות "דגלי סכנה מוצגים תמיד" אוסר. הקיצור, כשהוא
 * נדרש, נעשה בהשמטת **ספוט שלם** מההודעה — ואז הוא גם לא מסומן כנשלח.
 */
export function safetyLines(entry) {
  const lines = [];
  const chips = [];
  for (const f of entry.v.flags || []) {
    const meta = FLAG_HE[f];
    if (meta && meta.severity === 'critical') chips.push(`${meta.icon} ${meta.short || ''}`.trim());
  }
  chips.push(SKILL_HE[entry.spot.skill_floor] || SKILL_HE.intermediate);
  if (entry.spot.status === 'candidate') chips.push('◎ ספוט מועמד');
  lines.push(chips.join(' · '));

  const haz = (entry.spot.hazards || [])
    .filter(h => h.severity === 'high' && h.note_he)
    .map(h => h.note_he);
  if (haz.length) lines.push('⚠️ ' + haz.join(' · '));

  return lines.map(toTelegramHtml);
}

/**
 * גוש ספוט אחד.
 *
 * ⚠️ הניסוח **מתאר תנאים ואינו מצווה ללכת**. זו אותה אסימטריה לשונית
 * שבאתר: "יש רוח" לטוב, "לא ללכת" לרע, ולעולם לא "לך". התראה היא הזמנה
 * לבדוק, לא הוראה לצאת.
 *
 * ⚠️ הזמנים והטווחים עטופים ב-LRI/PDI ולא ב-`<span dir="ltr">` — טלגרם
 * לא מכירה את התגית ומחזירה 400 על ההודעה כולה. ראה `telegram.js`.
 */
export function spotBlock(entry, siteUrl) {
  const w = entry.v.window;
  const out = [];

  out.push(`🟢 <b>${esc(entry.spot.name_he)}</b> · ${DAY_HE[entry.day] || ''}`);

  const dirTxt = [compassHe(w.dirDeg), DIR_CLASS_HE[entry.v.dirCls]].filter(Boolean).join(' · ');
  out.push(`${n(w.meanKt)} קשר, משב ${n(w.gustKt)} · ${esc(dirTxt)}`);
  out.push(`חלון ${ltr(`${pad(w.startHour)}:00–${pad(w.endHour)}:00`)}`);

  out.push(...safetyLines(entry));

  // עוגן עם טקסט עברי, ולא URL חשוף: כתובת חשופה בתוך פסקית עברית
  // גוררת את סימני הפיסוק סביבה לצד הלא נכון, וגם בידוד יוניקוד עלול
  // לשבור את הזיהוי האוטומטי של הקישור אצל חלק מהלקוחות.
  out.push(`🔗 <a href="${esc(spotUrl(siteUrl, entry.spotId))}">${esc(entry.spot.name_he)} ברדאר</a>`);

  return out.join('\n');
}

/**
 * ההודעה השלמה לצ'אט אחד.
 * מחזירה גם `included` — רק מה שנכנס בפועל מסומן כנשלח, אחרת ספוט
 * שנחתך בגלל מגבלת האורך היה נחשב "כבר יודעים עליו" ולא נשלח לעולם.
 */
export function buildAlertMessage(entries, { siteUrl = SITE_FALLBACK } = {}) {
  const head = entries.length === 1
    ? '🪁 <b>יש רוח</b>'
    : `🪁 <b>יש רוח ב-${ltr(entries.length)} ספוטים</b>`;

  const footer = `\n\n${toTelegramHtml(ALERT_FOOTER)}`;
  const included = [];
  const blocks = [];
  let used = head.length + footer.length;

  for (const e of entries) {
    const b = spotBlock(e, siteUrl);
    // 40 תווים שמורים לשורת "ועוד N ספוטים" אם נגמר המקום
    if (used + b.length + 2 > MAX_MESSAGE_CHARS - 40) break;
    blocks.push(b);
    included.push(e);
    used += b.length + 2;
  }

  const dropped = entries.slice(included.length);
  const more = dropped.length ? `\n\nועוד ${ltr(dropped.length)} ספוטים ברדאר.` : '';

  return {
    text: `${head}\n\n${blocks.join('\n\n')}${more}${footer}`,
    included,
    dropped,
  };
}

/* ---------------- איסוף התאמות ---------------- */

/**
 * עובר על הספוטים ועל שלושת הימים הקרובים ומחזיר את מה שירוק ופתוח.
 *
 * שלושה תנאים שאינם ברורים מאליהם:
 *   • **חלון שכבר נגמר אינו התאמה.** בריצת 18:00 החלון של 10:00–14:00
 *     הוא היסטוריה, וההתראה עליו היא הודעה שקרית.
 *   • **ספוט מדווח פעם אחת** — היום המוקדם ביותר שבו הוא ירוק. שתי
 *     שורות לאותו חוף באותה הודעה הן רעש.
 *   • **מדידה חיה נכנסת ליום 0**, בדיוק כמו באתר. היא יכולה רק להוריד
 *     דרגה — ולכן קיומה כאן מונע התראה ירוקה על מה שהאתר כבר מציג צהוב.
 */
export function collectMatches(spots, forecastById, obsPayload, nowMs) {
  const out = [];
  for (const spot of spots) {
    const f = forecastById[spot.id];
    if (!f) continue;

    let obs = null;
    if (obsPayload) {
      const o = obsForSpot(spot, obsPayload);
      if (o) {
        const cmp = compareToForecast(o, f.hours || [], nowMs);
        obs = { ...o, ageMin: obsAgeMin(o, nowMs), forecastAtObsKt: cmp?.forecastKt ?? null };
      }
    }

    for (let day = 0; day < DAY_HE.length; day++) {
      const v = scoreSpot(spot, f, day === 0 ? obs : null, nowMs, {}, day);
      if (v.level !== 'green') continue;

      const w = v.window;
      const startMs = w?.startISO ? Date.parse(w.startISO) : NaN;
      if (!Number.isFinite(startMs)) continue;
      const endMs = startMs + Math.max(1, (w.endHour - w.startHour)) * 3600 * 1000;

      if (endMs <= nowMs) continue;
      if (startMs > nowMs + WINDOW_AHEAD_MS) continue;

      const dayISO = israelDateParts(nowMs + day * 86400000).iso;
      out.push({
        spotId: spot.id, spot, v, day, dayISO, startMs, endMs,
        meanKt: w.meanKt,
        sig: dedupeSignature(spot.id, dayISO, w.meanKt, v.level),
      });
      break; // היום המוקדם ביותר בלבד
    }
  }
  return out;
}

/* =========================================================================
   פקודות הבוט
   ========================================================================= */

export function parseCommand(text) {
  const t = String(text ?? '').trim();
  if (!t.startsWith('/')) return null;
  const m = t.match(/^\/([A-Za-z_]+)(?:@[\w_]+)?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), arg: (m[2] || '').trim() };
}

const HELP = [
  '🪁 <b>רדאר קייט — התראות</b>',
  '',
  'ההתראה יוצאת כשספוט שבחרת נצבע ירוק ב-36 השעות הקרובות, לכל היותר פעם ב-12 שעות לספוט.',
  '',
  '<b>/spots</b> — לבחור חופים (הקשה מסמנת ומבטלת)',
  '<b>/threshold 16</b> — סף מהירות בקשרים',
  '<b>/quiet 22-06</b> — שעות שקט (<b>/quiet off</b> לביטול)',
  '<b>/status</b> — מה מוגדר עכשיו',
  '<b>/stop</b> — להפסיק הכל ולמחוק את ההגדרות',
  '',
  toTelegramHtml(DISCLAIMER),
].join('\n');

function statusText(sub, spotsById) {
  const names = sub.spots.map(id => spotsById.get(id)?.name_he || id);
  const lines = [
    '🪁 <b>ההגדרות שלך</b>',
    '',
    names.length
      ? `<b>חופים (${ltr(names.length)}):</b>\n· ${names.map(esc).join('\n· ')}`
      : '<b>חופים:</b> עוד לא נבחר אף חוף — <b>/spots</b>',
    `<b>סף:</b> ${n(sub.minKt)} קשר`,
    `<b>שקט:</b> ${sub.quiet ? ltr(`${pad(sub.quiet.from)}:00–${pad(sub.quiet.to)}:00`) : 'כבוי'}`,
    '',
    toTelegramHtml(DISCLAIMER),
  ];
  return lines.join('\n');
}

/* ---------------- טעינת הרג'יסטר ---------------- */

export function siteUrl(env) {
  return String(env?.SITE_URL || SITE_FALLBACK).replace(/\/+$/, '');
}

/**
 * הרג'יסטר נטען מה-URL החי ולא מיובא כ-JSON.
 * ייבוא היה מחייב דגל bundler ב-wrangler, והיה הופך "לערוך ספוט" משינוי
 * בקובץ אחד ודחיפה — לשינוי בקובץ אחד, דחיפה **ופריסה של ה-Worker**.
 * מטמון קצה של שעה מוריד את זה לקריאה אחת לשעה, גלובלית.
 */
export async function loadSpots(env, ctx) {
  const url = `${siteUrl(env)}/data/spots.json`;
  const req = new Request(url, { headers: { accept: 'application/json' } });
  const cache = caches.default;

  let res = await cache.match(req);
  if (!res) {
    const fresh = await fetch(req);
    if (!fresh.ok) throw new Error(`spots.json ${fresh.status}`);
    res = new Response(fresh.body, fresh);
    res.headers.set('cache-control', 'max-age=3600');
    const put = cache.put(req, res.clone());
    if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  }
  const json = await res.json();
  return Array.isArray(json?.spots) ? json.spots : [];
}

/** מדידה חיה — מיטב המאמץ. נפילה שלה לא מפילה ריצה. */
async function loadObs(env) {
  try {
    const r = await fetch(`${siteUrl(env)}/api/obs`, { headers: { accept: 'application/json' } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/* =========================================================================
   ה-webhook
   ========================================================================= */

/**
 * כתובת ה-Worker אינה סוד — היא מופיעה בכל תשובת שגיאה של טלגרם ובכל
 * לוג. הסוד המשותף בכותרת הוא מה שמונע מכל מי שראה את הכתובת להזריק
 * עדכונים מזויפים, כלומר להירשם בשם אחרים או לגרום לבוט לשלוח הודעות.
 */
function authorized(request, env) {
  const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  const want = env?.TG_WEBHOOK_SECRET;
  if (!want) return false;                 // בלי סוד מוגדר — סגור, לא פתוח
  return timingSafeEqualStr(got, want);
}

async function handleMessage(update, env, ctx) {
  const msg = update.message;
  const chatId = msg.chat?.id;
  if (chatId == null) return;
  const token = env.TG_BOT_TOKEN;
  const parsed = parseCommand(msg.text);

  if (!parsed) {
    await sendMessage(token, chatId, HELP);
    return;
  }

  const nowMs = Date.now();
  let sub = await getSub(env, chatId);

  switch (parsed.cmd) {
    case 'start': {
      const isNew = !sub;
      sub = sub || newSub(chatId, nowMs);
      const spots = await loadSpots(env, ctx);
      const wanted = spots.find(s => s.id === parsed.arg);
      if (wanted && !sub.spots.includes(wanted.id)) sub.spots.push(wanted.id);
      await putSub(env, sub);
      if (isNew) await addToIndex(env, chatId);

      const opening = wanted
        ? `נרשמת להתראות על <b>${esc(wanted.name_he)}</b>.`
        : 'ברוך הבא לרדאר קייט.';
      await sendMessage(token, chatId, `${opening}\n\n${HELP}`);
      return;
    }

    case 'spots': {
      sub = sub || newSub(chatId, nowMs);
      const spots = await loadSpots(env, ctx);
      await sendMessage(token, chatId, 'אילו חופים לעקוב אחריהם?', {
        reply_markup: spotsKeyboard(spots, sub.spots),
      });
      return;
    }

    case 'threshold': {
      if (!sub) { await sendMessage(token, chatId, 'קודם <b>/start</b>.'); return; }
      const r = parseThreshold(parsed.arg);
      if (!r.ok) {
        await sendMessage(token, chatId, `סף לא תקין. לדוגמה: <b>/threshold 16</b> (בין ${ltr('8')} ל-${ltr('35')} קשר).`);
        return;
      }
      sub.minKt = r.minKt;
      await putSub(env, sub);
      await sendMessage(token, chatId, `הסף עודכן ל-${n(r.minKt)} קשר.`);
      return;
    }

    case 'quiet': {
      if (!sub) { await sendMessage(token, chatId, 'קודם <b>/start</b>.'); return; }
      const r = parseQuiet(parsed.arg);
      if (!r.ok) {
        await sendMessage(token, chatId, 'פורמט לא תקין. לדוגמה: <b>/quiet 22-06</b>, או <b>/quiet off</b>.');
        return;
      }
      sub.quiet = r.quiet;
      await putSub(env, sub);
      await sendMessage(token, chatId, r.quiet
        ? `שעות שקט: ${ltr(`${pad(r.quiet.from)}:00–${pad(r.quiet.to)}:00`)} (שעון ישראל).`
        : 'שעות השקט בוטלו.');
      return;
    }

    case 'status': {
      if (!sub) { await sendMessage(token, chatId, 'אין הגדרות. <b>/start</b> כדי להתחיל.'); return; }
      const spots = await loadSpots(env, ctx);
      await sendMessage(token, chatId, statusText(sub, new Map(spots.map(s => [s.id, s]))));
      return;
    }

    case 'stop': {
      await deleteSub(env, chatId);
      await sendMessage(token, chatId, 'ההתראות הופסקו וההגדרות נמחקו. <b>/start</b> יחזיר אותן.');
      return;
    }

    default:
      await sendMessage(token, chatId, HELP);
  }
}

async function handleCallback(update, env, ctx) {
  const cq = update.callback_query;
  const token = env.TG_BOT_TOKEN;
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const data = String(cq.data || '');

  if (chatId == null) { await answerCallbackQuery(token, cq.id); return; }

  const nowMs = Date.now();
  const existed = await getSub(env, chatId);
  let sub = existed || newSub(chatId, nowMs);
  const spots = await loadSpots(env, ctx);

  if (data === CB_DONE) {
    await putSub(env, sub);
    if (!existed) await addToIndex(env, chatId);
    await editMessageText(token, chatId, messageId, statusText(sub, new Map(spots.map(s => [s.id, s]))));
    await answerCallbackQuery(token, cq.id, { text: 'נשמר' });
    return;
  }

  if (data === CB_ALL) sub = { ...sub, spots: spots.map(s => s.id) };
  else if (data === CB_NONE) sub = { ...sub, spots: [] };
  else if (data.startsWith(CB_TOGGLE)) {
    const id = data.slice(CB_TOGGLE.length);
    if (!spots.some(s => s.id === id)) { await answerCallbackQuery(token, cq.id); return; }
    sub = toggleSpot(sub, id);
  } else {
    await answerCallbackQuery(token, cq.id);
    return;
  }

  await putSub(env, sub);
  if (!existed) await addToIndex(env, chatId);

  // עריכה במקום — לא הודעה חדשה לכל הקשה. הטקסט משתנה יחד עם המקלדת
  // כדי שטלגרם לא תחזיר "message is not modified".
  await editMessageText(
    token, chatId, messageId,
    `אילו חופים לעקוב אחריהם? נבחרו ${ltr(sub.spots.length)}.`,
    { reply_markup: spotsKeyboard(spots, sub.spots) },
  );
  await answerCallbackQuery(token, cq.id);
}

export async function handleUpdate(update, env, ctx) {
  if (update?.message?.text) return handleMessage(update, env, ctx);
  if (update?.callback_query) return handleCallback(update, env, ctx);
}

/* =========================================================================
   ה-cron
   ========================================================================= */

export async function runAlerts(env, ctx, nowMs = Date.now()) {
  const token = env.TG_BOT_TOKEN;
  const stats = { chats: 0, sent: 0, skippedQuiet: 0, errors: 0, matches: 0 };

  const subs = (await getAllSubs(env)).filter(s => s.spots.length > 0);
  if (!subs.length) return stats;
  stats.chats = subs.length;

  const spots = await loadSpots(env, ctx);
  const byId = new Map(spots.map(s => [s.id, s]));
  const wanted = [...new Set(subs.flatMap(s => s.spots))].map(id => byId.get(id)).filter(Boolean);
  if (!wanted.length) return stats;

  // קריאה אחת ל-Open-Meteo לכל הקואורדינטות — ה-API מקבל רשימות מופרדות
  // בפסיק ומחזיר מערך מקביל. לולאה של קריאה לספוט הייתה 26 בקשות לריצה.
  const forecast = await fetchAllSpots(wanted);
  const obsPayload = await loadObs(env);

  const matches = collectMatches(wanted, forecast, obsPayload, nowMs);
  stats.matches = matches.length;
  if (!matches.length) return stats;

  // ⚠️ שתי מפות, כי החתימה נושאת את תאריך ה**תחזית** בעוד המפתח נושא את
  // תאריך ה**ריצה**: התראה על מחר שנשלחה אתמול ב-18:00 יושבת במפה של
  // אתמול, ובלעדיה רצפת 12 השעות הייתה מתאפסת בכל חצות.
  const todayISO = israelDateParts(nowMs).iso;
  const yesterdayISO = israelDateParts(nowMs - 86400000).iso;
  const [sentToday, sentYesterday] = await Promise.all([
    getSentMap(env, todayISO),
    getSentMap(env, yesterdayISO),
  ]);
  const sent = { ...sentYesterday, ...sentToday };

  const updates = {};
  const groups = groupByChat(subs, matches);

  const results = await Promise.allSettled(groups.map(async ({ sub, entries }) => {
    if (isQuietNow(nowMs, sub.quiet)) { stats.skippedQuiet++; return; }

    const { entries: sendable } = selectSendable({ sub, entries, sent, nowMs });
    if (!sendable.length) return;

    const msg = buildAlertMessage(sendable, { siteUrl: siteUrl(env) });
    await sendMessage(token, sub.chatId, msg.text);

    // רק אחרי שליחה מוצלחת, ורק מה שנכנס בפועל להודעה
    Object.assign(updates, sentUpdates(sub.chatId, msg.included, nowMs));
    stats.sent++;
  }));

  for (const r of results) {
    if (r.status === 'rejected') {
      stats.errors++;
      // בלי הטוקן ובלי גוף ההודעה — לוגים של Cloudflare אינם מקום לסודות
      console.error('alerts: chat failed —', r.reason?.message || 'unknown');
    }
  }

  // כתיבה אחת לכל הריצה. ראה הערת המכסה ב-subs.js.
  if (Object.keys(updates).length) {
    await putSentMap(env, todayISO, { ...sentToday, ...updates });
  }
  return stats;
}

/* ========================================================================= */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }

    if (url.pathname !== '/tg') return new Response('not found', { status: 404 });
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    if (!authorized(request, env)) return new Response('forbidden', { status: 403 });

    let update = null;
    try {
      update = await request.json();
    } catch {
      return new Response('bad request', { status: 400 });
    }

    // 200 גם על כשל פנימי: טלגרם חוזרת על עדכון שקיבל תשובה שאינה 2xx,
    // וכשל דטרמיניסטי היה הופך לולאה שמכפילה את עצמה.
    try {
      await handleUpdate(update, env, ctx);
    } catch (e) {
      console.error('webhook:', e?.message || 'unknown');
    }
    return new Response('ok');
  },

  async scheduled(event, env, ctx) {
    const stats = await runAlerts(env, ctx, Date.now());
    console.log('alerts run', JSON.stringify(stats));
  },
};

export { hourInQuiet, isQuietNow, decodeSent, encodeSent, pairKey, normalizeSub };
