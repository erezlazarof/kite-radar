/* =========================================================================
   רדאר קייט — מפענח ה-XML של השירות המטאורולוגי
   -------------------------------------------------------------------------
   ⚠️ מודול טהור. בלי DOM, בלי fetch, בלי Date.now — הזמן מוזרק.
   רץ גם ב-Pages Function (Workers), ושם **אין DOMParser**. לכן הפענוח
   מבוסס מחרוזות, במכוון, ולא "מפושט" ל-DOMParser אחר כך.

   שתי מלכודות שמקודדות כאן:
   1. `time_obs` הוא **UTC+2 קבוע — בלי שעון קיץ.** בקיץ הישראלי זה שעה
      אחת מאחורי השעון המקומי. פרשנות שגויה מזיזה כל קריאה בשעה.
   2. `WS` הוא **מטר לשנייה**, לא קשר. פי 1.94.
   ========================================================================= */

export const MS_TO_KT = 1.943844;

/** התחנות מדווחות ב-UTC+2 קבוע. לא Asia/Jerusalem — שם יש שעון קיץ. */
export const IMS_UTC_OFFSET_MIN = 120;

export function imsTimeToMs(timeObs) {
  // "2026-08-18T14:20:00" → מספר מילישניות, בהנחת UTC+2 קבוע
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(String(timeObs || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s) - IMS_UTC_OFFSET_MIN * 60000;
}

const tag = (block, name) => {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block);
  return m ? m[1].trim() : null;
};
const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {string} xml  תוכן imslasthour.xml
 * @returns {{ stations: Object, latestMs: number|null, count: number }}
 *   stations[NAME] = { name, num, latest: {tsMs, speedKt, gustKt, dirDeg, tempC, rh} , samples: n }
 *   נשמרת רק התצפית **האחרונה שיש בה רוח** לכל תחנה. שש דגימות של
 *   עשר דקות הן היסטוריה שאיננו צורכים, ושמירתן מנפחת את התגובה פי שש.
 */
export function parseImsXml(xml) {
  const stations = Object.create(null);
  let latestMs = null;
  let count = 0;

  const src = String(xml || '');
  const re = /<Observation>([\s\S]*?)<\/Observation>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const b = m[1];
    const name = tag(b, 'stn_name');
    if (!name) continue;
    count++;

    const tsMs = imsTimeToMs(tag(b, 'time_obs'));
    if (tsMs == null) continue;
    if (latestMs == null || tsMs > latestMs) latestMs = tsMs;

    const ws = num(tag(b, 'WS'));
    const wd = num(tag(b, 'WD'));
    if (ws == null || wd == null) continue; // תחנה בלי רוח — לא נרשמת כאילו יש לה

    const prev = stations[name];
    if (prev && prev.latest.tsMs >= tsMs) { prev.samples++; continue; }

    const gust = num(tag(b, 'WSmax'));
    stations[name] = {
      name,
      num: num(tag(b, 'stn_num')),
      samples: (prev?.samples ?? 0) + 1,
      latest: {
        tsMs,
        speedKt: round1(ws * MS_TO_KT),
        gustKt: gust == null ? null : round1(gust * MS_TO_KT),
        dirDeg: wd,
        tempC: num(tag(b, 'TD')),
        rh: num(tag(b, 'RH')),
      },
    };
  }

  return { stations, latestMs, count };
}

const round1 = v => Math.round(v * 10) / 10;

/**
 * מצב ההזנה. סעיף 10 ברישיון השמ"ט מחייב, כתנאי לשימוש מתמשך בנתונים,
 * מנגנון שמזהה הפסקות בהזנה ומנגנון גיבוי כשנתון חסר או מאחר. זו
 * התחייבות חוזית ולא שיפור — ולכן היא קוד ולא הערה.
 */
export const IMS_STALE_MIN = 75;
export const IMS_DEAD_MIN = 180;

export function feedHealth(parsed, nowMs) {
  const nStations = Object.keys(parsed?.stations || {}).length;
  if (!parsed || !parsed.latestMs || nStations === 0) {
    return { ok: false, state: 'down', ageMin: null, stations: nStations,
             note_he: 'ההזנה של השירות המטאורולוגי אינה זמינה כרגע.' };
  }
  const ageMin = Math.max(0, Math.round((nowMs - parsed.latestMs) / 60000));
  if (ageMin > IMS_DEAD_MIN) {
    return { ok: false, state: 'dead', ageMin, stations: nStations,
             note_he: `ההזנה נעצרה — הנתון האחרון בן ${ageMin} דקות.` };
  }
  if (ageMin > IMS_STALE_MIN) {
    return { ok: true, state: 'stale', ageMin, stations: nStations,
             note_he: `הנתון מאחר: ${ageMin} דקות.` };
  }
  return { ok: true, state: 'fresh', ageMin, stations: nStations, note_he: null };
}

/**
 * מדוד מול חזוי — ההפרש שהופך את האפליקציה ממודל לאמת.
 * מוחזר null כשאין ממה להשוות, לעולם לא אפס.
 */
export function measuredVsForecast(obs, forecastKt) {
  if (!obs || obs.speedKt == null || forecastKt == null) return null;
  const deltaKt = round1(obs.speedKt - forecastKt);
  return {
    measuredKt: obs.speedKt,
    forecastKt: round1(forecastKt),
    deltaKt,
    // פחות משני קשר הוא רעש מדידה, לא אי-הסכמה בין מודל למציאות
    agrees: Math.abs(deltaKt) < 2,
  };
}
