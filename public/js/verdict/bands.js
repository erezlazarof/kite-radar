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
 *
 * ⚠️ אובייקטיבי במכוון — **בלי משקל הגולש ובלי שום העדפה אישית.**
 * פסק דין הוא קביעה על החוף: 18 קשר צד-חוף הם 18 קשר צד-חוף לכל אחד.
 * מה שאישי הוא איזה ציוד לוקחים, וזה חי בשכבת התכנון (kiteSize/quiver)
 * ולא כאן. ערבוב השניים היה גורם לשני אנשים לראות צבע שונה לאותו חוף
 * באותה שעה — ואז אי אפשר להגיד "יש רוח בבת ים" ולסמוך על זה.
 *
 * מעל 28 קשר הקנס ריבועי, כי כוח העפיפון גדל בריבוע המהירות.
 */
export function speedScore(meanKt) {
  const v = meanKt;
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

/* =========================================================================
   שכבת התכנון — אישית, ולא נוגעת בפסק הדין
   -------------------------------------------------------------------------
   כאן, ורק כאן, המשקל משנה. הפלט הוא "מה לקחת", לא "אם ללכת".
   ========================================================================= */

/** גדלי עפיפון נפוצים */
export const KITE_SIZES = [5, 6, 7, 8, 9, 10, 12, 14, 17];

/** מתחת לזה לא ממליצים ציוד — אין על מה לרכוב */
export const MIN_RIDEABLE_MARGINAL_KT = 11;

/**
 * גודל עפיפון מומלץ במטרים.
 *
 * שטח נדרש משתנה הפוך לריבוע המהירות ובאופן ישר במסת הגולש:
 *   A ∝ m / v²
 * מכויל כך שגולש 75 ק"ג ב-18 קשר יוצא על כ-10 מ' — נקודת הייחוס
 * המקובלת בטבלאות של יצרנים.
 */
export const KITE_MAX_M = 17;   // הגדול ביותר שמישהו באמת מחזיק
export const KITE_MIN_M = 5;

export function kiteSizeM(meanKt, weightKg = 75) {
  const v = Number(meanKt);
  // מתחת לסף הרכיבוּת אין המלצת ציוד. "עפיפון 21 מטר" הוא לא עצה,
  // הוא מה שקורה כשמריצים נוסחה מחוץ לתחום שבו היא נכונה.
  if (!Number.isFinite(v) || v < MIN_RIDEABLE_MARGINAL_KT) return null;
  const m = Number(weightKg) || 75;
  const size = 10 * (m / 75) * (18 / Math.min(v, 40)) ** 2;
  return Math.round(Math.max(3, Math.min(21, size)) * 10) / 10;
}

/** טווח מעשי סביב ההמלצה — אף אחד לא רוכב על מספר בודד */
export function kiteRange(meanKt, weightKg = 75) {
  const c = kiteSizeM(meanKt, weightKg);
  if (c == null) return null;
  // מהדקים את המרכז לתחום הגדלים שקיימים בשוק *לפני* שגוזרים טווח,
  // אחרת ההידוק של כל קצה בנפרד יכול להפוך את הסדר (18–17).
  const cl = Math.min(KITE_MAX_M, Math.max(KITE_MIN_M, c));
  const lo = Math.max(KITE_MIN_M, Math.round(cl * 0.85));
  const hi = Math.min(KITE_MAX_M, Math.round(cl * 1.15));
  return {
    center: c,
    lo: Math.min(lo, hi),
    hi: Math.max(lo, hi),
    // הנוסחה יצאה מחוץ לגדלים שקיימים בשוק — עובדה שכדאי לומר
    overMax: c > KITE_MAX_M,
    underMin: c < KITE_MIN_M,
  };
}

/**
 * התאמת המלצה לעפיפונים שיש לגולש בפועל.
 * מחזיר את הקרוב ביותר, ומסמן אם הוא בכלל בטווח סביר.
 */
export function matchQuiver(meanKt, weightKg, quiver = []) {
  const c = kiteSizeM(meanKt, weightKg);
  if (c == null) return { recommended: null, best: null, fits: false, reason: 'no_wind' };
  const owned = (quiver || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!owned.length) return { recommended: c, best: null, fits: false, reason: 'no_quiver' };

  const best = owned.reduce((a, b) => (Math.abs(b - c) < Math.abs(a - c) ? b : a));
  const ratio = best / c;
  // ±25% הוא הטווח שבו עפיפון עדיין רכיב, גם אם לא אידיאלי
  const fits = ratio >= 0.75 && ratio <= 1.25;
  return {
    recommended: c, best, fits,
    reason: fits ? 'ok' : best < c ? 'too_small' : 'too_big',
  };
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

/**
 * אותו כיוון כשם עצם. COMPASS_HE הוא תואר ומתאים לרוח ("רוח מערבית"),
 * אבל חוף אינו רוח: "החוף פונה למערבית" אינו עברית. שני הניסוחים חיים
 * זה לצד זה בכוונה, כי שניהם מופיעים באותו משפט בחוגה.
 */
const COMPASS_NOUN_HE = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח',
                         'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'];

export function compassNounHe(deg) {
  return COMPASS_NOUN_HE[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export const DIR_CLASS_HE = {
  onshore: 'ישר מהים',
  side_onshore: 'צד-פנימה',
  side_shore: 'צד-חוף',
  side_offshore: 'צד-החוצה',
  offshore: 'מהחוף החוצה',
  offshore_managed: 'החוצה — הרגיל כאן',
};
