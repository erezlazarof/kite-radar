/* =========================================================================
   רדאר קייט — רצועת הסכמת המודלים
   -------------------------------------------------------------------------
   ⚠️ מודול טהור. מחזיר מחרוזת SVG.

   ההודעה כאן היא **הפער**, לא שלושת המספרים. משתמש שצריך לפענח
   "GFS 13, ECMWF 23, ICON 18" כדי להבין שהמודלים חלוקים — לא יפענח.
   רצועה מוצללת שרוחבה הוא הפער, וצבעה מקודד את גודלו, נקראת בשנייה.
   ========================================================================= */

import { MODELS } from '../config.js';

const r2 = v => Math.round(v * 100) / 100;
const isNum = v => typeof v === 'number' && Number.isFinite(v);

export const STRIP_KT = { min: 4, max: 34 };
export const SPREAD_BANDS = { agree: 3, mild: 6 };

/** ממוצע מודל בחלון הנבחר — אותו חלון שהמנוע ניקד לפיו */
export function modelMeanKt(modelHours, window, dayIndex = 0) {
  if (!Array.isArray(modelHours) || !window) return null;
  const sel = modelHours.filter(
    h => h.dayIndex === dayIndex && h.hour >= window.startHour && h.hour < window.endHour && isNum(h.speedKt)
  );
  if (!sel.length) return null;
  return sel.reduce((s, h) => s + h.speedKt, 0) / sel.length;
}

export function spreadLabel(spreadKt) {
  if (spreadKt == null) return { cls: 'none', text: 'מודל אחד בלבד' };
  if (spreadKt <= SPREAD_BANDS.agree) return { cls: 'agree', text: 'המודלים מסכימים' };
  if (spreadKt <= SPREAD_BANDS.mild) return { cls: 'mild', text: 'הסכמה חלקית' };
  return { cls: 'split', text: 'המודלים חלוקים' };
}

/**
 * @param {object} points  { modelId: meanKt }  — רק מודלים שהוחזרו בפועל
 * @param {number|null} bestMatchKt  ערך best_match, לסימון
 * @param {object} opts  { width=300, height=44, excluded=[], reason_he }
 */
export function renderModelStrip(points, bestMatchKt, opts = {}) {
  const width = opts.width ?? 300;
  const height = opts.height ?? 44;
  const entries = Object.entries(points || {}).filter(([, v]) => isNum(v));

  if (entries.length === 0) {
    return `<div class="mstrip mstrip-empty">לא התקבלה השוואת מודלים.</div>`;
  }

  const vals = entries.map(([, v]) => v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const spread = entries.length >= 2 ? hi - lo : null;
  const label = spreadLabel(spread);

  // הציר קבוע ולא נגזר מהנתונים: רצועה שנמתחת לרוחב המסך בכל מקרה
  // הייתה גורמת לפער של קשר אחד להיראות כמו פער של עשרה.
  const X = kt => {
    const t = (Math.min(Math.max(kt, STRIP_KT.min), STRIP_KT.max) - STRIP_KT.min) /
              (STRIP_KT.max - STRIP_KT.min);
    return r2(width - t * width); // ימין→שמאל, כמו כל ציר באפליקציה
  };

  const yBar = r2(height * 0.42);
  const parts = [];

  // סרגל רקע
  parts.push(`<line class="ms-axis" x1="0" y1="${yBar}" x2="${width}" y2="${yBar}"/>`);
  for (const kt of [10, 15, 20, 25, 30]) {
    parts.push(`<line class="ms-tick" x1="${X(kt)}" y1="${yBar - 4}" x2="${X(kt)}" y2="${yBar + 4}"/>`);
    parts.push(`<text class="ms-tick-label" x="${X(kt)}" y="${r2(height - 3)}" text-anchor="middle">${kt}</text>`);
  }

  // רצועת הפער — ההודעה עצמה
  if (spread != null) {
    const x1 = X(hi), x2 = X(lo);
    parts.push(
      `<rect class="ms-span ms-span--${label.cls}" x="${r2(Math.min(x1, x2))}" y="${r2(yBar - 7)}" ` +
      `width="${r2(Math.abs(x2 - x1))}" height="14" rx="7"/>`
    );
  }

  if (isNum(bestMatchKt)) {
    parts.push(`<line class="ms-best" x1="${X(bestMatchKt)}" y1="${r2(yBar - 11)}" x2="${X(bestMatchKt)}" y2="${r2(yBar + 11)}"/>`);
  }

  for (const [id, v] of entries) {
    const meta = MODELS[id] || { short: id.slice(0, 1).toUpperCase(), label: id };
    parts.push(
      `<g class="ms-dot"><circle cx="${X(v)}" cy="${yBar}" r="4.6"/>` +
      `<text class="ms-dot-label" x="${X(v)}" y="${r2(yBar - 10)}" text-anchor="middle">${meta.short}</text>` +
      `<title>${meta.label}: ${Math.round(v)} קשר</title></g>`
    );
  }

  const svg =
    `<svg class="mstrip-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" ` +
    `preserveAspectRatio="none" role="img" aria-label="${escAttr(summaryText(entries, spread, label))}">` +
    parts.join('') + '</svg>';

  const excluded = (opts.excluded || []).filter(Boolean);
  const note = excluded.length
    ? `<p class="mstrip-note">${escHtml(opts.reason_he || 'מודל אחד לא מוצג כאן.')}</p>`
    : '';

  return `<div class="mstrip">${svg}
    <p class="mstrip-sum ms-${label.cls}">${escHtml(summaryText(entries, spread, label))}</p>
    ${note}</div>`;
}

function summaryText(entries, spread, label) {
  if (entries.length < 2) return 'מודל אחד בלבד — אין מה להשוות.';
  return `${label.text} · הפרש ${Math.round(spread)} קשר`;
}

const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escAttr = escHtml;
