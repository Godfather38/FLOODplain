// What the HAND model thinks at the app's rated crossings (docs/HAND-INUNDATION.md).
// It leads the source list and can raise a crossing's level above calmer sources: to
// Caution with an official NOAA gauge forecast, to Watch with model flow on the Santa Cruz
// main stem. Elsewhere model flow is shown only. A 15-year back-test found it saw most big
// Santa Cruz flows but read too high on ordinary days, and saw nothing at Brawley Wash
// (docs/HAND-INUNDATION.md).
// It never lowers a level: local runoff is left out, so a low number isn't dry.
// It never overrides a gauge: where a river or wash gauge answered, HAND is shown but moves nothing.
import { createForecastProvider } from './inundation/forecast-provider.js';
import { loadCoverage, stageForFlow } from './inundation/hand-inundation.js';

// Modeled water above the stream bed, in metres, at the highest flow in the next 24 hours.
// Display steps anchored to Trico: NOAA's action flow there models at about 2 m on this curve.
export const WATCH_STAGE_M = 1;
export const CAUTION_STAGE_M = 2;
const SOME_WATER_M = 0.3; // About a foot: enough that "nothing points to water" would contradict the row.
const MAIN_STEM_ORDER = 5;
const onSantaCruz = (row) => row.app.order >= MAIN_STEM_ORDER && row.nearestReach?.name === 'Santa Cruz River';
const NEAR_FP_M = 60;
const AHEAD_MS = 24 * 3600000; // Gauge forecasts run about 6 days; a far peak says nothing about today.
const FT = 3.28084;
const CFS_TO_M3S = 0.028316846592;
const rank = (level) => ['ok', 'watch', 'caution', 'danger'].indexOf(level);

const gaugeAnswered = (p) => p.checks.some((c) => ['river', 'wash'].includes(c.src) && c.level !== 'unknown');

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
    : `Flow: modeled National Water Model flow for the whole reach (${row.app.reachLengthKm} km), not a gauge reading. In a 15-year back-test it saw most big Santa Cruz flows but read too high on ordinary days, and it saw nothing at Brawley Wash.${onSantaCruz(row) ? ' On the Santa Cruz it can raise this crossing no higher than Watch.' : ' On a wash like this it does not change the crossing\'s number.'}`;
  return [
    `${c.band}, ${c.score} of 100. This rates how well the stream data matches this crossing. It is not a probability. ${c.factors.map((f) => `${f.factor}: ${f.points} of ${f.max} (${f.detail}).`).join(' ')}`,
    flow,
    `Source age: NOAA HAND files from ${row.app.sourceDate.slice(0, 10)}, ${age} years old.${Number.isFinite(forecast?.issueAgeHours) ? ` Forecast ${forecast.issueAgeHours.toFixed(1)} hours old.` : ''}`,
    `Uncertainty: not measured, no ± available. ${row.app.calibrated ? '' : 'The rating curve is not calibrated to gauge readings. '}Water level is above the modeled stream bed, not depth on a road. Local runoff, bridges and culverts are not included.`,
  ].join(' ');
}

// The source row for one crossing. raise: true only when the model shows meaningful water.
export function handCheck(row, forecast, now) {
  const quiet = (why, detail) => ({ src: 'hand', level: 'unknown', why, detail, raise: false });
  if (row.status !== 'supported') return quiet('HAND model has no estimate here', `Missing coverage: ${row.evidence}`);
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
  if (forecast.status === 'stale') return quiet(`HAND model: old forecast, about ${(stage * FT).toFixed(1)} ft at ${flowText} for ${when}`, detail);
  const some = stage >= SOME_WATER_M;
  const said = `HAND model: about ${(stage * FT).toFixed(1)} ft above the stream bed, ${flowText} for ${when}`;
  const likely = row.confidence.band === 'Likely match';
  if (row.forecast.kind !== 'gauge') {
    if (onSantaCruz(row) && likely && stage >= WATCH_STAGE_M) return { src: 'hand', level: 'watch', why: said, detail, raise: true };
    return { ...quiet(`${said}. Model flow is rough${stage < WATCH_STAGE_M ? ", and low flow doesn't mean dry" : ''}`, detail), some };
  }
  if (stage >= CAUTION_STAGE_M && likely) return { src: 'hand', level: 'caution', why: said, detail, raise: true };
  if (stage >= WATCH_STAGE_M) return { src: 'hand', level: 'watch', why: said, detail, raise: true };
  return { ...quiet(`${said}. Low flow doesn't mean dry`, detail), some };
}

// The crossing screen's line when its other sources are calm but HAND forecasts some flow.
export const CALM_WITH_FLOW = 'Current readings show no water here. The HAND model forecasts some flow; see below.';

// Puts HAND first in each crossing's sources and lifts the level where it shows water.
export function applyHand(fpResults, hand) {
  if (!hand) return;
  for (const [id, check] of Object.entries(hand.checks)) {
    const p = fpResults[id];
    if (!p) continue;
    const { raise, ...source } = check;
    const gauged = gaugeAnswered(p);
    p.checks = [source, ...p.checks];
    if (!raise || gauged) continue;
    if (p.level === 'unknown' || rank(check.level) > rank(p.level)) p.level = check.level;
    // Where it agrees with or tops the other sources, HAND is the one named on the card.
    if (rank(check.level) >= rank(p.level)) p.why = check.why;
  }
}

export async function loadHand(fps, { fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  const { points } = await loadCoverage(fetchImpl);
  const byFp = matchFailurePoints(fps, points);
  const provider = createForecastProvider({ enabled: true, fetchImpl, clock });
  const sources = new Map();
  for (const row of Object.values(byFp)) {
    if (row.status === 'supported') sources.set(JSON.stringify(row.forecast), row.forecast);
  }
  const results = new Map(await Promise.all([...sources].map(async ([key, f]) => [key, await provider.predict(f)])));
  const now = clock();
  const checks = {};
  for (const [id, row] of Object.entries(byFp)) checks[id] = handCheck(row, results.get(JSON.stringify(row.forecast)), now);
  return { checks, byFp };
}
