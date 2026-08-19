/* =========================================================================
   רדאר קייט — מפענחי שני מקורות המדידה שאינם השמ"ט
   -------------------------------------------------------------------------
   ⚠️ מודול טהור. רץ ב-Pages Function (Workers) — בלי DOM, בלי Date.now.

   1. מצוף חדרה (Isramar) — גלים מדודים. JSON.
   2. תחנת IUI אילת (Meteo-Tech) — הרוח החיה **היחידה** באילת, אחרי
      שהתברר שתחנת השמ"ט שם מצהירה על אנמומטר ומחזירה ריק.
      גרידה של HTML: רכה משפטית ושברירית מבנית. לכן כל פונקציה כאן
      מחזירה null בשקט ולעולם לא זורקת — שבירה היא מצב צפוי, לא חריג.
   ========================================================================= */

import { MS_TO_KT, IMS_UTC_OFFSET_MIN } from './ims-parse.js';

const round1 = v => Math.round(v * 10) / 10;
// ⚠️ Number(null) === Number('') === Number(false) === 0 — מספר שנראה
// אמיתי ולא נמדד מעולם. זו הפעם ה**שלישית** שהמלכודת הזו נתפסת בפרויקט
// (טופס הוספת ספוט, decodeShare, וכאן): שדה JSON שהגיע null או תגית XML
// ריקה חייבים ליפול לברירת המחדל, לא להפוך ל"0 קשר מצפון".
const numOr = (v, d = null) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/* ------------------------------------------------------------------ */
/* מצוף חדרה                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {object|string} json  תוכן Hadera_Hs_Per.json
 * @returns {{tsMs, waveM, periodS, waveMaxM}|null}
 */
export function parseIsramar(json) {
  let d = json;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return null; }
  }
  if (!d || !Array.isArray(d.parameters)) return null;

  const pick = re => {
    const p = d.parameters.find(x => re.test(String(x?.name || '')));
    const v = p?.values?.[0];
    return numOr(v);
  };

  // "2026-08-18 12:00 UTC" — האזור כתוב במפורש, בניגוד לשמ"ט
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(d.datetime || '').trim());
  if (!m) return null;
  const [, y, mo, day, h, mi] = m.map(Number);
  const tsMs = Date.UTC(y, mo - 1, day, h, mi);

  const waveM = pick(/significant wave height/i);
  if (waveM == null) return null;

  return {
    tsMs,
    waveM: round1(waveM * 100) / 100,
    periodS: pick(/peak wave period/i),
    waveMaxM: pick(/maximal wave height/i),
  };
}

/* ------------------------------------------------------------------ */
/* תחנת IUI אילת                                                      */
/* ------------------------------------------------------------------ */

/**
 * הדף מקודד windows-1255. אנחנו לא מפענחים אותו כעברית בכוונה —
 * כל השדות שאנחנו צריכים הם ASCII, ולכן פענוח latin1 (שלעולם אינו
 * נכשל) שומר עליהם בדיוק. ניסיון לפענח עברית ב-Worker היה מוסיף
 * תלות בטבלת קידוד שאינה מובטחת שם.
 *
 * שורת הנתונים: שם · תאריך ושעה · טמפ · לחות · לחות מוחלטת · לחץ ·
 *                קרינה · כיוון רוח · מהירות רוח · משב · מפלס · טמפ מים · …
 *
 * @param {string} html
 * @param {number} nowMs  לגזירת השנה — הדף אינו מציין אותה
 */
export function parseMeteoTechEilat(html, nowMs) {
  const src = String(html || '');
  // מסירים תגיות ומכווצים רווחים, ואז קוראים את השורה כרצף ערכים
  const flat = src
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/\s+/g, ' ');

  const at = flat.search(/IUI\s+Eilat/i);
  if (at < 0) return null;

  const tail = flat.slice(at);
  const t = /(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/.exec(tail);
  if (!t) return null;

  const nums = tail
    .slice(t.index + t[0].length)
    .match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 10) return null;

  const v = nums.map(Number);
  // [temp2m, humidity, absHumidity, pressure, solar, windDir, windMs, gustMs, levelCm, waterTemp, ...]
  const dirDeg = v[5], windMs = v[6], gustMs = v[7], waterC = v[9];
  if (!Number.isFinite(dirDeg) || !Number.isFinite(windMs)) return null;
  if (dirDeg < 0 || dirDeg > 360 || windMs < 0 || windMs > 60) return null;

  const tsMs = eilatStampToMs(+t[1], +t[2], +t[3], +t[4], nowMs);
  if (tsMs == null) return null;

  return {
    tsMs,
    speedKt: round1(windMs * MS_TO_KT),
    gustKt: Number.isFinite(gustMs) && gustMs >= windMs ? round1(gustMs * MS_TO_KT) : null,
    dirDeg,
    waterC: Number.isFinite(waterC) && waterC > 5 && waterC < 40 ? waterC : null,
  };
}

/**
 * הדף מציין יום/חודש ושעה בלי שנה, והשעון שלו הוא UTC+2 קבוע כמו השמ"ט.
 * בסוף דצמבר "31/12" נקרא בינואר כשנה שעברה — נגזר מהיום הנוכחי ולא
 * מונח, אחרת אחת לשנה כל הקריאות קופצות שנים-עשר חודשים.
 */
export function eilatStampToMs(day, month, hh, mm, nowMs) {
  if (!Number.isFinite(day) || !Number.isFinite(month)) return null;
  const now = new Date(nowMs);
  const y = now.getUTCFullYear();
  const mk = year => Date.UTC(year, month - 1, day, hh, mm) - IMS_UTC_OFFSET_MIN * 60000;
  let ts = mk(y);
  // יותר מיממה בעתיד ⇒ מדובר בשנה שעברה
  if (ts - nowMs > 86400000) ts = mk(y - 1);
  return ts;
}

/* ------------------------------------------------------------------ */
/* Ambient Weather Network — מד הרוח של Surf Center על ריף רף          */
/* ------------------------------------------------------------------ */

export const MPH_TO_KT = 0.868976;

/**
 * @param {object|string} json  תגובת lightning.ambientweather.net/devices
 * @returns {{tsMs, speedKt, gustKt, dirDeg, tempC}|null}
 *
 * ⚠️ שתי בחירות שהן מהות, לא סגנון:
 * 1. המהירות היא `windspdmph_avg10m` — ממוצע עשר דקות — ולא `windspeedmph`
 *    הרגעי. הרגעי קופץ 11→21 קשר בין דקות (נמדד), והשמ"ט עצמו מדווח
 *    ממוצע 10 דקות. מקור שמדווח אחרת היה משווה תפוחים לרעש.
 * 2. היחידות הן **mph**, בלי דגל יחידות בתגובה. ההמרה כאן, פעם אחת,
 *    ליד המקור — לא בתצוגה.
 */
export function parseAwnDevice(json) {
  let d = json;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return null; }
  }
  const dev = Array.isArray(d) ? d[0] : d?.data?.[0] ?? d;
  const L = dev?.lastData;
  const tsMs = L ? numOr(L.dateutc) : null;
  if (tsMs == null || tsMs <= 0) return null;

  const speedMph = numOr(L.windspdmph_avg10m, numOr(L.windspeedmph));
  const gustMph = numOr(L.windgustmph);
  const dirDeg = numOr(L.winddir_avg10m, numOr(L.winddir));
  if (speedMph == null || dirDeg == null) return null;
  if (dirDeg < 0 || dirDeg > 360 || speedMph < 0 || speedMph > 120) return null;

  const speedKt = round1(speedMph * MPH_TO_KT);
  const gustKt = gustMph != null && gustMph >= speedMph ? round1(gustMph * MPH_TO_KT) : null;

  return {
    tsMs,   // epoch ms, UTC אמיתי — בלי מלכודת ההיסט של השמ"ט
    speedKt,
    gustKt,
    dirDeg,
    tempC: L.tempf != null ? round1((Number(L.tempf) - 32) * 5 / 9) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Surf Cycle (סורפו) — חוף זבולון, קריית ים                           */
/* ------------------------------------------------------------------ */

/**
 * ההיסט של שעון ישראל מ-UTC ברגע נתון, בדקות.
 * Intl נושא את טבלת שעון הקיץ — אין כאן קריאת שעה נוכחית, ולכן זה
 * עדיין מודול טהור: אותו קלט ייתן תמיד אותו פלט.
 */
export function israelOffsetMin(utcMs) {
  // ⚠️ הפורמט נותן דיוק של דקה. חישוב על רגע עם שניות (hh:59:45) היה
  // מעגל את ההיסט ל-179 דקות במקום 180 ומזיז את הקריאה דקה קדימה —
  // ובגבול שעה, אל שעת התחזית הלא נכונה. לכן קודם מקצצים לדקה עגולה.
  utcMs = Math.floor(utcMs / 60000) * 60000;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = t => Number(parts.find(p => p.type === t)?.value);
  const wall = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return Math.round((wall - utcMs) / 60000);
}

/**
 * "19/08/2026,14:45:00" → מילישניות UTC.
 *
 * ⚠️ שלוש מלכודות, כולן שונות מהשמ"ט:
 * 1. השעון הוא **שעון ישראל עם שעון קיץ** — UTC+3 בקיץ, UTC+2 בחורף.
 *    השמ"ט הוא UTC+2 קבוע. פירוש לפי כלל השמ"ט מזיז כל קריאת קיץ בשעה.
 * 2. הפורמט הוא יום-קודם (DD/MM). `new Date()` היה קורא 05/08 כ-8 במאי.
 * 3. ההמרה איטרטיבית: ההיסט תלוי ברגע, והרגע תלוי בהיסט. שתי איטרציות
 *    מתכנסות תמיד; ההבדל מופיע רק בשעת מעבר השעון, פעמיים בשנה.
 */
export function surfoTimeToMs(dateTimeStr) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})$/.exec(String(dateTimeStr || '').trim());
  if (!m) return null;
  const [, day, mo, y, hh, mi, ss] = m.map(Number);
  const wallUtc = Date.UTC(y, mo - 1, day, hh, mi, ss);
  let ts = wallUtc - israelOffsetMin(wallUtc) * 60000;
  ts = wallUtc - israelOffsetMin(ts) * 60000;
  return ts;
}

/**
 * @param {string} xml  תוכן windDirection.xml
 * @returns {{tsMs, speedKt, gustKt, dirDeg, tempC}|null}
 *
 * היחידות כבר קשר — מוכח מהדף עצמו (הציר מסומן "Wind Speed (Knots)"
 * והטבלה מציגה "8 kt"). **אין להוסיף המרה** — המרה כפולה הייתה מציגה
 * חצי מהרוח האמיתית, וחצי מהרוח הוא ההבדל בין "אין רוח" ל"יש רוח".
 */
export function parseSurfoXml(xml) {
  const src = String(xml || '');
  const tag = n => {
    const m = new RegExp(`<${n}>([^<]*)</${n}>`).exec(src);
    return m ? m[1].trim() : null;
  };

  const speedKt = numOr(tag('AverageWind'));
  const gustKt = numOr(tag('WindGust'));
  const dirDeg = numOr(tag('Direction'));
  if (speedKt == null || dirDeg == null) return null;
  if (dirDeg < 0 || dirDeg > 360 || speedKt < 0 || speedKt > 80) return null;

  const tsMs = surfoTimeToMs(tag('DateTime'));
  if (tsMs == null) return null;

  return {
    tsMs,
    speedKt: round1(speedKt),
    gustKt: gustKt != null && gustKt >= speedKt ? round1(gustKt) : null,
    dirDeg,
    tempC: numOr(tag('Temp')),
  };
}
