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
  // A reading stamped in the future is a clock or feed problem, not a reading.
  const fresh = gauges.filter((g) => g.last_rpt && !g.maintenance && Date.parse(g.last_rpt) <= now
    && now - Date.parse(g.last_rpt) <= Math.max(staleMs, 24 * 3_600_000)
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
// Every sensor listed for a crossing here sits up the wash from it, not on the road. Which
// sensors are listed for which crossing is a configuration choice; no flow-to-road relation
// between them has been established. A reading there does not establish how much of that
// water reaches the crossing, how long it takes or how deep it gets on the pavement, so it is
// reported as an upstream alert with its own observation time and how far away it is, and it
// never by itself says this road is flooded. A dry reading is not a dry road either: see the
// road-status check in rateFailurePoint.
export const WASH_RULES = { bigFlowCfs: 500 };
const MILE_M = 1609.344;
const AZ_MS = 7 * 3_600_000; // Arizona is UTC-7 all year, no DST
const azClock = (t) => {
  if (!Number.isFinite(t)) return null;
  const d = new Date(t - AZ_MS);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const milesFrom = (fp, r) => (Number.isFinite(fp?.lat) && Number.isFinite(r.lat) && Number.isFinite(r.lon) ? metres(fp, r) / MILE_M : null);
const sensorPlace = (fp, r) => {
  const mi = milesFrom(fp, r);
  return mi == null ? 'how far up the wash it sits is not in our data' : `about ${mi.toFixed(1)} mi away in a straight line`;
};
// A usable reading: a real number, not negative, and not stamped in the future.
const usableFlow = (cfs, t, now, staleMs) => Number.isFinite(cfs) && cfs >= 0 && Number.isFinite(t) && t <= now && now - t <= staleMs;
export function checkWash(snapshot, flows, fp, now, staleMs, names, rules) {
  const R = rules ?? WASH_RULES;
  const wash = fp.wash ?? {};
  const readings = [];
  for (const id of wash.alert ?? []) {
    const s = (snapshot?.stream ?? []).find((x) => x.site === id);
    if (s && !s.maintenance && usableFlow(s.flow_cfs, Date.parse(s.last_rpt), now, staleMs)) {
      readings.push({ id, name: s.name.replace(/ \(PT\)$/, ''), cfs: s.flow_cfs, lat: s.lat, lon: s.lon, time: Date.parse(s.last_rpt), observedAt: s.last_rpt });
    }
  }
  for (const id of wash.usgs ?? []) {
    // A "fresh" flag is not a reading: the number and its own timestamp still have to hold up.
    const f = flows[id];
    if (f?.fresh && usableFlow(f.cfs, f.time, now, staleMs)) {
      readings.push({ id, name: siteName(names, id), cfs: f.cfs, risingFast: f.risingFast, lat: names[id]?.lat, lon: names[id]?.lon, time: f.time, observedAt: new Date(f.time).toISOString() });
    }
  }
  if (!readings.length) return { level: 'unknown', why: 'no wash flow sensor reading' };
  readings.sort((a, b) => b.cfs - a.cfs);
  const top = readings[0];
  const observations = readings.map((r) => ({ siteId: r.id, name: r.name, cfs: r.cfs, milesAway: milesFrom(fp, r), time: r.time, observedAt: r.observedAt }));
  const when = (r) => (azClock(r.time) ? ` at ${azClock(r.time)}` : '');
  const detail = readings.map((r) => `${r.name}: ${fmtCfs(r.cfs)} cfs${when(r)}, ${sensorPlace(fp, r)}`).join('; ')
    + '. No rating curve, travel time or channel-loss relation between these sensors and this crossing has been established, so these numbers give no depth and no arrival time here.';
  if (top.cfs < 1) return { level: 'ok', observations, detail, why: 'Brawley Wash upstream is dry' };
  const at = `${fmtCfs(top.cfs)} cfs in ${top.name}`;
  const big = top.cfs >= R.bigFlowCfs || top.risingFast;
  const rising = top.risingFast ? ', rising fast' : '';
  if (fp.kind === 'dip') {
    return {
      level: 'watch', upstream: true, upstreamAlert: big ? 'big-flow' : 'running', upstreamCfs: top.cfs, observations, detail,
      why: `${at}${rising}, ${sensorPlace(fp, top)}: ${big ? 'a big flow is running in the wash upstream of here' : 'water is running in the wash upstream of here'}. Whether it reaches this crossing, when, and how deep is not established.`,
    };
  }
  return { level: 'unknown', contextOnly: true, upstream: true, observations, detail, why: `${at}, ${sensorPlace(fp, top)}: upstream measurement; no site-specific roadway elevation comparison is available for this bridge` };
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
// Only the words the county actually uses are read. A missing or unrecognized status is
// unknown, never Open: an empty field is a gap in the feed, not a report that the road is fine.
const OPEN_STATUS = /^open\b/i;
const STALE_OPEN_MS = 30 * 86400000;
export function checkClosures(points, now = null) {
  if (!points.length) return null;
  const when = (p) => (p.updated ? ` (updated ${p.updated})` : '');
  // The county's own words stay whole: which way it applies to, and when they last touched it.
  const dir = (p) => (p.direction && !/^all directions$/i.test(p.direction.trim()) ? `, ${p.direction.trim().toLowerCase()}` : '');
  const said = (p) => (p.status?.trim() ? p.status.trim() : 'no status in the county feed');
  const detail = points.map((p) => `${p.location}: ${said(p)}${dir(p)}${when(p)}`).join(' · ');
  const closed = points.find((p) => /clos/i.test(p.status));
  if (closed) return { level: 'danger', detail, why: `County says CLOSED: ${closed.location}${dir(closed)}${when(closed)}` };
  const careful = points.find((p) => /caution/i.test(p.status));
  if (careful) return { level: 'caution', detail, why: `County says Proceed with Caution: ${careful.location}${dir(careful)}${when(careful)}` };
  const unreadable = points.filter((p) => !OPEN_STATUS.test(p.status?.trim() ?? ''));
  if (unreadable.length) {
    return { level: 'unknown', detail, roadStatus: 'unknown', why: `county barricade point status is not readable: ${unreadable.map((p) => `${p.location} says "${said(p)}"`).join(', ')}` };
  }
  // An old "Open" only says nobody has changed that point. It isn't a recent report from the road.
  const stampOf = (p) => { const m = /^(\d\d)\/(\d\d)\/(\d\d), (\d\d):(\d\d)$/.exec(String(p.updated ?? '').trim()); return m ? Date.UTC(2000 + +m[3], +m[1] - 1, +m[2], +m[4] + 7, +m[5]) : null; };
  const stamps = points.map(stampOf);
  const staleOpen = Number.isFinite(now) && stamps.every((t) => t !== null && now - t > STALE_OPEN_MS);
  if (staleOpen) return { level: 'ok', detail, why: 'county barricade point marked Open, but not updated recently', official: true, staleOpen: true };
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
export function bridgeHeightComparison(record, now, policy) {
  const road = record?.roadwayEstimate, water = record?.modelWater;
  if (!road || !Number.isFinite(road.elevationM)) return { status: 'unavailable', reason: 'Roadway elevation estimate is missing.' };
  if (!water || water.quantity !== 'water_surface_elevation' || water.units !== 'm' || water.verticalDatum !== road.verticalDatum || JSON.stringify(water.location) !== JSON.stringify(record.location)) return { status: 'unavailable', reason: 'Matching water-surface elevation at this bridge in ' + road.verticalDatum + ' is missing.' };
  if (now > Date.parse(water.validTo)) return { status: 'expired', reason: 'The model water forecast expired at ' + water.validTo + '; a new water elevation is needed.' };
  const frames = water.frames.filter(f => Number.isFinite(f.elevationM) && Date.parse(f.time) >= now && Date.parse(f.time) >= Date.parse(water.validFrom) && Date.parse(f.time) <= Date.parse(water.validTo));
  if (!frames.length) return { status: 'unavailable', reason: 'No defined water-surface elevation remains in this forecast.' };
  const peak = frames.reduce((a,b) => b.elevationM > a.elevationM ? b : a);
  const channel=record.channelReference;
  const channelValid=channel&&Number.isFinite(channel.elevationM)&&channel.verticalDatum===road.verticalDatum&&channel.structureId===record.structureId&&road.elevationM>channel.elevationM;
  const heightAboveChannelM=channelValid?road.elevationM-channel.elevationM:null;
  const thresholds=channelValid&&policy?{warningM:channel.elevationM+policy.warningFraction*heightAboveChannelM,roadwayM:channel.elevationM+policy.roadwayFraction*heightAboveChannelM,likelyClosedM:channel.elevationM+policy.likelyClosedFraction*heightAboveChannelM}:null;
  const assessment=thresholds?(peak.elevationM>=thresholds.likelyClosedM?'likely_closed':peak.elevationM>=thresholds.roadwayM?'roadway_concern':peak.elevationM>=thresholds.warningM?'warning':'below_warning'):(peak.elevationM>=road.elevationM?'roadway_concern':'unavailable');
  const assessmentLabel={likely_closed:'likely closed — model estimate',roadway_concern:'modeled water reaches estimated roadway',warning:'warning — modeled water within the lower 10% roadway margin',below_warning:'modeled water below the bridge warning level',unavailable:'channel reference unavailable; percentage thresholds not computed'}[assessment];
  return { channelM:channelValid?channel.elevationM:null,heightAboveChannelM,thresholds,assessment,assessmentLabel,status: 'estimated', roadM: road.elevationM, waterM: peak.elevationM, differenceM: road.elevationM - peak.elevationM, time: peak.time, datum: road.verticalDatum, validFrom: water.validFrom, validTo: water.validTo };
}

// A discharge threshold describes the river, not water reaching a particular bridge.
function bridgeRiverCheck(check,record,now,policy){
 const history=record?.documentedHistory??[];
 const heightComparison=bridgeHeightComparison(record,now,policy),modeledRoadConcern=heightComparison.status==='estimated'&&heightComparison.differenceM<=0;
 const assessedLevel={likely_closed:'danger',roadway_concern:'caution',warning:'watch',below_warning:'ok'}[heightComparison.assessment]??'unknown';
 return {...check,level:assessedLevel,bridgePoints:heightComparison.assessment==='warning'?policy.warningPoints:heightComparison.assessment==='roadway_concern'?policy.roadwayPoints:0,modeledRoadConcern,dischargeLevel:check.level,bridgeClearance:'unknown',
  why:heightComparison.status==='estimated'?`${heightComparison.assessmentLabel}: estimated road ${heightComparison.roadM.toFixed(2)} m, modeled water ${heightComparison.waterM.toFixed(2)} m ${heightComparison.datum} at ${heightComparison.time}. Official closure status is separate.`:heightComparison.reason+' Gauge discharge is context only.',
  detail:(check.detail?check.detail+'. ':'')+(record?'Site-linked structure record '+record.id+'. ':'No exact structure record. ')+(history.length?'Historical flooding is documented for this site; it is not a current closure or measured flow-to-road threshold. ':'No site-linked flooding history establishes a current road threshold. ')+(record?.roadwayEstimate?'A provisional roadway-height comparison is shown in height & history; it is not surveyed deck or underside clearance. ':'Current roadway elevation is unavailable. ')+'Clearance is unknown, not confirmed clear.',
  heightComparison,
  bridgeEvidence:{recordId:record?.id??null,historyDates:history.map(h=>h.date),clearance:'unknown'}};
}

// ---------- combine ----------

export function rateFailurePoint(fp, d, cfg) {
  const checks = [];
  const { now } = d;
  const closurePts = nearbyClosures(fp, d.closures, cfg.CLOSURE_RADIUS_M);
  const closure = d.closures ? checkClosures(closurePts, now) : null;
  if (closure) checks.push({ src: 'county', ...closure });
  const nws = checkNws(d.nws, fp.kind);
  if (nws) checks.push({ src: 'nws', ...nws });
  if (fp.river) {
    const river=checkRiver(d.flows, fp.river, cfg.USGS_SITES, cfg.RIVER);
    checks.push({ src: 'river', ...(['river','bridge'].includes(fp.kind)?bridgeRiverCheck(river,d.bridgeEvidence?.[fp.id],now,cfg.BRIDGE_POLICY):river) });
    const early = checkRiverEarly(d.flows, cfg.RIVER_EARLY, cfg.USGS_SITES, cfg.RIVER);
    if (early) checks.push({ src: 'river-early', ...early, ...(['river','bridge'].includes(fp.kind)?{level:'unknown',contextOnly:true,why:early.why.split(':')[0]+': upstream readings; no site-specific travel time or roadway height comparison'}:{}) });
  }
  if (fp.wash) checks.push({ src: 'wash', ...checkWash(d.alert, d.flows, fp, now, cfg.STALE_MS, cfg.USGS_SITES, cfg.WASH) });
  // A dip whose only flow sensors are up the wash has nothing watching the road itself. Where
  // the county has no readable barricade point here either, nothing in the data reports this
  // pavement: connectivity and depth stay unknown, whatever the upstream sensors say or don't
  // say. A quiet or dry reading miles upstream is not a dry road, and a silent sensor is not
  // news. This never changes the number; it stops the crossing being called clear.
  const countyReportsTheRoad = closure != null && closure.level !== 'unknown';
  if (fp.wash && fp.kind === 'dip' && !countyReportsTheRoad) {
    checks.push({
      src: 'road-status', level: 'unknown', roadStatus: 'unknown',
      why: 'Nothing reports this crossing itself: no sensor on the road, and no county barricade point matched here right now',
      detail: `The flow sensors listed for this crossing are up the wash from it, and no flow-to-road relation is established, so a dry or quiet reading there is not a dry road. Rain at the nearby county gauges, a county barricade point within ${cfg.CLOSURE_RADIUS_M} m, an NWS warning and the HAND model row are the local evidence this crossing has; none of them measures water depth on the pavement.`,
    });
  }
  for (const [ruleName, ids] of Object.entries(fp.rain ?? {})) {
    const c = d.alert
      ? checkRain(d.alert, ids, cfg.RAIN[ruleName], cfg.RAIN_GAUGES, now, cfg.STALE_MS)
      : { level: 'unknown', why: 'rain gauges unreachable right now' };
    // Rain is context, not a bridge-height or bridge-inundation measurement.
    if (['bridge','river'].includes(fp.kind) && c.level !== 'unknown' && c.level !== 'ok') {
      c.sourceLevel = c.level;
      c.level = 'unknown';
      c.contextOnly = true;
      c.why += ': rainfall context; no bridge-specific roadway inundation established';
    }
    checks.push({ src: `rain-${ruleName}`, ...c });
  }
  // Proceed with Caution barricades stay up for weeks after a storm. On its own it is a report
  // that someone once saw a reason for care, so another live source at this road has to agree
  // before it reads as water near the road. Distant sensors don't count as agreeing: upstream
  // gauges, creek gauges and basin rain stay listed, but none of them reports this road
  // (docs/BRAWLEY-UPSTREAM-EVIDENCE.md). Closed is never softened.
  const county = checks.find((c) => c.src === 'county' && c.level === 'caution');
  const WET = ['watch', 'caution', 'danger'];
  const distant = (c) => c.upstream === true || c.src === 'river-early' || c.src === 'rain-basin';
  if (county && !checks.some((c) => c !== county && WET.includes(c.level) && !c.contextOnly && !distant(c))) {
    county.level = 'watch';
    county.uncorroborated = true;
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
  const pref = ['county', 'wash', 'rain-local', 'river', 'rain-road', 'rain-basin', 'river-early', 'nws', 'road-status'];
  const atLevel = checks.filter((c) => c.level === level && !(c.official && level === 'ok'));
  atLevel.sort((a, b) => pref.indexOf(a.src) - pref.indexOf(b.src));
  const lead = atLevel[0] ?? checks.find((c) => c.level === level) ?? checks[0];
  return { evidenceAvailable: known.length > 0, id: fp.id, name: fp.name, short: fp.short, where: fp.where, kind: fp.kind, level, why: lead?.why ?? 'no data', checks, closurePts };
}

// The line under a crossing's number, when the evidence itself should say it instead of a
// generic sentence about the level. The county's status is a report from the road and leads
// with its own words, direction and time — it is not a depth measurement. An upstream alert
// never claims the crossing is passable. null means "use the level's plain sentence".
export function crossingLead(result) {
  const county = result.checks.find((c) => c.src === 'county' && c.level !== 'unknown');
  const upstream = result.checks.find((c) => c.upstream === true && c.level !== 'ok');
  const roadUnknown = result.checks.some((c) => c.roadStatus === 'unknown');
  const noDepth = 'That is the county reporting this road, not a measurement of how deep the water is.';
  if (county && county.level === result.level && county.level !== 'ok') return `${county.why}. ${noDepth}${county.uncorroborated ? ' No local rain, weather alert or flood model shows water at this road right now.' : ''}`;
  if (upstream && ['watch', 'unknown'].includes(result.level)) {
    return `${upstream.why}${roadUnknown ? ' Nothing here reports this road, so whether you can get through is unknown.' : ''}`;
  }
  if (roadUnknown && ['ok', 'unknown'].includes(result.level)) {
    return 'Nothing in the data reports this crossing itself. A quiet reading miles upstream is not a dry road; look as you come up on it.';
  }
  return null;
}

// County barricades on a route but away from any crossing. The road name has to match as well
// as the position: a barricade on a side street at an intersection is not on this route.
const ROUTE_BARRICADE_M = 40;
const roadKey = (name) => (name ?? '').toLowerCase().replace(/-/g, ' ')
  .replace(/\b(north|south|east|west|n|s|e|w)\b/g, ' ')
  .replace(/\b(road|rd|boulevard|bl|blvd|street|st|avenue|av|ave|highway|hy|hwy|drive|dr|way|wy)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();
const barricadeRoad = (location) => roadKey((location ?? '').split(/\s(?:north|south|east|west|at|between)\s(?:of\s)?/i)[0]);
function metresToLine(p, line) {
  const ky = 110574, kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p.lon) * kx, ay = (line[i - 1][1] - p.lat) * ky;
    const dx = (line[i][0] - line[i - 1][0]) * kx, dy = (line[i][1] - line[i - 1][1]) * ky;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
export function barricadesOnRoute(feature, closures) {
  const g = feature.geometry;
  if (!g || !closures?.length) return [];
  const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  const roads = new Set((feature.properties.legs ?? []).map((l) => roadKey(l.road)));
  return closures.filter((c) => {
    if (!/clos|caution/i.test(c.status ?? '') || !roads.has(barricadeRoad(c.location))) return false;
    if (!lines.some((line) => metresToLine(c, line) <= ROUTE_BARRICADE_M)) return false;
    const run = routeRunAlongLeg(lines, c);
    return run == null || run >= USES_LEG_M;
  });
}
// The county names which leg of a road a barricade is on: "Trico Rd south of Trico Marana Rd".
// If the route runs that way from the barricade, it uses that leg. If not, the barricade is on
// a leg the route doesn't take, such as the far side of an intersection where the route turns.
const LEG_HEADINGS = { north: 0, east: 90, south: 180, west: 270 };
const USES_LEG_M = 100;
const segmentMetres = (a, b, lat) => {
  const dx = (b[0] - a[0]) * 111320 * Math.cos((lat * Math.PI) / 180), dy = (b[1] - a[1]) * 110574;
  return { m: Math.hypot(dx, dy), heading: (Math.atan2(dx, dy) * 180) / Math.PI };
};
export function routeRunAlongLeg(lines, c) {
  const word = /\b(north|south|east|west)\s+of\b/i.exec(c.location ?? '')?.[1]?.toLowerCase();
  if (!word) return null;
  const facing = LEG_HEADINGS[word];
  let best = 0;
  for (const line of lines) {
    if (metresToLine(c, line) > ROUTE_BARRICADE_M) continue;
    let at = 0, near = Infinity;
    for (let i = 0; i < line.length; i++) {
      const d = Math.hypot((line[i][0] - c.lon) * 94000, (line[i][1] - c.lat) * 110574);
      if (d < near) { near = d; at = i; }
    }
    for (const step of [1, -1]) {
      let run = 0, off = 0;
      for (let i = at; i + step >= 0 && i + step < line.length; i += step) {
        const { m, heading } = segmentMetres(line[i], line[i + step], c.lat);
        if (m < 1) continue;
        // A few metres of other heading is the barricade's offset from a junction; more is a turn.
        if (Math.abs(((heading - facing + 540) % 360) - 180) > 60) { off += m; if (off > 15) break; continue; }
        run += m;
      }
      best = Math.max(best, run);
    }
  }
  return best;
}
const barricadePoint = (c) => {
  const closed = /clos/i.test(c.status);
  const check = checkClosures([c]);
  const level = closed ? 'danger' : 'watch';
  return { id: `county-${c.lat}-${c.lon}`, short: c.location, name: c.location, where: 'On this route, away from the listed crossings', kind: 'road', lat: c.lat, lon: c.lon,
    level, why: check.why, evidenceAvailable: true, closurePts: [c], routeBarricade: true,
    checks: [{ src: 'county', ...check, level, ...(closed ? {} : { uncorroborated: true }) }] };
};

// TransView (Pima Association of Governments) road events: closures and construction with real
// geometry, including utility work. Lines can be tested against the route directly.
const ROAD_EVENT_LINE_M = 12; // Tight enough that a street crossing the route overlaps it by only about 24 m.
const ROAD_EVENT_OVERLAP_M = 30;
function parseWkt(text) {
  const type = (text ?? '').split('(')[0].trim().toUpperCase();
  const parts = [...(text ?? '').matchAll(/\(([^()]+)\)/g)].map((m) => m[1].split(',').map((pair) => pair.trim().split(/\s+/).map(Number)));
  return { type, parts: parts.filter((part) => part.every((q) => q.length === 2 && q.every(Number.isFinite))) };
}
// The feed's dates are Arizona local time; Arizona is UTC-7 all year.
function azDate(text) {
  if (text == null || String(text).trim() === '') return null;
  const m = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+) (AM|PM)$/.exec((text ?? '').trim());
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > new Date(Date.UTC(+m[3], +m[1], 0)).getUTCDate()
      || +m[3] < 2000 || +m[4] < 1 || +m[4] > 12 || +m[5] > 59 || +m[6] > 59) return NaN;
  return Date.UTC(+m[3], +m[1] - 1, +m[2], (+m[4] % 12) + (m[7] === 'PM' ? 12 : 0) + 7, +m[5], +m[6]);
}
const dayMinutes = (text) => { if (text == null || String(text).trim() === '') return null; const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : NaN; };
// County closures carry no reason: the county's reason field says Flooding even on closures for other work.
export function normalizeRoadEvents(closures, construction, box = null) {
  const events = [];
  for (const r of closures ?? []) {
    const { type, parts } = parseWkt(r.Geo);
    events.push({ id: `closure-${r.KeyID}`, headline: r.headline ?? '', description: r.description ?? '', source: 'TransView', closed: /road closed/i.test(r.trafficImpacts ?? ''), reason: null, jurisdiction: r.jurisdiction ?? null, type, parts, start: null, stop: null, dailyStart: null, dailyEnd: null, link: null });
  }
  for (const r of Object.values(construction ?? {})) {
    const { type, parts } = parseWkt(r.Geography);
    const sub = r.EventSubTypes ?? [];
    events.push({ id: `work-${r.KeyID}`, headline: r.Headline ?? '', source: 'TransView', closed: sub.some((s) => /ROAD_CLOSED/.test(s)), reason: sub.some((s) => /UTILITY/.test(s)) ? 'utility work' : 'construction', jurisdiction: r.Jurisdiction ?? null, type, parts, start: azDate(r.StartDate), stop: azDate(r.StopDate), dailyStart: dayMinutes(r.DailyStartTime), dailyEnd: dayMinutes(r.DailyEndTime), link: (r.Links ?? []).find(Boolean) ?? null });
  }
  for (const e of events) e.timingUnknown = ['start', 'stop', 'dailyStart', 'dailyEnd'].some((k) => e[k] != null && !Number.isFinite(e[k]));
  return events.filter((e) => e.parts.length && (!box || e.parts.some((part) => part.some(([x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]))));
}
// A listing is not proof that its closure is in effect now. Missing/invalid times
// stay unknown, and an anticipated end is not evidence the road has reopened.
export function roadEventTiming(e, now) {
  if (!Number.isFinite(now) || e.timingUnknown === true) return 'unknown';
  const supplied = (v) => v !== null && v !== undefined;
  if (['start', 'stop'].some((k) => supplied(e[k]) && !Number.isFinite(e[k]))) return 'unknown';
  if (e.start != null && e.stop != null && e.stop <= e.start) return 'unknown';
  if (e.start != null && now < e.start) return 'scheduled';
  if (e.stop != null && now >= e.stop) return 'ended';
  const hasDaily = supplied(e.dailyStart) || supplied(e.dailyEnd);
  if (hasDaily) {
    if (![e.dailyStart, e.dailyEnd].every((v) => Number.isInteger(v) && v >= 0 && v < 1440)
        || e.dailyStart === e.dailyEnd) return 'unknown';
    const az = new Date(now - 7 * 3600000);
    const minute = az.getUTCHours() * 60 + az.getUTCMinutes();
    const inWindow = e.dailyStart < e.dailyEnd
      ? minute >= e.dailyStart && minute < e.dailyEnd
      : minute >= e.dailyStart || minute < e.dailyEnd;
    if (!inWindow) return 'scheduled';
  }
  // A future end alone does not tell us when the closure begins.
  if (e.start == null) return 'unknown';
  return 'active';
}
// Legacy callers use this as a conservative route blocker. Unknown reports still
// block navigation; display callers must use roadEventTiming before saying Closed.
export function roadEventActive(e, now) {
  return ['active', 'unknown'].includes(roadEventTiming(e, now));
}
export function roadEventLabel(e, now) {
  const state = roadEventTiming(e, now);
  const date = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' AZ';
  const clock = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${m >= 720 ? 'PM' : 'AM'}`;
  const daily = [e.dailyStart, e.dailyEnd].every((v) => Number.isInteger(v) && v >= 0 && v < 1440) && e.dailyStart !== e.dailyEnd
    ? `daily ${clock(e.dailyStart)} to ${clock(e.dailyEnd)} AZ${e.dailyStart > e.dailyEnd ? ' (overnight)' : ''}` : null;
  const window = [Number.isFinite(e.start) ? `starts ${date(e.start)}` : null,
    Number.isFinite(e.stop) ? `anticipated end ${date(e.stop)}` : null, daily].filter(Boolean).join('; ');
  const label = { active: 'Closed during listed window', scheduled: 'Scheduled closure; not in effect in this window', ended: 'Listed window ended; reopening unconfirmed', unknown: 'Closure listed; timing unverified' }[state];
  return `${label}${e.reason ? ` for ${e.reason}` : ''}${window ? ` · ${window}` : ''}`;
}
function overlapMetres(part, lines) {
  let total = 0;
  for (let i = 1; i < part.length; i++) {
    const { m } = segmentMetres(part[i - 1], part[i], part[i][1]);
    const steps = Math.max(1, Math.ceil(m / 5));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const p = { lon: part[i - 1][0] + (part[i][0] - part[i - 1][0]) * t, lat: part[i - 1][1] + (part[i][1] - part[i - 1][1]) * t };
      if (lines.some((line) => metresToLine(p, line) <= ROAD_EVENT_LINE_M)) total += m / steps;
    }
  }
  return total;
}
// Closures in effect now that are really on this route: a line overlapping the route, or a
// point on the line whose headline names a road the route uses.
export function roadEventsOnRoute(feature, events, now) {
  const g = feature.geometry;
  if (!g || !events?.length) return [];
  const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  const roads = (feature.properties.legs ?? []).map((l) => roadKey(l.road)).filter(Boolean);
  const hits = [];
  for (const e of events) {
    if (!e.closed || !roadEventActive(e, now)) continue;
    if (e.type.includes('LINE')) {
      const overlapM = e.parts.reduce((sum, part) => sum + overlapMetres(part, lines), 0);
      if (overlapM >= ROAD_EVENT_OVERLAP_M) hits.push({ event: e, overlapM: Math.round(overlapM), how: 'line_overlap', timing: roadEventTiming(e, now) });
    } else {
      const named = roads.some((road) => ` ${roadKey(e.headline)} `.includes(` ${road} `));
      const near = e.parts.some((part) => part.some(([lon, lat]) => lines.some((line) => metresToLine({ lon, lat }, line) <= ROUTE_BARRICADE_M)));
      if (named && near) hits.push({ event: e, overlapM: null, how: 'point_named', timing: roadEventTiming(e, now) });
    }
  }
  return hits;
}
const roadEventPoint = ({ event: e, overlapM, how, timing }) => {
  const [lon, lat] = e.parts[0][0];
  const why = `${e.source ?? 'TransView'} lists this road closed${e.reason ? ` for ${e.reason}` : ''}${timing === 'unknown' ? ', but the timing is unverified; directions remain withheld' : ''}: ${e.headline.trim()}${overlapM ? `. The closure overlaps this route for about ${Math.round(overlapM * 3.28084)} ft` : ''}`;
  return { id: e.id, short: e.headline.trim(), name: e.headline.trim(), where: 'On this route', kind: 'road', lat, lon, level: 'danger', why, routeFit: how, evidenceAvailable: true, closurePts: [], routeBarricade: true,
    checks: [{ src: 'road-event', level: 'danger', why, detail: e.link ?? undefined }] };
};

export function rateRoutes(routeFeatures, fpResults, fps, { closures = null, radiusM = 0, roadEvents = null, now = Date.now() } = {}) {
  return routeFeatures.map((f) => {
    const id = f.properties.id;
    const onRoute = fps.filter((fp) => fp.routes.includes(id));
    const pts = onRoute.map((fp) => fpResults[fp.id]);
    // A crossing already reads barricades within its radius; only the ones between crossings are new.
    for (const c of barricadesOnRoute(f, closures)) {
      if (!onRoute.some((fp) => metres(fp, c) <= radiusM)) pts.push(barricadePoint(c));
    }
    // The county's own points are already read above; only what the county feed lacks is added.
    for (const hit of roadEventsOnRoute(f, roadEvents, now)) {
      const repeated = hit.how === 'point_named' && (closures ?? []).some((c) => hit.event.parts.some((part) => part.some((q) => Math.hypot((q[0] - c.lon) * 94000, (q[1] - c.lat) * 110574) <= 15)));
      if (!repeated) pts.push(roadEventPoint(hit));
    }
    return { id, name: f.properties.name, minutes: f.properties.minutes, km: f.properties.km, level: worst(pts.map((p) => p.level)), points: pts };
  });
}

// Fastest route that is ok/watch, otherwise the least-bad. Unknown never counts as clear.
// An upstream wash alert keeps a route off "clear" too: water running up the wash is a live
// warning, and the fact that it can't be tied to this road is not evidence the road is fine.
// So does a crossing nothing reports (roadStatus unknown) — including when its upstream
// sensors read dry, are stale, or say nothing at all.
// The official closures on a route: a county Closed point or a road-closed event, not a model estimate.
export function routeClosures(route) {
  return route.points.filter((p) => p.checks.some((c) => (c.src === 'county' || c.src === 'road-event') && c.level === 'danger'));
}
// What changed on a route since the last look. Both lists hold county or TransView place names.
export function closureChanges(previous, current) {
  const before = new Set(previous), now = new Set(current);
  return { closed: [...now].filter((x) => !before.has(x)), reopened: [...before].filter((x) => !now.has(x)) };
}
export function closureChangeMessage({ closed, reopened }, app) {
  const parts = [];
  if (closed.length) parts.push(`Road closed: ${closed.join('; ')}.`);
  if (reopened.length) parts.push(`No longer listed as closed: ${reopened.join('; ')}.`);
  return `${parts.join(' ')} Check the app before you go. ${app}`;
}
// Drivers' one-tap reports, newest first per crossing, dropped after six hours.
export const DRIVE_REPORT_MS = 6 * 3600000;
export function driveSummary(reports, fpId, now) {
  const recent = (reports ?? []).filter((r) => r.fp === fpId && (r.state === 'water' || r.state === 'clear') && now - r.at >= 0 && now - r.at < DRIVE_REPORT_MS).sort((a, b) => b.at - a.at);
  if (!recent.length) return null;
  return { state: recent[0].state, at: recent[0].at, water: recent.filter((r) => r.state === 'water').length, clear: recent.filter((r) => r.state === 'clear').length };
}
export function recommend(rated) {
  const score=r=>r.score??routeScore(r)??5;
  const blocked=r=>routeClosures(r).length?1:0;
  const unresolved=c=>c.roadStatus==='unknown'||((c.bridgeClearance==='unknown'||c.upstream===true)&&c.level!=='ok');
  const order = [...rated].sort((a, b) => blocked(a)-blocked(b) || score(a)-score(b) || rank(a.level)-rank(b.level) || a.minutes-b.minutes);
  const best = order[0];
  return { best, clear: best && score(best)<=2 && rank(best.level) <= rank('watch') && !best.points.some(p=>p.evidenceAvailable===false || p.checks.some(unresolved)), order };
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
function baseRiskScore(result) {
  switch (result.level) {
    case 'ok': return 1;
    case 'watch': return 2;
    case 'caution': return result.checks.filter((c) => c.level === 'caution' || c.level === 'danger').length >= 2 ? 4 : 3;
    case 'danger': return 5;
    default: return null;
  }
}
const bridgePoints = p => p.checks.reduce((sum,c)=>sum+(c.bridgePoints??0),0);
export function riskScore(result) {
  const base=baseRiskScore(result);
  return base==null?null:Math.min(5,base+bridgePoints(result));
}
export function routeScore(route) {
  if (route.level === 'unknown') return null;
  // Count each crossing's bridge contribution once, even if another warning already sets the baseline.
  const baseline=Math.max(...route.points.map(p=>(baseRiskScore(p)??1)+(p.handAdd??0)),1);
  return Math.min(5,baseline+route.points.reduce((sum,p)=>sum+bridgePoints(p),0));
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
  if (ok.some((c) => c.src === 'county' && !c.staleOpen)) add('county barricades on it are marked Open');
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

