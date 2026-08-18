/* =========================================================================
   רדאר קייט — טבלאות הניקוד והגיאומטריה
   -------------------------------------------------------------------------
   מודול טהור. בלי DOM, בלי fetch, בלי Date. הכל פונקציות מתמטיות.
   כל מספר כאן מגיע ממקורות הקייט הישראליים והבינלאומיים שנסקרו בתכנון.
   ========================================================================= */

/** אינטרפולציה לינארית של v בטווח [a,b] אל [ya,yb] */
export function lerp(v, a, b, ya, yb) {
  if (b === a) return ya;
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return ya + (yb - ya) * t;
}

/** עקומת פעמון בין a ל-b עם שיא ב-peak. מחזירה 0..1 */
export function bump(v, a, b, peak) {
  if (v <= a || v >= b) return 0;
  return v <= peak ? (v - a) / (peak - a) : (b - v) / (b - peak);
}

/** האם זווית נמצאת בקשת from→to (עם גלישה מעבר ל-360) */
export function inArc(deg, from, to) {
  const d = ((deg % 360) + 360) % 360;
  const f = ((from % 360) + 360) % 360;
  const t = ((to % 360) + 360) % 360;
  return f <= t ? d >= f && d <= t : d >= f || d <= t;
}

/**
 * הזווית בין הרוח לניצב החוף.
 *
 * ⚠️ קונבנציה — לקרוא לפני שינוי:
 *   wind_direction_10m של Open-Meteo הוא מטאורולוגי: הכיוון שממנו הרוח *באה*.
 *   shore_normal_deg הוא האזימוט מהחוף *החוצה* אל הים הפתוח.
 *
 *   0°   = הרוח באה ישר מהים  → אונשור (פנימה)
 *   180° = הרוח באה ישר מהיבשה → אופשור (החוצה)
 *
 * @returns {number} 0..180
 */
export function offAxisDeg(windFromDeg, shoreNormalDeg) {
  return Math.abs((((windFromDeg - shoreNormalDeg) % 360) + 540) % 360 - 180);
}

export const DIR_CLASS = {
  onshore:          { score: 74,  flags: ['hard_launch'] },
  side_onshore:     { score: 100, flags: [] },
  side_shore:       { score: 88,  flags: [] },
  side_offshore:    { score: 42,  flags: ['rescue'] },
  offshore:         { score: 0,   flags: ['offshore_danger'] },
  offshore_managed: { score: 78,  flags: ['rescue_boat', 'upwind_skill'] },
};

/**
 * סיווג כיוון הרוח עבור ספוט.
 * direction_overrides נבדקות *לפני* המיפוי הגנרי — שם חי חריג אילת.
 */
export function directionClass(windFromDeg, spot) {
  for (const ov of spot.direction_overrides || []) {
    if (inArc(windFromDeg, ov.from, ov.to)) {
      return {
        cls: ov.class,
        score: ov.score,
        flags: ov.flags || [],
        note: ov.note_he || null,
        overridden: true,
        offAxis: offAxisDeg(windFromDeg, spot.shore_normal_deg),
      };
    }
  }
  const a = offAxisDeg(windFromDeg, spot.shore_normal_deg);
  let cls;
  if (a <= 22) cls = 'onshore';
  else if (a <= 67) cls = 'side_onshore';
  else if (a <= 112) cls = 'side_shore';
  else if (a <= 157) cls = 'side_offshore';
  else cls = 'offshore';
  return { cls, ...DIR_CLASS[cls], note: null, overridden: false, offAxis: a };
}

/**
 * ניקוד מהירות. 0..100.
 * גולש כבד יותר צריך יותר רוח → כל גבולות הרצועות זזים למעלה.
 * מעל 28 קשר הקנס ריבועי, כי כוח העפיפון גדל בריבוע המהירות.
 */
export function speedScore(meanKt, prefs = {}) {
  const shift = (((prefs.weightKg ?? 75) - 75) / 15) * 3;
  const v = meanKt - shift; // "קשרים אפקטיביים" ביחס לגולש ייחוס של 75 ק"ג
  if (v < 8) return 0;
  if (v < 12) return lerp(v, 8, 12, 15, 35);
  if (v < 15) return lerp(v, 12, 15, 40, 60);
  if (v < 22) return 75 + 25 * bump(v, 15, 22, 18.5);
  if (v < 28) return lerp(v, 22, 28, 100, 70);
  if (v < 35) {
    const over = (v - 28) / 7;
    return Math.max(0, 70 - 70 * over * over);
  }
  return 0;
}

/** תווית עברית לרצועת המהירות — לשימוש בנימוק */
export function speedBandLabel(meanKt) {
  if (meanKt < 8) return 'אין רוח';
  if (meanKt < 12) return 'רוח חלשה';
  if (meanKt < 15) return 'גבולי';
  if (meanKt < 22) return 'רוח טובה';
  if (meanKt < 28) return 'רוח חזקה';
  if (meanKt < 35) return 'למומחים';
  return 'מסוכן';
}

/** גודל עפיפון מומלץ בגסות, לגולש 75 ק"ג */
export function kiteSize(meanKt, prefs = {}) {
  const shift = (((prefs.weightKg ?? 75) - 75) / 15) * 3;
  const v = meanKt - shift;
  if (v < 10) return null;
  if (v < 13) return '15-17';
  if (v < 16) return '12-14';
  if (v < 20) return '10-12';
  if (v < 24) return '8-9';
  if (v < 30) return '6-7';
  return '5';
}

/**
 * ניקוד משבים.
 * ה"שקט" לא מגיע מהמודל — מוערך כ-2·ממוצע − משב, שהיא ההנחה
 * הסימטרית הפשוטה. מתועד כאן כדי שלא ייקרא כמדידה.
 */
export const GUST_RELEVANT_ABOVE_KT = 12;

export function gustScore(meanKt, gustKt, dirCls) {
  if (gustKt == null || meanKt == null || meanKt <= 0) {
    return { score: 70, ratio: null, spread: null, tierDowngrade: false };
  }
  // מתחת לסף הרכיבה, המהירות היא ממילא האילוץ הכובל. יחס משב גבוה ברוח
  // חלשה הוא נורמלי פיזיקלית, ודגל "משבים" שם הוא רעש שמאמן להתעלם מדגלים.
  if (meanKt < GUST_RELEVANT_ABOVE_KT) {
    return { score: 70, ratio: gustKt / meanKt, spread: gustKt - meanKt, tierDowngrade: false };
  }
  const ratio = gustKt / meanKt;
  const spread = gustKt - meanKt;

  let s = ratio <= 1.3 ? 100
        : ratio <= 1.5 ? lerp(ratio, 1.3, 1.5, 100, 60)
        : 30;

  if (spread > 15) s = Math.min(s, 40);
  else if (spread > 10) s = Math.min(s, 65);

  // רוח שיוצאת מהיבשה עוברת מעל מכשולים ולכן סוערת יותר מהמספר
  if (dirCls === 'offshore' || dirCls === 'side_offshore' || dirCls === 'offshore_managed') {
    s *= 0.85;
  }

  return { score: s, ratio, spread, tierDowngrade: ratio > 1.5 || spread > 15 };
}

export const LEVEL_ORDER = ['red', 'yellow', 'green'];

export function downgrade(level, steps = 1) {
  const i = LEVEL_ORDER.indexOf(level);
  if (i < 0) return level;
  return LEVEL_ORDER[Math.max(0, i - steps)];
}

export function cap(level, maxLevel) {
  const i = LEVEL_ORDER.indexOf(level);
  const m = LEVEL_ORDER.indexOf(maxLevel);
  if (i < 0 || m < 0) return level;
  return i > m ? maxLevel : level;
}

/** שם עברי לכיוון מצפן, ל-16 רוחות */
const COMPASS_HE = ['צפונית', 'צפון-מזרחית', 'מזרחית', 'דרום-מזרחית',
                    'דרומית', 'דרום-מערבית', 'מערבית', 'צפון-מערבית'];

export function compassHe(deg) {
  return COMPASS_HE[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export const DIR_CLASS_HE = {
  onshore: 'ישר מהים',
  side_onshore: 'צד-פנימה',
  side_shore: 'צד-חוף',
  side_offshore: 'צד-החוצה',
  offshore: 'מהחוף החוצה',
  offshore_managed: 'החוצה — הרגיל כאן',
};
