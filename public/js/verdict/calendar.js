/* =========================================================================
   רדאר קייט — שערי עונה וחוקיות
   -------------------------------------------------------------------------
   מודול טהור. הזמן מוזרק תמיד, לעולם לא נקרא מ-Date.now.
   מייצר מצב `blocked` — שהוא **לא** אדום. אסור אינו מסוכן, וערבוב
   השניים מלמד משתמשים להתעלם מאדום.
   ========================================================================= */

/** ממיר חותמת זמן לשדות תאריך בשעון ישראל, בלי תלות באזור הזמן של המכשיר */
export function israelDateParts(ms) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(ms).map(x => [x.type, x.value]));
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    weekday: WD[p.weekday],          // 0=ראשון … 5=שישי, 6=שבת
    iso: `${p.year}-${p.month}-${p.day}`,
    mmdd: `${p.month}-${p.day}`,
  };
}

/** האם MM-DD נמצא בטווח, כולל טווחים שחוצים את סוף השנה */
export function inDateRange(mmdd, from, to) {
  return from <= to ? mmdd >= from && mmdd <= to : mmdd >= from || mmdd <= to;
}

/**
 * שער עונה. מחזיר אובייקט חסימה אם הספוט מחוץ לעונה, אחרת null.
 */
export function seasonGate(spot, nowMs, dayOffset = 0) {
  if (!spot.season) return null;
  const d = israelDateParts(nowMs + dayOffset * 86400000);
  if (inDateRange(d.mmdd, spot.season.from, spot.season.to)) return null;
  return {
    kind: 'season',
    short_he: spot.season.short_he || 'מחוץ לעונה',
    note_he: spot.season.note_he || null,
    verified: true,
  };
}

/**
 * שער חוקיות. עובר על spot.legal ומחזיר את החסימה הראשונה שחלה.
 * רק רשומות מסוג "ban" חוסמות; "zone" ו-"boundary" הן אזהרות שמוצגות תמיד.
 */
export function legalGate(spot, nowMs, dayOffset = 0) {
  const d = israelDateParts(nowMs + dayOffset * 86400000);
  for (const rule of spot.legal || []) {
    if (rule.type !== 'ban') continue;
    const monthHit = !rule.months || rule.months.includes(d.month);
    const dayHit = !rule.weekdays || rule.weekdays.includes(d.weekday);
    if (monthHit && dayHit) {
      return {
        kind: 'legal',
        short_he: rule.short_he || 'אסור לגלוש',
        note_he: rule.note_he || null,
        zone_he: rule.zone_he || null,
        source_url: rule.source_url || null,
        verified: rule.verified === true,
      };
    }
  }
  return null;
}

/** אזהרות חוקיות שאינן חוסמות — אזורים מותרים, גבולות, שמורות */
export function legalNotices(spot) {
  return (spot.legal || []).filter(r => r.type !== 'ban');
}
