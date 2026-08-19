/* =========================================================================
   רדאר קייט — מטאוגרם מיקרו (sparkline) של יום רוח אחד
   -------------------------------------------------------------------------
   מודול טהור: נכנסים מספרים, יוצאת מחרוזת SVG. בלי DOM, בלי document,
   בלי Date.now — הזמן (nowHour) מוזרק תמיד, בדיוק כמו ב-verdict/.
   נבדק תחת `node --test` (test/sparkline.test.js).

   מה הגרף הזה אמור לענות בלי נגיעה אחת במסך:
   *מתי* הרוח מגיעה, כמה זמן היא נשארת, והאם היא בשיא או בגסיסה.
   המספר הבודד בכרטיס אומר "כמה"; זה אומר "מתי".

   שלוש החלטות שאסור לבטל בלי לקרוא את ההסבר במקום:
   1. ציר הזמן מתהפך *במיפוי* ולא ב-transform (ראה `X` למטה).
   2. `null` הוא חור בנתונים ולא אפס קשר (ראה `buildRuns`).
   3. סקאלת ה-Y קבועה 0→30 קשר כדי ששני כרטיסים יהיו ברי-השוואה בעין.
      ערך מעל 35 *נצמד* לתקרה ומסומן — לא נחתך בשקט.

   כל הצבעים מגיעים מ-currentColor / var(--lv) / var(--sp-*).
   רשימת המשתנים המלאה בתחתית הקובץ.
   ========================================================================= */

/** תקרת סקאלת ה-Y בקשרים. קבועה בכוונה — השוואה בין כרטיסים. */
export const SPARK_Y_MAX_KT = 30;

/** פריסת ברירת המחדל של הציר. גם ספוט תרמי מצויר על הפריסה הזאת. */
export const SPARK_SPAN = { start: 6, end: 21 };

export const SPARK_DEFAULTS = {
  width: 320,
  height: 46,
  dayStart: SPARK_SPAN.start,
  dayEnd: SPARK_SPAN.end,
  // פער שעות שמעליו רצף נשבר. 3 כדי לתמוך גם במודל תלת-שעתי בלי לפורר אותו.
  maxGapHours: 3,
};

export const SPARK_VIEWBOX = `0 0 ${SPARK_DEFAULTS.width} ${SPARK_DEFAULTS.height}`;

export function sparkViewBox(width = SPARK_DEFAULTS.width, height = SPARK_DEFAULTS.height) {
  return `0 0 ${width} ${height}`;
}

/**
 * רצועות הרכיבוּת. הספים תואמים ל-bands.js (speedBandLabel / speedScore).
 * הן רקע — סקאלה, לא הנושא.
 */
/** סף הרכיבוּת המינימלי בקשרים — תואם ל-MIN_RIDEABLE_KT במנוע */
export const SPARK_THRESHOLD_KT = 12;

export const SPARK_BANDS = [
  { from: 0,  to: 12, key: 'light' },     // מתחת לסף הרכיבה
  { from: 12, to: 15, key: 'marginal' },  // גבולי
  { from: 15, to: 22, key: 'ideal' },     // רוח טובה
  { from: 22, to: 28, key: 'strong' },    // רוח חזקה
  { from: 28, to: SPARK_Y_MAX_KT, key: 'extreme' }, // למומחים / מסוכן
];

/** תוויות השעה. שלוש נקודות עיגון, לא ציר מלא. */
const LABEL_HOURS = [6, 12, 18];

/* ------------------------------------------------------------------ */
/* עזרי מספרים — שער יחיד שדרכו עוברת כל קואורדינטה.                   */
/* NaN בודד בתוך `d` הורג את כל ה-path בשקט, בלי שגיאה בקונסול.        */
/* ------------------------------------------------------------------ */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : null);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** עיגול ל-2 ספרות — יש עד ~20 גרפים בדף אחד, וכל ספרה היא בייטים */
const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : NaN);

/** שער אחרון לפני שמחרוזת נפלטת. אלמנט עם קואורדינטה פגומה נזרק שלם. */
const safe = (s) =>
  (typeof s === 'string' && s.length > 0 && !/NaN|Infinity|undefined/.test(s) ? s : '');

/* ------------------------------------------------------------------ */
/* גיאומטריה                                                           */
/* ------------------------------------------------------------------ */

function geometry(opts = {}) {
  const width = Math.max(1, num(opts.width) ?? SPARK_DEFAULTS.width);
  const height = Math.max(1, num(opts.height) ?? SPARK_DEFAULTS.height);
  const compact = opts.compact === true;

  // dayStart/dayEnd הן *שעות הרלוונטיות של הספוט*, לא הפריסה של הציר.
  // ספוט תרמי מוסר 12→18 — ואנחנו עדיין מציירים 06→21 ורק מדגישים
  // את התחום שלו. אחרת שני כרטיסים זה לצד זה מציגים סקאלות זמן שונות
  // באותו רוחב פיקסלים, וזה שקר ויזואלי.
  const dayStart = num(opts.dayStart) ?? SPARK_DEFAULTS.dayStart;
  const dayEnd = num(opts.dayEnd) ?? SPARK_DEFAULTS.dayEnd;
  let spanStart = Math.min(dayStart, SPARK_SPAN.start);
  let spanEnd = Math.max(dayEnd, SPARK_SPAN.end);
  if (!(spanEnd > spanStart)) { spanStart = SPARK_SPAN.start; spanEnd = SPARK_SPAN.end; }

  const labelH = compact ? 0 : 11;
  const yTop = 4;
  const yBase = Math.max(yTop + 1, height - labelH - 0.5);

  /**
   * ⚠️⚠️ ציר הזמן רץ ימין→שמאל: 06:00 בקצה הימני, 21:00 בקצה השמאלי.
   * הדף כולו dir="rtl" והעין הישראלית קוראת את היום מימין.
   *
   * ההיפוך נעשה *כאן, במיפוי*, ולעולם לא ב-`transform: scaleX(-1)`.
   * טרנספורם מראה היה הופך גם את תוויות השעה, ובקומפוננטת המצפן האחות
   * הוא היה הופך **בשקט את חץ כיוון הרוח** — הסימן הכי בטיחותי במסך:
   * אונשור היה נראה אופשור.
   * אל "תפשט" את זה לטרנספורם. זה לא פישוט, זו תקלת בטיחות.
   */
  const X = (hour) => {
    const h = num(hour);
    if (h == null) return NaN;
    return width - ((h - spanStart) / (spanEnd - spanStart)) * width;
  };

  /** 0 קשר על הבסיס, 30 קשר בתקרה. הצמדה (clamp) ולא חיתוך. */
  const Y = (kt) => {
    const v = num(kt);
    if (v == null) return NaN;
    return yBase - (clamp(v, 0, SPARK_Y_MAX_KT) / SPARK_Y_MAX_KT) * (yBase - yTop);
  };

  return { width, height, compact, dayStart, dayEnd, spanStart, spanEnd, yTop, yBase, X, Y };
}

/** מיפוי השעה לציר ה-X. מיוצא כדי שהבדיקות והרכיבים האחים ישתמשו באותו מיפוי. */
export function sparkX(hour, opts = {}) {
  return geometry(opts).X(hour);
}

/** מיפוי קשרים לציר ה-Y. */
export function sparkY(kt, opts = {}) {
  return geometry(opts).Y(kt);
}

/* ------------------------------------------------------------------ */
/* אינטרפולציה מונוטונית (Fritsch–Carlson)                             */
/* ------------------------------------------------------------------ */

/**
 * שיפועים מונוטוניים. למה לא ספליין קרדינלי פשוט:
 * ספליין רגיל "מזנק" סביב שיא — מצייר 26 קשר איפה שהמודל אמר 22,
 * ומטפס מתחת לאפס אחרי צניחה. שניהם שקר על רוח.
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
 * הופך סדרת נקודות (במרחב הנתונים: שעה↔קשר) לקטעי בזייה קוביים.
 * נקודות הבקרה מחושבות **במרחב הנתונים** ורק אז ממופות דרך X/Y — שתיהן
 * אפיניות, ולכן ההמרה מדויקת ואין צורך לשחזר את הספליין בפיקסלים.
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
 * מפצל את השעות לרצפים רציפים של נתון תקין.
 *
 * ⚠️ `null` הוא חור, לא אפס. אפליקציית רוח שמציירת נתון חסר כקו על הרצפה
 * אומרת לגולש "אין רוח" בדיוק כשהיא לא יודעת. הרצף נשבר, ולא נסגר בקו.
 * גם קפיצה של יותר מ-maxGapHours שוברת — סמיכות במערך אינה רציפות בזמן.
 */
function buildRuns(hours, g, maxGapHours) {
  const pts = [];
  const seen = new Set();
  for (const h of Array.isArray(hours) ? hours : []) {
    if (!h || typeof h !== 'object') continue;
    const hour = num(h.hour);
    if (hour == null) continue;
    if (hour < g.spanStart || hour > g.spanEnd) continue;
    if (seen.has(hour)) continue;
    seen.add(hour);
    let speed = num(h.speedKt);
    if (speed != null && speed < 0) speed = 0;
    let gust = num(h.gustKt);
    if (gust != null && gust < 0) gust = 0;
    // משב נמוך מהממוצע הוא רעש מודל, לא מידע. המעטפת לא הופכת את עצמה.
    if (gust != null && speed != null && gust < speed) gust = speed;
    pts.push({ hour, speed, gust });
  }
  pts.sort((a, b) => a.hour - b.hour);

  const runs = [];
  let cur = null;
  let prevHour = null;
  for (const p of pts) {
    if (p.speed == null) {
      cur = null;            // חור מפורש — שובר את הרצף
      prevHour = p.hour;
      continue;
    }
    if (prevHour != null && p.hour - prevHour > maxGapHours) cur = null;
    if (!cur) { cur = []; runs.push(cur); }
    cur.push(p);
    prevHour = p.hour;
  }
  return runs;
}

/* ------------------------------------------------------------------ */
/* השכבות                                                              */
/* ------------------------------------------------------------------ */

function layerBands(g) {
  let out = '';
  for (const b of SPARK_BANDS) {
    const yHi = g.Y(b.to);
    const yLo = g.Y(b.from);
    const h = yLo - yHi;
    if (!isNum(h) || h <= 0) continue;
    out += safe(
      `<rect class="sp-band sp-band--${b.key}" x="0" y="${r2(yHi)}" width="${r2(g.width)}" height="${r2(h)}" ` +
      `fill="var(--sp-band-${b.key}, transparent)"/>`
    );
  }
  return out;
}

/**
 * קו סף הרכיבוּת — 12 קשר.
 *
 * בלעדיו, ביום חלש כל העקומה נדבקת לתחתית הגרף ונקראת כ"אין מידע".
 * עם הקו, אותה עקומה נקראת כ"היום כולו מתחת לסף" — וזו בדיוק
 * ההודעה. סולם קבוע 0–35 נשמר, כדי שכרטיסים יהיו ברי-השוואה.
 */
function layerThreshold(g) {
  const y = g.Y(SPARK_THRESHOLD_KT);
  if (!isNum(y)) return '';
  return safe(
    `<line class="sp-threshold" x1="0" y1="${r2(y)}" x2="${r2(g.width)}" y2="${r2(y)}" ` +
    `stroke="var(--sp-threshold, currentColor)" stroke-opacity="var(--sp-threshold-opacity, 0.45)" ` +
    `stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>` +
    `<text class="sp-threshold-label" x="${r2(g.width - 3)}" y="${r2(y - 3)}" text-anchor="end" ` +
    `fill="var(--sp-threshold, currentColor)" fill-opacity="var(--sp-threshold-opacity, 0.45)">12</text>`
  );
}

/** עמעום השעות שמחוץ לתחום הרלוונטי של הספוט (תרמי: 12→18) */
function layerOffHours(g) {
  const segs = [];
  if (g.dayStart > g.spanStart) segs.push([g.spanStart, g.dayStart]);
  if (g.dayEnd < g.spanEnd) segs.push([g.dayEnd, g.spanEnd]);
  let out = '';
  for (const [a, b] of segs) {
    const xL = g.X(b);
    const w = g.X(a) - xL;
    if (!isNum(w) || w <= 0) continue;
    out += safe(
      `<rect class="sp-offhours" x="${r2(xL)}" y="0" width="${r2(w)}" height="${r2(g.height)}" ` +
      `fill="var(--sp-offhours, transparent)" fill-opacity="var(--sp-offhours-opacity, 0.35)"/>`
    );
  }
  return out;
}

/** מעטפת המשבים — עובי הפס *הוא* המידע: יום סוער נראה עבה, יום חלק דק */
function layerFill(runs, g) {
  let out = '';
  for (const run of runs) {
    if (run.length < 2) continue;
    const xs = run.map((p) => p.hour);
    const mean = run.map((p) => clamp(p.speed, 0, SPARK_Y_MAX_KT));
    const segs = bezierSegments(xs, mean);
    const first = segs[0];
    const last = segs[segs.length - 1];
    const d =
      pathForward(segs, g.X, g.Y) +
      ` L${r2(g.X(last.x1))},${r2(g.yBase)}` +
      ` L${r2(g.X(first.x0))},${r2(g.yBase)} Z`;
    out += safe(
      `<path class="sp-fill" d="${d}" fill="var(--sp-fill, currentColor)" ` +
      `fill-opacity="var(--sp-fill-opacity, 0.14)" stroke="none"/>`
    );
  }
  return out;
}

function layerArea(runs, g) {
  let out = '';
  for (const run of runs) {
    if (run.length < 2) continue;
    const xs = run.map((p) => p.hour);
    const mean = run.map((p) => clamp(p.speed, 0, SPARK_Y_MAX_KT));
    const gust = run.map((p) => clamp(p.gust ?? p.speed, 0, SPARK_Y_MAX_KT));
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
      `<path class="sp-area" d="${d}" fill="var(--sp-area, currentColor)" ` +
      `fill-opacity="var(--sp-area-opacity, 0.18)" stroke="none"/>`
    );
  }
  return out;
}

/** קו הרוח הממוצעת. רצף אחד = path אחד; חור בנתונים = path נוסף. */
function layerLine(runs, g) {
  let out = '';
  for (const run of runs) {
    if (run.length < 2) continue;
    const xs = run.map((p) => p.hour);
    const ys = run.map((p) => clamp(p.speed, 0, SPARK_Y_MAX_KT));
    const d = pathForward(bezierSegments(xs, ys), g.X, g.Y);
    out += safe(
      `<path class="sp-line" d="${d}" fill="none" stroke="var(--sp-line, var(--lv, currentColor))" ` +
      `stroke-width="var(--sp-line-width, 1.6)" stroke-linecap="round" stroke-linejoin="round" ` +
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
      `<circle class="sp-dot" cx="${r2(g.X(p.hour))}" cy="${r2(g.Y(clamp(p.speed, 0, SPARK_Y_MAX_KT)))}" ` +
      `r="1.6" fill="var(--sp-dot, var(--lv, currentColor))"/>`
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
        (p.speed != null && p.speed > SPARK_Y_MAX_KT) ||
        (p.gust != null && p.gust > SPARK_Y_MAX_KT);
      if (!over) continue;
      const x = g.X(p.hour);
      const y = g.yTop;
      const d = `M${r2(x - 2.6)},${r2(y + 2.8)} L${r2(x)},${r2(y - 0.2)} L${r2(x + 2.6)},${r2(y + 2.8)}`;
      out += safe(
        `<path class="sp-over" d="${d}" fill="none" stroke="var(--sp-over, var(--lv, currentColor))" ` +
        `stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
      );
    }
  }
  return out;
}

/**
 * החלון הנבחר של המנוע. endHour הוא בלעדי (pickWindow מחזיר lastHour+1),
 * ולכן הצביעה עד endHour מכסה בדיוק את משך הבלוק.
 * מצויר *מעל* הקו, ולכן: מילוי חלש + פס עבה על הבסיס. בלי לכסות את הקו.
 */
function layerWindow(win, g) {
  if (!win) return '';
  const a = num(win.startHour);
  const b = num(win.endHour);
  if (a == null || b == null || b <= a) return '';
  const s = clamp(a, g.spanStart, g.spanEnd);
  const e = clamp(b, g.spanStart, g.spanEnd);
  if (!(e > s)) return '';
  const xL = g.X(e);
  const w = g.X(s) - xL;
  if (!isNum(w) || w <= 0) return '';
  const bar = r2(g.yBase + 1);
  return (
    safe(
      `<rect class="sp-window" x="${r2(xL)}" y="${r2(Math.max(0, g.yTop - 2))}" width="${r2(w)}" ` +
      `height="${r2(g.yBase - Math.max(0, g.yTop - 2))}" ` +
      `fill="var(--sp-window, var(--lv, currentColor))" fill-opacity="var(--sp-window-opacity, 0.12)"/>`
    ) +
    safe(
      `<line class="sp-window-bar" x1="${r2(xL)}" y1="${bar}" x2="${r2(xL + w)}" y2="${bar}" ` +
      `stroke="var(--sp-window, var(--lv, currentColor))" stroke-width="var(--sp-window-bar-width, 2.5)" ` +
      `stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
    )
  );
}

/** קו "עכשיו". מצויר רק כשהיום המוצג הוא היום, ורק אם השעה בתוך הפריסה. */
function layerNow(nowHour, g) {
  const n = num(nowHour);
  if (n == null || n < g.spanStart || n > g.spanEnd) return '';
  const x = g.X(n);
  return safe(
    `<line class="sp-now" x1="${r2(x)}" y1="${r2(Math.max(0, g.yTop - 3))}" x2="${r2(x)}" ` +
    `y2="${r2(g.yBase + 1)}" stroke="var(--sp-now, currentColor)" ` +
    `stroke-opacity="var(--sp-now-opacity, 0.7)" stroke-width="1" vector-effect="non-scaling-stroke"/>`
  );
}

function layerAxis(g) {
  const y = r2(g.yBase + 0.5);
  return safe(
    `<line class="sp-axis" x1="0" y1="${y}" x2="${r2(g.width)}" y2="${y}" ` +
    `stroke="var(--sp-axis, currentColor)" stroke-opacity="var(--sp-axis-opacity, 0.25)" ` +
    `stroke-width="1" vector-effect="non-scaling-stroke"/>`
  );
}

function layerLabels(g) {
  if (g.compact) return '';
  let out = '';
  const y = r2(g.height - 2);
  for (const h of LABEL_HOURS) {
    if (h < g.spanStart || h > g.spanEnd) continue;
    // הצמדה פנימה כדי שהתווית בקצה (06 מימין) לא תיחתך
    const x = clamp(g.X(h), 9, g.width - 9);
    const txt = String(h).padStart(2, '0');
    out += safe(
      `<text class="sp-label" x="${r2(x)}" y="${y}" text-anchor="middle" font-size="8" ` +
      `fill="var(--sp-label, currentColor)" fill-opacity="var(--sp-label-opacity, 0.55)">${txt}</text>`
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* ה-API                                                               */
/* ------------------------------------------------------------------ */

/**
 * מחזיר את *תוכן* ה-SVG (בלי תגית העטיפה).
 * סדר השכבות מלמטה למעלה: רצועות → עמעום שעות → מעטפת → קו → נקודות
 * → סימון תקרה → חלון → עכשיו → ציר → תוויות.
 *
 * @param {Array<{hour:number,dayIndex:number,speedKt:?number,gustKt:?number,dirDeg:?number}>} hours
 *        שעות של יום *אחד* — הסינון באחריות הקורא.
 * @param {object} opts { window, nowHour, dayStart, dayEnd, width, height, compact, maxGapHours }
 * @returns {string}
 */
export function renderSparkline(hours, opts = {}) {
  const o = opts || {};
  const g = geometry(o);
  const maxGapHours = Math.max(1, num(o.maxGapHours) ?? SPARK_DEFAULTS.maxGapHours);
  const runs = buildRuns(hours, g, maxGapHours);

  return [
    layerBands(g),
    layerOffHours(g),
    layerThreshold(g),
    layerFill(runs, g),
    layerArea(runs, g),
    layerLine(runs, g),
    layerDots(runs, g),
    layerOverflow(runs, g),
    layerWindow(o.window, g),
    layerNow(o.nowHour, g),
    layerAxis(g),
    layerLabels(g),
  ].join('');
}

/**
 * אותו דבר, עטוף בתגית SVG שלמה.
 *
 * aria-hidden — סיכום מילולי של היום מוגש בנפרד בכרטיס. קורא מסך שמנסה
 * להקריא path הוא רעש, לא נגישות.
 *
 * preserveAspectRatio="none" רק במצב compact: מתיחה לא-אחידה מועילה
 * לגרף שממלא את רוחב הכרטיס, אבל היא *מעוותת גם את תוויות השעה*.
 * לכן כשיש תוויות — meet. אפשר לכפות דרך opts.preserveAspectRatio.
 */
export function renderSparklineSVG(hours, opts = {}) {
  const o = opts || {};
  const g = geometry(o);
  const par = typeof o.preserveAspectRatio === 'string'
    ? o.preserveAspectRatio
    : (g.compact ? 'none' : 'xMidYMid meet');
  const cls = `sparkline${g.compact ? ' sparkline--compact' : ''}`;
  return (
    `<svg class="${cls}" viewBox="${sparkViewBox(r2(g.width), r2(g.height))}" ` +
    `width="100%" height="${r2(g.height)}" preserveAspectRatio="${par}" ` +
    `aria-hidden="true" focusable="false" role="presentation" xmlns="http://www.w3.org/2000/svg">` +
    renderSparkline(hours, o) +
    `</svg>`
  );
}

/* =========================================================================
   משתני ה-CSS שהקובץ צורך (כולם עם נפילה-לאחור סבירה):
     --sp-band-light · --sp-band-marginal · --sp-band-ideal ·
     --sp-band-strong · --sp-band-extreme      (נפילה: transparent)
     --sp-offhours (transparent) · --sp-offhours-opacity (0.35)
     --sp-area (currentColor) · --sp-area-opacity (0.18)
     --sp-line (var(--lv, currentColor)) · --sp-line-width (1.6)
     --sp-dot (var(--lv, currentColor))
     --sp-over (var(--lv, currentColor))
     --sp-window (var(--lv, currentColor)) · --sp-window-opacity (0.12) ·
     --sp-window-bar-width (2.5)
     --sp-now (currentColor) · --sp-now-opacity (0.7)
     --sp-axis (currentColor) · --sp-axis-opacity (0.25)
     --sp-label (currentColor) · --sp-label-opacity (0.55)

   המחלקות שנפלטות:
     sparkline · sparkline--compact · sp-band (+ sp-band--light|marginal|
     ideal|strong|extreme) · sp-offhours · sp-area · sp-line · sp-dot ·
     sp-over · sp-window · sp-window-bar · sp-now · sp-axis · sp-label

   הערה ל-CSS: המילוי נכתב גם כתכונת-הצגה (presentation attribute) על
   האלמנט. תכונת-הצגה מפסידה לכל כלל CSS, ולכן הפלטה שולטת דרך המחלקות
   וה-attribute הוא רק נפילה-לאחור כשאין גיליון סגנון.
   ========================================================================= */
