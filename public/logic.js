// Pure rules: turn sensor data into a level + plain-English reason for each
// failure point, then for each route. No DOM or network so it runs under node --test.

export const LEVELS = ['ok', 'watch', 'caution', 'danger'];
const rank = (lvl) => (lvl === 'unknown' ? 1.5 : LEVELS.indexOf(lvl));
export const worst = (levels) => levels.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'ok');
const WINDOW_WORDS = { m10: '10 min', m30: '30 min', h1: '1 hour', h3: '3 hours', h6: '6 hours', d1: '24 hours' };
const fmtIn = (v) => `${v.toFixed(2)}"`;
const fmtCfs = (n) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 10) / 10));

// ---------- USGS ----------

// OGC `continuous` items -> { '00060': [{t, v}], '00065': [...] }, oldest first.
export function parseContinuous(json) {
  const series = {};
  for (const f of json?.features ?? []) {
    const p = f.properties ?? {};
    const t = Date.parse(p.time);
    const v = Number(p.value);
    if (!p.parameter_code || !Number.isFinite(t) || p.value == null || p.value === '' || !Number.isFinite(v)) continue;
    (series[p.parameter_code] ??= []).push({ t, v });
  }
  for (const s of Object.values(series)) s.sort((a, b) => a.t - b.t);
  return series;
}

// Least-squares change per hour over the trailing hour (null if < 3 points).
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
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den ? num / den : null;
}

// Latest flow (cfs), its trend, and whether it's fresh.
export function summarizeFlow(series, now, staleMs) {
  const q = series?.['00060'] ?? [];
  const last = q[q.length - 1];
  if (!last || now - last.t > staleMs) return { fresh: false };
  const rate = ratePerHour(q);
  const risingFast = rate != null && last.v >= 50 && rate > Math.max(last.v * 0.5, 100);
  return { fresh: true, cfs: last.v, rate, risingFast, time: last.t };
}

// ---------- the four checks ----------

// 1. River bridges, from USGS flow at the given gauges (worst one wins).
export function checkRiver(flows, siteIds, names, R) {
  const parts = siteIds.map((id) => ({ id, f: flows[id] })).filter((p) => p.f?.fresh);
  if (!parts.length) return { level: 'unknown', why: 'no live river gauge reading' };
  let out = { level: 'ok', why: `river at normal level (${parts.map((p) => `${fmtCfs(p.f.cfs)} cfs`).join(', ')})` };
  for (const { id, f } of parts) {
    const at = `${fmtCfs(f.cfs)} cfs at ${names[id].split(' (')[0]}`;
    let c;
    if (f.cfs >= R.dangerCfs) c = { level: 'danger', why: `${at}: the 2014 flood that went over the Trico bridge was 12,000-21,000 cfs` };
    else if (f.cfs >= R.cautionCfs || (f.risingFast && f.cfs >= R.watchCfs)) c = { level: 'caution', why: `${at}${f.risingFast ? ' and rising fast' : ''}: big flood flow. Bridges get closed at levels like this` };
    else if (f.cfs >= R.watchCfs || f.risingFast) c = { level: 'watch', why: `${at}${f.risingFast ? ' and rising' : ''}: storm water under the bridge` };
    if (c && rank(c.level) > rank(out.level)) out = c;
  }
  return out;
}

// Upstream creeks that reach the river bridges hours later.
export function checkRiverEarly(flows, siteIds, names, R) {
  const running = siteIds.filter((id) => flows[id]?.fresh && flows[id].cfs >= R.earlyCfs);
  if (!running.length) return null;
  return { level: 'watch', why: `${running.map((id) => `${names[id].split(' (')[0]} at ${fmtCfs(flows[id].cfs)} cfs`).join(', ')}: that water reaches the Santa Cruz bridges in a few hours` };
}

// 2. Rain in inches at ALERT gauges against a rule set; the heaviest gauge wins.
export function checkRain(snapshot, gaugeIds, rules, names, now, staleMs) {
  const gauges = (snapshot?.rain ?? []).filter((g) => gaugeIds.includes(g.site));
  const fresh = gauges.filter((g) => g.last_rpt && !g.maintenance && now - Date.parse(g.last_rpt) <= staleMs);
  if (!fresh.length) return { level: 'unknown', why: 'no rain gauge reading' };
  for (const level of ['danger', 'caution', 'watch']) {
    for (const [win, limit] of Object.entries(rules[level] ?? {})) {
      const hit = fresh
        .filter((g) => g.in?.[win] != null && g.in[win] >= limit)
        .sort((a, b) => b.in[win] - a.in[win])[0];
      if (hit) return { level, why: `${fmtIn(hit.in[win])} of rain in the last ${WINDOW_WORDS[win]} at ${names[hit.site] ?? hit.name}` };
    }
  }
  const h6 = Math.max(...fresh.map((g) => g.in?.h6 ?? 0));
  return { level: 'ok', why: h6 > 0 ? `only ${fmtIn(h6)} of rain in the last 6 hours nearby` : 'no rain in the last 6 hours nearby' };
}

// 3. A wash's own flow sensors (ALERT stream sensors + USGS).
export function checkWash(snapshot, flows, wash, kind, now, staleMs, names) {
  const readings = [];
  for (const id of wash.alert ?? []) {
    const s = (snapshot?.stream ?? []).find((x) => x.site === id);
    if (s && s.flow_cfs != null && s.last_rpt && now - Date.parse(s.last_rpt) <= staleMs) readings.push({ name: s.name.replace(/ \(PT\)$/, ''), cfs: s.flow_cfs });
  }
  for (const id of wash.usgs ?? []) {
    if (flows[id]?.fresh) readings.push({ name: names[id].split(' (')[0], cfs: flows[id].cfs, risingFast: flows[id].risingFast });
  }
  if (!readings.length) return { level: 'unknown', why: 'no wash flow sensor reading' };
  const top = readings.sort((a, b) => b.cfs - a.cfs)[0];
  if (top.cfs < 1) return { level: 'ok', why: 'Brawley Wash upstream is dry' };
  const at = `${fmtCfs(top.cfs)} cfs in ${top.name}`;
  if (kind === 'dip') {
    return top.cfs >= 500 || top.risingFast
      ? { level: 'danger', why: `${at}: a flood is coming down the wash toward this crossing` }
      : { level: 'caution', why: `${at}: water is coming down the wash toward this crossing` };
  }
  return top.cfs >= 2000 || top.risingFast
    ? { level: 'caution', why: `${at}: a large flow is coming toward this bridge` }
    : { level: 'watch', why: `${at}: water will pass under this bridge` };
}

// 4. Pima County's own barricade points near this spot.
const metres = (a, b) => {
  const ky = 111_320;
  const kx = ky * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * ky);
};
export function nearbyClosures(fp, closures, radiusM) {
  return (closures ?? []).filter((c) => metres(fp, c) <= radiusM);
}
export function checkClosures(points) {
  if (!points.length) return null;
  const closed = points.find((p) => /clos/i.test(p.status));
  if (closed) return { level: 'danger', why: `County says CLOSED: ${closed.location}` };
  const careful = points.find((p) => /caution/i.test(p.status));
  if (careful) return { level: 'caution', why: `County says PROCEED WITH CAUTION: ${careful.location}` };
  return { level: 'ok', why: 'county barricade point(s) here are marked Open', official: true };
}

// NWS warnings in effect for Avra Valley.
export function checkNws(alerts, kind) {
  if (!alerts) return null;
  const names = alerts.map((a) => a.event);
  if (names.some((e) => /Flash Flood Warning/i.test(e))) {
    return { level: kind === 'dip' ? 'danger' : 'caution', why: 'NWS Flash Flood Warning in effect: flooding is happening or about to' };
  }
  if (names.some((e) => /Flood (Warning|Advisory)|Flash Flood Statement/i.test(e))) {
    return { level: kind === 'dip' ? 'caution' : 'watch', why: `NWS ${names.find((e) => /Flood/i.test(e))} in effect` };
  }
  if (names.some((e) => /Flood Watch/i.test(e))) return { level: 'watch', why: 'NWS Flood Watch: flooding possible later' };
  return null;
}

// ---------- combine ----------

export function rateFailurePoint(fp, d, cfg) {
  const checks = [];
  const { now } = d;
  const closurePts = nearbyClosures(fp, d.closures, cfg.CLOSURE_RADIUS_M);
  const closure = d.closures ? checkClosures(closurePts) : null;
  if (closure) checks.push({ src: 'county', ...closure });
  const nws = checkNws(d.nws, fp.kind);
  if (nws) checks.push({ src: 'nws', ...nws });
  if (fp.river) {
    checks.push({ src: 'river', ...checkRiver(d.flows, fp.river, cfg.USGS_SITES, cfg.RIVER) });
    const early = checkRiverEarly(d.flows, cfg.RIVER_EARLY, cfg.USGS_SITES, cfg.RIVER);
    if (early) checks.push({ src: 'river-early', ...early });
  }
  if (fp.wash) checks.push({ src: 'wash', ...checkWash(d.alert, d.flows, fp.wash, fp.kind, now, cfg.STALE_MS, cfg.USGS_SITES) });
  const snapFresh = d.alert && now - Date.parse(d.alert.fetched_at) <= cfg.SNAPSHOT_STALE_MS;
  for (const [ruleName, ids] of Object.entries(fp.rain ?? {})) {
    const c = snapFresh
      ? checkRain(d.alert, ids, cfg.RAIN[ruleName], cfg.RAIN_GAUGES, now, cfg.STALE_MS)
      : { level: 'unknown', why: 'rain data unavailable or out of date' };
    // Rain upstream of a bridge means water will pass *under* it. That's a heads-up,
    // not a reason to avoid the road. The wash flow sensors decide anything worse.
    if (fp.kind === 'bridge' && rank(c.level) > rank('watch') && c.level !== 'unknown') {
      c.level = 'watch';
      c.why += ': water will pass under this bridge';
    }
    checks.push({ src: `rain-${ruleName}`, ...c });
  }
  // A county "Closed" or a gauge reading decides. "unknown" pieces only matter
  // when nothing else could be checked for this spot.
  const known = checks.filter((c) => c.level !== 'unknown');
  let level = known.length ? worst(known.map((c) => c.level)) : 'unknown';
  // Dips: without local rain data we can't call them safe. A county "Open" or a
  // dry gauge 20 miles away isn't enough, because a storm right overhead floods them.
  if (fp.kind === 'dip' && rank(level) < rank('unknown') && !known.some((c) => c.src === 'rain-local')) level = 'unknown';
  if (fp.kind === 'road' && level === 'danger') level = 'caution'; // shallow per local knowledge
  // Lead with a measurement when one exists; the county "Open" flag is often days old.
  const lead = checks.find((c) => c.level === level && !c.official) ?? checks.find((c) => c.level === level) ?? checks[0];
  return { id: fp.id, name: fp.name, where: fp.where, kind: fp.kind, level, why: lead?.why ?? 'no data', checks, closurePts };
}

export function rateRoutes(routeFeatures, fpResults, fps) {
  return routeFeatures.map((f) => {
    const id = f.properties.id;
    const pts = fps.filter((fp) => fp.routes.includes(id)).map((fp) => fpResults[fp.id]);
    return { id, name: f.properties.name, minutes: f.properties.minutes, km: f.properties.km, level: worst(pts.map((p) => p.level)), points: pts };
  });
}

// Fastest route that is ok/watch, otherwise the least-bad. Unknown never counts as clear.
export function recommend(rated) {
  const order = [...rated].sort((a, b) => rank(a.level) - rank(b.level) || a.minutes - b.minutes);
  const best = order[0];
  return { best, clear: best && rank(best.level) <= rank('watch'), order };
}

export function googleMapsUrl(nav, destination) {
  const pts = [...nav.via, ...(destination ? [nav.ramp] : [])].slice(0, 3);
  const dest = destination || nav.ramp.join(',');
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', dest);
  u.searchParams.set('waypoints', pts.map((p) => p.join(',')).join('|'));
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
}
