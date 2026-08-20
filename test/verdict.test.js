/* =========================================================================
   בדיקות מנוע פסק הדין.  הרצה:  node --test test/
   -------------------------------------------------------------------------
   כל בדיקה כאן היא כלל בטיחות, לא בדיקת רגרסיה. אם אחת נופלת —
   האפליקציה עלולה לשלוח מישהו לים בתנאים שגויים.
   ========================================================================= */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreSpot, pickWindow, circularMean } from '../public/js/verdict/engine.js';
import { offAxisDeg, directionClass, speedScore, gustScore } from '../public/js/verdict/bands.js';
import { israelDateParts, seasonGate, legalGate } from '../public/js/verdict/calendar.js';

const REG = JSON.parse(readFileSync(new URL('../public/data/spots.json', import.meta.url), 'utf8'));
const spot = id => {
  const s = REG.spots.find(x => x.id === id);
  if (!s) throw new Error('no such spot: ' + id);
  return s;
};

/** בונה תחזית סינתטית: אותה רוח בכל שעות היום */
function fc({ kt, gust = null, dir = 270, day = 0, ageMin = 5, hours = null }) {
  const list = hours || Array.from({ length: 24 }, (_, h) => ({
    tsMs: null, hour: h, dayIndex: day,
    speedKt: kt, gustKt: gust ?? kt * 1.2, dirDeg: dir,
  }));
  return { hours: list, ageMin };
}

/* ===================== גיאומטריה ===================== */

test('offAxisDeg — רוח מהים היא 0, רוח מהיבשה היא 180', () => {
  assert.equal(offAxisDeg(270, 270), 0);    // חוף פונה מערבה, רוח מערבית = פנימה
  assert.equal(offAxisDeg(90, 270), 180);   // רוח מזרחית = החוצה
  assert.equal(offAxisDeg(315, 270), 45);   // צפון-מערבית = צד-פנימה
  assert.equal(offAxisDeg(180, 270), 90);   // דרומית = צד-חוף
});

test('offAxisDeg — סימטרי סביב הגלישה ב-360', () => {
  assert.equal(offAxisDeg(10, 350), 20);
  assert.equal(offAxisDeg(350, 10), 20);
});

test('circularMean — 350 ו-10 נותנים 0, לא 180', () => {
  assert.ok(Math.abs(circularMean([350, 10]) - 0) < 0.001 ||
            Math.abs(circularMean([350, 10]) - 360) < 0.001);
});

/* ===================== חריג אילת ===================== */

/**
 * חריג "אופשור מנוהל" — נבדק על פיקסצ'ר ולא על הרג'יסטר.
 * העיקרון (override גובר על המיפוי הגנרי, ומקבל טיפול ויזואלי שלישי
 * שאינו ירוק ואינו אדום) חייב להישאר מכוסה גם כשהנתונים משתנים —
 * וחוף אילת הצפוני איבד את החריג שלו כשהתברר שהוא לא חוף הקייט.
 */
const MANAGED_FIXTURE = {
  id: 'fixture-managed', name_he: 'פיקסצ׳ר', region: 'eilat',
  lat: 29.55, lon: 34.95, shore_normal_deg: 180,
  direction_overrides: [{ from: 320, to: 40, class: 'offshore_managed', score: 78,
                          flags: ['rescue_boat', 'upwind_skill'], note_he: 'מצב הרכיבה הרגיל כאן.' }],
  season: null, daytime_window: { start: 12, end: 18 }, legal: [], hazards: [],
  marine: { available: false, confidence: 'none', note_he: 'אין גלים.' },
  live_stations: {}, models: { force: [], exclude: [] }, sub_spots: [],
  skill_floor: 'advanced', source: 'core', status: 'established', _verify: [],
};

test('אילת — צפונית מוחזרת כ-offshore_managed ולא כאדום', () => {
  const s = MANAGED_FIXTURE;
  const d = directionClass(0, s);
  assert.equal(d.cls, 'offshore_managed');
  assert.ok(d.overridden, 'חייב להגיע מ-direction_overrides');
  assert.ok(d.flags.includes('rescue_boat'));
  assert.ok(d.flags.includes('upwind_skill'));
  assert.ok(offAxisDeg(0, s.shore_normal_deg) > 157,
    'ובכל זאת גאומטרית זו רוח החוצה — החריג הוא החלטה, לא גאומטריה');
});

test('אילת — 18 קשר צפונית אינה אדומה, ונושאת את דגלי החילוץ', () => {
  const v = scoreSpot(MANAGED_FIXTURE, fc({ kt: 18, dir: 0 }), null, Date.UTC(2026, 7, 18, 9), {});
  assert.notEqual(v.level, 'red');
  assert.ok(v.flags.includes('rescue_boat'));
  assert.ok(v.flags.includes('upwind_skill'));
});

test('אילת — רוח מזרחית (מחוץ לקשת החריג) כן חוזרת אדומה', () => {
  const s = MANAGED_FIXTURE;
  const d = directionClass(90, s);   // 90° מול ניצב 180° → offAxis 90 = צד-חוף
  assert.equal(d.overridden, false);
  const dS = directionClass(270, s); // 270 מול 180 → offAxis 90 גם כן
  assert.equal(dS.overridden, false);
});

test('אילת — רוח דרומית ישר מהים אינה נופלת לחריג', () => {
  const d = directionClass(180, MANAGED_FIXTURE);
  assert.equal(d.cls, 'onshore');
  assert.equal(d.overridden, false);
});

/* ===================== offshore בספוט רגיל ===================== */

test('בת ים — רוח מזרחית 20 קשר חייבת להיות אדומה למרות מהירות מצוינת', () => {
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 20, dir: 90 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.dirCls, 'offshore');
  assert.equal(v.level, 'red', 'ניקוד מהירות גבוה לא יכול לעקוף רוח מהחוף החוצה');
});

test('בת ים — 18 קשר מערבית היא ירוקה', () => {
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 18, gust: 21, dir: 290 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'green');
});

test('בת ים — 6 קשר אינה ירוקה', () => {
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 6, dir: 290 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'red');
});

/* ===================== כללי טריות ===================== */

test('אין מסלול מנתון ישן אל ירוק', () => {
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 18, gust: 21, dir: 290, ageMin: 120 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.notEqual(v.level, 'green');
  assert.ok(v.flags.includes('stale'));
});

test('תחזית ישנה מדי מחזירה unknown, לא אדום', () => {
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 18, dir: 290, ageMin: 400 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'unknown');
  assert.notEqual(v.level, 'red');
});

test('העדר נתונים מחזיר unknown, לא אדום', () => {
  const v = scoreSpot(spot('bat-yam'), { hours: [], ageMin: 1 }, null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'unknown');
  const v2 = scoreSpot(spot('bat-yam'), null, null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v2.level, 'unknown');
});

/* ===================== חוקיות ועונה ===================== */

test('תל אביב — 15 ביולי חסום גם ברוח מושלמת', () => {
  const v = scoreSpot(spot('tel-aviv'), fc({ kt: 18, gust: 21, dir: 290 }), null, Date.UTC(2026, 6, 15, 9), {});
  assert.equal(v.level, 'blocked');
  assert.notEqual(v.level, 'red', 'אסור אינו מסוכן — מצב נפרד');
  assert.match(v.reason.headline, /יולי/);
});

test('תל אביב — שבת במאי חסומה, יום חול במאי פתוח', () => {
  // 2026-05-16 הוא שבת, 2026-05-13 הוא רביעי
  const sat = scoreSpot(spot('tel-aviv'), fc({ kt: 18, gust: 21, dir: 290 }), null, Date.UTC(2026, 4, 16, 9), {});
  assert.equal(sat.level, 'blocked');
  const wed = scoreSpot(spot('tel-aviv'), fc({ kt: 18, gust: 21, dir: 290 }), null, Date.UTC(2026, 4, 13, 9), {});
  assert.notEqual(wed.level, 'blocked');
});

test('תל אביב — בדצמבר אין חסימה', () => {
  const v = scoreSpot(spot('tel-aviv'), fc({ kt: 18, gust: 21, dir: 290 }), null, Date.UTC(2026, 11, 9, 9), {});
  assert.notEqual(v.level, 'blocked');
});

test('כנרת — בינואר מחוץ לעונה, באוגוסט בעונה', () => {
  const jan = scoreSpot(spot('kinneret-diamond'), fc({ kt: 18, gust: 21, dir: 270 }), null, Date.UTC(2026, 0, 15, 12), {});
  assert.equal(jan.level, 'blocked');
  const aug = scoreSpot(spot('kinneret-diamond'), fc({ kt: 18, gust: 21, dir: 270 }), null, Date.UTC(2026, 7, 15, 12), {});
  assert.notEqual(aug.level, 'blocked');
});

test('israelDateParts — שעון ישראל, לא שעון המכשיר', () => {
  const p = israelDateParts(Date.UTC(2026, 7, 18, 21, 30)); // 21:30 UTC בקיץ = 00:30 למחרת
  assert.equal(p.month, 8);
  assert.equal(p.day, 19);
});

/* ===================== חלון תרמי ===================== */

test('כנרת — הניקוד לוקח את אחר הצהריים, לא ממוצע יממה', () => {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    tsMs: null, hour: h, dayIndex: 0,
    speedKt: h >= 13 && h <= 17 ? 20 : 3,   // תרמית חדה, לילה מת
    gustKt: h >= 13 && h <= 17 ? 24 : 4,
    dirDeg: 270,
  }));
  const w = pickWindow(spot('kinneret-diamond'), { hours, ageMin: 5 }, 0);
  assert.ok(w.meanKt >= 19, `החלון צריך לתפוס את התרמית, קיבל ${w.meanKt}`);
  assert.ok(w.startHour >= 12 && w.endHour <= 18);
});

test('ספוט לא-תרמי משתמש בחלון היום המלא', () => {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    tsMs: null, hour: h, dayIndex: 0,
    speedKt: h >= 8 && h <= 10 ? 22 : 5, gustKt: 26, dirDeg: 290,
  }));
  const w = pickWindow(spot('bat-yam'), { hours, ageMin: 5 }, 0, REG.defaults);
  assert.ok(w.startHour >= 7 && w.startHour <= 10);
});

/* ===================== משבים ===================== */

test('יחס משב גבוה מוריד דרגה', () => {
  const smooth = scoreSpot(spot('bat-yam'), fc({ kt: 18, gust: 21, dir: 290 }), null, Date.UTC(2026, 10, 18, 9), {});
  const gusty  = scoreSpot(spot('bat-yam'), fc({ kt: 18, gust: 32, dir: 290 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(smooth.level, 'green');
  assert.notEqual(gusty.level, 'green');
  assert.ok(gusty.flags.includes('gusty'));
});

test('gustScore — יחס נמוך = 100, יחס גבוה = הורדת דרגה', () => {
  assert.equal(gustScore(20, 24, 'side_shore').tierDowngrade, false);
  assert.equal(gustScore(20, 34, 'side_shore').tierDowngrade, true);
});

/* ===================== מהירות ומשקל ===================== */

test('speedScore — מונוטוני עולה עד השיא ואז יורד', () => {
  assert.equal(speedScore(5), 0);
  assert.ok(speedScore(13) < speedScore(18));
  assert.ok(speedScore(18) > speedScore(30));
  assert.equal(speedScore(40), 0);
});

test('the verdict is objective — rider weight must NOT move it', () => {
  // פסק דין הוא קביעה על החוף. אם שני אנשים רואים צבע שונה לאותו חוף
  // באותה שעה, אי אפשר להגיד "יש רוח בבת ים" ולסמוך על זה.
  assert.equal(speedScore(13), speedScore(13));
  const light = scoreSpot(spot('bat-yam'), fc({ kt: 16, gust: 19, dir: 300 }), null, Date.UTC(2026, 10, 18, 9), { weightKg: 55 });
  const heavy = scoreSpot(spot('bat-yam'), fc({ kt: 16, gust: 19, dir: 300 }), null, Date.UTC(2026, 10, 18, 9), { weightKg: 105 });
  assert.equal(light.level, heavy.level);
  assert.equal(light.score, heavy.score);
});

test('speedScore takes exactly one argument — no preference can leak in', () => {
  assert.equal(speedScore.length, 1);
  assert.equal(speedScore(18, { weightKg: 105 }), speedScore(18));
});

test('gear planning IS personal — the same wind gives a heavy rider a bigger kite', async () => {
  const { kiteSizeM, kiteRange, matchQuiver } = await import('../public/js/verdict/bands.js');
  assert.ok(kiteSizeM(18, 105) > kiteSizeM(18, 55), 'heavier rider needs more area');
  assert.ok(kiteSizeM(24, 75) < kiteSizeM(14, 75), 'more wind needs less area');
  const r = kiteRange(18, 75);
  assert.ok(r.lo < r.center && r.center < r.hi);
  // כיול: 75 ק"ג ב-18 קשר ≈ 10 מטר, נקודת הייחוס של טבלאות היצרנים
  assert.ok(Math.abs(kiteSizeM(18, 75) - 10) < 0.6, `got ${kiteSizeM(18, 75)}`);
});

test('quiver matching flags when nothing you own fits', async () => {
  const { matchQuiver } = await import('../public/js/verdict/bands.js');
  assert.equal(matchQuiver(18, 75, [9, 10, 12]).fits, true);
  const tooLight = matchQuiver(30, 75, [14, 17]);
  assert.equal(tooLight.fits, false);
  assert.equal(tooLight.reason, 'too_big');
  assert.equal(matchQuiver(18, 75, []).reason, 'no_quiver');
  assert.equal(matchQuiver(3, 75, [10]).reason, 'no_wind');
});

test('קנס יתר-כוח מואץ ולא לינארי', () => {
  const d1 = speedScore(28) - speedScore(30);
  const d2 = speedScore(32) - speedScore(34);
  assert.ok(d2 > d1, 'הירידה חייבת להתלול ככל שמתרחקים מ-28 קשר');
});

/* ===================== פער מודלים ===================== */

test('פער מודלים גדול מוריד ירוק לצהוב', () => {
  const mk = kt => Array.from({ length: 24 }, (_, h) => ({ hour: h, dayIndex: 0, speedKt: kt, gustKt: kt * 1.15, dirDeg: 290 }));
  const f = fc({ kt: 18, gust: 21, dir: 290 });
  f.models = { gfs: mk(13), ecmwf: mk(23), icon: mk(18) };
  const v = scoreSpot(spot('bat-yam'), f, null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'yellow');
  assert.ok(v.flags.includes('model_spread'));
  assert.ok(v.confidence.modelSpreadKt >= 9);
});

test('הסכמת מודלים משאירה ירוק', () => {
  const mk = kt => Array.from({ length: 24 }, (_, h) => ({ hour: h, dayIndex: 0, speedKt: kt, gustKt: kt * 1.15, dirDeg: 290 }));
  const f = fc({ kt: 18, gust: 21, dir: 290 });
  f.models = { gfs: mk(17), ecmwf: mk(19), icon: mk(18) };
  const v = scoreSpot(spot('bat-yam'), f, null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'green');
  assert.equal(v.confidence.level, 'high');
});

/* ===================== ספוט משתמש ===================== */

test('ספוט שהמשתמש הוסיף לא יכול להגיע לירוק', () => {
  const s = { ...spot('bat-yam'), id: 'mine', source: 'user' };
  const v = scoreSpot(s, fc({ kt: 18, gust: 21, dir: 290 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'yellow');
});

/* ===================== נימוק ===================== */

test('כל פסק דין מייצר כותרת ופירוט', () => {
  for (const s of REG.spots) {
    const v = scoreSpot(s, fc({ kt: 17, gust: 20, dir: 300 }), null, Date.UTC(2026, 7, 18, 13), {});
    assert.ok(v.reason.headline.length > 0, s.id);
    assert.ok(Array.isArray(v.reason.detail), s.id);
    assert.ok(['green', 'yellow', 'red', 'blocked', 'unknown'].includes(v.level), s.id);
  }
});

test('טווחי מספרים עטופים ב-dir=ltr', () => {
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 18, gust: 21, dir: 290 }), null, Date.UTC(2026, 10, 18, 9), {});
  const withRange = [...v.reason.detail].filter(t => t.includes('–') || /\d+-\d+/.test(t));
  for (const t of withRange) assert.match(t, /dir="ltr"/, `טווח בלי עטיפה: ${t}`);
});

test('סכנות חמורות מופיעות בהסתייגויות גם כשהרוח מצוינת', () => {
  const v = scoreSpot(spot('eilat-reef-raf'), fc({ kt: 18, dir: 0 }), null, Date.UTC(2026, 7, 18, 13), {});
  const joined = v.reason.caveats.join(' ');
  // ההסתייגויות נושאות את סכנות ה-high של הספוט, יהיה נוסחן אשר יהיה
  const high = spot('eilat-reef-raf').hazards.filter(h => h.severity === 'high');
  assert.ok(high.length > 0, 'Reef Raf must carry high-severity hazards');
  for (const h of high) assert.ok(joined.includes(h.note_he), `missing hazard: ${h.note_he.slice(0, 30)}`);
});

/* ===================== שלמות הרג'יסטר ===================== */

test('כל ספוט תקין מבנית', () => {
  const ids = new Set();
  for (const s of REG.spots) {
    assert.ok(s.id && !ids.has(s.id), 'id ייחודי: ' + s.id);
    ids.add(s.id);
    assert.ok(s.name_he, s.id);
    assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lon), s.id);
    assert.ok(s.lat > 29 && s.lat < 34, 'lat בישראל: ' + s.id);
    assert.ok(s.lon > 34 && s.lon < 36, 'lon בישראל: ' + s.id);
    assert.ok(s.shore_normal_deg >= 0 && s.shore_normal_deg < 360, s.id);
    assert.ok(['beginner', 'intermediate', 'advanced'].includes(s.skill_floor), s.id);
    assert.ok(['verified', 'estimate', 'none'].includes(s.marine.confidence), s.id);
    if (s.marine.available === false) assert.ok(s.marine.note_he, 'חייב הסבר למה אין גלים: ' + s.id);
  }
});

test('gust flag is noise below the rideable threshold — must not fire', () => {
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 9, gust: 17, dir: 290 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'red', 'still a no-go on speed alone');
  assert.ok(!v.flags.includes('gusty'), 'a 1.9 gust ratio at 9kt is normal physics, not a finding');
});

test('gust flag still fires once the wind is actually rideable', () => {
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 16, gust: 30, dir: 290 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.ok(v.flags.includes('gusty'));
});

test('speed is a gate — a perfect direction cannot rescue 10 knots', () => {
  // 10kt, side-onshore, smooth: every non-speed component is ideal
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 10, gust: 12, dir: 315 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.dirCls, 'side_onshore');
  assert.equal(v.level, 'red', 'nobody rides 10 knots, however perfect the angle');
});

test('speed gate — 13 knots caps at yellow even when everything else is ideal', () => {
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 13.5, gust: 16, dir: 315 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'yellow');
});

test('speed gate — 17 knots side-onshore is green', () => {
  const v = scoreSpot(spot('bat-yam'), fc({ kt: 17, gust: 20, dir: 315 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'green');
});

test('Latin words inside Hebrew get an explicit LTR wrapper', async () => {
  const { heText } = await import('../public/js/ui/card.js');
  const out = heText('המדידה מגיעה מתחנת IUI.');
  assert.match(out, /<span dir="ltr">IUI<\/span>\./, 'the sentence-final period belongs to the Hebrew sentence, not to the Latin run');
  assert.match(heText('מקור: ims.gov.il בלבד'), /<span dir="ltr">ims\.gov\.il<\/span>/, 'but a dot inside a domain stays inside');
  // ההגנה נשמרת: תגית גולמית לא שורדת, והישויות שנוצרו לא נשברות
  const injected = heText('<img src=x onerror=alert(1)>');
  assert.ok(!/<(img|script)/i.test(injected), 'no raw tag survives');
  assert.match(injected, /&lt;/);
  assert.ok(!/&<span/.test(injected), 'entities must not be split by the LTR wrapper');
});

test('gear advice stops where the formula stops being true', async () => {
  const { kiteSizeM, kiteRange, KITE_MAX_M } = await import('../public/js/verdict/bands.js');
  assert.equal(kiteSizeM(9, 75), null, 'no gear advice below the rideable threshold');
  assert.equal(kiteRange(9, 75), null);
  const r = kiteRange(11.5, 105);
  assert.ok(r.hi <= KITE_MAX_M, `range must stay inside sizes that exist, got ${r.hi}`);
  assert.ok(r.lo <= r.hi);
  const strong = kiteRange(34, 55);
  assert.ok(strong.lo >= 5 && strong.hi >= strong.lo);
});

test('gear advice never appears on a no-go card', async () => {
  const { renderDetail } = await import('../public/js/ui/card.js');
  const prefs = { weightKg: 75, quiver: [7, 9, 12] };
  // 22kt but blowing straight offshore -> red
  const red = scoreSpot(spot('bat-yam'), fc({ kt: 22, gust: 26, dir: 90 }), null, Date.UTC(2026, 10, 18, 9), prefs);
  assert.equal(red.level, 'red');
  assert.ok(!renderDetail(spot('bat-yam'), red, { prefs }).includes('מה לקחת'),
    'a red card must not offer gear advice — it reads as encouragement');
  const green = scoreSpot(spot('bat-yam'), fc({ kt: 18, gust: 21, dir: 300 }), null, Date.UTC(2026, 10, 18, 9), prefs);
  assert.ok(renderDetail(spot('bat-yam'), green, { prefs }).includes('מה לקחת'));
});

test('the shipped registry carries only established spots with live coverage', () => {
  // הרג'יסטר נגזם: מדידה חיה היא תנאי הכרחי, ולא תוספת.
  for (const s of REG.spots) {
    assert.equal(s.status, 'established', `${s.id} should not ship as a candidate`);
    const live = s.live_stations || {};
    assert.ok(live.ims || live.meteotech, `${s.id} has no live wind source — it should not be in the registry`);
    if (live.ims) {
      assert.ok(live.distance_km != null && live.distance_km <= 12,
        `${s.id}: station ${live.ims} is ${live.distance_km}km away — too far to stand for this beach`);
    }
  }
});

test('the candidate rule still holds for anything added later', () => {
  // הכלל עצמו נשאר מכוסה גם כשאין מועמד ברג'יסטר: ספוט שגיאומטריית
  // החוף שלו לא אומתה בידי אדם לא מגיע לירוק, נקודה.
  const base = REG.spots.find(s => s.region === 'center');
  const cand = { ...base, id: 'x-cand', status: 'candidate' };
  const mine = { ...base, id: 'x-mine', source: 'user' };
  const wind = fc({ kt: 19, gust: 22, dir: base.shore_normal_deg + 40 });
  const now = Date.UTC(2026, 10, 18, 9);
  assert.equal(scoreSpot(base, wind, null, now, {}).level, 'green', 'the control case is green');
  assert.notEqual(scoreSpot(cand, wind, null, now, {}).level, 'green');
  assert.notEqual(scoreSpot(mine, wind, null, now, {}).level, 'green');
  assert.ok(scoreSpot(mine, wind, null, now, {}).flags.includes('unverified_spot'));
});

test('every spot has a defensible shore normal', () => {
  for (const s of REG.spots) {
    if (s.region === 'kinneret' || s.region === 'eilat') continue;
    // כל חוף ים תיכוני בישראל פונה למערב במובן הרחב. ניצב מחוץ לטווח
    // הזה הוא כמעט בוודאות טעות סימן, וטעות סימן הופכת בטוח למסוכן.
    // אי אפשר לקבוע טווח אחד לכל החוף — חופי מפרץ חיפה פונים דרומה-מערבה
    // וראש הכרמל צפונה-מערבה. מה שכן אי אפשר: חוף ים תיכוני שפונה מזרחה,
    // כי מזרחה שם זו יבשה. טעות סימן בניצב הופכת "בטוח" ל"מסוכן".
    const facesEast = s.shore_normal_deg > 45 && s.shore_normal_deg < 135;
    assert.ok(!facesEast,
      `${s.id} faces ${s.shore_normal_deg}° — inland. A sign error here inverts every verdict.`);
    if (s.geo_confidence !== 'high') {
      assert.ok((s._verify || []).includes('shore_normal_deg'), `${s.id} must flag its normal for verification`);
    }
  }
});

test('the summer sea breeze is rideable at the classic Med spots', () => {
  // רוח מערבית־צפון־מערבית של אחר הצהריים, ~295°, היא הבריזה הקלאסית
  for (const id of ['bat-yam', 'tel-aviv', 'betzet', 'ashdod']) {
    const s = spot(id);
    const v = scoreSpot(s, fc({ kt: 18, gust: 21, dir: 295 }), null, Date.UTC(2026, 10, 18, 9), {});
    assert.ok(['onshore', 'side_onshore', 'side_shore'].includes(v.dirCls),
      `${id}: the classic sea breeze must not classify as offshore (got ${v.dirCls})`);
  }
});

test('no spot is accidentally banned all year round', () => {
  // הרשומה שתיארה "אין הגבלה בנובמבר–מרץ" הגיעה מהמחקר עם type:"ban"
  // וחסמה את תל אביב 12 חודשים בשנה. שער מבני, לא בדיקת רגרסיה.
  for (const s of REG.spots) {
    const blocked = [];
    for (let m = 0; m < 12; m++) {
      const midMonth = Date.UTC(2026, m, 15, 10);
      if (legalGate(s, midMonth, 0)) blocked.push(m + 1);
    }
    if (blocked.length === 12) {
      // איסור קבוע הוא נתון לגיטימי (הרצליה אוסרת קייט בחוף המוכרז),
      // אבל הוא חייב להיות רשומה אחת מפורשת ולא תוצר לוואי של חפיפה
      // בין איסורים חלקיים — שם זו טעות נתונים ששולחת מישהו הביתה.
      const permanent = (s.legal || []).filter(r => r.type === 'ban' && !r.months && !r.weekdays);
      assert.equal(permanent.length, 1,
        `${s.id} is blocked in all 12 months but has no single explicit year-round ban — check legal[] types`);
    }
  }
});

test('Tel Aviv legal calendar reads correctly across the year', () => {
  const s = spot('tel-aviv');
  const at = (m, d) => scoreSpot(s, fc({ kt: 18, gust: 21, dir: 295 }), null, Date.UTC(2026, m - 1, d, 9), {});
  assert.equal(at(7, 15).level, 'blocked', 'July is a total ban');
  assert.equal(at(8, 15).level, 'blocked', 'August is a total ban');
  assert.notEqual(at(12, 9).level, 'blocked', 'December is unrestricted');
  assert.notEqual(at(2, 11).level, 'blocked', 'February is unrestricted');
  assert.equal(at(5, 16).level, 'blocked', '16/5/2026 is a Saturday in a shoulder month');
  assert.notEqual(at(5, 13).level, 'blocked', '13/5/2026 is a Wednesday in a shoulder month');
});

test('Reef Raf: the gulf northerly is rideable, and it sits on a knife edge', () => {
  const s = spot('eilat-reef-raf');
  // החוף פונה 115°, ולכן צפונית טהורה (0°) נופלת על 115° מהניצב —
  // שלוש מעלות מעבר לגבול side_shore/side_offshore. זה אמיתי ולא באג:
  // הרוח באמת נושבת שם בזווית שדוחפת מעט מהחוף. הכלל שנבדק כאן הוא
  // שהיא לעולם לא נקראת כאופשור מלא, ושהיא לא מייצרת אדום.
  assert.equal(directionClass(0, s).overridden, false, 'no exception is needed here');
  for (const w of [0, 10, 20, 350]) {
    const d = directionClass(w, s);
    assert.notEqual(d.cls, 'offshore', `wind from ${w}° must never read as full offshore at Reef Raf`);
  }
  assert.equal(directionClass(15, s).cls, 'side_shore', 'NNE — the classic gulf direction — is clean side-shore');
  const v = scoreSpot(s, fc({ kt: 19, gust: 22, dir: 15 }), null, Date.UTC(2026, 7, 18, 13), {});
  assert.notEqual(v.level, 'red');
});

test('Eilat north beach is no longer dressed up as a kite spot', () => {
  const s = spot('eilat-north');
  assert.equal(s.direction_overrides.length, 0,
    'an offshore-is-normal exception on a beach that is not the kite beach is the dangerous message');
  const v = scoreSpot(s, fc({ kt: 19, gust: 22, dir: 0 }), null, Date.UTC(2026, 7, 18, 13), {});
  assert.equal(v.level, 'blocked');
});

/* ===================== PWA — שער מבני ===================== */

test('the service worker precaches every module the app imports', async () => {
  const { readdirSync } = await import('node:fs');
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const listed = [...(/const SHELL_FILES = \[([\s\S]*?)\];/.exec(sw)?.[1] || '')
    .matchAll(/'([^']+)'/g)].map(m => m[1]);

  const found = [];
  (function walk(dir, rel) {
    for (const e of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== 'dev') walk(`${dir}${e.name}/`, `${rel}${e.name}/`); }
      else if (e.name.endsWith('.js')) found.push(`./${rel}${e.name}`);
    }
  })('../public/js/', 'js/');

  const missing = found.filter(f => !listed.includes(f));
  assert.deepEqual(missing, [],
    'a module that is imported but not precached breaks the app offline, silently');
});

test('the cache version is bumped whenever the shell list changes', () => {
  // שער רך: אם מישהו מוסיף קובץ בלי להגדיל CACHE_V, מותקנים ימשיכו
  // להריץ קוד ישן אחרי push — תקלה שקשה מאוד לאבחן מרחוק.
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE_V = 'kite-v\d+'/);
  assert.match(sw, /caches\.delete/, 'old caches must be purged on activate');
});

test('every card is a deep-link target — alerts link to a specific beach', async () => {
  const { renderCard } = await import('../public/js/ui/card.js');
  const s = REG.spots[0];
  const v = scoreSpot(s, fc({ kt: 17, gust: 20, dir: s.shore_normal_deg + 30 }), null, Date.UTC(2026, 10, 18, 9), {});
  const html = renderCard(s, v, {});
  assert.match(html, new RegExp(`id="${s.id}"`),
    'without an id the Telegram link lands on the top of the page, not the spot');
});

/* ===================== המודל שמאחורי המספר ===================== */

test('the headline number never comes from a model the registry excludes', async () => {
  // ⚠️ הבאג שהיה כאן: `best_match` נפתר בישראל ל-ICON (נמדד בקריאה
  // אמיתית ב-19/8/2026 — אותן שעות בדיוק בארבעה ספוטים). אילת מחריגה
  // את ICON במפורש, ובכל זאת קיבלה אותו כמספר הגדול בכרטיס, בזמן
  // שרצועת ההשוואה מתחתיו הראתה שני מודלים אחרים שחולקים עליו.
  const { headlineModelFor } = await import('../public/js/sources/openmeteo.js');
  const { BEST_MATCH_RESOLVES_TO } = await import('../public/js/config.js');

  for (const s of REG.spots) {
    const chosen = headlineModelFor(s);
    const actual = chosen === 'best_match' ? BEST_MATCH_RESOLVES_TO : chosen;
    const excluded = s.models?.exclude || [];
    assert.ok(!excluded.includes(actual),
      `${s.id}: the card would show ${actual}, which the registry excludes here`);
  }
});

test('an excluded default falls back to a model that is actually compared', async () => {
  const { headlineModelFor } = await import('../public/js/sources/openmeteo.js');
  const { modelsForSpot } = await import('../public/js/sources/openmeteo.js');
  const { MODELS } = await import('../public/js/config.js');

  for (const s of REG.spots) {
    const chosen = headlineModelFor(s);
    if (chosen === 'best_match') continue;
    // מספר בכרטיס שאינו אחד הקווים ברצועה הוא קו רביעי בלתי נראה
    assert.ok(modelsForSpot(s, Object.keys(MODELS)).includes(chosen),
      `${s.id}: headline model ${chosen} is not among the models shown in the strip`);
  }
});

test('eilat is the spot this rule exists for', async () => {
  const { headlineModelFor } = await import('../public/js/sources/openmeteo.js');
  assert.equal(headlineModelFor(spot('eilat-reef-raf')), 'ecmwf_ifs025');
  assert.equal(headlineModelFor(spot('tel-aviv')), 'best_match');
});

test('the checked-in registry map is not a stale artifact', async () => {
  // ⚠️ `public/dev/map.html` הוא תוצר מחולל שנשמר בגיט, ו-HANDOFF מפנה
  // אליו כ"מפת הרג'יסטר". הוא נשאר תקוע על 42 ספוטים — כולל פולג,
  // קונטיקי וגעש — חודשים אחרי שהרג'יסטר נגזם ל-26. קורא שהולך לראות
  // את הרג'יסטר ראה שלושה ספוטים שכבר אינם בו, ובטח שיש להם מדידה חיה.
  const map = readFileSync(new URL('../public/dev/map.html', import.meta.url), 'utf8');

  const count = /<b>(\d+)<\/b><span>SPOTS<\/span>/.exec(map);
  assert.ok(count, 'the map must carry a spot count');
  assert.equal(+count[1], REG.spots.length,
    `map.html shows ${count[1]} spots, registry has ${REG.spots.length} — rebuild with: node public/dev/build-map.js public/dev/map.html`);

  // שם הספוט נכתב למפה מוגן-HTML, ו-palmachim נושא גרשיים בשמו
  const plain = map
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const s of REG.spots) {
    assert.ok(plain.includes(s.name_he), `${s.id} is missing from the map`);
  }
  // ושמות שנגזמו לא נשארים מאחור
  for (const gone of ['פולג', 'קונטיקי', 'געש']) {
    if (!REG.spots.some(s => s.name_he.includes(gone))) {
      assert.ok(!plain.includes(gone), `${gone} was pruned from the registry but still appears on the map`);
    }
  }
});

test('every card expansion goes through setExpanded — so the model strip always loads', () => {
  // ⚠️ הבאג: `onChange` של "הוסף ספוט" הציב `state.expanded` ישירות ודילג
  // על `loadModels`. הכרטיס החדש נפתח אוטומטית ורצועת ההשוואה שלו נתקעה
  // על "טוען השוואה…" לנצח, כי `state.models[id]` נשאר undefined ואין שום
  // מסלול אחר שממלא אותו. שער מבני: אין השמה ישירה מחוץ לפונקציה האחת.
  const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');

  // (?!=) — אחרת גם `state.expanded === id` נספר כהשמה
  const assignments = [...app.matchAll(/state\.expanded\s*=(?!=)/g)];
  assert.equal(assignments.length, 1,
    'state.expanded may only be assigned inside setExpanded()');

  const fn = /function setExpanded\([\s\S]*?\n}/.exec(app);
  assert.ok(fn, 'setExpanded must exist');
  assert.match(fn[0], /state\.expanded\s*=/, 'the single assignment must be the one inside setExpanded');
  assert.match(fn[0], /loadModels\(/, 'setExpanded must be able to pull the model comparison');
});

test('the public URL lives in config.js only — three deploy targets must not drift apart', async () => {
  // ⚠️ הכתובת נצרכת ב-functions/ (user-agent מול השמ"ט), ב-worker/ (הקישור
  // בכל הודעת טלגרם) וב-public/ (קישורי שיתוף). שלושתם נפרסים בנפרד, ולכן
  // כתובת מוקשחת באחד מהם מתיישנת בשקט ומפנה אנשים לאתר שלא קיים.
  const { readdirSync, statSync } = await import('node:fs');
  const root = new URL('../', import.meta.url);

  const files = [];
  (function walk(rel) {
    for (const e of readdirSync(new URL(rel, root), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.claude') continue;
      const p = `${rel}${e.name}`;
      if (e.isDirectory()) walk(`${p}/`);
      else if (/\.(js|json|webmanifest|html)$/.test(e.name)) files.push(p);
    }
  })('');

  const offenders = [];
  for (const f of files) {
    // הבדיקות עצמן מעבירות siteUrl במפורש — זו בדיוק ההתנהגות שהן בודקות
    if (f.startsWith('test/') || f === 'public/js/config.js') continue;
    const src = readFileSync(new URL(f, root), 'utf8');
    if (/https:\/\/[a-z0-9-]+\.pages\.dev/.test(src)) offenders.push(f);
  }

  assert.deepEqual(offenders, [],
    'these files hardcode a pages.dev URL — import SITE_URL from config.js instead');
});

/* ===================== דיוק ואמון: מי מוביל בכרטיס =====================
   הרקע: ב-20/8/2026 הראה כרטיס אילת "13" בגופן של 38 פיקסלים בזמן
   שהאנמומטר שעל החוף מדד 16.9, בגופן של 19. שני המספרים היו נכונים —
   תחזית ECMWF לחלון 12:00–14:00 מול מדידה של 13:00 — אבל הכרטיס לא
   אמר איזה מהם איזה, והציג את **הפחות אמין בגדול**. הפער היה 3.7 קשר,
   מתחת לסף אי-ההסכמה, ולכן גם דגל לא נורה.

   ⚠️ ההכרעה כאן היא **תצוגתית בלבד**. חוק ברזל 5 נשאר במלואו: המדידה
   אינה מחליפה את פסק הדין, אינה משדרגת אותו, ואינה עוקפת שום שער.
   הבדיקה "חוק ברזל 5" בסעיף הזה היא זו שאוכפת את זה.                */

/** מדידה סינתטית. ברירת המחדל: תחנת מועדון ייצוגית, טרייה, מסכימה. */
function obsOf(over = {}) {
  return {
    speedKt: 20, gustKt: 24, dirDeg: 310, ageMin: 3,
    forecastAtObsKt: 17, tsMs: Date.UTC(2026, 7, 20, 10, 0),
    representative: true, source: 'club',
    stationName_he: 'מד הרוח של Surf Center — על חוף הקייט',
    distanceKm: 0.02, feed: { state: 'fresh' },
    ...over,
  };
}

/** 13:00 בשעון ישראל באוגוסט (IDT), בתוך חלון הגלישה של הספוט */
const NOON_IL = Date.UTC(2026, 7, 20, 10, 0);
/** 21:00 בשעון ישראל — אחרי סגירת החלון */
const NIGHT_IL = Date.UTC(2026, 7, 20, 18, 0);

/** ספוט ההובלה: תחנה ייצוגית ב-1.6 ק"מ, בלי עונה ובלי איסורים */
const LEAD_SPOT = () => spot('hadera');
const GREEN_FC = () => fc({ kt: 17, gust: 20, dir: 310 });

test('מדידה ייצוגית וטרייה היא המספר הגדול בכרטיס', () => {
  const v = scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf(), NOON_IL, {}, 0);
  assert.equal(v.lead, 'measured');
  assert.equal(v.measured.speedKt, 20);
  assert.equal(v.window.meanKt, 17, 'החלון עצמו לא זז — רק מי מוצג גדול');
});

test('תחנה שאינה מייצגת את החוף לעולם לא מובילה', () => {
  // תחנה אזורית שמונה קילומטרים פנימה אינה האמת על החוף, וגודל הגופן
  // אינו המקום להתווכח על כך. representative הוא נתון ברג'יסטר.
  const v = scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf({ representative: false }), NOON_IL, {}, 0);
  assert.equal(v.lead, 'forecast');
  assert.ok(v.measured, 'היא עדיין מוצגת — היא פשוט לא מובילה');
});

test('סף הטריות נגזר מקצב המקור, ונבדק משני צדיו', async () => {
  // ⚠️ סף אחיד נמדד ונפסל: השמ"ט מפרסם כל חצי שעה,
  // וב-20/8 הקריאות החיות היו בנות 28 ו-31 דקות באותו יום. סף
  // אחיד של 30 היה מחליף את פריסת הכרטיס הלוך וחזור בכל רענון.
  //
  // הנקודות נבנות מהקבועים עצמם, כך שבדיקה לא תאשר מחדש את החוזה של
  // עצמה אם מישהו ישנה אותם.
  const { OBS_LEAD_MAX_AGE_MIN, leadMaxAgeMin } = await import('../public/js/verdict/engine.js');
  assert.ok(OBS_LEAD_MAX_AGE_MIN.club < OBS_LEAD_MAX_AGE_MIN.default,
    'תחנה שמשדרת כל דקה חייבת לעמוד ברף גבוה יותר ממחזור חצי-שעתי');
  assert.equal(leadMaxAgeMin('ims'), OBS_LEAD_MAX_AGE_MIN.default);
  assert.equal(leadMaxAgeMin(null), OBS_LEAD_MAX_AGE_MIN.default, 'מקור לא ידוע מקבל את הסף השמרני');

  for (const src of ['club', 'ims']) {
    const cap = leadMaxAgeMin(src);
    const atLimit = scoreSpot(LEAD_SPOT(), GREEN_FC(),
      obsOf({ source: src, ageMin: cap }), NOON_IL, {}, 0);
    const past = scoreSpot(LEAD_SPOT(), GREEN_FC(),
      obsOf({ source: src, ageMin: cap + 1 }), NOON_IL, {}, 0);
    assert.equal(atLimit.lead, 'measured', src);
    assert.equal(past.lead, 'forecast', src);
  }

  // השמ"ט בן 28 דקות הוא המקרה שנמדד בפועל, והוא חייב לעבור
  const ims28 = scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf({ source: 'ims', ageMin: 28 }), NOON_IL, {}, 0);
  const club28 = scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf({ source: 'club', ageMin: 28 }), NOON_IL, {}, 0);
  assert.equal(ims28.lead, 'measured');
  assert.equal(club28.lead, 'forecast', 'מד רוח שמשדר כל דקה ושותק 28 — משהו תקוע בו');

  const noAge = scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf({ ageMin: null }), NOON_IL, {}, 0);
  assert.equal(noAge.lead, 'forecast', 'גיל חסר אינו גיל אפס');
});

test('מדידה בת אפס דקות היא "הרגע", לא "לפני 0 דק׳"', async () => {
  // נראה חי ב-20/8: התחזית נמשכה באותה דקה וכל 26 הכרטיסים
  // אמרו "נמשכה לפני 0 דק׳" — מספר שנקרא כשדה ריק.
  const { agoHe } = await import('../public/js/ui/card.js');
  assert.equal(agoHe(0), 'הרגע');
  assert.equal(agoHe(0.4), 'הרגע');
  assert.match(agoHe(3), /לפני <span class="num">3<\/span> דק׳/);
  assert.equal(agoHe(null), '', 'גיל חסר אינו אפס ואינו "הרגע"');
  assert.equal(agoHe(undefined), '');
});

test('בכרטיס אדום פסק הדין מוביל, לא המדידה', () => {
  // מספר מדוד גדול על כרטיס "לא ללכת" נקרא כעידוד — בדיוק כמו שכבת
  // התכנון ששותקת שם. הרוח הנמדדת חזקה, והתשובה עדיין "לא".
  const v = scoreSpot(LEAD_SPOT(), fc({ kt: 8, gust: 10, dir: 310 }),
    obsOf({ speedKt: 22, forecastAtObsKt: 8 }), NOON_IL, {}, 0);
  assert.equal(v.level, 'red');
  assert.equal(v.lead, 'forecast');
  assert.ok(v.flags.includes('obs_disagrees'), 'הפער עדיין מרים דגל');
});

test('כרטיס אסור וכרטיס בלי נתונים נושאים lead תמיד', () => {
  const blocked = scoreSpot(spot('tel-aviv'), GREEN_FC(), obsOf(),
    Date.UTC(2026, 6, 18, 8), {}, 0);
  assert.equal(blocked.lead, 'forecast');
  const unknown = scoreSpot(LEAD_SPOT(), { hours: [], ageMin: 5 }, obsOf(), NOON_IL, {}, 0);
  assert.equal(unknown.level, 'unknown');
  assert.equal(unknown.lead, 'forecast');
});

test('מחוץ לשעות הגלישה השאלה היא "מתי" — והחלון עונה עליה', () => {
  const day = scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf(), NOON_IL, {}, 0);
  const night = scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf(), NIGHT_IL, {}, 0);
  assert.equal(day.lead, 'measured');
  assert.equal(night.lead, 'forecast');
});

test('⚠️ חוק ברזל 5 — ההובלה אינה נוגעת בפסק הדין', () => {
  // הבדיקה המרכזית של השינוי הזה. שני פסקי דין שנבדלים אך ורק בתנאי
  // ההובלה חייבים להיות זהים בכל מה שנוגע לבטיחות: דרגה, ניקוד, דגלים
  // ורכיבים. אם מישהו יקשור אי פעם את leadSource לדירוג, המדידה תתחיל
  // לשדרג כרטיסים — וזה בדיוק מה שהחוק אוסר.
  const leads = scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf(), NOON_IL, {}, 0);
  const trails = scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf({ representative: false }), NOON_IL, {}, 0);

  assert.equal(leads.lead, 'measured');
  assert.equal(trails.lead, 'forecast');
  assert.equal(leads.level, trails.level);
  assert.equal(leads.score, trails.score);
  assert.deepEqual(leads.flags, trails.flags);
  assert.deepEqual(leads.components, trails.components);
  assert.equal(leads.reason.headline, trails.reason.headline,
    'גם הניסוח נגזר מהתחזית — הכותרת מתארת את פסק הדין, לא את האנמומטר');
});

test('רוח נמדדת חזקה אינה מעלה דרגה, גם כשהיא מובילה', () => {
  // הרוח החזויה גבולית, הנמדדת מצוינת. הכרטיס מציג את הנמדדת בגדול —
  // ונשאר צהוב, כי מה שיש לנו הוא עדיין חוסר ידיעה.
  const v = scoreSpot(LEAD_SPOT(), fc({ kt: 13, gust: 15, dir: 310 }),
    obsOf({ speedKt: 19, forecastAtObsKt: 16 }), NOON_IL, {}, 0);
  assert.equal(v.lead, 'measured');
  assert.equal(v.measured.speedKt, 19);
  assert.equal(v.level, 'yellow', 'ירוק היה מגיע רק מהתחזית, וזו לא השתנתה');
});

/* ---------------- מה הכרטיס באמת מרנדר ---------------- */

test('כשהמדידה מובילה — היא המספר הגדול, והתחזית יורדת לרצועה', async () => {
  // ⚠️ בדיקה על החישוב אינה בדיקה על מה שמצויר. v.lead יכול להיות
  // נכון בזמן שהתבנית מתעלמת ממנו לחלוטין.
  const { renderCard } = await import('../public/js/ui/card.js');
  const s = LEAD_SPOT();
  const v = scoreSpot(s, GREEN_FC(), obsOf(), NOON_IL, {}, 0);
  const html = renderCard(s, v, { model: 'ecmwf_ifs025' });

  const big = /<span class="kt num">(\d+)<\/span>/.exec(html);
  assert.ok(big, 'לכרטיס חייב להיות מספר גדול');
  assert.equal(+big[1], 20, 'המספר הגדול הוא המדידה');

  const strip = /<div class="measured is-forecast">[\s\S]*?<span class="m-kt num">(\d+)<\/span>/.exec(html);
  assert.ok(strip, 'התחזית יורדת לרצועה, ולא נעלמת');
  assert.equal(+strip[1], 17);
  assert.match(html, /<span class="m-age num" dir="ltr">\d\d:00–\d\d:00<\/span>/,
    'הרצועה נושאת את שעות החלון, ובעטיפת LTR');
});

test('כשהתחזית מובילה — הכרטיס נשאר כפי שהיה, עם תווית מקור', async () => {
  const { renderCard } = await import('../public/js/ui/card.js');
  const s = LEAD_SPOT();
  const v = scoreSpot(s, GREEN_FC(), obsOf({ representative: false }), NOON_IL, {}, 0);
  const html = renderCard(s, v, { model: 'ecmwf_ifs025' });

  const big = /<span class="kt num">(\d+)<\/span>/.exec(html);
  assert.equal(+big[1], 17, 'המספר הגדול הוא התחזית');
  assert.match(html, /<span class="src-kind">תחזית<\/span>/);
  assert.match(html, /<span dir="ltr">ECMWF<\/span>/,
    'המודל נאמר בשם — זו הבקשה: מה המקור לנתון');
  assert.doesNotMatch(html, /measured is-forecast/);
  assert.match(html, /<span class="m-kt num">20<\/span>/, 'המדידה ברצועה');
});

test('כל מספר בכרטיס נושא מקור וזמן', async () => {
  const { renderCard } = await import('../public/js/ui/card.js');
  const s = LEAD_SPOT();
  const v = scoreSpot(s, GREEN_FC(), obsOf(), NOON_IL, {}, 0);
  const html = renderCard(s, v, { model: 'ecmwf_ifs025' });

  assert.match(html, /<span class="src-kind">נמדד<\/span>/);
  assert.match(html, /<span dir="ltr">Surf Center<\/span>/,
    'שם התחנה מופיע על הכרטיס עצמו, כבלוק LTR אחד');
  assert.match(html, /<span dir="ltr">13:00<\/span>/,
    'שעת המדידה המוחלטת — "לפני 3 דק׳" לבדו נגזר משעון המכשיר');
  assert.match(html, /לפני <span class="num">3<\/span> דק׳/);
});

test('שם לטיני דו-מילי נשאר בלוק אחד — אחרת הוא מתהפך', async () => {
  // ⚠️ נראה בצילום חי (20/8): heText עטף כל מילה בנפרד, ושני
  // בלוקי LTR שנפגשים מעבר לרווח ניטרלי מתחלפים בסדר — בהסתייגות
  // של ריף רף הופיע "מד הרוח של Center Surf".
  const { heText } = await import('../public/js/ui/card.js');
  assert.equal(heText('מד הרוח של Surf Center — על החוף'),
    'מד הרוח של <span dir="ltr">Surf Center</span> — על החוף');
  assert.equal(heText('תחנת TEL AVIV COAST'),
    'תחנת <span dir="ltr">TEL AVIV COAST</span>');
  // הרווח נבלע רק בין תווים אלפאנומריים — מקף ונקודת סוף עוצרים אותו
  assert.equal(heText('הגיע מ-GFS בלבד'), 'הגיע מ-<span dir="ltr">GFS</span> בלבד');
  assert.equal(heText('IUI — אילת'), '<span dir="ltr">IUI</span> — אילת');
});

test('שעת מדידה חסרה אינה 1970 — ואינה אפס', async () => {
  // ⚠️ Number(null) הוא 0, לא NaN. חותמת זמן חסרה שעוברת דרך המרה
  // סתמית הופכת ל-1.1.1970, ומוצגת כשעה תמימה לגמרי.
  const { clockHe } = await import('../public/js/ui/card.js');
  assert.equal(clockHe(null), null);
  assert.equal(clockHe(undefined), null);
  assert.equal(clockHe(NaN), null);
  assert.equal(clockHe(Date.UTC(2026, 7, 20, 10, 0)), '13:00', 'שעון ישראל, לא UTC');
});

test('פאנל "מאיפה המספר" עונה על מי, מאיפה, מתי, ומה אמר המודל', async () => {
  const { renderSourcePanel } = await import('../public/js/ui/card.js');
  const s = LEAD_SPOT();
  const v = scoreSpot(s, GREEN_FC(), obsOf(), NOON_IL, {}, 0);
  const html = renderSourcePanel(s, v, { model: 'ecmwf_ifs025', grid: { distanceKm: 4.2 } });

  assert.match(html, /מאיפה המספר/);
  assert.match(html, /<span dir="ltr">Surf Center<\/span>/, 'מי מדד');
  assert.match(html, /20 מ׳ מהספוט/, 'מאיפה — 0.02 ק"מ נאמר במטרים');
  assert.match(html, /נמדד ב-<span dir="ltr">13:00<\/span>/, 'מתי בדיוק');
  assert.match(html, /ההזנה פעילה/, 'ומה מצב ההזנה');
  assert.match(html, /התחזית לאותה שעה: <span class="num">17<\/span> קשר/,
    'מול איזה מספר בדיוק נמדד הפער — לא מול המספר הגדול בכרטיס');
  assert.match(html, /<span dir="ltr">ECMWF<\/span>/);
  assert.match(html, /4\.2 ק״מ מהחוף/);
  assert.match(html, /נמשכה לפני <span class="num">5<\/span> דק׳/);
});

test('ספוט בלי מדידה חיה אומר זאת, ולא מייצר מקור יש מאין', async () => {
  const { renderSourcePanel } = await import('../public/js/ui/card.js');
  const s = LEAD_SPOT();
  const v = scoreSpot(s, GREEN_FC(), null, NOON_IL, {}, 0);
  const html = renderSourcePanel(s, v, { model: 'best_match', grid: { distanceKm: 3 } });
  assert.match(html, /אין מדידה חיה לספוט הזה/);
  assert.match(html, /<span dir="ltr">ICON<\/span>/, 'best_match נאמר בשם המודל שהוא באמת');
});

test('אנמומטר שעל החוף אינו "0 ק״מ מהחוף"', async () => {
  // ⚠️ באג שהיה חי באתר מ-19/8: n(0.02) הוא "0", ולכן ההסתייגות של
  // ריף רף, אילת צפון, קריית ים וקריית חיים אמרה "0 ק״מ מהחוף" —
  // מספר שנקרא כשדה חסר ולא כ-20 מטר, דווקא במקום שבו קרבת התחנה
  // היא כל הטענה. אותה משפחה של Number(null)===0: עיגול שמוחק את
  // המידע ומשאיר מספר שנראה תקין לגמרי.
  const { distHe, dec1 } = await import('../public/js/verdict/phrases.he.js');
  assert.equal(distHe(0.02), '20 מ׳');
  assert.equal(distHe(0.9), '900 מ׳');
  assert.equal(distHe(4.2), '4.2 ק״מ');
  assert.equal(distHe(11.6), '12 ק״מ', 'מעל עשרה — עשירית היא דיוק מדומה');
  assert.equal(distHe(null), null, 'מרחק חסר אינו אפס');
  assert.equal(distHe(undefined), null);

  assert.equal(dec1(3), '3', '"פער 3.0 קשר" נקרא כדיוק שאין לנו');
  assert.equal(dec1(3.7), '3.7');

  // וההסתייגות עצמה, מקצה לקצה
  const v = scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf(), NOON_IL, {}, 0);
  const line = v.reason.caveats.find(c => c.includes('נמדד ב'));
  assert.ok(line, 'ההסתייגות על המדידה חייבת להופיע');
  assert.ok(!/0 ק״מ/.test(line), `התחנה על החוף אינה במרחק אפס: ${line}`);
  assert.match(line, /20 מ׳ מהחוף/);
});

test('⚠️ הסתייגות הן טקסט, לא HTML — תגית בתוכן מודפסת למסך', async () => {
  // נראה בצילום חי (20/8): שני ערוצי הפלט של phrases.he.js אינם
  // שווים — buildDetail נכתב כ-HTML גולמי, אבל buildCaveats עובר דרך
  // heText() שמקודד כל תו. עטיפת span שנפלטה להסתייגות הופיעה
  // למשתמש כתגית גולמית על המסך, באמצע משפט בטיחות.
  const cases = [
    scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf(), NOON_IL, {}, 0),
    scoreSpot(LEAD_SPOT(), GREEN_FC(), obsOf({ distanceKm: 9.9, source: 'ims' }), NOON_IL, {}, 0),
    scoreSpot(spot('eilat-reef-raf'), fc({ kt: 18, dir: 0 }), obsOf({ dirDeg: 0 }), NOON_IL, {}, 0),
    scoreSpot(spot('bat-yam'), fc({ kt: 22, dir: 90 }), null, NOON_IL, {}, 0),
  ];
  for (const v of cases) {
    for (const c of v.reason.caveats) {
      assert.ok(!/[<>]/.test(c), `הסתייגות עם תגית: ${c}`);
    }
  }
});
