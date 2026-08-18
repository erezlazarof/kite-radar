/* =========================================================================
   רדאר קייט — הרכבה, מחזור הרינדור והרענון
   ========================================================================= */

import { FEATURES, REFRESH_MS, ATTRIBUTION, IMS_ATTRIBUTION, DISCLAIMER } from './config.js';
import { state, savePrefs, ageMin, withFallback } from './store.js';
import { fetchAllSpots } from './sources/openmeteo.js';
import { scoreSpot } from './verdict/engine.js';
import { israelDateParts } from './verdict/calendar.js';
import { renderCard, renderDetail, LEVEL_META, esc } from './ui/card.js';

const $ = s => document.querySelector(s);
const LEVEL_RANK = { green: 0, yellow: 1, red: 2, blocked: 3, unknown: 4 };

/* ---------------- אתחול ---------------- */

async function boot() {
  initTheme();
  bindUI();

  try {
    const reg = await (await fetch('data/spots.json', { cache: 'no-cache' })).json();
    state.spots = reg.spots;
    state.defaults = reg.defaults;
  } catch (e) {
    $('#cards').innerHTML = `<div class="empty">לא הצלחתי לטעון את רשימת הספוטים.<br><small>${esc(e.message)}</small></div>`;
    return;
  }

  renderFooter();
  await refreshForecast();

  setInterval(() => { if (!document.hidden) refreshForecast(); }, REFRESH_MS.forecast);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ageMin(state.forecast?.fetchedAt) > 15) refreshForecast();
  });
}

/* ---------------- נתונים ---------------- */

async function refreshForecast() {
  setBusy(true);
  const r = await withFallback('forecast', 'forecast', () => fetchAllSpots(state.spots));
  state.forecast = r;
  setBusy(false);
  render();
}

/* ---------------- רינדור ---------------- */

function render() {
  const host = $('#cards');
  const fc = state.forecast;

  if (!fc?.payload) {
    host.innerHTML = `<div class="empty">אין נתוני תחזית כרגע.
      ${fc?.error ? `<br><small>${esc(fc.error)}</small>` : ''}
      <br><button class="btn" id="retry">נסה שוב</button></div>`;
    $('#retry')?.addEventListener('click', refreshForecast);
    updateStatus();
    return;
  }

  const now = Date.now();
  const age = ageMin(fc.fetchedAt);

  // קו ה"עכשיו" מצויר רק על היום עצמו — על מחר הוא היה שקר ויזואלי
  const il = israelDateParts(now);
  const nowHour = state.day === 0 ? il.hour + il.minute / 60 : null;

  const scored = state.spots.map(spot => {
    const f = fc.payload[spot.id];
    const forecast = f ? { ...f, ageMin: age } : null;
    return {
      spot,
      v: scoreSpot(spot, forecast, null, now, state.prefs, state.day),
      grid: f?.grid,
      hours: (f?.hours || []).filter(h => h.dayIndex === state.day),
      nowHour,
    };
  });

  // דירוג: הכי טוב היום למעלה. זה מה שהופך "כל החופים" לשימושי.
  scored.sort((a, b) => {
    const d = LEVEL_RANK[a.v.level] - LEVEL_RANK[b.v.level];
    if (d !== 0) return d;
    return (b.v.score ?? -1) - (a.v.score ?? -1);
  });

  host.innerHTML = scored.map(({ spot, v, grid, hours, nowHour }) => {
    const open = state.expanded === spot.id;
    return renderCard(spot, v, { hours, nowHour }) + (open ? renderDetail(spot, v, { grid }) : '');
  }).join('');

  if (state.expanded) {
    host.querySelector(`[data-spot="${CSS.escape(state.expanded)}"]`)?.setAttribute('aria-expanded', 'true');
  }

  updateStatus(scored);
  updateSummary(scored);
}

function updateStatus(scored) {
  const fc = state.forecast;
  const el = $('#status');
  if (!fc?.fetchedAt) { el.textContent = ''; el.className = 'status'; return; }

  const a = Math.round(ageMin(fc.fetchedAt));
  const good = scored ? scored.filter(s => s.v.level === 'green').length : 0;

  let txt = a < 1 ? 'עודכן עכשיו' : `עודכן לפני ${a} דק׳`;
  if (fc.restored) txt = `אין חיבור — מוצג נתון שמור מלפני ${a} דק׳`;
  if (scored) txt = `${good ? `${good} ספוטים עם רוח · ` : ''}${txt}`;

  el.textContent = txt;
  el.className = 'status' + (fc.restored ? ' status-warn' : '');
}

/**
 * רצועת התקציר. התשובה צריכה להגיע לפני שהמשתמש גולל —
 * ולכן היא נוקבת בספוט הכי טוב בשמו, לא רק בספירה.
 */
const DAY_HE = ['היום', 'מחר', 'מחרתיים'];

function updateSummary(scored) {
  const head = $('#summary-headline');
  const best = $('#summary-best');
  if (!head) return;

  const rideable = scored.filter(s => s.v.level === 'green' || s.v.level === 'yellow');
  const green = scored.filter(s => s.v.level === 'green');
  const unknown = scored.filter(s => s.v.level === 'unknown');
  const day = DAY_HE[state.day] || '';

  if (!scored.length || unknown.length === scored.length) {
    head.textContent = 'אין נתונים כרגע';
    best.textContent = '';
    return;
  }

  const top = (green[0] || rideable[0] || null);

  if (green.length) {
    head.textContent = green.length === 1
      ? `ספוט אחד עם רוח ${day}`
      : `${green.length} ספוטים עם רוח ${day}`;
  } else if (rideable.length) {
    head.textContent = `${day} גבולי בכל הספוטים`;
  } else {
    head.textContent = `אין רוח ${day}`;
  }

  best.innerHTML = top
    ? `הכי טוב: <b>${esc(top.spot.name_he)}</b> · <span class="num">${Math.round(top.v.window.meanKt)}</span> קשר` +
      (top.v.window.startHour != null
        ? ` <span dir="ltr">${String(top.v.window.startHour).padStart(2, '0')}:00</span>–<span dir="ltr">${String(top.v.window.endHour).padStart(2, '0')}:00</span>`
        : '')
    : '';
}

function renderFooter() {
  $('#disclaimer').textContent = DISCLAIMER;
  const links = ATTRIBUTION.map(a => `<a href="${a.url}" target="_blank" rel="noopener">${esc(a.text)}</a>`).join(' · ');
  $('#attribution').innerHTML = links + (FEATURES.ims_live ? `<br>${esc(IMS_ATTRIBUTION)}` : '');
}

/* ---------------- אינטראקציה ---------------- */

function bindUI() {
  $('#cards').addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.spot;
    state.expanded = state.expanded === id ? null : id;
    render();
  });

  $('#cards').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    state.expanded = state.expanded === card.dataset.spot ? null : card.dataset.spot;
    render();
  });

  $('#theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = cur;
    try { localStorage.setItem('kite.theme', cur); } catch {}
  });

  document.querySelectorAll('[data-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.day = +btn.dataset.day;
      state.expanded = null;
      document.querySelectorAll('[data-day]').forEach(b => b.classList.toggle('on', b === btn));
      render();
    });
  });

  const weight = $('#weight');
  weight.value = state.prefs.weightKg;
  $('#weight-val').textContent = state.prefs.weightKg;
  weight.addEventListener('input', () => {
    $('#weight-val').textContent = weight.value;
    savePrefs({ weightKg: +weight.value });
    render();
  });
}

function initTheme() {
  let t = null;
  try { t = localStorage.getItem('kite.theme'); } catch {}
  document.documentElement.dataset.theme =
    t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function setBusy(b) {
  document.body.classList.toggle('busy', b);
}

boot();
