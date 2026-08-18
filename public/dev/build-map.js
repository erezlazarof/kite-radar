/* =========================================================================
   מחולל "המפה המלאה" — דף סקירה של הרג'יסטר
   -------------------------------------------------------------------------
   הרצה:  node public/dev/build-map.js
   פלט:   scratchpad/kite-map.html  (מתפרסם כארטיפקט)

   הדף נגזר מ-spots.json בלבד. אין כאן שום נתון מוקלד ידנית מלבד קו החוף.
   ========================================================================= */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REG = JSON.parse(readFileSync(join(HERE, '../data/spots.json'), 'utf8'));
const OUT = process.argv[2] || join(HERE, 'kite-map.html');

/* ---------- קו החוף: סכמטי אך במעלות אמיתיות ---------- */
const MED_COAST = [
  [33.090, 35.104], [33.055, 35.100], [33.005, 35.088], [32.960, 35.080],
  [32.920, 35.070], [32.870, 35.068], [32.833, 35.030], [32.826, 34.990],
  [32.780, 34.955], [32.700, 34.930], [32.620, 34.912], [32.510, 34.885],
  [32.470, 34.876], [32.400, 34.860], [32.330, 34.848], [32.270, 34.836],
  [32.200, 34.810], [32.163, 34.796], [32.110, 34.778], [32.077, 34.765],
  [32.017, 34.738], [31.960, 34.712], [31.930, 34.699], [31.870, 34.665],
  [31.815, 34.630], [31.740, 34.585], [31.680, 34.550], [31.610, 34.520],
  [31.545, 34.488],
];

const KINNERET = [
  [32.885, 35.588], [32.898, 35.622], [32.872, 35.652], [32.820, 35.663],
  [32.760, 35.645], [32.712, 35.602], [32.700, 35.560], [32.732, 35.530],
  [32.792, 35.522], [32.852, 35.548],
];

// ראש מפרץ אילת — החוף הישראלי בין גבול מצרים לגבול ירדן
const EILAT_SHORE = [
  [29.492, 34.900], [29.508, 34.912], [29.524, 34.925], [29.540, 34.940],
  [29.551, 34.955], [29.556, 34.972], [29.553, 34.990],
];

/* ---------- היטל ----------
   שני תשריטים ולא אחד. אילת רחוקה 200 ק"מ מזיקים, ומפה אחת שמכילה
   את שניהם היא שישים אחוז ים ריק. מפות ימיות אמיתיות פותרות את זה
   בתשריט צד, ולא בהקטנת הכל. */
function makeProj({ lat, lon, w, h, pad = 24 }) {
  const px = ([la, lo]) => [
    Math.round((pad + ((lo - lon[0]) / (lon[1] - lon[0])) * (w - pad * 2)) * 100) / 100,
    Math.round((pad + ((lat[1] - la) / (lat[1] - lat[0])) * (h - pad * 2)) * 100) / 100,
  ];
  const path = (pts, close = false) =>
    pts.map(px).map(([x, y], i) => (i ? `L${x},${y}` : `M${x},${y}`)).join(' ') + (close ? ' Z' : '');
  return { px, path, w, h, lat, lon };
}

const MAIN = makeProj({ lat: [31.45, 33.16], lon: [34.36, 35.78], w: 470, h: 660 });
const INSET = makeProj({ lat: [29.487, 29.575], lon: [34.888, 35.002], w: 240, h: 175, pad: 14 });
const px = MAIN.px, path = MAIN.path;
const W = MAIN.w, H = MAIN.h;
const LAT = MAIN.lat, LON = MAIN.lon;

/* ---------- נתונים ---------- */
const REGION_HE = { north: 'צפון', center: 'מרכז', south: 'דרום', kinneret: 'כנרת', eilat: 'אילת' };
const ORDER = ['north', 'center', 'south', 'kinneret', 'eilat'];
const SKILL_HE = { beginner: 'מתחילים', intermediate: 'בינוני', advanced: 'מתקדמים' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortName = s => s.name_he.replace(/^[^—]*—\s*/, '').trim() || s.name_he;

const spots = REG.spots;
const byRegion = ORDER.map(r => ({ r, items: spots.filter(s => s.region === r) })).filter(g => g.items.length);
const nEst = spots.filter(s => s.status === 'established').length;
const nBan = spots.filter(s => (s.legal || []).some(x => x.type === 'ban')).length;
const nNoWave = spots.filter(s => !s.marine?.available).length;

/* ---------- סימוני הספוטים ---------- */
const markerFor = (proj, scale = 1) => s => {
  const [x, y] = proj.px([s.lat, s.lon]);
  const est = s.status === 'established';
  // הזנב מצביע לכיוון הים — הוא הגיאומטריה שהמערכת מנקדת לפיה
  const a = (s.shore_normal_deg * Math.PI) / 180;
  const L = 13 * scale;
  const tx = x + Math.sin(a) * L, ty = y - Math.cos(a) * L;
  return `<g class="mk ${est ? 'mk-est' : 'mk-cand'}">
    <line x1="${x}" y1="${y}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}"/>
    <circle cx="${x}" cy="${y}" r="${((est ? 4.4 : 3.6) * scale).toFixed(1)}"/>
    <title>${esc(s.name_he)} — ניצב חוף ${s.shore_normal_deg}°</title>
  </g>`;
};
const NL = String.fromCharCode(10);
const markers = spots.filter(s => s.region !== 'eilat').map(markerFor(MAIN)).join(NL);
const markersEilat = spots.filter(s => s.region === 'eilat').map(markerFor(INSET, 1.15)).join(NL);

/* ---------- טבלאות ---------- */
const compass = deg => `<svg class="cmp" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.4"/><line x1="8" y1="8" x2="${(8 + Math.sin(deg * Math.PI / 180) * 6).toFixed(2)}" y2="${(8 - Math.cos(deg * Math.PI / 180) * 6).toFixed(2)}"/></svg>`;

const rows = g => g.items.map(s => {
  const bans = (s.legal || []).filter(x => x.type === 'ban').length;
  const other = (s.legal || []).filter(x => x.type !== 'ban' && x.type !== 'info').length;
  const tags = [
    s.status === 'candidate' ? '<i class="t t-cand">מועמד</i>' : '',
    bans ? '<i class="t t-ban">איסור</i>' : '',
    other ? '<i class="t t-zone">מגבלה</i>' : '',
    !s.marine?.available ? '<i class="t t-nowave">בלי גלים</i>' : '',
    (s.hazards || []).some(h => h.severity === 'high') ? '<i class="t t-haz">סכנה</i>' : '',
  ].filter(Boolean).join('');
  return `<tr>
    <th scope="row">${esc(shortName(s))}<em>${esc(s.name_en)}</em></th>
    <td class="n">${compass(s.shore_normal_deg)}<span dir="ltr">${s.shore_normal_deg}°</span></td>
    <td class="n" dir="ltr">${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}</td>
    <td>${SKILL_HE[s.skill_floor] || ''}</td>
    <td class="src">${esc(s.live_stations?.meteotech ? 'IUI אילת' : s.live_stations?.ims || '—')}</td>
    <td class="tags">${tags || '<i class="t t-ok">נקי</i>'}</td>
  </tr>`;
}).join('\n');

const tables = byRegion.map(g => `
<section class="reg">
  <h3>${REGION_HE[g.r]} <b>${g.items.length}</b></h3>
  <div class="scroll"><table>
    <thead><tr><th scope="col">חוף</th><th scope="col">ניצב</th><th scope="col">נ.צ.</th><th scope="col">רמה</th><th scope="col">תחנה חיה</th><th scope="col">סימונים</th></tr></thead>
    <tbody>${rows(g)}</tbody>
  </table></div>
</section>`).join('\n');

/* ---------- הדף ---------- */
const html = `<meta charset="utf-8">
<title>רדאר קייט — מפת הספוטים</title>
<style>
:root{
  color-scheme: light;
  --ink:#0e2130; --ink-2:#43606f; --ink-3:#7d95a2;
  --paper:#eef2f4; --plate:#ffffff; --rule:#d3dde2;
  --land:#e4ded0; --water:#cfe3ec;
  --signal:#d8511b; --go:#0f6f58; --slate:#8496a1;
  --shadow:0 1px 2px rgb(14 33 48/.06), 0 10px 30px -14px rgb(14 33 48/.22);
  --sans: "Heebo","Rubik","Noto Sans Hebrew",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;
  --mono: ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme: dark;
    --ink:#e3edf2; --ink-2:#9db2be; --ink-3:#6f8695;
    --paper:#081520; --plate:#0f2230; --rule:#1e3543;
    --land:#1c2831; --water:#0e2532;
    --signal:#ff7746; --go:#3fbf9c; --slate:#6d8492;
    --shadow:0 1px 2px rgb(0 0 0/.5), 0 12px 34px -16px rgb(0 0 0/.7);
  }
}
:root[data-theme="dark"]{
  color-scheme: dark;
  --ink:#e3edf2; --ink-2:#9db2be; --ink-3:#6f8695;
  --paper:#081520; --plate:#0f2230; --rule:#1e3543;
  --land:#1c2831; --water:#0e2532;
  --signal:#ff7746; --go:#3fbf9c; --slate:#6d8492;
  --shadow:0 1px 2px rgb(0 0 0/.5), 0 12px 34px -16px rgb(0 0 0/.7);
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:var(--sans); font-size:15px; line-height:1.55;
  direction:rtl; -webkit-font-smoothing:antialiased;
  font-variant-numeric:tabular-nums;
}
.wrap{max-width:1180px; margin:0 auto; padding:34px 20px 80px}

/* ---- כותרת ---- */
.head{display:flex; flex-wrap:wrap; align-items:flex-end; gap:20px 28px; margin-block-end:26px}
h1{
  margin:0; font-size:clamp(28px,4.6vw,46px); font-weight:800;
  letter-spacing:-.03em; line-height:1.05; text-wrap:balance;
}
h1 small{display:block; font-size:.38em; font-weight:600; letter-spacing:.02em; color:var(--ink-3); margin-block-start:8px}
.stats{display:flex; gap:22px; margin-inline-start:auto; flex-wrap:wrap}
.stat{display:flex; flex-direction:column; gap:1px}
.stat b{font-size:24px; font-weight:800; letter-spacing:-.02em}
.stat span{font-family:var(--mono); font-size:10px; letter-spacing:.11em; color:var(--ink-3)}

.lede{
  max-width:66ch; margin:0 0 30px; color:var(--ink-2); font-size:15.5px;
  padding-inline-start:14px; border-inline-start:3px solid var(--signal);
}

/* ---- לוח המפה ---- */
.plate{
  display:grid; grid-template-columns:minmax(0,1fr) minmax(230px,300px);
  gap:26px; align-items:start;
  background:var(--plate); border:1px solid var(--rule); border-radius:4px;
  padding:22px; box-shadow:var(--shadow); margin-block-end:34px;
}
@media(max-width:820px){ .plate{grid-template-columns:1fr} }
.map{width:100%; height:auto; display:block}
.sea{fill:var(--water)}
.land{fill:var(--land); stroke:var(--ink-3); stroke-width:.7; stroke-opacity:.5}
.lake{fill:var(--water); stroke:var(--ink-3); stroke-width:.7; stroke-opacity:.5}
.grat{stroke:var(--ink-3); stroke-opacity:.16; stroke-width:.6; fill:none}
.grat-t{fill:var(--ink-3); font-family:var(--mono); font-size:8px; opacity:.6}
.mk line{stroke-width:1.5; stroke-linecap:round}
.mk-est circle{fill:var(--signal); stroke:var(--plate); stroke-width:1.2}
.mk-est line{stroke:var(--signal); stroke-opacity:.75}
.mk-cand circle{fill:none; stroke:var(--slate); stroke-width:1.5; stroke-dasharray:2.2 1.8}
.mk-cand line{stroke:var(--slate); stroke-opacity:.5}
.rlabel{fill:var(--ink-3); font-family:var(--mono); font-size:10px; letter-spacing:.16em}

.key{display:flex; flex-direction:column; gap:20px}
.inset{margin:0; display:flex; flex-direction:column; gap:7px}
.inset svg{width:100%; height:auto; display:block;
           border:1px solid var(--rule); border-radius:3px}
.inset figcaption{font-family:var(--mono); font-size:10px; letter-spacing:.06em; color:var(--ink-3)}
.key h2{margin:0; font-size:13px; font-family:var(--mono); letter-spacing:.14em; color:var(--ink-3); font-weight:600}
.klist{display:flex; flex-direction:column; gap:11px; margin:0; padding:0; list-style:none}
.klist li{display:flex; gap:11px; align-items:flex-start; font-size:13.5px; color:var(--ink-2)}
.klist b{color:var(--ink); font-weight:700}
.swatch{inline-size:15px; block-size:15px; flex:0 0 auto; margin-block-start:3px; border-radius:50%}
.sw-est{background:var(--signal)}
.sw-cand{border:1.5px dashed var(--slate)}
.sw-tail{background:none; border-block-end:2px solid var(--signal); border-radius:0; block-size:8px}

/* ---- טבלאות ---- */
.reg{margin-block-end:30px}
.reg h3{
  display:flex; align-items:baseline; gap:9px; margin:0 0 9px;
  font-size:12px; font-family:var(--mono); letter-spacing:.16em; color:var(--ink-3); font-weight:600;
}
.reg h3 b{font-family:var(--sans); font-size:17px; color:var(--ink); letter-spacing:-.01em}
.scroll{overflow-x:auto; border:1px solid var(--rule); border-radius:3px; background:var(--plate)}
table{width:100%; border-collapse:collapse; font-size:13.5px}
thead th{
  text-align:start; padding:9px 12px; font-family:var(--mono); font-size:10px;
  letter-spacing:.1em; color:var(--ink-3); font-weight:600; white-space:nowrap;
  border-block-end:1px solid var(--rule);
}
tbody th{text-align:start; padding:10px 12px; font-weight:700; white-space:nowrap}
tbody th em{display:block; font-style:normal; font-family:var(--mono); font-size:10px; color:var(--ink-3); letter-spacing:.02em; font-weight:400}
td{padding:10px 12px; color:var(--ink-2); vertical-align:middle; white-space:nowrap}
tbody tr + tr th, tbody tr + tr td{border-block-start:1px solid var(--rule)}
td.n{font-family:var(--mono); font-size:12px}
td.n .cmp{inline-size:16px; block-size:16px; vertical-align:-3px; margin-inline-end:5px}
.cmp circle{fill:none; stroke:var(--rule); stroke-width:1.2}
.cmp line{stroke:var(--signal); stroke-width:1.8; stroke-linecap:round}
td.src{font-family:var(--mono); font-size:10.5px; letter-spacing:.03em}
.tags{display:flex; flex-wrap:wrap; gap:4px; white-space:normal; min-inline-size:130px}
.t{
  font-style:normal; font-size:10.5px; font-weight:700; padding:2px 7px;
  border-radius:2px; white-space:nowrap;
}
.t-cand{background:color-mix(in srgb,var(--slate) 16%,transparent); color:var(--slate); border:1px dashed color-mix(in srgb,var(--slate) 45%,transparent)}
.t-ban{background:color-mix(in srgb,var(--signal) 15%,transparent); color:var(--signal)}
.t-zone{background:color-mix(in srgb,var(--ink-2) 12%,transparent); color:var(--ink-2)}
.t-nowave{background:color-mix(in srgb,var(--ink-3) 12%,transparent); color:var(--ink-3)}
.t-haz{background:color-mix(in srgb,var(--signal) 10%,transparent); color:var(--signal); border:1px solid color-mix(in srgb,var(--signal) 35%,transparent)}
.t-ok{background:color-mix(in srgb,var(--go) 13%,transparent); color:var(--go)}

.foot{margin-block-start:40px; padding-block-start:20px; border-block-start:1px solid var(--rule);
      color:var(--ink-3); font-size:12.5px; max-width:70ch}
.foot b{color:var(--ink-2)}
</style>

<div class="wrap">

  <header class="head">
    <h1>מפת הספוטים<small>רדאר קייט — הרג׳יסטר המלא, ${REG.updated}</small></h1>
    <div class="stats">
      <div class="stat"><b>${spots.length}</b><span>SPOTS</span></div>
      <div class="stat"><b>${nEst}</b><span>מבוססים</span></div>
      <div class="stat"><b>${spots.length - nEst}</b><span>מועמדים</span></div>
      <div class="stat"><b>${nBan}</b><span>עם איסור</span></div>
    </div>
  </header>

  <p class="lede">
    כל חוף כאן נושא <b>ניצב חוף</b> — האזימוט מהחוף החוצה לים. זה המספר שקובע
    אם רוח נתונה מחזירה אותך לחוף או דוחפת אותך ממנו, והוא הדבר היחיד ברג׳יסטר
    שטעות בו הופכת פסק דין בטוח למסוכן. הזנב על כל סימון במפה מצביע לכיוון הים.
  </p>

  <div class="plate">
    <svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="מפת ספוטי הקייט בישראל, חוף הים התיכון והכנרת">
      <rect class="sea" x="0" y="0" width="${W}" height="${H}"/>
      <g class="grat">
        ${[32, 33].map(la => { const [, y] = px([la, LON[0]]); return `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`; }).join('')}
        ${[34.5, 35.0, 35.5].map(lo => { const [x] = px([LAT[0], lo]); return `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`; }).join('')}
      </g>
      ${[32, 33].map(la => { const [, y] = px([la, LON[0]]); return `<text class="grat-t" x="7" y="${y - 5}">${la}°N</text>`; }).join('')}

      <path class="land" d="${path(MED_COAST.filter(pt => pt[0] >= LAT[0] - 0.1))} L${px([31.45, 35.78])[0]},${px([31.45, 35.78])[1]} L${px([33.16, 35.78])[0]},${px([33.16, 35.78])[1]} Z"/>
      <path class="lake" d="${path(KINNERET, true)}"/>

      <text class="rlabel" x="${px([32.92, 35.30])[0]}" y="${px([32.92, 35.30])[1]}">צפון</text>
      <text class="rlabel" x="${px([32.22, 35.30])[0]}" y="${px([32.22, 35.30])[1]}">מרכז</text>
      <text class="rlabel" x="${px([31.70, 35.30])[0]}" y="${px([31.70, 35.30])[1]}">דרום</text>
      <text class="rlabel" x="${px([32.66, 35.60])[0]}" y="${px([32.66, 35.60])[1]}">כנרת</text>

      ${markers}
    </svg>

    <div class="key">
      <figure class="inset">
        <svg viewBox="0 0 ${INSET.w} ${INSET.h}" role="img" aria-label="תשריט ראש מפרץ אילת">
          <rect class="sea" x="0" y="0" width="${INSET.w}" height="${INSET.h}"/>
          <path class="land" d="${INSET.path(EILAT_SHORE)} L${INSET.px([29.575, 35.002])[0]},${INSET.px([29.575, 35.002])[1]} L${INSET.px([29.575, 34.888])[0]},${INSET.px([29.575, 34.888])[1]} Z"/>
          ${markersEilat}
        </svg>
        <figcaption>ראש מפרץ אילת · קנה מידה נפרד</figcaption>
      </figure>

      <h2>מקרא</h2>
      <ul class="klist">
        <li><span class="swatch sw-est"></span><div><b>ספוט מבוסס</b> — יש עדות שגולשים בו בפועל.</div></li>
        <li><span class="swatch sw-cand"></span><div><b>מועמד</b> — מופיע ברשימות תחזית, בלי עדות שמישהו גולש שם. מוצג באפליקציה עם תג, ולא מגיע לדירוג ירוק.</div></li>
        <li><span class="swatch sw-tail"></span><div><b>הזנב</b> מצביע לכיוון הים — ניצב החוף.</div></li>
      </ul>

      <h2>מה שאין</h2>
      <ul class="klist">
        <li><div><b>ים המלח</b> — נבדק ואינו ספוט. צפיפות המים הופכת את זה לבלתי מעשי.</div></li>
        <li><div><b>${nNoWave} ספוטים בלי נתוני גלים</b> — הכנרת ואילת. אף מודל גלים לא מכסה אותם, וזה נאמר במפורש במקום להמציא מספר.</div></li>
        <li><div><b>חופי כנרת מלבד דיאמונד ובטיחה</b> — עין גב וצמח נכללים כמועמדים בלבד; לא נמצאה עדות לגלישת קייט בהם.</div></li>
      </ul>
    </div>
  </div>

  ${tables}

  <p class="foot">
    <b>סימון "איסור"</b> הוא חסימה חוקית ולא מזג אוויר — תל אביב אוסרת קייט ביולי–אוגוסט
    ובסופי שבוע בעונות המעבר, והרצליה אוסרת קייט בחוף הגולשים המוכרז שלה כל השנה.
    באפליקציה זה מצב ויזואלי נפרד מ״לא ללכת״, כי אסור אינו מסוכן, וערבוב השניים
    מלמד להתעלם מאדום.
    <br><br>
    <b>הניצבים נגזרו</b> משתי נקודות עיגון על קו החוף במרחק קילומטרים, והוצלבו מול
    הכיוונים שמקורות הקייט הישראליים מתארים כעובדים או כמסוכנים. כל ניצב שלא סווג
    ברמת ודאות גבוהה מסומן לאימות בתוך הרג׳יסטר.
  </p>

</div>
`;

writeFileSync(OUT, html, 'utf8');
console.log('wrote', OUT, html.length, 'bytes ·', spots.length, 'spots');
