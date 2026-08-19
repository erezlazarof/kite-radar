/* =========================================================================
   בדיקות Worker ההתראות (שלב 7).  הרצה:  npm test
   -------------------------------------------------------------------------
   נבדקת **הליבה הטהורה בלבד** — בלי להרים Workers runtime, בלי KV ובלי
   רשת. כל מה שנוגע בעולם (KV, fetch, Bot API) מבודד למודולים שמקבלים
   `env`/`token` מבחוץ, וכל מה שמכריע החלטה יוצא כפונקציה טהורה.

   ארבע מהבדיקות כאן הן כללי בטיחות ולא רגרסיה:
     · הודעה אחת לצ'אט — בוט שמציף הוא בוט מושתק, וגולש מושתק לא מקבל
       את ההתראה שכן חשובה.
     · רצפת 12 השעות — אותה סיבה.
     · שעות שקט שחוצות חצות — 22–06 הוא המקרה הרגיל, ובדיוק בו נשבר
       תנאי הטווח הנאיבי.
     · אין "לך" — האפליקציה מתארת תנאים ואינה שולחת מישהו לים.
   ========================================================================= */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  dedupeSignature, matchesSub, groupByChat, selectSendable, sentUpdates,
  buildAlertMessage, spotBlock, safetyLines, collectMatches, parseCommand,
  spotUrl, ALERT_FOOTER, SEND_FLOOR_MS, MAX_MESSAGE_CHARS, WINDOW_AHEAD_MS,
} from '../worker/alerts.js';

import {
  hourInQuiet, isQuietNow, parseQuiet, parseThreshold, toggleSpot,
  encodeSent, decodeSent, pairKey, normalizeSub, newSub, DEFAULT_MIN_KT,
} from '../worker/subs.js';

import {
  ltr, LRI, PDI, toTelegramHtml, timingSafeEqualStr, spotsKeyboard, CB_TOGGLE,
} from '../worker/telegram.js';

const REG = JSON.parse(readFileSync(new URL('../public/data/spots.json', import.meta.url), 'utf8'));
const spot = id => {
  const s = REG.spots.find(x => x.id === id);
  if (!s) throw new Error('no such spot: ' + id);
  return s;
};

/* ---------------------------------------------------------------------
   פיקסצ'רים
   19/8/2026 הוא יום קיץ — ישראל ב-UTC+3. השעה המקומית h היא h−3 ב-UTC.
   --------------------------------------------------------------------- */
const IL_OFFSET_H = 3;
const ilMs = (dayOffset, hourLocal) => Date.UTC(2026, 7, 19 + dayOffset, hourLocal - IL_OFFSET_H);
const NOW = ilMs(0, 7);            // 07:00 בבוקר, שעון ישראל

/** תחזית סינתטית קבועה לשלושה ימים, עם tsMs אמיתי כדי ש-startISO ייבנה */
function fc(kt, dirDeg, { gust = null, ageMin = 5, days = 3 } = {}) {
  const hours = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      hours.push({
        tsMs: ilMs(d, h), hour: h, dayIndex: d,
        speedKt: kt, gustKt: gust ?? kt * 1.15, dirDeg,
      });
    }
  }
  return { hours, ageMin };
}

/** רוח בזווית 45° לניצב החוף = צד-פנימה, הכיוון הטוב ביותר */
const sideOnshore = s => (s.shore_normal_deg + 45) % 360;

/** מריץ את המנוע האמיתי ומחזיר את מבנה ההתאמה שהקוד מייצר בפועל */
function matchesFor(ids, { kt = 18, nowMs = NOW } = {}) {
  const spots = ids.map(spot);
  const forecast = {};
  for (const s of spots) forecast[s.id] = fc(kt, sideOnshore(s));
  return collectMatches(spots, forecast, null, nowMs);
}

/* =====================================================================
   1. חתימת ניכוי הכפילויות
   ===================================================================== */

test('חתימה — אותם נתונים מייצרים אותה חתימה', () => {
  const a = dedupeSignature('bat-yam', '2026-08-19', 18.2, 'green');
  const b = dedupeSignature('bat-yam', '2026-08-19', 18.2, 'green');
  assert.equal(a, b);
});

test('חתימה — תזוזה קטנה מ-3 קשר אינה משנה אותה', () => {
  const a = dedupeSignature('bat-yam', '2026-08-19', 18.0, 'green');
  const b = dedupeSignature('bat-yam', '2026-08-19', 19.4, 'green');
  assert.equal(a, b, 'רעש של קשר וחצי אינו סיבה להודעה שנייה');
});

test('חתימה — תזוזה של 3 קשר ומעלה משנה אותה', () => {
  const a = dedupeSignature('bat-yam', '2026-08-19', 18, 'green');
  const b = dedupeSignature('bat-yam', '2026-08-19', 21, 'green');
  assert.notEqual(a, b);
});

test('חתימה — יום אחר הוא אירוע אחר', () => {
  const a = dedupeSignature('bat-yam', '2026-08-19', 18, 'green');
  const b = dedupeSignature('bat-yam', '2026-08-20', 18, 'green');
  assert.notEqual(a, b);
});

test('חתימה — ספוט אחר ורמה אחרת מפרידים', () => {
  assert.notEqual(
    dedupeSignature('bat-yam', '2026-08-19', 18, 'green'),
    dedupeSignature('zikim', '2026-08-19', 18, 'green'));
  assert.notEqual(
    dedupeSignature('bat-yam', '2026-08-19', 18, 'green'),
    dedupeSignature('bat-yam', '2026-08-19', 18, 'yellow'));
});

test('קידוד רשומת "נשלח" — הלוך ושוב שומר גם חתימה וגם זמן', () => {
  const sig = dedupeSignature('bat-yam', '2026-08-19', 18, 'green');
  const d = decodeSent(encodeSent(sig, NOW));
  assert.equal(d.sig, sig);
  assert.equal(d.atMs, NOW);
});

/* =====================================================================
   2. רצפת 12 השעות
   ===================================================================== */

const SUB = { chatId: 42, spots: ['bat-yam'], minKt: 12, quiet: null };
const ENTRY = { spotId: 'bat-yam', meanKt: 18, sig: 'SIG-B', startMs: NOW, day: 0 };
const K = pairKey(42, 'bat-yam');

test('רצפה — לא נשלח שוב תוך 12 שעות, גם כשהתחזית זזה', () => {
  const sent = { [K]: encodeSent('SIG-A', NOW - 11 * 3600e3) };
  const r = selectSendable({ sub: SUB, entries: [ENTRY], sent, nowMs: NOW });
  assert.equal(r.entries.length, 0);
});

test('רצפה — 12 שעות בדיוק עדיין חסומות, ורגע אחריהן פתוח', () => {
  const at = NOW - SEND_FLOOR_MS;
  assert.equal(selectSendable({
    sub: SUB, entries: [ENTRY], sent: { [K]: encodeSent('SIG-A', at + 1) }, nowMs: NOW,
  }).entries.length, 0);
  assert.equal(selectSendable({
    sub: SUB, entries: [ENTRY], sent: { [K]: encodeSent('SIG-A', at) }, nowMs: NOW,
  }).entries.length, 1);
});

test('רצפה — אחרי 13 שעות, חתימה זהה עדיין לא נשלחת', () => {
  const sent = { [K]: encodeSent('SIG-B', NOW - 13 * 3600e3) };
  const r = selectSendable({ sub: SUB, entries: [ENTRY], sent, nowMs: NOW });
  assert.equal(r.entries.length, 0, 'אותה תחזית לאותו יום אינה אירוע חדש');
});

test('רצפה — ספוט שמעולם לא נשלח עובר', () => {
  assert.equal(selectSendable({ sub: SUB, entries: [ENTRY], sent: {}, nowMs: NOW }).entries.length, 1);
});

test('רצפה — הרשומה נכתבת לפי צ׳אט וספוט, לא לפי ספוט בלבד', () => {
  const up = sentUpdates(42, [ENTRY], NOW);
  assert.deepEqual(Object.keys(up), ['42:bat-yam']);
  // צ'אט אחר עם אותו ספוט אינו מושפע
  const other = { ...SUB, chatId: 77 };
  const sent = sentUpdates(42, [ENTRY], NOW);
  assert.equal(selectSendable({ sub: other, entries: [ENTRY], sent, nowMs: NOW }).entries.length, 1);
});

/* =====================================================================
   3. שעות שקט
   ===================================================================== */

test('שקט — חלון שחוצה חצות (22–06) עובד בשני צדי חצות', () => {
  const q = { from: 22, to: 6 };
  for (const h of [22, 23, 0, 3, 5]) assert.equal(hourInQuiet(h, q), true, `שעה ${h} אמורה להיות שקטה`);
  for (const h of [6, 7, 12, 18, 21]) assert.equal(hourInQuiet(h, q), false, `שעה ${h} אמורה להיות פעילה`);
});

test('שקט — חלון רגיל שאינו חוצה חצות', () => {
  const q = { from: 1, to: 5 };
  assert.equal(hourInQuiet(0, q), false);
  assert.equal(hourInQuiet(1, q), true);
  assert.equal(hourInQuiet(4, q), true);
  assert.equal(hourInQuiet(5, q), false);
});

test('שקט — בלי הגדרה אין שקט', () => {
  assert.equal(hourInQuiet(3, null), false);
  assert.equal(hourInQuiet(3, { from: 4, to: 4 }), false);
});

test('שקט — נמדד בשעון ישראל ולא בשעון של ה-Worker', () => {
  const q = { from: 22, to: 6 };
  // 20:00 UTC = 23:00 בישראל בקיץ. ב-UTC זו שעה פעילה, בישראל שקטה.
  assert.equal(isQuietNow(Date.UTC(2026, 7, 19, 20), q), true);
  // 10:00 UTC = 13:00 בישראל
  assert.equal(isQuietNow(Date.UTC(2026, 7, 19, 10), q), false);
  // חורף: 04:00 UTC = 06:00 בישראל, כלומר בדיוק מחוץ לשקט
  assert.equal(isQuietNow(Date.UTC(2026, 0, 14, 4), q), false);
});

test('שקט — פענוח /quiet', () => {
  assert.deepEqual(parseQuiet('22-06'), { ok: true, quiet: { from: 22, to: 6 } });
  assert.deepEqual(parseQuiet('22–6'), { ok: true, quiet: { from: 22, to: 6 } });
  assert.deepEqual(parseQuiet('22:00-06:00'), { ok: true, quiet: { from: 22, to: 6 } });
  assert.deepEqual(parseQuiet('off'), { ok: true, quiet: null });
  assert.equal(parseQuiet('25-06').ok, false);
  assert.equal(parseQuiet('בלגן').ok, false);
  assert.equal(parseQuiet('22-22').ok, false);
});

/* =====================================================================
   4. סף המהירות
   ===================================================================== */

test('סף — מתחת לסף האישי אין התאמה, גם כשהמנוע ירוק', () => {
  const m = { spotId: 'bat-yam', meanKt: 15 };
  assert.equal(matchesSub({ chatId: 1, spots: ['bat-yam'], minKt: 14 }, m), true);
  assert.equal(matchesSub({ chatId: 1, spots: ['bat-yam'], minKt: 16 }, m), false);
  assert.equal(matchesSub({ chatId: 1, spots: ['bat-yam'], minKt: 15 }, m), true, 'הסף כולל');
});

test('סף — ספוט שלא נבחר אינו מתאים בשום מהירות', () => {
  assert.equal(matchesSub({ chatId: 1, spots: ['zikim'], minKt: 5 }, { spotId: 'bat-yam', meanKt: 30 }), false);
});

test('סף — פענוח /threshold', () => {
  assert.deepEqual(parseThreshold('16'), { ok: true, minKt: 16 });
  assert.deepEqual(parseThreshold(' 18.4 '), { ok: true, minKt: 18 });
  assert.equal(parseThreshold('3').ok, false);
  assert.equal(parseThreshold('99').ok, false);
  assert.equal(parseThreshold('חזק').ok, false);
});

test('סף — מנוי בלי minKt נופל לברירת המחדל ולא ל-undefined', () => {
  const s = normalizeSub({ chatId: 5, spots: ['bat-yam'] }, 5, NOW);
  assert.equal(s.minKt, DEFAULT_MIN_KT);
  assert.equal(matchesSub(s, { spotId: 'bat-yam', meanKt: DEFAULT_MIN_KT }), true);
});

/* =====================================================================
   5. הודעה אחת לצ'אט
   ===================================================================== */

const THREE = ['bat-yam', 'zikim', 'nitzanim'];

test('קיבוץ — שלושה ספוטים ירוקים לצ׳אט אחד הם קבוצה אחת, לא שלוש', () => {
  const matches = matchesFor(THREE);
  assert.equal(matches.length, 3, 'שלושתם ירוקים בפיקסצ׳ר');
  const groups = groupByChat([{ chatId: 1, spots: THREE, minKt: 12, quiet: null }], matches);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entries.length, 3);
});

test('קיבוץ — שני מנויים מקבלים שתי קבוצות, כל אחת עם מה שנבחר בה', () => {
  const matches = matchesFor(THREE);
  const groups = groupByChat([
    { chatId: 1, spots: THREE, minKt: 12, quiet: null },
    { chatId: 2, spots: ['zikim'], minKt: 12, quiet: null },
  ], matches);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(g => g.entries.length), [3, 1]);
  assert.deepEqual(groups[1].entries.map(e => e.spotId), ['zikim']);
});

test('קיבוץ — צ׳אט בלי אף התאמה אינו מייצר קבוצה (ולכן אינו מייצר הודעה)', () => {
  const groups = groupByChat([{ chatId: 9, spots: ['bat-yam'], minKt: 30, quiet: null }], matchesFor(THREE));
  assert.equal(groups.length, 0);
});

test('קיבוץ — הודעה אחת מכילה את כל הספוטים של הצ׳אט', () => {
  const matches = matchesFor(THREE);
  const [g] = groupByChat([{ chatId: 1, spots: THREE, minKt: 12, quiet: null }], matches);
  const msg = buildAlertMessage(g.entries, { siteUrl: 'https://kite-radar.pages.dev' });
  for (const id of THREE) {
    assert.ok(msg.text.includes(spot(id).name_he), `${id} חסר מההודעה`);
  }
  assert.equal(msg.included.length, 3);
  assert.equal(msg.dropped.length, 0);
});

test('אורך — הודעה נחתכת מתחת למגבלת טלגרם, והנחתכים אינם מסומנים כנשלחו', () => {
  const ids = REG.spots.map(s => s.id);
  const many = matchesFor(ids);
  assert.ok(many.length >= 20, 'הפיקסצ׳ר אמור להדליק כמעט את כל החוף');
  const msg = buildAlertMessage(many, { siteUrl: 'https://kite-radar.pages.dev' });
  assert.ok(msg.text.length <= MAX_MESSAGE_CHARS, `אורך ${msg.text.length}`);
  assert.ok(msg.dropped.length > 0, 'הפיקסצ׳ר אמור לחרוג ולהיחתך');
  assert.equal(msg.included.length + msg.dropped.length, many.length);
  // מה שנחתך לא נרשם כנשלח — אחרת הוא "כבר ידוע" ולא יישלח לעולם
  const up = sentUpdates(1, msg.included, NOW);
  assert.equal(Object.keys(up).length, msg.included.length);
});

test('איסוף — ספוט מדווח פעם אחת, ביום המוקדם ביותר שבו הוא ירוק', () => {
  const m = matchesFor(['bat-yam']);
  assert.equal(m.length, 1);
  assert.equal(m[0].day, 0);
});

test('איסוף — חלון שכבר נגמר אינו התאמה', () => {
  // 18:00 מקומי: החלון הטוב של היום (07:00–09:00) מאחור, ומה שנשאר הוא מחר
  const m = matchesFor(['bat-yam'], { nowMs: ilMs(0, 18) });
  assert.equal(m.length, 1);
  assert.equal(m[0].day, 1, 'לא מתריעים על חלון שעבר');
});

test('איסוף — 36 שעות ולא יותר', () => {
  const m = matchesFor(['bat-yam']);
  assert.ok(m[0].startMs <= NOW + WINDOW_AHEAD_MS);
  assert.ok(m[0].endMs > NOW);
});

test('איסוף — רוח חלשה אינה מייצרת התאמה בכלל', () => {
  assert.equal(matchesFor(['bat-yam'], { kt: 10 }).length, 0);
});

/* =====================================================================
   6. שפה — האפליקציה מתארת תנאים ואינה שולחת אנשים לים
   ===================================================================== */

/**
 * `\b` של JavaScript לא מזהה גבול מילה בעברית (אותיות עבריות אינן \w
 * בהקשר הזה), ולכן חיפוש נאיבי היה נופל על "שלך" ו"הולך". הבידוד נעשה
 * בתצפית קדימה ואחורה על טווח האותיות עצמו.
 */
const IMPERATIVE_GO = /(?<![א-ת])לך(?![א-ת])/;

function allGreenBlocks() {
  const out = [];
  for (const s of REG.spots) {
    const [m] = collectMatches([s], { [s.id]: fc(18, sideOnshore(s)) }, null, NOW);
    if (m) out.push(spotBlock(m, 'https://kite-radar.pages.dev'));
  }
  return out;
}

test('שפה — שום גוש ספוט אינו מכיל "לך" כציווי', () => {
  const blocks = allGreenBlocks();
  assert.ok(blocks.length >= 20, 'צריך כיסוי רחב על טקסט הרג׳יסטר');
  for (const b of blocks) {
    assert.equal(IMPERATIVE_GO.test(b), false, `ציווי בגוש:\n${b}`);
  }
});

test('שפה — הודעה שלמה אינה מכילה "לך" כציווי', () => {
  const msg = buildAlertMessage(matchesFor(THREE), {});
  assert.equal(IMPERATIVE_GO.test(msg.text), false);
  // ובדיקת שפיות לביטוי הרגולרי עצמו — הוא כן תופס ציווי אמיתי
  assert.equal(IMPERATIVE_GO.test('לך לים'), true);
  assert.equal(IMPERATIVE_GO.test('הרוח שלך הולכת'), false);
});

test('שפה — הכיוון המצווה שמור לצד המגביל', () => {
  const msg = buildAlertMessage(matchesFor(['bat-galim']), {});
  // הסיומת הקבועה היא הוראה מגבילה, וזו האסימטריה המכוונת
  assert.ok(msg.text.includes('לבדוק תנאים בשטח'));
});

/* =====================================================================
   7. סיומת קבועה, דגלי בטיחות וקישור
   ===================================================================== */

test('סיומת — כל הודעה נגמרת באותה שורה בדיוק', () => {
  for (const ids of [['bat-yam'], THREE, REG.spots.map(s => s.id)]) {
    const msg = buildAlertMessage(matchesFor(ids), {});
    assert.ok(msg.text.endsWith(toTelegramHtml(ALERT_FOOTER)), `סיומת חסרה עבור ${ids.length} ספוטים`);
  }
});

test('בטיחות — לכל ספוט יש שורת דגלים, גם כשאין דגל אחד', () => {
  const [m] = matchesFor(['bat-yam']);
  const lines = safetyLines(m);
  assert.ok(lines.length >= 1);
  assert.ok(lines[0].trim().length > 0, 'רצפת המיומנות נאמרת תמיד');
});

test('בטיחות — כל מפגע high נכנס להתראה, בלי חיתוך', () => {
  const [m] = matchesFor(['bat-galim']);   // reef/rocks/no_rescue ברמה high
  const lines = safetyLines(m).join('\n');
  assert.ok(lines.includes('⚠️'), 'מפגע high אמור להופיע');
  assert.ok(lines.includes('למתקדמים'), 'רצפת מיומנות advanced אמורה להופיע');
  const high = spot('bat-galim').hazards.filter(h => h.severity === 'high');
  assert.ok(high.length >= 3, 'הפיקסצ׳ר אמור להחזיק שלושה מפגעים חמורים');
  for (const h of high) {
    // "אין מציל" הוא הרשומה השלישית. חיתוך לשניים היה משתיק אותה בדיוק
    // בספוט שבו היא הנתון החשוב ביותר.
    assert.ok(lines.includes(h.note_he), `מפגע חמור הושמט: ${h.code}`);
  }
});

test('קישור — כל גוש נושא קישור לספוט', () => {
  const [m] = matchesFor(['bat-yam']);
  const b = spotBlock(m, 'https://kite-radar.pages.dev/');
  assert.ok(b.includes('href="https://kite-radar.pages.dev/#bat-yam"'), b);
  assert.equal(spotUrl('https://x.dev/', 'zikim'), 'https://x.dev/#zikim');
});

/* =====================================================================
   8. דו-כיווניות — טלגרם לא מכירה dir="ltr"
   ===================================================================== */

test('bidi — טווחי שעות עטופים בבידוד יוניקוד ולא בתגית span', () => {
  const b = spotBlock(matchesFor(['bat-yam'])[0], 'https://kite-radar.pages.dev');
  assert.ok(!b.includes('<span'), 'טלגרם מחזירה 400 על span ומפילה את ההודעה כולה');
  assert.ok(b.includes(`${LRI}07:00–09:00${PDI}`), b);
});

test('bidi — המרה של span שהגיע ממנוע פסק הדין', () => {
  assert.equal(toTelegramHtml('בין <span dir="ltr">12–18</span> קשר'), `בין ${LRI}12–18${PDI} קשר`);
  assert.equal(toTelegramHtml('<span dir=\'ltr\'>10:00</span>'), `${LRI}10:00${PDI}`);
});

test('bidi — בריחת HTML נעשית אחרי זיהוי התגית, לא לפניה', () => {
  // הסדר ההפוך היה מקודד את התגית ל-&lt;span ואז מחמיץ אותה
  assert.equal(toTelegramHtml('a & b <span dir="ltr">x<y</span>'), `a &amp; b ${LRI}x&lt;y${PDI}`);
});

test('bidi — ltr על ערך ריק אינו מוסיף תווים בלתי נראים', () => {
  assert.equal(ltr(''), '');
  assert.equal(ltr(null), '');
  assert.equal(ltr(3), `${LRI}3${PDI}`);
});

/* =====================================================================
   9. אבטחת ה-webhook ופענוח פקודות
   ===================================================================== */

test('סוד — השוואה בזמן קבוע מזהה זהות והבדל, כולל אורך שונה', () => {
  assert.equal(timingSafeEqualStr('s3cr3t', 's3cr3t'), true);
  assert.equal(timingSafeEqualStr('s3cr3t', 's3cr3T'), false);
  assert.equal(timingSafeEqualStr('s3cr3t', 's3cr3t '), false);
  assert.equal(timingSafeEqualStr('s3cr3t', ''), false);
  assert.equal(timingSafeEqualStr(undefined, 's3cr3t'), false, 'כותרת חסרה אינה מתאימה');
  assert.equal(timingSafeEqualStr('סוד', 'סוד'), true, 'UTF-8 רב-בתי');
});

test('פקודות — פענוח', () => {
  assert.deepEqual(parseCommand('/start betzet'), { cmd: 'start', arg: 'betzet' });
  assert.deepEqual(parseCommand('/start'), { cmd: 'start', arg: '' });
  assert.deepEqual(parseCommand('/threshold@KiteRadarBot 16'), { cmd: 'threshold', arg: '16' });
  assert.deepEqual(parseCommand('  /STOP '), { cmd: 'stop', arg: '' });
  assert.equal(parseCommand('שלום'), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand(undefined), null);
});

test('פקודות — קישור העומק מהאתר נושא מזהה ספוט תקין', () => {
  // t.me מגביל את מטען ה-start ל-A-Za-z0-9_- . מזהה שיחרוג ישבור הרשמה
  // בהקשה אחת, וזה ייראה כמו באג באתר ולא כמו נתון ברג'יסטר.
  for (const s of REG.spots) {
    assert.match(s.id, /^[A-Za-z0-9_-]{1,60}$/, `מזהה שאינו כשיר לקישור עומק: ${s.id}`);
  }
});

/* =====================================================================
   10. מתג הספוטים
   ===================================================================== */

test('מתג — הקשה מסמנת, הקשה שנייה מבטלת', () => {
  const s0 = newSub(1, NOW);
  const s1 = toggleSpot(s0, 'bat-yam');
  assert.deepEqual(s1.spots, ['bat-yam']);
  assert.deepEqual(toggleSpot(s1, 'bat-yam').spots, []);
  assert.deepEqual(s0.spots, [], 'המנוי המקורי לא שונה במקום');
});

test('מקלדת — סימון ✅ מול ⬜ ו-callback_data קצר מ-64 בתים', () => {
  const kb = spotsKeyboard(REG.spots, ['bat-yam']);
  const flat = kb.inline_keyboard.flat();
  const batYam = flat.find(b => b.callback_data === CB_TOGGLE + 'bat-yam');
  assert.ok(batYam.text.startsWith('✅'));
  assert.ok(flat.find(b => b.callback_data === CB_TOGGLE + 'zikim').text.startsWith('⬜'));
  for (const b of flat) {
    assert.ok(new TextEncoder().encode(b.callback_data).length <= 64, b.callback_data);
  }
});
