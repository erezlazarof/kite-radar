/* =========================================================================
   רדאר קייט — ספוטים שהמשתמש הוסיף
   -------------------------------------------------------------------------
   שלוש שכבות, אפס מסד נתונים:

   1. **מקומי** — הספוט חי ב-localStorage של הדפדפן. פרטי, מיידי, עובד
      אופליין, ולא עובר דרך שום שרת שלנו.
   2. **שיתוף** — סריאליזציה ל-base64url ב-hash של הכתובת. חבר שולח
      קישור בוואטסאפ, והספוט נוחת אצל השני **עם מסך אישור**, לא בשקט.
   3. **קידום לליבה** — כפתור שפותח issue מוכן בגיטהאב. ארז בודק ידנית
      ומדביק ל-spots.json. **גיט הוא מסד הנתונים, ושלב הבדיקה הוא
      הביקורת הבטיחותית.**

   ⚠️ למה הבדיקה הידנית אינה פורמליות:
   `shore_normal_deg` שגוי ב-90 מעלות הופך רוח אופשור — הרוח שגוררת
   גולש אל הים הפתוח — לרוח אונשור בטוחה למראה, ובביטחון מלא. זה המספר
   היחיד באפליקציה שטעות בו מזיקה ישירות. לכן ספוט משתמש **חסום על
   צהוב** במנוע (source: 'user') ולעולם אינו מגיע לירוק.

   מודול טהור מלבד ארבע פונקציות האחסון בסוף, שנוגעות ב-localStorage
   ומוגנות ב-try. שאר הקובץ נבדק ב-node בלי DOM.
   ========================================================================= */

import { haversineKm } from './sources/openmeteo.js';

export const LS_KEY = 'kite.userSpots';
export const SHARE_VERSION = 1;

/** התיבה שבתוכה האפליקציה יודעת לומר משהו. מחוץ לה — סירוב, לא ניחוש. */
export const ISRAEL_BBOX = { minLat: 29.3, maxLat: 33.4, minLon: 34.2, maxLon: 35.95 };

/** מעבר לזה, תחנת מדידה כבר לא מייצגת את החוף. אותו סף כמו ברג'יסטר. */
export const MAX_STATION_KM = 12;

export const MAX_NAME_LEN = 40;
export const MAX_USER_SPOTS = 20;

/* ---------------------------------------------------------------- */
/* פענוח קואורדינטות                                                 */
/* ---------------------------------------------------------------- */

const DEC = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

/**
 * מוציא נ.צ. ממה שאדם באמת מדביק: פלט "העתק קואורדינטות" של גוגל מפות,
 * קישור מפה מלא, קישור וייז, או שתי מעלות מופרדות ברווח.
 *
 * סדר הניסיונות אינו שרירותי. בקישור מקום של גוגל מופיעים גם `@lat,lon`
 * (מרכז התצוגה, שיכול להיות מאות מטרים משם) וגם `!3d…!4d…` (המקום עצמו).
 * המקום עצמו נבדק ראשון.
 */
export function parseCoords(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;

  // 1. קישור מקום של גוגל — הנקודה עצמה, לא מרכז התצוגה
  let m = new RegExp(String.raw`!3d(${DEC})!4d(${DEC})`).exec(s);
  if (m) return finishCoords(+m[1], +m[2]);

  // 2. פרמטרי שאילתה: ?q=  ?ll=  &center=  (גוגל, וייז, ומה שביניהם)
  m = new RegExp(String.raw`[?&#](?:q|ll|center|daddr|sll)=(${DEC})[,%2C\s]+(${DEC})`, 'i').exec(s);
  if (m) return finishCoords(+m[1], +m[2]);

  // 3. מרכז תצוגה של גוגל
  m = new RegExp(String.raw`@(${DEC}),(${DEC})`).exec(s);
  if (m) return finishCoords(+m[1], +m[2]);

  // 4. מעלות-דקות-שניות — מה שגוגל מציג בכרטיס המקום
  m = /(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.]+)\s*["″]?\s*([NSns])[\s,]+(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.]+)\s*["″]?\s*([EWew])/.exec(s);
  if (m) {
    const lat = dms(+m[1], +m[2], +m[3]) * (/[Ss]/.test(m[4]) ? -1 : 1);
    const lon = dms(+m[5], +m[6], +m[7]) * (/[Ww]/.test(m[8]) ? -1 : 1);
    return finishCoords(lat, lon);
  }

  // 5. שתי מעלות עשרוניות. נדרשת נקודה עשרונית באחת מהן לפחות —
  //    "32 34" הוא כמעט תמיד משהו אחר, ולא נ.צ. ברזולוציה של 100 ק"מ.
  m = new RegExp(String.raw`^(${DEC})[,;\s]+(${DEC})$`).exec(s);
  if (m && /\./.test(m[1] + m[2])) return finishCoords(+m[1], +m[2]);

  return null;
}

const dms = (d, mi, se) => d + mi / 60 + se / 3600;

/**
 * אחרי הפענוח נשארת שאלה אחת: מי מהשניים הוא הרוחב.
 * בישראל הרוחב תמיד קטן מהאורך (29–33 מול 34–36), ולכן היפוך —
 * הטעות הנפוצה ביותר בהדבקת נ.צ. — ניתן לזיהוי ודאי, ומתוקן בשקט.
 */
function finishCoords(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const inBox = (lat, lon) =>
    lat >= ISRAEL_BBOX.minLat && lat <= ISRAEL_BBOX.maxLat &&
    lon >= ISRAEL_BBOX.minLon && lon <= ISRAEL_BBOX.maxLon;
  if (!inBox(a, b) && inBox(b, a)) return { lat: round5(b), lon: round5(a), swapped: true };
  return { lat: round5(a), lon: round5(b), swapped: false };
}

const round5 = n => Math.round(n * 1e5) / 1e5;

export const norm360 = d => ((Math.round(d) % 360) + 360) % 360;

/* ---------------------------------------------------------------- */
/* בניית הרשומה ואימותה                                              */
/* ---------------------------------------------------------------- */

export function slugify(name) {
  const s = String(name ?? '').trim().toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  // שם עברי לא מייצר slug לטיני קריא, וזה בסדר: המזהה נועד להיות ייחודי,
  // לא קריא. הקידומת u- היא מה שמבטיח שהוא לעולם לא יתנגש בליבה.
  return s.slice(0, 24) || 'spot';
}

/** מזהה יציב-מספיק בלי שרת. הקידומת u- שמורה לספוטי משתמש. */
export function makeId(name, rand = Math.random) {
  return `u-${slugify(name)}-${Math.floor(rand() * 1e6).toString(36)}`;
}

/**
 * הרשומה המלאה. כל שדה שהרג'יסטר מכיר מופיע כאן, גם כשהוא ריק —
 * מנוע שמקבל אובייקט חלקי נשען על optional chaining בכל נקודה, ודי
 * במקום אחד שנשכח כדי שספוט משתמש יזרוק חריגה ויוריד את כל המסך.
 */
export function makeUserSpot({ id, name, lat, lon, shoreNormalDeg, station = null, addedAt = null }) {
  return {
    id: id || makeId(name),
    name_he: String(name).trim().slice(0, MAX_NAME_LEN),
    name_en: null,
    region: 'mine',
    lat: round5(lat),
    lon: round5(lon),
    shore_normal_deg: norm360(shoreNormalDeg),
    shore_normal_basis: null,
    direction_overrides: [],
    season: null,
    season_he: null,
    good_dirs_he: null,
    bad_dirs_he: null,
    daytime_window: null,
    legal: [],
    hazards: [],
    marine: { available: false, provider: null, lat: null, lon: null, confidence: 'none', note_he: null },
    live_stations: station || {},
    models: { force: [], exclude: [], reason_he: null },
    sub_spots: [],
    skill_floor: null,
    // ⚠️ שני השדות שמחזיקים את כלל הבטיחות. שינוי שלהם מוציא את הספוט
    // מהחסימה על צהוב. יש בדיקה שנכשלת אם הם משתנים.
    source: 'user',
    status: 'user',
    geo_confidence: 'user',
    notes_he: null,
    sources: [],
    _verify: ['shore_normal_deg', 'lat', 'lon'],
    added_at: addedAt ?? null,
  };
}

/**
 * אימות. מחזיר רשימת שגיאות בעברית — לא זורק, כי הקורא הוא טופס.
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateUserSpot(raw) {
  const errors = [];
  const fields = [];
  const warnings = [];
  const fail = (field, msg) => { fields.push(field); errors.push(msg); };

  // ⚠️ Number(null) הוא 0, לא NaN. בלי המרה מפורשת, שדה נ.צ. **ריק**
  // נקרא כנקודה (0,0) במפרץ גינאה — והמשתמש מקבל "הנקודה מחוץ לישראל"
  // על טופס שעוד לא נגע בו.
  const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));

  const name = String(raw?.name ?? '').trim();
  if (!name) fail('name', 'צריך שם לספוט.');
  else if (name.length > MAX_NAME_LEN) fail('name', `השם ארוך מדי — עד ${MAX_NAME_LEN} תווים.`);

  const lat = num(raw?.lat), lon = num(raw?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    fail('coords', 'צריך קואורדינטות.');
  } else if (lat < ISRAEL_BBOX.minLat || lat > ISRAEL_BBOX.maxLat ||
             lon < ISRAEL_BBOX.minLon || lon > ISRAEL_BBOX.maxLon) {
    // סירוב ולא אזהרה: מחוץ לישראל אין לנו מדידה חיה, אין לנו רישיון
    // נתונים, ואין לנו שום דרך לדעת שהמספר לא הוקלד הפוך.
    fail('coords', 'הנקודה מחוץ לישראל. בדוק את הקואורדינטות.');
  }

  const deg = num(raw?.shoreNormalDeg);
  if (!Number.isFinite(deg)) fail('deg', 'צריך לכוון את החוגה לכיוון שאליו החוף פונה.');

  return { ok: errors.length === 0, errors, fields, warnings };
}

/* ---------------------------------------------------------------- */
/* התאמה לרג'יסטר: תחנה חיה וספוט ייחוס                              */
/* ---------------------------------------------------------------- */

/**
 * כל תחנות השמ"ט שיש להן קואורדינטות ברג'יסטר, בלי כפילויות.
 * הרג'יסטר הוא גם טבלת התחנות שלנו — אין לנו קובץ תחנות נפרד, ואין
 * צורך בכזה כל עוד כל תחנה משרתת לפחות ספוט אחד.
 */
export function stationsFromRegistry(coreSpots) {
  const out = new Map();
  for (const s of coreSpots || []) {
    const l = s.live_stations || {};
    if (!l.ims || l.ims_lat == null || l.ims_lon == null) continue;
    if (!out.has(l.ims)) out.set(l.ims, { ims: l.ims, ims_num: l.ims_num ?? null, lat: l.ims_lat, lon: l.ims_lon });
  }
  return [...out.values()];
}

/**
 * התחנה הקרובה ביותר, אם היא בטווח.
 *
 * ספוט משתמש אינו כפוף לכלל הכניסה לרג'יסטר — הוא לעולם לא יגיע לירוק
 * ממילא — אבל כשיש תחנה בטווח, אין סיבה לוותר על "נמדד עכשיו".
 * מחוץ לטווח מוחזר null, והכרטיס יאמר שאין מדידה. לא נמתח את הסף.
 */
export function nearestStation(lat, lon, coreSpots, maxKm = MAX_STATION_KM) {
  let best = null;
  for (const st of stationsFromRegistry(coreSpots)) {
    const km = haversineKm(lat, lon, st.lat, st.lon);
    if (!best || km < best.distance_km) {
      best = { ims: st.ims, ims_num: st.ims_num, ims_lat: st.lat, ims_lon: st.lon,
               distance_km: Math.round(km * 10) / 10, isramar: null, meteotech: null,
               representative: false };
    }
  }
  return best && best.distance_km <= maxKm ? best : null;
}

/** הספוט המוכר הקרוב ביותר — מקור להצעת כיוון חוף, ולתחושת מרחק */
export function nearestCoreSpot(lat, lon, coreSpots) {
  let best = null;
  for (const s of coreSpots || []) {
    if (s.source === 'user') continue;
    const km = haversineKm(lat, lon, s.lat, s.lon);
    if (!best || km < best.km) best = { spot: s, km: Math.round(km * 10) / 10 };
  }
  return best;
}

/* ---------------------------------------------------------------- */
/* שיתוף — base64url ב-hash                                          */
/* ---------------------------------------------------------------- */

const b64urlEncode = bytes => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64urlDecode = str => {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * המטען קצר במכוון: שם, נ.צ., כיוון חוף. שום דבר אחר לא עובר בקישור —
 * לא מזהה, לא זמן הוספה, ולא תחנת מדידה. המקבל גוזר את התחנה מהרג'יסטר
 * *שלו*, כך שקישור ישן לא נושא איתו התאמה שהתיישנה.
 */
export function encodeShare(spot) {
  const payload = { v: SHARE_VERSION, n: spot.name_he, y: spot.lat, x: spot.lon, d: spot.shore_normal_deg };
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
}

/** @returns {{ok:true, draft:object}|{ok:false, error:string}} — לא זורק */
export function decodeShare(str) {
  let o;
  try {
    o = JSON.parse(new TextDecoder().decode(b64urlDecode(str)));
  } catch {
    return { ok: false, error: 'הקישור לא תקין.' };
  }
  if (!o || typeof o !== 'object') return { ok: false, error: 'הקישור לא תקין.' };
  if (o.v !== SHARE_VERSION) return { ok: false, error: 'הקישור נוצר בגרסה אחרת של האתר.' };

  // ⚠️ אותה מלכודת כמו בטופס, ומסוכנת יותר: `Number(null)` הוא 0, ולכן
  // קישור עם `d` חסר או ריק היה מייצר **ניצב חוף של 0° — צפון** בשקט,
  // ועובר את האימות. קישור מגיע מבחוץ; הוא לא זכאי לניחוש.
  const numOrNaN = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? NaN : Number(v));
  const draft = { name: String(o.n ?? ''), lat: numOrNaN(o.y), lon: numOrNaN(o.x), shoreNormalDeg: numOrNaN(o.d) };
  const check = validateUserSpot(draft);
  if (!check.ok) return { ok: false, error: check.errors[0] };
  return { ok: true, draft };
}

/** כתובת השיתוף המלאה. base הוא location.href בלי hash. */
export function shareUrl(spot, base) {
  return `${String(base).split('#')[0]}#addspot=${encodeShare(spot)}`;
}

/**
 * גוף ה-issue בגיטהאב. **הוא הטופס של הביקורת הבטיחותית**, ולכן הוא
 * נושא צ'ק-ליסט ולא רק JSON: מי שמדביק לרג'יסטר צריך לדעת מה נבדק.
 */
export function issueBody(spot, extra = {}) {
  // מזהה הרג'יסטר לטיני תמיד — 26 הספוטים הקיימים כולם כאלה, ומזהה
  // עברי היה נכנס גם ל-id של ה-HTML ולקישור העמוק. שם עברי לא מייצר
  // מזהה לטיני, ולכן נאמר במפורש שצריך לבחור אחד, במקום להמציא תעתיק.
  const derived = spot.id.replace(/^u-/, '').replace(/-[a-z0-9]+$/, '');
  const rec = {
    id: /^[a-z0-9-]+$/.test(derived) ? derived : 'TODO-latin-id',
    name_he: spot.name_he,
    region: extra.region || 'TODO',
    lat: spot.lat, lon: spot.lon,
    shore_normal_deg: spot.shore_normal_deg,
  };
  const near = extra.nearCore
    ? `${extra.nearCore.spot.name_he} (${extra.nearCore.km} ק"מ, ניצב ${extra.nearCore.spot.shore_normal_deg}°)`
    : 'לא נמצא';
  const station = extra.station
    ? `${extra.station.ims} — ${extra.station.distance_km} ק"מ`
    : 'אין תחנה בטווח 12 ק"מ';

  return [
    '## ספוט מוצע',
    '',
    '```json',
    JSON.stringify(rec, null, 2),
    '```',
    '',
    '| | |',
    '|---|---|',
    `| הספוט המוכר הקרוב | ${near} |`,
    `| תחנת מדידה | ${station} |`,
    '',
    '## לפני הדבקה ל-`spots.json`',
    '',
    "- [ ] נבחר `id` לטיני בסגנון שאר הרשומות הקיימות",
    '- [ ] `shore_normal_deg` אומת מול מפה — **המספר היחיד שטעות בו מסוכנת**',
    '- [ ] הנ.צ. נופל על החוף ולא על היבשה או על הים הפתוח',
    '- [ ] יש תחנת מדידה חיה בטווח 12 ק"מ, או מקור חי חלופי',
    '- [ ] נבדק אם יש הגבלה חוקית (חוף רחצה מוכרז, שמורה, אזור צבאי)',
    '- [ ] נוספו `hazards` ו-`season_he` אם רלוונטי',
    '- [ ] `npm test` עובר',
    '',
    '_נוצר מתוך "הוסף ספוט משלך" באתר._',
  ].join('\n');
}

/* ---------------------------------------------------------------- */
/* אחסון — החלק היחיד שאינו טהור                                     */
/* ---------------------------------------------------------------- */

export function loadUserSpots() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    // נתון ישן או פגום לא מפיל את המסך: מסננים מה שלא נראה כמו ספוט,
    // ומכריחים מחדש את שדות הבטיחות — כך שעריכה ידנית של localStorage
    // לא יכולה לייצר ספוט משתמש שמגיע לירוק.
    return arr
      .filter(s => s && typeof s === 'object' && s.id && s.lat != null && s.lon != null &&
                   s.shore_normal_deg != null)
      .map(s => ({ ...s, source: 'user', status: 'user', region: 'mine' }));
  } catch { return []; }
}

export function saveUserSpots(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

export function addUserSpot(spot) {
  const list = loadUserSpots();
  if (list.length >= MAX_USER_SPOTS) return { ok: false, error: `אפשר עד ${MAX_USER_SPOTS} ספוטים משלך.`, list };
  if (list.some(s => s.id === spot.id)) return { ok: false, error: 'הספוט כבר קיים.', list };
  const next = [...list, spot];
  saveUserSpots(next);
  return { ok: true, list: next };
}

export function removeUserSpot(id) {
  const next = loadUserSpots().filter(s => s.id !== id);
  saveUserSpots(next);
  return next;
}

/** האם כבר קיים ספוט — של המשתמש או של הליבה — באותה נקודה בערך */
export function duplicateOf(lat, lon, spots, withinKm = 0.4) {
  for (const s of spots || []) {
    if (haversineKm(lat, lon, s.lat, s.lon) <= withinKm) return s;
  }
  return null;
}
