/* =========================================================================
   רדאר קייט — מטאוגרם מלא (72 שעות) לפאנל הפירוט
   -------------------------------------------------------------------------
   מודול טהור: נכנסים מספרים, יוצאת מחרוזת SVG. בלי DOM, בלי document,
   בלי Date.now — הזמן (nowHour/nowDayIndex) מוזרק, בדיוק כמו ב-verdict/
   וב-sparkline. נבדק תחת `node --test` (test/chart.test.js).

   חלוקת העבודה מול הכרטיס: ה-sparkline בכרטיס עונה "היום טוב?".
   הגרף הזה עונה על השאלה הבאה — *מתי בדיוק*, ומה מגיע מחר ומחרתיים.
   הוא התוכן המרכזי של הפאנל שנפתח בהקשה, ולכן הוא נפלט כ-SVG שלם.

   ארבע החלטות שאסור לבטל בלי לקרוא את ההסבר במקום:
   1. ציר הזמן מתהפך *במיפוי* ולא בטרנספורם מראה (ראה `X`).
   2. `null` הוא חור בנתונים ולא אפס קשר (ראה `buildRuns`).
   3. חץ הכיוון מסובב לפי הכיוון שאליו הרוח *הולכת* (ראה `arrowRotationDeg`).
   4. סקאלת ה-Y קבועה 0→30 קשר — זהה ל-sparkline, כדי שהכרטיס והפאנל
      יספרו את אותו סיפור. ערך מעל 30 *נצמד* לתקרה ומסומן, לא נחתך בשקט.

   כל הצבעים מגיעים מ-currentColor / var(--lv) / var(--ch-*).
   רשימת המשתנים המלאה בתחתית הקובץ.
   ========================================================================= */

/** תקרת סקאלת ה-Y בקשרים. זהה ל-SPARK_Y_MAX_KT — הכרטיס והפאנל חייבים להסכים. */
export const CHART_Y_MAX_KT = 30;

/** סף הרכיבוּת המינימלי בקשרים — תואם ל-MIN_RIDEABLE_KT במנוע */
export const CHART_THRESHOLD_KT = 12;

export const CHART_DEFAULTS = {
  width: 340,
  height: 170,
  dayStart: 6,
  dayEnd: 21,
  days: 3,
  nowHour: null,
  nowDayIndex: 0,
  level: 'unknown',
  compact: false,
  // פער שעות שמעליו רצף נשבר. 3 כדי לתמוך גם במודל תלת-שעתי בלי לפורר אותו.
  maxGapHours: 3,
};

/** רצועות הרכיבוּת — אותם ספים בדיוק כמו ב-sparkline וב-bands.js */
export const CHART_BANDS = [
  { from: 0,  to: 12, key: 'light' },     // מתחת לסף הרכיבה
  { from: 12, to: 15, key: 'marginal' },  // גבולי
  { from: 15, to: 22, key: 'ideal' },     // רוח טובה
  { from: 22, to: 28, key: 'strong' },    // רוח חזקה
  { from: 28, to: CHART_Y_MAX_KT, key: 'extreme' }, // למומחים / מסוכן
];

/** תוויות השעה בכל יום. שלוש נקודות עיגון, לא ציר מלא. */
const LABEL_HOURS = [6, 12, 18];

/** סימוני ציר הקשרים. שלושה, במדף השמאלי — לא על הגרף. */
const Y_TICKS_KT = [10, 20, 30];

/** צפיפות חצי הכיוון: אחד לכל שלוש שעות. */
const ARROW_STEP_H = 3;

const DAY_LABELS_HE = ['היום', 'מחר', 'מחרתיים'];

const LEVELS = new Set(['green', 'yellow', 'red', 'blocked', 'unknown']);

/* ------------------------------------------------------------------ */
/* עזרי מספרים — שער יחיד שדרכו עוברת כל קואורדינטה.                   */
/* NaN בודד בתוך `d` הורג את כל ה-path בשקט, בלי שגיאה בקונסול.        */
/* ------------------------------------------------------------------ */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : null);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** עיגול ל-2 ספרות — ה-markup הזה מוזרק בהקשה, וכל ספרה היא בייטים */
const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : NaN);

/** שער אחרון לפני שמחרוזת נפלטת. אלמנט עם קואורדינטה פגומה נזרק שלם. */
const safe = (s) =>
  (typeof s === 'string' && s.length > 0 && !/NaN|Infinity|undefined/.test(s) ? s : '');

const deg360 = (d) => (((d % 360) + 360) % 360);

/* ------------------------------------------------------------------ */
/* ציר הזמן — שעה מוחלטת                                               */
/* ------------------------------------------------------------------ */

/**
 * ממפה (שעה, יום) לשעה מוחלטת מתחילת החלון. זו יחידת ציר ה-X היחידה
 * בקובץ — גם הציור וגם ה-hit-test עובדים בה, ולכן הם לא יכולים להיפרד.
 */
export function chartT(hour, dayIndex = 0) {
  const h = num(hour);
  if (h == null) return NaN;
  return (num(dayIndex) ?? 0) * 24 + h;
}

/* ------------------------------------------------------------------ */
/* גיאומטריה                                                           */
/* ------------------------------------------------------------------ */

function geometry(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};

  const width = Math.max(1, num(o.width) ?? CHART_DEFAULTS.width);
  const height = Math.max(1, num(o.height) ?? CHART_DEFAULTS.height);
  const compact = o.compact === true;

  let days = Math.round(num(o.days) ?? CHART_DEFAULTS.days);
  if (!isNum(days) || days < 1) days = CHART_DEFAULTS.days;
  days = Math.min(10, days);

  // dayStart/dayEnd הן שעות האור/הרלוונטיות. מחוצה להן — עמעום לילה.
  // הן *לא* מקצרות את הציר: כל יום תופס בדיוק את אותו נתח מהרוחב,
  // אחרת השוואה בין יום ליום באותו גרף היא שקר ויזואלי.
  let dayStart = num(o.dayStart) ?? CHART_DEFAULTS.dayStart;
  let dayEnd = num(o.dayEnd) ?? CHART_DEFAULTS.dayEnd;
  if (!(dayEnd > dayStart)) {
    dayStart = CHART_DEFAULTS.dayStart;
    dayEnd = CHART_DEFAULTS.dayEnd;
  }
  dayStart = clamp(dayStart, 0, 24);
  dayEnd = clamp(dayEnd, 0, 24);

  const spanStart = 0;
  const spanEnd = days * 24;

  // מדף שמאלי לתוויות הקשרים. שמאל ולא ימין: הקצה הימני הוא "עכשיו",
  // ושם העין נוחתת ראשונה — לא מבזבזים אותו על ציר.
  const gutter = compact ? 0 : 20;
  const plotLeft = Math.min(gutter, width - 1);
  const plotRight = width;
  const plotW = Math.max(1, plotRight - plotLeft);

  const dayLabelH = compact ? 0 : 13;
  const hourLabelH = compact ? 0 : 11;
  const arrowH = compact ? 0 : 15;

  const yTop = dayLabelH + 4;
  const yBase = Math.max(yTop + 1, height - hourLabelH - arrowH - 1);
  const arrowY = arrowH > 0 ? yBase + arrowH / 2 + 1 : yBase;

  /**
   * ⚠️⚠️ ציר הזמן רץ ימין→שמאל: השעה המוקדמת ביותר בקצה *הימני*.
   * הדף כולו dir="rtl" והעין הישראלית קוראת את היום מימין.
   *
   * ההיפוך נעשה *כאן, במיפוי*, ולעולם לא בטרנספורם מראה
   * (scale שלילי על ציר ה-X, ‎matrix‎ עם מקדם אופקי שלילי, וכל בן דוד
   * שלהם). טרנספורם מראה היה הופך גם את תוויות השעה, ובעיקר — היה הופך
   * **את חצי כיוון הרוח**, הסימן הכי בטיחותי במסך: אונשור היה נראה
   * אופשור, ורוח שדוחפת לחוף הייתה נקראת כרוח שסוחפת לים הפתוח.
   * אל "תפשט" את זה לטרנספורם. זה לא פישוט, זו תקלת בטיחות.
   */
  const X = (t) => {
    const v = num(t);
    if (v == null) return NaN;
    return plotRight - ((v - spanStart) / (spanEnd - spanStart)) * plotW;
  };

  /** ההיפוך המדויק של X. ה-hit-test חייב לעבור דרכו ולא דרך חישוב מקביל. */
  const Xinv = (x) => {
    const v = num(x);
    if (v == null) return NaN;
    return spanStart + ((plotRight - v) / plotW) * (spanEnd - spanStart);
  };

  /** 0 קשר על הבסיס, 30 קשר בתקרה. הצמדה (clamp) ולא חיתוך. */
  const Y = (kt) => {
    const v = num(kt);
    if (v == null) return NaN;
    return yBase - (clamp(v, 0, CHART_Y_MAX_KT) / CHART_Y_MAX_KT) * (yBase - yTop);
  };

  return {
    width, height, compact, days,
    dayStart, dayEnd, spanStart, spanEnd,
    plotLeft, plotRight, plotW,
    yTop, yBase, arrowH, arrowY, dayLabelH,
    X, Xinv, Y,
  };
}

/** מיפוי (שעה, יום) → x. מיוצא כדי שהבדיקות והקורא ישתמשו באותו מיפוי. */
export function chartX(hour, dayIndex = 0, opts = {}) {
  return geometry(opts).X(chartT(hour, dayIndex));
}

/** מיפוי קשרים → y. */
export function chartY(kt, opts = {}) {
  return geometry(opts).Y(kt);
}

/**
 * ההיפוך: x → {שעה, יום}. אותה גיאומטריה בדיוק, ולכן אין דריפט אפשרי
 * בין מה שמצויר לבין מה שנקרא מתחת לאצבע.
 */
export function chartHourAtX(x, opts = {}) {
  const g = geometry(opts);
  const t = g.Xinv(x);
  if (!isNum(t)) return null;
  const tc = clamp(Math.round(t), g.spanStart, g.spanEnd - 1);
  return { t: tc, hour: tc % 24, dayIndex: Math.floor(tc / 24) };
}

export function chartViewBox(width = CHART_DEFAULTS.width, height = CHART_DEFAULTS.height) {
  return `0 0 ${r2(width)} ${r2(height)}`;
}

/* ------------------------------------------------------------------ */
/* קונבנציית החץ                                                       */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ קונבנציה — לקרוא לפני שינוי:
 *   `dirDeg` הוא **מטאורולוגי**: האזימוט שממנו הרוח *באה* (זהה ל-
 *   wind_direction_10m של Open-Meteo ולקלט של offAxisDeg ב-bands.js).
 *
 *   החץ על המסך מצייר את הכיוון שאליו הרוח **הולכת**, כלומר dirDeg+180.
 *   זו הקריאה האינטואיטיבית לגולש: החץ מראה לאן זה דוחף אותו.
 *   רוח מערבית (dirDeg=270, באה מהמערב) → חץ שמצביע מזרחה, אל החוף.
 *
 *   הגליף ב-defs מצויר כשהוא מצביע "צפונה" (כלפי מעלה, y שלילי), ו-rotate
 *   ב-SVG הוא עם כיוון השעון — ולכן rotate(bearing) מכוון אותו לאזימוט
 *   הזה. זה נכון *רק* כי מישור הציור אינו ממוראה: היפוך ציר הזמן חי
 *   במיפוי X, לא בטרנספורם. ראה האזהרה ב-`X`.
 *
 *   כל מקרא/אגדה שיתווסף חייב להשתמש בפונקציה הזאת ולא לחשב סיבוב משלו.
 */
export const ARROW_SHOWS = 'going';

export function arrowRotationDeg(dirDeg) {
  const d = num(dirDeg);
  if (d == null) return NaN;
  return deg360(d + 180);
}

/* ------------------------------------------------------------------ */
/* אינטרפולציה מונוטונית (Fritsch–Carlson)                             */
/* ------------------------------------------------------------------ */

/**
 * שיפועים מונוטוניים. ספליין רגיל "מזנק" סביב שיא — מצייר 26 קשר איפה
 * שהמודל אמר 22, ומטפס מתחת לאפס אחרי צניחה. שניהם שקר על רוח.
 * המגביל של Fritsch–Carlson מבטיח שכל קטע נשאר בין שני ערכי הקצה שלו.
 */
function monotoneTangents(xs, ys) {
  const n = xs.length;
  if (n < 2) return [0];
  const d = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i];
    d.push(h === 0 ? 0 : (ys[i + 1] - ys[i]) / h);
  }
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return m;
}

/**
 * נקודות הבקרה מחושבות **במרחב הנתונים** (שעה↔קשר) ורק אז ממופות דרך
 * X/Y — שתיהן אפיניות, ולכן ההמרה מדויקת ואין צורך לשחזר ספליין בפיקסלים.
 */
function bezierSegments(xs, ys) {
  const m = monotoneTangents(xs, ys);
  const segs = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const h = xs[i + 1] - xs[i];
    segs.push({
      x0: xs[i], y0: ys[i],
      c1x: xs[i] + h / 3, c1y: ys[i] + (m[i] * h) / 3,
      c2x: xs[i + 1] - h / 3, c2y: ys[i + 1] - (m[i + 1] * h) / 3,
      x1: xs[i + 1], y1: ys[i + 1],
    });
  }
  return segs;
}

function pathForward(segs, X, Y) {
  const s0 = segs[0];
  let d = `M${r2(X(s0.x0))},${r2(Y(s0.y0))}`;
  for (const s of segs) {
    d += ` C${r2(X(s.c1x))},${r2(Y(s.c1y))} ${r2(X(s.c2x))},${r2(Y(s.c2y))} ${r2(X(s.x1))},${r2(Y(s.y1))}`;
  }
  return d;
}

/** אותם קטעים בכיוון ההפוך — החלפת נקודות הבקרה, בלי חישוב ספליין מחדש */
function pathReverseTail(segs, X, Y) {
  let d = '';
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    d += ` C${r2(X(s.c2x))},${r2(Y(s.c2y))} ${r2(X(s.c1x))},${r2(Y(s.c1y))} ${r2(X(s.x0))},${r2(Y(s.y0))}`;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* הכנת הנתונים                                                        */
/* ------------------------------------------------------------------ */

/**
 * נרמול הקלט לנקודות על ציר השעה המוחלטת. כל מה שאינו מספר סופי נופל
 * כאן ולא מגיע לשום attribute. שורה בלי `hour` תקין אינה נקודה בזמן.
 */
function collectPoints(hours, g) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(hours) ? hours : [];
  for (const h of list) {
    if (!h || typeof h !== 'object') continue;
    const hour = num(h.hour);
    if (hour == null) continue;
    const dayIndex = num(h.dayIndex) ?? 0;
    const t = dayIndex * 24 + hour;
    if (!isNum(t) || t < g.spanStart || t > g.spanEnd) continue;
    if (seen.has(t)) continue;
    seen.add(t);

    let speed = num(h.speedKt);
    if (speed != null && speed < 0) speed = 0;
    let gust = num(h.gustKt);
    if (gust != null && gust < 0) gust = 0;
    // משב נמוך מהממוצע הוא רעש מודל, לא מידע. המעטפת לא הופכת את עצמה.
    if (gust != null && speed != null && gust < speed) gust = speed;

    const dir = num(h.dirDeg);

    out.push({
      t, hour, dayIndex,
      speed, gust,
      dir: dir == null ? null : deg360(dir),
      tsMs: num(h.tsMs),
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * מפצל את הנקודות לרצפים רציפים של נתון תקין.
 *
 * ⚠️ `null` הוא חור, לא אפס. אפליקציית רוח שמציירת נתון חסר כקו על
 * הרצפה אומרת לגולש "אין רוח" בדיוק כשהיא לא יודעת. הרצף נשבר, ולא
 * נסגר בקו. גם קפיצה של יותר מ-maxGapHours שוברת — סמיכות במערך
 * אינה רציפות בזמן.
 */
function buildRuns(pts, maxGapHours) {
  const runs = [];
  let cur = null;
  let prevT = null;
  for (const p of pts) {
    if (p.speed == null) {
      cur = null;            // חור מפורש — שובר את הרצף
      prevT = p.t;
      continue;
    }
    if (prevT != null && p.t - prevT > maxGapHours) cur = null;
    if (!cur) { cur = []; runs.push(cur); }
    cur.push(p);
    prevT = p.t;
  }
  return runs;
}

/* ------------------------------------------------------------------ */
/* השכבות — מלמטה למעלה                                                */
/* ------------------------------------------------------------------ */

/**
 * גליף החץ, פעם אחת בלבד, ואחר כך use לכל שעה שלישית.
 * יש עד 24 חצים בגרף אחד; שכפול ה-path היה משלש את גודל ה-markup
 * שמוזרק בהקשה, בלי שום תוספת מידע.
 * מצויר כשהוא מצביע כלפי מעלה = אזימוט 0.
 */
function layerDefs(uid) {
  return (
    `<defs><g id="${uid}-arrow" class="ch-arrow-glyph">` +
    `<path d="M0,-4.2 L2.7,3.4 L0,1.7 L-2.7,3.4 Z" ` +
    `fill="var(--ch-arrow, currentColor)" fill-opacity="var(--ch-arrow-opacity, 0.6)" stroke="none"/>` +
    `</g></defs>`
  );
}

/** עמעום שעות הלילה. הגולש לא רוכב בחושך — אלה שעות הקשר, לא הצעה. */
function layerNight(g) {
  let out = '';
  const h = g.yBase - g.yTop;
  if (!isNum(h) || h <= 0) return '';
  for (let d = 0; d < g.days; d++) {
    const base = d * 24;
    for (const [a, b] of [[base, base + g.dayStart], [base + g.dayEnd, base + 24]]) {
      const s = clamp(a, g.spanStart, g.spanEnd);
      const e = clamp(b, g.spanStart, g.spanEnd);
      if (!(e > s)) continue;
      const xL = g.X(e);
      const w = g.X(s) - xL;
      if (!isNum(w) || w <= 0) continue;
      out += safe(
        `<rect class="ch-night" x="${r2(xL)}" y="${r2(g.yTop)}" width="${r2(w)}" height="${r2(h)}" ` +
        `fill="var(--ch-night, transparent)" fill-opacity="var(--ch-night-opacity, 0.35)"/>`
      );
    }
  }
  return out;
}

/** רצועות הרכיבוּת. הן רקע — סקאלה, לא הנושא. */
function layerBands(g) {
  let out = '';
  for (const b of CHART_BANDS) {
    const yHi = g.Y(b.to);
    const yLo = g.Y(b.from);
    const h = yLo - yHi;
    if (!isNum(h) || h <= 0) continue;
    out += safe(
      `<rect class="ch-band ch-band--${b.key}" x="${r2(g.plotLeft)}" y="${r2(yHi)}" ` +
      `width="${r2(g.plotW)}" height="${r2(h)}" fill="var(--ch-band-${b.key}, transparent)"/>`
    );
  }
  return out;
}

/**
 * קו סף הרכיבוּת — 12 קשר.
 *
 * בלעדיו, ביום חלש כל העקומה נדבקת לתחתית הגרף ונקראת כ"אין מידע".
 * עם הקו, אותה עקומה נקראת כ"שלושה ימים מתחת לסף" — וזו בדיוק ההודעה.
 * התווית יושבת בקצה הימני, מול המדף השמאלי של ציר הקשרים, כדי שהיא
 * לא תתנגש עם הסימון של 10 קשר.
 */
function layerThreshold(g) {
  const y = g.Y(CHART_THRESHOLD_KT);
  if (!isNum(y)) return '';
  return safe(
    `<line class="ch-threshold" x1="${r2(g.plotLeft)}" y1="${r2(y)}" x2="${r2(g.plotRight)}" y2="${r2(y)}" ` +
    `stroke="var(--ch-threshold, currentColor)" stroke-opacity="var(--ch-threshold-opacity, 0.45)" ` +
    `stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>` +
    `<text class="ch-threshold-label" x="${r2(g.plotRight - 3)}" y="${r2(y - 3)}" text-anchor="end" ` +
    `font-size="8" fill="var(--ch-threshold, currentColor)" ` +
    `fill-opacity="var(--ch-threshold-opacity, 0.45)">12</text>`
  );
}

/**
 * החלונות שהמנוע בחר, אחד ליום לכל היותר. endHour בלעדי (pickWindow
 * מחזיר lastHour+1), ולכן הצביעה עד endHour מכסה בדיוק את משך הבלוק.
 * מצויר מתחת לעקומה: מילוי חלש + פס על הבסיס, בלי לכסות את הקו.
 */
function layerWindows(windows, g) {
  const list = Array.isArray(windows) ? windows : [];
  let out = '';
  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    const d = num(w.dayIndex) ?? 0;
    const a = num(w.startHour);
    const b = num(w.endHour);
    if (a == null || b == null || !(b > a)) continue;
    const s = clamp(d * 24 + a, g.spanStart, g.spanEnd);
    const e = clamp(d * 24 + b, g.spanStart, g.spanEnd);
    if (!isNum(s) || !isNum(e) || !(e > s)) continue;
    const xL = g.X(e);
    const wid = g.X(s) - xL;
    if (!isNum(wid) || wid <= 0) continue;
    const bar = r2(g.yBase + 1);
    out += safe(
      `<rect class="ch-window" x="${r2(xL)}" y="${r2(g.yTop)}" width="${r2(wid)}" ` +
      `height="${r2(g.yBase - g.yTop)}" fill="var(--ch-window, var(--lv, currentColor))" ` +
      `fill-opacity="var(--ch-window-opacity, 0.12)"/>`
    );
    out += safe(
      `<line class="ch-window-bar" x1="${r2(xL)}" y1="${bar}" x2="${r2(xL + wid)}" y2="${bar}" ` +
      `stroke="var(--ch-window, var(--lv, currentColor))" stroke-width="var(--ch-window-bar-width, 2.5)" ` +
      `stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
    );
  }
  return out;
}

/** מעטפת המשבים — עובי הפס *הוא* המידע: יום סוער נראה עבה, יום חלק דק */
function layerArea(runs, g) {
  let out = '';
  for (const run of runs) {
    if (run.length < 2) continue;
    const xs = run.map((p) => p.t);
    const mean = run.map((p) => clamp(p.speed, 0, CHART_Y_MAX_KT));
    const gust = run.map((p) => clamp(p.gust ?? p.speed, 0, CHART_Y_MAX_KT));
    // בלי משב אמיתי באף שעה אין מעטפת. שטח בעובי אפס הוא רעש markup.
    if (!gust.some((v, i) => v > mean[i] + 0.05)) continue;
    const mSegs = bezierSegments(xs, mean);
    const gSegs = bezierSegments(xs, gust);
    const last = gSegs[gSegs.length - 1];
    const d =
      pathForward(mSegs, g.X, g.Y) +
      ` L${r2(g.X(last.x1))},${r2(g.Y(last.y1))}` +
      pathReverseTail(gSegs, g.X, g.Y) +
      ' Z';
    out += safe(
      `<path class="ch-area" d="${d}" fill="var(--ch-area, currentColor)" ` +
      `fill-opacity="var(--ch-area-opacity, 0.16)" stroke="none"/>`
    );
  }
  return out;
}

/** קו הרוח הממוצעת. רצף אחד = path אחד; חור בנתונים = path נוסף. */
function layerLine(runs, g) {
  let out = '';
  for (const run of runs) {
    if (run.length < 2) continue;
    const xs = run.map((p) => p.t);
    const ys = run.map((p) => clamp(p.speed, 0, CHART_Y_MAX_KT));
    const d = pathForward(bezierSegments(xs, ys), g.X, g.Y);
    out += safe(
      `<path class="ch-line" d="${d}" fill="none" stroke="var(--ch-line, var(--lv, currentColor))" ` +
      `stroke-width="var(--ch-line-width, 1.8)" stroke-linecap="round" stroke-linejoin="round" ` +
      `vector-effect="non-scaling-stroke"/>`
    );
  }
  return out;
}

/** שעה תקינה בודדת בין שני חורים — נקודה. קו אי אפשר לצייר, ולהעלים אסור. */
function layerDots(runs, g) {
  let out = '';
  for (const run of runs) {
    if (run.length !== 1) continue;
    const p = run[0];
    out += safe(
      `<circle class="ch-dot" cx="${r2(g.X(p.t))}" ` +
      `cy="${r2(g.Y(clamp(p.speed, 0, CHART_Y_MAX_KT)))}" r="1.8" ` +
      `fill="var(--ch-dot, var(--lv, currentColor))"/>`
    );
  }
  return out;
}

/** סימון הצמדה לתקרה — מעל 30 קשר הערך נצמד, והגולש חייב לדעת שנחתך */
function layerOverflow(runs, g) {
  let out = '';
  for (const run of runs) {
    for (const p of run) {
      const over =
        (p.speed != null && p.speed > CHART_Y_MAX_KT) ||
        (p.gust != null && p.gust > CHART_Y_MAX_KT);
      if (!over) continue;
      const x = g.X(p.t);
      const y = g.yTop;
      const d = `M${r2(x - 2.8)},${r2(y + 3)} L${r2(x)},${r2(y - 0.2)} L${r2(x + 2.8)},${r2(y + 3)}`;
      out += safe(
        `<path class="ch-over" d="${d}" fill="none" stroke="var(--ch-over, var(--lv, currentColor))" ` +
        `stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
      );
    }
  }
  return out;
}

/** קווי חצות. רק גבולות פנימיים — קו על הקצה הוא מסגרת, לא מידע. */
function layerDaySeps(g) {
  let out = '';
  const y2 = r2(g.yBase + g.arrowH);
  for (let d = 1; d < g.days; d++) {
    const x = g.X(d * 24);
    if (!isNum(x)) continue;
    out += safe(
      `<line class="ch-daysep" x1="${r2(x)}" y1="${r2(Math.max(0, g.yTop - 4))}" ` +
      `x2="${r2(x)}" y2="${y2}" stroke="var(--ch-daysep, currentColor)" ` +
      `stroke-opacity="var(--ch-daysep-opacity, 0.25)" stroke-width="1" ` +
      `vector-effect="non-scaling-stroke"/>`
    );
  }
  return out;
}

function dayLabelHe(d) {
  return d < DAY_LABELS_HE.length ? DAY_LABELS_HE[d] : `בעוד ${d} ימים`;
}

/** תווית היום, ממורכזת על אמצע היום (12:00) בראש הגרף */
function layerDayLabels(g) {
  if (g.compact || g.dayLabelH <= 0) return '';
  let out = '';
  const y = r2(g.dayLabelH - 3);
  for (let d = 0; d < g.days; d++) {
    const x = clamp(g.X(d * 24 + 12), g.plotLeft + 22, g.plotRight - 22);
    out += safe(
      `<text class="ch-daylabel" x="${r2(x)}" y="${y}" text-anchor="middle" font-size="9" ` +
      `fill="var(--ch-daylabel, currentColor)" ` +
      `fill-opacity="var(--ch-daylabel-opacity, 0.75)">${dayLabelHe(d)}</text>`
    );
  }
  return out;
}

/**
 * חצי כיוון, אחד לשלוש שעות, בשורה מתחת לגרף.
 * הצעד נמדד על ציר הזמן ולא על מיקום במערך — קלט תלת-שעתי או דליל
 * לא אמור להוציא שורת חצים ריקה או צפופה מדי.
 * הסיבוב עצמו: ראה `arrowRotationDeg` (החץ מראה לאן הרוח הולכת).
 */
function layerArrows(pts, g, uid) {
  if (g.compact || g.arrowH <= 0) return '';
  let out = '';
  let lastT = -Infinity;
  for (const p of pts) {
    if (p.dir == null || p.speed == null) continue;
    if (p.t - lastT < ARROW_STEP_H - 1e-6) continue;
    lastT = p.t;
    const x = g.X(p.t);
    const rot = arrowRotationDeg(p.dir);
    if (!isNum(x) || !isNum(rot)) continue;
    out += safe(
      `<use class="ch-arrow" href="#${uid}-arrow" ` +
      `transform="translate(${r2(x)},${r2(g.arrowY)}) rotate(${r2(rot)})"/>`
    );
  }
  return out;
}

/** קו "עכשיו". רק על היום שהוא באמת היום, ורק אם השעה בתוך החלון. */
function layerNow(g, nowHour, nowDayIndex) {
  const t = chartT(nowHour, nowDayIndex ?? 0);
  if (!isNum(t) || t < g.spanStart || t > g.spanEnd) return '';
  const x = g.X(t);
  return safe(
    `<line class="ch-now" x1="${r2(x)}" y1="${r2(Math.max(0, g.yTop - 4))}" x2="${r2(x)}" ` +
    `y2="${r2(g.yBase + 2)}" stroke="var(--ch-now, currentColor)" ` +
    `stroke-opacity="var(--ch-now-opacity, 0.75)" stroke-width="1.2" ` +
    `vector-effect="non-scaling-stroke"/>`
  );
}

function layerAxis(g) {
  const y = r2(g.yBase + 0.5);
  return safe(
    `<line class="ch-axis" x1="${r2(g.plotLeft)}" y1="${y}" x2="${r2(g.plotRight)}" y2="${y}" ` +
    `stroke="var(--ch-axis, currentColor)" stroke-opacity="var(--ch-axis-opacity, 0.25)" ` +
    `stroke-width="1" vector-effect="non-scaling-stroke"/>`
  );
}

/** ציר הקשרים במדף השמאלי. שלושה סימונים — סקאלה, לא טבלה. */
function layerYAxis(g) {
  if (g.compact || g.plotLeft <= 0) return '';
  let out = safe(
    `<line class="ch-yaxis" x1="${r2(g.plotLeft)}" y1="${r2(g.yTop)}" ` +
    `x2="${r2(g.plotLeft)}" y2="${r2(g.yBase)}" stroke="var(--ch-axis, currentColor)" ` +
    `stroke-opacity="var(--ch-axis-opacity, 0.25)" stroke-width="1" ` +
    `vector-effect="non-scaling-stroke"/>`
  );
  for (const kt of Y_TICKS_KT) {
    const y = g.Y(kt);
    if (!isNum(y)) continue;
    out += safe(
      `<text class="ch-ytick" x="${r2(g.plotLeft - 3)}" y="${r2(clamp(y + 3, 8, g.yBase))}" ` +
      `text-anchor="end" font-size="8" fill="var(--ch-ytick, currentColor)" ` +
      `fill-opacity="var(--ch-ytick-opacity, 0.5)">${kt}</text>`
    );
  }
  return out;
}

/** 06 / 12 / 18 בכל יום. שלוש נקודות עיגון ליום, לא ציר מלא. */
function layerHourLabels(g) {
  if (g.compact) return '';
  let out = '';
  const y = r2(g.height - 2);
  for (let d = 0; d < g.days; d++) {
    for (const h of LABEL_HOURS) {
      const t = d * 24 + h;
      if (t < g.spanStart || t > g.spanEnd) continue;
      // הצמדה פנימה כדי שהתווית בקצה לא תיחתך
      const x = clamp(g.X(t), g.plotLeft + 7, g.plotRight - 7);
      const txt = String(h).padStart(2, '0');
      out += safe(
        `<text class="ch-label" x="${r2(x)}" y="${y}" text-anchor="middle" font-size="8" ` +
        `fill="var(--ch-label, currentColor)" fill-opacity="var(--ch-label-opacity, 0.55)">${txt}</text>`
      );
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* ה-API                                                               */
/* ------------------------------------------------------------------ */

function safeId(v) {
  return typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(v) ? v : 'ch';
}

/**
 * המטאוגרם המלא, כ-SVG שלם ומוכן להזרקה.
 *
 * aria-hidden — סיכום מילולי של שלושת הימים מוגש בנפרד בפאנל. קורא מסך
 * שמנסה להקריא 24 חצים ושני paths הוא רעש, לא נגישות.
 *
 * preserveAspectRatio="xMidYMid meet" ולא "none": מתיחה לא-אחידה הייתה
 * *גוזרת* (shear) את החצים המסובבים — כלומר משנה את הזווית המוצגת של
 * כיוון הרוח. גרף מעט ממורכז עדיף על חץ שמראה אזימוט שגוי.
 *
 * @param {Array<{hour:number,dayIndex:number,tsMs:?number,speedKt:?number,gustKt:?number,dirDeg:?number}>} hours
 * @param {object} opts { width, height, dayStart, dayEnd, nowHour, nowDayIndex,
 *                        windows, level, days, compact, maxGapHours, idPrefix }
 * @returns {string} SVG שלם
 */
export function renderChart(hours, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const g = geometry(o);
  const maxGapHours = Math.max(1, num(o.maxGapHours) ?? CHART_DEFAULTS.maxGapHours);
  const pts = collectPoints(hours, g);
  const runs = buildRuns(pts, maxGapHours);
  const level = LEVELS.has(o.level) ? o.level : 'unknown';
  const uid = safeId(o.idPrefix);
  const par = typeof o.preserveAspectRatio === 'string' ? o.preserveAspectRatio : 'xMidYMid meet';

  const body = [
    layerDefs(uid),
    layerNight(g),
    layerBands(g),
    layerThreshold(g),
    layerWindows(o.windows, g),
    layerArea(runs, g),
    layerLine(runs, g),
    layerDots(runs, g),
    layerOverflow(runs, g),
    layerDaySeps(g),
    layerDayLabels(g),
    layerArrows(pts, g, uid),
    layerNow(g, o.nowHour ?? CHART_DEFAULTS.nowHour, o.nowDayIndex ?? CHART_DEFAULTS.nowDayIndex),
    layerAxis(g),
    layerYAxis(g),
    layerHourLabels(g),
  ].join('');

  const cls = `chart chart--${level}${g.compact ? ' chart--compact' : ''}`;
  return (
    `<svg class="${cls}" viewBox="${chartViewBox(g.width, g.height)}" ` +
    `width="100%" height="${r2(g.height)}" preserveAspectRatio="${par}" ` +
    `aria-hidden="true" focusable="false" role="presentation" ` +
    `xmlns="http://www.w3.org/2000/svg">${body}</svg>`
  );
}

/**
 * מיפוי הפוך: שבר אופקי 0..1 (הקורא כבר נרמל אותו מול רוחב האלמנט)
 * אל דלי השעה הקרוב ביותר, לשורת הקריאה מתחת לגרף.
 *
 * עובר דרך אותה `geometry` שמציירת — אין כאן חישוב מקביל שיכול לסטות.
 * הנחה: ה-SVG מוצג ברוחב מלא ובאותו יחס-גובה-רוחב של ה-viewBox.
 *
 * מחזיר null כשאין נתונים, או כשהנקודה הקרובה רחוקה יותר מ-maxGapHours —
 * אצבע שנוחתת באמצע חור בן יממה לא אמורה לקבל את הערך שמעבר לחור.
 */
export function chartHitTest(hours, opts = {}, fracX = 0) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const g = geometry(o);
  const f = num(fracX);
  if (f == null) return null;

  const t = clamp(g.Xinv(clamp(f, 0, 1) * g.width), g.spanStart, g.spanEnd);
  if (!isNum(t)) return null;

  const pts = collectPoints(hours, g);
  if (!pts.length) return null;

  const tol = Math.max(1, num(o.maxGapHours) ?? CHART_DEFAULTS.maxGapHours);
  let best = null;
  let bestD = Infinity;
  for (const p of pts) {
    const d = Math.abs(p.t - t);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best || bestD > tol) return null;

  return {
    hour: best.hour,
    dayIndex: best.dayIndex,
    speedKt: best.speed,
    gustKt: best.gust,
    dirDeg: best.dir,
    tsMs: best.tsMs,
  };
}

/* =========================================================================
   משתני ה-CSS שהקובץ צורך (כולם עם נפילה-לאחור סבירה):
     --ch-band-light · --ch-band-marginal · --ch-band-ideal ·
     --ch-band-strong · --ch-band-extreme        (נפילה: transparent)
     --ch-night (transparent) · --ch-night-opacity (0.35)
     --ch-threshold (currentColor) · --ch-threshold-opacity (0.45)
     --ch-window (var(--lv, currentColor)) · --ch-window-opacity (0.12) ·
     --ch-window-bar-width (2.5)
     --ch-area (currentColor) · --ch-area-opacity (0.16)
     --ch-line (var(--lv, currentColor)) · --ch-line-width (1.8)
     --ch-dot (var(--lv, currentColor))
     --ch-over (var(--lv, currentColor))
     --ch-daysep (currentColor) · --ch-daysep-opacity (0.25)
     --ch-daylabel (currentColor) · --ch-daylabel-opacity (0.75)
     --ch-arrow (currentColor) · --ch-arrow-opacity (0.6)
     --ch-now (currentColor) · --ch-now-opacity (0.75)
     --ch-axis (currentColor) · --ch-axis-opacity (0.25)  [ציר הבסיס וציר ה-Y]
     --ch-ytick (currentColor) · --ch-ytick-opacity (0.5)
     --ch-label (currentColor) · --ch-label-opacity (0.55)
     --lv — צבע הדרגה, נצרך דרך הנפילה-לאחור של הקו/החלון/הנקודה/הסימון

   המחלקות שנפלטות:
     chart · chart--{green|yellow|red|blocked|unknown} · chart--compact ·
     ch-arrow-glyph · ch-night · ch-band (+ ch-band--light|marginal|ideal|
     strong|extreme) · ch-threshold · ch-threshold-label · ch-window ·
     ch-window-bar · ch-area · ch-line · ch-dot · ch-over · ch-daysep ·
     ch-daylabel · ch-arrow · ch-now · ch-axis · ch-yaxis · ch-ytick · ch-label

   הערה ל-CSS: המילוי נכתב גם כתכונת-הצגה (presentation attribute) על
   האלמנט. תכונת-הצגה מפסידה לכל כלל CSS, ולכן הפלטה שולטת דרך המחלקות
   וה-attribute הוא רק נפילה-לאחור כשאין גיליון סגנון.
   ========================================================================= */
