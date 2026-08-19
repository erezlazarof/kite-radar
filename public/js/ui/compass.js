/* =========================================================================
   רדאר קייט — חוגת המצפן של כרטיס הספוט
   -------------------------------------------------------------------------
   מודול טהור: בלי DOM, בלי fetch, בלי Date. מחזיר מחרוזת <svg> שלמה.

   השאלה שהחוגה עונה עליה בלי מילים, בפחות משנייה:
   הרוח מחזירה אותי לחוף · מלווה את החוף · או דוחפת אותי אל הים הפתוח.

   קונבנציות — מיובאות כלשונן מ-verdict/bands.js, לא נגזרות כאן מחדש:
     windFromDeg      — מטאורולוגי: האזימוט שממנו הרוח *באה*.
     shore_normal_deg — האזימוט מהחוף *החוצה* אל הים הפתוח.
     offAxisDeg       — 0° = ישר מהים (אונשור, חזרה בטוחה)
                        180° = ישר מהיבשה (אופשור, מסוכן)
     רצועות: ≤22 onshore · ≤67 side_onshore · ≤112 side_shore ·
             ≤157 side_offshore · >157 offshore

   ⚠️ אסור לשקף — לא scaleX(-1), לא transform של mirror, ולא ברמת ה-CSS.
   הדף כולו dir="rtl" ולכן הפיתוי הוא "ליישר את החוגה לכיוון הקריאה".
   אזימוט מצפן הוא מוחלט: שיקוף היה הופך מזרח למערב בשקט בכל כרטיס במסך,
   כלומר מציג רוח אופשור מסוכנת כרוח אונשור בטוחה. הסיבוב אפוי כולו בחשבון
   הקואורדינטות (הפונקציה pt), ואין בקובץ הזה שום transform.
   ========================================================================= */

import { directionClass, inArc, compassHe, DIR_CLASS_HE } from '../verdict/bands.js';

const RAD = Math.PI / 180;
const VB = 52;      // מערכת קואורדינטות פנימית קבועה; opts.size רק מותח אותה
const C = VB / 2;   // מרכז החוגה

// רדיוסים ביחידות ה-viewBox, מבחוץ פנימה.
const R_TICK_OUT  = 24.4;
const R_TICK_IN   = 22.6;
const R_TICK_IN_N = 21.2;   // השנת של צפון ארוכה יותר
const R_RING      = 21.6;
const R_BAND      = 18.8;   // מרכז טבעת הרצועות
const W_BAND      = 4.6;    // עובי הרצועה → 16.5..21.1
const R_LAND      = 15.6;   // חצי-דיסקת היבשה
const R_MARK_IN   = 20.6;   // סימון הרוח הנוכחית — בוקע מהרצועה החוצה
const R_MARK_OUT  = 24.4;
const N_TIP       = 14.6;   // חוד המחוג
const N_BASE      = 7.4;    // בסיס משולש הראש
const N_HALF      = 3.4;    // חצי-רוחב הבסיס
const N_TAIL      = 11.2;   // זנב — קצר מהראש, כדי שלא יהיה ספק איזה קצה הוא החוד

// גבולות הרצועות. חייבים להישאר זהים ל-directionClass ב-bands.js.
const SAFE_HALF   = 67;         // offAxis ≤ 67  → onshore / side_onshore
const DANGER_HALF = 180 - 112;  // offAxis > 112 → side_offshore / offshore

// סיווג → טיפול ויזואלי. offshore_managed מקבל טיפול שלישי נפרד: לא הירוק
// ולא האדום. סיווג override שאינו מוכר נופל גם הוא ל-managed — לעולם לא
// ל-safe או ל-danger בשקט.
const TREATMENT = {
  onshore: 'safe',
  side_onshore: 'safe',
  side_shore: 'neutral',
  side_offshore: 'danger',
  offshore: 'danger',
  offshore_managed: 'managed',
};
const TREATMENT_VAR = {
  safe: '--cmp-safe',
  neutral: '--cmp-neutral',
  danger: '--cmp-danger',
  managed: '--cmp-managed',
};

/* ------------------------------ עזרי מתמטיקה ------------------------------ */

const norm360 = (d) => ((d % 360) + 360) % 360;

/** עיגול לשתי ספרות. ה-+0 מנקה 0- כדי שלא ייכתב "-0" למאפיין */
const r2 = (n) => Math.round(n * 100) / 100 + 0;

/**
 * נקודה על מעגל לפי אזימוט מצפן.
 * ציר y של המסך גדל כלפי מטה, ולכן צפון (0°) הוא -y.
 * בדיקה: b=90 (מזרח) → x גדל, y ללא שינוי. b=180 (דרום) → y גדל.
 */
function pt(r, bearing) {
  const a = bearing * RAD;
  return [r2(C + r * Math.sin(a)), r2(C - r * Math.cos(a))];
}

/** וקטור יחידה בכיוון האזימוט (u) והניצב לו בכיוון אזימוט+90 (n) */
function axes(bearing) {
  const a = bearing * RAD;
  const s = Math.sin(a), c = Math.cos(a);
  return { ux: s, uy: -c, nx: c, ny: s };
}

/**
 * קשת בכיוון השעון מ-from ל-to.
 * אזימוט עולה = כיוון השעון על המסך, ולכן sweep-flag כאן הוא תמיד 1.
 * large-arc-flag נגזר מהמפתח בפועל — היפוך שלו היה מצייר קשת משלימה,
 * שנראית סבירה לגמרי אבל מצללת בדיוק את החצי ההפוך, כלומר מציגה רוח
 * אופשור כרוח בטוחה. אין כאן מקום לניחוש.
 */
function arcPath(r, from, to) {
  const span = norm360(to - from);
  if (span < 0.1) return '';
  if (span > 359.9) {
    // SVG לא יודע לסגור 360° בקשת אחת — שני חצאים
    const a = pt(r, from), b = pt(r, from + 180);
    return `M ${a[0]} ${a[1]} A ${r} ${r} 0 0 1 ${b[0]} ${b[1]} A ${r} ${r} 0 0 1 ${a[0]} ${a[1]}`;
  }
  const p1 = pt(r, from), p2 = pt(r, from + span);
  return `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${p2[0]} ${p2[1]}`;
}

/** גזרה מלאה (פרוסה) מהמרכז */
function sectorPath(r, from, to) {
  const arc = arcPath(r, from, to);
  if (!arc) return '';
  return `M ${r2(C)} ${r2(C)} L${arc.slice(1)} Z`;
}

/** קו רדיאלי בין שני רדיוסים על אותו אזימוט */
function radial(rIn, rOut, bearing) {
  const a = pt(rIn, bearing), b = pt(rOut, bearing);
  return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * צבע. הערך נצרך כ-custom property על ה-color של האלמנט עצמו, והמאפיין
 * הגרפי מצביע ל-currentColor. כך יש ברירת מחדל שעובדת גם בלי פלטה, וגם
 * עדיין אפשר לדרוס מ-CSS לפי שם המחלקה — כלל CSS גובר על presentation
 * attribute, ולכן ה-style המוטבע לא חוסם את סוכן הפלטה.
 * (var() בתוך presentation attribute אינו נתמך בדפדפנים — לכן style.)
 */
function paint(varName, fallback) {
  return ` style="color:var(${varName}, ${fallback || 'currentColor'})"`;
}

/* --------------------------------- הרכיב --------------------------------- */

/**
 * @param {number|null} windFromDeg  אזימוט מטאורולוגי שממנו הרוח באה
 * @param {object} spot              { shore_normal_deg, direction_overrides }
 * @param {object} [opts]            { size=52, dirClass=null, showCardinals=true, title=null }
 * @returns {string} SVG שלם
 */
export function renderCompass(windFromDeg, spot, opts) {
  const o = opts || {};
  const size = Number.isFinite(o.size) ? o.size : 52;
  const showCardinals = o.showCardinals !== false;

  const sp = spot || {};
  const sn = Number(sp.shore_normal_deg);
  const hasShore = Number.isFinite(sn);
  const shore = hasShore ? norm360(sn) : 0;

  const wRaw = windFromDeg === null || windFromDeg === undefined ? NaN : Number(windFromDeg);
  const hasWind = Number.isFinite(wRaw);
  const wind = hasWind ? norm360(wRaw) : NaN;

  const overrides = Array.isArray(sp.direction_overrides) ? sp.direction_overrides : [];

  // הסיווג. אם הקורא כבר חישב פסק דין — סומכים עליו ולא מחשבים שוב, כדי
  // שהחוגה ומנוע פסק הדין לא יוכלו להיפרד זה מזה.
  let cls = null;
  if (o.dirClass) {
    cls = typeof o.dirClass === 'string' ? o.dirClass : (o.dirClass.cls || null);
  } else if (hasWind && hasShore) {
    cls = directionClass(wind, sp).cls;
  }
  const treatment = cls ? (TREATMENT[cls] || 'managed') : null;

  // איזו קשת-חריג מכילה את הרוח הנוכחית. אותו סדר בדיקה כמו ב-directionClass:
  // ההתאמה הראשונה מנצחת.
  let activeOv = -1;
  if (hasWind) {
    for (let i = 0; i < overrides.length; i++) {
      const ov = overrides[i] || {};
      if (inArc(wind, Number(ov.from), Number(ov.to))) { activeOv = i; break; }
    }
  }

  const clsHe = cls ? DIR_CLASS_HE[cls] : null;
  const titleText = o.title != null
    ? String(o.title)
    : hasWind
      ? `רוח ${compassHe(wind)}${clsHe ? ', ' + clsHe : ''}`
      : 'אין נתוני כיוון רוח';

  const p = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="cmp ${cls ? 'cmp--' + esc(cls) : 'cmp--nodata'}"` +
    ` viewBox="0 0 ${VB} ${VB}" width="${size}" height="${size}" role="img"` +
    ` aria-label="${esc(titleText)}" data-dir-class="${esc(cls || '')}">` +
    `<title>${esc(titleText)}</title>`
  );

  // ---- 1. הטבעת ----
  p.push(
    `<circle class="cmp-rose" cx="${C}" cy="${C}" r="${R_RING}" fill="none"` +
    ` stroke="currentColor" stroke-opacity=".3" stroke-width="1.1"${paint('--cmp-rose')}/>`
  );

  if (hasShore) {
    // ---- 2. הפיצול ים/יבשה ----
    // הים נמצא בכיוון shore_normal, ולכן החצי *הנגדי* הוא היבשה — והוא זה
    // שמקבל מילוי. יבשה מלאה, ים פתוח.
    p.push(
      `<path class="cmp-shore cmp-shore-land" d="${sectorPath(R_LAND, shore + 90, shore + 270)}"` +
      ` fill="currentColor" fill-opacity=".18" stroke="none"${paint('--cmp-shore')}/>`
    );
    // קו החוף: המיתר הניצב ל-shore_normal. הוא נמתח עד טבעת הרצועות ונוחת
    // בדיוק בשני הפערים הניטרליים (offAxis=90 → side_shore, בלי צביעה).
    const a = pt(R_BAND, shore - 90), b = pt(R_BAND, shore + 90);
    p.push(
      `<line class="cmp-shore cmp-shore-line" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"` +
      ` stroke="currentColor" stroke-opacity=".55" stroke-width="1.1" stroke-linecap="round"${paint('--cmp-shore')}/>`
    );

    // ---- 3. קשתות הבטוח והמסוכן ----
    // אלה קשתות של *מוצא* הרוח: כל אזימוט שממנו רוח תגיע ותסווג כך.
    //   בטוח  (onshore + side_onshore)  = shore_normal ± 67
    //   מסוכן (side_offshore + offshore) = הצד הנגדי ± 68
    // stroke-linecap חייב להיות butt: קצה עגול היה מותח את הצביעה בכ-7°
    // מעבר לסף האמיתי, כלומר משקר על היכן מתחילה הסכנה.
    const band = (klass, from, to, varName, op) =>
      `<path class="${klass}" d="${arcPath(R_BAND, from, to)}" fill="none" stroke="currentColor"` +
      ` stroke-width="${W_BAND}" stroke-linecap="butt" stroke-opacity="${op}"${paint(varName)}/>`;

    p.push(band('cmp-safe-arc', shore - SAFE_HALF, shore + SAFE_HALF, '--cmp-safe', '.8'));
    p.push(band('cmp-danger-arc', shore + 180 - DANGER_HALF, shore + 180 + DANGER_HALF, '--cmp-danger', '.8'));

    // ---- 3ב. קשתות חריג ----
    // ⚠️ **כרגע אין אף ספוט ברג'יסטר עם direction_overrides.** חוף אילת
    // הצפוני נשא חריג "אופשור מנוהל", והוא הוסר כשהתברר שזה חוף רחצה
    // ומרינה ולא חוף הקייט (ארז אישר 19/8/26 שהוא גולש בריף רף). הקוד
    // נשאר כי המנגנון עצמו נכון ומכוסה בבדיקות על פיקסצ'ר — אבל אין
    // להסיק מכאן שקיים חוף שבו אופשור הוא מצב רכיבה מקובל.
    //
    // קשת חריג מצוירת *מעל* הרצועות הגנריות, בדיוק כפי ש-directionClass
    // בודקת אותה לפני המיפוי הגנרי. אסור שתרד בשקט לאדום או תעלה לירוק.
    overrides.forEach((ov, i) => {
      const from = Number((ov || {}).from), to = Number((ov || {}).to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;
      const d = arcPath(R_BAND, from, to);
      if (!d) return;
      const t = TREATMENT[(ov || {}).class] || 'managed';
      const active = i === activeOv;
      p.push(
        `<path class="cmp-${t}-arc cmp-override-arc${active ? ' cmp-' + t + '-arc--active' : ''}"` +
        ` d="${d}" fill="none" stroke="currentColor" stroke-width="${W_BAND}" stroke-linecap="butt"` +
        ` stroke-opacity="${active ? '.95' : '.5'}"${paint(TREATMENT_VAR[t])}/>`
      );
    });
  }

  // ---- 5. שנתות רוחות השמיים. בלי אותיות — ב-52px הן בוץ. צפון למעלה. ----
  if (showCardinals) {
    p.push(
      `<g class="cmp-cardinal" stroke="currentColor" stroke-opacity=".4" stroke-width=".9"` +
      ` stroke-linecap="round"${paint('--cmp-cardinal')}>`
    );
    [0, 90, 180, 270].forEach((b) => {
      const isN = b === 0;
      const l = radial(isN ? R_TICK_IN_N : R_TICK_IN, R_TICK_OUT, b);
      p.push(
        `<line class="cmp-cardinal-tick${isN ? ' cmp-cardinal--n' : ''}"` +
        ` x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"` +
        `${isN ? ' stroke-width="1.6" stroke-opacity=".75"' : ''}/>`
      );
    });
    p.push('</g>');
  }

  // ---- סימון "כאן יושבת הרוח" על הטבעת, בצבע הסיווג בפועל ----
  if (hasWind && treatment) {
    const l = radial(R_MARK_IN, R_MARK_OUT, wind);
    p.push(
      `<line class="cmp-current cmp-current--${esc(cls)}" x1="${l.x1}" y1="${l.y1}"` +
      ` x2="${l.x2}" y2="${l.y2}" stroke="currentColor" stroke-width="2.4"` +
      ` stroke-linecap="round"${paint(TREATMENT_VAR[treatment])}/>`
    );
  }

  // ---- 4. המחוג ----
  if (hasWind) {
    // הרוח *באה* מ-wind, כלומר *נוסעת* אל wind+180. החוד מצביע לכיוון
    // הנסיעה: ברוח אופשור הוא מצביע החוצה אל הים — וזה כל המסר.
    const t = norm360(wind + 180);
    const { ux, uy, nx, ny } = axes(t);
    const tip  = [r2(C + N_TIP * ux), r2(C + N_TIP * uy)];
    const base = [r2(C + N_BASE * ux), r2(C + N_BASE * uy)];
    const b1   = [r2(C + N_BASE * ux + N_HALF * nx), r2(C + N_BASE * uy + N_HALF * ny)];
    const b2   = [r2(C + N_BASE * ux - N_HALF * nx), r2(C + N_BASE * uy - N_HALF * ny)];
    const tail = [r2(C - N_TAIL * ux), r2(C - N_TAIL * uy)];

    p.push(`<g class="cmp-needle"${paint('--cmp-needle', 'var(--lv, currentColor)')}>`);
    // זנב דק + ראש מלא. מחוג סימטרי לא היה אומר לאן הרוח הולכת.
    p.push(
      `<line class="cmp-needle-stem" x1="${tail[0]}" y1="${tail[1]}" x2="${base[0]}" y2="${base[1]}"` +
      ` stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`
    );
    p.push(
      `<polygon class="cmp-needle-head" points="${tip[0]},${tip[1]} ${b1[0]},${b1[1]} ${b2[0]},${b2[1]}"` +
      ` fill="currentColor"/>`
    );
    p.push(`<circle class="cmp-needle-hub" cx="${C}" cy="${C}" r="1.7" fill="currentColor"/>`);
    p.push('</g>');
  } else {
    // אין כיוון רוח — חוגה ניטרלית, בלי מחוג ובלי סימון. לא נתיב שבור.
    p.push(
      `<circle class="cmp-nodata" cx="${C}" cy="${C}" r="3.4" fill="none" stroke="currentColor"` +
      ` stroke-opacity=".45" stroke-width="1.2" stroke-dasharray="2 2"${paint('--cmp-muted')}/>`
    );
  }

  p.push('</svg>');
  return p.join('');
}

export default renderCompass;
