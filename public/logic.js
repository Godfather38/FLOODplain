// Pure logic: parse USGS readings, rate each gauge, rate each route, pick one.
// No DOM or network here so it runs under `node --test`.

export const LEVELS = ['ok', 'watch', 'caution', 'danger'];
const rank = (lvl) => (lvl === 'unknown' ? 1.5 : LEVELS.indexOf(lvl));
export const worst = (levels) =>
  levels.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'ok');

// USGS OGC API `continuous` items -> { '00060': [{t, v}], '00065': [...] }, oldest first.
export function parseContinuous(json) {
  const series = {};
  for (const f of json?.features ?? []) {
    const p = f.properties ?? {};
    const t = Date.parse(p.time);
    const v = Number(p.value);
    if (!p.parameter_code || !Number.isFinite(t) || p.value == null || !Number.isFinite(v)) continue;
    (series[p.parameter_code] ??= []).push({ t, v });
  }
  for (const s of Object.values(series)) s.sort((a, b) => a.t - b.t);
  return series;
}

// Change per hour over the trailing hour (least squares; null if too few points).
export function ratePerHour(points, windowMs = 3_600_000) {
  if (!points?.length) return null;
  const end = points[points.length - 1].t;
  const pts = points.filter((p) => end - p.t <= windowMs);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => (p.t - end) / 3_600_000);
  const ys = pts.map((p) => p.v);
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i] - my);
    den += (x - mx) ** 2;
  });
  return den ? num / den : null;
}

// Summarize one gauge: latest flow (cfs) / stage (ft), their trends, freshness.
export function summarizeGauge(series, now, { staleMs, dryCfs }) {
  const q = series['00060'] ?? [];
  const h = series['00065'] ?? [];
  const last = (s) => (s.length ? s[s.length - 1] : null);
  const lq = last(q);
  const lh = last(h);
  const latestT = Math.max(lq?.t ?? 0, lh?.t ?? 0);
  if (!latestT || now - latestT > staleMs) {
    return { state: 'nodata', time: latestT || null };
  }
  const cfs = lq && now - lq.t <= staleMs ? lq.v : null;
  const ft = lh && now - lh.t <= staleMs ? lh.v : null;
  const cfsRate = ratePerHour(q);
  const ftRate = ratePerHour(h);
  // Rising fast: flow doubling-ish within an hour from a real base, or
  // stage up more than 0.5 ft/hr. Desert floods arrive as a steep front.
  const risingFast =
    (cfs != null && cfsRate != null && cfs >= 10 && cfsRate > Math.max(cfs * 0.5, 20)) ||
    (ftRate != null && ftRate > 0.5);
  let state;
  if (cfs != null) state = cfs < dryCfs ? 'dry' : 'flowing';
  else state = ftRate != null && ftRate > 0.1 ? 'flowing' : 'stage-only';
  return { state, cfs, ft, cfsRate, ftRate, risingFast, time: latestT };
}

// How one gauge affects one route.
export function rateLink(summary, { kind }, highCfs) {
  if (!summary || summary.state === 'nodata') return { level: 'unknown', why: 'no recent data' };
  const { state, cfs, risingFast } = summary;
  if (highCfs != null && cfs != null && cfs >= highCfs) {
    return { level: 'danger', why: `${fmt(cfs)} cfs, at/above the ${fmt(highCfs)} cfs trouble level` };
  }
  if (state === 'dry') return { level: 'ok', why: 'dry' };
  if (state === 'stage-only') return { level: 'ok', why: 'stage steady (no flow data)' };
  const flow = cfs != null ? `${fmt(cfs)} cfs` : 'stage rising';
  if (kind === 'dip') {
    return risingFast
      ? { level: 'danger', why: `${flow} and rising fast: water is headed for the crossing` }
      : { level: 'caution', why: `${flow}: water is headed for the crossing` };
  }
  return risingFast
    ? { level: 'caution', why: `${flow} and rising fast under the bridge` }
    : { level: 'watch', why: `${flow} under the bridge` };
}

export function rateRoute(routeCfg, summaries, gaugeCfg) {
  const links = routeCfg.gauges.map((g) => ({
    ...g,
    ...rateLink(summaries[g.site], g, gaugeCfg[g.site]?.highCfs ?? null),
  }));
  return { level: worst(links.map((l) => l.level)), links };
}

// Fastest route that is ok/watch; otherwise the least-bad one. Unknown data
// never counts as "ok".
export function recommend(rated) {
  const order = [...rated].sort((a, b) => rank(a.level) - rank(b.level) || a.minutes - b.minutes);
  const best = order[0];
  return { best, clear: best && rank(best.level) <= rank('watch'), order };
}

function fmt(n) {
  return n >= 100 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 10) / 10);
}
