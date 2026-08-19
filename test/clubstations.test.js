/* =========================================================================
   בדיקות תחנות המועדונים (Surf Center ריף רף · Surf Cycle קריית ים).
   -------------------------------------------------------------------------
   שני המפענחים האלה הם המקום שבו טעות שקטה הופכת למספר שגוי על כרטיס
   בטיחות: mph שלא הומר אומר "אין רוח" ביום של 15 קשר, והמרה כפולה על
   נתון שכבר בקשר אומרת אותו דבר. כל בדיקה כאן נועלת יחידה, שעון או נפילה.
   ========================================================================= */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseAwnDevice, parseSurfoXml, surfoTimeToMs, israelOffsetMin, MPH_TO_KT,
} from '../public/js/sources/obs-parse.js';
import { obsForSpot } from '../public/js/sources/obs.js';

const REG = JSON.parse(readFileSync(new URL('../public/data/spots.json', import.meta.url), 'utf8'));
const spot = id => REG.spots.find(s => s.id === id);

/* ===================== AWN — ריף רף ===================== */

/** fixture מקוצר מתגובה אמיתית שנמשכה ב-19/8/2026 */
const AWN_FIXTURE = JSON.stringify([{
  macAddress: 'C4:5B:BE:5D:0C:5B',
  info: { name: 'Surfcenter Israel' },
  lastData: {
    dateutc: 1787135880000, // 2026-08-19T10:38:00Z — epoch אמיתי, לא "שעון מקומי"
    windspeedmph: 18.1, windspdmph_avg10m: 16.8, windgustmph: 22.4,
    winddir: 356, tempf: 94.1, humidity: 40,
  },
}]);

test('AWN — mph מומר לקשר, פעם אחת בדיוק', () => {
  const w = parseAwnDevice(AWN_FIXTURE);
  // 16.8 mph על הנייר הם 14.6 קשר. מספר אחר = המרה חסרה או כפולה.
  assert.equal(w.speedKt, 14.6);
  assert.equal(w.gustKt, 19.5);
  assert.equal(w.dirDeg, 356);
});

test('AWN — המהירות היא ממוצע 10 דקות, לא הערך הרגעי', () => {
  // הרגעי נמדד קופץ 11 עד 21 קשר בין דקות. אם מישהו "יפשט" לרגעי,
  // הכרטיס יהבהב בין אין-רוח ליש-רוח כל רענון.
  const w = parseAwnDevice(AWN_FIXTURE);
  assert.equal(w.speedKt, Math.round(16.8 * MPH_TO_KT * 10) / 10, 'חייב לבוא מ-windspdmph_avg10m');
  assert.notEqual(w.speedKt, Math.round(18.1 * MPH_TO_KT * 10) / 10, 'ולא מ-windspeedmph הרגעי');
});

test('AWN — dateutc עובר כמות שהוא: הוא UTC אמיתי, בלי היסט שמ"ט', () => {
  const w = parseAwnDevice(AWN_FIXTURE);
  assert.equal(new Date(w.tsMs).toISOString(), '2026-08-19T10:38:00.000Z');
});

test('AWN — קלט פגום מחזיר null, לא זורק ולא ממציא', () => {
  assert.equal(parseAwnDevice('לא JSON'), null);
  assert.equal(parseAwnDevice('[]'), null);
  assert.equal(parseAwnDevice(JSON.stringify([{ lastData: {} }])), null);
  assert.equal(parseAwnDevice(JSON.stringify([{ lastData: { dateutc: 1, windspdmph_avg10m: 500, winddir: 10 } }])),
    null, 'רוח של 500 mph היא חיישן שבור, לא שיא עולם');
});

/* ===================== סורפו — קריית ים ===================== */

const SURFO_FIXTURE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<windXml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
  '<WindGust>15</WindGust><Direction>329</Direction><AverageWind>8</AverageWind>',
  '<DateTime>19/08/2026,14:44:01</DateTime>',
  '<Temp>30.5</Temp><Humidity>58.8</Humidity><Pressure>1012.7</Pressure>',
  '</windXml>',
].join('');

test('סורפו — הערכים כבר בקשר, ואסור שתתווסף המרה', () => {
  const w = parseSurfoXml(SURFO_FIXTURE);
  // המרה כפולה (קשר כפול 0.87 או כפול 1.94) נותנת 7 או 15.5 — שניהם שקר.
  assert.equal(w.speedKt, 8);
  assert.equal(w.gustKt, 15);
  assert.equal(w.dirDeg, 329);
});

test('סורפו — שעון ישראל עם שעון קיץ, לא UTC+2 הקבוע של השמ"ט', () => {
  // 14:44 שעון ישראל באוגוסט = 11:44Z. פירוש לפי כלל השמ"ט היה נותן
  // 12:44Z — שעה שלמה של טעות בהשוואת מדוד-מול-חזוי.
  const w = parseSurfoXml(SURFO_FIXTURE);
  assert.equal(new Date(w.tsMs).toISOString(), '2026-08-19T11:44:01.000Z');
});

test('סורפו — חורף הוא UTC+2: שני המשטרים, לא אחד', () => {
  assert.equal(new Date(surfoTimeToMs('15/01/2026,14:45:00')).toISOString(), '2026-01-15T12:45:00.000Z');
  assert.equal(new Date(surfoTimeToMs('19/08/2026,14:45:00')).toISOString(), '2026-08-19T11:45:00.000Z');
  assert.equal(israelOffsetMin(Date.UTC(2026, 0, 15)), 120);
  assert.equal(israelOffsetMin(Date.UTC(2026, 7, 15)), 180);
});

test('סורפו — הפורמט הוא יום-קודם: 05/08 הוא אוגוסט, לא מאי', () => {
  const ts = surfoTimeToMs('05/08/2026,12:00:00');
  assert.equal(new Date(ts).getUTCMonth(), 7, 'חודש 8 = אוגוסט');
});

test('סורפו — קלט פגום מחזיר null', () => {
  assert.equal(parseSurfoXml(''), null);
  assert.equal(parseSurfoXml('<html>שגיאת שרת</html>'), null);
  assert.equal(parseSurfoXml(SURFO_FIXTURE.replace('19/08/2026,14:44:01', 'אין תאריך')), null);
  assert.equal(parseSurfoXml(SURFO_FIXTURE.replace('<Direction>329', '<Direction>999')), null);
});

/* ===================== שרשרת הנפילה ===================== */

const PAYLOAD = {
  stations: { AFEQ: { tsMs: 1, speedKt: 6.4, gustKt: 14.4, dirDeg: 327 } },
  eilat: { tsMs: 2, speedKt: 18.9, gustKt: 21.6, dirDeg: 37 },
  clubs: {
    eilat_surfcenter: { tsMs: 3, speedKt: 14.6, gustKt: 19.5, dirDeg: 356 },
    surfo_kiryat_yam: { tsMs: 4, speedKt: 8, gustKt: 15, dirDeg: 329 },
  },
  feed: {},
};

test('ריף רף — תחנת המועדון שעל החוף גוברת על IUI', () => {
  const o = obsForSpot(spot('eilat-reef-raf'), PAYLOAD);
  assert.equal(o.source, 'club');
  assert.equal(o.speedKt, 14.6);
  assert.match(o.stationName_he, /Surf Center/);
});

test('ריף רף — כשהמועדון שותק, IUI תופס בלי חור', () => {
  // ⚠️ זו מהות הגיבוי: מקור שנפל מפנה את מקומו ולא משאיר "אין מדידה"
  // כשיש מדידה שנייה חיה. וזו גם דרישת סעיף 10 ברישיון השמ"ט.
  const o = obsForSpot(spot('eilat-reef-raf'), { ...PAYLOAD, clubs: {} });
  assert.equal(o.source, 'meteotech');
  assert.equal(o.speedKt, 18.9);
});

test('קריית ים — סורפו שעל החוף גובר על AFEQ שבעמק, ונופל אליה כשהוא שותק', () => {
  const on = obsForSpot(spot('kiryat-yam'), PAYLOAD);
  assert.equal(on.source, 'club');
  assert.equal(on.speedKt, 8);
  const off = obsForSpot(spot('kiryat-yam'), { ...PAYLOAD, clubs: {} });
  assert.equal(off.source, 'ims');
  assert.equal(off.speedKt, 6.4);
});

test('ספוט בלי תחנת מועדון לא מושפע בכלל', () => {
  const s = { ...spot('kiryat-yam'), live_stations: { ims: 'AFEQ', distance_km: 4.6 } };
  assert.equal(obsForSpot(s, PAYLOAD).source, 'ims');
});

test('הרג׳יסטר — כל תחנת מועדון בטווח, עם שם, עם feed, ועם גיבוי', () => {
  let seen = 0;
  for (const s of REG.spots) {
    const ls = s.live_stations || {};
    if (!ls.club) continue;
    seen++;
    assert.ok(ls.club_distance_km <= 12, `${s.id}: תחנת מועדון מחוץ לטווח`);
    assert.ok(ls.club_name_he, `${s.id}: תחנה בלי שם עברי`);
    assert.ok(ls.club_feed, `${s.id}: תחנה בלי מפתח feed לניטור הפסקות`);
    assert.ok(ls.ims || ls.meteotech, `${s.id}: תחנת מועדון בלי גיבוי — חוזרים לנקודת כשל יחידה`);
  }
  assert.ok(seen >= 4, `ציפינו לארבעה ספוטים עם תחנת מועדון, נמצאו ${seen}`);
});

test('הייחוס למועדונים קיים ונושא קישור', async () => {
  const { ATTRIBUTION } = await import('../public/js/config.js');
  for (const name of ['Surf Center', 'Surf Cycle']) {
    const a = ATTRIBUTION.find(x => x.name === name);
    assert.ok(a, `${name} חסר בייחוס`);
    assert.match(a.url, /^https:\/\//);
  }
});

/* ===================== אי-הסכמה בכיוון ===================== */

test('כיוון נמדד בגזרת סכנה מוריד דרגה גם כשהמהירויות תואמות', async () => {
  // ⚠️ התרחיש האמיתי מאילת, 19/8: נמדד 354 מעלות מול 33 חזוי, מהירויות
  // כמעט זהות. ניצב ריף רף 115 — החזוי הוא צד-חוף, הנמדד צד-החוצה.
  // בלי הכלל הזה הכרטיס נשאר ירוק בזמן שהמכשיר שעל נקודת ההנפה מודד
  // רוח שדוחפת אל הים הפתוח.
  const { scoreSpot } = await import('../public/js/verdict/engine.js');
  const s = spot('eilat-reef-raf');
  const mk = h => ({ tsMs: null, hour: h, dayIndex: 0, speedKt: 18, gustKt: 21, dirDeg: 33 });
  const fc = { hours: Array.from({ length: 24 }, (_, h) => mk(h)), ageMin: 5 };
  const now = Date.UTC(2026, 7, 19, 11);

  const base = scoreSpot(s, fc, null, now, {}, 0);
  assert.equal(base.level, 'green', 'הביקורת: צד-חוף ב-18 קשר הוא ירוק');

  const obs = { speedKt: 17.5, gustKt: 20, dirDeg: 354, ageMin: 3, forecastAtObsKt: 18 };
  const v = scoreSpot(s, fc, obs, now, {}, 0);
  assert.equal(v.level, 'yellow', 'כיוון נמדד מסוכן חייב להוריד דרגה');
  assert.ok(v.flags.includes('obs_dir_disagrees'));
  assert.ok(!v.flags.includes('obs_disagrees'), 'המהירויות תואמות — רק דגל הכיוון');
});

test('כיוון נמדד בטוח לעולם לא משדרג פסק דין', async () => {
  // הכיוון ההפוך: התחזית אופשור (אדום), המדידה אונשור. המדידה היא
  // נקודה אחת — היא לא הופכת אדום לירוק. אין מסלול שדרוג.
  const { scoreSpot } = await import('../public/js/verdict/engine.js');
  const s = spot('eilat-reef-raf');
  const offshoreDir = (s.shore_normal_deg + 180) % 360;
  const fc = { hours: Array.from({ length: 24 }, (_, h) => ({ tsMs: null, hour: h, dayIndex: 0, speedKt: 18, gustKt: 21, dirDeg: offshoreDir })), ageMin: 5 };
  const now = Date.UTC(2026, 7, 19, 11);
  const obs = { speedKt: 18, gustKt: 21, dirDeg: s.shore_normal_deg, ageMin: 3, forecastAtObsKt: 18 };
  assert.equal(scoreSpot(s, fc, obs, now, {}, 0).level, 'red');
});

/* ===================== השער בשרת: קריאה מתה לא מתפרסמת ===================== */

test('לקריאת מועדון מתה אין מפתח ב-clubs — הנפילה באמת נופלת', async () => {
  // ⚠️ ה-API של AWN עונה גם כשהתחנה כבויה, עם lastData קפוא. וורדפרס
  // של סורפו מגיש XML קפוא. בלי השער, קריאה בת שש שעות גוברת על תחנת
  // גיבוי חיה — כי obsForSpot בודק נוכחות מפתח.
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../functions/api/obs.js', import.meta.url), 'utf8');
  for (const [feed, clubKey] of [['awn_eilat', 'eilat_surfcenter'], ['surfo', 'surfo_kiryat_yam']]) {
    // חיפוש מחרוזות, לא רג'קס — עמיד למלכודות escaping. הדרישה: ההשמה
    // ל-body.clubs.<key> יושבת אחרי בניית ה-feed של אותו מקור, ועל אותה
    // שורה שבה תנאי state !== 'dead'.
    const assignAt = src.indexOf(`body.clubs.${clubKey} = w;`);
    assert.ok(assignAt > 0, `${feed}: לא נמצאה השמה ל-body.clubs.${clubKey}`);
    const lineStart = src.lastIndexOf('\n', assignAt) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', assignAt));
    assert.ok(line.includes(`state !== 'dead'`),
      `${feed}: ההשמה חייבת להיות מותנית ב-state !== 'dead' — נמצא: ${line.trim()}`);
    const feedAt = src.indexOf(`body.feed.${feed} = {`);
    assert.ok(feedAt > 0 && feedAt < assignAt,
      `${feed}: ה-feed חייב להיבנות לפני שההשמה נבחנת מולו`);
  }
});

/* ===================== ממצאי הביקורת — נעולים ===================== */

test('null בשדה JSON אינו הופך ל-0 — הפעם השלישית של אותה מלכודת', () => {
  // Number(null) === 0. שדה שהגיע null חייב ליפול לגיבוי, לא להפוך
  // ל"0 קשר מצפון" — מספר שנראה אמיתי ולא נמדד מעולם.
  const withNulls = JSON.stringify([{ lastData: {
    dateutc: 1787135880000, windspdmph_avg10m: null, windspeedmph: 18.1,
    winddir_avg10m: null, winddir: 90, windgustmph: 22.4,
  } }]);
  const w = parseAwnDevice(withNulls);
  assert.equal(w.speedKt, 15.7, 'avg=null נופל לרגעי, לא ל-0');
  assert.equal(w.dirDeg, 90, 'כיוון null נופל לגיבוי, לא לצפון');
  assert.equal(parseAwnDevice(JSON.stringify([{ lastData: { dateutc: null, windspdmph_avg10m: 10, winddir: 90 } }])),
    null, 'dateutc=null אינו epoch 0');
});

test('תגית XML ריקה אינה הופכת ל-0 קשר', () => {
  const empty = SURFO_FIXTURE.replace('<AverageWind>8</AverageWind>', '<AverageWind></AverageWind>');
  assert.equal(parseSurfoXml(empty), null, 'קובץ חלקי באמצע כתיבה אינו מדידה');
});

test('שניות אינן מזיזות את ההיסט — hh:59:45 נשאר באותה שעה', () => {
  // בלי קיצוץ לדקה, ההיסט התעגל ל-179 דקות והקריאה זזה דקה קדימה —
  // ובגבול שעה, אל שעת התחזית הלא נכונה.
  assert.equal(new Date(surfoTimeToMs('19/08/2026,14:59:45')).toISOString(), '2026-08-19T11:59:45.000Z');
  assert.equal(new Date(surfoTimeToMs('19/08/2026,14:59:31')).toISOString(), '2026-08-19T11:59:31.000Z');
});
