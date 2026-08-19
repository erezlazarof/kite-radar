/* =========================================================================
   רדאר קייט — "הוסף ספוט משלך"
   -------------------------------------------------------------------------
   שכבת ה-DOM של שלב 6. כל הלוגיקה הטהורה יושבת ב-userspots.js וב-dial.js,
   וכאן רק חיווט אירועים — כדי שהחלק שאפשר לטעות בו יהיה החלק שנבדק.

   שלוש החלטות שנשמעות קטנות ואינן:

   1. **אין מפה.** מפה דורשת ספק אריחים חיצוני, כלומר תלות ברשת בדיוק
      במקום שבו האפליקציה מבטיחה לעבוד בלי רשת, ובקשות ל-domain שלישי
      מדף שאמור להיות עצמאי. במקום זה: הדבקת נ.צ. מגוגל מפות (הפעולה
      שאדם כבר עושה ממילא) או מיקום נוכחי.

   2. **קישור שיתוף לעולם אינו מוסיף ספוט בשקט.** הוא פותח מסך אישור.
      קישור שמזריק נתון בטיחותי למכשיר של מישהו בלי שהוא ראה אותו הוא
      בדיוק הדפוס שלא רוצים באפליקציה שאומרת לאנשים אם להיכנס למים.

   3. **החוגה מציירת תוצאה, לא מעלות.** ראה dial.js.
   ========================================================================= */

import {
  parseCoords, validateUserSpot, makeUserSpot, makeId, norm360,
  nearestStation, nearestCoreSpot, duplicateOf,
  addUserSpot, removeUserSpot, loadUserSpots,
  decodeShare, shareUrl, issueBody,
} from '../userspots.js';
import { renderDial, bearingAt, dialSentence } from './dial.js';
import { compassHe, compassNounHe } from '../verdict/bands.js';
import { esc, ltr } from './card.js';
import { GITHUB } from '../config.js';

const $ = (sel, root = document) => root.querySelector(sel);

/** מצב הטופס. חי כאן ולא ב-store — הוא לא שורד סגירת הדיאלוג בכוונה. */
let draft = null;
let onChange = () => {};

/* ---------------------------------------------------------------- */
/* פתיחה                                                             */
/* ---------------------------------------------------------------- */

/**
 * @param {object} opts { spots, onChange }  spots = הרג'יסטר המלא, לצורך
 *   התאמת תחנה וספוט ייחוס. onChange נקרא אחרי הוספה או מחיקה.
 */
export function initAddSpot(opts) {
  onChange = opts.onChange || (() => {});
  const dlg = $('#addspot');
  if (!dlg) return;

  $('#as-name').addEventListener('input', () => {
    draft.name = $('#as-name').value;
    draft.touched.add('name');
    validate(opts);
  });

  $('#as-coords').addEventListener('input', () => {
    draft.touched.add('coords');
    applyCoordText($('#as-coords').value, opts);
  });
  $('#as-coords').addEventListener('paste', e => {
    // ההדבקה מגיעה לפני שהערך בשדה מתעדכן, ולכן קוראים מהאירוע עצמו
    const t = e.clipboardData?.getData('text');
    if (t) setTimeout(() => applyCoordText(t, opts), 0);
  });

  $('#as-locate').addEventListener('click', () => locate(opts));

  $('#as-deg').addEventListener('input', () => setNormal(+$('#as-deg').value, opts));

  bindDial(opts);

  $('#as-copy-normal').addEventListener('click', () => {
    const near = draft.near;
    if (near) setNormal(near.spot.shore_normal_deg, opts);
  });

  $('#as-save').addEventListener('click', e => {
    e.preventDefault();
    // לחיצה על "הוסף" היא הצהרה שסיימת — מכאן כל שגיאה מוצגת
    for (const f of ['name', 'coords', 'deg']) draft.touched.add(f);
    validate(opts);
    save(opts);
  });

  dlg.addEventListener('close', () => { draft = null; });
}

/** פותח את הטופס ריק */
export function openAddSpot(opts) {
  draft = { name: '', lat: null, lon: null, deg: 270, near: null, station: null, shared: false, touched: new Set() };
  fill(opts);
  $('#addspot')?.showModal();
  $('#as-name')?.focus();
}

/**
 * פותח את הטופס על ספוט שהגיע בקישור. **תמיד עם אישור** — ראה למעלה.
 * @returns {boolean} האם הקישור היה תקין
 */
export function openSharedSpot(encoded, opts) {
  const r = decodeShare(encoded);
  if (!r.ok) {
    draft = { name: '', lat: null, lon: null, deg: 270, near: null, station: null, shared: false, touched: new Set() };
    fill(opts);
    setErrors([r.error]);
    $('#addspot')?.showModal();
    return false;
  }
  draft = {
    name: r.draft.name, lat: r.draft.lat, lon: r.draft.lon,
    deg: norm360(r.draft.shoreNormalDeg), near: null, station: null, shared: true,
    // ספוט ששותף הגיע מלא — אין "שדה שלא נגעו בו" להסתיר מאחוריו
    touched: new Set(['name', 'coords', 'deg']),
  };
  recomputeGeo(opts);
  fill(opts);
  $('#addspot')?.showModal();
  return true;
}

/* ---------------------------------------------------------------- */
/* מילוי ועדכון                                                      */
/* ---------------------------------------------------------------- */

function fill(opts) {
  $('#as-name').value = draft.name;
  $('#as-coords').value = draft.lat != null ? `${draft.lat}, ${draft.lon}` : '';
  $('#as-deg').value = draft.deg;
  $('#addspot-title').textContent = draft.shared ? 'ספוט ששותף איתך' : 'הוסף ספוט משלך';
  $('#as-shared-note').hidden = !draft.shared;
  $('#as-save').textContent = draft.shared ? 'הוסף אצלי' : 'הוסף';
  drawDial();
  updateGeoStatus();
  validate(opts);
}

function applyCoordText(text, opts) {
  const c = parseCoords(text);
  if (!c) {
    draft.lat = draft.lon = null;
    draft.near = draft.station = null;
    updateGeoStatus('לא זיהיתי קואורדינטות. אפשר להדביק מגוגל מפות: לחיצה ארוכה על הנקודה ← העתקת הקואורדינטות.');
    validate(opts);
    return;
  }
  draft.lat = c.lat;
  draft.lon = c.lon;
  draft.swapped = c.swapped;
  recomputeGeo(opts);
  // כיוון החוף של הספוט המוכר הקרוב הוא ניחוש פתיחה טוב: חופים סמוכים
  // על אותו קו חוף פונים כמעט לאותו כיוון. הוא **הצעה**, והמשתמש מזיז.
  if (draft.near && !draft.touchedDial) setNormal(draft.near.spot.shore_normal_deg, opts, true);
  updateGeoStatus();
  validate(opts);
}

function recomputeGeo(opts) {
  const core = (opts.spots || []).filter(s => s.source !== 'user');
  draft.near = draft.lat == null ? null : nearestCoreSpot(draft.lat, draft.lon, core);
  draft.station = draft.lat == null ? null : nearestStation(draft.lat, draft.lon, core);
  draft.dup = draft.lat == null ? null : duplicateOf(draft.lat, draft.lon, opts.spots || []);
}

function updateGeoStatus(overrideMsg) {
  const el = $('#as-coord-status');
  // ⚠️ כל יציאה מוקדמת חייבת להסתיר גם את כפתור ההעתקה. בלי זה הוא נשאר
  // על המסך עם שם ספוט שכבר אינו רלוונטי, ולחיצה עליו כותבת ניצב חוף
  // ששייך לנקודה אחרת לגמרי.
  const copyBtn = $('#as-copy-normal');
  if (overrideMsg) {
    el.className = 'as-status as-status-warn'; el.textContent = overrideMsg;
    copyBtn.hidden = true; return;
  }
  if (draft.lat == null) {
    el.className = 'as-status'; el.textContent = '';
    copyBtn.hidden = true; return;
  }

  const bits = [];
  // היפוך רוחב/אורך הוא תיקון בנתון הבטיחותי השני בחשיבותו. הוא נאמר
  // בצבע אזהרה ולא כפריט אחד ברשימה אפורה — נ.צ. של קפריסין הופך בו
  // לנקודה תקפה בישראל, וזה שינוי שהמשתמש חייב לראות.
  if (draft.swapped) bits.push('⚠️ הפכתי בין רוחב לאורך — לוודא שזו הנקודה הנכונה');
  if (draft.near) bits.push(`${ltr(draft.near.km)} ק"מ מ${esc(draft.near.spot.name_he)}`);
  // ⚠️ קוד תחנה הוא לטיני רב-מילי. heText עוטף כל מילה בנפרד, ואז
  // "TEL AVIV COAST" נקרא "COAST AVIV TEL". בלוק אחד, לא מילה-מילה.
  bits.push(draft.station
    ? `תחנת ${ltr(draft.station.ims)} במרחק ${ltr(draft.station.distance_km)} ק"מ`
    : 'אין תחנת מדידה בטווח — לא תהיה מדידה חיה');

  el.className = 'as-status' + (draft.station && !draft.swapped ? '' : ' as-status-warn');
  el.innerHTML = bits.join(' · ');

  const copy = $('#as-copy-normal');
  copy.hidden = !draft.near;
  if (draft.near) {
    copy.innerHTML = `העתק כיוון מ${esc(shortName(draft.near.spot.name_he))} ` +
      `(${ltr(draft.near.spot.shore_normal_deg + '°')})`;
  }
}

/** שמות ספוטים נושאים כינוי בסוגריים. על כפתור, הכינוי הוא רעש. */
function shortName(name) {
  const base = String(name).replace(/\s*[("״].*$/, '').trim();
  return base.length > 22 ? base.slice(0, 21) + '…' : (base || name);
}

function setNormal(deg, opts, quiet = false) {
  draft.deg = norm360(deg);
  if (!quiet) { draft.touchedDial = true; draft.touched.add('deg'); }
  $('#as-deg').value = draft.deg;
  drawDial();
  validate(opts);
}

function drawDial() {
  $('#as-dial').innerHTML = renderDial(draft.deg, { size: 190 });
  const s = dialSentence(draft.deg);
  // המשפט שאדם שהיה בחוף יכול לאשר או להכחיש מהזיכרון
  $('#as-dial-read').innerHTML =
    `החוף פונה ל<b>${esc(compassNounHe(draft.deg))}</b> ` +
    `(<span class="num" dir="ltr">${draft.deg}°</span>).<br>` +
    `רוח <b>${esc(compassHe(s.seaward))}</b> מחזירה אותך לחוף · ` +
    `רוח <b class="as-danger">${esc(compassHe(s.landward))}</b> דוחפת אותך אל הים הפתוח.`;
}

function bindDial(opts) {
  const host = $('#as-dial');
  let dragging = false;

  const toBearing = e => {
    const svg = host.querySelector('svg');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    // מרכז ה-SVG בפיקסלים של המסך. אין היפוך RTL — ראה dial.js.
    return bearingAt(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  };

  const move = e => {
    if (!dragging) return;
    const b = toBearing(e);
    if (b != null) { e.preventDefault(); setNormal(b, opts); }
  };

  host.addEventListener('pointerdown', e => {
    // ⚠️ ה-host הוא flex ברוחב מלא, והחוגה 190 פיקסלים בתוכו — כלומר יש
    // עשרות פיקסלים של שטח מת משני הצדדים. בלי הבדיקה הזו, נגיעה מקרית
    // בשוליים בזמן גלילה **כותבת מחדש את ניצב החוף** בלי שאיש ישים לב.
    // אחרי שהגרירה התחילה על החוגה היא ממשיכה גם מחוצה לה — זו גרירה.
    if (!e.target.closest('svg')) return;
    dragging = true;
    host.setPointerCapture?.(e.pointerId);
    move(e);
  });
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerup', e => {
    dragging = false;
    host.releasePointerCapture?.(e.pointerId);
  });
  host.addEventListener('pointercancel', () => { dragging = false; });
}

function locate(opts) {
  if (!navigator.geolocation) {
    updateGeoStatus('הדפדפן לא תומך במיקום. אפשר להדביק קואורדינטות.');
    return;
  }
  const btn = $('#as-locate');
  btn.disabled = true;
  btn.textContent = 'מאתר…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      btn.disabled = false;
      btn.textContent = 'מיקום נוכחי';
      $('#as-coords').value = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      applyCoordText($('#as-coords').value, opts);
    },
    err => {
      btn.disabled = false;
      btn.textContent = 'מיקום נוכחי';
      updateGeoStatus(err.code === err.PERMISSION_DENIED
        ? 'לא ניתנה הרשאת מיקום. אפשר להדביק קואורדינטות במקום.'
        : 'לא הצלחתי לאתר מיקום. אפשר להדביק קואורדינטות במקום.');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function setErrors(list) {
  const el = $('#as-errors');
  el.innerHTML = list.length
    ? '<ul>' + list.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>'
    : '';
  el.hidden = list.length === 0;
}

/**
 * הכפתור נחסם על כל שגיאה, אבל **מוצגות** רק שגיאות של שדה שהמשתמש
 * כבר נגע בו. טופס ריק שפותח בשלוש שורות אדומות מאמן את העין להתעלם
 * מאדום — וזו בדיוק העין שצריכה לעצור מול "רוח מהחוף החוצה".
 */
function validate() {
  const v = validateUserSpot({ name: draft.name, lat: draft.lat, lon: draft.lon, shoreNormalDeg: draft.deg });
  const shown = v.errors.filter((_, i) => draft.touched.has(v.fields[i]));
  if (draft.dup) {
    v.errors.push(`יש כבר ספוט בנקודה הזו: ${draft.dup.name_he}.`);
    if (draft.touched.has('coords')) shown.push(`יש כבר ספוט בנקודה הזו: ${draft.dup.name_he}.`);
  }
  setErrors(shown);
  $('#as-save').disabled = v.errors.length > 0;
  return v.errors.length === 0;
}

function save(opts) {
  if (!validate(opts)) return;
  const spot = makeUserSpot({
    id: makeId(draft.name),
    name: draft.name, lat: draft.lat, lon: draft.lon,
    shoreNormalDeg: draft.deg,
    station: draft.station,
    addedAt: Date.now(),
  });
  const r = addUserSpot(spot);
  if (!r.ok) { setErrors([r.error]); return; }
  $('#addspot').close();
  // ניקוי ה-hash אחרי קליטת קישור שיתוף, כדי שרענון לא יציע שוב
  if (location.hash.startsWith('#addspot=')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  onChange(spot.id);
}

/* ---------------------------------------------------------------- */
/* פעולות על ספוט קיים — מתוך פאנל הפירוט                            */
/* ---------------------------------------------------------------- */

export function bindUserSpotActions(host, opts) {
  host.addEventListener('click', async e => {
    const btn = e.target.closest('[data-user-action]');
    if (!btn) return;
    e.stopPropagation();   // אחרת הלחיצה מקפלת את הכרטיס מתחת לכפתור

    const id = btn.dataset.spotId;
    const spot = loadUserSpots().find(s => s.id === id);
    if (!spot) return;

    if (btn.dataset.userAction === 'share') {
      const url = shareUrl(spot, location.href);
      const shared = await tryNativeShare(spot.name_he, url);
      if (!shared) await copyText(url, btn, 'הקישור הועתק');
      return;
    }

    if (btn.dataset.userAction === 'propose') {
      const core = (opts.spots || []).filter(s => s.source !== 'user');
      const body = issueBody(spot, {
        nearCore: nearestCoreSpot(spot.lat, spot.lon, core),
        station: nearestStation(spot.lat, spot.lon, core),
      });
      if (GITHUB.owner && GITHUB.repo) {
        const u = new URL(`https://github.com/${GITHUB.owner}/${GITHUB.repo}/issues/new`);
        u.searchParams.set('title', `ספוט מוצע: ${spot.name_he}`);
        u.searchParams.set('body', body);
        u.searchParams.set('labels', 'spot-proposal');
        window.open(u.toString(), '_blank', 'noopener');
      } else {
        await copyText(body, btn, 'הפרטים הועתקו — שלח לארז');
      }
      return;
    }

    if (btn.dataset.userAction === 'delete') {
      if (!confirm(`למחוק את ${spot.name_he}?`)) return;
      removeUserSpot(id);
      onChange(null);
    }
  });
}

async function tryNativeShare(title, url) {
  if (!navigator.share) return false;
  try { await navigator.share({ title: `רדאר קייט — ${title}`, url }); return true; }
  catch { return false; }
}

async function copyText(text, btn, okMsg) {
  const prev = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = okMsg;
  } catch {
    btn.textContent = 'ההעתקה נכשלה';
  }
  setTimeout(() => { btn.textContent = prev; }, 2200);
}
