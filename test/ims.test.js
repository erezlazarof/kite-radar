/* בדיקות מפענח השמ"ט. רצות מול קובץ XML אמיתי שנשמר מהשירות. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  parseImsXml, imsTimeToMs, feedHealth, measuredVsForecast,
  MS_TO_KT, IMS_STALE_MIN, IMS_DEAD_MIN,
} from '../public/js/sources/ims-parse.js';

const FIXTURE = new URL('./fixtures/imslasthour.xml', import.meta.url);

const XML = existsSync(FIXTURE) ? readFileSync(FIXTURE, 'utf8') : null;

/* ===================== אזור זמן ===================== */

test('time_obs is UTC+2 with no daylight saving — the single costliest trap here', () => {
  // אמצע הקיץ הישראלי: שעון מקומי הוא UTC+3, אבל השמ"ט מדווח UTC+2
  const ms = imsTimeToMs('2026-08-18T14:20:00');
  assert.equal(new Date(ms).toISOString(), '2026-08-18T12:20:00.000Z');
  // אמצע החורף: שם השעון המקומי באמת UTC+2, והפרשנות זהה
  assert.equal(new Date(imsTimeToMs('2026-01-15T08:00:00')).toISOString(), '2026-01-15T06:00:00.000Z');
});

test('a malformed timestamp yields null, never NaN or "now"', () => {
  for (const bad of ['', null, undefined, 'yesterday', '2026-08-18 14:20', '2026-13-40T99:99:99x']) {
    assert.equal(imsTimeToMs(bad), null, String(bad));
  }
});

/* ===================== יחידות ===================== */

test('wind arrives in m/s and must be converted — 10 m/s is ~19.4 knots', () => {
  assert.ok(Math.abs(10 * MS_TO_KT - 19.44) < 0.01);
});

/* ===================== פענוח ===================== */

test('parses the real feed and keeps only the latest windy sample per station', { skip: !XML }, () => {
  const p = parseImsXml(XML);
  const names = Object.keys(p.stations);
  assert.ok(names.length > 40, `expected many wind stations, got ${names.length}`);
  assert.ok(p.count > names.length, 'the file carries several 10-minute slots per station');
  assert.ok(p.latestMs > 0);

  for (const n of names) {
    const s = p.stations[n];
    assert.ok(s.latest.speedKt >= 0 && s.latest.speedKt < 200, `${n} speed out of range`);
    assert.ok(s.latest.dirDeg >= 0 && s.latest.dirDeg <= 360, `${n} direction out of range`);
    assert.ok(Number.isFinite(s.latest.tsMs), `${n} bad timestamp`);
    if (s.latest.gustKt != null) {
      assert.ok(s.latest.gustKt >= s.latest.speedKt - 0.6, `${n}: gust below mean`);
    }
  }
});

test('the coastal stations the registry depends on are present', { skip: !XML }, () => {
  const p = parseImsXml(XML);
  for (const n of ['TEL AVIV COAST', 'SHAVE ZIYYON', 'HADERA PORT', 'ASHDOD PORT', 'LEV KINERET']) {
    assert.ok(p.stations[n], `missing station ${n} — a spot in the registry points at it`);
  }
});

test('a station that reports no wind is absent, not present with zeros', () => {
  const xml = `<RealTimeData>
    <Observation><stn_name>DEAD</stn_name><stn_num>64</stn_num>
      <time_obs>2026-08-18T14:20:00</time_obs><WS/><WD/><WSmax/><TD>31</TD></Observation>
    <Observation><stn_name>ALIVE</stn_name><stn_num>1</stn_num>
      <time_obs>2026-08-18T14:20:00</time_obs><WS>5</WS><WD>270</WD><WSmax>8</WSmax></Observation>
  </RealTimeData>`;
  const p = parseImsXml(xml);
  assert.equal(p.stations.DEAD, undefined, 'an empty anemometer must not read as calm');
  assert.ok(p.stations.ALIVE);
  assert.equal(p.stations.ALIVE.latest.dirDeg, 270);
});

test('the newest sample wins regardless of document order', () => {
  const obs = (t, ws) => `<Observation><stn_name>X</stn_name><time_obs>${t}</time_obs><WS>${ws}</WS><WD>90</WD></Observation>`;
  const p = parseImsXml(`<RealTimeData>${obs('2026-08-18T14:20:00', 9)}${obs('2026-08-18T13:50:00', 2)}</RealTimeData>`);
  assert.equal(p.stations.X.latest.speedKt, Math.round(9 * MS_TO_KT * 10) / 10);
  assert.equal(p.stations.X.samples, 2);
});

test('garbage input returns an empty result instead of throwing', () => {
  for (const bad of ['', null, undefined, '<html>404</html>', '{"json":true}']) {
    const p = parseImsXml(bad);
    assert.deepEqual(Object.keys(p.stations), []);
    assert.equal(p.latestMs, null);
  }
});

/* ===================== בריאות ההזנה — סעיף 10 ברישיון ===================== */

test('feed health reports fresh, stale, dead and down as distinct states', () => {
  const at = min => ({ stations: { A: {} }, latestMs: Date.UTC(2026, 7, 18, 12, 0) - min * 60000 });
  const now = Date.UTC(2026, 7, 18, 12, 0);
  assert.equal(feedHealth(at(20), now).state, 'fresh');
  assert.equal(feedHealth(at(IMS_STALE_MIN + 5), now).state, 'stale');
  assert.equal(feedHealth(at(IMS_DEAD_MIN + 5), now).state, 'dead');
  assert.equal(feedHealth({ stations: {}, latestMs: null }, now).state, 'down');
  assert.equal(feedHealth(null, now).state, 'down');
});

test('a dead feed is not ok — the fallback path must be able to see that', () => {
  const now = Date.UTC(2026, 7, 18, 12, 0);
  assert.equal(feedHealth({ stations: { A: {} }, latestMs: now - 400 * 60000 }, now).ok, false);
  assert.equal(feedHealth({ stations: { A: {} }, latestMs: now - 10 * 60000 }, now).ok, true);
});

/* ===================== מדוד מול חזוי ===================== */

test('measured-vs-forecast is null when either side is missing, never zero', () => {
  assert.equal(measuredVsForecast(null, 14), null);
  assert.equal(measuredVsForecast({ speedKt: 17 }, null), null);
  assert.equal(measuredVsForecast({ speedKt: null }, 14), null);
});

test('measured-vs-forecast reports the gap and whether it is meaningful', () => {
  const big = measuredVsForecast({ speedKt: 17 }, 14);
  assert.equal(big.deltaKt, 3);
  assert.equal(big.agrees, false, '3 knots apart is a real disagreement');
  const small = measuredVsForecast({ speedKt: 14.8 }, 14);
  assert.equal(small.agrees, true, 'under 2 knots is measurement noise');
  const under = measuredVsForecast({ speedKt: 11 }, 14);
  assert.equal(under.deltaKt, -3, 'the sign must survive — the model can over-predict too');
});

/* ===================== שילוב במנוע ===================== */

import { scoreSpot, OBS_DISAGREE_KT } from '../public/js/verdict/engine.js';

const REG = JSON.parse(readFileSync(new URL('../public/data/spots.json', import.meta.url), 'utf8'));
const spot = id => REG.spots.find(s => s.id === id);
const hoursAt = (kt, dir) => Array.from({ length: 24 }, (_, h) => ({
  hour: h, dayIndex: 0, tsMs: null, speedKt: kt, gustKt: kt * 1.2, dirDeg: dir,
}));

test('a live measurement never replaces the verdict, it only removes confidence', () => {
  const s = spot('bat-yam') || REG.spots.find(x => x.region === 'center');
  const dir = s.shore_normal_deg + 30;
  const f = { hours: hoursAt(18, dir), ageMin: 3 };
  const now = Date.UTC(2026, 10, 18, 11);

  const agreeing = scoreSpot(s, f, { speedKt: 18.4, gustKt: 21, dirDeg: dir, ageMin: 12, forecastAtObsKt: 18 }, now, {}, 0);
  assert.equal(agreeing.level, 'green', 'a measurement that confirms the model changes nothing');
  assert.ok(!agreeing.flags.includes('obs_disagrees'));

  const disagreeing = scoreSpot(s, f, { speedKt: 18 - OBS_DISAGREE_KT - 1, gustKt: 14, dirDeg: dir, ageMin: 12, forecastAtObsKt: 18 }, now, {}, 0);
  assert.notEqual(disagreeing.level, 'green', 'a station that contradicts the model means we do not know');
  assert.ok(disagreeing.flags.includes('obs_disagrees'));
  assert.equal(disagreeing.measured.forecastAtObsKt, 18, 'the compared value travels with the reading');
});

test('measurements are ignored for tomorrow — there is nothing to measure yet', () => {
  const s = REG.spots.find(x => x.region === 'center');
  const dir = s.shore_normal_deg + 30;
  const hours = [...hoursAt(18, dir), ...hoursAt(18, dir).map(h => ({ ...h, dayIndex: 1 }))];
  const now = Date.UTC(2026, 10, 18, 11);
  const v = scoreSpot(s, { hours, ageMin: 3 }, { speedKt: 2, dirDeg: dir, ageMin: 5, forecastAtObsKt: 18 }, now, {}, 1);
  assert.equal(v.measured, null);
  assert.ok(!v.flags.includes('obs_disagrees'));
});

test('a measurement without a comparable forecast hour is dropped, not guessed', () => {
  const s = REG.spots.find(x => x.region === 'center');
  const f = { hours: hoursAt(18, s.shore_normal_deg + 30), ageMin: 3 };
  const v = scoreSpot(s, f, { speedKt: 9, dirDeg: 300, ageMin: 5, forecastAtObsKt: null }, Date.UTC(2026, 10, 18, 11), {}, 0);
  assert.equal(v.measured, null, 'no baseline means no delta — never compare against zero');
});
