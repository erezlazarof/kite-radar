/* =========================================================================
   רדאר קייט — Service Worker
   -------------------------------------------------------------------------
   המקרה שבשבילו הוא קיים אינו "אין אינטרנט" אלא **קליטה גרועה על החוף**.
   מי שכבר בדרך לים רוצה שהאפליקציה תיפתח, ותגיד לו בכנות מה הגיל של מה
   שהיא מציגה — ולא שתישאר על מסך לבן.

   שלוש אסטרטגיות, לפי סוג המשאב:
   1. **שלד האפליקציה** (HTML/CSS/JS/אייקונים) — cache-first עם גרסה.
      הוא לא משתנה בין רענונים, וטעינה מהרשת שם היא רק המתנה.
   2. **הרג'יסטר** (spots.json) — stale-while-revalidate. מוצג מיד,
      מתעדכן ברקע.
   3. **מדידה ותחזית** — network-first, ונפילה למטמון רק כדי שיהיה
      *משהו*. ה-UI כבר יודע להציג גיל, ו-store.js מחזיק אחרון-תקין
      ב-localStorage. המטמון כאן הוא רשת ביטחון, לא מקור אמת.

   ⚠️ CACHE_V מוגדל בכל שחרור. בלי זה, משתמש שהתקין את האפליקציה
   ימשיך להריץ קוד ישן גם אחרי push — וזו תקלה שקשה לאבחן מרחוק.
   ========================================================================= */

const CACHE_V = 'kite-v4';
const SHELL = `${CACHE_V}-shell`;
const RUNTIME = `${CACHE_V}-runtime`;

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/app.js',
  './js/config.js',
  './js/store.js',
  './js/userspots.js',
  './js/sources/openmeteo.js',
  './js/sources/obs.js',
  './js/sources/ims-parse.js',
  './js/sources/obs-parse.js',
  './js/ui/addspot.js',
  './js/ui/card.js',
  './js/ui/dial.js',
  './js/ui/chart.js',
  './js/ui/compass.js',
  './js/ui/modelstrip.js',
  './js/ui/sparkline.js',
  './js/verdict/engine.js',
  './js/verdict/bands.js',
  './js/verdict/calendar.js',
  './js/verdict/phrases.he.js',
];

const REGISTRY = '/data/spots.json';
const OBS = '/api/obs';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll נכשל כולו אם קובץ אחד נופל. מוסיפים אחד-אחד כדי שקובץ
    // חסר לא ימנע התקנה בכלל — התקנה חלקית עדיפה על אין התקנה.
    await Promise.allSettled(SHELL_FILES.map(f => cache.add(new Request(f, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => !n.startsWith(CACHE_V)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // ניווט: תמיד להגיש את השלד. בלי זה, פתיחה בלי רשת נותנת מסך שגיאה
  // של הדפדפן במקום האפליקציה.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL, './index.html'));
    return;
  }

  if (!sameOrigin) {
    // Open-Meteo וכל מקור חיצוני — לא ממטמנים. תחזית ממטמון בלי
    // חותמת גיל היא בדיוק סוג השקר שהמוצר הזה נבנה לא לספר.
    return;
  }

  if (url.pathname.endsWith(REGISTRY)) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME));
    return;
  }

  if (url.pathname.endsWith(OBS)) {
    event.respondWith(networkFirst(req, RUNTIME));
    return;
  }

  event.respondWith(cacheFirst(req, SHELL));
});

/* ------------------------------------------------------------------ */

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
    return res;
  } catch (err) {
    return offlineResponse(req);
  }
}

async function networkFirst(req, cacheName, fallbackPath) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
    return res;
  } catch (err) {
    const cached = (await caches.match(req)) || (fallbackPath && (await caches.match(fallbackPath)));
    if (cached) return cached;
    return offlineResponse(req);
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cached = await caches.match(req);
  const network = fetch(req)
    .then(async res => {
      if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || offlineResponse(req);
}

/**
 * תשובת אופליין. עבור /api/obs היא JSON תקין עם feed שמצהיר על עצמו
 * כמנותק — כך שהלקוח מציג "מדידה חיה לא זמינה" במקום להיתקע על שגיאת
 * רשת, וזה גם מה שסעיף 10 ברישיון דורש כמנגנון גיבוי.
 */
function offlineResponse(req) {
  const url = new URL(req.url);
  if (url.pathname.endsWith(OBS)) {
    return new Response(JSON.stringify({
      ts: Date.now(), stations: {}, marine: {}, eilat: null,
      feed: { ims: { ok: false, state: 'down', ageMin: null, note_he: 'אין חיבור לרשת.' } },
      errors: [{ source: 'offline', message: 'no network' }],
      offline: true,
    }), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  return new Response('', { status: 503, statusText: 'offline' });
}
