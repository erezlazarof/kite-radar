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
const numOr = (v, d = null) => {
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
