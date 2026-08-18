/* =========================================================================
   רדאר קייט — הרכבה, מחזור הרינדור והרענון
   ========================================================================= */

import { FEATURES, REFRESH_MS, ATTRIBUTION, IMS_ATTRIBUTION, DISCLAIMER } from './config.js';
import { state, savePrefs, ageMin, withFallback } from './store.js';
import { fetchAllSpots } from './sources/openmeteo.js';
import { scoreSpot } from './verdict/engine.js';
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

  const scored = state.spots.map(spot => {
    const f = fc.payload[spot.id];
    const forecast = f ? { ...f, ageMin: age } : null;
    return { spot, v: scoreSpot(spot, forecast, null, now, state.prefs, state.day), grid: f?.grid };
  });

  // דירוג: הכי טוב היום למעלה. זה מה שהופך "כל החופים" לשימושי.
  scored.sort((a, b) => {
    const d = LEVEL_RANK[a.v.level] - LEVEL_RANK[b.v.level];
    if (d !== 0) return d;
    return (b.v.score ?? -1) - (a.v.score ?? -1);
  });

  host.innerHTML = scored.map(({ spot, v, grid }) => {
    const open = state.expanded === spot.id;
    return renderCard(spot, v) + (open ? renderDetail(spot, v, { grid }) : '');
  }).join('');

  if (state.expanded) {
    host.querySelector(`[data-spot="${CSS.escape(state.expanded)}"]`)?.setAttribute('aria-expanded', 'true');
  }

  updateStatus(scored);
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
