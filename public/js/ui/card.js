/* =========================================================================
   רדאר קייט — כרטיס ספוט
   -------------------------------------------------------------------------
   חוק ויזואלי אחד: דגל סכנה לעולם לא מודחק ע"י מספר טוב.
   חוק ויזואלי שני: אפור (unknown) נראה אחרת מאדום ומ-blocked.
   ========================================================================= */

import { compassHe, DIR_CLASS_HE, matchQuiver, kiteRange } from '../verdict/bands.js';
import { FLAG_HE, n, distHe, dec1 } from '../verdict/phrases.he.js';
import { renderSparklineSVG } from './sparkline.js';
import { renderCompass } from './compass.js';
import { renderModelStrip, modelMeanKt } from './modelstrip.js';
import { renderChart } from './chart.js';
import { modelInfo } from '../config.js';

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
  //
  // ⚠️ **הרווח שבין שתי מילים לטיניות שייך לרצף.** עד 20/8 עטפה
  // הפונקציה כל מילה בנפרד, ושני בלוקי LTR שנפגשים מעבר לרווח ניטרלי
  // מתהפכים: בהסתייגות של ריף רף נראה על המסך "מד הרוח של Center Surf".
  // הרווח נבלע רק כשמשני צדדיו תווים אלפאנומריים, כך ש-"Center — על"
  // נעצר לפני המקף.
  const LATIN = /[A-Za-z][A-Za-z0-9]*(?:(?:[._%+-]|[ ])[A-Za-z0-9][A-Za-z0-9]*)*/g;
  const src = String(str ?? '');
  let out = '', last = 0, m;
  while ((m = LATIN.exec(src)) !== null) {
    out += esc(src.slice(last, m.index)) + `<span dir="ltr">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

/**
 * "לפני N דק׳" — אבל אפס דקות אינו "לפני 0 דק׳".
 *
 * מספר שעוגל לאפס נראה כשדה ריק, לא כ"הרגע". זו אותה משפחה של תקלות
 * שהפכה 0.02 ק"מ ל-"0 ק״מ": העיגול מוחק את המידע ומשאיר מספר תקין
 * למראה. אותו כלל, מקום אחר.
 */
export function agoHe(min) {
  if (min == null || !Number.isFinite(min)) return '';
  return min < 1 ? 'הרגע' : `לפני <span class="num">${n(min)}</span> דק׳`;
}

/**
 * שעת המדידה בשעון ישראל, `HH:MM`.
 *
 * זה הנתון שארז ביקש במפורש. "לפני 11 דק׳" לבדו הוא הבטחה בלי מקור:
 * הוא נגזר משעון המכשיר, ואם הוא סוטה — וגם אם ההזנה קפאה — הוא ימשיך
 * להיראות סביר. שעה מוחלטת ניתנת להצלבה מול שעון הקיר.
 */
export function clockHe(tsMs) {
  if (tsMs == null || !Number.isFinite(tsMs)) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(tsMs);
}

/**
 * מחרוזת שכולה לטינית, כבלוק LTR **אחד**.
 *
 * `heText` מזהה את הרצפים בתוך עברית; זו אומרת מראש שהכל לטיני — קוד
 * תחנה, שם מודל, מזהה. היא לא תלויה בזיהוי, ולכן היא הנכונה כשהמחרוזת
 * עשויה להכיל תווים שאינם אלפאנומריים ("ECMWF-IFS 0.25°").
 */
export function ltr(s) {
  return `<span dir="ltr">${esc(s)}</span>`;
}

/**
 * שתי שורות המספרים — **הלב של הכרטיס**.
 *
 * הגרסה הקודמת שמה תווית "תחזית" בגופן 11.5 אפור חיוור **מעל** מספר
 * של 38 פיקסלים מודגש. התווית הייתה שם ואיש לא קרא אותה: העין קופצת
 * למספר. ארז ניסח את זה מדויק — "לא בדיוק ברור מה התחזית ומה נמדד".
 *
 * התיקון אינו עוד טקסט אלא **מבנה זהה לשניהם**: כל מספר יושב בשורה
 * משלו, עם תג צמוד לו בגודל קבוע, ועם *מוסמך זמן* בקצה. ההבדל בין
 * השניים נקרא מהזמן ולא מהניסוח:
 *
 *   [תחזית]  14 קשר · משב 17          18:00–20:00   ← חלון בעתיד
 *   [● נמדד]  7 קשר · משב 14           לפני 38 דק׳   ← עכשיו
 *
 * מה שהוסר בכוונה: שם המודל (`ICON` אינו אומר דבר לגולש ומרעיש דווקא
 * על המילה שחשובה), ו"התחזית אמרה 14" — כשהמספרים זה מעל זה ומתויגים,
 * חזרה שלישית על אותו מספר מבלבלת במקום להסביר.
 */
function numberRows(v, extra) {
  const m = v.measured;
  const w = v.window || {};
  const hasWind = w.meanKt != null;
  const leadMeasured = v.lead === 'measured' && m != null;

  const forecastRow = hasWind ? row({
    kind: 'forecast',
    lead: !leadMeasured,
    tag: 'תחזית',
    live: false,
    kt: w.meanKt,
    gustKt: w.gustKt,
    when: w.startHour != null
      ? `<span dir="ltr">${hhmmRange(w)}</span>`
      : 'החלון הטוב ביותר',
  }) : `<div class="num-row is-lead" data-kind="forecast">
      <span class="num-tag">תחזית</span>
      <span class="num-val kt num muted">—</span>
    </div>`;

  const measuredRow = m ? row({
    kind: 'measured',
    lead: leadMeasured,
    tag: 'נמדד',
    live: true,
    kt: m.speedKt,
    gustKt: m.gustKt,
    // ⚠️ "לפני 38 דק׳" הוא מה שמבדיל את השורה הזו מהתחזית, ולכן הוא
    // אף פעם לא מוותר על מקומו לטובת שם התחנה. שם התחנה יורד לשורת
    // המקור שמתחת — הוא בונה אמון, אבל הוא לא מה שמפריד בין השתיים.
    when: agoHe(m.ageMin) || 'עכשיו',
  }) : '';

  const src = m ? `<p class="num-src">${heText(m.stationName_he || 'מד רוח על החוף')}${
    clockHe(m.tsMs) ? ` · <span dir="ltr">${esc(clockHe(m.tsMs))}</span>` : ''}</p>` : '';

  return `<div class="nums" data-lead="${leadMeasured ? 'measured' : 'forecast'}">
    ${leadMeasured ? measuredRow + forecastRow : forecastRow + measuredRow}
    ${src}
  </div>`;
}

function row({ kind, lead, tag, live, kt, gustKt, when }) {
  return `<div class="num-row${lead ? ' is-lead' : ''}${live ? ' is-live' : ''}" data-kind="${kind}">
    <span class="num-tag">${live ? '<i class="m-dot" aria-hidden="true"></i>' : ''}${esc(tag)}</span>
    <span class="num-val${lead ? ' kt' : ''} num">${n(kt)}</span>
    <span class="num-unit">קשר</span>
    ${gustKt != null ? `<span class="num-gust num">משב ${n(gustKt)}</span>` : ''}
    <span class="num-when">${when}</span>
  </div>`;
}

function hhmmRange(w) {
  return `${String(w.startHour).padStart(2, '0')}:00–${String(w.endHour).padStart(2, '0')}:00`;
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

  // מי מוביל — **החלטה של המנוע**, לא של התצוגה. היא נשענת על
  // ייצוגיות התחנה, טריות הקריאה, הדרגה ושעת היום, וכולן נבדקות
  // ב-test/verdict.test.js. הכרטיס רק מרנדר את מה שכבר הוכרע.
  const leadMeasured = v.lead === 'measured' && v.measured != null;

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
<article class="card ${meta.cls}" id="${esc(spot.id)}" data-spot="${esc(spot.id)}" tabindex="0" role="button"
         aria-expanded="false" aria-label="${esc(spot.name_he)} — ${esc(meta.label)}">
  <header class="card-head">
    <div class="spot-id">
      <h2 class="spot-name">${esc(spot.name_he)}</h2>
      <span class="region">${esc(REGION_HE[spot.region] || '')}</span>
    </div>
    <span class="verdict-badge">${esc(meta.label)}</span>
  </header>

  <div class="card-main">
    ${numberRows(v, extra)}
    ${/* ⚠️ המצפן נשאר על **כיוון התחזית** גם כשהמדידה מובילה, ובכוונה:
          הוא הסימן הבטיחותי היחיד במסך, והוא זה שנגזרה ממנו הדרגה.
          מצפן שמצייר את הכיוון הנמדד ותג "צד-חוף" שנגזר מהחזוי היו
          שני מקורות שסותרים זה את זה על אותו פיקסל. כשהכיוון הנמדד
          מסוכן והחזוי לא — `obs_dir_disagrees` מרים צ'יפ, והכיוון
          הנמדד מופיע במלואו בפאנל "מאיפה המספר". */ ''}
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
  // ספוטים שהמשתמש הוסיף יושבים בקבוצה משלהם ולא מעורבבים בין החופים
  // המאומתים. ההפרדה היא חלק מהמסר: אלה לא אותו סוג של ידיעה.
  mine: 'שלי',
};

/**
 * הסעיף שנוסף לפאנל הפירוט של ספוט משתמש.
 * שכבת האירועים יושבת ב-ui/addspot.js ומאזינה ל-data-user-action.
 */
export function renderUserSpotActions(spot) {
  if (spot.source !== 'user') return '';
  return `
  <div class="user-actions">
    <h3 class="d-h">הספוט הזה שלך</h3>
    <p class="d-line d-muted">הוא נשמר במכשיר הזה בלבד, ולא יגיע ל"יש רוח" —
      כיוון החוף שלו לא אומת בידי אדם.</p>
    <div class="ua-row">
      <button type="button" class="ua-btn" data-user-action="share" data-spot-id="${esc(spot.id)}">שתף</button>
      <button type="button" class="ua-btn" data-user-action="propose" data-spot-id="${esc(spot.id)}">הצע לרג'יסטר</button>
      <button type="button" class="ua-btn ua-danger" data-user-action="delete" data-spot-id="${esc(spot.id)}">מחק</button>
    </div>
  </div>`;
}

/** מצב ההזנה, במילים. קריאה טרייה מהזנה שנפלה היא סתירה שצריך לראות. */
const FEED_HE = {
  fresh: 'ההזנה פעילה',
  stale: 'ההזנה מתעכבת',
  dead:  'ההזנה מושבתת',
};

/**
 * "מאיפה המספר" — הפאנל שארז ביקש.
 *
 * המסמך המלא של שני המספרים: מי מדד, מאיזה מרחק, מתי בדיוק, מה מצב
 * ההזנה, איזה מודל, מאיזו נקודת רשת ומתי נמשכה. זה הסעיף שהופך את
 * "13 מול 17" מסתירה מביכה למידע — כי אחרי שקוראים אותו רואים ששניהם
 * נכונים ולמה הם שונים.
 */
export function renderSourcePanel(spot, v, extra = {}) {
  const m = v.measured;
  const w = v.window || {};
  const mi = modelInfo(extra.model);
  const rows = [];

  if (m) {
    const facts = [];
    const head = [`<b class="num">${n(m.speedKt)}</b> קשר`];
    if (m.gustKt != null) head.push(`משב <span class="num">${n(m.gustKt)}</span>`);
    if (m.dirDeg != null) {
      head.push(`${esc(compassHe(m.dirDeg))} (<span dir="ltr">${Math.round(m.dirDeg)}°</span>)`);
    }
    facts.push(head.join(' · '));

    const when = [];
    const t = clockHe(m.tsMs);
    if (t) when.push(`נמדד ב-<span dir="ltr">${esc(t)}</span>`);
    if (agoHe(m.ageMin)) when.push(agoHe(m.ageMin));
    const d = distHe(m.distanceKm);
    if (d) when.push(`${d} מהספוט`);
    if (FEED_HE[m.feedState]) when.push(FEED_HE[m.feedState]);
    if (when.length) facts.push(when.join(' · '));

    if (m.forecastAtObsKt != null) {
      const gap = Math.abs(m.deltaKt);
      facts.push(`התחזית לאותה שעה: <span class="num">${n(m.forecastAtObsKt)}</span> קשר` +
        (gap < 2 ? ' — תואם' : ` · פער ${dec1(gap)} קשר`));
    }

    rows.push(srcRow('נמדד', m.stationName_he || 'מד רוח על החוף', facts, true));
  } else {
    rows.push(srcRow('נמדד', 'אין מדידה חיה לספוט הזה',
      ['הכרטיס נשען על התחזית בלבד.'], false));
  }

  const fFacts = [];
  if (w.meanKt != null && w.startHour != null) {
    fFacts.push(`<b class="num">${n(w.meanKt)}</b> קשר בחלון ` +
      `<span dir="ltr">${hhmmRange(w)}</span> — הבלוק הרצוף הטוב ביותר היום`);
  }
  const gridBits = [];
  if (extra.grid?.distanceKm != null) {
    gridBits.push(`נקודת רשת ${distHe(extra.grid.distanceKm)} מהחוף`);
  }
  if (mi.resKm) gridBits.push(`רזולוציה כ-<span dir="ltr">${mi.resKm}</span> ק״מ`);
  if (v.freshness?.ageMin != null) {
    gridBits.push(`נמשכה ${agoHe(v.freshness.ageMin)}`);
  }
  if (gridBits.length) fFacts.push(gridBits.join(' · '));
  // המודל נאמר בשם תמיד בפאנל הזה — כאן דווקא **המקור** הוא הנושא.
  // בכרטיס הוא נאמר בקצרה; מי שפתח את הפאנל בא לדעת.
  if (!mi.isDefault && spot.models?.reason_he) fFacts.push(heText(spot.models.reason_he));

  rows.push(srcRow('תחזית', mi.label, fFacts, false));

  return `<h3 class="d-h">מאיפה המספר</h3><div class="srcbox">${rows.join('')}</div>`;
}

function srcRow(tag, title, facts, live) {
  return `<div class="srcbox-row">
    <span class="srcbox-tag${live ? ' is-live' : ''}">${esc(tag)}</span>
    <div class="srcbox-body">
      <p class="srcbox-title">${heText(title)}</p>
      ${facts.map(f => `<p class="srcbox-fact">${f}</p>`).join('')}
    </div>
  </div>`;
}

/**
 * מפרט המטאוגרם. מיוצא כי הסקראבר חייב להאכיל את chartHitTest
 * *באותם* opts שבהם צויר הגרף — אחרת האצבע והציור מדברים על צירים שונים.
 */
export function chartOpts(spot, v, extra) {
  return {
    width: 340, height: 172, days: 3,
    nowHour: extra.nowHour ?? null, nowDayIndex: 0,
    windows: extra.windows || [],
    level: v.level,
    idPrefix: 'ch' + String(spot.id).replace(/[^A-Za-z0-9]/g, ''),
  };
}

/** פאנל הפירוט שנפתח מתחת לכרטיס */
export function renderDetail(spot, v, extra = {}) {
  const rows = [];

  // המטאוגרם ראשון: מי שלחץ על כרטיס רוצה לראות *מתי*, לא לקרוא.
  if (extra.allHours?.length) {
    rows.push(`<div class="chart-wrap" data-chart="${esc(spot.id)}">
      ${renderChart(extra.allHours, chartOpts(spot, v, extra))}
      <div class="chart-read" data-read="${esc(spot.id)}" aria-live="polite"></div>
    </div>`);
  }

  for (const line of v.reason.detail.slice(1)) rows.push(`<p class="d-line">${line}</p>`);

  if (v.reason.caveats.length) {
    rows.push('<h3 class="d-h">לשים לב</h3>');
    rows.push('<ul class="d-caveats">' +
      v.reason.caveats.map(c => `<li>${heText(c)}</li>`).join('') + '</ul>');
  }

  if (spot.notes_he) rows.push(`<p class="d-note">${heText(spot.notes_he)}</p>`);

  // נימוק ניצב-החוף. הוא באנגלית וטכני, והוא המספר היחיד ברג'יסטר
  // שטעות בו מסוכנת — ולכן הוא מוצג, אבל כבלוק LTR נפרד. משפט אנגלי
  // שלם בתוך פסקה עברית מתפרק ומתהפך.
  if (spot.shore_normal_basis) {
    rows.push('<h3 class="d-h">איך נגזר כיוון החוף</h3>');
    rows.push(`<p class="d-basis" dir="ltr" lang="en">${esc(spot.shore_normal_basis)}</p>`);
  }

  rows.push(renderSourcePanel(spot, v, extra));

  // ----- השוואת מודלים -----
  if (extra.models !== undefined && v.window) {
    rows.push('<h3 class="d-h">מה המודלים אומרים</h3>');
    if (extra.models === null) {
      rows.push('<p class="d-line d-muted">טוען השוואה…</p>');
    } else {
      const points = {};
      for (const [id, hrs] of Object.entries(extra.models)) {
        const mean = modelMeanKt(hrs, v.window, v.day ?? 0);
        if (mean != null) points[id] = mean;
      }
      rows.push(renderModelStrip(points, v.window.meanKt, {
        excluded: spot.models?.exclude || [],
        reason_he: spot.models?.reason_he,
      }));
    }
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

  rows.push(renderUserSpotActions(spot));

  // הפאנל אינו צאצא של הכרטיס בעץ ה-DOM, ולכן --lv אינו יורש אליו.
  // בלי מחלקת הדרגה כאן, המטאוגרם מצויר בצבע הטקסט במקום בצבע פסק הדין.
  const meta = LEVEL_META[v.level] || LEVEL_META.unknown;
  return `<div class="detail-panel ${meta.cls}" data-detail="${esc(spot.id)}">${rows.join('')}</div>`;
}
