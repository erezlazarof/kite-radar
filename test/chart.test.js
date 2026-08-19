/* =========================================================================
   בדיקות המטאוגרם המלא (public/js/ui/chart.js)
   -------------------------------------------------------------------------
   שלוש מהבדיקות כאן אינן בדיקות "עיצוב" אלא בדיקות בטיחות:
   כיוון ציר הזמן, קונבנציית חץ הרוח, והאיסור על טרנספורם מראה.
   מי שנופל באחת מהן שלח גולש לים עם מידע הפוך.
   ========================================================================= */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  renderChart,
  chartHitTest,
  chartX,
  chartT,
  chartHourAtX,
  arrowRotationDeg,
  CHART_Y_MAX_KT,
  CHART_DEFAULTS,
} from '../public/js/ui/chart.js';

const SRC_URL = new URL('../public/js/ui/chart.js', import.meta.url);

const OPTS = { width: 340, height: 170, days: 3, dayStart: 6, dayEnd: 21 };

/** 72 שעות סינתטיות, גל יומי סביר, בלי חורים */
function fullHours(over = {}) {
  const out = [];
  for (let d = 0; d < 3; d++) {
    for (let h = 0; h < 24; h++) {
      const speed = 8 + 9 * Math.max(0, Math.sin(((h - 4) / 24) * Math.PI * 2));
      out.push({
        hour: h,
        dayIndex: d,
        tsMs: 1_700_000_000_000 + (d * 24 + h) * 3_600_000,
        speedKt: Math.round(speed * 10) / 10,
        gustKt: Math.round(speed * 1.3 * 10) / 10,
        dirDeg: (250 + h * 2) % 360,
        ...over,
      });
    }
  }
  return out;
}

const BAD_TOKENS = /NaN|Infinity|undefined/;

/** צבע לגיטימי בקובץ הזה: none, currentColor, או custom property */
function isTokenColor(v) {
  return v === 'none' || v === 'currentColor' || /^var\(--[a-z0-9-]+(,.*)?\)$/i.test(v);
}

function colorAttrs(svg) {
  const out = [];
  const re = /\s(fill|stroke)="([^"]*)"/g;
  let m;
  while ((m = re.exec(svg)) !== null) out.push({ name: m[1], value: m[2] });
  return out;
}

function countOf(hay, needle) {
  return hay.split(needle).length - 1;
}

/* ------------------------------------------------------------------ */
/* 1. ציר הזמן רץ ימין→שמאל                                            */
/* ------------------------------------------------------------------ */

test('RTL: השעה המוקדמת יושבת ימינה מהמאוחרת', () => {
  const x06 = chartX(6, 0, OPTS);
  const x18 = chartX(18, 0, OPTS);
  assert.ok(Number.isFinite(x06) && Number.isFinite(x18));
  assert.ok(x06 > x18, `06:00 (x=${x06}) חייב להיות ימינה מ-18:00 (x=${x18})`);
});

test('RTL: היום כולו ימינה ממחר, ומחר ימינה ממחרתיים', () => {
  const xs = (d) => Array.from({ length: 24 }, (_, h) => chartX(h, d, OPTS));
  const day0 = xs(0);
  const day1 = xs(1);
  const day2 = xs(2);
  assert.ok(Math.min(...day0) > Math.max(...day1), 'יום 0 חייב להיות כולו ימינה מיום 1');
  assert.ok(Math.min(...day1) > Math.max(...day2), 'יום 1 חייב להיות כולו ימינה מיום 2');
});

test('RTL: הקצה הימני הוא תחילת החלון והשמאלי סופו', () => {
  const first = chartX(0, 0, OPTS);
  const last = chartX(23, 2, OPTS);
  assert.equal(first, OPTS.width);        // t=0 יושב בדיוק על הקצה הימני
  assert.ok(last < first);
});

/* ------------------------------------------------------------------ */
/* 2. hit-test עובר דרך אותו מיפוי שמצייר                              */
/* ------------------------------------------------------------------ */

test('hitTest: round-trip מלא — כל שעה חוזרת לעצמה', () => {
  const hours = fullHours();
  for (const p of hours) {
    const x = chartX(p.hour, p.dayIndex, OPTS);
    const frac = x / OPTS.width;
    const hit = chartHitTest(hours, OPTS, frac);
    assert.ok(hit, `אין תוצאה עבור יום ${p.dayIndex} שעה ${p.hour}`);
    assert.equal(hit.hour, p.hour, `שעה ${p.hour} ביום ${p.dayIndex} חזרה כ-${hit.hour}`);
    assert.equal(hit.dayIndex, p.dayIndex);
    assert.equal(hit.speedKt, p.speedKt);
    assert.equal(hit.gustKt, p.gustKt);
    assert.equal(hit.dirDeg, p.dirDeg);
    assert.equal(hit.tsMs, p.tsMs);
  }
});

test('hitTest: chartHourAtX הוא ההיפוך המדויק של chartX', () => {
  for (const [h, d] of [[0, 0], [6, 0], [13, 1], [23, 2], [18, 2]]) {
    const back = chartHourAtX(chartX(h, d, OPTS), OPTS);
    assert.deepEqual(back, { t: chartT(h, d), hour: h, dayIndex: d });
  }
});

test('hitTest: קלט חסר או ריק מחזיר null ולא זורק', () => {
  assert.equal(chartHitTest([], OPTS, 0.5), null);
  assert.equal(chartHitTest(null, OPTS, 0.5), null);
  assert.equal(chartHitTest('nope', OPTS, 0.5), null);
  assert.equal(chartHitTest(fullHours(), OPTS, 'nope'), null);
  assert.equal(chartHitTest(fullHours(), null, NaN), null);
});

test('hitTest: אצבע באמצע חור בן יממה לא מקבלת את הערך שמעבר לחור', () => {
  // רק יום 0 קיים בנתונים; לוחצים על אמצע יום 2
  const hours = fullHours().filter((p) => p.dayIndex === 0);
  const x = chartX(12, 2, OPTS);
  assert.equal(chartHitTest(hours, OPTS, x / OPTS.width), null);
});

test('hitTest: שעה בלי מהירות מחזירה null במהירות, לא אפס', () => {
  const hours = fullHours().map((p) => ({ ...p, speedKt: null, gustKt: null }));
  const hit = chartHitTest(hours, OPTS, chartX(12, 1, OPTS) / OPTS.width);
  assert.ok(hit);
  assert.equal(hit.hour, 12);
  assert.equal(hit.dayIndex, 1);
  assert.equal(hit.speedKt, null);
  assert.equal(hit.gustKt, null);
});

test('hitTest: הקצוות נצמדים פנימה במקום ליפול', () => {
  const hours = fullHours();
  const right = chartHitTest(hours, OPTS, 1);
  const left = chartHitTest(hours, OPTS, 0);
  assert.ok(right && left);
  assert.equal(right.dayIndex, 0);          // ימין = תחילת החלון
  assert.equal(right.hour, 0);
  assert.equal(left.dayIndex, 2);           // שמאל = סופו
  assert.equal(left.hour, 23);
});

/* ------------------------------------------------------------------ */
/* 3. null הוא חור, לא אפס                                             */
/* ------------------------------------------------------------------ */

test('חורים: יממה חסרה מפצלת את הקו לשני קטעים', () => {
  const hours = fullHours().map((p) =>
    p.dayIndex === 1 ? { ...p, speedKt: null, gustKt: null } : p
  );
  const svg = renderChart(hours, OPTS);
  assert.equal(countOf(svg, 'class="ch-line"'), 2, 'שני רצפים = שני paths');
});

test('חורים: נתון רציף מצייר קו אחד בלבד', () => {
  const svg = renderChart(fullHours(), OPTS);
  assert.equal(countOf(svg, 'class="ch-line"'), 1);
});

test('חורים: הקו לא נסגר דרך אפס — אין נקודה על הבסיס בתוך החור', () => {
  const hours = fullHours().map((p) =>
    p.dayIndex === 1 ? { ...p, speedKt: null, gustKt: null } : p
  );
  const svg = renderChart(hours, OPTS);
  // אילו החור היה מצויר כאפס, היה קיים path יחיד שחוצה את מרכז הגרף
  const paths = [...svg.matchAll(/class="ch-line" d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(paths.length, 2);
  for (const d of paths) assert.ok(!BAD_TOKENS.test(d));
});

test('חורים: שעה בודדת בין שני חורים מצוירת כנקודה ולא נעלמת', () => {
  const hours = [
    { hour: 10, dayIndex: 0, speedKt: null },
    { hour: 12, dayIndex: 0, speedKt: 18, gustKt: 22, dirDeg: 270 },
    { hour: 14, dayIndex: 0, speedKt: null },
  ];
  const svg = renderChart(hours, OPTS);
  assert.equal(countOf(svg, 'class="ch-dot"'), 1);
  assert.equal(countOf(svg, 'class="ch-line"'), 0);
});

test('חורים: null בקצוות לא מייצר קטע דמה', () => {
  const hours = fullHours().map((p) =>
    p.hour < 3 || p.hour > 21 ? { ...p, speedKt: null, gustKt: null } : p
  );
  const svg = renderChart(hours, OPTS);
  assert.equal(countOf(svg, 'class="ch-line"'), 3);   // רצף אחד לכל יום
  assert.ok(!BAD_TOKENS.test(svg));
});

/* ------------------------------------------------------------------ */
/* 4. שום NaN / undefined / Infinity לא מגיע ל-attribute               */
/* ------------------------------------------------------------------ */

test('שפיות: פלט תקין לקלט רגיל', () => {
  const svg = renderChart(fullHours(), {
    ...OPTS,
    nowHour: 14,
    nowDayIndex: 0,
    level: 'green',
    windows: [{ dayIndex: 0, startHour: 11, endHour: 17 }, { dayIndex: 2, startHour: 9, endHour: 13 }],
  });
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(!BAD_TOKENS.test(svg), 'ערך פגום דלף לפלט');
});

test('שפיות: קלט שכולו null', () => {
  const hours = fullHours().map((p) => ({
    ...p, speedKt: null, gustKt: null, dirDeg: null,
  }));
  const svg = renderChart(hours, OPTS);
  assert.ok(!BAD_TOKENS.test(svg));
  assert.equal(countOf(svg, 'class="ch-line"'), 0);
  assert.equal(countOf(svg, 'class="ch-arrow"'), 0);
  // הרצועות והסף עדיין שם — "אין נתונים" נראה אחרת מ"אין רוח"
  assert.ok(svg.includes('ch-threshold'));
  assert.equal(countOf(svg, 'class="ch-band '), 5);
});

test('שפיות: מערך ריק, לא-מערך ובלי opts בכלל', () => {
  for (const svg of [renderChart([], OPTS), renderChart('nope', OPTS), renderChart(), renderChart([], null)]) {
    assert.ok(svg.startsWith('<svg '));
    assert.ok(!BAD_TOKENS.test(svg));
  }
});

test('שפיות: קלט זבל מכוון', () => {
  const junk = [
    null, undefined, 0, 'x', [], true,
    {},
    { hour: 'שש' },
    { hour: NaN, speedKt: 20 },
    { hour: Infinity, speedKt: 20 },
    { hour: 5, dayIndex: {}, speedKt: '20', gustKt: [], dirDeg: 'W', tsMs: 'now' },
    { hour: 6, dayIndex: 0, speedKt: -4, gustKt: -9, dirDeg: -900 },
    { hour: 7, dayIndex: 0, speedKt: 1e9, gustKt: Infinity, dirDeg: 1e9 },
    { hour: 8, dayIndex: 0, speedKt: 19, gustKt: 12, dirDeg: 270 },   // משב מתחת לממוצע
    { hour: 8, dayIndex: 0, speedKt: 99 },                            // כפילות שעה
  ];
  const svg = renderChart(junk, {
    width: 'wide', height: null, days: -4, dayStart: 'a', dayEnd: {},
    windows: 'no', nowHour: 'z', nowDayIndex: [], level: 42,
    compact: 'yes', maxGapHours: NaN, idPrefix: '<script>',
  });
  assert.ok(!BAD_TOKENS.test(svg), svg.slice(0, 400));
  assert.ok(!svg.includes('<script'), 'idPrefix חייב להיות מסונן');
  assert.ok(svg.includes('chart--unknown'), 'level לא חוקי נופל ל-unknown');
});

test('שפיות: opts חלקיות לא מוציאות ממדים פגומים', () => {
  for (const o of [{}, { width: 0 }, { height: -5 }, { days: 0 }, { days: 1 }, { dayStart: 20, dayEnd: 4 }, { compact: true }]) {
    const svg = renderChart(fullHours(), o);
    assert.ok(!BAD_TOKENS.test(svg), JSON.stringify(o));
  }
});

test('שפיות: ערך מעל התקרה נצמד ומסומן, לא נחתך בשקט', () => {
  const hours = fullHours().map((p) => ({ ...p, speedKt: 42, gustKt: 55 }));
  const svg = renderChart(hours, OPTS);
  assert.ok(!BAD_TOKENS.test(svg));
  assert.ok(countOf(svg, 'class="ch-over"') > 0, 'חייב סימון חריגה מעל ' + CHART_Y_MAX_KT);
});

/* ------------------------------------------------------------------ */
/* 5. הפלטה שייכת ל-CSS                                                */
/* ------------------------------------------------------------------ */

test('צבעים: כל fill/stroke הוא none / currentColor / var(--…)', () => {
  const svg = renderChart(fullHours(), {
    ...OPTS, level: 'yellow', nowHour: 9,
    windows: [{ dayIndex: 1, startHour: 10, endHour: 16 }],
  });
  const attrs = colorAttrs(svg);
  assert.ok(attrs.length > 8, 'לא נמצאו מספיק תכונות צבע — הבדיקה לא באמת רצה');
  for (const a of attrs) {
    assert.ok(isTokenColor(a.value), `${a.name}="${a.value}" אינו טוקן מותר`);
  }
});

test('צבעים: הבודק עצמו פוסל ליטרל צבע', () => {
  assert.ok(!isTokenColor('#0af'));
  assert.ok(!isTokenColor('#00aaff'));
  assert.ok(!isTokenColor('rgb(0, 170, 255)'));
  assert.ok(!isTokenColor('blue'));
  assert.ok(isTokenColor('none'));
  assert.ok(isTokenColor('currentColor'));
  assert.ok(isTokenColor('var(--ch-line, var(--lv, currentColor))'));
});

test('צבעים: אין ליטרל hex בשום מקום בקובץ המקור', () => {
  const src = readFileSync(SRC_URL, 'utf8');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/href="#[\w-]+"/g, '').replace(/#\$\{[^}]+\}/g, '')));
});

/* ------------------------------------------------------------------ */
/* 6. אין טרנספורם מראה — לא היום ולא ב"פישוט" עתידי                   */
/* ------------------------------------------------------------------ */

test('מראה: אין scaleX / matrix / scale שלילי בקוד', () => {
  const src = readFileSync(SRC_URL, 'utf8');
  // ההערות מסבירות *למה אסור* ולכן מזכירות את המונחים. בודקים קוד בלבד.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/scaleX/.test(code), 'scaleX בקוד — היפוך הציר חייב לחיות במיפוי');
  assert.ok(!/matrix\s*\(/.test(code), 'matrix( בקוד');
  assert.ok(!/scale\s*\(\s*-/.test(code), 'scale שלילי בקוד');
  assert.ok(!/transform\s*:\s*scale/.test(code));
});

test('מראה: אין טרנספורם מראה בפלט', () => {
  const svg = renderChart(fullHours(), { ...OPTS, nowHour: 12 });
  assert.ok(!/scaleX/.test(svg));
  assert.ok(!/matrix\s*\(/.test(svg));
  assert.ok(!/scale\s*\(\s*-/.test(svg));
  // הטרנספורם היחיד המותר: מיקום + סיבוב של חץ הכיוון
  for (const m of svg.matchAll(/transform="([^"]*)"/g)) {
    assert.match(m[1], /^translate\([-\d.]+,[-\d.]+\) rotate\([\d.]+\)$/);
  }
});

/* ------------------------------------------------------------------ */
/* 7. קונבנציית חץ הרוח                                                */
/* ------------------------------------------------------------------ */

test('חץ: dirDeg מטאורולוגי, החץ מצביע לאן הרוח הולכת', () => {
  assert.equal(arrowRotationDeg(270), 90);    // רוח מערבית → חץ מזרחה
  assert.equal(arrowRotationDeg(0), 180);     // רוח צפונית → חץ דרומה
  assert.equal(arrowRotationDeg(180), 0);
  assert.equal(arrowRotationDeg(45), 225);
  assert.equal(arrowRotationDeg(-90), 90);
  assert.ok(!Number.isFinite(arrowRotationDeg('W')));
  assert.ok(!Number.isFinite(arrowRotationDeg(null)));
});

test('חץ: הפלט מסובב לפי אותה קונבנציה', () => {
  const hours = fullHours().map((p) => ({ ...p, dirDeg: 270 }));
  const svg = renderChart(hours, OPTS);
  assert.ok(svg.includes('rotate(90)'), 'רוח מערבית חייבת לצאת rotate(90)');
  assert.ok(!svg.includes('rotate(270)'));
});

test('חץ: גליף אחד ב-defs, שימוש חוזר, בערך אחד לשלוש שעות', () => {
  const svg = renderChart(fullHours(), OPTS);
  assert.equal(countOf(svg, '<defs>'), 1);
  assert.equal(countOf(svg, '<path d="M0,-4.2'), 1, 'הגליף חייב להיות מוגדר פעם אחת');
  const arrows = countOf(svg, 'class="ch-arrow"');
  assert.ok(arrows >= 23 && arrows <= 25, `צפוי ~24 חצים ל-72 שעות, יצאו ${arrows}`);
  assert.equal(countOf(svg, 'href="#ch-arrow"'), arrows);
});

/* ------------------------------------------------------------------ */
/* 8. שאר השכבות נמצאות                                                */
/* ------------------------------------------------------------------ */

test('שכבות: כל מה שהפאנל מבטיח באמת מצויר', () => {
  const svg = renderChart(fullHours(), {
    ...OPTS, level: 'green', nowHour: 15, nowDayIndex: 0,
    windows: [{ dayIndex: 0, startHour: 12, endHour: 18 }],
  });
  for (const cls of [
    'ch-night', 'ch-band--light', 'ch-band--ideal', 'ch-threshold', 'ch-threshold-label',
    'ch-window', 'ch-area', 'ch-line', 'ch-daysep', 'ch-daylabel', 'ch-arrow',
    'ch-now', 'ch-axis', 'ch-yaxis', 'ch-ytick', 'ch-label',
  ]) {
    assert.ok(svg.includes(cls), `חסרה שכבה: ${cls}`);
  }
  assert.ok(svg.includes('>היום<') && svg.includes('>מחר<') && svg.includes('>מחרתיים<'));
  assert.equal(countOf(svg, 'class="ch-daysep"'), 2, 'רק גבולות פנימיים');
  assert.equal(countOf(svg, 'class="ch-ytick"'), 3);
  assert.equal(countOf(svg, 'class="ch-label"'), 9, '06/12/18 לכל יום');
});

test('שכבות: קו "עכשיו" מצויר על היום הנכון בלבד', () => {
  const withNow = renderChart(fullHours(), { ...OPTS, nowHour: 15, nowDayIndex: 1 });
  const noNow = renderChart(fullHours(), { ...OPTS, nowHour: null });
  assert.equal(countOf(withNow, 'class="ch-now"'), 1);
  assert.equal(countOf(noNow, 'class="ch-now"'), 0);
  // 15:00 של מחר חייב לשבת שמאלה מ-15:00 של היום
  const x1 = Number(withNow.match(/class="ch-now" x1="([-\d.]+)"/)[1]);
  assert.ok(x1 < chartX(15, 0, OPTS));
});

test('שכבות: חלון מחוץ לתחום או הפוך פשוט לא מצויר', () => {
  const svg = renderChart(fullHours(), {
    ...OPTS,
    windows: [
      { dayIndex: 0, startHour: 17, endHour: 11 },   // הפוך
      { dayIndex: 9, startHour: 10, endHour: 14 },   // מעבר לחלון
      { dayIndex: 1, startHour: 10, endHour: 14 },   // תקין
    ],
  });
  assert.equal(countOf(svg, 'class="ch-window"'), 1);
  assert.ok(!BAD_TOKENS.test(svg));
});

test('שכבות: מצב compact מוותר על התוויות אבל לא על הגרף', () => {
  const svg = renderChart(fullHours(), { ...OPTS, compact: true });
  assert.ok(svg.includes('chart--compact'));
  assert.ok(svg.includes('ch-line'));
  assert.equal(countOf(svg, 'class="ch-label"'), 0);
  assert.equal(countOf(svg, 'class="ch-daylabel"'), 0);
  assert.equal(countOf(svg, 'class="ch-arrow"'), 0);
  assert.ok(!BAD_TOKENS.test(svg));
});

test('שכבות: הסקאלה זהה ל-sparkline — 0 עד 30 קשר', () => {
  assert.equal(CHART_Y_MAX_KT, 30);
  assert.equal(CHART_DEFAULTS.days, 3);
});
