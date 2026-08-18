/* =========================================================================
   בדיקות המטאוגרם המיקרו.
   הקובץ הנבדק טהור — אין DOM, ולכן כל בדיקה כאן היא מחרוזת מול מחרוזת.
   ========================================================================= */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderSparkline,
  renderSparklineSVG,
  sparkX,
  sparkY,
  SPARK_DEFAULTS,
  SPARK_Y_MAX_KT,
} from '../public/js/ui/sparkline.js';

/** יום הגיוני: רוח שמתעוררת בצהריים, שיא ב-15, גוססת לערב */
function normalDay() {
  const curve = {
    6: 4, 7: 5, 8: 6, 9: 8, 10: 11, 11: 14, 12: 17, 13: 19,
    14: 21, 15: 22, 16: 20, 17: 17, 18: 13, 19: 9, 20: 6, 21: 5,
  };
  return Object.entries(curve).map(([h, v]) => ({
    hour: Number(h),
    dayIndex: 0,
    speedKt: v,
    gustKt: v * 1.25,
    dirDeg: 285,
  }));
}

const count = (s, re) => (s.match(re) || []).length;
const nums = (s) => (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

/* ------------------------------------------------------------------ */

test('ציר הזמן רץ ימין→שמאל: 06:00 מימין ל-18:00', () => {
  const opts = { width: 320, height: 46 };
  assert.ok(sparkX(6, opts) > sparkX(18, opts), '06 חייבת להיות ימינה מ-18');
  assert.ok(sparkX(12, opts) > sparkX(18, opts));
  assert.ok(sparkX(18, opts) > sparkX(21, opts));
  // הקצוות: תחילת היום על הקצה הימני, סופו על השמאלי
  assert.equal(sparkX(6, opts), 320);
  assert.equal(sparkX(21, opts), 0);
});

test('ספוט תרמי (12→18) לא מכווץ את הציר — הפריסה נשארת 06→21', () => {
  const thermal = { width: 320, height: 46, dayStart: 12, dayEnd: 18 };
  assert.equal(sparkX(6, thermal), 320);
  assert.equal(sparkX(21, thermal), 0);
  // ההדגשה נעשית בעמעום השעות שמחוץ לתחום, לא בשינוי הסקאלה
  const out = renderSparkline(normalDay(), thermal);
  assert.equal(count(out, /class="sp-offhours"/g), 2);
});

test('ההיפוך נעשה במיפוי ולא ב-transform מראה', () => {
  const out = renderSparklineSVG(normalDay(), { nowHour: 14.5 });
  assert.ok(!/scaleX/.test(out), 'scaleX(-1) היה הופך גם את התוויות ואת חץ הכיוון');
  assert.ok(!/transform=/.test(out));
});

test('null הוא חור: הקו נשבר לשני קטעים ולא צולל לאפס', () => {
  const hours = normalDay().map((h) =>
    h.hour === 12 || h.hour === 13 ? { ...h, speedKt: null, gustKt: null } : h
  );
  const out = renderSparkline(hours, {});
  assert.equal(count(out, /class="sp-line"/g), 2, 'חור בנתונים = שני path נפרדים');
  assert.equal(count(out, /class="sp-area"/g), 2);
});

test('שני חורים נפרדים מייצרים שלושה קטעים', () => {
  const hours = normalDay().map((h) =>
    h.hour === 9 || h.hour === 15 ? { ...h, speedKt: null } : h
  );
  assert.equal(count(renderSparkline(hours, {}), /class="sp-line"/g), 3);
});

test('קלט ריק כולו-null מחזיר markup תקין בלי NaN ובלי קו', () => {
  const hours = normalDay().map((h) => ({ ...h, speedKt: null, gustKt: null }));
  const out = renderSparkline(hours, { nowHour: 14.5, window: null });
  assert.ok(out.length > 0, 'הרצועות והציר עדיין נמסרים');
  assert.ok(!/NaN/.test(out));
  assert.equal(count(out, /class="sp-line"/g), 0, 'אין נתון — אין קו');
  assert.equal(count(out, /class="sp-dot"/g), 0);
  assert.ok(/class="sp-axis"/.test(out));
  assert.ok(/class="sp-now"/.test(out));
});

test('מערך ריק לגמרי לא מפיל ולא מייצר NaN', () => {
  for (const input of [[], null, undefined]) {
    const out = renderSparklineSVG(input, {});
    assert.ok(!/NaN/.test(out));
    assert.ok(out.startsWith('<svg') && out.endsWith('</svg>'));
  }
});

test('אין NaN בשום מקום בפלט של יום רגיל', () => {
  const out = renderSparklineSVG(normalDay(), {
    window: { startHour: 14, endHour: 16, meanKt: 21.5 },
    nowHour: 14.5,
  });
  assert.ok(!/NaN/.test(out), 'NaN בודד בתוך d הורג את כל ה-path בשקט');
  assert.ok(!/Infinity|undefined/.test(out));
  assert.ok(/class="sp-line"/.test(out));
  assert.ok(/class="sp-area"/.test(out));
  assert.ok(/class="sp-window"/.test(out));
  assert.ok(/class="sp-now"/.test(out));
  assert.ok(/class="sp-band sp-band--ideal"/.test(out));
  assert.ok(/>06</.test(out) && />12</.test(out) && />18</.test(out));
});

test('קלט מזוהם (NaN, מחרוזות, אובייקטים ריקים) לא מדליף NaN לפלט', () => {
  const hours = [
    { hour: 6, speedKt: NaN, gustKt: 10 },
    { hour: 7, speedKt: '12', gustKt: 15 },
    { hour: NaN, speedKt: 14, gustKt: 18 },
    null,
    {},
    { hour: 9, speedKt: 15, gustKt: NaN },
    { hour: 10, speedKt: 16, gustKt: 20 },
    { hour: 11, speedKt: -3, gustKt: 8 },
  ];
  const out = renderSparklineSVG(hours, { nowHour: 'זבל', window: { startHour: null, endHour: 5 } });
  assert.ok(!/NaN|Infinity|undefined/.test(out));
});

test('compact משמיט תוויות שעה', () => {
  const full = renderSparkline(normalDay(), {});
  const compact = renderSparkline(normalDay(), { compact: true });
  assert.ok(/class="sp-label"/.test(full));
  assert.ok(!/class="sp-label"/.test(compact));
});

test('nowHour ריק לא מצייר סמן, ושעה מחוץ לפריסה לא נצמדת לקצה', () => {
  assert.ok(!/class="sp-now"/.test(renderSparkline(normalDay(), { nowHour: null })));
  assert.ok(!/class="sp-now"/.test(renderSparkline(normalDay(), { nowHour: 23.5 })));
  assert.ok(/class="sp-now"/.test(renderSparkline(normalDay(), { nowHour: 6.25 })));
});

test('שעה תקינה בודדת מצוירת כנקודה', () => {
  const hours = [
    { hour: 6, speedKt: null },
    { hour: 12, speedKt: 18, gustKt: 22 },
    { hour: 20, speedKt: null },
  ];
  const out = renderSparkline(hours, {});
  assert.equal(count(out, /class="sp-line"/g), 0);
  assert.equal(count(out, /class="sp-dot"/g), 1);
  assert.ok(!/NaN/.test(out));
});

test('חורים בתחילת היום ובסופו לא מייצרים קטעים מדומים', () => {
  const hours = normalDay().map((h) =>
    h.hour <= 8 || h.hour >= 19 ? { ...h, speedKt: null, gustKt: null } : h
  );
  const out = renderSparkline(hours, {});
  assert.equal(count(out, /class="sp-line"/g), 1);
  assert.ok(!/NaN/.test(out));
});

test('מעל 35 קשר נצמד לתקרה ומסומן, לא נחתך בשקט', () => {
  const hours = normalDay().map((h) =>
    h.hour === 15 ? { ...h, speedKt: 41, gustKt: 52 } : h
  );
  const out = renderSparkline(hours, {});
  assert.ok(/class="sp-over"/.test(out));
  assert.equal(sparkY(41, {}), sparkY(SPARK_Y_MAX_KT, {}), 'הצמדה, לא חיתוך');
  const ys = nums(/d="([^"]+)"/.exec(out.match(/<path class="sp-line"[^>]*/)[0])[1])
    .filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...ys) >= sparkY(SPARK_Y_MAX_KT, {}) - 0.01, 'הקו לא חורג מעל התקרה');
});

test('הספליין המונוטוני לא מזנק מתחת לאפס ולא מעל השיא', () => {
  // סדרה קוצנית — בדיוק המקרה שספליין קרדינלי היה מפיל אל מתחת לאפס
  const spiky = [0, 24, 0, 30, 1, 28, 0, 2, 0, 26, 0, 3, 0, 22, 0, 1].map((v, i) => ({
    hour: 6 + i, dayIndex: 0, speedKt: v, gustKt: v, dirDeg: 300,
  }));
  const out = renderSparkline(spiky, {});
  const d = /d="([^"]+)"/.exec(out.match(/<path class="sp-line"[^>]*/)[0])[1];
  const ys = nums(d).filter((_, i) => i % 2 === 1);
  const yZero = sparkY(0, {});
  const yPeak = sparkY(30, {});
  assert.ok(Math.max(...ys) <= yZero + 0.01, 'שום נקודת בקרה לא צוללת מתחת ל-0 קשר');
  assert.ok(Math.min(...ys) >= yPeak - 0.01, 'שום נקודת בקרה לא מזנקת מעל השיא');
});

test('קואורדינטות מעוגלות לשתי ספרות', () => {
  const out = renderSparkline(normalDay(), {});
  const long = (out.match(/\d+\.\d{3,}/g) || []);
  assert.deepEqual(long, [], 'עד ~20 גרפים בדף — כל ספרה מיותרת היא משקל');
});

test('העטיפה נגישה כראוי ונושאת viewBox תקין', () => {
  const out = renderSparklineSVG(normalDay(), {});
  assert.ok(out.includes('class="sparkline"'));
  assert.ok(out.includes('aria-hidden="true"'));
  assert.ok(out.includes(`viewBox="0 0 ${SPARK_DEFAULTS.width} ${SPARK_DEFAULTS.height}"`));
  const compact = renderSparklineSVG(normalDay(), { compact: true });
  assert.ok(compact.includes('preserveAspectRatio="none"'));
  assert.ok(compact.includes('sparkline--compact'));
});

test('אין צבע קשיח בפלט — הכל currentColor / var()', () => {
  const out = renderSparklineSVG(normalDay(), {
    window: { startHour: 14, endHour: 16 }, nowHour: 10,
  });
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(out), 'בלי צבעי hex');
  assert.ok(!/rgb\(|hsl\(/.test(out));
  for (const m of out.match(/(?:fill|stroke)="([^"]+)"/g) || []) {
    const v = /="([^"]+)"/.exec(m)[1];
    assert.ok(
      v === 'none' || v === 'currentColor' || v.startsWith('var(--'),
      `ערך צבע לא צפוי: ${v}`
    );
  }
});

test('החלון נצבע לפי השעות שנבחרו, בכיוון הנכון', () => {
  const out = renderSparkline(normalDay(), { window: { startHour: 14, endHour: 16, meanKt: 21.5 } });
  const rect = /<rect class="sp-window"[^>]*/.exec(out)[0];
  const x = Number(/ x="([-\d.]+)"/.exec(rect)[1]);
  const w = Number(/ width="([-\d.]+)"/.exec(rect)[1]);
  assert.ok(w > 0);
  // RTL: הקצה השמאלי של המלבן הוא שעת הסיום
  assert.ok(Math.abs(x - sparkX(16, {})) < 0.01);
  assert.ok(Math.abs(x + w - sparkX(14, {})) < 0.01);
});
