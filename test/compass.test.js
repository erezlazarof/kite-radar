/* =========================================================================
   בדיקות חוגת המצפן.
   הכשל שהבדיקות האלה קיימות בשבילו: קשת שמצללת את החצי ההפוך, או חריג
   אילת שיורד בשקט לאדום. שניהם נראים סבירים לגמרי על המסך.
   ========================================================================= */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderCompass } from '../public/js/ui/compass.js';
import { directionClass } from '../public/js/verdict/bands.js';

/* --------------------------- ספוטים לבדיקה (inline) --------------------------- */

// בת ים — הים במערב. ניצב החוף מצביע 270°.
const BAT_YAM = {
  id: 'bat-yam',
  name_he: 'בת ים',
  shore_normal_deg: 270,
  direction_overrides: [],
};

// אילת, החוף הצפוני — הים (מפרץ אילת) בדרום. ניצב החוף 180°.
// הצפונית היא גיאומטרית אופשור, אבל היא מצב הרכיבה הרגיל והמקובל.
const EILAT_NORTH = {
  id: 'eilat-north',
  name_he: 'אילת — החוף הצפוני',
  shore_normal_deg: 180,
  direction_overrides: [
    {
      from: 320, to: 40,
      class: 'offshore_managed',
      score: 78,
      flags: ['rescue_boat', 'upwind_skill'],
      note_he: 'צפונית — מצב הרכיבה הרגיל בחוף הצפוני, עם סירות הצלה',
    },
  ],
};

const CENTER = 26;

/* ---------------------------------- עזרים ---------------------------------- */

/** מחלץ את מאפיין ה-d של האלמנט הראשון שנושא מחלקה נתונה */
function pathD(svg, klass) {
  const m = svg.match(new RegExp('<path class="' + klass + '[^"]*" d="([^"]+)"'));
  assert.ok(m, 'לא נמצאה קשת עם המחלקה ' + klass);
  return m[1];
}

/** M x1 y1 A rx ry rot large sweep x2 y2 */
function arcEnds(d) {
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return { x1: n[0], y1: n[1], r: n[2], large: n[5], sweep: n[6], x2: n[7], y2: n[8] };
}

/** קודקוד החוד של המחוג */
function needleTip(svg) {
  const m = svg.match(/<polygon class="cmp-needle-head" points="([^"]+)"/);
  assert.ok(m, 'לא נמצא ראש מחוג');
  const [x, y] = m[1].split(' ')[0].split(',').map(Number);
  return { x, y };
}

const NUM_ATTRS = /\s(?:x1|y1|x2|y2|cx|cy|r|width|height|stroke-width|stroke-opacity|fill-opacity)="([^"]*)"/g;

/** כל מה שחייב להתקיים בכל פלט, בלי קשר לקלט */
function assertWellFormed(svg, label) {
  assert.equal(typeof svg, 'string', label);
  assert.ok(svg.startsWith('<svg '), label + ' — לא מתחיל ב-<svg');
  assert.ok(svg.endsWith('</svg>'), label + ' — לא נסגר');
  assert.match(svg, /role="img"/, label);
  assert.match(svg, /<title>[^<]+<\/title>/, label);

  // אין ערך זבל בשום מאפיין
  assert.doesNotMatch(svg, /NaN/, label + ' — NaN בפלט');
  assert.doesNotMatch(svg, /Infinity/, label);
  assert.doesNotMatch(svg, /undefined/, label);

  // כל מאפיין מספרי הוא באמת מספר סופי
  for (const m of svg.matchAll(NUM_ATTRS)) {
    assert.ok(Number.isFinite(Number(m[1])), label + ' — מאפיין לא מספרי: ' + m[0]);
  }
  // נתיבים ומצולעים מכילים רק תווי נתיב חוקיים
  for (const m of svg.matchAll(/ (?:d|points)="([^"]*)"/g)) {
    assert.match(m[1], /^[MLAZ0-9 .,-]+$/, label + ' — נתיב פגום: ' + m[1]);
  }
  // תגיות מאוזנות ברמה הגסה
  assert.equal((svg.match(/<g\b/g) || []).length, (svg.match(/<\/g>/g) || []).length, label);
}

/* --------------------------------- בת ים --------------------------------- */

test('בת ים — רוח מזרחית (90°) היא אופשור ומקבלת את טיפול הסכנה', () => {
  assert.equal(directionClass(90, BAT_YAM).cls, 'offshore');

  const svg = renderCompass(90, BAT_YAM);
  assertWellFormed(svg, 'בת ים 90');

  assert.match(svg, /data-dir-class="offshore"/);
  assert.match(svg, /class="cmp-danger-arc"/);
  assert.match(svg, /cmp-current--offshore["\s]/);
  // ולא הטיפול הבטוח על הרוח הנוכחית
  assert.doesNotMatch(svg, /cmp-current--(?:on|side_on)shore["\s]/);
  assert.doesNotMatch(svg, /cmp-managed-arc/);

  // הרוח באה ממזרח → היא נוסעת מערבה, אל הים הפתוח. החוד חייב להצביע שמאלה.
  assert.ok(needleTip(svg).x < CENTER, 'המחוג לא מצביע אל הים');
});

test('בת ים — רוח מערבית (270°) היא אונשור', () => {
  assert.equal(directionClass(270, BAT_YAM).cls, 'onshore');

  const svg = renderCompass(270, BAT_YAM);
  assertWellFormed(svg, 'בת ים 270');

  assert.match(svg, /data-dir-class="onshore"/);
  assert.match(svg, /class="cmp-safe-arc"/);
  assert.match(svg, /cmp-current--onshore["\s]/);
  assert.doesNotMatch(svg, /cmp-current--(?:offshore|side_offshore)["\s]/);

  // רוח מהים נוסעת אל היבשה — החוד ימינה
  assert.ok(needleTip(svg).x > CENTER, 'המחוג לא מצביע אל היבשה');
});

test('בת ים — הקשת הבטוחה יושבת מעל הים והמסוכנת מעל היבשה', () => {
  const svg = renderCompass(270, BAT_YAM);

  // הים במערב (x קטן מהמרכז), היבשה במזרח.
  const safe = arcEnds(pathD(svg, 'cmp-safe-arc'));
  assert.ok(safe.x1 < CENTER && safe.x2 < CENTER, 'הקשת הבטוחה גלשה אל צד היבשה');
  assert.equal(safe.sweep, 1);
  assert.equal(safe.large, 0);   // מפתח 134° — קשת קטנה

  const danger = arcEnds(pathD(svg, 'cmp-danger-arc'));
  assert.ok(danger.x1 > CENTER && danger.x2 > CENTER, 'קשת הסכנה גלשה אל צד הים');
  assert.equal(danger.sweep, 1);
  assert.equal(danger.large, 0); // מפתח 136°

  // קצוות מדויקים: 270±67 ברדיוס 18.8
  assert.ok(Math.abs(safe.x1 - 18.65) < 0.03 && Math.abs(safe.y1 - 43.31) < 0.03,
    'קצה הקשת הבטוחה אינו על אזימוט 203°');
  assert.ok(Math.abs(safe.x2 - 18.65) < 0.03 && Math.abs(safe.y2 - 8.69) < 0.03,
    'קצה הקשת הבטוחה אינו על אזימוט 337°');
});

/* ------------------------------- חריג אילת ------------------------------- */

test('אילת — צפונית (0°) מקבלת את הטיפול השלישי, לא סכנה ולא בטוח', () => {
  const verdict = directionClass(0, EILAT_NORTH);
  assert.equal(verdict.cls, 'offshore_managed');
  assert.equal(verdict.overridden, true);

  const svg = renderCompass(0, EILAT_NORTH);
  assertWellFormed(svg, 'אילת 0');

  // הטיפול השלישי — קיים ופעיל
  assert.match(svg, /cmp-managed-arc/);
  assert.match(svg, /cmp-managed-arc--active/);
  assert.match(svg, /data-dir-class="offshore_managed"/);
  assert.match(svg, /cmp-current--offshore_managed["\s]/);

  // ⚠️ הלב של הבדיקה: אסור שהרוח הנוכחית תסומן כסכנה או כבטוחה.
  assert.doesNotMatch(svg, /data-dir-class="offshore"/);
  assert.doesNotMatch(svg, /data-dir-class="side_offshore"/);
  assert.doesNotMatch(svg, /cmp-current--offshore["\s]/);
  assert.doesNotMatch(svg, /cmp-current--side_offshore["\s]/);
  assert.doesNotMatch(svg, /cmp-current--(?:on|side_on)shore["\s]/);
  assert.doesNotMatch(svg, /cmp--offshore["\s]/);

  // קשת החריג מצוירת אחרי הרצועה הגנרית — כלומר מעליה
  assert.ok(svg.indexOf('cmp-managed-arc') > svg.indexOf('class="cmp-danger-arc"'),
    'קשת החריג מצוירת מתחת לרצועת הסכנה ותיבלע בה');
});

test('אילת — רוח מהים (200°) היא אונשור, וקשת החריג קיימת אך לא פעילה', () => {
  assert.equal(directionClass(200, EILAT_NORTH).cls, 'onshore');

  const svg = renderCompass(200, EILAT_NORTH);
  assertWellFormed(svg, 'אילת 200');

  assert.match(svg, /data-dir-class="onshore"/);
  assert.match(svg, /cmp-managed-arc/);                 // הקשת היא תכונה של הספוט
  assert.doesNotMatch(svg, /cmp-managed-arc--active/);  // אבל הרוח לא בתוכה עכשיו
});

test('אילת — כל 360 המעלות: אף אזימוט בקשת החריג לא מסווג כסכנה', () => {
  for (let d = 0; d < 360; d++) {
    const inOverride = d >= 320 || d <= 40;
    const cls = directionClass(d, EILAT_NORTH).cls;
    if (inOverride) {
      assert.equal(cls, 'offshore_managed', 'אזימוט ' + d);
      const svg = renderCompass(d, EILAT_NORTH);
      assert.match(svg, /cmp-managed-arc--active/, 'אזימוט ' + d);
      assert.doesNotMatch(svg, /cmp-current--offshore["\s]/, 'אזימוט ' + d);
    }
  }
});

/* ------------------------- סריקה מלאה: אין NaN ------------------------- */

test('סריקה 0..359 בשני הספוטים — אין NaN בשום מאפיין', () => {
  for (const spot of [BAT_YAM, EILAT_NORTH]) {
    for (let d = 0; d < 360; d++) {
      assertWellFormed(renderCompass(d, spot), spot.id + ' @ ' + d);
    }
  }
});

test('סריקה — גם בגדלים אחרים ובלי רוחות שמיים', () => {
  for (let d = 0; d < 360; d += 7) {
    assertWellFormed(renderCompass(d, BAT_YAM, { size: 96, showCardinals: false }), 'גדול ' + d);
    assert.doesNotMatch(renderCompass(d, BAT_YAM, { showCardinals: false }), /cmp-cardinal/);
  }
});

/* ------------------------------ קלט חסר ------------------------------ */

test('כיוון רוח null מחזיר חוגה ניטרלית תקינה', () => {
  for (const bad of [null, undefined, NaN, 'לא מספר']) {
    const svg = renderCompass(bad, BAT_YAM);
    assertWellFormed(svg, 'ריק: ' + String(bad));
    assert.match(svg, /cmp--nodata/);
    assert.match(svg, /class="cmp-nodata"/);
    assert.match(svg, /data-dir-class=""/);
    assert.match(svg, /<title>אין נתוני כיוון רוח<\/title>/);
    assert.doesNotMatch(svg, /cmp-needle/);
    assert.doesNotMatch(svg, /cmp-current/);
    // הרצועות עדיין מצוירות — הן תכונה של החוף ולא של הרגע
    assert.match(svg, /cmp-safe-arc/);
  }
});

test('ספוט בלי ניצב חוף — עדיין SVG תקין, בלי רצועות', () => {
  const svg = renderCompass(120, { id: 'x', direction_overrides: [] });
  assertWellFormed(svg, 'בלי ניצב חוף');
  assert.doesNotMatch(svg, /cmp-safe-arc|cmp-danger-arc|cmp-shore/);
  assert.match(svg, /cmp-needle/);   // כיוון הרוח מוחלט וניתן להצגה גם בלי חוף
});

test('ספוט null / opts null לא מפילים את הרכיב', () => {
  assertWellFormed(renderCompass(45, null), 'ספוט null');
  assertWellFormed(renderCompass(45, BAT_YAM, null), 'opts null');
});

/* ------------------------- כללי ברזל של הרכיב ------------------------- */

test('אין שיקוף ואין transform — אזימוט מצפן הוא מוחלט', () => {
  for (const d of [0, 45, 90, 180, 270, 359]) {
    const svg = renderCompass(d, BAT_YAM);
    assert.doesNotMatch(svg, /transform/, 'אזימוט ' + d);
    assert.doesNotMatch(svg, /scale\(/, 'אזימוט ' + d);
    assert.doesNotMatch(svg, /matrix\(/, 'אזימוט ' + d);
    assert.doesNotMatch(svg, /rotate\(/, 'אזימוט ' + d);
  }
});

test('צפון למעלה', () => {
  const svg = renderCompass(90, BAT_YAM);
  const m = svg.match(/<line class="cmp-cardinal-tick cmp-cardinal--n" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/);
  assert.ok(m, 'לא נמצאה שנת צפון');
  const [, x1, y1, x2, y2] = m.map(Number);
  assert.equal(x1, CENTER);
  assert.equal(x2, CENTER);
  assert.ok(y2 < y1 && y1 < CENTER, 'שנת צפון אינה כלפי מעלה');
});

test('המחוג מצביע לכיוון הנסיעה, לא למוצא הרוח', () => {
  // רוח מצפון (0°) נוסעת דרומה. במסך: y גדל.
  const tip = needleTip(renderCompass(0, BAT_YAM));
  assert.ok(tip.y > CENTER, 'המחוג מצביע למוצא הרוח במקום לכיוון הנסיעה');
  assert.ok(Math.abs(tip.x - CENTER) < 0.01);

  // רוח ממערב (270°) נוסעת מזרחה: x גדל.
  const tipW = needleTip(renderCompass(270, BAT_YAM));
  assert.ok(tipW.x > CENTER);
});

test('dirClass שהועבר מבחוץ גובר על החישוב העצמי', () => {
  const svg = renderCompass(90, BAT_YAM, { dirClass: 'side_shore' });
  assert.match(svg, /data-dir-class="side_shore"/);
  assert.match(svg, /cmp-current--side_shore["\s]/);

  // גם כאובייקט מלא מהמנוע
  const svg2 = renderCompass(90, BAT_YAM, { dirClass: directionClass(90, BAT_YAM) });
  assert.match(svg2, /data-dir-class="offshore"/);
});

test('כותרת עברית נבנית מהמנוע, וניתנת לדריסה', () => {
  // 315° = צפון-מערבית. מול בת ים (ניצב 270) → offAxis 45 → side_onshore.
  const svg = renderCompass(315, BAT_YAM);
  assert.match(svg, /<title>רוח צפון-מערבית, צד-פנימה<\/title>/);
  assert.match(svg, /aria-label="רוח צפון-מערבית, צד-פנימה"/);

  const custom = renderCompass(315, BAT_YAM, { title: 'טקסט "משלי" &' });
  assert.match(custom, /<title>טקסט &quot;משלי&quot; &amp;<\/title>/);
});
