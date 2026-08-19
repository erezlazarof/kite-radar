/* =========================================================================
   רדאר קייט — הרכבה, מחזור הרינדור והרענון
   ========================================================================= */

import { FEATURES, REFRESH_MS, ATTRIBUTION, IMS_ATTRIBUTION, DISCLAIMER, MODELS, TTL_MIN } from './config.js';
import { state, savePrefs, ageMin, withFallback } from './store.js';
import { fetchAllSpots, fetchModels, modelsForSpot } from './sources/openmeteo.js';
import { fetchObs, obsForSpot, compareToForecast, obsAgeMin } from './sources/obs.js';
import { scoreSpot } from './verdict/engine.js';
import { israelDateParts } from './verdict/calendar.js';
import { renderCard, renderDetail, LEVEL_META, REGION_HE, esc } from './ui/card.js';
import { kiteRange, KITE_SIZES } from './verdict/bands.js';

const $ = s => document.querySelector(s);
const LEVEL_RANK = { green: 0, yellow: 1, red: 2, blocked: 3, unknown: 4 };

/** סדר גאוגרפי קבוע — צפון לדרום, ואז הגופים הנפרדים. */
const REGION_ORDER = ['north', 'center', 'south', 'kinneret', 'eilat'];

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
  refreshObs();

  setInterval(() => { if (!document.hidden) refreshForecast(); }, REFRESH_MS.forecast);
  setInterval(() => { if (!document.hidden) refreshObs(); }, REFRESH_MS.obs);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // מה שבאמת חשוב בטלפון שהיה בכיס: לרענן לפי גיל, לא לפי טיימר
    if (ageMin(state.forecast?.fetchedAt) > 15) refreshForecast();
    if (ageMin(state.obs?.fetchedAt) > 5) refreshObs();
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

/**
 * המדידה החיה. נמשכת בנפרד מהתחזית ובקצב אחר, כי מקורה אחר וקצב
 * העדכון שלה אחר — ותקלה בה לא צריכה למחוק את התחזית מהמסך.
 */
async function refreshObs() {
  if (!FEATURES.ims_live) return;
  const r = await withFallback('obs', 'obs', () => fetchObs());
  state.obs = r;
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

  const obsPayload = state.obs?.payload || null;

  const scored = state.spots.map(spot => {
    const f = fc.payload[spot.id];
    const forecast = f ? { ...f, ageMin: age } : null;

    // המדידה נשלחת למנוע רק עם ההשוואה לשעה שבה היא נמדדה. בלי זה
    // היינו משווים מדידה של 15:00 לתחזית של 17:00 וקוראים לזה אי-דיוק.
    let obs = null;
    if (state.day === 0 && obsPayload) {
      const o = obsForSpot(spot, obsPayload);
      if (o) {
        const cmp = compareToForecast(o, f?.hours || [], now);
        obs = { ...o, ageMin: obsAgeMin(o, now), forecastAtObsKt: cmp?.forecastKt ?? null };
      }
    }

    return {
      spot,
      v: scoreSpot(spot, forecast, obs, now, state.prefs, state.day),
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

  renderRegions(scored);

  const shown = state.region === 'all'
    ? scored
    : scored.filter(x => x.spot.region === state.region);

  const one = ({ spot, v, grid, hours, nowHour }) => {
    const open = state.expanded === spot.id;
    const detail = open
      ? renderDetail(spot, v, {
          grid, prefs: state.prefs,
          // undefined = אל תציג את המדור כלל; null = טוען; אובייקט = יש נתונים
          models: FEATURES.models ? (state.models[spot.id]?.data ?? null) : undefined,
        })
      : '';
    return renderCard(spot, v, { hours, nowHour }) + detail;
  };

  host.classList.toggle('grouped', state.region === 'all');

  if (state.region === 'all') {
    // מקובצים בסדר גאוגרפי — כותרת אזור דביקה בזמן גלילה.
    // הסדר לא משתנה לפי מזג האוויר: מפה קבועה נלמדת פעם אחת,
    // ורצועת הצ'יפים היא זו שנושאת את "מי הכי טוב היום".
    host.innerHTML = REGION_ORDER
      .map(r => {
        const grp = shown.filter(x => x.spot.region === r);
        if (!grp.length) return '';
        const best = grp[0].v.level;
        return `<h2 class="reg-head lv-${best}">
                  <span class="reg-dot"></span>${esc(REGION_HE[r] || r)}
                  <span class="reg-count num">${grp.length}</span>
                </h2>` + grp.map(one).join('');
      })
      .join('');
  } else {
    host.innerHTML = shown.length
      ? shown.map(one).join('')
      : '<div class="empty">אין ספוטים באזור הזה עדיין.</div>';
  }

  if (state.expanded) {
    host.querySelector(`[data-spot="${CSS.escape(state.expanded)}"]`)?.setAttribute('aria-expanded', 'true');
  }

  updateStatus(scored);
  updateSummary(scored);
}

/**
 * רצועת האזורים. כל צ'יפ נושא נקודה בצבע פסק הדין הטוב ביותר באזור —
 * כדי שאפשר יהיה לראות "בצפון יש רוח" בלי להיכנס לצפון.
 */
function renderRegions(scored) {
  const host = $('#regions');
  if (!host) return;

  const groups = REGION_ORDER
    .map(r => ({ r, items: scored.filter(x => x.spot.region === r) }))
    .filter(g => g.items.length);

  const greenAll = scored.filter(x => x.v.level === 'green').length;

  const chip = (key, label, level, count) =>
    `<button class="reg-chip lv-${level}${state.region === key ? ' on' : ''}" data-region="${esc(key)}">
       <span class="reg-dot"></span>${esc(label)}
       ${count ? `<span class="reg-badge num">${count}</span>` : ''}
     </button>`;

  const allBest = scored.length
    ? scored.reduce((a, b) => (LEVEL_RANK[b.v.level] < LEVEL_RANK[a.v.level] ? b : a)).v.level
    : 'unknown';

  host.innerHTML =
    chip('all', 'הכל', allBest, greenAll) +
    groups.map(g => chip(g.r, REGION_HE[g.r] || g.r, g.items[0].v.level,
                         g.items.filter(x => x.v.level === 'green').length)).join('');
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

  // ניטור הפסקות בהזנה — התחייבות חוזית ברישיון השמ"ט, ולא קישוט.
  const feed = state.obs?.payload?.feed || {};
  const down = Object.entries(feed).filter(([, f]) => f && f.ok === false).map(([k]) => k);
  if (down.length) txt = `מדידה חיה לא זמינה · ${txt}`;

  el.textContent = txt;
  el.className = 'status' + (fc.restored || down.length ? ' status-warn' : '');
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

/**
 * ריבוי מודלים נמשך רק בפתיחת כרטיס, ובכוונה: הוא משלש את משקל התגובה
 * עבור מידע שאי אפשר לראות עד שלוחצים. במסך הראשי זו הייתה מכסה
 * וסוללה שנשרפות על כלום.
 */
async function loadModels(spotId) {
  if (!FEATURES.models) return;
  const cached = state.models[spotId];
  if (cached && ageMin(cached.fetchedAt) < TTL_MIN.models) return;

  const spot = state.spots.find(s => s.id === spotId);
  if (!spot) return;
  const ids = modelsForSpot(spot, Object.keys(MODELS));

  try {
    const data = await fetchModels(spot, ids);
    state.models[spotId] = { data, fetchedAt: Date.now() };
  } catch (err) {
    // כישלון בהשוואה לא מוחק את פסק הדין מהמסך — הוא רק משאיר את
    // המדור ריק, ואומר את זה.
    state.models[spotId] = { data: {}, fetchedAt: Date.now(), error: String(err.message || err) };
  }
  if (state.expanded === spotId) render();
}

/* ---------------- אינטראקציה ---------------- */

function bindUI() {
  $('#cards').addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.spot;
    state.expanded = state.expanded === id ? null : id;
    render();
    if (state.expanded) loadModels(state.expanded);
  });

  $('#cards').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    state.expanded = state.expanded === card.dataset.spot ? null : card.dataset.spot;
    render();
    if (state.expanded) loadModels(state.expanded);
  });

  $('#regions').addEventListener('click', e => {
    const b = e.target.closest('[data-region]');
    if (!b) return;
    state.region = b.dataset.region;
    state.expanded = null;
    render();
    document.querySelector('.cards')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  const sheet = $('#sheet');
  $('#settings').addEventListener('click', () => sheet.showModal());
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });

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

  // מראים את האפקט במקום להסביר אותו: שלוש רוחות, גודל לכל אחת.
  const REF_KT = [14, 18, 24];
  const applyPrefs = () => {
    $('#weight-val').textContent = weight.value;
    const kg = +weight.value;
    const parts = REF_KT.map(kt => {
      const r = kiteRange(kt, kg);
      return `<span dir="ltr">${kt}</span> קשר → <b><span dir="ltr">${r.lo}–${r.hi}</span></b> מ׳`;
    });
    $('#weight-effect').innerHTML = parts.join(' · ');
    renderQuiver();
  };

  function renderQuiver() {
    const owned = new Set(state.prefs.quiver || []);
    $('#quiver').innerHTML = KITE_SIZES
      .map(sz => `<button type="button" class="q-chip${owned.has(sz) ? ' on' : ''}" data-size="${sz}"
                    aria-pressed="${owned.has(sz)}"><span dir="ltr">${sz}</span></button>`)
      .join('');
  }

  $('#quiver').addEventListener('click', e => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    const sz = +b.dataset.size;
    const cur = new Set(state.prefs.quiver || []);
    cur.has(sz) ? cur.delete(sz) : cur.add(sz);
    savePrefs({ quiver: [...cur].sort((a, z) => a - z) });
    renderQuiver();
    render();
  });

  $('#quiver-clear').addEventListener('click', () => {
    savePrefs({ quiver: [] });
    renderQuiver();
    render();
  });

  applyPrefs();
  weight.addEventListener('input', () => {
    applyPrefs();
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
