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

export const MODELS = {
  gfs_seamless:  { label: 'GFS',   short: 'G' },
  ecmwf_ifs025:  { label: 'ECMWF', short: 'E' },
  icon_seamless: { label: 'ICON',  short: 'I' },
};

export const FEATURES = {
  /** מדידה חיה מהשירות המטאורולוגי. ניתן לכיבוי בשורה אחת אם תנאי השימוש ישתנו. */
  ims_live: true,
  marine: false,       // שלב 8
  models: false,       // שלב 3
  telegram: false,     // שלב 7
};

export const REFRESH_MS = { obs: 5 * 60 * 1000, forecast: 15 * 60 * 1000 };

export const FORECAST_DAYS = 4;

export const ATTRIBUTION = [
  { name: 'Open-Meteo', url: 'https://open-meteo.com/', text: 'תחזית: Open-Meteo (CC BY 4.0)' },
];

/** ייחוס חובה לפי סעיף 3 ברישיון השירות המטאורולוגי. לא להסיר. */
export const IMS_ATTRIBUTION =
  'מדידות רוח: השירות המטאורולוגי הישראלי (ims.gov.il). השמ"ט אינו אחראי לנתונים או לשימוש בהם, ואינו צד לפרסום זה.';

export const DISCLAIMER =
  'כלי תכנון בלבד. לבדוק תנאים בשטח לפני כניסה למים, ולא לגלוש לבד.';
