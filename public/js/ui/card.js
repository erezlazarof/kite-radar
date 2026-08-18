/* =========================================================================
   רדאר קייט — כרטיס ספוט
   -------------------------------------------------------------------------
   חוק ויזואלי אחד: דגל סכנה לעולם לא מודחק ע"י מספר טוב.
   חוק ויזואלי שני: אפור (unknown) נראה אחרת מאדום ומ-blocked.
   ========================================================================= */

import { compassHe, DIR_CLASS_HE } from '../verdict/bands.js';
import { FLAG_HE, n } from '../verdict/phrases.he.js';

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

/** חץ כיוון. הקונבנציה: החץ מצביע לאן הרוח *הולכת*, כלומר dirFrom + 180. */
function arrow(dirDeg) {
  if (dirDeg == null) return '';
  return `<span class="arrow" style="--rot:${(dirDeg + 180) % 360}deg" aria-hidden="true">↑</span>`;
}

export function renderCard(spot, v) {
  const meta = LEVEL_META[v.level] || LEVEL_META.unknown;
  const w = v.window || {};
  const hasWind = w.meanKt != null;

  // רק דגלים קריטיים מגיעים לכרטיס. השאר יורדים לפאנל הפירוט.
  const flags = (v.flags || [])
    .map(f => FLAG_HE[f])
    .filter(f => f && f.severity === 'critical')
    .map(f => `<span class="chip">${f.icon} ${esc(f.text)}</span>`)
    .join('');

  const skill = spot.skill_floor === 'advanced'
    ? '<span class="chip chip-skill">⚑ למתקדמים</span>' : '';

  return `
<article class="card ${meta.cls}" data-spot="${esc(spot.id)}" tabindex="0" role="button"
         aria-expanded="false" aria-label="${esc(spot.name_he)} — ${esc(meta.label)}">
  <div class="card-head">
    <span class="dot" aria-hidden="true"></span>
    <h2 class="spot-name">${esc(spot.name_he)}</h2>
    <span class="region">${esc(REGION_HE[spot.region] || '')}</span>
  </div>

  <div class="card-main">
    <div class="wind">
      ${hasWind ? `<span class="kt num">${n(w.meanKt)}</span><span class="unit">קשר</span>` :
                  `<span class="kt num muted">—</span>`}
      ${hasWind && w.gustKt != null ? `<span class="gust num">משב ${n(w.gustKt)}</span>` : ''}
    </div>
    <div class="dir">
      ${arrow(w.dirDeg)}
      ${w.dirDeg != null ? `<span class="dir-txt">${esc(compassHe(w.dirDeg))}<br><small>${esc(DIR_CLASS_HE[v.dirCls] || '')}</small></span>` : ''}
    </div>
  </div>

  <p class="headline">${v.reason.headline}</p>
  ${v.reason.detail[0] ? `<p class="detail">${v.reason.detail[0]}</p>` : ''}

  ${flags || skill ? `<div class="chips">${flags}${skill}</div>` : ''}
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
      v.reason.caveats.map(c => `<li>${esc(c)}</li>`).join('') + '</ul>');
  }

  if (spot.notes_he) rows.push(`<p class="d-note">${esc(spot.notes_he)}</p>`);

  if (extra.grid) {
    rows.push(`<p class="d-src">התחזית היא לנקודת רשת במרחק <span dir="ltr">${extra.grid.distanceKm.toFixed(1)}</span> ק"מ מהחוף, ברזולוציה של כ-7 ק"מ.</p>`);
  }

  if (spot.sub_spots?.length) {
    rows.push('<h3 class="d-h">חופים נוספים באזור</h3>');
    rows.push('<ul class="d-caveats">' + spot.sub_spots
      .map(s => `<li><b>${esc(s.name_he)}</b> — ${esc(s.note_he || '')}</li>`).join('') + '</ul>');
  }

  return `<div class="detail-panel" data-detail="${esc(spot.id)}">${rows.join('')}</div>`;
}
