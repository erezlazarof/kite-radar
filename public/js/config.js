/* רדאר קייט — קונפיגורציה. נקודת האמת היחידה לכתובות, TTL-ים ודגלים. */

export const API = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  marine:   'https://marine-api.open-meteo.com/v1/marine',
  prevRuns: 'https://previous-runs-api.open-meteo.com/v1/forecast',
  obs:      '/api/obs',
};

export const TTL_MIN = {
  forecast: 15,
  models:   30,
  marine:   60,
  prevRuns: 360,
  obs:      5,
};

/** גיל מרבי שאחריו נתון שמור נחשב מת ולא מוצג כלל */
export const MAX_AGE_MIN = { forecast: 24 * 60, obs: 3 * 60 };

/** resKm — רזולוציית הרשת **בישראל**. ICON-D2 ו-GFS-HRRR אינם מכסים אותנו. */
export const MODELS = {
  gfs_seamless:  { label: 'GFS',   short: 'G', resKm: 13 },
  ecmwf_ifs025:  { label: 'ECMWF', short: 'E', resKm: 25 },
  icon_seamless: { label: 'ICON',  short: 'I', resKm: 7 },
};

/**
 * לאיזה מודל `best_match` נפתר בישראל.
 *
 * ⚠️ נמדד בקריאה אמיתית (19/8/2026): ב-best_match ובקריאה נפרדת ל-ICON
 * חוזרות **אותן שעות בדיוק** בתל אביב, בבצת, בכנרת ובאילת — כלומר
 * Open-Meteo בוחר כאן ICON-EU, שהוא הרזולוציה הגבוהה ביותר שמכסה את
 * המדינה (7 ק"מ מול 13 של GFS ו-25 של ECMWF).
 *
 * זה לא פרט טריוויה: הוא הופך את `models.exclude` ברג'יסטר מהצהרה על
 * רצועת ההשוואה להצהרה על **המספר הגדול בכרטיס**. ראה headlineModelFor.
 */
export const BEST_MATCH_RESOLVES_TO = 'icon_seamless';

/**
 * המודל שמחליף את best_match בספוט שהרג'יסטר מחריג ממנו את הבחירה שלו.
 * ECMWF ולא GFS: זה מודל הייחוס העולמי, והוא זה שמופיע ברצועת ההשוואה
 * של כל ספוט בארץ — כך שהמספר בכרטיס וקו ההשוואה מדברים באותה שפה.
 */
export const HEADLINE_MODEL_FALLBACK = 'ecmwf_ifs025';

export const FEATURES = {
  /** מדידה חיה מהשירות המטאורולוגי. ניתן לכיבוי בשורה אחת אם תנאי השימוש ישתנו. */
  ims_live: true,
  marine: false,       // שלב 8
  models: true,
  telegram: false,     // שלב 7
};

/**
 * הריפו שאליו נשלחות הצעות ספוט משכבה 3 של "הוסף ספוט".
 *
 * אומת מול api.github.com ב-19/8/2026: המשתמש erezlazarof קיים.
 * הריפו עצמו נוצר בשלב ההעלאה לרשת — עד אז הכפתור נופל בחן להעתקה
 * ללוח. owner=null מכבה את הקישור לגמרי.
 */
export const GITHUB = { owner: 'erezlazarof', repo: 'kite-radar' };

/**
 * הכתובת הציבורית של האתר. **מקור אמת יחיד** — היא נצרכת בשלושה מקומות
 * שנפרסים בנפרד ולכן נוטים להיפרד זה מזה:
 *   1. ה-user-agent שהפונקציה מציגה לשמ"ט, לאיסראמר ולמטאו-טק. זו הדרך
 *      היחידה שלהם ליצור קשר אם משהו מפריע להם, ולכן היא חייבת להיות נכונה.
 *   2. הקישור שבוט הטלגרם שולח בכל הודעה.
 *   3. קישורי השיתוף של "הוסף ספוט משלך".
 *
 * שם הריפו (`kite-radar`) ושם הפרויקט ב-Cloudflare Pages (`yeshruach`) הם
 * שני דברים נפרדים — התת-דומיין נגזר משם הפרויקט, לא מהריפו.
 */
export const SITE_URL = 'https://yeshruach.pages.dev';
export const UA_TOKEN = 'yeshruach/1.0';

export const REFRESH_MS = { obs: 5 * 60 * 1000, forecast: 15 * 60 * 1000 };

export const FORECAST_DAYS = 4;

export const ATTRIBUTION = [
  { name: 'Open-Meteo', url: 'https://open-meteo.com/', text: 'תחזית: Open-Meteo (CC BY 4.0)' },
  // תחנות המועדונים — ייחוס גלוי עם קישור. זו ההגינות המינימלית כלפי מי
  // שמחזיק אנמומטר על החוף בכספו, וגם הפרסום הכי טוב שנוכל לתת לו.
  { name: 'Surf Center', url: 'https://surfcenter.co.il/', text: 'מדידה בריף רף: מד הרוח של Surf Center אילת' },
  { name: 'Surf Cycle', url: 'https://surfo.co.il/', text: 'מדידה בקריית ים: מד הרוח של Surf Cycle (סורפו)' },
];

/** ייחוס חובה לפי סעיף 3 ברישיון השירות המטאורולוגי. לא להסיר. */
export const IMS_ATTRIBUTION =
  'מדידות רוח: השירות המטאורולוגי הישראלי (ims.gov.il). השמ"ט אינו אחראי לנתונים או לשימוש בהם, ואינו צד לפרסום זה.';

export const DISCLAIMER =
  'כלי תכנון בלבד. לבדוק תנאים בשטח לפני כניסה למים, ולא לגלוש לבד.';

/** תיאור המודל שממנו נלקח המספר בכרטיס — label ורזולוציה, גם עבור best_match */
export function modelInfo(id) {
  const key = id === 'best_match' || id == null ? BEST_MATCH_RESOLVES_TO : id;
  const m = MODELS[key];
  return { id: key, label: m?.label || key, resKm: m?.resKm ?? null,
           isDefault: id === 'best_match' || id == null };
}
