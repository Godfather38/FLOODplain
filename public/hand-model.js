// What the HAND model thinks at the app's rated crossings (docs/HAND-INUNDATION.md).
// The engine's 1-5 rating stands; HAND only adds to it. It leads the source list and, on a
// Likely match showing water, adds points by how often its alarms failed at the tracked
// gauges: 1 point at 50% failure or better (Santa Cruz, 32%), half a point at about 68%
// (washes, 62%). See docs/HAND-INUNDATION.md.
// Where the road's height above the stream bed is known (road-heights.json), that height is the
// trigger: water has to reach the road. Elsewhere a fixed level stands in.
// It never lowers a level: local runoff is left out, so a low number isn't dry.
// It never overrides a gauge: where a river or wash gauge answered, HAND is shown but moves nothing.
import { noRatingRow } from './logic.js?v=dev';
import { createForecastProvider } from './inundation/forecast-provider.js';
import { loadCoverage, stageForFlow } from './inundation/hand-inundation.js';

// Modeled water above the stream bed, in metres, at the highest flow in the next 24 hours.
// Display steps anchored to Trico: NOAA's action flow there models at about 2 m on this curve.
export const WATCH_STAGE_M = 1;
const MAIN_STEM_ORDER = 5;
const handPoints = (row) => (row.app.order >= MAIN_STEM_ORDER && row.nearestReach?.name === 'Santa Cruz River' ? 1 : 0.5);
const SOME_WATER_M = 0.3; // About a foot: enough that "nothing points to water" would contradict the row.
const NEAR_FP_M = 60;
const AHEAD_MS = 24 * 3600000; // Gauge forecasts run about 6 days; a far peak says nothing about today.
const FT = 3.28084;
const CFS_TO_M3S = 0.028316846592;

// Wash sources are remote (Three Points and Milewide, 10 to 25 miles off), so only a river gauge counts here.
const gaugeAnswered = (p) => p.checks.some((c) => c.src === 'river' && (c.dischargeLevel ?? c.level) !== 'unknown');

const metres = (a, b) => Math.hypot((a.lat - b.lat) * 110574, (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));

export function matchFailurePoints(fps, points) {
  const out = {};
  for (const fp of fps) {
    const near = points.filter((p) => metres(fp, p) <= NEAR_FP_M).sort((a, b) => metres(fp, a) - metres(fp, b));
    const row = near.find((p) => p.status === 'supported') ?? near[0];
    if (row) out[fp.id] = row;
  }
  return out;
}

function labels(row, forecast, now) {
  const c = row.confidence;
  const age = ((now - Date.parse(row.app.sourceDate)) / (365.25 * 86400000)).toFixed(1);
  const flow = row.forecast.kind === 'gauge'
    ? `Flow: NOAA gauge forecast from ${row.forecast.station}, ${row.app.gaugeKm} km along the channel.`
    : `Flow: modeled National Water Model flow for the whole reach (${row.app.reachLengthKm} km), not a gauge reading. In a 15-year back-test at the tracked gauges it saw most big flows on the Santa Cruz, Rillito and Canada del Oro, with many false alarms, and saw nothing at Brawley near Three Points. On a Likely match it adds ${handPoints(row)} point to this crossing's number, and never more.`;
  return [
    `${c.band}, ${c.score} of 100. This rates how well the stream data matches this crossing. It is not a probability. ${c.factors.map((f) => `${f.factor}: ${f.points} of ${f.max} (${f.detail}).`).join(' ')}`,
    flow,
    `Source age: NOAA HAND files from ${row.app.sourceDate.slice(0, 10)}, ${age} years old.${Number.isFinite(forecast?.issueAgeHours) ? ` Forecast ${forecast.issueAgeHours.toFixed(1)} hours old.` : ''}`,
    `Uncertainty: not measured, no ± available. ${row.app.calibrated ? '' : 'The rating curve is not calibrated to gauge readings. '}Water level is above the modeled stream bed, not depth on a road. Local runoff, bridges and culverts are not included.`,
  ].join(' ');
}

// The source row for one crossing. raise: true only when the model shows meaningful water.
export function handCheck(row, forecast, now, road = null) {
  // evidence: an estimate the model made (model), a flow it expected and did not get (missing,
  // stale), or a place it was never built to cover (unsupported, which is not an outage).
  const quiet = (why, detail, evidence = 'missing') => ({ src: 'hand', level: 'unknown', why, detail, raise: false, evidence });
  if (row.status !== 'supported') return quiet('HAND model does not cover this crossing', `Missing coverage: ${row.evidence}`, 'unsupported');
  if (!['ok', 'stale'].includes(forecast?.status)) return quiet('HAND model has no forecast flow right now', `${forecast?.reason ?? 'No forecast'}. ${labels(row, null, now)}`);
  const soon = (forecast.points ?? []).filter((p) => Date.parse(p.time) <= now + AHEAD_MS);
  if (!soon.length) return quiet('HAND model has no forecast flow for the next 24 hours', labels(row, forecast, now));
  const peak = soon.reduce((a, b) => (b.flowM3s > a.flowM3s ? b : a));
  const cfs = peak.flowM3s / CFS_TO_M3S;
  const stage = stageForFlow(row.app.crossingCurve, peak.flowM3s);
  const when = new Date(peak.time).toLocaleString('en-US', { timeZone: 'America/Phoenix', weekday: 'short', hour: 'numeric' });
  if (stage === null) return quiet('HAND model: flow is above its rating curve, so no level is estimated', labels(row, forecast, now));
  const detail = labels(row, forecast, now);
  const flowText = `${Math.round(cfs).toLocaleString('en-US')} cfs ${row.forecast.kind === 'gauge' ? 'forecast' : 'modeled'}`;
  if (forecast.status === 'stale') return quiet(`HAND model: old forecast, about ${(stage * FT).toFixed(1)} ft at ${flowText} for ${when}`, detail, 'stale');
  const some = stage >= SOME_WATER_M;
  const said = `HAND model: about ${(stage * FT).toFixed(1)} ft above the stream bed, ${flowText} for ${when}`;
  const likely = row.confidence.band === 'Likely match';
  const height = road?.roadAboveBedM;
  if (Number.isFinite(height)) {
    const gap = Math.abs(stage - height) * FT;
    const reaches = stage >= height;
    const line = `HAND model: water about ${(stage * FT).toFixed(1)} ft above the stream bed, road about ${(height * FT).toFixed(1)} ft above it, so ${reaches ? `water about ${gap.toFixed(1)} ft over the road` : `${gap.toFixed(1)} ft below the road`}, ${flowText} for ${when}`;
    const roadDetail = `${detail} Road height ${(road.roadM * FT).toFixed(1)} ft NAVD88${road.deck ? ', measured on the bridge deck by USGS lidar' : ', from USGS 1 m terrain'}, as of its survey.`;
    if (likely && reaches) return { src: 'hand', level: 'watch', why: line, detail: roadDetail, raise: true, points: handPoints(row), overRoad: true, evidence: 'model' };
    return { ...quiet(`${line}${reaches ? '. The match to this stream is too weak to change the number' : ''}`, roadDetail, 'model'), some, roadHeight: true };
  }
  if (likely && stage >= WATCH_STAGE_M) return { src: 'hand', level: 'watch', why: said, detail, raise: true, points: handPoints(row), evidence: 'model' };
  const rough = row.forecast.kind === 'gauge' ? '' : '. Model flow is rough';
  return { ...quiet(`${said}${rough}${stage < WATCH_STAGE_M ? ". Low flow doesn't mean dry" : ''}`, detail, 'model'), some };
}

// The crossing screen's line when its other sources are calm but HAND forecasts some flow.
export const CALM_WITH_FLOW = 'Current readings show no water here. The HAND model forecasts some flow; see below.';

// Puts HAND first in each crossing's sources and lifts the level where it shows water.
export function applyHand(fpResults, hand) {
  if (!hand) return;
  for (const [id, check] of Object.entries(hand.checks)) {
    const p = fpResults[id];
    if (!p) continue;
    const { raise, points, ...source } = check;
    const gauged = gaugeAnswered(p);
    p.checks = [source, ...p.checks];
    // The no-rating row was written before this model row existed. Rewrite it so a model estimate
    // is named, never filed under "no live readings". The level and number are untouched.
    const i = p.checks.findIndex((c) => c.evidence === 'summary' && ['none', 'remote-only'].includes(c.src));
    if (i >= 0) {
      const led = p.why === p.checks[i].why;
      p.checks[i] = noRatingRow(p.checks.filter((_, j) => j !== i));
      if (led) p.why = p.checks[i].why;
    }
    if (!raise || gauged || ['bridge','river'].includes(p.kind) || p.level === 'danger') continue;
    // The model agrees with a county caution, so that caution counts in full again.
    const county = p.checks.find((c) => c.uncorroborated);
    if (county) { county.level = 'caution'; delete county.uncorroborated; if (p.level === 'watch') p.level = 'caution'; }
    if (points < 1) { p.handAdd = points; continue; } // Half a point shows on the number; the level stands.
    // One point on the engine's scale: 1 to 2, 2 to 3, 3 to 4. riskScore reads 4 from a second
    // caution-level source, so HAND counts as that one. It can't reach 5.
    const calm = p.level === 'ok' || p.level === 'unknown';
    const next = calm ? 'watch' : 'caution';
    p.level = next;
    source.level = next;
    if (calm) p.why = check.why;
  }
}

// A forecast's NOAA address as the shared feed names it, or null.
const SHARED_PREFIX = 'https://api.water.noaa.gov/nwps/v1/';
export function sharedForecastPath(url) {
  const text = String(url);
  return text.startsWith(SHARED_PREFIX) ? text.slice(SHARED_PREFIX.length).split('?')[0] : null;
}
// Answers from one shared copy where it has them, and asks NOAA directly for anything else.
export function sharedForecastFetch(responses, fetchImpl) {
  return async (url, options) => {
    const saved = responses?.[sharedForecastPath(url)];
    return saved ? new Response(JSON.stringify(saved), { status: 200, headers: { 'Content-Type': 'application/json' } }) : fetchImpl(url, options);
  };
}

export async function loadHand(fps, { fetchImpl = globalThis.fetch, clock = Date.now, sharedFeed = null } = {}) {
  const { points } = await loadCoverage(fetchImpl);
  // Road heights only sharpen the trigger, so the model still runs without them.
  const roads = await Promise.resolve().then(() => fetchImpl(new URL('./inundation/road-heights.json', import.meta.url).href)).then((r) => (r?.ok ? r.json() : null)).catch(() => null);
  const byFp = matchFailurePoints(fps, points);
  const sources = new Map();
  for (const row of Object.values(byFp)) {
    if (row.status === 'supported') sources.set(JSON.stringify(row.forecast), row.forecast);
  }
  let shared = null;
  if (sharedFeed) {
    const paths = [...sources.values()].flatMap((f) => (f.kind === 'gauge' ? [`gauges/${f.station}`, `gauges/${f.station}/stageflow`] : f.kind === 'nwm_reach' ? [`reaches/${f.reachId}/streamflow`] : []));
    shared = await Promise.resolve().then(() => fetchImpl(`${sharedFeed}&paths=${encodeURIComponent(paths.join(','))}`)).then((r) => (r?.ok ? r.json() : null)).then((j) => j?.responses ?? null).catch(() => null);
  }
  const provider = createForecastProvider({ enabled: true, fetchImpl: sharedForecastFetch(shared, fetchImpl), clock });
  const results = new Map(await Promise.all([...sources].map(async ([key, f]) => [key, await provider.predict(f)])));
  const now = clock();
  const checks = {};
  for (const [id, row] of Object.entries(byFp)) checks[id] = handCheck(row, results.get(JSON.stringify(row.forecast)), now, roads?.points?.[row.id]);
  return { checks, byFp };
}
