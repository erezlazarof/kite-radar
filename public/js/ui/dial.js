/* =========================================================================
   רדאר קייט — חוגת כיוון החוף
   -------------------------------------------------------------------------
   מודול טהור: בלי DOM, בלי fetch, בלי Date. מחזיר מחרוזת <svg> שלמה.
   שכבת האירועים יושבת ב-ui/addspot.js וקוראת ל-bearingAt.

   ⚠️ המספר שהחוגה הזו קובעת הוא **המספר היחיד באפליקציה שטעות בו
   מסוכנת ישירות.** `shore_normal_deg` שגוי ב-180° הופך רוח שגוררת גולש
   אל הים הפתוח לרוח שמחזירה אותו לחוף — ובביטחון מלא, עם מספר ירוק.

   ולכן החוגה אינה שדה קלט למעלות. היא מציירת את **התוצאה**: איזה רוחות
   יהיו אדומות בחוף הזה. אדם שהיה בחוף יודע לומר "מזרחית כאן מסוכנת"
   הרבה לפני שהוא יודע לומר "הניצב הוא 278 מעלות".

   ⚠️ אין כאן שום transform. הדף כולו dir="rtl", והפיתוי ליישר את החוגה
   לכיוון הקריאה הוא בדיוק מה שהופך מזרח למערב בשקט. הסיבוב אפוי בחשבון
   הקואורדינטות, כמו ב-compass.js.
   ========================================================================= */

const RAD = Math.PI / 180;
const VB = 100;
const C = VB / 2;

const R_RING = 46;
const R_BAND = 41;     // מרכז טבעת הרצועות
const W_BAND = 7;
const R_LAND = 33;     // חצי-דיסקת היבשה
const R_TICK_OUT = 46;
const R_TICK_IN = 42;
const R_LABEL = 36;
const R_ARROW = 30;    // חוד חץ הכיוון, מהמרכז החוצה אל הים

// גבולות זהים ל-directionClass ב-verdict/bands.js. אסור שיתפצלו.
const SAFE_HALF = 67;
const NEUTRAL_HALF = 112;

const norm360 = d => ((d % 360) + 360) % 360;
const r2 = n => Math.round(n * 100) / 100 + 0;

function pt(r, bearing) {
  const a = bearing * RAD;
  return [r2(C + r * Math.sin(a)), r2(C - r * Math.cos(a))];
}

function arcPath(r, from, to) {
  const span = norm360(to - from);
  if (span < 0.1) return '';
  if (span > 359.9) {
    const a = pt(r, from), b = pt(r, from + 180);
    return `M ${a[0]} ${a[1]} A ${r} ${r} 0 0 1 ${b[0]} ${b[1]} A ${r} ${r} 0 0 1 ${a[0]} ${a[1]}`;
  }
  const p1 = pt(r, from), p2 = pt(r, from + span);
  return `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${p2[0]} ${p2[1]}`;
}

/** גזרה מלאה מהמרכז — משמשת לחצי-דיסקת היבשה */
function sectorPath(r, from, to) {
  const arc = arcPath(r, from, to);
  return arc ? `M ${r2(C)} ${r2(C)} L${arc.slice(1)} Z` : '';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const paint = (v, fb) => ` style="color:var(${v}, ${fb})"`;

/* ---------------------------------------------------------------- */

/** ארבע הרוחות בעברית, בקיצור שנקרא על חוגה קטנה */
const CARDINALS = [
  { deg: 0,   he: 'צ'   },
  { deg: 90,  he: 'מז'  },
  { deg: 180, he: 'ד'   },
  { deg: 270, he: 'מע'  },
];

/**
 * המשפט שאדם יכול לאשר או להכחיש מהזיכרון.
 * מכוון: הוא מנוסח מנקודת המבט של הגולש בחוף, לא של הגיאומטריה.
 */
export function dialSentence(shoreNormalDeg) {
  const sn = norm360(shoreNormalDeg);
  const off = norm360(sn + 180);
  return {
    seaward: sn,
    landward: off,
    // הרוח שמחזירה לחוף באה מהים, כלומר מכיוון הניצב
    safeFrom: norm360(sn - SAFE_HALF),
    safeTo: norm360(sn + SAFE_HALF),
    dangerFrom: norm360(off - (180 - NEUTRAL_HALF)),
    dangerTo: norm360(off + (180 - NEUTRAL_HALF)),
  };
}

/**
 * האזימוט שנקודה על החוגה מייצגת.
 * מקבל קואורדינטות **יחסיות למרכז ה-SVG בפיקסלים של המסך**. אין כאן
 * היפוך RTL: ציר ה-x של getBoundingClientRect גדל ימינה תמיד, גם בדף
 * שכולו dir="rtl", ואזימוט מצפן הוא מוחלט.
 */
export function bearingAt(dx, dy) {
  const deg = Math.atan2(dx, -dy) / RAD;
  return norm360(Math.round(deg));
}

/**
 * @param {number} shoreNormalDeg  האזימוט מהחוף החוצה אל הים
 * @param {object} [opts]  { size=180, interactive=true, id='dial' }
 * @returns {string} SVG שלם
 */
export function renderDial(shoreNormalDeg, opts = {}) {
  const size = Number.isFinite(opts.size) ? opts.size : 180;
  const sn = norm360(Number(shoreNormalDeg) || 0);
  const land = norm360(sn + 180);
  const s = dialSentence(sn);

  const p = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="dial" viewBox="0 0 ${VB} ${VB}"` +
    ` width="${size}" height="${size}" role="img" data-normal="${sn}"` +
    ` aria-label="החוף פונה לכיוון ${sn} מעלות">` +
    `<title>החוף פונה לכיוון ${sn} מעלות</title>`
  );

  // ---- הים: הרקע כולו. היבשה מצוירת מעליו כחצי-דיסקה ----
  p.push(`<circle cx="${C}" cy="${C}" r="${R_RING}" class="dial-sea"${paint('--dial-sea', '#dceaf3')} fill="currentColor"/>`);

  // ---- היבשה: חצי-דיסקה בצד ההפוך לניצב ----
  p.push(`<path d="${sectorPath(R_LAND, land - 90, land + 90)}" class="dial-land"${paint('--dial-land', '#e6e1d5')} fill="currentColor"/>`);

  // ---- קו החוף עצמו: מיתר ניצב לכיוון הפנייה ----
  {
    const a = pt(R_LAND, land - 90), b = pt(R_LAND, land + 90);
    p.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="dial-shoreline"` +
           `${paint('--dial-shoreline', '#8a7f6a')} stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`);
  }

  // ---- רצועות הבטיחות. זו התשובה שהחוגה קיימת בשבילה ----
  const band = (from, to, varName, fb, label) =>
    `<path d="${arcPath(R_BAND, from, to)}" fill="none" stroke="currentColor" stroke-width="${W_BAND}"` +
    `${paint(varName, fb)} class="dial-band"><title>${esc(label)}</title></path>`;

  p.push(band(s.safeFrom, s.safeTo, '--cmp-safe', '#2e9e6b', 'רוח מהים — מחזירה לחוף'));
  p.push(band(s.safeTo, s.dangerFrom, '--cmp-neutral', '#c9a227', 'רוח צד'));
  p.push(band(s.dangerFrom, s.dangerTo, '--cmp-danger', '#d1495b', 'רוח מהחוף החוצה — מסוכן'));
  p.push(band(s.dangerTo, s.safeFrom, '--cmp-neutral', '#c9a227', 'רוח צד'));

  // ---- שנתות ותוויות רוחות ----
  for (let d = 0; d < 360; d += 30) {
    const a = pt(R_TICK_IN, d), b = pt(R_TICK_OUT, d);
    p.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="dial-tick"` +
           `${paint('--dial-tick', '#8296a6')} stroke="currentColor" stroke-width="${d % 90 === 0 ? 1.4 : 0.7}"/>`);
  }
  for (const c of CARDINALS) {
    const [x, y] = pt(R_LABEL, c.deg);
    p.push(`<text x="${x}" y="${y}" class="dial-cardinal" text-anchor="middle" dominant-baseline="central"` +
           ` font-size="7"${paint('--dial-label', '#5a6b78')} fill="currentColor">${c.he}</text>`);
  }

  // ---- חץ הכיוון: מהחוף החוצה אל הים ----
  {
    const tip = pt(R_ARROW, sn);
    const l = pt(R_ARROW - 8, sn - 7);
    const r = pt(R_ARROW - 8, sn + 7);
    const tail = pt(4, sn);
    p.push(`<line x1="${tail[0]}" y1="${tail[1]}" x2="${tip[0]}" y2="${tip[1]}" class="dial-needle"` +
           `${paint('--dial-needle', '#123')} stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`);
    p.push(`<path d="M ${tip[0]} ${tip[1]} L ${l[0]} ${l[1]} L ${r[0]} ${r[1]} Z" class="dial-needle"` +
           `${paint('--dial-needle', '#123')} fill="currentColor"/>`);
  }

  // ---- הידית שגוררים ----
  {
    const [hx, hy] = pt(R_BAND, sn);
    p.push(`<circle cx="${hx}" cy="${hy}" r="5.4" class="dial-grip"${paint('--dial-grip', '#123')}` +
           ` fill="currentColor" stroke="#fff" stroke-width="1.8"/>`);
  }

  p.push('</svg>');
  return p.join('');
}
