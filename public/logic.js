// Pure rules: turn sensor data into a level + plain-English reason for each
// failure point, then for each route. No DOM or network so it runs under node --test.

export const LEVELS = ['ok', 'watch', 'caution', 'danger'];
const rank = (lvl) => (lvl === 'unknown' ? 1.5 : LEVELS.indexOf(lvl));
export const worst = (levels) => levels.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'ok');
const WINDOW_WORDS = { m10: '10 min', m30: '30 min', h1: '1 hour', h3: '3 hours', h6: '6 hours', d1: '24 hours' };
const fmtIn = (v) => `${v.toFixed(2)}"`;
const siteName = (names, id) => names[id]?.name ?? names[id] ?? id;
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
    const at = `${fmtCfs(f.cfs)} cfs at ${siteName(names, id)}`;
    let c;
    if (f.cfs >= R.dangerCfs) c = { level: 'danger', why: `${at}: above the configured high-flow threshold; overtopping at this bridge is not established` };
    else if (f.cfs >= R.cautionCfs || (f.risingFast && f.cfs >= R.watchCfs)) c = { level: 'caution', why: `${at}${f.risingFast ? ' and rising fast' : ''}: above the configured flow-warning threshold; this flow threshold does not establish bridge-specific clearance` };
    else if (f.cfs >= R.watchCfs || f.risingFast) c = { level: 'watch', why: `${at}${f.risingFast ? ' and rising' : ''}: elevated river flow; water level relative to this bridge is not established` };
    if (c && rank(c.level) > rank(out.level)) out = c;
  }
  return {...out, observations:parts.map(({id,f})=>({siteId:id,cfs:f.cfs,time:f.time})), detail:parts.map(({id,f})=>siteName(names,id)+': '+fmtCfs(f.cfs)+' cfs; observed '+(Number.isFinite(f.time)?new Date(f.time).toISOString():'time unavailable')).join('; ')};
}

// Upstream creeks that reach the river bridges hours later.
export function checkRiverEarly(flows, siteIds, names, R) {
  const running = siteIds.filter((id) => flows[id]?.fresh && flows[id].cfs >= R.earlyCfs);
  if (!running.length) return null;
  return { level: 'watch', why: `${running.map((id) => `${siteName(names, id)} at ${fmtCfs(flows[id].cfs)} cfs`).join(', ')}: that water reaches the Santa Cruz bridges in a few hours` };
}

// 2. Rain in inches at ALERT gauges against a rule set; the heaviest gauge wins.
export function checkRain(snapshot, gaugeIds, rules, names, now, staleMs) {
  const gauges = (snapshot?.rain ?? []).filter((g) => gaugeIds.includes(g.site));
  // Use the latest readings we have, up to a day old, and say how old they are.
  const fresh = gauges.filter((g) => g.last_rpt && !g.maintenance && now - Date.parse(g.last_rpt) <= Math.max(staleMs, 24 * 3_600_000)
    && Object.values(g.in ?? {}).some((v) => Number.isFinite(v) && v >= 0));
  if (!fresh.length) return { level: 'unknown', why: 'no rain gauge reading' };
  const ageMin = snapshot.fetched_at ? (now - Date.parse(snapshot.fetched_at)) / 60_000 : 0;
  const asOf = ageMin > 45 ? ` (rain readings from ${new Date(Date.parse(snapshot.fetched_at)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix' })})` : '';
  const valid = (v) => Number.isFinite(v) && v >= 0;
  const most = (w) => {
    const values = fresh.map((g) => g.in?.[w]).filter(valid);
    return values.length ? Math.max(...values) : null;
  };
  const amount = (w) => most(w) == null ? 'unavailable' : fmtIn(most(w));
  const detail = `last 1 h ${amount('h1')} · 3 h ${amount('h3')} · 6 h ${amount('h6')} · 24 h ${amount('d1')}`
    + ` (wettest of ${fresh.map((g) => names[g.site] ?? g.name).join(', ')})`;
  for (const level of ['danger', 'caution', 'watch']) {
    for (const [win, limit] of Object.entries(rules[level] ?? {})) {
      const hit = fresh
        .filter((g) => valid(g.in?.[win]) && g.in[win] >= limit)
        .sort((a, b) => b.in[win] - a.in[win])[0];
      if (hit) return { level, detail, why: `${fmtIn(hit.in[win])} of rain in the last ${WINDOW_WORDS[win]} at ${names[hit.site] ?? hit.name}${asOf}` };
    }
  }
  const h6 = most('h6');
  const required = new Set(['h6', ...Object.values(rules).flatMap((rule) => Object.keys(rule))]);
  if ([...required].some((w) => most(w) == null)) return { level: 'unknown', detail, why: 'rain gauge readings are incomplete' + asOf };
  return { level: 'ok', detail, why: (h6 > 0 ? `light rain only (${fmtIn(h6)} in the last 6 hours)` : 'no rain in the last 6 hours') + asOf };
}

// 3. A wash's own flow sensors (ALERT stream sensors + USGS).
export function checkWash(snapshot, flows, wash, kind, now, staleMs, names) {
  const readings = [];
  for (const id of wash.alert ?? []) {
    const s = (snapshot?.stream ?? []).find((x) => x.site === id);
    if (s && !s.maintenance && Number.isFinite(s.flow_cfs) && s.flow_cfs >= 0 && s.last_rpt && now - Date.parse(s.last_rpt) <= staleMs) readings.push({ name: s.name.replace(/ \(PT\)$/, ''), cfs: s.flow_cfs });
  }
  for (const id of wash.usgs ?? []) {
    if (flows[id]?.fresh) readings.push({ name: siteName(names, id), cfs: flows[id].cfs, risingFast: flows[id].risingFast });
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
    : { level: 'watch', why: `${at}: bridge clearance is not established from this reading` };
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
  const when = (p) => (p.updated ? ` (updated ${p.updated})` : '');
  const detail = points.map((p) => `${p.location}: ${p.status}${when(p)}`).join(' · ');
  const closed = points.find((p) => /clos/i.test(p.status));
  if (closed) return { level: 'danger', detail, why: `County says CLOSED: ${closed.location}${when(closed)}` };
  const careful = points.find((p) => /caution/i.test(p.status));
  if (careful) return { level: 'caution', detail, why: `County says Proceed with Caution: ${careful.location}${when(careful)}` };
  return { level: 'ok', detail, why: 'county barricade point marked Open', official: true };
}

// NWS warnings in effect for Avra Valley.
export function checkNws(alerts, kind) {
  // NWS alerts cover the whole county, so they only nudge the spots that flood
  // first (dips). A Flood Watch ("possible later") changes nothing; it's shown as a note.
  if (!alerts) return null;
  const names = alerts.map((a) => a.event);
  if (names.some((e) => /Flash Flood Warning/i.test(e))) {
    return { level: kind === 'dip' ? 'caution' : 'watch', why: 'NWS Flash Flood Warning in effect: flooding is happening or about to somewhere in the area' };
  }
  if (kind === 'dip' && names.some((e) => /Flood (Warning|Advisory)|Flash Flood Statement/i.test(e))) {
    return { level: 'watch', why: `NWS ${names.find((e) => /Flood/i.test(e))} in effect for the area` };
  }
  return null;
}

// Compare absolute elevations only at the same bridge, in metres and the same datum.
export function bridgeHeightComparison(record, now) {
  const road = record?.roadwayEstimate, water = record?.modelWater;
  if (!road || !Number.isFinite(road.elevationM)) return { status: 'unavailable', reason: 'Roadway elevation estimate is missing.' };
  if (!water || water.quantity !== 'water_surface_elevation' || water.units !== 'm' || water.verticalDatum !== road.verticalDatum || JSON.stringify(water.location) !== JSON.stringify(record.location)) return { status: 'unavailable', reason: 'Matching water-surface elevation at this bridge in ' + road.verticalDatum + ' is missing.' };
  if (now > Date.parse(water.validTo)) return { status: 'expired', reason: 'The model water forecast expired at ' + water.validTo + '; a new water elevation is needed.' };
  const frames = water.frames.filter(f => Number.isFinite(f.elevationM) && Date.parse(f.time) >= now && Date.parse(f.time) >= Date.parse(water.validFrom) && Date.parse(f.time) <= Date.parse(water.validTo));
  if (!frames.length) return { status: 'unavailable', reason: 'No defined water-surface elevation remains in this forecast.' };
  const peak = frames.reduce((a,b) => b.elevationM > a.elevationM ? b : a);
  return { status: 'estimated', roadM: road.elevationM, waterM: peak.elevationM, differenceM: road.elevationM - peak.elevationM, time: peak.time, datum: road.verticalDatum, validFrom: water.validFrom, validTo: water.validTo };
}

// A discharge threshold describes the river, not water reaching a particular bridge.
function bridgeRiverCheck(check,record,now){
 const history=record?.documentedHistory??[],elevated=['watch','caution','danger'].includes(check.level);
 const heightComparison=bridgeHeightComparison(record,now),modeledRoadConcern=heightComparison.status==='estimated'&&heightComparison.differenceM<=0;
 return {...check,level:modeledRoadConcern?'caution':heightComparison.status==='estimated'?'ok':elevated?'watch':check.level,modeledRoadConcern,dischargeLevel:check.level,bridgeClearance:'unknown',
  why:modeledRoadConcern?`Modeled water ${heightComparison.waterM.toFixed(2)} m reaches or exceeds the estimated roadway ${heightComparison.roadM.toFixed(2)} m ${heightComparison.datum} at ${heightComparison.time}; estimated roadway flooding concern, not an observed closure.`:heightComparison.status==='estimated'?`Estimated road ${heightComparison.roadM.toFixed(2)} m; modeled water ${heightComparison.waterM.toFixed(2)} m ${heightComparison.datum}, ${heightComparison.differenceM.toFixed(2)} m below road at ${heightComparison.time}. No bridge-flooding penalty from this comparison; other hazards still apply.`:elevated?check.why.split(':')[0]+': elevated river discharge; water reaching this bridge or its approaches is not established.':check.why,
  detail:(check.detail?check.detail+'. ':'')+(record?'Site-linked structure record '+record.id+'. ':'No exact structure record. ')+(history.length?'Historical flooding is documented for this site; it is not a current closure or measured flow-to-road threshold. ':'No site-linked flooding history establishes a current road threshold. ')+(record?.roadwayEstimate?'A provisional roadway-height comparison is shown in height & history; it is not surveyed deck or underside clearance. ':'Current roadway elevation is unavailable. ')+'Clearance is unknown, not confirmed clear.',
  heightComparison,
  bridgeEvidence:{recordId:record?.id??null,historyDates:history.map(h=>h.date),clearance:'unknown'}};
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
    const river=checkRiver(d.flows, fp.river, cfg.USGS_SITES, cfg.RIVER);
    checks.push({ src: 'river', ...(['river','bridge'].includes(fp.kind)?bridgeRiverCheck(river,d.bridgeEvidence?.[fp.id],now):river) });
    const early = checkRiverEarly(d.flows, cfg.RIVER_EARLY, cfg.USGS_SITES, cfg.RIVER);
    if (early) checks.push({ src: 'river-early', ...early });
  }
  if (fp.wash) checks.push({ src: 'wash', ...checkWash(d.alert, d.flows, fp.wash, fp.kind, now, cfg.STALE_MS, cfg.USGS_SITES) });
  for (const [ruleName, ids] of Object.entries(fp.rain ?? {})) {
    const c = d.alert
      ? checkRain(d.alert, ids, cfg.RAIN[ruleName], cfg.RAIN_GAUGES, now, cfg.STALE_MS)
      : { level: 'unknown', why: 'rain gauges unreachable right now' };
    // Preserve the existing rainfall advisory rule; it does not establish bridge clearance.
    // Structure-specific elevation/history evidence is pending, not inferred from rainfall.
    if (fp.kind === 'bridge' && rank(c.level) > rank('watch') && c.level !== 'unknown') {
      c.level = 'watch';
      c.why += ': bridge clearance is not established from this reading';
    }
    checks.push({ src: `rain-${ruleName}`, ...c });
  }
  // Always a rating: it comes from whatever sources answered. A source that didn't
  // answer is listed in the details ("unreachable"), but never turns the rating into "?".
  const known = checks.filter((c) => c.level !== 'unknown');
  let level = known.length ? worst(known.map((c) => c.level)) : 'ok';
  if (!known.length) checks.unshift({ src: 'none', level: 'ok', why: 'No live readings right now; current road conditions are not established' });
  // Shallow spots per local knowledge: Silverbell drainage, the big flat dip on Ina.
  if ((fp.kind === 'road' || fp.kind === 'flat') && level === 'danger' && closure?.level !== 'danger') level = 'caution';
  // Lead with a measurement when one exists; the county "Open" flag is often days old.
  // Lead with the most specific source at that level: county closure, then local measurements, then NWS.
  const pref = ['county', 'wash', 'rain-local', 'river', 'rain-road', 'rain-basin', 'river-early', 'nws'];
  const atLevel = checks.filter((c) => c.level === level && !(c.official && level === 'ok'));
  atLevel.sort((a, b) => pref.indexOf(a.src) - pref.indexOf(b.src));
  const lead = atLevel[0] ?? checks.find((c) => c.level === level) ?? checks[0];
  return { evidenceAvailable: known.length > 0, id: fp.id, name: fp.name, short: fp.short, where: fp.where, kind: fp.kind, level, why: lead?.why ?? 'no data', checks, closurePts };
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
  return { best, clear: best && rank(best.level) <= rank('watch') && !best.points.some(p=>p.evidenceAvailable===false || p.checks.some(c=>c.bridgeClearance==='unknown'&&c.level!=='ok')), order };
}

// Google Maps link that forces the chosen roads with waypoints (phones allow up to 3).
//   toI10: from wherever you are, via the route, to I-10 (or on to `destination`).
//   valley: from wherever you are (e.g. work), onto I-10, off at this route's ramp,
//          back along the route to Trico & El Tiro, the heart of the valley.
export const VALLEY_HUB = [32.4295, -111.3045];
export function googleMapsUrl(nav, destination, direction = 'toI10') {
  let pts;
  let dest;
  if (direction === 'valley') {
    pts = [nav.ramp, ...[...nav.via].reverse()].slice(0, 3);
    dest = (nav.hub || VALLEY_HUB).join(',');
  } else {
    pts = [...nav.via, ...(destination ? [nav.ramp] : [])].slice(0, 3);
    dest = destination || nav.ramp.join(',');
  }
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', dest);
  u.searchParams.set('waypoints', pts.map((p) => p.join(',')).join('|'));
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
}

// A small 1-5 "risk factor" for display. It summarizes the level; it is not a probability.
//   1 nothing pointing at water · 2 some water around · 3 water likely near the road
//   4 several signs agree water is at the road · 5 closed or flood running · null unknown
export function riskScore(result) {
  switch (result.level) {
    case 'ok': return 1;
    case 'watch': return 2;
    case 'caution': return result.checks.filter((c) => c.level === 'caution' || c.level === 'danger').length >= 2 ? 4 : 3;
    case 'danger': return 5;
    default: return null;
  }
}
export function routeScore(route) {
  const scores = route.points.map(riskScore);
  if (route.level === 'unknown') return null;
  return Math.max(...scores.filter((x) => x != null), 1);
}

// The angel: plain "good signs" for a route, from every check that came back clear.
export function goodSigns(route, nwsQuiet) {
  // A sign only counts as good if nothing of the same kind on this route says otherwise.
  const kind = (src) => (src.startsWith('rain') ? 'rain' : src === 'river-early' ? 'river' : src);
  const checks = route.points.flatMap((p) => p.checks);
  const bad = new Set(checks.filter((c) => c.level !== 'ok').map((c) => kind(c.src)));
  const ok = checks.filter((c) => c.level === 'ok' && !bad.has(kind(c.src)));
  const out = [];
  const add = (t) => { if (!out.includes(t)) out.push(t); };
  if (ok.some((c) => c.src === 'river' && c.heightComparison?.status !== 'estimated')) add('the Santa Cruz is at its everyday flow');
  if (ok.some((c) => c.src === 'wash')) add('Brawley Wash upstream is dry');
  const rain = ok.filter((c) => c.src.startsWith('rain'));
  if (rain.length) add(rain.every((c) => /^no rain/.test(c.why)) ? 'no rain in the last 6 hours' : 'only light rain lately');
  if (ok.some((c) => c.src === 'county')) add('county barricades on it are marked Open');
  if (nwsQuiet) add('no weather-service flood alerts');
  return out;
}

// What's working against a route, worst first, one line per stretch.
export function againstIt(route) {
  const order = { danger: 0, caution: 1, unknown: 2, watch: 3 };
  return route.points
    .filter((p) => p.level !== 'ok')
    .sort((a, b) => order[a.level] - order[b.level])
    .map((p) => ({ level: p.level, short: p.short, why: p.why }));
}
