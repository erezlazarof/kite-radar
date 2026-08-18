/* =========================================================================
   רדאר קייט — ניסוח הנימוק בעברית
   -------------------------------------------------------------------------
   שני כללים שאסור לשבור:
   1. אסימטריה לשונית — האפליקציה *מתארת* תנאים ולא *מצווה*.
      "18 קשר, צד-חוף" לטוב. "לא ללכת" לרע. לעולם לא "לך".
   2. כל טווח מספרי עטוף ב-dir="ltr" — אחרת "12–18" מתהפך בתוך טקסט עברי.
   ========================================================================= */

import { compassHe, DIR_CLASS_HE, speedBandLabel, kiteSize } from './bands.js';

/** מספר בודד — לא צריך עטיפה, ספרה יחידה בעברית לא מתהפכת */
export const n = v => (v == null ? '—' : String(Math.round(v)));

/** טווח מספרי — חייב עטיפה, אחרת המקף הניטרלי הופך את הסדר */
export const range = (a, b) => `<span dir="ltr">${Math.round(a)}–${Math.round(b)}</span>`;

/** שעה — נקודתיים ניטרליות, אותה בעיה */
export const hhmm = h => `<span dir="ltr">${String(h).padStart(2, '0')}:00</span>`;

/**
 * דגלים.  severity קובע איפה הדגל מופיע:
 *   'critical' → צ'יפ על הכרטיס, תמיד, גם כשהמספר טוב.
 *   'note'     → שורה בפאנל הפירוט בלבד.
 * צ'יפ שמופיע כמעט על כל כרטיס מאמן את העין להתעלם מצ'יפים —
 * ולכן "המראה קשה", שהוא מצב הרוח הרגיל בים התיכון בקיץ, אינו צ'יפ.
 */
export const FLAG_HE = {
  offshore_danger: { icon: '⛔', short: 'רוח החוצה', text: 'הרוח דוחפת אותך מהחוף אל הים הפתוח.', severity: 'critical' },
  rescue:          { icon: '⛑', short: 'לוודא חילוץ', text: 'רוח צד-החוצה — לוודא שיש מי שיאסוף אותך אם לא תחזור.', severity: 'critical' },
  rescue_boat:     { icon: '⛑', short: 'סירת חילוץ', text: 'נדרשת סירת חילוץ פעילה בים.', severity: 'critical' },
  upwind_skill:    { icon: '↑',  short: 'אפ-ווינד חובה', text: 'חובה יכולת חתירה נגד הרוח. בלעדיה לא נכנסים למים כאן.', severity: 'critical' },
  gusty:           { icon: '⚠', short: 'משבים', text: 'הרוח לא יציבה — פערי משב גדולים.', severity: 'critical' },
  model_spread:    { icon: '≈', short: 'מודלים חלוקים', text: 'מודלי התחזית חלוקים ביניהם.', severity: 'critical' },
  stale:           { icon: '⏱', short: 'נתון ישן', text: 'הנתון לא טרי.', severity: 'critical' },
  unverified_spot: { icon: '◎', short: 'לא אומת', text: 'ספוט שלא אומת.', severity: 'critical' },
  skill_advanced:  { icon: '⚑', short: 'למתקדמים', text: 'ספוט למתקדמים בלבד.', severity: 'skip' },
  hard_launch:     { icon: '⚠', text: 'הרוח מגיעה ישר מהים — ההמראה והנחיתה קשות יותר, אבל היא גם מחזירה אותך לחוף.', severity: 'note' },
};

/** מה מגביל — בשתי מילים, לכותרת. המספר כבר מוצג בגדול מעליה. */
function bindingShort(v) {
  const c = v.components;
  const e = [['speed', c.speed], ['direction', c.direction], ['gust', c.gust]]
    .filter(([, s]) => s != null).sort((a, b) => a[1] - b[1]);
  const k = e[0]?.[0];
  if (k === 'speed') return speedBandLabel(v.window.meanKt);
  if (k === 'direction') return DIR_CLASS_HE[v.dirCls] || 'כיוון בעייתי';
  if (k === 'gust') return 'משבים';
  return null;
}

export const HEADLINE = {
  green:   v => `יש רוח · ${DIR_CLASS_HE[v.dirCls] || ''}`,
  yellow:  v => `גבולי · ${bindingShort(v) || ''}`,
  red:     v => `לא ללכת · ${bindingShort(v) || ''}`,
  blocked: v => v.gate?.short_he || 'אסור לגלוש',
  unknown: () => 'אין נתונים',
};

/**
 * בונה את שורות הפירוט. הכלל: השורה הראשונה נוקבת ב**אילוץ הכובל** —
 * הרכיב עם הניקוד הנמוך ביותר — ולא במשפט גנרי.
 */
export function buildDetail(v, spot) {
  const out = [];
  const w = v.window;
  const c = v.components;

  if (v.level === 'unknown') {
    out.push(v.reasonCode === 'stale'
      ? 'התחזית האחרונה שהתקבלה ישנה מדי כדי להישען עליה.'
      : 'לא התקבלו נתוני רוח עבור הספוט הזה.');
    return out;
  }

  if (v.level === 'blocked') {
    if (v.gate?.note_he) out.push(v.gate.note_he);
    if (w?.meanKt != null) {
      out.push(`הרוח עצמה: ${n(w.meanKt)} קשר ${compassHe(w.dirDeg)}, ${speedBandLabel(w.meanKt)}.`);
    }
    if (v.gate?.verified === false) out.push('◎ הכלל הזה עדיין לא אומת מול המקור הרשמי.');
    return out;
  }

  // האילוץ הכובל
  const entries = [['speed', c.speed], ['direction', c.direction], ['gust', c.gust]]
    .filter(([, s]) => s != null)
    .sort((a, b) => a[1] - b[1]);
  const binding = entries[0]?.[0];

  const winTxt = w.startHour != null && w.endHour != null
    ? ` בין ${hhmm(w.startHour)} ל-${hhmm(w.endHour)}`
    : '';

  if (binding === 'speed') {
    out.push(`${speedBandLabel(w.meanKt)}${winTxt} — ${n(w.meanKt)} קשר, משב עד ${n(w.gustKt)}.`);
  } else if (binding === 'direction') {
    out.push(`הכיוון הוא מה שמגביל: ${compassHe(w.dirDeg)}, ${DIR_CLASS_HE[v.dirCls]}.`);
  } else {
    out.push(`הרוח לא יציבה: ממוצע ${n(w.meanKt)} מול משב ${n(w.gustKt)} קשר.`);
  }

  // תמיד לתת את התמונה המלאה בשורה שנייה
  out.push(`${n(w.meanKt)} קשר, משב ${n(w.gustKt)}, מכיוון ${compassHe(w.dirDeg)} · ${DIR_CLASS_HE[v.dirCls]}.`);

  if (w.hoursRideable > 0) {
    out.push(`חלון של ${n(w.hoursRideable)} שעות מעל סף הגלישה.`);
  }

  const ks = kiteSize(w.meanKt, v.prefs);
  if (ks && v.level !== 'red') out.push(`עפיפון בערך <span dir="ltr">${ks}</span> מטר.`);

  if (v.dirNote) out.push(v.dirNote);

  return out;
}

/** הסתייגויות — נאמרות תמיד כשהן קיימות, לעולם לא מודחקות ע"י ניקוד טוב */
export function buildCaveats(v, spot) {
  const out = [];

  // רק דגלים שאינם צ'יפ על הכרטיס. הנוסח המלא של צ'יפ יושב ב-title שלו,
  // ולכן חזרה עליו כאן הייתה הופכת את הרשימה למלאי במקום לקיורציה.
  for (const f of v.flags || []) {
    const meta = FLAG_HE[f];
    if (meta && meta.severity === 'note') out.push(meta.text);
  }

  if (v.freshness?.stale) {
    out.push(`התחזית התקבלה לפני ${n(v.freshness.ageMin)} דקות.`);
  }
  if (v.confidence?.modelSpreadKt != null && v.confidence.modelSpreadKt > 8) {
    out.push(`המודלים חלוקים ב-${n(v.confidence.modelSpreadKt)} קשר. לבדוק שוב קרוב יותר למועד.`);
  }
  if (spot.source === 'user') {
    out.push('ספוט שהוספת בעצמך. הגיאומטריה לא נבדקה, ולכן אין דירוג ירוק.');
  }
  if (spot.marine?.confidence === 'estimate' && spot.marine.note_he) {
    out.push(spot.marine.note_he);
  }
  if (spot.marine?.confidence === 'none' && spot.marine.note_he) {
    out.push(spot.marine.note_he);
  }
  for (const h of spot.hazards || []) {
    if (h.severity === 'high') out.push(h.note_he);
  }
  for (const r of spot.legal || []) {
    if (r.type !== 'ban' && r.note_he) out.push(r.note_he);
  }
  if ((spot._verify || []).length) {
    out.push('חלק מנתוני הספוט עדיין לאימות.');
  }
  // ניכוי כפילויות — כמה מקורות יכולים לומר את אותו דבר
  return [...new Set(out.filter(Boolean))];
}
