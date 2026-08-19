/* =========================================================================
   GET /api/obs — שכבת המדידה החיה
   -------------------------------------------------------------------------
   הקוד היחיד בצד השרת באתר הציבורי, והוא קיים מסיבה אחת: אף אחד משלושת
   מקורות המדידה אינו נגיש מדפדפן. לשמ"ט ולאיסראמר אין כותרות CORS,
   ותחנת אילת מוגשת ב-HTTP רגיל — כלומר תוכן מעורב באתר HTTPS.

   שלושה עקרונות שמקודדים כאן:

   1. **בידוד כשלים.** Promise.allSettled ולעולם לא Promise.all. מקור מת
      אחד מסומן null ומדווח ב-errors, ושני האחרים ממשיכים להגיע.

   2. **מטמון קצה משותף.** s-maxage=600 + Cache API. קריאה אחת למקור
      לכל עשר דקות, גלובלית, לא משנה כמה מכשירים פתוחים. זה גם ניהול
      מכסה וגם נימוס כלפי שרת ציבורי.

   3. **ניטור הפסקות ומנגנון גיבוי.** סעיף 10 ברישיון השמ"ט מחייב, כתנאי
      לשימוש מתמשך, מנגנון שמזהה הפסקות בהזנה ומנגנון גיבוי כשנתון חסר
      או מאחר. זו התחייבות חוזית — ולכן היא קוד, ולא הערה. הפלט תמיד
      נושא feed.state, ו-stale-while-revalidate מגיש נתון אחרון-תקין
      **מסומן כישן** במקום כלום.
   ========================================================================= */

import { parseImsXml, feedHealth } from '../../public/js/sources/ims-parse.js';
import { parseIsramar, parseMeteoTechEilat, parseAwnDevice, parseSurfoXml } from '../../public/js/sources/obs-parse.js';
import { SITE_URL, UA_TOKEN } from '../../public/js/config.js';

const UA = `${UA_TOKEN} (+${SITE_URL}) personal non-commercial`;

const SOURCES = {
  ims: {
    url: 'https://ims.gov.il/sites/default/files/ims_data/xml_files/imslasthour.xml',
    // ה-CDN של השמ"ט מגיש max-age של שבועיים ומתעלם מ-cache-busting.
    // אנחנו לא נלחמים בזה — רק מודדים את הגיל ואומרים אותו.
    as: 'text',
  },
  isramar: {
    url: 'https://isramar.ocean.org.il/isramar2009/station/data/Hadera_Hs_Per.json',
    as: 'text',
  },
  eilat: {
    // ⚠️ היה HTTP במכוון, בהנחה שזה מה שהמקור מגיש. נמדד 19/8/2026:
    // השרת עונה גם ב-HTTPS, עם תעודה תקינה ואותו תוכן בדיוק. אין סיבה
    // למשוך נתון בטיחותי בערוץ פתוח כשהמקור מציע ערוץ סגור.
    //
    // מאז 19/8 זהו **הגיבוי** של אילת: המקור הראשי הוא מד הרוח של
    // Surf Center על ריף רף עצמו (ראה awn_eilat). obsForSpot בלקוח
    // נופל לכאן כשהראשי שותק.
    url: 'https://www.meteo-tech.co.il/eilat-yam/eilat_en.asp',
    as: 'latin1',
  },
  awn_eilat: {
    // מד הרוח של מועדון Surf Center — 21 מטר מנקודת ריף רף ברג'יסטר,
    // דגימה כל דקה. אומת פעמיים (19/8/2026) כאנמומטר אמיתי: ערכים
    // רגעיים קופצניים מול ממוצע-10-דקות חלק, ותחנה שנייה 45 מ' משם
    // שמחזירה ערכים קרובים-אך-שונים — שני ווידג'טים של תחזית היו זהים.
    // ⚠️ API לא מתועד של Ambient Weather; ללא מפתח וללא רישיון פורמלי.
    // המועדון מפרסם את התחנה מרצונו והקהילה מכירה אותה. ייחוס בפוטר.
    url: 'https://lightning.ambientweather.net/devices?public.slug=c63d4150e752e5c87196ff289433d26e',
    as: 'text',
  },
  surfo: {
    // מד הרוח של מועדון Surf Cycle (סורפו) — חוף זבולון, קריית ים.
    // XML כל דקה, כבר בקשר. אומת מול שתי תחנות שמ"ט באותה דקה.
    // ⚠️ שעון ישראל עם שעון קיץ — לא UTC+2 הקבוע של השמ"ט.
    url: 'https://surfo.co.il/wp-content/themes/vibes-child/inc/weather/data/windDirection.xml',
    as: 'text',
  },
};

const CLIENT_MAX_AGE = 120;
const EDGE_MAX_AGE = 600;
const SWR = 1800;
const FETCH_TIMEOUT_MS = 8000;

export async function onRequestGet(context) {
  const { request, waitUntil } = context;
  const cache = caches.default;
  const key = new Request(new URL('/api/obs', request.url).toString(), { method: 'GET' });

  const hit = await cache.match(key);
  if (hit) return withCors(hit);

  const now = Date.now();
  const names = Object.keys(SOURCES);
  const settled = await Promise.allSettled(names.map(n => fetchOne(SOURCES[n])));

  const body = {
    ts: now,
    stations: {},
    marine: {},
    eilat: null,
    // תחנות מועדונים — מפתח קבוע לכל תחנה, אליו מצביע הרג'יסטר
    clubs: {},
    feed: {},
    errors: [],
  };

  settled.forEach((res, i) => {
    const name = names[i];
    if (res.status !== 'fulfilled') {
      body.feed[name] = { ok: false, state: 'down', ageMin: null, note_he: 'המקור לא נענה.' };
      body.errors.push({ source: name, message: String(res.reason?.message || res.reason).slice(0, 200) });
      return;
    }
    try {
      applySource(name, res.value, body, now);
    } catch (err) {
      body.feed[name] = { ok: false, state: 'down', ageMin: null, note_he: 'המקור נענה בפורמט לא צפוי.' };
      body.errors.push({ source: name, message: String(err?.message || err).slice(0, 200) });
    }
  });

  const res = json(body, {
    'cache-control': `public, max-age=${CLIENT_MAX_AGE}, s-maxage=${EDGE_MAX_AGE}, stale-while-revalidate=${SWR}`,
  });
  waitUntil(cache.put(key, res.clone()));
  return res;
}

/* ------------------------------------------------------------------ */

function applySource(name, text, body, now) {
  if (name === 'ims') {
    const parsed = parseImsXml(text);
    const health = feedHealth(parsed, now);
    body.feed.ims = health;
    // הזנה מתה לא מוגשת כאילו היא חיה. הלקוח יראה feed.state ויציג
    // "אין מדידה", ולא מספר בן ארבע שעות בלי הקשר.
    if (health.state !== 'dead' && health.state !== 'down') {
      for (const [stn, s] of Object.entries(parsed.stations)) {
        body.stations[stn] = { ...s.latest, num: s.num };
      }
    }
    return;
  }

  if (name === 'isramar') {
    const w = parseIsramar(text);
    if (!w) {
      body.feed.isramar = { ok: false, state: 'down', ageMin: null, note_he: 'מצוף חדרה לא החזיר נתון קריא.' };
      return;
    }
    const ageMin = Math.max(0, Math.round((now - w.tsMs) / 60000));
    body.marine.hadera = w;
    body.feed.isramar = {
      ok: ageMin <= 240, state: ageMin <= 120 ? 'fresh' : ageMin <= 240 ? 'stale' : 'dead',
      ageMin, note_he: ageMin > 120 ? `מדידת הגלים בת ${ageMin} דקות.` : null,
    };
    return;
  }

  if (name === 'awn_eilat') {
    const w = parseAwnDevice(text);
    if (!w) {
      body.feed.awn_eilat = { ok: false, state: 'down', ageMin: null,
                             note_he: 'מד הרוח של Surf Center לא החזיר נתון קריא.' };
      return;
    }
    const ageMin = Math.max(0, Math.round((now - w.tsMs) / 60000));
    // קצב הדגימה דקה — סף הטריות בהתאם, הדוק מזה של השמ"ט
    body.feed.awn_eilat = {
      ok: ageMin <= 30, state: ageMin <= 10 ? 'fresh' : ageMin <= 30 ? 'stale' : 'dead',
      ageMin, note_he: ageMin > 10 ? `מד הרוח בריף רף מאחר ב-${ageMin} דקות.` : null,
    };
    // ⚠️ הקריאה מתפרסמת רק כשההזנה חיה — אותו שער כמו בענף השמ"ט.
    // ה-API של AWN ממשיך לענות גם כשהתחנה עצמה כבויה, עם lastData קפוא:
    // בלי השער, קריאה בת שש שעות הייתה גוברת על תחנת גיבוי חיה, כי
    // obsForSpot בלקוח בודק נוכחות מפתח. מקור מת מפנה את מקומו.
    if (body.feed.awn_eilat.state !== 'dead') body.clubs.eilat_surfcenter = w;
    return;
  }

  if (name === 'surfo') {
    const w = parseSurfoXml(text);
    if (!w) {
      body.feed.surfo = { ok: false, state: 'down', ageMin: null,
                          note_he: 'מד הרוח של סורפו לא החזיר נתון קריא.' };
      return;
    }
    const ageMin = Math.max(0, Math.round((now - w.tsMs) / 60000));
    body.feed.surfo = {
      ok: ageMin <= 30, state: ageMin <= 10 ? 'fresh' : ageMin <= 30 ? 'stale' : 'dead',
      ageMin, note_he: ageMin > 10 ? `מד הרוח בקריית ים מאחר ב-${ageMin} דקות.` : null,
    };
    // אותו שער כמו למעלה: וורדפרס ממשיך להגיש XML קפוא כשהתחנה מתה,
    // וקריאה מתה אסור לה לגבור על תחנת שמ"ט חיה.
    if (body.feed.surfo.state !== 'dead') body.clubs.surfo_kiryat_yam = w;
    return;
  }

  if (name === 'eilat') {
    const e = parseMeteoTechEilat(text, now);
    if (!e) {
      // גרידת HTML נשברת. זה מצב צפוי ולא חריג — נאמר, לא מוסתר.
      body.feed.eilat = { ok: false, state: 'down', ageMin: null,
                          note_he: 'תחנת אילת לא החזירה נתון קריא. באילת אין מקור מדידה חלופי.' };
      return;
    }
    const ageMin = Math.max(0, Math.round((now - e.tsMs) / 60000));
    body.eilat = e;
    body.feed.eilat = {
      ok: ageMin <= 90, state: ageMin <= 30 ? 'fresh' : ageMin <= 90 ? 'stale' : 'dead',
      ageMin, note_he: ageMin > 30 ? `תחנת אילת מאחרת ב-${ageMin} דקות.` : null,
    };
  }
}

async function fetchOne(src) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(src.url, {
      signal: ctl.signal,
      headers: { 'user-agent': UA, accept: '*/*' },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (src.as === 'latin1') {
      // הדף מקודד windows-1255. כל השדות שאנחנו קוראים הם ASCII, ולכן
      // latin1 — שלעולם אינו נכשל — שומר עליהם בדיוק. פענוח עברית כאן
      // היה תלוי בטבלת קידוד שאינה מובטחת בסביבת Workers.
      return new TextDecoder('iso-8859-1').decode(await r.arrayBuffer());
    }
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function json(obj, headers = {}) {
  return new Response(JSON.stringify(obj), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      ...headers,
    },
  });
}

function withCors(res) {
  const r = new Response(res.body, res);
  r.headers.set('access-control-allow-origin', '*');
  return r;
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-max-age': '86400',
    },
  });
}
