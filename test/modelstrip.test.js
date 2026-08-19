import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderModelStrip, modelMeanKt, spreadLabel, STRIP_KT } from '../public/js/ui/modelstrip.js';

const hoursAt = kt => Array.from({ length: 24 }, (_, h) => ({ hour: h, dayIndex: 0, speedKt: kt }));

test('model mean is taken over the same window the engine scored', () => {
  const h = Array.from({ length: 24 }, (_, x) => ({ hour: x, dayIndex: 0, speedKt: x === 15 ? 20 : 4 }));
  assert.equal(modelMeanKt(h, { startHour: 15, endHour: 16 }), 20);
  assert.equal(modelMeanKt(h, { startHour: 3, endHour: 5 }), 4);
  assert.equal(modelMeanKt([], { startHour: 1, endHour: 2 }), null);
  assert.equal(modelMeanKt(h, null), null);
});

test('spread is graded, not just reported', () => {
  assert.equal(spreadLabel(2).cls, 'agree');
  assert.equal(spreadLabel(5).cls, 'mild');
  assert.equal(spreadLabel(11).cls, 'split');
  assert.equal(spreadLabel(null).cls, 'none');
});

test('the strip renders every model it was given, and says the spread in words', () => {
  const out = renderModelStrip({ gfs_seamless: 13, ecmwf_ifs025: 23, icon_seamless: 18 }, 18);
  assert.match(out, /המודלים חלוקים/);
  assert.match(out, /הפרש 10 קשר/);
  assert.equal((out.match(/class="ms-dot"/g) || []).length, 3);
  assert.match(out, /ms-best/, 'best_match must be marked');
  assert.ok(!/NaN|undefined|Infinity/.test(out));
});

test('agreement reads as agreement', () => {
  const out = renderModelStrip({ gfs_seamless: 17, ecmwf_ifs025: 19, icon_seamless: 18 }, 18);
  assert.match(out, /המודלים מסכימים/);
  assert.match(out, /ms-span--agree/);
});

test('a single model is not dressed up as a comparison', () => {
  const out = renderModelStrip({ gfs_seamless: 17 }, 17);
  assert.match(out, /מודל אחד בלבד/);
  assert.ok(!/ms-span/.test(out), 'no spread bar when there is nothing to span');
});

test('an excluded model is explained, never silently missing', () => {
  const out = renderModelStrip({ gfs_seamless: 17, ecmwf_ifs025: 19 }, 18, {
    excluded: ['icon_seamless'],
    reason_he: 'אילת יושבת על הקצה הדרומי של דומיין ICON-EU.',
  });
  assert.match(out, /mstrip-note/);
  assert.match(out, /ICON-EU/);
});

test('no data at all yields an honest empty state, not an empty chart', () => {
  const out = renderModelStrip({}, null);
  assert.match(out, /לא התקבלה השוואת מודלים/);
  assert.ok(!/<svg/.test(out));
});

test('garbage values are filtered out instead of poisoning the axis', () => {
  const out = renderModelStrip({ a: NaN, b: 'x', c: null, gfs_seamless: 18, ecmwf_ifs025: 21 }, 19);
  assert.ok(!/NaN|undefined/.test(out));
  assert.equal((out.match(/class="ms-dot"/g) || []).length, 2);
});

test('values beyond the axis are clamped, never drawn outside the strip', () => {
  const out = renderModelStrip({ gfs_seamless: 1, ecmwf_ifs025: 90 }, 45, { width: 300 });
  const xs = [...out.matchAll(/<circle cx="([\d.]+)"/g)].map(m => Number(m[1]));
  for (const x of xs) assert.ok(x >= 0 && x <= 300, `dot at ${x} is outside the strip`);
});

test('the axis runs right to left like every other axis in the app', () => {
  const out = renderModelStrip({ gfs_seamless: STRIP_KT.min, ecmwf_ifs025: STRIP_KT.max }, null, { width: 300 });
  const xs = [...out.matchAll(/<circle cx="([\d.]+)"/g)].map(m => Number(m[1]));
  assert.ok(xs[0] > xs[1], 'the lower wind speed must sit to the right');
});

test('no hardcoded colours — the palette lives in CSS', () => {
  const out = renderModelStrip({ gfs_seamless: 13, ecmwf_ifs025: 23 }, 18);
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(out), 'a hex literal leaked into the markup');
});
