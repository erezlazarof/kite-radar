/* =========================================================================
   בדיקות "הוסף ספוט משלך" (שלב 6).  הרצה:  node --test test/
   -------------------------------------------------------------------------
   שתי משפחות של בדיקות כאן, ורק אחת מהן היא בדיקת רגרסיה:

   1. **פענוח והקלדה** — נוחות. נפילה כאן מעצבנת.
   2. **שדות הבטיחות והחוגה** — ליבת בטיחות. ספוט משתמש שמגיע לירוק,
      או חוגה שהרצועה האדומה שלה אינה מה שהמנוע קורא לו אופשור, שולחים
      מישהו לים על סמך מספר שאיש לא אימת.
   ========================================================================= */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseCoords, validateUserSpot, makeUserSpot, makeId, slugify, norm360,
  nearestStation, nearestCoreSpot, stationsFromRegistry, duplicateOf,
  encodeShare, decodeShare, shareUrl, issueBody,
  loadUserSpots, saveUserSpots, addUserSpot, removeUserSpot,
  ISRAEL_BBOX, MAX_STATION_KM, MAX_USER_SPOTS, LS_KEY,
} from '../public/js/userspots.js';
import { renderDial, dialSentence, bearingAt } from '../public/js/ui/dial.js';
import { directionClass } from '../public/js/verdict/bands.js';
import { scoreSpot } from '../public/js/verdict/engine.js';

const REG = JSON.parse(readFileSync(new URL('../public/data/spots.json', import.meta.url), 'utf8'));

/** תחזית סינתטית — אותה רוח בכל שעות היום */
function fc({ kt, gust = null, dir = 270, ageMin = 5 }) {
  return {
    hours: Array.from({ length: 24 }, (_, h) => ({
      tsMs: null, hour: h, dayIndex: 0, speedKt: kt, gustKt: gust ?? kt * 1.2, dirDeg: dir,
    })),
    ageMin,
  };
}

/** localStorage מינימלי — הבדיקות רצות ב-node בלי דפדפן */
function stubStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
  };
  return map;
}

/* ===================== פענוח קואורדינטות ===================== */

test('parseCoords — מה שאדם באמת מדביק', () => {
  const TA = { lat: 32.0853, lon: 34.7818 };
  const near = (got, exp) => {
    assert.ok(got, 'לא פוענח');
    assert.ok(Math.abs(got.lat - exp.lat) < 0.002, `lat ${got.lat}`);
    assert.ok(Math.abs(got.lon - exp.lon) < 0.002, `lon ${got.lon}`);
  };

  near(parseCoords('32.0853, 34.7818'), TA);
  near(parseCoords('32.0853,34.7818'), TA);
  near(parseCoords('  32.0853   34.7818  '), TA);
  near(parseCoords('https://www.google.com/maps/@32.0853,34.7818,15z'), TA);
  near(parseCoords('https://maps.google.com/?q=32.0853,34.7818'), TA);
  near(parseCoords('https://waze.com/ul?ll=32.0853,34.7818&navigate=yes'), TA);
  near(parseCoords(`32°05'07.1"N 34°46'54.5"E`), TA);
});

test('בקישור מקום של גוגל מנצחת הנקודה עצמה, לא מרכז התצוגה', () => {
  // @ הוא מרכז המסך ויכול להיות מאות מטרים מהמקום. !3d/!4d הם המקום.
  const url = 'https://www.google.com/maps/place/Beach/@32.2000,34.8000,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d32.0853!4d34.7818';
  const c = parseCoords(url);
  assert.ok(Math.abs(c.lat - 32.0853) < 0.001, `קיבלנו ${c.lat}`);
});

test('היפוך רוחב/אורך מתוקן — בישראל הוא ניתן לזיהוי ודאי', () => {
  const c = parseCoords('34.7818, 32.0853');
  assert.equal(c.swapped, true);
  assert.ok(Math.abs(c.lat - 32.0853) < 0.001);
  assert.ok(Math.abs(c.lon - 34.7818) < 0.001);
});

test('parseCoords מסרב למה שאינו נ.צ.', () => {
  assert.equal(parseCoords(''), null);
  assert.equal(parseCoords('בת ים'), null);
  assert.equal(parseCoords('https://example.com/page'), null);
  // ⚠️ שתי מעלות שלמות הן כמעט תמיד משהו אחר. רזולוציה של 100 ק"מ
  // שמתקבלת כנ"צ היא בדיוק סוג הטעות שהאפליקציה הזו לא אמורה לעשות.
  assert.equal(parseCoords('32 34'), null);
});

/* ===================== אימות ===================== */

test('נקודה מחוץ לישראל נדחית — לא אזהרה, סירוב', () => {
  const out = validateUserSpot({ name: 'קפריסין', lat: 34.9, lon: 33.3, shoreNormalDeg: 180 });
  assert.equal(out.ok, false);
  assert.match(out.errors.join(' '), /מחוץ לישראל/);
});

test('אימות דורש שם, נ.צ. וכיוון', () => {
  assert.equal(validateUserSpot({ name: '', lat: 32, lon: 34.8, shoreNormalDeg: 270 }).ok, false);
  assert.equal(validateUserSpot({ name: 'x', lat: null, lon: null, shoreNormalDeg: 270 }).ok, false);
  assert.equal(validateUserSpot({ name: 'x', lat: 32, lon: 34.8, shoreNormalDeg: NaN }).ok, false);
  assert.equal(validateUserSpot({ name: 'חוף שלי', lat: 32, lon: 34.8, shoreNormalDeg: 270 }).ok, true);
});

test('התיבה מכילה את כל הרג׳יסטר — סף שנקבע לפי הנתונים, לא לפי תחושה', () => {
  for (const s of REG.spots) {
    assert.ok(s.lat >= ISRAEL_BBOX.minLat && s.lat <= ISRAEL_BBOX.maxLat, `${s.id} lat`);
    assert.ok(s.lon >= ISRAEL_BBOX.minLon && s.lon <= ISRAEL_BBOX.maxLon, `${s.id} lon`);
  }
});

/* ===================== שדות הבטיחות ===================== */

test('ספוט שנוצר כאן לעולם אינו מגיע לירוק', () => {
  const s = makeUserSpot({ name: 'החוף שלי', lat: 32.02, lon: 34.74, shoreNormalDeg: 290 });
  assert.equal(s.source, 'user');
  assert.equal(s.status, 'user');
  // 18 קשר, צד-פנימה, משב חלק — ספוט ליבה היה כאן ירוק
  const v = scoreSpot(s, fc({ kt: 18, gust: 21, dir: 290 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.equal(v.level, 'yellow');
  assert.ok(v.flags.includes('unverified_spot'));
});

test('עריכה ידנית של localStorage לא מייצרת ספוט משתמש שמגיע לירוק', () => {
  // ⚠️ localStorage הוא קלט שהמשתמש שולט בו במלואו. אם אפשר להפוך שם
  // ספוט ל-source:"core", כל שרשרת הבטיחות של שלב 6 היא קישוט.
  stubStorage();
  const spot = makeUserSpot({ name: 'זיוף', lat: 32.02, lon: 34.74, shoreNormalDeg: 290 });
  localStorage.setItem(LS_KEY, JSON.stringify([{ ...spot, source: 'core', status: 'established', region: 'center' }]));

  const [loaded] = loadUserSpots();
  assert.equal(loaded.source, 'user');
  assert.equal(loaded.status, 'user');
  assert.equal(loaded.region, 'mine');
  const v = scoreSpot(loaded, fc({ kt: 18, gust: 21, dir: 290 }), null, Date.UTC(2026, 10, 18, 9), {});
  assert.notEqual(v.level, 'green');
});

test('רשומה פגומה ב-localStorage לא מפילה את המסך', () => {
  stubStorage();
  localStorage.setItem(LS_KEY, '{"not":"an array"}');
  assert.deepEqual(loadUserSpots(), []);
  localStorage.setItem(LS_KEY, 'לא JSON בכלל');
  assert.deepEqual(loadUserSpots(), []);
  localStorage.setItem(LS_KEY, JSON.stringify([null, {}, { id: 'x' }]));
  assert.deepEqual(loadUserSpots(), []);
});

test('הרשומה נושאת כל שדה שהמנוע והתצוגה נוגעים בו', () => {
  const s = makeUserSpot({ name: 'שלי', lat: 32.02, lon: 34.74, shoreNormalDeg: 290 });
  for (const k of ['direction_overrides', 'legal', 'hazards', 'sub_spots', 'sources', '_verify']) {
    assert.ok(Array.isArray(s[k]), `${k} חייב להיות מערך`);
  }
  for (const k of ['marine', 'models', 'live_stations']) {
    assert.equal(typeof s[k], 'object', `${k} חייב להיות אובייקט`);
  }
  assert.equal(s.season, null);
  assert.equal(s.daytime_window, null);
});

test('הוספה, מחיקה, ומזהה כפול', () => {
  stubStorage();
  const mk = i => makeUserSpot({ id: `u-t-${i}`, name: `ספוט ${i}`, lat: 32 + i / 1000, lon: 34.75, shoreNormalDeg: 270 });
  assert.equal(addUserSpot(mk(1)).ok, true);
  assert.equal(addUserSpot(mk(1)).ok, false, 'אותו מזהה פעמיים');
  assert.equal(loadUserSpots().length, 1);
  removeUserSpot('u-t-1');
  assert.equal(loadUserSpots().length, 0);
});

test('גבול הכמות נאכף — הספוט שמעבר לו נדחה, לא נבלע', () => {
  // ⚠️ בלי זה, ספוט מעבר לגבול היה מדווח כהצלחה בזמן ש-localStorage
  // זורק QuotaExceededError ו-saveUserSpots בולעת אותו בשקט.
  stubStorage();
  const mk = i => makeUserSpot({ id: `u-q-${i}`, name: `ספוט ${i}`, lat: 32 + i / 1000, lon: 34.75, shoreNormalDeg: 270 });
  for (let i = 0; i < MAX_USER_SPOTS; i++) {
    assert.equal(addUserSpot(mk(i)).ok, true, `ספוט ${i} מתוך ${MAX_USER_SPOTS} נדחה מוקדם מדי`);
  }
  assert.equal(loadUserSpots().length, MAX_USER_SPOTS);
  const over = addUserSpot(mk(MAX_USER_SPOTS));
  assert.equal(over.ok, false, 'הספוט שמעבר לגבול חייב להידחות');
  assert.match(over.error, new RegExp(String(MAX_USER_SPOTS)));
  assert.equal(loadUserSpots().length, MAX_USER_SPOTS, 'ולא להישמר בכל זאת');
});

test('מזהה ספוט משתמש נושא קידומת u- ולעולם לא מתנגש בליבה', () => {
  const ids = new Set(REG.spots.map(s => s.id));
  for (let i = 0; i < 50; i++) {
    const id = makeId('חוף בצת');
    assert.match(id, /^u-/);
    assert.ok(!ids.has(id));
  }
  assert.equal(slugify('  Bat  Yam! '), 'bat-yam');
});

/* ===================== התאמה לרג'יסטר ===================== */

test('תחנה נבחרת רק בטווח — הסף לא נמתח לספוט משתמש', () => {
  // תל ברוך: תחנת TEL AVIV COAST במרחק ~8 ק"מ ברג'יסטר
  const near = nearestStation(32.1265, 34.7853, REG.spots);
  assert.ok(near, 'אמורה להימצא תחנה');
  assert.ok(near.distance_km <= MAX_STATION_KM);

  // אמצע הנגב — אין שום תחנת חוף בטווח
  assert.equal(nearestStation(30.8, 34.9, REG.spots), null);
});

test('הסף הוא באמת 12 ק״מ — נבדק משני צדדיו, לא מול עצמו', () => {
  // ⚠️ הבדיקה שמעליה עוברת גם אם MAX_STATION_KM ישונה ל-90: היא רק
  // מאשרת מחדש את החוזה של הפונקציה. כאן נבנות שתי נקודות במרחק ידוע
  // מתחנה אמיתית, ממש משני צדי הסף.
  const st = stationsFromRegistry(REG.spots).find(x => x.ims === 'TEL AVIV COAST');
  assert.ok(st, 'התחנה חייבת להיות ברג׳יסטר');
  const KM_PER_DEG_LAT = 111.19;
  const at = km => ({ lat: st.lat + km / KM_PER_DEG_LAT, lon: st.lon });

  const inside = at(MAX_STATION_KM - 0.5);
  const outside = at(MAX_STATION_KM + 0.5);

  const hit = nearestStation(inside.lat, inside.lon, REG.spots);
  assert.ok(hit, `${MAX_STATION_KM - 0.5} ק״מ חייב להתקבל`);
  assert.ok(hit.distance_km <= MAX_STATION_KM);

  assert.equal(nearestStation(outside.lat, outside.lon, REG.spots), null,
    `${MAX_STATION_KM + 0.5} ק״מ חייב להידחות — התחנה כבר לא מייצגת את החוף`);
});

test('טבלת התחנות נגזרת מהרג׳יסטר ואין בה כפילויות', () => {
  const st = stationsFromRegistry(REG.spots);
  const names = st.map(s => s.ims);
  assert.equal(new Set(names).size, names.length);
  assert.ok(st.length >= 10, `נמצאו רק ${st.length} תחנות`);
  for (const s of st) assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lon));
});

test('הספוט המוכר הקרוב הוא הצעת כיוון סבירה', () => {
  const n = nearestCoreSpot(32.06, 34.76, REG.spots);
  assert.equal(n.spot.id, 'tel-aviv');
  assert.ok(n.km < 5);
});

test('זיהוי כפילות מונע ספוט שני על אותה נקודה', () => {
  const ta = REG.spots.find(s => s.id === 'tel-aviv');
  assert.equal(duplicateOf(ta.lat, ta.lon, REG.spots)?.id, 'tel-aviv');
  assert.equal(duplicateOf(32.5, 34.85, REG.spots), null);
});

/* ===================== שיתוף ===================== */

test('קידוד ופענוח — הלוך ושוב, כולל עברית', () => {
  const s = makeUserSpot({ name: 'החוף מול הקראוונים', lat: 31.9028, lon: 34.689, shoreNormalDeg: 278 });
  const r = decodeShare(encodeShare(s));
  assert.equal(r.ok, true);
  assert.equal(r.draft.name, 'החוף מול הקראוונים');
  assert.equal(r.draft.lat, 31.9028);
  assert.equal(r.draft.lon, 34.689);
  assert.equal(r.draft.shoreNormalDeg, 278);
});

test('המטען בקישור בטוח ל-URL — בלי +, / או =', () => {
  // ⚠️ הבדיקה חייבת קודם להוכיח שהפיקסצ׳ר שלה בכלל מייצר את התו הבעייתי.
  // עם שם שה-base64 הגולמי שלו ממילא נקי, הבדיקה עוברת גם אם ההמרה
  // ל-base64url תימחק כליל — וזה בדיוק מה שקרה כאן קודם.
  const names = ['בת ים', 'מכמורת', 'הבונים', 'שם עם רווחים ועברית', 'חוף הקראוונים'];
  const raw = n => btoa(String.fromCharCode(...new TextEncoder().encode(
    JSON.stringify({ v: 1, n, y: 32.5, x: 34.9, d: 300 }))));

  const dirty = names.filter(n => /[+/=]/.test(raw(n)));
  assert.ok(dirty.length > 0,
    'הפיקסצ׳ר חסר ערך אם אף שם לא מייצר +, / או = ב-base64 הגולמי');

  for (const n of names) {
    const enc = encodeShare(makeUserSpot({ name: n, lat: 32.5, lon: 34.9, shoreNormalDeg: 300 }));
    assert.doesNotMatch(enc, /[+/=]/, `${n} ייצר מטען לא בטוח ל-URL`);
    assert.equal(decodeShare(enc).draft.name, n, `${n} לא שרד הלוך ושוב`);
  }

  const s = makeUserSpot({ name: 'בת ים', lat: 32.5, lon: 34.9, shoreNormalDeg: 300 });
  assert.equal(shareUrl(s, 'https://x.dev/app#old'), `https://x.dev/app#addspot=${encodeShare(s)}`);
});

test('קישור בלי כיוון חוף נדחה — לא מקבל 0 מעלות בשקט', () => {
  // ⚠️ Number(null) הוא 0. קישור עם d חסר היה מייצר ניצב חוף של צפון,
  // עובר אימות, ומגיע למשתמש כנתון בטיחותי שאיש לא כתב.
  const enc = o => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const base = { v: 1, n: 'חוף', y: 32.0853, x: 34.7818 };

  for (const bad of [null, undefined, '', false, 'צפון', {}]) {
    const r = decodeShare(enc({ ...base, d: bad }));
    assert.equal(r.ok, false, `d=${JSON.stringify(bad)} התקבל כתקין`);
  }
  for (const bad of [null, '', false]) {
    assert.equal(decodeShare(enc({ ...base, y: bad })).ok, false, `y=${JSON.stringify(bad)} התקבל`);
    assert.equal(decodeShare(enc({ ...base, x: bad })).ok, false, `x=${JSON.stringify(bad)} התקבל`);
  }
  assert.equal(decodeShare(enc({ ...base, d: 0 })).ok, true, 'אפס מפורש הוא כיוון חוקי');
});

test('קישור פגום מוחזר כשגיאה ולא כחריגה', () => {
  for (const bad of ['', '!!!!', 'YWJj', btoa('{"v":9}').replace(/=+$/, '')]) {
    const r = decodeShare(bad);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  }
});

test('קישור עם נ.צ. מחוץ לישראל נדחה בפענוח, לא רק בטופס', () => {
  // ⚠️ הקישור מגיע מבחוץ. אימות רק ב-UI פירושו שמי שבנה קישור ביד
  // עוקף את הבדיקה כולה.
  const payload = { v: 1, n: 'זיוף', y: 48.85, x: 2.35, d: 180 };
  const enc = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const r = decodeShare(enc);
  assert.equal(r.ok, false);
  assert.match(r.error, /מחוץ לישראל/);
});

test('גוף ה-issue נושא את הצ׳ק-ליסט הבטיחותי, לא רק JSON', () => {
  const s = makeUserSpot({ name: 'מוצע', lat: 32.4, lon: 34.87, shoreNormalDeg: 285 });
  const body = issueBody(s, { nearCore: nearestCoreSpot(s.lat, s.lon, REG.spots), station: nearestStation(s.lat, s.lon, REG.spots) });
  assert.match(body, /shore_normal_deg/);
  assert.match(body, /- \[ \]/, 'חייב צ׳ק-ליסט');
  assert.match(body, /npm test/);
  assert.match(body, /"lat": 32\.4/);
});

/* ===================== החוגה ===================== */

test('הרצועה האדומה בחוגה היא בדיוק מה שהמנוע קורא לו רוח מהחוף החוצה', () => {
  // ⚠️ האינווריאנטה המרכזית של שלב 6. החוגה היא הדרך היחידה שבה אדם
  // בודק את `shore_normal_deg`, והוא בודק אותה לפי הצבעים. אם הרצועה
  // האדומה והמנוע יתפצלו, המשתמש יאשר כיוון שגוי מתוך תצוגה שנראית נכונה.
  for (let sn = 0; sn < 360; sn += 1) {
    const spot = { shore_normal_deg: sn, direction_overrides: [] };
    const s = dialSentence(sn);
    // הפְּנים **הפתוח** של הקשת. הקצה עצמו הוא בדיוק offAxis == 112,
    // שהמנוע מסווג כ-side_shore — וקצה של קו משורטט הוא ממילא פיקסל
    // אחד שאי אפשר לייחס לצד אחד. הגבול עצמו נצמד בנפרד, מיד אחרי.
    const inArc = (d, from, to) => {
      const span = ((to - from) % 360 + 360) % 360;
      const off = ((d - from) % 360 + 360) % 360;
      return off > 0 && off < span;
    };
    for (let wind = 0; wind < 360; wind += 3) {
      const cls = directionClass(wind, spot).cls;
      if (inArc(wind, s.dangerFrom, s.dangerTo)) {
        assert.ok(cls === 'offshore' || cls === 'side_offshore',
          `ניצב ${sn}, רוח ${wind}: החוגה אדומה אבל המנוע אומר ${cls}`);
      }
      if (inArc(wind, s.safeFrom, s.safeTo)) {
        assert.ok(cls === 'onshore' || cls === 'side_onshore',
          `ניצב ${sn}, רוח ${wind}: החוגה ירוקה אבל המנוע אומר ${cls}`);
      }
    }
  }
});

test('גבולות הרצועות בחוגה הם בדיוק הגבולות של המנוע', () => {
  // ⚠️ הבדיקה שלמעלה מוותרת על הקצה. זו נועלת אותו: מעלה אחת פנימה
  // ומעלה אחת החוצה חייבות ליפול משני צדי המעבר שהמנוע מגדיר.
  const sn = 270;
  const spot = { shore_normal_deg: sn, direction_overrides: [] };
  const s = dialSentence(sn);

  assert.equal(directionClass(s.dangerFrom, spot).cls, 'side_shore', 'הקצה עצמו עדיין רוח צד');
  assert.equal(directionClass(s.dangerFrom + 1, spot).cls, 'side_offshore', 'מעלה פנימה — כבר החוצה');
  assert.equal(directionClass(s.safeTo, spot).cls, 'side_onshore', 'הקצה עצמו עדיין מהים');
  assert.equal(directionClass(s.safeTo + 1, spot).cls, 'side_shore', 'מעלה החוצה — כבר צד');
  assert.equal(directionClass(s.landward, spot).cls, 'offshore', 'ההפך מהניצב הוא אופשור מלא');
  assert.equal(directionClass(s.seaward, spot).cls, 'onshore', 'הניצב עצמו הוא אונשור מלא');
});

test('bearingAt — מזרח הוא 90 גם בדף RTL', () => {
  // ⚠️ x של getBoundingClientRect גדל ימינה תמיד. היפוך כאן היה הופך
  // מזרח למערב בשקט, כלומר אופשור לאונשור.
  assert.equal(bearingAt(0, -10), 0);    // מעלה = צפון
  assert.equal(bearingAt(10, 0), 90);    // ימינה = מזרח
  assert.equal(bearingAt(0, 10), 180);   // מטה = דרום
  assert.equal(bearingAt(-10, 0), 270);  // שמאלה = מערב
});

test('החוגה לא משקפת — אין transform בפלט', () => {
  const svg = renderDial(278);
  assert.doesNotMatch(svg, /scaleX/);
  assert.doesNotMatch(svg, /transform/);
  assert.match(svg, /data-normal="278"/);
});

test('החוגה מציירת את ארבע הרוחות ואת החץ בכל כיוון', () => {
  for (const d of [0, 90, 180, 270, 359]) {
    const svg = renderDial(d);
    assert.match(svg, /dial-needle/);
    assert.match(svg, /dial-grip/);
    for (const he of ['צ', 'מז', 'ד', 'מע']) assert.ok(svg.includes(`>${he}<`), `חסר ${he} ב-${d}`);
    assert.doesNotMatch(svg, /NaN|undefined/);
  }
});

test('norm360 מקבל כל קלט ומחזיר 0..359', () => {
  assert.equal(norm360(-90), 270);
  assert.equal(norm360(360), 0);
  assert.equal(norm360(725), 5);
  assert.equal(norm360(278.4), 278);
});

/* ===================== שילוב עם האפליקציה ===================== */

test('ספוט משתמש נופל באזור נפרד ולא מעורבב בין החופים המאומתים', async () => {
  const { REGION_HE } = await import('../public/js/ui/card.js');
  const s = makeUserSpot({ name: 'שלי', lat: 32.02, lon: 34.74, shoreNormalDeg: 290 });
  assert.equal(s.region, 'mine');
  assert.equal(REGION_HE.mine, 'שלי');
  assert.ok(!REG.spots.some(x => x.region === 'mine'), 'הליבה לא נכנסת לאזור הזה');
});

test('פאנל ספוט משתמש מציע שיתוף, קידום ומחיקה — וספוט ליבה לא', async () => {
  const { renderUserSpotActions } = await import('../public/js/ui/card.js');
  const mine = makeUserSpot({ name: 'שלי', lat: 32.02, lon: 34.74, shoreNormalDeg: 290 });
  const html = renderUserSpotActions(mine);
  for (const a of ['share', 'propose', 'delete']) {
    assert.match(html, new RegExp(`data-user-action="${a}"`));
  }
  assert.equal(renderUserSpotActions(REG.spots[0]), '');
});

test('הרצועות שמצוירות בפועל נושאות את הצבע הנכון — נבדק על ה-SVG, לא על החישוב', () => {
  // ⚠️ הבדיקה הגדולה שמעלינו מאמתת את dialSentence — כלומר את המתמטיקה.
  // היא **לא נוגעת ב-renderDial**, ולכן החלפת שני ארגומנטי הצבע בקריאות
  // band() הייתה צובעת את קשת הסכנה בירוק ואת קשת הבטיחות באדום, וכל
  // הבדיקות היו ממשיכות לעבור. המשתמש בודק את ניצב החוף לפי הצבעים,
  // ולכן מה שנצבע הוא הליבה הבטיחותית — לא מה שחושב.
  const C = 50, R_BAND = 41;
  const bearingOf = (x, y) => ((Math.atan2(x - C, C - y) * 180 / Math.PI) + 360) % 360;

  const parseBands = svg => {
    const re = /<path d="M ([\d.+-]+) ([\d.+-]+) A [\d.]+ [\d.]+ 0 \d 1 ([\d.+-]+) ([\d.+-]+)"[^>]*var\((--cmp-[a-z]+)/g;
    const out = [];
    let m;
    while ((m = re.exec(svg)) !== null) {
      out.push({ token: m[5], from: bearingOf(+m[1], +m[2]), to: bearingOf(+m[3], +m[4]) });
    }
    return out;
  };

  const span = (from, to) => ((to - from) % 360 + 360) % 360;

  for (const sn of [0, 45, 90, 115, 180, 190, 270, 278, 290, 359]) {
    const spot = { shore_normal_deg: sn, direction_overrides: [] };
    const bands = parseBands(renderDial(sn));

    assert.equal(bands.length, 4, `ניצב ${sn}: ציפינו לארבע רצועות`);
    const danger = bands.filter(b => b.token === '--cmp-danger');
    const safe = bands.filter(b => b.token === '--cmp-safe');
    assert.equal(danger.length, 1, `ניצב ${sn}: חייבת להיות בדיוק רצועת סכנה אחת`);
    assert.equal(safe.length, 1, `ניצב ${sn}: חייבת להיות בדיוק רצועת בטיחות אחת`);

    // הקשתות נדגמות מבפנים, עם שוליים של מעלה — הקצה עצמו הוא גבול
    // המעבר, והנקודות ב-d מעוגלות לשתי ספרות.
    const sample = (b, expect, what) => {
      const w = span(b.from, b.to);
      assert.ok(w > 1, `ניצב ${sn}: רצועת ${what} ריקה`);
      // שוליים של 1.5°: קצה הקשת הוא **בדיוק** גבול הסיווג (offAxis 112),
      // ונקודות ה-d מעוגלות לשתי ספרות. הפְּנים הוא מה שנטען כאן; הקצה
      // עצמו נצמד למטה דרך רוחב הקשת.
      for (let t = 1.5; t < w - 1.5; t += 1) {
        const wind = (b.from + t) % 360;
        const cls = directionClass(wind, spot).cls;
        assert.ok(expect.includes(cls),
          `ניצב ${sn}: הרצועה הצבועה ${b.token} מכסה רוח ${Math.round(wind)}°, שהמנוע מסווג ${cls}`);
      }
    };

    sample(danger[0], ['offshore', 'side_offshore'], 'הסכנה');
    sample(safe[0], ['onshore', 'side_onshore'], 'הבטיחות');

    // ורוחב הקשתות אינו מקרי: הסכנה היא 2×(180−112), הבטיחות 2×67
    assert.ok(Math.abs(span(danger[0].from, danger[0].to) - 136) <= 2, `ניצב ${sn}: רוחב קשת הסכנה`);
    assert.ok(Math.abs(span(safe[0].from, safe[0].to) - 134) <= 2, `ניצב ${sn}: רוחב קשת הבטיחות`);
  }
});
