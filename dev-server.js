/* =========================================================================
   שרת פיתוח מקומי — public/ + הרצת functions/ באותו handler בדיוק
   -------------------------------------------------------------------------
   הרצה:  node dev-server.js        →  http://127.0.0.1:3300

   קיים כדי שנוכל לבדוק את /api/obs בלי wrangler ובלי פריסה. הוא מייבא
   את onRequestGet *מהקובץ האמיתי* — לא עותק — ומספק לו את המעט ש-Workers
   נותנים ו-Node לא: caches.default. כך שמה שנבדק כאן הוא מה שירוץ בענן.
   ========================================================================= */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./public', import.meta.url));
const PORT = Number(process.env.PORT) || 3300;

/* ---- מטמון קצה מינימלי, עם אותה סמנטיקה שהפונקציה מסתמכת עליה ---- */
const store = new Map();
globalThis.caches = {
  default: {
    async match(req) {
      const hit = store.get(keyOf(req));
      if (!hit) return undefined;
      if (Date.now() > hit.expires) { store.delete(keyOf(req)); return undefined; }
      return new Response(hit.body, { headers: hit.headers });
    },
    async put(req, res) {
      const body = await res.clone().text();
      const cc = res.headers.get('cache-control') || '';
      const m = /s-maxage=(\d+)/.exec(cc) || /max-age=(\d+)/.exec(cc);
      store.set(keyOf(req), {
        body,
        headers: Object.fromEntries(res.headers),
        expires: Date.now() + (m ? Number(m[1]) : 60) * 1000,
      });
    },
  },
};
const keyOf = req => (typeof req === 'string' ? req : req.url);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
};

const routes = new Map();
routes.set('/api/obs', await import('./functions/api/obs.js'));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const mod = routes.get(url.pathname);
  if (mod) {
    const handler = req.method === 'OPTIONS' ? mod.onRequestOptions : mod.onRequestGet;
    if (!handler) return send(res, 405, 'method not allowed');
    try {
      const out = await handler({
        request: new Request(url.toString(), { method: req.method }),
        waitUntil: p => p?.catch?.(() => {}),
        env: process.env,
      });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
    } catch (err) {
      console.error('[function]', url.pathname, err);
      send(res, 500, JSON.stringify({ error: String(err?.message || err) }), 'application/json');
    }
    return;
  }

  // קבצים סטטיים. normalize חוסם ../ מחוץ ל-public
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (p === '' || p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, p);
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');

  try {
    const s = await stat(file);
    if (s.isDirectory()) return send(res, 404, 'not found');
    const buf = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(buf);
  } catch {
    send(res, 404, 'not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`רדאר קייט — http://127.0.0.1:${PORT}   (/api/obs חי)`);
});

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
}
