/* =========================================================================
   רדאר קייט — הרכבה, מחזור הרינדור והרענון
   ========================================================================= */

import { FEATURES, REFRESH_MS, ATTRIBUTION, IMS_ATTRIBUTION, DISCLAIMER, MODELS, TTL_MIN } from './config.js';
import { state, savePrefs, ageMin, withFallback } from './store.js';
import { fetchAllSpots, fetchModels, modelsForSpot } from './sources/openmeteo.js';
import { fetchObs, obsForSpot, compareToForecast, obsAgeMin } from './sources/obs.js';
import { scoreSpot } from './verdict/engine.js';
import { israelDateParts } from './verdict/calendar.js';
import { renderCard, renderDetail, chartOpts, LEVEL_META, REGION_HE, esc } from './ui/card.js';
import { chartHitTest } from './ui/chart.js';
import { pickWindow } from './verdict/engine.js';
import { compassHe } from './verdict/bands.js';
import { kiteRange, KITE_SIZES } from './verdict/bands.js';
import { loadUserSpots } from './userspots.js';
import { initAddSpot, openAddSpot, openSharedSpot, bindUserSpotActions } from './ui/addspot.js';

const $ = s => document.querySelector(s);
const LEVEL_RANK = { green: 0, yellow: 1, red: 2, blocked: 3, unknown: 4 };

/** סדר גאוגרפי קבוע — צפון לדרום, ואז הגופים הנפרדים. */
// 'mine' אחרון: ספוטים שהמשתמש הוסיף אינם מעורבבים בין החופים
// המאומתים — ההפרדה היא חלק מהמסר, לא סידור.
const REGION_ORDER = ['north', 'center', 'south', 'kinneret', 'eilat', 'mine'];

/* ---------------- אתחול ---------------- */

async function boot() {
  initTheme();
  bindUI();

  try {
    const reg = await (await fetch('data/spots.json', { cache: 'no-cache' })).json();
    state.coreSpots = reg.spots;
    state.defaults = reg.defaults;
    mergeUserSpots();
  } catch (e) {
    $('#cards').innerHTML = `<div class="empty">לא הצלחתי לטעון את רשימת הספוטים.<br><small>${esc(e.message)}</small></div>`;
    return;
  }

  renderFooter();
  initAddSpot(addSpotOpts());
  bindUserSpotActions($('#cards'), addSpotOpts());
  handleHash();
  addEventListener('hashchange', handleHash);

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

/**
 * הרג'יסטר שהאפליקציה עובדת מולו = הליבה + מה שהמשתמש הוסיף.
 * המיזוג נעשה במקום אחד בכוונה: כל שאר הקוד — המנוע, המשיכה, המדידה —
 * לא אמור לדעת בכלל שיש שני מקורות. ההבדל היחיד הוא `source: 'user'`,
 * ואותו המנוע כבר יודע לחסום על צהוב.
 */
function mergeUserSpots() {
  const core = state.coreSpots || [];
  const ids = new Set(core.map(s => s.id));
  state.spots = [...core, ...loadUserSpots().filter(s => !ids.has(s.id))];
}

function addSpotOpts() {
  return {
    get spots() { return state.spots; },
    onChange: async id => {
      mergeUserSpots();
      // ⚠️ דרך setExpanded ולא בהשמה ישירה: הרחבה שאינה מגיעה מלחיצה
      // דילגה על loadModels, והכרטיס החדש נתקע על "טוען השוואה…" לנצח.
      setExpanded(id || null, { load: false });
      // ספוט חדש אינו קיים בתחזית שכבר בזיכרון, ולכן היה נראה כ"אין
      // נתונים" עד הרענון הבא. משיכה מיידית היא ההבדל בין "הוספתי ספוט"
      // ל"הוספתי ספוט ומשהו נשבר".
      await refreshForecast();
      if (id) {
        loadModels(id);
        document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    },
  };
}

/**
 * קישור שיתוף. **לעולם לא מוסיף בשקט** — פותח מסך אישור.
 * שאר ה-hash (קישור עמוק לכרטיס) נשאר באחריות הדפדפן.
 */
/**
 * נקודת הכניסה היחידה לפתיחה וסגירה של כרטיס.
 * כל מסלול אחר ששכח את loadModels משאיר את רצועת ההשוואה על "טוען".
 */
function setExpanded(id, { load = true } = {}) {
  state.expanded = id;
  render();
  if (id && load) loadModels(id);
}

function handleHash() {
  const m = /^#addspot=(.+)$/.exec(location.hash);
  if (!m) return;
  openSharedSpot(m[1], addSpotOpts());
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
      model: f?.model,
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

  state.chartCtx = null;

  const one = ({ spot, v, grid, model, hours, nowHour }) => {
    const open = state.expanded === spot.id;
    if (!open) return renderCard(spot, v, { hours, nowHour });

    const extra = {
      grid, model, prefs: state.prefs,
      // הפאנל מקבל את כל 72 השעות, לא רק את היום הנבחר
      allHours: fc.payload[spot.id]?.hours || [],
      nowHour,
      windows: windowsFor(spot, fc.payload[spot.id]),
      // undefined = אל תציג את המדור כלל; null = טוען; אובייקט = יש נתונים
      models: FEATURES.models ? (state.models[spot.id]?.data ?? null) : undefined,
    };

    // הסקראבר חייב לקבל בדיוק את הנתונים ואת ה-opts שבהם צויר הגרף,
    // אחרת האצבע והציור מדברים על שני צירים שונים.
    state.chartCtx = { spotId: spot.id, hours: extra.allHours, opts: chartOpts(spot, v, extra) };

    return renderCard(spot, v, { hours, nowHour }) + renderDetail(spot, v, extra);
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

/** החלון הנבחר לכל אחד משלושת הימים — כדי שהמטאוגרם יסמן את שלושתם */
function windowsFor(spot, f) {
  if (!f?.hours?.length) return [];
  const out = [];
  for (let d = 0; d < 3; d++) {
    const w = pickWindow(spot, f, d, state.defaults);
    if (w?.startHour != null) out.push({ dayIndex: d, startHour: w.startHour, endHour: w.endHour });
  }
  return out;
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
  if (fc.restored || !navigator.onLine) txt = `אין חיבור — מוצג נתון שמור מלפני ${a} דק׳`;
  if (scored) txt = `${good ? `${good} ספוטים עם רוח · ` : ''}${txt}`;

  // ניטור הפסקות בהזנה — התחייבות חוזית ברישיון השמ"ט, ולא קישוט.
  const feed = state.obs?.payload?.feed || {};
  const down = Object.entries(feed).filter(([, f]) => f && f.ok === false).map(([k]) => k);
  if (down.length) txt = `מדידה חיה לא זמינה · ${txt}`;

  el.textContent = txt;
  el.className = 'status' + (fc.restored || down.length || !navigator.onLine ? ' status-warn' : '');
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
    setExpanded(state.expanded === id ? null : id);
  });

  $('#cards').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    setExpanded(state.expanded === card.dataset.spot ? null : card.dataset.spot);
  });

  // סקראבר: מגע אחד שמעדכן שורת קריאה. בלי pan, בלי zoom, בלי pinch —
  // אלה מחוות שנלחמות בגלילת העמוד בטלפון.
  const scrub = e => {
    const svg = e.target.closest?.('.chart');
    const ctx = state.chartCtx;
    if (!svg || !ctx) return;
    const read = svg.closest('.chart-wrap')?.querySelector('.chart-read');
    if (!read) return;

    const r = svg.getBoundingClientRect();
    // frac נמדד מהקצה השמאלי; ההיפוך ל-RTL כבר קורה בתוך מיפוי הגרף,
    // ואסור לעשות אותו פעמיים.
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const hit = chartHitTest(ctx.hours, ctx.opts, frac);
    if (!hit) { read.textContent = ''; return; }

    read.innerHTML =
      `<b>${esc(DAY_HE[hit.dayIndex] || '')} <span dir="ltr">${String(hit.hour).padStart(2, '0')}:00</span></b>` +
      ` · <span class="num">${Math.round(hit.speedKt)}</span> קשר` +
      (hit.gustKt != null ? ` · משב <span class="num">${Math.round(hit.gustKt)}</span>` : '') +
      (hit.dirDeg != null ? ` · ${esc(compassHe(hit.dirDeg))}` : '');
  };
  $('#cards').addEventListener('pointermove', scrub);
  $('#cards').addEventListener('pointerdown', scrub);

  $('#regions').addEventListener('click', e => {
    const b = e.target.closest('[data-region]');
    if (!b) return;
    state.region = b.dataset.region;
    setExpanded(null);
    document.querySelector('.cards')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  $('#add-spot').addEventListener('click', () => openAddSpot(addSpotOpts()));

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
      document.querySelectorAll('[data-day]').forEach(b => b.classList.toggle('on', b === btn));
      setExpanded(null);
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

/* ---------------- PWA ---------------- */

/**
 * רישום ה-Service Worker.
 *
 * מתבצע אחרי הטעינה הראשונה במכוון: ההתקנה מושכת עשרים ומשהו קבצים,
 * ואין סיבה שהיא תתחרה על הרשת עם התחזית שהמשתמש בא בשבילה.
 *
 * כשגרסה חדשה ממתינה, אנחנו לא מרעננים מתחת לידיים — מציגים שורה
 * שאפשר ללחוץ עליה. רענון כפוי באמצע קריאה של תחזית הוא בדיוק
 * מה שמרגיז באפליקציות מזג אוויר.
 */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') return;

  navigator.serviceWorker.register('sw.js', { scope: './' }).then(reg => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // controller קיים ⇒ זו החלפה של גרסה קיימת, לא התקנה ראשונה
        if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(sw);
      });
    });
  }).catch(() => { /* דפדפן שלא מרשה SW — האפליקציה עובדת בלעדיו */ });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function showUpdateBar(sw) {
  if (document.querySelector('#update-bar')) return;
  const bar = document.createElement('button');
  bar.id = 'update-bar';
  bar.className = 'update-bar';
  bar.type = 'button';
  bar.textContent = 'יש גרסה חדשה — לרענן';
  bar.addEventListener('click', () => sw.postMessage('skip-waiting'));
  document.querySelector('.app')?.prepend(bar);
}

/** מצב הרשת משפיע על מה שמותר להציג, ולכן הוא מצב של האפליקציה */
function watchConnection() {
  const sync = () => {
    document.body.classList.toggle('offline', !navigator.onLine);
    if (navigator.onLine) {
      if (ageMin(state.forecast?.fetchedAt) > 15) refreshForecast();
      if (ageMin(state.obs?.fetchedAt) > 5) refreshObs();
    } else {
      render();
    }
  };
  addEventListener('online', sync);
  addEventListener('offline', sync);
  sync();
}

boot().then(() => {
  watchConnection();
  addEventListener('load', registerSW, { once: true });
  if (document.readyState === 'complete') registerSW();
});
