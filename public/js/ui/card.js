/* =========================================================================
   רדאר קייט — כרטיס ספוט
   -------------------------------------------------------------------------
   חוק ויזואלי אחד: דגל סכנה לעולם לא מודחק ע"י מספר טוב.
   חוק ויזואלי שני: אפור (unknown) נראה אחרת מאדום ומ-blocked.
   ========================================================================= */

import { compassHe, DIR_CLASS_HE, matchQuiver, kiteRange } from '../verdict/bands.js';
import { FLAG_HE, n } from '../verdict/phrases.he.js';
import { renderSparklineSVG } from './sparkline.js';
import { renderCompass } from './compass.js';

export const LEVEL_META = {
  green:   { cls: 'lv-green',   icon: '🟢', label: 'יש רוח' },
  yellow:  { cls: 'lv-yellow',  icon: '🟡', label: 'גבולי' },
  red:     { cls: 'lv-red',     icon: '🔴', label: 'לא ללכת' },
  blocked: { cls: 'lv-blocked', icon: '⛔', label: 'אסור' },
  unknown: { cls: 'lv-unknown', icon: '⚪', label: 'אין נתונים' },
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * טקסט עברי שעשוי להכיל מילה לטינית או טווח מספרי.
 *
 * רצף לטיני בתוך פסקית עברית נשען על ה-bidi של הדפדפן, ושם הוא נשבר:
 * סימני פיסוק ניטרליים סביבו נודדים לצד הלא נכון, ושתי מילים לטיניות
 * שנפגשות מעבר לגבול פסוקית מתהפכות. עטיפה מפורשת מסלקת את התלות.
 */
export function heText(str) {
  // סדר הפעולות קריטי: מזהים את הרצפים הלטיניים על המחרוזת הגולמית ורק
  // אז מקודדים כל חלק בנפרד. הסדר ההפוך היה מוצא "lt" בתוך &lt; ושובר
  // את הישויות שה-escape בדיוק יצר.
  //
  // נקודה נספרת כחלק מהרצף רק כשאחריה תו לטיני (ims.gov.il), ולא כשהיא
  // נקודת סוף משפט — שם מקומה עם המשפט העברי, בצד שמאל.
  const LATIN = /[A-Za-z][A-Za-z0-9]*(?:[._%+-][A-Za-z0-9]+)*/g;
  const src = String(str ?? '');
  let out = '', last = 0, m;
  while ((m = LATIN.exec(src)) !== null) {
    out += esc(src.slice(last, m.index)) + `<span dir="ltr">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

/** חץ כיוון. הקונבנציה: החץ מצביע לאן הרוח *הולכת*, כלומר dirFrom + 180. */
function arrow(dirDeg) {
  if (dirDeg == null) return '';
  return `<span class="arrow" style="--rot:${(dirDeg + 180) % 360}deg" aria-hidden="true">↑</span>`;
}

/**
 * @param {object} extra  { hours, nowHour } — שעות היום המוצג וקו ה"עכשיו".
 *                        אופציונלי: בלעדיו הכרטיס פשוט לא מצייר מטאוגרם.
 */
export function renderCard(spot, v, extra = {}) {
  const meta = LEVEL_META[v.level] || LEVEL_META.unknown;
  const w = v.window || {};
  const hasWind = w.meanKt != null;

  // רק דגלים קריטיים מגיעים לכרטיס. השאר יורדים לפאנל הפירוט.
  const flags = (v.flags || [])
    .map(f => FLAG_HE[f])
    .filter(f => f && f.severity === 'critical')
    .map(f => `<span class="chip chip-alert" title="${esc(f.text)}">${f.icon} ${esc(f.short || f.text)}</span>`)
    .join('');

  const skill = spot.skill_floor === 'advanced'
    ? '<span class="chip chip-skill">⚑ למתקדמים</span>' : '';

  const cand = spot.status === 'candidate'
    ? '<span class="chip chip-cand" title="לא נמצאה עדות שגולשים כאן בפועל. כיוון החוף נגזר ממפה.">◎ מועמד</span>' : '';

  return `
<article class="card ${meta.cls}" data-spot="${esc(spot.id)}" tabindex="0" role="button"
         aria-expanded="false" aria-label="${esc(spot.name_he)} — ${esc(meta.label)}">
  <header class="card-head">
    <div class="spot-id">
      <h2 class="spot-name">${esc(spot.name_he)}</h2>
      <span class="region">${esc(REGION_HE[spot.region] || '')}</span>
    </div>
    <span class="verdict-badge">${esc(meta.label)}</span>
  </header>

  <div class="card-main">
    <div class="wind">
      ${hasWind
        ? `<span class="kt num">${n(w.meanKt)}</span>
           <span class="wind-meta">
             <span class="unit">קשר</span>
             ${w.gustKt != null ? `<span class="gust num">משב ${n(w.gustKt)}</span>` : ''}
           </span>`
        : `<span class="kt num muted">—</span>`}
    </div>
    ${w.startHour != null ? `
    <div class="when">
      <span class="when-range num" dir="ltr">${String(w.startHour).padStart(2, '0')}:00–${String(w.endHour).padStart(2, '0')}:00</span>
      ${w.hoursRideable > 0
        ? `<span class="when-hours">${n(w.hoursRideable)} שעות מעל הסף</span>`
        : `<span class="when-hours">החלון הטוב ביותר</span>`}
    </div>` : ''}
    ${w.dirDeg != null ? `
    <div class="dir">
      ${renderCompass(w.dirDeg, spot, { dirClass: v.dirCls })}
      <span class="dir-txt">
        <span class="dir-name">${esc(compassHe(w.dirDeg))}</span>
        ${DIR_CLASS_HE[v.dirCls]
          ? `<span class="dir-shore" data-dircls="${esc(v.dirCls)}">${esc(DIR_CLASS_HE[v.dirCls])}</span>`
          : ''}
      </span>
    </div>` : ''}
  </div>

  ${hasWind && extra.hours?.length ? `
  <div class="spark-wrap">
    ${renderSparklineSVG(extra.hours, {
      window: w,
      nowHour: extra.nowHour ?? null,
      dayStart: spot.daytime_window?.start ?? 6,
      dayEnd: spot.daytime_window?.end ?? 21,
    })}
  </div>` : ''}

  <p class="headline">${v.reason.headline}</p>
  ${v.reason.detail[0] ? `<p class="detail">${v.reason.detail[0]}</p>` : ''}

  ${flags || skill || cand ? `<div class="chips">${flags}${skill}${cand}</div>` : ''}
</article>`;
}

export const REGION_HE = {
  north: 'צפון',
  center: 'מרכז',
  south: 'דרום',
  kinneret: 'כנרת',
  eilat: 'אילת',
};

/** פאנל הפירוט שנפתח מתחת לכרטיס */
export function renderDetail(spot, v, extra = {}) {
  const rows = [];

  for (const line of v.reason.detail.slice(1)) rows.push(`<p class="d-line">${line}</p>`);

  if (v.reason.caveats.length) {
    rows.push('<h3 class="d-h">לשים לב</h3>');
    rows.push('<ul class="d-caveats">' +
      v.reason.caveats.map(c => `<li>${heText(c)}</li>`).join('') + '</ul>');
  }

  if (spot.notes_he) rows.push(`<p class="d-note">${heText(spot.notes_he)}</p>`);

  if (extra.grid) {
    rows.push(`<p class="d-src">התחזית היא לנקודת רשת במרחק <span dir="ltr">${extra.grid.distanceKm.toFixed(1)}</span> ק"מ מהחוף, ברזולוציה של כ-7 ק"מ.</p>`);
  }

  // ----- שכבת התכנון. מופרדת במכוון: היא אישית, והיא לא חלק מפסק הדין -----
  const kt = v.window?.meanKt;
  // רק ירוק וצהוב. "לא ללכת" ואחריו "מהעפיפונים שלך: 7 מטר" הוא מסר
  // מעורב, ומסר מעורב בהקשר בטיחותי נקרא כעידוד.
  if (kt != null && (v.level === 'green' || v.level === 'yellow')) {
    const prefs = extra.prefs || {};
    const r = kiteRange(kt, prefs.weightKg);
    const q = matchQuiver(kt, prefs.weightKg, prefs.quiver);
    if (r) {
      rows.push('<h3 class="d-h">מה לקחת</h3>');
      const bits = [];
      if (r.overMax) {
        bits.push(`<p class="d-gear d-gear-no">רוח שולית — הגדול ביותר שיש לך ` +
          `(<span dir="ltr">${r.lo}–${r.hi}</span> מ׳), או פויל.</p>`);
      } else if (r.underMin) {
        bits.push(`<p class="d-gear d-gear-no">מתחת לגדלים הרגילים — ` +
          `<span dir="ltr">${r.lo}</span> מ׳ ומטה, למומחים בלבד.</p>`);
      } else {
        bits.push(
          `<p class="d-gear">לפי <span dir="ltr">${Math.round(prefs.weightKg ?? 75)}</span> ק״ג: ` +
          `עפיפון <b><span dir="ltr">${r.lo}–${r.hi}</span></b> מטר.</p>`);
      }
      if (q.best != null) {
        bits.push(q.fits
          ? `<p class="d-gear d-gear-ok">מהעפיפונים שלך: <b><span dir="ltr">${q.best}</span></b> מטר.</p>`
          : `<p class="d-gear d-gear-no">אין לך עפיפון בגודל הזה. הקרוב ביותר הוא ` +
            `<span dir="ltr">${q.best}</span> מטר, ${q.reason === 'too_small' ? 'קטן מדי' : 'גדול מדי'}.</p>`);
      }
      rows.push(bits.join(''));
    }
  }

  if (spot.sub_spots?.length) {
    rows.push('<h3 class="d-h">חופים נוספים באזור</h3>');
    rows.push('<ul class="d-caveats">' + spot.sub_spots
      .map(s => `<li><b>${heText(s.name_he)}</b> — ${heText(s.note_he || '')}</li>`).join('') + '</ul>');
  }

  return `<div class="detail-panel" data-detail="${esc(spot.id)}">${rows.join('')}</div>`;
}
