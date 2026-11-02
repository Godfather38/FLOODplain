if (typeof URLSearchParams === "undefined") {
  globalThis.URLSearchParams = class {
    constructor(o) {
      this.o = o || {};
    }
    toString() {
      return Object.keys(this.o).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(this.o[k])).join("&");
    }
  };
}
const SOURCES = {
  usgs: "https://api.waterdata.usgs.gov/ogcapi/v1",
  // Pima County DOT flood barricade points with live status (Open / Proceed with Caution / Closed).
  closures: "https://services2.arcgis.com/UTBp78iglGpbqp1B/arcgis/rest/services/Road_Closures_viewPAG/FeatureServer/0",
  // Pima County ALERT rain + stream sensors, copied every ~10 min by .github/workflows/alert-snapshot.yml.
  alert: "https://raw.githubusercontent.com/godfather38/floodplain/data/alert.json",
  // National Weather Service warnings for a point in Avra Valley.
  nws: "https://api.weather.gov/alerts/active?point=32.41,-111.27"
};
const STALE_MS = 3 * 60 * 60 * 1e3;
const SNAPSHOT_STALE_MS = 45 * 60 * 1e3;
const USGS_SITES = {
  "09486500": { name: "Santa Cruz River at Cortaro Rd", lat: 32.3507, lon: -111.0959 },
  "09486520": { name: "Santa Cruz River at Trico Rd", lat: 32.4716, lon: -111.302 },
  "09486055": { name: "Rillito Creek at La Cholla", lat: 32.3028, lon: -111.0114 },
  "09486350": { name: "Cañada del Oro below Ina Rd", lat: 32.3362, lon: -111.0421 },
  "09487000": { name: "Brawley Wash near Three Points", lat: 32.0757, lon: -111.3387 },
  "09482500": { name: "Santa Cruz River at Tucson", lat: 32.2212, lon: -110.9818 }
};
const AREAS = [
  { id: "avra", name: "Avra Valley", hub: "Trico & El Tiro", hubAt: [32.4295, -111.3045] },
  { id: "picture-rocks", name: "Picture Rocks", hub: "Niko's & the Speedways", hubAt: [32.32782, -111.21815] }
];
const RIVER = { watchCfs: 300, cautionCfs: 3e3, dangerCfs: 1e4, earlyCfs: 1e3 };
const WASH = { bigFlowCfs: 500 };
const RAIN = {
  local: {
    // rain right over a small wash that crosses the road at grade (a dip)
    danger: { h1: 0.75, h3: 1.25 },
    caution: { h1: 0.4, h3: 0.6, h6: 0.9 },
    watch: { h1: 0.15, h3: 0.3, h6: 0.5 }
  },
  basin: {
    // rain over a whole upstream watershed (water arrives hours later)
    caution: { h3: 0.6, h6: 0.9, d1: 1.25 },
    watch: { h3: 0.3, h6: 0.5, d1: 0.75 }
  },
  road: {
    // poor road drainage (Silverbell): shallow, never "high"
    caution: { h1: 0.4, h3: 0.6 },
    watch: { h1: 0.2, h3: 0.35 }
  }
};
const RAIN_GAUGES = {
  "6110": "Avra Valley Air Park",
  "6460": "Picture Rocks Community Ctr",
  "6480": "Trico Rd north of Manville",
  "6440": "Brawley Wash at Milewide Rd",
  "6420": "Brawley Wash at Three Points",
  "6130": "Continental Reserve (Marana)",
  "6520": "El Camino del Cerro trailhead",
  "6500": "Arizona-Sonora Desert Museum",
  "6490": "Old Tucson"
};
const PR_NORTH = ["6460", "6110", "6440"];
const PR_EAST = ["6130", "6520", "6460"];
const PR_SOUTH = ["6460", "6500", "6440"];
const TUCSON_MTNS = ["6500", "6490", "6520"];
const LOCAL = ["6110", "6460", "6480"];
const BRAWLEY_BASIN = ["6440", "6420", "6460", "6480"];
const FAILURE_POINTS = [
  {
    id: "brawley-dip",
    short: "Brawley Wash dip",
    kind: "dip",
    lat: 32.39322,
    lon: -111.29459,
    routes: ["avra"],
    name: "Brawley Wash dip on Avra Valley Rd",
    where: "0.55 mi east of Trico Rd",
    rain: { local: LOCAL, basin: BRAWLEY_BASIN },
    wash: { alert: ["6443"], usgs: ["09487000"] }
  },
  {
    id: "elpaso-dip",
    short: "El Paso Gas Rd dip",
    kind: "dip",
    lat: 32.39329,
    lon: -111.27659,
    routes: ["avra"],
    name: "Wash dip on Avra Valley Rd near El Paso Gas Rd",
    where: "0.4 mi west of El Paso Gas Rd",
    rain: { local: LOCAL }
  },
  {
    id: "clayton-dip",
    short: "Clayton Rd dip",
    kind: "dip",
    lat: 32.40131,
    lon: -111.24501,
    routes: ["avra"],
    name: "Wash dip on Avra Valley Rd near Clayton Rd",
    where: "0.55 mi east of Clayton Rd, 0.65 mi west of Sanders Rd",
    rain: { local: LOCAL }
  },
  {
    id: "losrobles-bridge",
    short: "Los Robles bridge",
    kind: "bridge",
    lat: 32.43882,
    lon: -111.30426,
    routes: ["trico", "silverbell-north", "silverbell-south"],
    name: "Los Robles Wash bridge on Trico Rd",
    where: "between El Tiro Rd and Silverbell Rd",
    rain: { basin: BRAWLEY_BASIN },
    wash: { alert: ["6443"], usgs: ["09487000"] }
  },
  {
    id: "sc-trico-marana",
    short: "Trico-Marana river bridge",
    kind: "river",
    lat: 32.45369,
    lon: -111.27985,
    routes: ["trico"],
    name: "Santa Cruz bridge on Trico-Marana Rd",
    where: "the river crossing on Trico-Marana Rd",
    river: ["09486520", "09486500"]
  },
  {
    id: "sc-sanders",
    short: "Sanders Rd river bridge",
    kind: "river",
    lat: 32.43488,
    lon: -111.23395,
    routes: ["silverbell-north"],
    name: "Santa Cruz bridge on Sanders Rd",
    where: "Sanders Rd north of Silverbell (Town of Marana road: no county status)",
    river: ["09486500", "09486520"]
  },
  {
    id: "sc-avra",
    short: "Avra Valley Rd river bridge",
    kind: "river",
    lat: 32.40256,
    lon: -111.14614,
    routes: ["avra", "silverbell-south", "pr-avra"],
    name: "Santa Cruz bridge on Avra Valley Rd",
    where: "just west of I-10",
    river: ["09486500"]
  },
  {
    id: "silverbell-drainage",
    short: "Silverbell drainage",
    kind: "road",
    lat: 32.43062,
    lon: -111.2725,
    routes: ["silverbell-north", "silverbell-south"],
    name: "Silverbell Rd puddling / washouts",
    where: "Silverbell between Trico Rd and Sanders Rd",
    rain: { road: ["6110", "6480"] }
  },
  // ----- Picture Rocks (hub: Sandario & Picture Rocks Rd) -----
  {
    id: "pr-sandario-pr",
    short: "Sandario dip by Picture Rocks Rd",
    kind: "dip",
    lat: 32.329,
    lon: -111.2181,
    routes: ["pr-twinpeaks", "pr-avra"],
    name: "Sandario Rd dip just north of Picture Rocks Rd",
    where: 'county barricade point "Sandario Rd north of Picture Rocks Rd"',
    rain: { local: PR_NORTH }
  },
  {
    id: "pr-sandario-ina",
    short: "Sandario dip by Ina Rd",
    kind: "dip",
    lat: 32.3353,
    lon: -111.2166,
    routes: ["pr-twinpeaks", "pr-avra"],
    name: "Sandario Rd dip south of Ina Rd",
    where: 'county barricade point "Sandario Rd south of Ina Rd"',
    rain: { local: PR_NORTH }
  },
  {
    id: "pr-sandario-magee",
    short: "Sandario dip by Magee Rd",
    kind: "dip",
    lat: 32.3519,
    lon: -111.2166,
    routes: ["pr-twinpeaks", "pr-avra"],
    name: "Sandario Rd dip south of Magee Rd",
    where: 'county barricade point "Sandario Rd south of Magee Rd"',
    rain: { local: PR_NORTH }
  },
  {
    id: "pr-sandario-emigh",
    short: "Sandario dip by Emigh Rd",
    kind: "dip",
    lat: 32.3659,
    lon: -111.2167,
    routes: ["pr-twinpeaks", "pr-avra"],
    name: "Sandario Rd dip south of Emigh Rd",
    where: 'county barricade point "Sandario Rd south of Emigh Rd"',
    rain: { local: PR_NORTH }
  },
  {
    id: "pr-picture-rocks-wash",
    short: "Picture Rocks Wash dip",
    kind: "dip",
    lat: 32.32598,
    lon: -111.12082,
    routes: ["pr-ina"],
    name: "Picture Rocks Wash dip on Picture Rocks Rd",
    where: "near Wade Rd (confirmed dip)",
    rain: { local: PR_EAST }
  },
  {
    id: "pr-ina-flat",
    short: "Ina Rd flat dip",
    kind: "flat",
    lat: 32.33758,
    lon: -111.10526,
    routes: ["pr-ina"],
    name: "Large flat dip on Ina Rd",
    where: "west of Yuma Mine Wash. Washes out; trucks and most cars usually get through",
    rain: { local: PR_EAST }
  },
  {
    id: "pr-yuma-mine",
    short: "Yuma Mine Wash dip",
    kind: "dip",
    lat: 32.33759,
    lon: -111.09519,
    routes: ["pr-ina"],
    name: "Yuma Mine Wash dip on Ina Rd",
    where: "the road drops into the wash (confirmed dip)",
    rain: { local: PR_EAST }
  },
  {
    id: "sc-ina",
    short: "Ina Rd river bridge",
    kind: "river",
    lat: 32.33759,
    lon: -111.08151,
    routes: ["pr-ina"],
    name: "Santa Cruz bridge on Ina Rd",
    where: "just west of I-10; Cañada del Oro joins here",
    river: ["09486500", "09486350"]
  },
  {
    id: "pr-twinpeaks-washes",
    short: "Twin Peaks Rd washes (not confirmed)",
    kind: "dip",
    lat: 32.3783,
    lon: -111.1487,
    routes: ["pr-twinpeaks"],
    name: "Small washes on Twin Peaks Rd (not confirmed)",
    where: "four crossings with no bridge in the map data, between Sandario and I-10",
    rain: { local: ["6130", "6110", "6460"] }
  },
  {
    id: "sc-twinpeaks",
    short: "Twin Peaks Rd river bridge",
    kind: "river",
    lat: 32.37581,
    lon: -111.11538,
    routes: ["pr-twinpeaks"],
    name: "Santa Cruz bridge on Twin Peaks Rd",
    where: "just west of I-10",
    river: ["09486500", "09486520"]
  },
  {
    id: "pr-sandario-south",
    short: "Sandario dips by Golden Gate",
    kind: "dip",
    lat: 32.2746,
    lon: -111.2183,
    routes: ["pr-gates"],
    name: "Sandario Rd dips near Golden Gate and Kinney",
    where: 'county barricade points "Sandario south of Golden Gate" and "Sandario at Kinney"',
    rain: { local: PR_SOUTH }
  },
  {
    id: "pr-kinney-javelina",
    short: "Kinney Rd at Javelina Wash",
    kind: "dip",
    lat: 32.2543,
    lon: -111.1987,
    routes: ["pr-gates"],
    name: "Kinney Rd at Javelina Wash (Tucson Mountain Park)",
    where: "county barricade points on Kinney by Mile Wide and Hohokam",
    rain: { local: TUCSON_MTNS }
  },
  {
    id: "pr-kinney-washes",
    short: "Kinney & Gates Pass washes (not confirmed)",
    kind: "dip",
    lat: 32.234,
    lon: -111.148,
    routes: ["pr-gates"],
    name: "Small washes on Kinney Rd and Gates Pass Rd (not confirmed)",
    where: "about a dozen crossings with no bridge in the map data",
    rain: { local: TUCSON_MTNS }
  },
  {
    id: "pr-speedway-washes",
    short: "Speedway washes (not confirmed)",
    kind: "dip",
    lat: 32.236,
    lon: -111.025,
    routes: ["pr-gates"],
    name: "Greasewood and Anklam Wash crossings on Speedway (not confirmed)",
    where: "west of Silverbell Rd",
    rain: { local: TUCSON_MTNS }
  },
  {
    id: "sc-speedway",
    short: "Speedway river bridge",
    kind: "river",
    lat: 32.23567,
    lon: -110.98614,
    routes: ["pr-gates"],
    name: "Santa Cruz bridge on Speedway",
    where: "just west of I-10",
    river: ["09482500"]
  }
];
const RIVER_EARLY = ["09486055", "09486350"];
const CLOSURE_RADIUS_M = 450;
const ROUTE_INFO = {
  trico: { name: "Trico-Marana", via: "Trico Rd · Trico-Marana Rd · Marana Rd" },
  "silverbell-north": { name: "Silverbell–Sanders north", via: "Trico Rd · Silverbell Rd · Sanders Rd · Marana Rd" },
  avra: { name: "Avra Valley Rd", via: "Trico Rd · Avra Valley Rd" },
  "silverbell-south": { name: "Silverbell–Sanders south", via: "Trico Rd · Silverbell Rd · Sanders Rd · Avra Valley Rd" },
  "pr-ina": { name: "Picture Rocks–Ina", via: "Picture Rocks Rd · Wade Rd · Ina Rd" },
  "pr-twinpeaks": { name: "Twin Peaks", via: "Sandario Rd · Twin Peaks Rd" },
  "pr-avra": { name: "Sandario–Avra Valley Rd", via: "Sandario Rd · Avra Valley Rd" },
  "pr-gates": { name: "Gates Pass", via: "Sandario Rd · Kinney Rd · Gates Pass Rd · Speedway" }
};
const PLACES = [
  { area: "avra", name: "Trico & El Tiro", lat: 32.4295, lon: -111.3045, side: "below" },
  { area: "avra", name: "Marana exit (I-10)", lat: 32.4611, lon: -111.217, side: "right" },
  { area: "avra", name: "Avra Valley exit (I-10)", lat: 32.4006, lon: -111.1313, side: "above-left" },
  { area: "picture-rocks", name: "Niko's & the Speedways", lat: 32.32782, lon: -111.21815, side: "below" },
  { area: "picture-rocks", name: "Ina exit", lat: 32.3389, lon: -111.0686, side: "right" },
  { area: "picture-rocks", name: "Twin Peaks exit", lat: 32.3777, lon: -111.1094, side: "right" },
  { area: "picture-rocks", name: "Avra Valley exit", lat: 32.4006, lon: -111.1313, side: "above-left" },
  { area: "picture-rocks", name: "Speedway exit", lat: 32.23, lon: -110.9827, side: "above-left" }
];
const ALERTS = { server: "https://ntfy.sh", prefix: "washwatch" };
const TEXT_API = "https://script.google.com/macros/s/AKfycbyUBBx52nXVcdFB-AFy-dXslYBOKA6XrTzxeaAadGcWZ7xeafEa_BdsljbYwp8tk_EBGg/exec";
const alertTopic = (hhmm, days, mode) => `${ALERTS.prefix}-${hhmm.replace(":", "")}-${days}-${mode}`;
const REPORT_TOPIC = "washwatch-reports-1o6j4d6";
const REPORT_QUESTIONS = [
  { id: "kind", q: "What is it?", a: ["A dip: the road goes down through the wash", "A bridge or big culvert: water goes under the road", "Flat road, no wash here", "Not sure"] },
  { id: "often", q: "When it rains hard, does water run across the road here?", a: ["Almost every big storm", "Sometimes", "Rarely", "Never seen it"] },
  { id: "depth", q: "The deepest you have seen it:", a: ["Just wet pavement", "A few inches, up to the curb", "Up to a car tire (6 to 12 inches)", "Deeper than a tire", "Never seen water here"] },
  { id: "cars", q: "When water is running, who gets through?", a: ["Any car", "Trucks and SUVs, most cars", "Only trucks", "Nobody, people turn around"] },
  { id: "lasts", q: "After the rain stops, how long until it is dry enough to drive?", a: ["Under an hour", "A few hours", "Half a day or more", "Not sure"] },
  { id: "barricade", q: "Does the county put up barricades or signs here?", a: ["Yes, often", "Sometimes", "Never seen them", "Not sure"] },
  { id: "damage", q: "Does the road get damaged here (washed-out edges, sand, rocks, potholes)?", a: ["Yes, after most storms", "Sometimes", "No", "Not sure"] }
];
const NAV = {
  trico: { via: [[32.4537, -111.2799]], ramp: [32.4611, -111.217] },
  avra: { via: [[32.3933, -111.2766]], ramp: [32.4006, -111.1313] },
  "silverbell-north": { via: [[32.43062, -111.2725], [32.4349, -111.234]], ramp: [32.4611, -111.217] },
  "silverbell-south": { via: [[32.43062, -111.2725], [32.405, -111.234]], ramp: [32.4006, -111.1313] },
  "pr-ina": { via: [[32.326, -111.13], [32.3376, -111.07]], ramp: [32.3389, -111.0686], hub: [32.32782, -111.21815] },
  "pr-twinpeaks": { via: [[32.37, -111.2167], [32.38, -111.16]], ramp: [32.3777, -111.1094], hub: [32.32782, -111.21815] },
  "pr-avra": { via: [[32.37, -111.2167], [32.4, -111.2]], ramp: [32.4006, -111.1313], hub: [32.32782, -111.21815] },
  "pr-gates": { via: [[32.247, -111.1835], [32.225, -111.1]], ramp: [32.23, -110.9827], hub: [32.32782, -111.21815] }
};
const LINKS = [
  ["Pima ALERT rain map", "https://alertmap.rfcd.pima.gov/Gmap/Gmap.html"],
  ["Pima road closures", "https://www.pima.gov/898"],
  ["NWS Tucson", "https://www.weather.gov/twc/"],
  ["AZ 511 (I-10)", "https://az511.com/"]
];
const CLOSURE_BOUNDS = [
  Math.min(...FAILURE_POINTS.map((p) => p.lon)) - 0.01,
  Math.min(...FAILURE_POINTS.map((p) => p.lat)) - 0.01,
  Math.max(...FAILURE_POINTS.map((p) => p.lon)) + 0.01,
  Math.max(...FAILURE_POINTS.map((p) => p.lat)) + 0.01
].join(",");
const BRIDGE_POLICY = { warningFraction: 0.9, roadwayFraction: 1, likelyClosedFraction: 1.1, warningPoints: 0.5, roadwayPoints: 1 };
const LEVELS = ["ok", "watch", "caution", "danger"];
const rank = (lvl) => lvl === "unknown" ? 1.5 : LEVELS.indexOf(lvl);
const worst = (levels) => levels.reduce((a, b) => rank(b) > rank(a) ? b : a, "ok");
const WINDOW_WORDS = { m10: "10 min", m30: "30 min", h1: "1 hour", h3: "3 hours", h6: "6 hours", d1: "24 hours" };
const fmtIn = (v) => `${v.toFixed(2)}"`;
const siteName = (names, id) => {
  var _a, _b, _c;
  return (_c = (_b = (_a = names[id]) == null ? void 0 : _a.name) != null ? _b : names[id]) != null ? _c : id;
};
const fmtCfs = (n) => n >= 100 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 10) / 10);
function parseContinuous(json) {
  var _a, _b, _c, _d;
  const series = {};
  for (const f of (_a = json == null ? void 0 : json.features) != null ? _a : []) {
    const p = (_b = f.properties) != null ? _b : {};
    const t = Date.parse(p.time);
    const v = Number(p.value);
    if (!p.parameter_code || !Number.isFinite(t) || p.value == null || p.value === "" || !Number.isFinite(v)) continue;
    ((_d = series[_c = p.parameter_code]) != null ? _d : series[_c] = []).push({ t, v });
  }
  for (const s of Object.values(series)) s.sort((a, b) => a.t - b.t);
  return series;
}
function ratePerHour(points, windowMs = 36e5) {
  if (!(points == null ? void 0 : points.length)) return null;
  const end = points[points.length - 1].t;
  const pts = points.filter((p) => end - p.t <= windowMs);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => (p.t - end) / 36e5);
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
function summarizeFlow(series, now, staleMs) {
  var _a;
  const q = (_a = series == null ? void 0 : series["00060"]) != null ? _a : [];
  const last = q[q.length - 1];
  if (!last || now - last.t > staleMs) return { fresh: false };
  const rate = ratePerHour(q);
  const risingFast = rate != null && last.v >= 50 && rate > Math.max(last.v * 0.5, 100);
  return { fresh: true, cfs: last.v, rate, risingFast, time: last.t };
}
function checkRiver(flows, siteIds, names, R) {
  const parts = siteIds.map((id) => ({ id, f: flows[id] })).filter((p) => {
    var _a;
    return (_a = p.f) == null ? void 0 : _a.fresh;
  });
  if (!parts.length) return { level: "unknown", why: "no live river gauge reading" };
  let out = { level: "ok", why: `river at normal level (${parts.map((p) => `${fmtCfs(p.f.cfs)} cfs`).join(", ")})` };
  for (const { id, f } of parts) {
    const at = `${fmtCfs(f.cfs)} cfs at ${siteName(names, id)}`;
    let c;
    if (f.cfs >= R.dangerCfs) c = { level: "danger", why: `${at}: above the configured high-flow threshold; overtopping at this bridge is not established` };
    else if (f.cfs >= R.cautionCfs || f.risingFast && f.cfs >= R.watchCfs) c = { level: "caution", why: `${at}${f.risingFast ? " and rising fast" : ""}: above the configured flow-warning threshold; this flow threshold does not establish bridge-specific clearance` };
    else if (f.cfs >= R.watchCfs || f.risingFast) c = { level: "watch", why: `${at}${f.risingFast ? " and rising" : ""}: elevated river flow; water level relative to this bridge is not established` };
    if (c && rank(c.level) > rank(out.level)) out = c;
  }
  return { ...out, observations: parts.map(({ id, f }) => ({ siteId: id, cfs: f.cfs, time: f.time })), detail: parts.map(({ id, f }) => siteName(names, id) + ": " + fmtCfs(f.cfs) + " cfs; observed " + (Number.isFinite(f.time) ? new Date(f.time).toISOString() : "time unavailable")).join("; ") };
}
function checkRiverEarly(flows, siteIds, names, R) {
  const running = siteIds.filter((id) => {
    var _a;
    return ((_a = flows[id]) == null ? void 0 : _a.fresh) && flows[id].cfs >= R.earlyCfs;
  });
  if (!running.length) return null;
  return { level: "watch", why: `${running.map((id) => `${siteName(names, id)} at ${fmtCfs(flows[id].cfs)} cfs`).join(", ")}: that water reaches the Santa Cruz bridges in a few hours` };
}
function checkRain(snapshot, gaugeIds, rules, names, now, staleMs) {
  var _a, _b, _c;
  const gauges = ((_a = snapshot == null ? void 0 : snapshot.rain) != null ? _a : []).filter((g) => gaugeIds.includes(g.site));
  const fresh = gauges.filter((g) => {
    var _a2;
    return g.last_rpt && !g.maintenance && Date.parse(g.last_rpt) <= now && now - Date.parse(g.last_rpt) <= Math.max(staleMs, 24 * 36e5) && Object.values((_a2 = g.in) != null ? _a2 : {}).some((v) => Number.isFinite(v) && v >= 0);
  });
  if (!fresh.length) return { level: "unknown", why: "no rain gauge reading" };
  const ageMin = snapshot.fetched_at ? (now - Date.parse(snapshot.fetched_at)) / 6e4 : 0;
  const asOf = ageMin > 45 ? ` (rain readings from ${new Date(Date.parse(snapshot.fetched_at)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" })})` : "";
  const valid = (v) => Number.isFinite(v) && v >= 0;
  const most = (w) => {
    const values = fresh.map((g) => {
      var _a2;
      return (_a2 = g.in) == null ? void 0 : _a2[w];
    }).filter(valid);
    return values.length ? Math.max(...values) : null;
  };
  const amount = (w) => most(w) == null ? "unavailable" : fmtIn(most(w));
  const detail = `last 1 h ${amount("h1")} · 3 h ${amount("h3")} · 6 h ${amount("h6")} · 24 h ${amount("d1")} (wettest of ${fresh.map((g) => {
    var _a2;
    return (_a2 = names[g.site]) != null ? _a2 : g.name;
  }).join(", ")})`;
  for (const level of ["danger", "caution", "watch"]) {
    for (const [win, limit] of Object.entries((_b = rules[level]) != null ? _b : {})) {
      const hit = fresh.filter((g) => {
        var _a2;
        return valid((_a2 = g.in) == null ? void 0 : _a2[win]) && g.in[win] >= limit;
      }).sort((a, b) => b.in[win] - a.in[win])[0];
      if (hit) return { level, detail, why: `${fmtIn(hit.in[win])} of rain in the last ${WINDOW_WORDS[win]} at ${(_c = names[hit.site]) != null ? _c : hit.name}${asOf}` };
    }
  }
  const h6 = most("h6");
  const required = /* @__PURE__ */ new Set(["h6", ...Object.values(rules).flatMap((rule) => Object.keys(rule))]);
  if ([...required].some((w) => most(w) == null)) return { level: "unknown", detail, why: "rain gauge readings are incomplete" + asOf };
  return { level: "ok", detail, why: (h6 > 0 ? `light rain only (${fmtIn(h6)} in the last 6 hours)` : "no rain in the last 6 hours") + asOf };
}
const WASH_RULES = { bigFlowCfs: 500 };
const MILE_M = 1609.344;
const AZ_MS = 7 * 36e5;
const azClock = (t) => {
  if (!Number.isFinite(t)) return null;
  const d = new Date(t - AZ_MS);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const milesFrom = (fp, r) => Number.isFinite(fp == null ? void 0 : fp.lat) && Number.isFinite(r.lat) && Number.isFinite(r.lon) ? metres(fp, r) / MILE_M : null;
const sensorPlace = (fp, r) => {
  const mi = milesFrom(fp, r);
  return mi == null ? "how far up the wash it sits is not in our data" : `about ${mi.toFixed(1)} mi away in a straight line`;
};
const usableFlow = (cfs, t, now, staleMs) => Number.isFinite(cfs) && cfs >= 0 && Number.isFinite(t) && t <= now && now - t <= staleMs;
function checkWash(snapshot, flows, fp, now, staleMs, names, rules) {
  var _a, _b, _c, _d, _e, _f;
  const R = rules != null ? rules : WASH_RULES;
  const wash = (_a = fp.wash) != null ? _a : {};
  const readings = [];
  for (const id of (_b = wash.alert) != null ? _b : []) {
    const s = ((_c = snapshot == null ? void 0 : snapshot.stream) != null ? _c : []).find((x) => x.site === id);
    if (s && !s.maintenance && usableFlow(s.flow_cfs, Date.parse(s.last_rpt), now, staleMs)) {
      readings.push({ id, name: s.name.replace(/ \(PT\)$/, ""), cfs: s.flow_cfs, lat: s.lat, lon: s.lon, time: Date.parse(s.last_rpt), observedAt: s.last_rpt });
    }
  }
  for (const id of (_d = wash.usgs) != null ? _d : []) {
    const f = flows[id];
    if ((f == null ? void 0 : f.fresh) && usableFlow(f.cfs, f.time, now, staleMs)) {
      readings.push({ id, name: siteName(names, id), cfs: f.cfs, risingFast: f.risingFast, lat: (_e = names[id]) == null ? void 0 : _e.lat, lon: (_f = names[id]) == null ? void 0 : _f.lon, time: f.time, observedAt: new Date(f.time).toISOString() });
    }
  }
  if (!readings.length) return { level: "unknown", why: "no wash flow sensor reading" };
  readings.sort((a, b) => b.cfs - a.cfs);
  const top = readings[0];
  const observations = readings.map((r) => ({ siteId: r.id, name: r.name, cfs: r.cfs, milesAway: milesFrom(fp, r), time: r.time, observedAt: r.observedAt }));
  const when = (r) => azClock(r.time) ? ` at ${azClock(r.time)}` : "";
  const detail = readings.map((r) => `${r.name}: ${fmtCfs(r.cfs)} cfs${when(r)}, ${sensorPlace(fp, r)}`).join("; ") + ". No rating curve, travel time or channel-loss relation between these sensors and this crossing has been established, so these numbers give no depth and no arrival time here.";
  if (top.cfs < 1) return { level: "ok", observations, detail, why: "Brawley Wash upstream is dry" };
  const at = `${fmtCfs(top.cfs)} cfs in ${top.name}`;
  const big = top.cfs >= R.bigFlowCfs || top.risingFast;
  const rising = top.risingFast ? ", rising fast" : "";
  if (fp.kind === "dip") {
    return {
      level: "watch",
      upstream: true,
      upstreamAlert: big ? "big-flow" : "running",
      upstreamCfs: top.cfs,
      observations,
      detail,
      why: `${at}${rising}, ${sensorPlace(fp, top)}: ${big ? "a big flow is running in the wash upstream of here" : "water is running in the wash upstream of here"}. Whether it reaches this crossing, when, and how deep is not established.`
    };
  }
  return { level: "unknown", contextOnly: true, upstream: true, observations, detail, why: `${at}, ${sensorPlace(fp, top)}: upstream measurement; no site-specific roadway elevation comparison is available for this bridge` };
}
const metres = (a, b) => {
  const ky = 111320;
  const kx = ky * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * ky);
};
function nearbyClosures(fp, closures, radiusM) {
  return (closures != null ? closures : []).filter((c) => metres(fp, c) <= radiusM);
}
const OPEN_STATUS = /^open\b/i;
function checkClosures(points) {
  if (!points.length) return null;
  const when = (p) => p.updated ? ` (updated ${p.updated})` : "";
  const dir = (p) => p.direction && !/^all directions$/i.test(p.direction.trim()) ? `, ${p.direction.trim().toLowerCase()}` : "";
  const said = (p) => {
    var _a;
    return ((_a = p.status) == null ? void 0 : _a.trim()) ? p.status.trim() : "no status in the county feed";
  };
  const detail = points.map((p) => `${p.location}: ${said(p)}${dir(p)}${when(p)}`).join(" · ");
  const closed = points.find((p) => /clos/i.test(p.status));
  if (closed) return { level: "danger", detail, why: `County says CLOSED: ${closed.location}${dir(closed)}${when(closed)}` };
  const careful = points.find((p) => /caution/i.test(p.status));
  if (careful) return { level: "caution", detail, why: `County says Proceed with Caution: ${careful.location}${dir(careful)}${when(careful)}` };
  const unreadable = points.filter((p) => {
    var _a, _b;
    return !OPEN_STATUS.test((_b = (_a = p.status) == null ? void 0 : _a.trim()) != null ? _b : "");
  });
  if (unreadable.length) {
    return { level: "unknown", detail, roadStatus: "unknown", why: `county barricade point status is not readable: ${unreadable.map((p) => `${p.location} says "${said(p)}"`).join(", ")}` };
  }
  return { level: "ok", detail, why: "county barricade point marked Open", official: true };
}
function checkNws(alerts, kind) {
  if (!alerts) return null;
  const names = alerts.map((a) => a.event);
  if (names.some((e) => /Flash Flood Warning/i.test(e))) {
    return { level: kind === "dip" ? "caution" : "watch", why: "NWS Flash Flood Warning in effect: flooding is happening or about to somewhere in the area" };
  }
  if (kind === "dip" && names.some((e) => /Flood (Warning|Advisory)|Flash Flood Statement/i.test(e))) {
    return { level: "watch", why: `NWS ${names.find((e) => /Flood/i.test(e))} in effect for the area` };
  }
  return null;
}
function bridgeHeightComparison(record, now, policy) {
  const road = record == null ? void 0 : record.roadwayEstimate, water = record == null ? void 0 : record.modelWater;
  if (!road || !Number.isFinite(road.elevationM)) return { status: "unavailable", reason: "Roadway elevation estimate is missing." };
  if (!water || water.quantity !== "water_surface_elevation" || water.units !== "m" || water.verticalDatum !== road.verticalDatum || JSON.stringify(water.location) !== JSON.stringify(record.location)) return { status: "unavailable", reason: "Matching water-surface elevation at this bridge in " + road.verticalDatum + " is missing." };
  if (now > Date.parse(water.validTo)) return { status: "expired", reason: "The model water forecast expired at " + water.validTo + "; a new water elevation is needed." };
  const frames = water.frames.filter((f) => Number.isFinite(f.elevationM) && Date.parse(f.time) >= now && Date.parse(f.time) >= Date.parse(water.validFrom) && Date.parse(f.time) <= Date.parse(water.validTo));
  if (!frames.length) return { status: "unavailable", reason: "No defined water-surface elevation remains in this forecast." };
  const peak = frames.reduce((a, b) => b.elevationM > a.elevationM ? b : a);
  const channel = record.channelReference;
  const channelValid = channel && Number.isFinite(channel.elevationM) && channel.verticalDatum === road.verticalDatum && channel.structureId === record.structureId && road.elevationM > channel.elevationM;
  const heightAboveChannelM = channelValid ? road.elevationM - channel.elevationM : null;
  const thresholds = channelValid && policy ? { warningM: channel.elevationM + policy.warningFraction * heightAboveChannelM, roadwayM: channel.elevationM + policy.roadwayFraction * heightAboveChannelM, likelyClosedM: channel.elevationM + policy.likelyClosedFraction * heightAboveChannelM } : null;
  const assessment = thresholds ? peak.elevationM >= thresholds.likelyClosedM ? "likely_closed" : peak.elevationM >= thresholds.roadwayM ? "roadway_concern" : peak.elevationM >= thresholds.warningM ? "warning" : "below_warning" : peak.elevationM >= road.elevationM ? "roadway_concern" : "unavailable";
  const assessmentLabel = { likely_closed: "likely closed — model estimate", roadway_concern: "modeled water reaches estimated roadway", warning: "warning — modeled water within the lower 10% roadway margin", below_warning: "modeled water below the bridge warning level", unavailable: "channel reference unavailable; percentage thresholds not computed" }[assessment];
  return { channelM: channelValid ? channel.elevationM : null, heightAboveChannelM, thresholds, assessment, assessmentLabel, status: "estimated", roadM: road.elevationM, waterM: peak.elevationM, differenceM: road.elevationM - peak.elevationM, time: peak.time, datum: road.verticalDatum, validFrom: water.validFrom, validTo: water.validTo };
}
function bridgeRiverCheck(check, record, now, policy) {
  var _a, _b, _c;
  const history = (_a = record == null ? void 0 : record.documentedHistory) != null ? _a : [];
  const heightComparison = bridgeHeightComparison(record, now, policy), modeledRoadConcern = heightComparison.status === "estimated" && heightComparison.differenceM <= 0;
  const assessedLevel = (_b = { likely_closed: "danger", roadway_concern: "caution", warning: "watch", below_warning: "ok" }[heightComparison.assessment]) != null ? _b : "unknown";
  return {
    ...check,
    level: assessedLevel,
    bridgePoints: heightComparison.assessment === "warning" ? policy.warningPoints : heightComparison.assessment === "roadway_concern" ? policy.roadwayPoints : 0,
    modeledRoadConcern,
    dischargeLevel: check.level,
    bridgeClearance: "unknown",
    why: heightComparison.status === "estimated" ? `${heightComparison.assessmentLabel}: estimated road ${heightComparison.roadM.toFixed(2)} m, modeled water ${heightComparison.waterM.toFixed(2)} m ${heightComparison.datum} at ${heightComparison.time}. Official closure status is separate.` : heightComparison.reason + " Gauge discharge is context only.",
    detail: (check.detail ? check.detail + ". " : "") + (record ? "Site-linked structure record " + record.id + ". " : "No exact structure record. ") + (history.length ? "Historical flooding is documented for this site; it is not a current closure or measured flow-to-road threshold. " : "No site-linked flooding history establishes a current road threshold. ") + ((record == null ? void 0 : record.roadwayEstimate) ? "A provisional roadway-height comparison is shown in height & history; it is not surveyed deck or underside clearance. " : "Current roadway elevation is unavailable. ") + "Clearance is unknown, not confirmed clear.",
    heightComparison,
    bridgeEvidence: { recordId: (_c = record == null ? void 0 : record.id) != null ? _c : null, historyDates: history.map((h) => h.date), clearance: "unknown" }
  };
}
function rateFailurePoint(fp, d, cfg2) {
  var _a, _b, _c, _d, _e;
  const checks = [];
  const { now } = d;
  const closurePts = nearbyClosures(fp, d.closures, cfg2.CLOSURE_RADIUS_M);
  const closure = d.closures ? checkClosures(closurePts) : null;
  if (closure) checks.push({ src: "county", ...closure });
  const nws = checkNws(d.nws, fp.kind);
  if (nws) checks.push({ src: "nws", ...nws });
  if (fp.river) {
    const river = checkRiver(d.flows, fp.river, cfg2.USGS_SITES, cfg2.RIVER);
    checks.push({ src: "river", ...["river", "bridge"].includes(fp.kind) ? bridgeRiverCheck(river, (_a = d.bridgeEvidence) == null ? void 0 : _a[fp.id], now, cfg2.BRIDGE_POLICY) : river });
    const early = checkRiverEarly(d.flows, cfg2.RIVER_EARLY, cfg2.USGS_SITES, cfg2.RIVER);
    if (early) checks.push({ src: "river-early", ...early, ...["river", "bridge"].includes(fp.kind) ? { level: "unknown", contextOnly: true, why: early.why.split(":")[0] + ": upstream readings; no site-specific travel time or roadway height comparison" } : {} });
  }
  if (fp.wash) checks.push({ src: "wash", ...checkWash(d.alert, d.flows, fp, now, cfg2.STALE_MS, cfg2.USGS_SITES, cfg2.WASH) });
  const countyReportsTheRoad = closure != null && closure.level !== "unknown";
  if (fp.wash && fp.kind === "dip" && !countyReportsTheRoad) {
    checks.push({
      src: "road-status",
      level: "unknown",
      roadStatus: "unknown",
      why: "Nothing reports this crossing itself: no sensor on the road, and no county barricade point matched here right now",
      detail: `The flow sensors listed for this crossing are up the wash from it, and no flow-to-road relation is established, so a dry or quiet reading there is not a dry road. Rain at the nearby county gauges, a county barricade point within ${cfg2.CLOSURE_RADIUS_M} m, an NWS warning and the HAND model row are the local evidence this crossing has; none of them measures water depth on the pavement.`
    });
  }
  for (const [ruleName, ids] of Object.entries((_b = fp.rain) != null ? _b : {})) {
    const c = d.alert ? checkRain(d.alert, ids, cfg2.RAIN[ruleName], cfg2.RAIN_GAUGES, now, cfg2.STALE_MS) : { level: "unknown", why: "rain gauges unreachable right now" };
    if (["bridge", "river"].includes(fp.kind) && c.level !== "unknown" && c.level !== "ok") {
      c.sourceLevel = c.level;
      c.level = "unknown";
      c.contextOnly = true;
      c.why += ": rainfall context; no bridge-specific roadway inundation established";
    }
    checks.push({ src: `rain-${ruleName}`, ...c });
  }
  const county = checks.find((c) => c.src === "county" && c.level === "caution");
  const WET = ["watch", "caution", "danger"];
  if (county && !checks.some((c) => c !== county && WET.includes(c.level) && !c.contextOnly)) {
    county.level = "watch";
    county.uncorroborated = true;
  }
  const known = checks.filter((c) => c.level !== "unknown");
  let level = known.length ? worst(known.map((c) => c.level)) : "ok";
  if (!known.length) checks.unshift({ src: "none", level: "ok", why: "No live readings right now; current road conditions are not established" });
  if ((fp.kind === "road" || fp.kind === "flat") && level === "danger" && (closure == null ? void 0 : closure.level) !== "danger") level = "caution";
  const pref = ["county", "wash", "rain-local", "river", "rain-road", "rain-basin", "river-early", "nws", "road-status"];
  const atLevel = checks.filter((c) => c.level === level && !(c.official && level === "ok"));
  atLevel.sort((a, b) => pref.indexOf(a.src) - pref.indexOf(b.src));
  const lead = (_d = (_c = atLevel[0]) != null ? _c : checks.find((c) => c.level === level)) != null ? _d : checks[0];
  return { evidenceAvailable: known.length > 0, id: fp.id, name: fp.name, short: fp.short, where: fp.where, kind: fp.kind, level, why: (_e = lead == null ? void 0 : lead.why) != null ? _e : "no data", checks, closurePts };
}
function crossingLead(result) {
  const county = result.checks.find((c) => c.src === "county" && c.level !== "unknown");
  const upstream = result.checks.find((c) => c.upstream === true && c.level !== "ok");
  const roadUnknown = result.checks.some((c) => c.roadStatus === "unknown");
  const noDepth = "That is the county reporting this road, not a measurement of how deep the water is.";
  if (county && county.level === result.level && county.level !== "ok") return `${county.why}. ${noDepth}${county.uncorroborated ? " Rain, flow and flood model show no sign of water at this road right now." : ""}`;
  if (upstream && ["watch", "unknown"].includes(result.level)) {
    return `${upstream.why}${roadUnknown ? " Nothing here reports this road, so whether you can get through is unknown." : ""}`;
  }
  if (roadUnknown && ["ok", "unknown"].includes(result.level)) {
    return "Nothing in the data reports this crossing itself. A quiet reading miles upstream is not a dry road; look as you come up on it.";
  }
  return null;
}
const ROUTE_BARRICADE_M = 40;
const roadKey = (name) => (name != null ? name : "").toLowerCase().replace(/-/g, " ").replace(/\b(north|south|east|west|n|s|e|w)\b/g, " ").replace(/\b(road|rd|boulevard|bl|blvd|street|st|avenue|av|ave|highway|hy|hwy|drive|dr|way|wy)\b/g, " ").replace(/\s+/g, " ").trim();
const barricadeRoad = (location) => roadKey((location != null ? location : "").split(/\s(?:north|south|east|west|at|between)\s(?:of\s)?/i)[0]);
function metresToLine(p, line) {
  const ky = 110574, kx = 111320 * Math.cos(p.lat * Math.PI / 180);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p.lon) * kx, ay = (line[i - 1][1] - p.lat) * ky;
    const dx = (line[i][0] - line[i - 1][0]) * kx, dy = (line[i][1] - line[i - 1][1]) * ky;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
function barricadesOnRoute(feature, closures) {
  var _a;
  const g = feature.geometry;
  if (!g || !(closures == null ? void 0 : closures.length)) return [];
  const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
  const roads = new Set(((_a = feature.properties.legs) != null ? _a : []).map((l) => roadKey(l.road)));
  return closures.filter((c) => {
    var _a2;
    return /clos|caution/i.test((_a2 = c.status) != null ? _a2 : "") && roads.has(barricadeRoad(c.location)) && lines.some((line) => metresToLine(c, line) <= ROUTE_BARRICADE_M);
  });
}
const barricadePoint = (c) => {
  const closed = /clos/i.test(c.status);
  const check = checkClosures([c]);
  const level = closed ? "danger" : "watch";
  return {
    id: `county-${c.lat}-${c.lon}`,
    short: c.location,
    name: c.location,
    where: "On this route, away from the listed crossings",
    kind: "road",
    lat: c.lat,
    lon: c.lon,
    level,
    why: check.why,
    evidenceAvailable: true,
    closurePts: [c],
    routeBarricade: true,
    checks: [{ src: "county", ...check, level, ...closed ? {} : { uncorroborated: true } }]
  };
};
function rateRoutes(routeFeatures, fpResults, fps, { closures = null, radiusM = 0 } = {}) {
  return routeFeatures.map((f) => {
    const id = f.properties.id;
    const onRoute = fps.filter((fp) => fp.routes.includes(id));
    const pts = onRoute.map((fp) => fpResults[fp.id]);
    for (const c of barricadesOnRoute(f, closures)) {
      if (!onRoute.some((fp) => metres(fp, c) <= radiusM)) pts.push(barricadePoint(c));
    }
    return { id, name: f.properties.name, minutes: f.properties.minutes, km: f.properties.km, level: worst(pts.map((p) => p.level)), points: pts };
  });
}
function recommend(rated) {
  const score = (r) => {
    var _a, _b;
    return (_b = (_a = r.score) != null ? _a : routeScore(r)) != null ? _b : 5;
  };
  const unresolved = (c) => c.roadStatus === "unknown" || (c.bridgeClearance === "unknown" || c.upstream === true) && c.level !== "ok";
  const order = [...rated].sort((a, b) => score(a) - score(b) || rank(a.level) - rank(b.level) || a.minutes - b.minutes);
  const best = order[0];
  return { best, clear: best && score(best) <= 2 && rank(best.level) <= rank("watch") && !best.points.some((p) => p.evidenceAvailable === false || p.checks.some(unresolved)), order };
}
const VALLEY_HUB = [32.4295, -111.3045];
function googleMapsUrl(nav, destination, direction = "toI10") {
  let pts;
  let dest;
  if (direction === "valley") {
    pts = [nav.ramp, ...[...nav.via].reverse()].slice(0, 3);
    dest = (nav.hub || VALLEY_HUB).join(",");
  } else {
    pts = [...nav.via, ...destination ? [nav.ramp] : []].slice(0, 3);
    dest = destination || nav.ramp.join(",");
  }
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1");
  u.searchParams.set("destination", dest);
  u.searchParams.set("waypoints", pts.map((p) => p.join(",")).join("|"));
  u.searchParams.set("travelmode", "driving");
  return u.toString();
}
function baseRiskScore(result) {
  switch (result.level) {
    case "ok":
      return 1;
    case "watch":
      return 2;
    case "caution":
      return result.checks.filter((c) => c.level === "caution" || c.level === "danger").length >= 2 ? 4 : 3;
    case "danger":
      return 5;
    default:
      return null;
  }
}
const bridgePoints = (p) => p.checks.reduce((sum, c) => {
  var _a;
  return sum + ((_a = c.bridgePoints) != null ? _a : 0);
}, 0);
function riskScore(result) {
  const base = baseRiskScore(result);
  return base == null ? null : Math.min(5, base + bridgePoints(result));
}
function routeScore(route) {
  if (route.level === "unknown") return null;
  const baseline = Math.max(...route.points.map((p) => {
    var _a, _b;
    return ((_a = baseRiskScore(p)) != null ? _a : 1) + ((_b = p.handAdd) != null ? _b : 0);
  }), 1);
  return Math.min(5, baseline + route.points.reduce((sum, p) => sum + bridgePoints(p), 0));
}
function goodSigns(route, nwsQuiet) {
  const kind = (src) => src.startsWith("rain") ? "rain" : src === "river-early" ? "river" : src;
  const checks = route.points.flatMap((p) => p.checks);
  const bad = new Set(checks.filter((c) => c.level !== "ok").map((c) => kind(c.src)));
  const ok = checks.filter((c) => c.level === "ok" && !bad.has(kind(c.src)));
  const out = [];
  const add = (t) => {
    if (!out.includes(t)) out.push(t);
  };
  if (ok.some((c) => {
    var _a;
    return c.src === "river" && ((_a = c.heightComparison) == null ? void 0 : _a.status) !== "estimated";
  })) add("the Santa Cruz is at its everyday flow");
  if (ok.some((c) => c.src === "wash")) add("Brawley Wash upstream is dry");
  const rain = ok.filter((c) => c.src.startsWith("rain"));
  if (rain.length) add(rain.every((c) => /^no rain/.test(c.why)) ? "no rain in the last 6 hours" : "only light rain lately");
  if (ok.some((c) => c.src === "county")) add("county barricades on it are marked Open");
  if (nwsQuiet) add("no weather-service flood alerts");
  return out;
}
function againstIt(route) {
  const order = { danger: 0, caution: 1, unknown: 2, watch: 3 };
  return route.points.filter((p) => p.level !== "ok").sort((a, b) => order[a.level] - order[b.level]).map((p) => ({ level: p.level, short: p.short, why: p.why }));
}
const WORD = { 1: "Low", 2: "Minor", 3: "Moderate", 4: "High", 5: "Severe" };
const RAIN_KEYS = ["m10", "m30", "h1", "h3", "h6", "d1", "d3", "d7", "d30"];
const BOX = [-111.5, 32.05, -110.95, 32.56];
function alertSnapshot(rainData, streamData, fetchedAt) {
  const inside = (d) => {
    const x = Number(d.longitude);
    const y = Number(d.latitude);
    return x >= BOX[0] && x <= BOX[2] && y >= BOX[1] && y <= BOX[3];
  };
  const ours = (d) => inside(d) && (d.source === "pima" || d.source === "pinal");
  const iso = (t) => t ? `${t}-07:00` : null;
  const num = (v) => {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > -90 ? n : null;
  };
  return {
    fetched_at: new Date(fetchedAt).toISOString(),
    rain: (rainData != null ? rainData : []).filter(ours).map((d) => ({
      site: d.site,
      name: String(d.name).trim(),
      lat: Number(d.latitude),
      lon: Number(d.longitude),
      last_rpt: iso(d.last_rpt),
      maintenance: !!d.UnderMaintenance,
      in: Object.fromEntries(RAIN_KEYS.map((k, i) => {
        var _a;
        return [k, num(((_a = d.rain) != null ? _a : [])[i])];
      }))
    })),
    stream: (streamData != null ? streamData : []).filter(ours).map((d) => ({
      site: d.site,
      name: String(d.name).trim(),
      lat: Number(d.latitude),
      lon: Number(d.longitude),
      last_rpt: iso(d.last_rpt),
      maintenance: !!d.UnderMaintenance,
      stage_ft: num(d.stage),
      flow_cfs: num(d.flow)
    }))
  };
}
function evaluate(raw, area = "avra") {
  var _a, _b, _c, _d;
  const now = raw.now;
  const flows = Object.fromEntries(Object.keys(CFG_.USGS_SITES).map((s) => {
    var _a2;
    return [s, summarizeFlow(((_a2 = raw.usgs) == null ? void 0 : _a2[s]) ? parseContinuous(raw.usgs[s]) : {}, now, CFG_.STALE_MS)];
  }));
  const closures = (_c = (_b = (_a = raw.closures) == null ? void 0 : _a.features) == null ? void 0 : _b.map((f) => {
    var _a2, _b2, _c2;
    return { location: (_a2 = f.attributes.Location) == null ? void 0 : _a2.trim(), status: (_b2 = f.attributes.Status) != null ? _b2 : "", direction: (_c2 = f.attributes.Direction) != null ? _c2 : "", updated: f.attributes.timeUpdated, lat: f.geometry.y, lon: f.geometry.x };
  })) != null ? _c : null;
  const nws = raw.nws ? ((_d = raw.nws.features) != null ? _d : []).map((f) => ({ event: f.properties.event })) : null;
  const d = { now, flows, closures, alert: raw.alert, nws };
  const fpResults = Object.fromEntries(CFG_.FAILURE_POINTS.map((fp) => [fp.id, rateFailurePoint(fp, d, cfg)]));
  const routes = raw.routes.filter((f) => {
    var _a2;
    return ((_a2 = f.properties.area) != null ? _a2 : "avra") === area;
  });
  const rated = rateRoutes(routes, fpResults, CFG_.FAILURE_POINTS, { closures, radiusM: CFG_.CLOSURE_RADIUS_M }).map((r) => ({ ...r, score: routeScore(r) }));
  const { best, order } = recommend(rated);
  const missing = [!closures && "county", !raw.alert && "rain", !Object.values(flows).some((f) => f.fresh) && "river"].filter(Boolean);
  return { rated, best, order, missing, ...message(best, order, rated, missing, now, area) };
}
function message(best, order, rated, missing, now, area = "avra") {
  var _a;
  const areaName = area === "avra" ? "" : ` (${((_a = CFG_.AREAS.find((a) => a.id === area)) != null ? _a : {}).name})`;
  const name = (r) => CFG_.ROUTE_INFO[r.id].name;
  const issue = (r) => {
    const a = againstIt(r)[0];
    return a ? `${a.short}: ${a.why}` : null;
  };
  const text = [
    `FLOODplain${areaName}: take ${name(best)} (${best.score}/5 ${WORD[best.score]}, ${Math.round(best.minutes)} min).`,
    issue(best) ? `Watch for ${issue(best)}.` : null,
    `Others: ${order.filter((r) => r !== best).map((r) => `${name(r)} ${r.score}`).join(", ")}.`,
    ...order.filter((r) => r !== best && r.score >= 4).map((r) => `${name(r)}: ${issue(r)}.`),
    missing.length ? `(No live ${missing.join("/")} data.)` : null,
    "https://godfather38.github.io/FLOODplain/"
  ].filter(Boolean).join(" ");
  return {
    at: new Date(now).toISOString(),
    text,
    sms: text.replace(/^FLOODplain(?: \(([^)]+)\))?: /, (m, ar) => ar ? `${ar}: ` : "").replace(/ https:\S+/, ""),
    spoken: text.replace(/ https:\S+/, "").replace(/(\d)\/5/g, "$1 out of 5").replace(/–/g, " and "),
    off: rated.some((r) => r.score >= 2),
    title: `FLOODplain${areaName}: ${name(best)} ${best.score}/5`
  };
}
function sourceUrls(usgsKey) {
  const q = new URLSearchParams({
    where: "1=1",
    outFields: "Location,Status,Direction,timeUpdated",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
    geometry: CFG_.CLOSURE_BOUNDS,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects"
  });
  return {
    usgs: Object.fromEntries(Object.keys(CFG_.USGS_SITES).map((s) => [s, `${CFG_.SOURCES.usgs}/collections/continuous/items?f=json&monitoring_location_id=USGS-${s}&parameter_code=00060&time=PT6H&limit=500&skipGeometry=true&properties=time,value,parameter_code` + (usgsKey ? `&api_key=${usgsKey}` : "")])),
    closures: `${CFG_.SOURCES.closures}/query?${q}`,
    rain: "https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currain.php",
    stream: "https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currentstream.php",
    nws: CFG_.SOURCES.nws
  };
}
const CFG_ = { AREAS, SOURCES, USGS_SITES, STALE_MS, SNAPSHOT_STALE_MS, RIVER, RAIN, RAIN_GAUGES, WASH, FAILURE_POINTS, RIVER_EARLY, CLOSURE_RADIUS_M, CLOSURE_BOUNDS, ROUTE_INFO };
const cfg = CFG_;
const ROUTE_FEATURES = [{ "properties": { "id": "trico", "area": "avra", "name": "Trico Rd -> Trico-Marana Rd -> Marana Rd", "minutes": 10.4, "km": 11.2, "legs": [{ "road": "North Trico Road", "km": 2.4 }, { "road": "West Trico Marana Road", "km": 3.1 }, { "road": "West Marana Road", "km": 5.6 }, { "road": "North Sandario Road", "km": 0.1 }] }, "geometry": { "type": "LineString", "coordinates": [[-111.217033, 32.4611121], [-111.2170198, 32.4607834], [-111.2170137, 32.4605612], [-111.2171656, 32.4605636], [-111.21754262336846, 32.46056379801648], [-111.2175464, 32.4605638], [-111.2178463505211, 32.46056399611018], [-111.2178523, 32.460564], [-111.21843354970922, 32.46056429485105], [-111.2184437, 32.4605643], [-111.21885841025716, 32.46056449383512], [-111.2188716, 32.4605645], [-111.2191667, 32.4605647], [-111.21923312983456, 32.460564457849934], [-111.219249, 32.4605644], [-111.21931325664575, 32.46056424075181], [-111.2193297, 32.4605642], [-111.2228255, 32.4605541], [-111.2229561, 32.4605506], [-111.2230318, 32.460545], [-111.2231082, 32.460528], [-111.2232323, 32.4604783], [-111.2233325, 32.4604123], [-111.2233805, 32.4603719], [-111.2234174, 32.4603266], [-111.2235248, 32.4601638], [-111.2238485, 32.4602657], [-111.2240598, 32.4603278], [-111.2242912, 32.4603732], [-111.2246981, 32.4604251], [-111.2250026, 32.4604416], [-111.2298774, 32.4605006], [-111.22988242541997, 32.46050064879772], [-111.2312265, 32.4605137], [-111.23122994521263, 32.46051373377224], [-111.2320018, 32.4605213], [-111.234144, 32.4605101], [-111.2406458, 32.460489], [-111.24064580217872, 32.46048899999298], [-111.2427569, 32.4604822], [-111.24275690314835, 32.46048219999272], [-111.2468626, 32.4604727], [-111.24686260136134, 32.46047269999682], [-111.2512797, 32.4604624], [-111.25546839477346, 32.46045210001285], [-111.2554684, 32.4604521], [-111.25975858985933, 32.46044160002482], [-111.2597586, 32.4604416], [-111.26115609249625, 32.46043520003436], [-111.2611561, 32.4604352], [-111.26183059381466, 32.46043210002843], [-111.2618306, 32.4604321], [-111.26216989439263, 32.46043060002479], [-111.2621699, 32.4604306], [-111.2652686, 32.4604164], [-111.26526860073378, 32.460416400001975], [-111.2665335, 32.4604198], [-111.2701399, 32.4604329], [-111.2707961691307, 32.46042923261368], [-111.2708199, 32.4604291], [-111.2720539, 32.4603968], [-111.2724817, 32.4603809], [-111.2727955, 32.4603459], [-111.2729886, 32.4603017], [-111.2732612, 32.4602297], [-111.2735197, 32.4601377], [-111.2737484, 32.4600364], [-111.2739572, 32.4599276], [-111.2741058, 32.4598327], [-111.2742517, 32.4597279], [-111.2744612, 32.4595583], [-111.2746553, 32.4593719], [-111.2750312, 32.4589641], [-111.2754713, 32.4584867], [-111.2756524, 32.4582901], [-111.2762536, 32.4576186], [-111.2766383, 32.4571973], [-111.2767003, 32.4571296], [-111.27677538825328, 32.45704757533936], [-111.2785276, 32.4551335], [-111.2787003, 32.4549465], [-111.27891612992785, 32.45471277729101], [-111.2794735, 32.4541092], [-111.2801818, 32.4533332], [-111.2811457, 32.4522806], [-111.2813312, 32.4521017], [-111.2815219, 32.4519369], [-111.2817883, 32.4517551], [-111.2820765, 32.4516042], [-111.2823746, 32.4514812], [-111.2827334, 32.4513575], [-111.283216, 32.4512715], [-111.2838521, 32.4512436], [-111.2847675, 32.4512441], [-111.2871165, 32.4512454], [-111.2876033345985, 32.4512427883489], [-111.3041729, 32.4511539], [-111.3042752, 32.4511553], [-111.304273, 32.4497453], [-111.30427299999286, 32.44974529599349], [-111.3042726, 32.4495206], [-111.30427260001066, 32.449520595408956], [-111.3042739, 32.4489604], [-111.3042739, 32.448960394160146], [-111.3042739, 32.4470223], [-111.30427390008394, 32.44702228874744], [-111.3042896, 32.4449176], [-111.3042632, 32.4440916], [-111.3042915, 32.4426226], [-111.3042849, 32.4408387], [-111.304265, 32.4390403], [-111.304262, 32.4385491], [-111.304262, 32.43777], [-111.304262, 32.43577], [-111.304262, 32.4354484], [-111.30426200113077, 32.43544835171098], [-111.30428229986646, 32.4345815057028], [-111.3042823, 32.4345815], [-111.3042685, 32.4330119], [-111.3042431, 32.4293847]] } }, { "properties": { "id": "avra", "area": "avra", "name": "Avra Valley Rd (I-10 Avra Valley exit)", "minutes": 19.5, "km": 21.1, "legs": [{ "road": "North Trico Road", "km": 4.2 }, { "road": "West Avra Valley Road", "km": 17 }] }, "geometry": { "type": "LineString", "coordinates": [[-111.3042431, 32.4293847], [-111.30424509999956, 32.42858420017488], [-111.3042451, 32.4285842], [-111.3042451, 32.42850360012584], [-111.3042451, 32.4285036], [-111.3042457, 32.4271096], [-111.3042489, 32.422103], [-111.3042209, 32.4155842], [-111.3041716, 32.4079642], [-111.3041709, 32.4078494], [-111.30417089995441, 32.40784939271221], [-111.3041484, 32.4042521], [-111.304148, 32.4040303], [-111.3041509, 32.4024586], [-111.30415091984426, 32.402455375390744], [-111.3041626, 32.4005574], [-111.30416260501896, 32.40055076672287], [-111.3041682, 32.3931562], [-111.30416775725782, 32.393136269222715], [-111.3041622, 32.3928861], [-111.3041555, 32.3926924], [-111.304134, 32.3924892], [-111.3041166, 32.3923765], [-111.3040931, 32.3922819], [-111.3040703, 32.3922134], [-111.3040113, 32.3921517], [-111.3039637, 32.3921217], [-111.303898, 32.3920702], [-111.303085, 32.392521], [-111.302317, 32.392832], [-111.3019407, 32.3929535], [-111.3016108, 32.393035], [-111.3012212, 32.3931083], [-111.3009677, 32.3931468], [-111.3005578, 32.393181], [-111.300326, 32.3931944], [-111.2992724, 32.3932039], [-111.2970498, 32.3932174], [-111.293977, 32.393225], [-111.2935241, 32.393227], [-111.2934938392966, 32.39322713366662], [-111.2909659, 32.3932383], [-111.29094743423678, 32.39323838161103], [-111.286961, 32.393256], [-111.2849078, 32.3932642], [-111.28343531513796, 32.39326749929389], [-111.283435, 32.3932675], [-111.28317733830909, 32.39326829895098], [-111.283177, 32.3932683], [-111.2809274, 32.3932806], [-111.2774677, 32.3932914], [-111.2747771, 32.3933015], [-111.2744334, 32.3933037], [-111.2743181, 32.3933074], [-111.2741344, 32.3933144], [-111.2738038, 32.3933422], [-111.2736981, 32.3933612], [-111.2734272, 32.3934042], [-111.2730517, 32.3934903], [-111.2727553, 32.3935764], [-111.2723838, 32.3937122], [-111.2720472, 32.3938708], [-111.271551, 32.3941437], [-111.2709743, 32.3944811], [-111.270761, 32.3945895], [-111.2704995, 32.3947065], [-111.2702874, 32.3947951], [-111.2700135, 32.3948816], [-111.26991970566422, 32.39490383060024], [-111.2695245, 32.3949975], [-111.2693422, 32.3950372], [-111.2690605, 32.3950847], [-111.26896120780752, 32.395087392490666], [-111.2683082, 32.3951051], [-111.2664722, 32.3951243], [-111.262986, 32.3951374], [-111.26291994539093, 32.395137546804754], [-111.2612312, 32.3951413], [-111.2607456, 32.3951457], [-111.258903, 32.3951583], [-111.2553559, 32.39515], [-111.25533180586443, 32.395150133327235], [-111.2551029, 32.3951514], [-111.2509733, 32.3951736], [-111.2505747, 32.3951991], [-111.2501697, 32.3952534], [-111.2499216, 32.3952919], [-111.2491752, 32.3954955], [-111.248502, 32.3957975], [-111.2479074, 32.3962083], [-111.247314, 32.3967659], [-111.2468402, 32.397434], [-111.2466481, 32.397868], [-111.24662926500054, 32.397930798121486], [-111.2463934, 32.3987172], [-111.24635802121544, 32.39887855195293], [-111.2462616, 32.3993183], [-111.2461854, 32.3995946], [-111.2461158, 32.3997921], [-111.2460106, 32.4000178], [-111.2459026, 32.4002428], [-111.2457301, 32.4005147], [-111.245639, 32.4006435], [-111.2454776, 32.4008541], [-111.2452799, 32.4010629], [-111.245083, 32.4012442], [-111.2449549, 32.4013473], [-111.2447387, 32.4015236], [-111.2445418, 32.4016655], [-111.2442516, 32.4018317], [-111.2440636, 32.401933], [-111.243934, 32.4019924], [-111.2437237, 32.4020836], [-111.2434617, 32.4021849], [-111.2431863, 32.402273], [-111.242842, 32.4023587], [-111.2425725, 32.4024099], [-111.2421446, 32.4024587], [-111.2417226, 32.4024812], [-111.2340256, 32.4024966], [-111.2338983, 32.4024957], [-111.2337004, 32.4024942], [-111.2331938, 32.4024991], [-111.2301964, 32.4025081], [-111.2276685, 32.4025138], [-111.2272822, 32.4025217], [-111.2270234, 32.4025432], [-111.2267565, 32.4025772], [-111.2264427, 32.402627], [-111.2260953, 32.4026814], [-111.225858, 32.4027176], [-111.225507, 32.4027443], [-111.225151, 32.4027608], [-111.22515095541901, 32.40276079701598], [-111.2248776, 32.4027425], [-111.2244271, 32.4026905], [-111.2237884, 32.4025935], [-111.2235536, 32.4025608], [-111.2233705, 32.4025426], [-111.2232525, 32.402537], [-111.2230668, 32.4025274], [-111.2228053, 32.4025274], [-111.2189421, 32.4025297], [-111.21894067567754, 32.402529700848774], [-111.217264, 32.4025307], [-111.21726371256415, 32.40253070020323], [-111.2168397, 32.402531], [-111.2162305, 32.4025466], [-111.2152783, 32.4025466], [-111.2146333, 32.4025511], [-111.2136033, 32.4025511], [-111.2104027, 32.4025599], [-111.2084197, 32.4025673], [-111.207455, 32.4025735], [-111.2054179, 32.402586], [-111.2048492, 32.4025939], [-111.20484912641692, 32.40259390079828], [-111.204121, 32.4026018], [-111.2038101, 32.4026004], [-111.2034193, 32.4026007], [-111.2026686, 32.4025905], [-111.2021415, 32.4025848], [-111.2009077, 32.4025905], [-111.1994124, 32.4025882], [-111.19941229471858, 32.40258820046177], [-111.1964941, 32.402601], [-111.1924728, 32.402613], [-111.1858468, 32.4026301], [-111.1830395, 32.4026339], [-111.1803184, 32.4026506], [-111.1777877, 32.4026688], [-111.1772164, 32.4026653], [-111.1772163523763, 32.40266529970721], [-111.1755736, 32.4026552], [-111.1738301, 32.4026586], [-111.1730556, 32.4026609], [-111.17305556449467, 32.402660900103214], [-111.1711292, 32.4026665], [-111.1695426, 32.4026722], [-111.1653067, 32.4026858], [-111.16451130008754, 32.4026804000006], [-111.1645113, 32.4026804], [-111.1634727, 32.4026733], [-111.1624131, 32.4026847], [-111.16241309979326, 32.40268470000221], [-111.1614495, 32.402695], [-111.16067190002776, 32.402696399999954], [-111.1606719, 32.4026964], [-111.1594662, 32.4026987], [-111.15846440188515, 32.40269550000602], [-111.1584644, 32.4026955], [-111.15744490383581, 32.402692300012035], [-111.1574449, 32.4026923], [-111.1572084, 32.4026947], [-111.1566755, 32.4026969], [-111.15667549998382, 32.402696900000066], [-111.1551267, 32.4027033], [-111.15385546946511, 32.40269830184582], [-111.153855, 32.4026983], [-111.1534962, 32.4026975], [-111.1533004, 32.4026839], [-111.1530587, 32.4026569], [-111.1527063, 32.4026012], [-111.15254, 32.4025593], [-111.1519395, 32.4024038], [-111.1508635, 32.4019375], [-111.1505765, 32.4018305], [-111.15035817841652, 32.401767262024094], [-111.1503445, 32.4017633], [-111.1500082, 32.4017113], [-111.1497756, 32.4016831], [-111.1495668, 32.4016703], [-111.1493179, 32.4016896], [-111.1491081, 32.4017034], [-111.1486199, 32.4017783], [-111.14834849558399, 32.40186267356073], [-111.1482963, 32.4018789], [-111.1473033, 32.4021886], [-111.1452584, 32.4028359], [-111.1451758261523, 32.40285944826426], [-111.1450985, 32.4028815], [-111.144917, 32.4029332], [-111.1446911, 32.4029964], [-111.1445071, 32.4030328], [-111.144234, 32.4030732], [-111.14422247055322, 32.403074208156276], [-111.1441265, 32.4030826], [-111.1440324, 32.4030909], [-111.1437614, 32.403092], [-111.14346, 32.4030755], [-111.1432096, 32.4030376], [-111.1429556, 32.4029946], [-111.1427149, 32.4029223], [-111.1422694, 32.4027429], [-111.141863, 32.4025066], [-111.1403691, 32.4014683], [-111.1389619, 32.4005424], [-111.1386511, 32.4003746], [-111.1382269, 32.4001701], [-111.1374692, 32.3998392], [-111.1368947, 32.3996552], [-111.1363019, 32.3994836], [-111.1356826, 32.3993476], [-111.1350754, 32.3992533], [-111.1346395, 32.3992089], [-111.1342251, 32.399201], [-111.1338013, 32.3992353], [-111.1333768, 32.3993169], [-111.1330242, 32.3994381], [-111.1329644, 32.3994619], [-111.1328789, 32.3994959], [-111.1326958, 32.3995688], [-111.13266383666715, 32.39958607522167], [-111.1326192, 32.3996102], [-111.1323939, 32.3997339], [-111.132123, 32.399922], [-111.1316411, 32.4003396], [-111.1313331, 32.4006419]] } }, { "properties": { "id": "silverbell-north", "area": "avra", "name": "Silverbell Rd -> Sanders Rd north -> Marana Rd", "minutes": 16.5, "km": 16.5, "legs": [{ "road": "North Trico Road", "km": 1.6 }, { "road": "West Silverbell Road", "km": 7.7 }, { "road": "North Sanders Road", "km": 5.5 }, { "road": "West Marana Road", "km": 1.6 }, { "road": "North Sandario Road", "km": 0.1 }] }, "geometry": { "type": "LineString", "coordinates": [[-111.3042431, 32.4293847], [-111.3042685, 32.4330119], [-111.3042823, 32.4345815], [-111.30428229986646, 32.4345815057028], [-111.30426200113077, 32.43544835171098], [-111.304262, 32.4354484], [-111.304262, 32.43577], [-111.304262, 32.43777], [-111.304262, 32.4385491], [-111.304265, 32.4390403], [-111.3042849, 32.4408387], [-111.3042915, 32.4426226], [-111.3042632, 32.4440916], [-111.30315813518958, 32.44408397753252], [-111.3031179, 32.4440837], [-111.302623, 32.4440791], [-111.30245777938428, 32.44406943169349], [-111.3023923, 32.4440656], [-111.3022019, 32.4440429], [-111.3019592, 32.4440022], [-111.2999998, 32.4435913], [-111.2985112, 32.4432744], [-111.29732965001922, 32.44301749324227], [-111.2971218, 32.4429723], [-111.2967262, 32.4428874], [-111.296289, 32.4427866], [-111.2959577, 32.4427018], [-111.29593551420125, 32.4426951408498], [-111.2956975, 32.4426237], [-111.2954341, 32.4425381], [-111.2945174, 32.4422513], [-111.2935317, 32.4419412], [-111.2930475, 32.4417737], [-111.2926988, 32.441639], [-111.2923944, 32.4414828], [-111.2920685, 32.4412712], [-111.2917534, 32.4410244], [-111.2911069, 32.4404529], [-111.2899764, 32.4394716], [-111.2896304, 32.439175], [-111.288874, 32.4385717], [-111.2883832, 32.4382163], [-111.2879299, 32.4379119], [-111.2872607, 32.4374625], [-111.2862535, 32.4368287], [-111.2809829, 32.4334885], [-111.2804854, 32.4331998], [-111.2800764, 32.4330142], [-111.2798484, 32.4329259], [-111.2795962, 32.4328427], [-111.2794152, 32.4327912], [-111.2792315, 32.4327431], [-111.2788868, 32.4326661], [-111.2786628, 32.4326214], [-111.2781505, 32.4325444], [-111.2776141, 32.4324697], [-111.2755434, 32.4321981], [-111.275294, 32.4321602], [-111.2751317, 32.4321285], [-111.2749735, 32.4320905], [-111.2748098, 32.4320373], [-111.2746704, 32.4319853], [-111.2745389, 32.4319242], [-111.2743257, 32.431811], [-111.2738925, 32.4315212], [-111.2728062, 32.4308126], [-111.2707382, 32.4295154], [-111.2698719, 32.4289794], [-111.2681365, 32.4279578], [-111.2629072, 32.4248474], [-111.2451418, 32.4149767], [-111.243782, 32.41439], [-111.2424561, 32.4139266], [-111.24229229014865, 32.413874196688916], [-111.2339354, 32.4112008], [-111.2339607, 32.4154329], [-111.2339773, 32.4169623], [-111.2339857, 32.4177385], [-111.23398570023535, 32.41773852164481], [-111.2339958, 32.4186674], [-111.23399580082788, 32.41866744750997], [-111.23401, 32.4194823], [-111.23401000080291, 32.419482349121175], [-111.2340167, 32.4198922], [-111.23401670107785, 32.41989225207954], [-111.2340189, 32.4199985], [-111.23401890084688, 32.41999855044333], [-111.234026, 32.4204214], [-111.23402600093276, 32.42042145266256], [-111.2340417, 32.4213078], [-111.23404170105965, 32.42130785341835], [-111.2340519, 32.421822], [-111.2339241, 32.428656], [-111.2339249, 32.4288769], [-111.2339448, 32.4343991], [-111.2339524, 32.4353179], [-111.2339733, 32.4358025], [-111.23397330777664, 32.43580271183899], [-111.2340282, 32.437298], [-111.2340332, 32.4375133], [-111.2340424, 32.4377687], [-111.23405139800124, 32.438020744012555], [-111.2340514, 32.4380208], [-111.234053, 32.4388066], [-111.2340533, 32.4388479], [-111.23405330000263, 32.43884790039221], [-111.2340538, 32.4389226], [-111.23405380001577, 32.43892260118273], [-111.2340653, 32.4397851], [-111.2340816, 32.4410092], [-111.2340846, 32.4412316], [-111.2340899, 32.4424065], [-111.2340982, 32.4431213], [-111.2340982, 32.4432125], [-111.23410489999951, 32.445518299830205], [-111.2341049, 32.4455183], [-111.23410589999983, 32.44588679993631], [-111.2341059, 32.4458868], [-111.2341063, 32.4460403], [-111.234106, 32.4482159], [-111.2341062, 32.4482757], [-111.2341115, 32.4505425], [-111.2341186, 32.4532447], [-111.2341187, 32.453383], [-111.2341187000004, 32.45338300018985], [-111.2341261, 32.4568736], [-111.23412610001968, 32.45687360403807], [-111.234143, 32.4603413], [-111.23414300000238, 32.46034130039951], [-111.234144, 32.4605101], [-111.2320018, 32.4605213], [-111.23122994521263, 32.46051373377224], [-111.2312265, 32.4605137], [-111.22988242541997, 32.46050064879772], [-111.2298774, 32.4605006], [-111.2250026, 32.4604416], [-111.2246981, 32.4604251], [-111.2242912, 32.4603732], [-111.2240598, 32.4603278], [-111.2238485, 32.4602657], [-111.2235248, 32.4601638], [-111.2234174, 32.4603266], [-111.2233805, 32.4603719], [-111.2233325, 32.4604123], [-111.2232323, 32.4604783], [-111.2231082, 32.460528], [-111.2230318, 32.460545], [-111.2229561, 32.4605506], [-111.2228255, 32.4605541], [-111.2193297, 32.4605642], [-111.21931325664575, 32.46056424075181], [-111.219249, 32.4605644], [-111.21923312983456, 32.460564457849934], [-111.2191667, 32.4605647], [-111.2188716, 32.4605645], [-111.21885841025716, 32.46056449383512], [-111.2184437, 32.4605643], [-111.21843354970922, 32.46056429485105], [-111.2178523, 32.460564], [-111.2178463505211, 32.46056399611018], [-111.2175464, 32.4605638], [-111.21754262336846, 32.46056379801648], [-111.2171656, 32.4605636], [-111.2170137, 32.4605612], [-111.2170198, 32.4607834], [-111.217033, 32.4611121]] } }, { "properties": { "id": "silverbell-south", "area": "avra", "name": "Silverbell Rd -> Sanders Rd south -> Avra Valley Rd east", "minutes": 19.7, "km": 20.2, "legs": [{ "road": "North Trico Road", "km": 1.6 }, { "road": "West Silverbell Road", "km": 7.7 }, { "road": "North Sanders Road", "km": 1 }, { "road": "West Avra Valley Road", "km": 9.9 }] }, "geometry": { "type": "LineString", "coordinates": [[-111.3042431, 32.4293847], [-111.3042685, 32.4330119], [-111.3042823, 32.4345815], [-111.30428229986646, 32.4345815057028], [-111.30426200113077, 32.43544835171098], [-111.304262, 32.4354484], [-111.304262, 32.43577], [-111.304262, 32.43777], [-111.304262, 32.4385491], [-111.304265, 32.4390403], [-111.3042849, 32.4408387], [-111.3042915, 32.4426226], [-111.3042632, 32.4440916], [-111.30315813518958, 32.44408397753252], [-111.3031179, 32.4440837], [-111.302623, 32.4440791], [-111.30245777938428, 32.44406943169349], [-111.3023923, 32.4440656], [-111.3022019, 32.4440429], [-111.3019592, 32.4440022], [-111.2999998, 32.4435913], [-111.2985112, 32.4432744], [-111.29732965001922, 32.44301749324227], [-111.2971218, 32.4429723], [-111.2967262, 32.4428874], [-111.296289, 32.4427866], [-111.2959577, 32.4427018], [-111.29593551420125, 32.4426951408498], [-111.2956975, 32.4426237], [-111.2954341, 32.4425381], [-111.2945174, 32.4422513], [-111.2935317, 32.4419412], [-111.2930475, 32.4417737], [-111.2926988, 32.441639], [-111.2923944, 32.4414828], [-111.2920685, 32.4412712], [-111.2917534, 32.4410244], [-111.2911069, 32.4404529], [-111.2899764, 32.4394716], [-111.2896304, 32.439175], [-111.288874, 32.4385717], [-111.2883832, 32.4382163], [-111.2879299, 32.4379119], [-111.2872607, 32.4374625], [-111.2862535, 32.4368287], [-111.2809829, 32.4334885], [-111.2804854, 32.4331998], [-111.2800764, 32.4330142], [-111.2798484, 32.4329259], [-111.2795962, 32.4328427], [-111.2794152, 32.4327912], [-111.2792315, 32.4327431], [-111.2788868, 32.4326661], [-111.2786628, 32.4326214], [-111.2781505, 32.4325444], [-111.2776141, 32.4324697], [-111.2755434, 32.4321981], [-111.275294, 32.4321602], [-111.2751317, 32.4321285], [-111.2749735, 32.4320905], [-111.2748098, 32.4320373], [-111.2746704, 32.4319853], [-111.2745389, 32.4319242], [-111.2743257, 32.431811], [-111.2738925, 32.4315212], [-111.2728062, 32.4308126], [-111.2707382, 32.4295154], [-111.2698719, 32.4289794], [-111.2681365, 32.4279578], [-111.2629072, 32.4248474], [-111.2451418, 32.4149767], [-111.243782, 32.41439], [-111.2424561, 32.4139266], [-111.24229229014865, 32.413874196688916], [-111.2339354, 32.4112008], [-111.2339059, 32.4028654], [-111.2338979, 32.4025794], [-111.2338983, 32.4024957], [-111.2337004, 32.4024942], [-111.2331938, 32.4024991], [-111.2301964, 32.4025081], [-111.2276685, 32.4025138], [-111.2272822, 32.4025217], [-111.2270234, 32.4025432], [-111.2267565, 32.4025772], [-111.2264427, 32.402627], [-111.2260953, 32.4026814], [-111.225858, 32.4027176], [-111.225507, 32.4027443], [-111.225151, 32.4027608], [-111.22515095541901, 32.40276079701598], [-111.2248776, 32.4027425], [-111.2244271, 32.4026905], [-111.2237884, 32.4025935], [-111.2235536, 32.4025608], [-111.2233705, 32.4025426], [-111.2232525, 32.402537], [-111.2230668, 32.4025274], [-111.2228053, 32.4025274], [-111.2189421, 32.4025297], [-111.21894067567754, 32.402529700848774], [-111.217264, 32.4025307], [-111.21726371256415, 32.40253070020323], [-111.2168397, 32.402531], [-111.2162305, 32.4025466], [-111.2152783, 32.4025466], [-111.2146333, 32.4025511], [-111.2136033, 32.4025511], [-111.2104027, 32.4025599], [-111.2084197, 32.4025673], [-111.207455, 32.4025735], [-111.2054179, 32.402586], [-111.2048492, 32.4025939], [-111.20484912641692, 32.40259390079828], [-111.204121, 32.4026018], [-111.2038101, 32.4026004], [-111.2034193, 32.4026007], [-111.2026686, 32.4025905], [-111.2021415, 32.4025848], [-111.2009077, 32.4025905], [-111.1994124, 32.4025882], [-111.19941229471858, 32.40258820046177], [-111.1964941, 32.402601], [-111.1924728, 32.402613], [-111.1858468, 32.4026301], [-111.1830395, 32.4026339], [-111.1803184, 32.4026506], [-111.1777877, 32.4026688], [-111.1772164, 32.4026653], [-111.1772163523763, 32.40266529970721], [-111.1755736, 32.4026552], [-111.1738301, 32.4026586], [-111.1730556, 32.4026609], [-111.17305556449467, 32.402660900103214], [-111.1711292, 32.4026665], [-111.1695426, 32.4026722], [-111.1653067, 32.4026858], [-111.16451130008754, 32.4026804000006], [-111.1645113, 32.4026804], [-111.1634727, 32.4026733], [-111.1624131, 32.4026847], [-111.16241309979326, 32.40268470000221], [-111.1614495, 32.402695], [-111.16067190002776, 32.402696399999954], [-111.1606719, 32.4026964], [-111.1594662, 32.4026987], [-111.15846440188515, 32.40269550000602], [-111.1584644, 32.4026955], [-111.15744490383581, 32.402692300012035], [-111.1574449, 32.4026923], [-111.1572084, 32.4026947], [-111.1566755, 32.4026969], [-111.15667549998382, 32.402696900000066], [-111.1551267, 32.4027033], [-111.15385546946511, 32.40269830184582], [-111.153855, 32.4026983], [-111.1534962, 32.4026975], [-111.1533004, 32.4026839], [-111.1530587, 32.4026569], [-111.1527063, 32.4026012], [-111.15254, 32.4025593], [-111.1519395, 32.4024038], [-111.1508635, 32.4019375], [-111.1505765, 32.4018305], [-111.15035817841652, 32.401767262024094], [-111.1503445, 32.4017633], [-111.1500082, 32.4017113], [-111.1497756, 32.4016831], [-111.1495668, 32.4016703], [-111.1493179, 32.4016896], [-111.1491081, 32.4017034], [-111.1486199, 32.4017783], [-111.14834849558399, 32.40186267356073], [-111.1482963, 32.4018789], [-111.1473033, 32.4021886], [-111.1452584, 32.4028359], [-111.1451758261523, 32.40285944826426], [-111.1450985, 32.4028815], [-111.144917, 32.4029332], [-111.1446911, 32.4029964], [-111.1445071, 32.4030328], [-111.144234, 32.4030732], [-111.14422247055322, 32.403074208156276], [-111.1441265, 32.4030826], [-111.1440324, 32.4030909], [-111.1437614, 32.403092], [-111.14346, 32.4030755], [-111.1432096, 32.4030376], [-111.1429556, 32.4029946], [-111.1427149, 32.4029223], [-111.1422694, 32.4027429], [-111.141863, 32.4025066], [-111.1403691, 32.4014683], [-111.1389619, 32.4005424], [-111.1386511, 32.4003746], [-111.1382269, 32.4001701], [-111.1374692, 32.3998392], [-111.1368947, 32.3996552], [-111.1363019, 32.3994836], [-111.1356826, 32.3993476], [-111.1350754, 32.3992533], [-111.1346395, 32.3992089], [-111.1342251, 32.399201], [-111.1338013, 32.3992353], [-111.1333768, 32.3993169], [-111.1330242, 32.3994381], [-111.1329644, 32.3994619], [-111.1328789, 32.3994959], [-111.1326958, 32.3995688], [-111.13266383666715, 32.39958607522167], [-111.1326192, 32.3996102], [-111.1323939, 32.3997339], [-111.132123, 32.399922], [-111.1316411, 32.4003396], [-111.1313331, 32.4006419]] } }, { "properties": { "id": "pr-ina", "area": "picture-rocks", "name": "Picture Rocks Rd -> Ina Rd", "minutes": 17.7, "km": 19.5, "legs": [{ "road": "West Picture Rocks Road", "km": 10.7 }, { "road": "North Wade Road", "km": 0.9 }, { "road": "(unnamed road)", "km": 0.1 }, { "road": "West Ina Road", "km": 7.6 }, { "road": "North Casa Grande Highway", "km": 0.2 }] }, "geometry": { "type": "MultiLineString", "coordinates": [[[-111.21815, 32.3278201], [-111.21798711791067, 32.32781261919369], [-111.2179867, 32.3278126], [-111.2177139, 32.327785], [-111.21727948420069, 32.327728476013235], [-111.2172789, 32.3277284], [-111.2165458, 32.3276057], [-111.216, 32.3275675], [-111.2149458, 32.3275842], [-111.2139002, 32.3275988], [-111.213847, 32.3275985], [-111.2133269, 32.3275792], [-111.2129286, 32.3275212], [-111.21257945623621, 32.32742730850474], [-111.2125705, 32.3274249], [-111.21209331782588, 32.327239616467196], [-111.2120907, 32.3272386], [-111.2116265, 32.3270562], [-111.2114169, 32.3269871], [-111.21141190872045, 32.32698594150014], [-111.2110886, 32.3269109], [-111.21036179827756, 32.326777418049325], [-111.2103617, 32.3267774], [-111.21026392181436, 32.32675852006578], [-111.2102633, 32.3267584], [-111.2100212, 32.326697], [-111.2096285, 32.3265856], [-111.209539, 32.3265615], [-111.20953852327033, 32.326561371457345], [-111.2088336, 32.3263713], [-111.2086653, 32.3263179], [-111.20865938356172, 32.32631622919677], [-111.2077687, 32.3260647], [-111.2075175, 32.3260198], [-111.2075057199631, 32.32601911546189], [-111.207163, 32.3259992], [-111.20715368863392, 32.32599844608287], [-111.2069728, 32.3259838], [-111.2058975, 32.3259806], [-111.2056671, 32.3259821], [-111.2054973837926, 32.32596532687775], [-111.2054961, 32.3259652], [-111.2044929, 32.3257967], [-111.2035889, 32.3256408], [-111.20358688873772, 32.32564054169574], [-111.2031879, 32.3255893], [-111.2027678, 32.3255854], [-111.20276725844761, 32.32558538837295], [-111.2025256, 32.3255802], [-111.2020485, 32.325512], [-111.2017907, 32.3254587], [-111.2010508, 32.3253401], [-111.199487, 32.3250987], [-111.1984488, 32.3249142], [-111.1977998, 32.324768], [-111.1968771, 32.3246113], [-111.1950065, 32.3243165], [-111.19437967431145, 32.32426291490127], [-111.1943795, 32.3242629], [-111.1939911, 32.3242305], [-111.1931482, 32.3240545], [-111.1922208, 32.3239187], [-111.1919805, 32.3238925], [-111.1916608, 32.3238488], [-111.1910898, 32.3237469], [-111.1907393, 32.3236628], [-111.1904436, 32.3236182], [-111.189896, 32.3235307], [-111.1891658, 32.3234368], [-111.1883638, 32.3233333], [-111.1881159, 32.3232816], [-111.1878724, 32.3232241], [-111.1875908, 32.3231481], [-111.18758859018126, 32.32314741474146], [-111.1873541, 32.3230747], [-111.187184, 32.3230329], [-111.18717787794287, 32.323031666786456], [-111.1865163, 32.3228984], [-111.1859463, 32.3228119], [-111.1853794, 32.322765], [-111.1849713, 32.3227512], [-111.1846358, 32.3227389], [-111.1843786, 32.3227274], [-111.1840484, 32.3226848], [-111.1836447, 32.3226159], [-111.18364442682268, 32.32261586357636], [-111.1830302901826, 32.32253397869102], [-111.1830297, 32.3225339], [-111.18269098050322, 32.32247484890189], [-111.1826907, 32.3224748], [-111.1822517, 32.3223782], [-111.18225016714617, 32.322377936432375], [-111.1822296, 32.3223744], [-111.1812473, 32.3221939], [-111.18124426965365, 32.3221933413328], [-111.1811578, 32.3221774], [-111.1806335, 32.322092], [-111.1806302104337, 32.32209146474298], [-111.1800306, 32.3219939], [-111.1797893, 32.321968], [-111.17978648454401, 32.32196769815487], [-111.1796298, 32.3219509], [-111.17962739459735, 32.32195063971389], [-111.1795494, 32.3219422], [-111.1792774, 32.3219134], [-111.17927591063041, 32.32191324177173], [-111.1791155, 32.3218962], [-111.1788747, 32.3218723], [-111.17887432496867, 32.32187226269773], [-111.178744, 32.3218593], [-111.178592, 32.321817], [-111.1784002, 32.3217777], [-111.1781219, 32.3216962], [-111.1778104, 32.3216096], [-111.1775015, 32.3215637], [-111.17722235277597, 32.32152250778786], [-111.1772223, 32.3215225], [-111.1769072, 32.3215307], [-111.1764187, 32.3215466], [-111.1761535, 32.3215255], [-111.1757886, 32.3214496], [-111.1753241, 32.3213345], [-111.1752043, 32.3213176], [-111.17520392287763, 32.321317546472955], [-111.1750803, 32.3213], [-111.17507998318354, 32.32129995518388], [-111.1748251, 32.3212639], [-111.17482491364234, 32.321263873590624], [-111.1744504, 32.3212108], [-111.17440700419489, 32.321204500608935], [-111.174407, 32.3212045], [-111.1734428, 32.3210627], [-111.17344279796528, 32.321062699701685], [-111.1733248, 32.3210454], [-111.173069, 32.3210078], [-111.1729923783213, 32.320998172664716], [-111.1729918, 32.3209981], [-111.1725573, 32.3209435], [-111.1723568, 32.3209115], [-111.1721848, 32.3208833], [-111.171843, 32.3207916], [-111.1715651, 32.3207301], [-111.1713723, 32.3207035], [-111.1712463, 32.3206947], [-111.17124566709026, 32.32069465544829], [-111.1711085, 32.320685], [-111.17042, 32.320721], [-111.1702749, 32.3207206], [-111.17019221019183, 32.32071576932392], [-111.1701876, 32.3207155], [-111.1700857, 32.3206993], [-111.1699622, 32.3206809], [-111.1696524, 32.3206046], [-111.1690047, 32.3204515], [-111.1682932, 32.3203233], [-111.16807150374785, 32.320280242543866], [-111.1680476, 32.3202756], [-111.16776355021958, 32.32023317639844], [-111.1677309, 32.3202283], [-111.1675024, 32.3201823], [-111.16700387815354, 32.32009749336054], [-111.1669516, 32.3200886], [-111.16689705086097, 32.320080566399525], [-111.1668416, 32.3200724], [-111.1666516, 32.3200454], [-111.16641014048928, 32.320013246819734], [-111.1663407, 32.320004], [-111.1614927, 32.3192704], [-111.1587253, 32.3188102], [-111.1556955, 32.3182995], [-111.15550880104888, 32.31829752468687], [-111.1554025, 32.3182964], [-111.1552817, 32.3183309], [-111.1551618, 32.3183901], [-111.1550281, 32.3184915], [-111.1549257, 32.3185942], [-111.1547402, 32.3189223], [-111.1546521, 32.3191359], [-111.1542964, 32.3199171], [-111.1540278, 32.3204486], [-111.15366, 32.321016], [-111.153464, 32.3212791], [-111.1532748, 32.3214087], [-111.1531019, 32.3215058], [-111.1528363, 32.3216063], [-111.1522771, 32.3217701], [-111.151493, 32.321992], [-111.150867, 32.322168], [-111.150303, 32.322343], [-111.1495422, 32.322592], [-111.14917238590597, 32.322677595430946], [-111.1490825, 32.3226984], [-111.1487325, 32.3227161], [-111.1482804, 32.3227194], [-111.1479279, 32.3227174], [-111.1475406, 32.322772], [-111.1473914, 32.3228106], [-111.1471731, 32.3229148], [-111.1465562, 32.3233058], [-111.1460091, 32.3237228], [-111.1447323, 32.3249286], [-111.1444105, 32.3251372], [-111.1441423, 32.3252278], [-111.1439744, 32.3252389], [-111.1437453, 32.3252278], [-111.1424561, 32.3249993], [-111.1420916, 32.3249605], [-111.1412936, 32.3248858], [-111.1410067, 32.3248811], [-111.1404086, 32.3249196], [-111.1400564, 32.3249938], [-111.1397112, 32.3250102], [-111.1394436, 32.3249837], [-111.1391641, 32.3249468], [-111.1382962, 32.3247157], [-111.138036, 32.3246651], [-111.1378552, 32.3246748], [-111.1376765, 32.324713], [-111.1374769, 32.3248244], [-111.1372931, 32.324965], [-111.1371095, 32.3250601], [-111.1368466, 32.3251553], [-111.1362244, 32.3252913], [-111.1356435, 32.3255611], [-111.1350749, 32.3259329], [-111.1344741, 32.326232], [-111.1337982, 32.3264949], [-111.1330579, 32.3266309], [-111.1324034, 32.3266853], [-111.131915, 32.326761], [-111.1315022, 32.3269392], [-111.130998, 32.3273381], [-111.1307297, 32.3274831], [-111.13071060250812, 32.3274831], [-111.130513, 32.3274831], [-111.1304186, 32.3274831], [-111.1301826, 32.3273018], [-111.1301397, 32.327048], [-111.1301933, 32.3266309], [-111.1301826, 32.3261776], [-111.1300431, 32.3257062], [-111.1298178, 32.3253436], [-111.1294101, 32.3251804], [-111.1276826, 32.3251595], [-111.1261296, 32.3253069], [-111.1248529, 32.3254542], [-111.1240536, 32.3256197], [-111.1231309, 32.3256219], [-111.1224201, 32.3256446], [-111.1222163, 32.325631], [-111.1219536, 32.3255249], [-111.1216746, 32.3254342], [-111.121527, 32.3254202], [-111.1213635, 32.3254523], [-111.121248, 32.3255222], [-111.1211703, 32.3256337], [-111.1210844, 32.3258962], [-111.1210066, 32.3259506], [-111.12092994130265, 32.32596886390358], [-111.1208832, 32.32598], [-111.1208203, 32.3259787], [-111.1206446, 32.3259419], [-111.1201108, 32.3256876], [-111.1200863502298, 32.325683168917], [-111.1199712, 32.3256623], [-111.1198613, 32.3256423], [-111.11984548049934, 32.32564289930917], [-111.1197214, 32.3256476], [-111.1196199, 32.3256514], [-111.11916332069073, 32.325698137063114], [-111.1190191, 32.3257129], [-111.11894888271165, 32.325720083842086], [-111.1187982, 32.3257355], [-111.11819671148173, 32.325797002737595], [-111.1180696, 32.32581], [-111.118026, 32.3258239], [-111.1177343, 32.3259166], [-111.1174367, 32.3261051], [-111.11702908058585, 32.32651059767145], [-111.11697975343024, 32.32655966806909], [-111.11696166905037, 32.32657765831605], [-111.1169372, 32.326602], [-111.1168906, 32.3266484], [-111.1168735, 32.3266654], [-111.11606409705702, 32.32747070059426], [-111.1160251, 32.3275095], [-111.1159239, 32.3276101], [-111.11569870744171, 32.32774708349168], [-111.1156635, 32.3277685], [-111.11492316967194, 32.32821880200996], [-111.1149018, 32.3282318], [-111.1143897, 32.3285438], [-111.1141966, 32.3287252], [-111.11415221540817, 32.328954487218844], [-111.114152, 32.3289556], [-111.1141474, 32.3289793], [-111.1141422, 32.329211], [-111.11415417822059, 32.32982158979473], [-111.1141542, 32.3298227], [-111.1141590790422, 32.330071232435074], [-111.1141591, 32.3300723], [-111.1141641, 32.3303246], [-111.11416524153469, 32.33034467198501], [-111.1141653, 32.3303457], [-111.11421172898045, 32.33114557647812], [-111.1142118, 32.3311468], [-111.11421279243288, 32.33130300893454], [-111.1142128, 32.3313042], [-111.1142144, 32.3315755], [-111.11421599684198, 32.3320893837077], [-111.114216, 32.3320904], [-111.11421639705578, 32.332223413686684], [-111.1142164, 32.3322244], [-111.11421689674312, 32.33236984638176], [-111.1142169, 32.3323708], [-111.11421949764332, 32.333213835163754], [-111.1142195, 32.3332146], [-111.11422149817427, 32.33388678582758], [-111.1142215, 32.3338874], [-111.1142219980564, 32.33403621925019], [-111.114222, 32.3340368], [-111.11422429872778, 32.33478368663535], [-111.1142243, 32.3347841], [-111.11422479884871, 32.33494732329545], [-111.1142248, 32.3349477], [-111.11422599908641, 32.33532970894523], [-111.114226, 32.33533], [-111.1142337994242, 32.33633052613644], [-111.1142338, 32.3363306], [-111.1142365, 32.3366712], [-111.1141549, 32.3372764], [-111.1141519, 32.3373779], [-111.114118, 32.3374404], [-111.1140178, 32.3375185], [-111.113967, 32.3375341], [-111.113796, 32.3375637], [-111.11280190261219, 32.337564499997896], [-111.1128019, 32.3375645], [-111.11228170398645, 32.337564899996934], [-111.1122817, 32.3375649], [-111.1117923052774, 32.33756529999569], [-111.1117923, 32.3375653], [-111.11111480708131, 32.33756579999477], [-111.1111148, 32.3375658], [-111.11100760736042, 32.33756589999314], [-111.1110076, 32.3375659], [-111.11060770765486, 32.33756719997512], [-111.1106077, 32.3375672], [-111.10987980803183, 32.33756969997242], [-111.1098798, 32.3375697], [-111.10959700827283, 32.337570599973674], [-111.109597, 32.3375706], [-111.10891210896844, 32.337572699972505], [-111.1089121, 32.3375727], [-111.10866630954263, 32.33757230001553], [-111.1086663, 32.3375723], [-111.10862350962022, 32.33757220002247], [-111.1086235, 32.3375722], [-111.1073079, 32.3375627], [-111.1056711, 32.3375768], [-111.10472870006852, 32.33757380000022], [-111.1047287, 32.3375738], [-111.10467830001257, 32.33757360000005], [-111.1046783, 32.3375736], [-111.10438430006958, 32.337572700000216], [-111.1043843, 32.3375727], [-111.1043189000856, 32.33757250000026], [-111.1043189, 32.3375725], [-111.10356700009663, 32.337570100000306], [-111.103567, 32.3375701], [-111.10258530012412, 32.33756700000039], [-111.1025853, 32.337567], [-111.1013146, 32.3375629], [-111.10045960826392, 32.33756399998937], [-111.1004596, 32.337564], [-111.09970431555863, 32.3375649999794], [-111.0997043, 32.337565], [-111.09920842038055, 32.33756559997534], [-111.0992084, 32.3375656], [-111.09833922881697, 32.33756669996353], [-111.0983392, 32.3375667], [-111.09759701323618, 32.33757609983236], [-111.097597, 32.3375761], [-111.0969662, 32.3375841], [-111.0951875, 32.3375863], [-111.0940332, 32.3375722], [-111.0922077, 32.3375679], [-111.0916948, 32.3375667], [-111.09033850015669, 32.33755150000175], [-111.0903385, 32.3375515], [-111.0903059, 32.3375511], [-111.0902073, 32.3376188], [-111.0888983, 32.3376316], [-111.0884954, 32.3376335], [-111.08849479560514, 32.337633506094136], [-111.0883268, 32.3376352], [-111.088143, 32.3376414], [-111.0880329005365, 32.337640300005354], [-111.0880329, 32.3376403], [-111.0879886, 32.3376402], [-111.08607214384428, 32.33763400014184], [-111.0860721, 32.337634], [-111.08483210726615, 32.337613400120716], [-111.0848321, 32.3376134], [-111.0837052, 32.3375947], [-111.08370517392055, 32.33759469972131], [-111.0831718, 32.337589], [-111.0830265, 32.3375875], [-111.0822267, 32.3375856], [-111.0801129, 32.3375859], [-111.07966235232841, 32.33758430018581], [-111.0796623, 32.3375843], [-111.0793655589916, 32.337584999860866], [-111.0793655, 32.337585], [-111.07666164271016, 32.33761849947084], [-111.0766616, 32.3376185], [-111.07549993833159, 32.33763239954135], [-111.0754999, 32.3376324], [-111.0749437, 32.337645], [-111.07494369647708, 32.337645000029774], [-111.0749082, 32.3376453], [-111.0744300079227, 32.337644200018225], [-111.07443, 32.3376442], [-111.0742067, 32.3376467], [-111.07387410799119, 32.337650399911105], [-111.0738741, 32.3376504], [-111.07272600996194, 32.337662799892406], [-111.072726, 32.3376628], [-111.0725938, 32.3376598], [-111.0724193, 32.3376652], [-111.07241927403227, 32.3376652000768], [-111.0716754, 32.3376674], [-111.07128760143738, 32.33766859999555], [-111.0712876, 32.3376686], [-111.0704953, 32.3376735], [-111.0702217, 32.3376768], [-111.07022169602351, 32.337676799972115], [-111.069252, 32.33767], [-111.0690228, 32.3376729], [-111.06902279996338, 32.33767290000046], [-111.0678197, 32.3376881], [-111.067408, 32.3376926]], [[-111.068627, 32.3388684], [-111.0683431, 32.338605], [-111.0679599, 32.3382495], [-111.0674997, 32.3377861], [-111.06747787772004, 32.33776407842981], [-111.0674778, 32.337764], [-111.067408, 32.3376926]], [[-111.0659644, 32.3376894], [-111.0661222, 32.337688], [-111.0670915, 32.3376891], [-111.067408, 32.3376926]], [[-111.0659644, 32.3376894], [-111.0661222, 32.337688], [-111.0670915, 32.3376891], [-111.067408, 32.3376926]], [[-111.0631151, 32.3376856], [-111.0636493, 32.3376891], [-111.0646727, 32.3376897], [-111.0655151, 32.3376919], [-111.0658069, 32.3376892], [-111.0659644, 32.3376894]], [[-111.0631151, 32.3376856], [-111.0636493, 32.3376891], [-111.0646727, 32.3376897], [-111.0655151, 32.3376919], [-111.0658069, 32.3376892], [-111.0659644, 32.3376894]], [[-111.0622908, 32.3376877], [-111.0631151, 32.3376856]], [[-111.0622908, 32.3376877], [-111.0631151, 32.3376856]], [[-111.0621080005752, 32.33768949999434], [-111.0622908, 32.3376877]], [[-111.0621080005752, 32.33768949999434], [-111.0622908, 32.3376877]], [[-111.06181499935745, 32.33768609999271], [-111.061815, 32.3376861], [-111.062108, 32.3376895], [-111.0621080005752, 32.33768949999434]], [[-111.06181499935745, 32.33768609999271], [-111.061815, 32.3376861], [-111.062108, 32.3376895], [-111.0621080005752, 32.33768949999434]], [[-111.06155049855455, 32.337683099983515], [-111.0615505, 32.3376831], [-111.06181499935745, 32.33768609999271]], [[-111.06155049855455, 32.337683099983515], [-111.0615505, 32.3376831], [-111.06181499935745, 32.33768609999271]], [[-111.06104189685122, 32.33767729999181], [-111.0610419, 32.3376773], [-111.06155049855455, 32.337683099983515]], [[-111.06104189685122, 32.33767729999181], [-111.0610419, 32.3376773], [-111.06155049855455, 32.337683099983515]], [[-111.0608882, 32.3376769], [-111.06104189685122, 32.33767729999181]], [[-111.0608882, 32.3376769], [-111.06104189685122, 32.33767729999181]], [[-111.0592168, 32.3376728], [-111.0606971, 32.3376764], [-111.0608882, 32.3376769]], [[-111.0592168, 32.3376728], [-111.0606971, 32.3376764], [-111.0608882, 32.3376769]], [[-111.05849630003547, 32.3376688000002], [-111.0592168, 32.3376728]], [[-111.05849630003547, 32.3376688000002], [-111.0592168, 32.3376728]], [[-111.0583374, 32.3376679], [-111.0584963, 32.3376688], [-111.05849630003547, 32.3376688000002]], [[-111.0583374, 32.3376679], [-111.0584963, 32.3376688], [-111.05849630003547, 32.3376688000002]], [[-111.0575717, 32.3376671], [-111.0583374, 32.3376679]], [[-111.0575717, 32.3376671], [-111.0583374, 32.3376679]], [[-111.0568394023622, 32.33765700003258], [-111.0575717, 32.3376671]], [[-111.0568394023622, 32.33765700003258], [-111.0575717, 32.3376671]], [[-111.05616761703656, 32.33765050016484], [-111.0568394, 32.337657], [-111.0568394023622, 32.33765700003258]], [[-111.05616761703656, 32.33765050016484], [-111.0568394, 32.337657], [-111.0568394023622, 32.33765700003258]], [[-111.05564250877006, 32.33764160014864], [-111.0561676, 32.3376505], [-111.05616761703656, 32.33765050016484]], [[-111.05564250877006, 32.33764160014864], [-111.0561676, 32.3376505], [-111.05616761703656, 32.33765050016484]], [[-111.0555285, 32.3376444], [-111.0556425, 32.3376416], [-111.05564250877006, 32.33764160014864]], [[-111.0555285, 32.3376444], [-111.0556425, 32.3376416], [-111.05564250877006, 32.33764160014864]], [[-111.0553864, 32.3376449], [-111.0555285, 32.3376444]], [[-111.0553864, 32.3376449], [-111.0555285, 32.3376444]], [[-111.055278900126, 32.33764509999977], [-111.0553864, 32.3376449]], [[-111.055278900126, 32.33764509999977], [-111.0553864, 32.3376449]], [[-111.05477719886059, 32.33764509999731], [-111.0547772, 32.3376451], [-111.0552447, 32.3376445], [-111.0552789, 32.3376451], [-111.055278900126, 32.33764509999977]], [[-111.05477719886059, 32.33764509999731], [-111.0547772, 32.3376451], [-111.0552447, 32.3376445], [-111.0552789, 32.3376451], [-111.055278900126, 32.33764509999977]], [[-111.05405789940018, 32.337643399998626], [-111.0540579, 32.3376434], [-111.05477719886059, 32.33764509999731]], [[-111.05405789940018, 32.337643399998626], [-111.0540579, 32.3376434], [-111.05477719886059, 32.33764509999731]], [[-111.0533134, 32.3376417], [-111.05405789940018, 32.337643399998626]], [[-111.0533134, 32.3376417], [-111.05405789940018, 32.337643399998626]], [[-111.0527004, 32.3376421], [-111.0531438, 32.3376418], [-111.0533134, 32.3376417]], [[-111.0527004, 32.3376421], [-111.0531438, 32.3376418], [-111.0533134, 32.3376417]], [[-111.05215290698236, 32.33763750005866], [-111.0527004, 32.3376421]], [[-111.05215290698236, 32.33763750005866], [-111.0527004, 32.3376421]], [[-111.0520479, 32.3376398], [-111.0521529, 32.3376375], [-111.05215290698236, 32.33763750005866]], [[-111.0520479, 32.3376398], [-111.0521529, 32.3376375], [-111.05215290698236, 32.33763750005866]], [[-111.05072710014657, 32.33763600000042], [-111.0520479, 32.3376398]], [[-111.05072710014657, 32.33763600000042], [-111.0520479, 32.3376398]], [[-111.05072710014657, 32.33763600000042], [-111.0507271, 32.337636], [-111.0501021, 32.3376335], [-111.05010209926122, 32.33763350000111], [-111.0501021, 32.3376335], [-111.0507271, 32.337636], [-111.05072710014657, 32.33763600000042]]] } }, { "properties": { "id": "pr-twinpeaks", "area": "picture-rocks", "name": "Sandario Rd -> Twin Peaks Rd", "minutes": 15.4, "km": 16.7, "legs": [{ "road": "North Sandario Road", "km": 5.9 }, { "road": "(unnamed road)", "km": 0.1 }, { "road": "West Twin Peaks Road", "km": 7.7 }, { "road": "North Silverbell Road", "km": 0 }, { "road": "West Twin Peaks Road", "km": 2.9 }, { "road": "North Casa Grande Highway", "km": 0.1 }] }, "geometry": { "type": "LineString", "coordinates": [[-111.21815, 32.3278201], [-111.2181392, 32.329338], [-111.21813920324338, 32.32933837396293], [-111.2181442, 32.3299145], [-111.21814420385448, 32.32991501411889], [-111.218151, 32.3308215], [-111.2181546, 32.3312885], [-111.2181415, 32.3315231], [-111.2181062, 32.3317225], [-111.2180403, 32.3319558], [-111.2178397, 32.3324303], [-111.2175925, 32.3329588], [-111.2173892, 32.3334098], [-111.21714204275698, 32.33395647830872], [-111.2171414, 32.3339579], [-111.2168699465951, 32.334558520510264], [-111.2168686, 32.3345615], [-111.216749, 32.334826], [-111.2166695, 32.3350459], [-111.2165853, 32.3353217], [-111.2165522, 32.3354971], [-111.2165344, 32.3357255], [-111.21653849551309, 32.336330836814305], [-111.2165385, 32.3363315], [-111.2165388980773, 32.336458586176995], [-111.2165389, 32.3364592], [-111.2165389, 32.33668207285918], [-111.2165389, 32.3366826], [-111.2165392, 32.3380407], [-111.2165359000474, 32.33824719703309], [-111.2165359, 32.3382472], [-111.2165394, 32.3387078], [-111.21653940005693, 32.338707803142654], [-111.21654469992757, 32.33900039600127], [-111.2165447, 32.3390004], [-111.2165519, 32.3396816], [-111.2165514, 32.3399605], [-111.21655139999817, 32.339960501178396], [-111.2165508, 32.3403472], [-111.21655079999502, 32.34034720287258], [-111.2165502, 32.3406935], [-111.2165502000032, 32.34069350438519], [-111.2165503, 32.3408307], [-111.21655029999125, 32.34083070503469], [-111.2165502, 32.3408883], [-111.21655020001658, 32.34088830528997], [-111.2165518, 32.3413986], [-111.21655180002689, 32.341398607079235], [-111.2165533, 32.3417935], [-111.2165532999285, 32.34179350823872], [-111.2165516, 32.3419894], [-111.21655160004083, 32.341989407157854], [-111.2165538, 32.3423751], [-111.21655379988376, 32.342375107352794], [-111.2165499, 32.3426218], [-111.2165497, 32.3431573], [-111.21654970033907, 32.34315731418801], [-111.21656449955306, 32.34377658129754], [-111.2165645, 32.3437766], [-111.2165632, 32.3444891], [-111.2165660999721, 32.34473279765631], [-111.2165661, 32.3447328], [-111.2165636, 32.3452638], [-111.21656360002041, 32.345263801437966], [-111.21656799994194, 32.34557389590882], [-111.216568, 32.3455739], [-111.21657229999883, 32.34629519980506], [-111.2165723, 32.3462952], [-111.2165723, 32.3463139], [-111.2165803, 32.3468552], [-111.2165828, 32.3476292], [-111.21658280002822, 32.347629205341114], [-111.2165852, 32.3480835], [-111.21658520003778, 32.348083507412625], [-111.2165858, 32.3482012], [-111.21658580005248, 32.34820120798634], [-111.2165892, 32.3487186], [-111.21658920016401, 32.348718609287786], [-111.21659489996489, 32.349041398011686], [-111.2165949, 32.3490414], [-111.2165947, 32.3492736], [-111.2165946, 32.3493829], [-111.21659459999343, 32.34938290079792], [-111.2165913, 32.3497842], [-111.2165952, 32.3515382], [-111.2165973, 32.3516163], [-111.2166036, 32.3548101], [-111.2166415, 32.3625413], [-111.216642, 32.3627866], [-111.216666, 32.3661728], [-111.2166723, 32.3684492], [-111.2167246, 32.3799972], [-111.2167082, 32.3800284], [-111.2166993, 32.3803138], [-111.2166793, 32.3803548], [-111.2166287, 32.3805351], [-111.2166048, 32.3805776], [-111.2165692, 32.3806161], [-111.2165353, 32.3806398], [-111.2164956, 32.3806572], [-111.2163273, 32.3806963], [-111.2162358, 32.3807139], [-111.216197, 32.3807304], [-111.2159458, 32.3807387], [-111.2159004, 32.3807534], [-111.2020236, 32.3808089], [-111.201394, 32.3807725], [-111.2009538, 32.3807165], [-111.2005434, 32.3806378], [-111.2002583, 32.3805746], [-111.1999365, 32.3804823], [-111.1996314, 32.3803769], [-111.19807704072144, 32.37976510777128], [-111.1980351, 32.3797486], [-111.1979064, 32.379704], [-111.1977521, 32.3796639], [-111.1975147, 32.3796109], [-111.1972383, 32.3795695], [-111.19696, 32.379552], [-111.1967729, 32.3795489], [-111.1965599, 32.379562], [-111.1962145, 32.3796035], [-111.1959949, 32.3796497], [-111.1957433, 32.3797197], [-111.1954433, 32.3798329], [-111.1951973, 32.3799516], [-111.194895, 32.3801367], [-111.19483657235821, 32.38017908748543], [-111.1947034, 32.3802757], [-111.1944905, 32.3804748], [-111.1943432, 32.3806283], [-111.1941998, 32.3808033], [-111.1933876, 32.3819882], [-111.19335501107454, 32.38202919800539], [-111.1932787, 32.3821252], [-111.1931583, 32.3822613], [-111.1930046, 32.3824107], [-111.1928783, 32.3825233], [-111.1927389, 32.3826331], [-111.1925083, 32.3827719], [-111.192312, 32.3828845], [-111.1920897, 32.3829815], [-111.1918786, 32.3830644], [-111.1915489, 32.3831489], [-111.1912711, 32.3832005], [-111.190982, 32.3832382], [-111.1908174, 32.3832476], [-111.1905998, 32.3832424], [-111.1905063, 32.3832348], [-111.1902766, 32.3832067], [-111.1899507, 32.3831551], [-111.1896914, 32.3830816], [-111.1895171, 32.3830258], [-111.1893747, 32.3829627], [-111.189129, 32.382857], [-111.1888561, 32.3826859], [-111.188608, 32.3825104], [-111.1876467, 32.3816928], [-111.1873041, 32.3814441], [-111.1871597, 32.3813534], [-111.18693, 32.381222], [-111.1866735, 32.3811102], [-111.1863216, 32.380989], [-111.1860022, 32.3809162], [-111.1857577, 32.3808826], [-111.185369, 32.3808616], [-111.1851273, 32.3808521], [-111.1831266, 32.3808495], [-111.176936, 32.3808594], [-111.1743025, 32.3808657], [-111.1722491, 32.3808718], [-111.1698496, 32.380893], [-111.16977908326493, 32.380893524756175], [-111.1678339, 32.380908], [-111.1655407, 32.3809414], [-111.16552847252757, 32.38094153530455], [-111.164637, 32.3809514], [-111.1644685, 32.3809873], [-111.1635026, 32.3809894], [-111.1633885, 32.3809907], [-111.1600018, 32.3810133], [-111.1595734, 32.3809944], [-111.1593321, 32.3809759], [-111.1592357, 32.3809684], [-111.1589581, 32.3809352], [-111.1585963, 32.3808756], [-111.1580698, 32.3807569], [-111.1564585, 32.3803044], [-111.1558751, 32.3801372], [-111.1553382, 32.3799924], [-111.1552334, 32.3799661], [-111.1536396, 32.3795398], [-111.1504687, 32.3787164], [-111.1486831, 32.3782503], [-111.1480205, 32.3780704], [-111.1475851, 32.377945], [-111.14709, 32.377792], [-111.14652999521671, 32.37759552885016], [-111.1464578, 32.3775702], [-111.1460348, 32.3773997], [-111.1452984, 32.3770929], [-111.1448017, 32.376864], [-111.1445071, 32.3767238], [-111.1442458, 32.3765991], [-111.1439286, 32.3764351], [-111.1435953, 32.3762747], [-111.1433079, 32.3761447], [-111.1430795, 32.3760409], [-111.1428583, 32.3759348], [-111.1426984, 32.3758574], [-111.1424057, 32.3757181], [-111.1410017, 32.3750828], [-111.1405167, 32.3748548], [-111.1401856, 32.374689], [-111.1399774, 32.3745485], [-111.1398599, 32.3744502], [-111.1397338, 32.3743192], [-111.1396584, 32.3742298], [-111.1395579, 32.374097], [-111.1391932, 32.3734801], [-111.1391334, 32.3733681], [-111.13905229793608, 32.3734006206308], [-111.1390521, 32.3734007], [-111.138771, 32.3735299], [-111.1373256, 32.3741409], [-111.13732466456766, 32.37414129038787], [-111.1358649, 32.3747505], [-111.1356374, 32.3748404], [-111.1352129, 32.3750072], [-111.1348476, 32.3751271], [-111.1347379, 32.3751571], [-111.13472390908143, 32.375160994416746], [-111.1343517, 32.3752646], [-111.1340611, 32.37533], [-111.13404564412019, 32.375333271351955], [-111.133754, 32.375395], [-111.1333562, 32.3754573], [-111.1330141, 32.3754958], [-111.13300366614824, 32.375496450548745], [-111.1322234, 32.3755451], [-111.1319103, 32.3755468], [-111.13179, 32.3755441], [-111.1313484, 32.3755245], [-111.130975, 32.3754913], [-111.130536, 32.3754386], [-111.1298969, 32.3753667], [-111.1275659, 32.375087], [-111.1275319, 32.3750829], [-111.12753185153355, 32.37508289458476], [-111.1273887, 32.3750669], [-111.12724222002224, 32.37505030226873], [-111.1272422, 32.3750503], [-111.12653031598414, 32.37496961314596], [-111.1265302, 32.3749696], [-111.12544655325873, 32.37484200627094], [-111.1254465, 32.374842], [-111.1248057, 32.3747662], [-111.123912, 32.3746575], [-111.1232326, 32.3745787], [-111.1232012, 32.3745755], [-111.1220394, 32.3744383], [-111.1218793, 32.3744194], [-111.1208989, 32.3743132], [-111.1205928, 32.3742939], [-111.1203097, 32.3742927], [-111.1197545, 32.3743166], [-111.1195861, 32.3743297], [-111.1189714, 32.3744174], [-111.1185492, 32.3745024], [-111.1182868, 32.3745653], [-111.11803186898743, 32.37464081189164], [-111.1180022, 32.3746496], [-111.117854, 32.3746989], [-111.1175557, 32.3748114], [-111.117348, 32.3748975], [-111.1168786, 32.3751161], [-111.1165492, 32.3752723], [-111.1158646, 32.3755929], [-111.1135648, 32.3766524], [-111.1128189, 32.3770082], [-111.11279386787638, 32.37702117961965], [-111.1127919, 32.3770222], [-111.112626, 32.3771077], [-111.112458, 32.3771925], [-111.11244829573361, 32.37719739748023], [-111.1124473, 32.3771979], [-111.1124251, 32.3772092], [-111.1114323, 32.3777688], [-111.1111575, 32.3779185], [-111.1102073, 32.3784373], [-111.11017991303451, 32.37845249347556], [-111.110179, 32.378453], [-111.1100534, 32.3785302], [-111.1099768, 32.3784228], [-111.10997583837062, 32.37842162239763], [-111.1096531, 32.3780264], [-111.1093667, 32.3777067]] } }, { "properties": { "id": "pr-avra", "area": "picture-rocks", "name": "Sandario Rd -> Avra Valley Rd", "minutes": 15.3, "km": 16.6, "legs": [{ "road": "North Sandario Road", "km": 5.9 }, { "road": "North Sandario Road;West Twin Peaks Road", "km": 0 }, { "road": "North Sandario Road", "km": 2.4 }, { "road": "West Avra Valley Road", "km": 8.3 }] }, "geometry": { "type": "LineString", "coordinates": [[-111.21815, 32.3278201], [-111.2181392, 32.329338], [-111.21813920324338, 32.32933837396293], [-111.2181442, 32.3299145], [-111.21814420385448, 32.32991501411889], [-111.218151, 32.3308215], [-111.2181546, 32.3312885], [-111.2181415, 32.3315231], [-111.2181062, 32.3317225], [-111.2180403, 32.3319558], [-111.2178397, 32.3324303], [-111.2175925, 32.3329588], [-111.2173892, 32.3334098], [-111.21714204275698, 32.33395647830872], [-111.2171414, 32.3339579], [-111.2168699465951, 32.334558520510264], [-111.2168686, 32.3345615], [-111.216749, 32.334826], [-111.2166695, 32.3350459], [-111.2165853, 32.3353217], [-111.2165522, 32.3354971], [-111.2165344, 32.3357255], [-111.21653849551309, 32.336330836814305], [-111.2165385, 32.3363315], [-111.2165388980773, 32.336458586176995], [-111.2165389, 32.3364592], [-111.2165389, 32.33668207285918], [-111.2165389, 32.3366826], [-111.2165392, 32.3380407], [-111.2165359000474, 32.33824719703309], [-111.2165359, 32.3382472], [-111.2165394, 32.3387078], [-111.21653940005693, 32.338707803142654], [-111.21654469992757, 32.33900039600127], [-111.2165447, 32.3390004], [-111.2165519, 32.3396816], [-111.2165514, 32.3399605], [-111.21655139999817, 32.339960501178396], [-111.2165508, 32.3403472], [-111.21655079999502, 32.34034720287258], [-111.2165502, 32.3406935], [-111.2165502000032, 32.34069350438519], [-111.2165503, 32.3408307], [-111.21655029999125, 32.34083070503469], [-111.2165502, 32.3408883], [-111.21655020001658, 32.34088830528997], [-111.2165518, 32.3413986], [-111.21655180002689, 32.341398607079235], [-111.2165533, 32.3417935], [-111.2165532999285, 32.34179350823872], [-111.2165516, 32.3419894], [-111.21655160004083, 32.341989407157854], [-111.2165538, 32.3423751], [-111.21655379988376, 32.342375107352794], [-111.2165499, 32.3426218], [-111.2165497, 32.3431573], [-111.21654970033907, 32.34315731418801], [-111.21656449955306, 32.34377658129754], [-111.2165645, 32.3437766], [-111.2165632, 32.3444891], [-111.2165660999721, 32.34473279765631], [-111.2165661, 32.3447328], [-111.2165636, 32.3452638], [-111.21656360002041, 32.345263801437966], [-111.21656799994194, 32.34557389590882], [-111.216568, 32.3455739], [-111.21657229999883, 32.34629519980506], [-111.2165723, 32.3462952], [-111.2165723, 32.3463139], [-111.2165803, 32.3468552], [-111.2165828, 32.3476292], [-111.21658280002822, 32.347629205341114], [-111.2165852, 32.3480835], [-111.21658520003778, 32.348083507412625], [-111.2165858, 32.3482012], [-111.21658580005248, 32.34820120798634], [-111.2165892, 32.3487186], [-111.21658920016401, 32.348718609287786], [-111.21659489996489, 32.349041398011686], [-111.2165949, 32.3490414], [-111.2165947, 32.3492736], [-111.2165946, 32.3493829], [-111.21659459999343, 32.34938290079792], [-111.2165913, 32.3497842], [-111.2165952, 32.3515382], [-111.2165973, 32.3516163], [-111.2166036, 32.3548101], [-111.2166415, 32.3625413], [-111.216642, 32.3627866], [-111.216666, 32.3661728], [-111.2166723, 32.3684492], [-111.2167246, 32.3799972], [-111.2167462, 32.3800312], [-111.2167529, 32.3805207], [-111.216767, 32.3806441], [-111.2167695, 32.3806563], [-111.2167928, 32.3806692], [-111.2168172, 32.3806908], [-111.2168325, 32.380716], [-111.2168377, 32.3807429], [-111.2168325, 32.3807699], [-111.2168118, 32.3808008], [-111.2167777, 32.3808256], [-111.2167525, 32.3808683], [-111.2167412, 32.3809193], [-111.2167476, 32.3810998], [-111.2167532, 32.3815173], [-111.2167355, 32.3815591], [-111.2167765996068, 32.38590795839411], [-111.2167766, 32.385908], [-111.2168195, 32.3974791], [-111.216838, 32.4023869], [-111.2168397, 32.402531], [-111.2162305, 32.4025466], [-111.2152783, 32.4025466], [-111.2146333, 32.4025511], [-111.2136033, 32.4025511], [-111.2104027, 32.4025599], [-111.2084197, 32.4025673], [-111.207455, 32.4025735], [-111.2054179, 32.402586], [-111.2048492, 32.4025939], [-111.20484912641692, 32.40259390079828], [-111.204121, 32.4026018], [-111.2038101, 32.4026004], [-111.2034193, 32.4026007], [-111.2026686, 32.4025905], [-111.2021415, 32.4025848], [-111.2009077, 32.4025905], [-111.1994124, 32.4025882], [-111.19941229471858, 32.40258820046177], [-111.1964941, 32.402601], [-111.1924728, 32.402613], [-111.1858468, 32.4026301], [-111.1830395, 32.4026339], [-111.1803184, 32.4026506], [-111.1777877, 32.4026688], [-111.1772164, 32.4026653], [-111.1772163523763, 32.40266529970721], [-111.1755736, 32.4026552], [-111.1738301, 32.4026586], [-111.1730556, 32.4026609], [-111.17305556449467, 32.402660900103214], [-111.1711292, 32.4026665], [-111.1695426, 32.4026722], [-111.1653067, 32.4026858], [-111.16451130008754, 32.4026804000006], [-111.1645113, 32.4026804], [-111.1634727, 32.4026733], [-111.1624131, 32.4026847], [-111.16241309979326, 32.40268470000221], [-111.1614495, 32.402695], [-111.16067190002776, 32.402696399999954], [-111.1606719, 32.4026964], [-111.1594662, 32.4026987], [-111.15846440188515, 32.40269550000602], [-111.1584644, 32.4026955], [-111.15744490383581, 32.402692300012035], [-111.1574449, 32.4026923], [-111.1572084, 32.4026947], [-111.1566755, 32.4026969], [-111.15667549998382, 32.402696900000066], [-111.1551267, 32.4027033], [-111.15385546946511, 32.40269830184582], [-111.153855, 32.4026983], [-111.1534962, 32.4026975], [-111.1533004, 32.4026839], [-111.1530587, 32.4026569], [-111.1527063, 32.4026012], [-111.15254, 32.4025593], [-111.1519395, 32.4024038], [-111.1508635, 32.4019375], [-111.1505765, 32.4018305], [-111.15035817841652, 32.401767262024094], [-111.1503445, 32.4017633], [-111.1500082, 32.4017113], [-111.1497756, 32.4016831], [-111.1495668, 32.4016703], [-111.1493179, 32.4016896], [-111.1491081, 32.4017034], [-111.1486199, 32.4017783], [-111.14834849558399, 32.40186267356073], [-111.1482963, 32.4018789], [-111.1473033, 32.4021886], [-111.1452584, 32.4028359], [-111.1451758261523, 32.40285944826426], [-111.1450985, 32.4028815], [-111.144917, 32.4029332], [-111.1446911, 32.4029964], [-111.1445071, 32.4030328], [-111.144234, 32.4030732], [-111.14422247055322, 32.403074208156276], [-111.1441265, 32.4030826], [-111.1440324, 32.4030909], [-111.1437614, 32.403092], [-111.14346, 32.4030755], [-111.1432096, 32.4030376], [-111.1429556, 32.4029946], [-111.1427149, 32.4029223], [-111.1422694, 32.4027429], [-111.141863, 32.4025066], [-111.1403691, 32.4014683], [-111.1389619, 32.4005424], [-111.1386511, 32.4003746], [-111.1382269, 32.4001701], [-111.1374692, 32.3998392], [-111.1368947, 32.3996552], [-111.1363019, 32.3994836], [-111.1356826, 32.3993476], [-111.1350754, 32.3992533], [-111.1346395, 32.3992089], [-111.1342251, 32.399201], [-111.1338013, 32.3992353], [-111.1333768, 32.3993169], [-111.1330242, 32.3994381], [-111.1329644, 32.3994619], [-111.1328789, 32.3994959], [-111.1326958, 32.3995688], [-111.13266383666715, 32.39958607522167], [-111.1326192, 32.3996102], [-111.1323939, 32.3997339], [-111.132123, 32.399922], [-111.1316411, 32.4003396], [-111.1313331, 32.4006419]] } }, { "properties": { "id": "pr-gates", "area": "picture-rocks", "name": "Sandario Rd -> Kinney Rd -> Gates Pass -> Speedway", "minutes": 30.4, "km": 32.3, "legs": [{ "road": "North Sandario Road", "km": 6.3 }, { "road": "North Kinney Road", "km": 10.6 }, { "road": "West Gates Pass Road", "km": 7.8 }, { "road": "West Speedway Boulevard", "km": 7.5 }, { "road": "North Freeway Road", "km": 0.1 }] }, "geometry": { "type": "LineString", "coordinates": [[-110.9843155, 32.2350135], [-110.9844413, 32.2355782], [-110.98444131271468, 32.23557825336928], [-110.984457, 32.2356441], [-110.9844928, 32.2357735], [-110.98464508718125, 32.235764700740674], [-110.9846451, 32.2357647], [-110.9847634, 32.2357593], [-110.9849103, 32.2357483], [-110.9851048, 32.2357325], [-110.9851049118107, 32.23573249091109], [-110.9854308, 32.235706], [-110.9862338, 32.2356698], [-110.9863625, 32.2356659], [-110.9866756, 32.235667], [-110.9871092, 32.2356686], [-110.98710920072972, 32.2356686000027], [-110.9874879, 32.23567], [-110.98748790113368, 32.23567000000452], [-110.9875883, 32.2356704], [-110.9884054, 32.2356705], [-110.9889059, 32.2356751], [-110.9893041, 32.2356766], [-110.98930410153831, 32.23567660000553], [-110.9901376, 32.2356796], [-110.99018019627853, 32.23567979998253], [-110.9901802, 32.2356798], [-110.9902754, 32.2356813], [-110.99036849830746, 32.23568209998545], [-110.9903685, 32.2356821], [-110.991355, 32.2356948], [-110.9921883, 32.2357061], [-110.9927654, 32.2357334], [-110.99305389990415, 32.23574109999744], [-110.9930539, 32.2357411], [-110.9931331, 32.2357432], [-110.9933151, 32.2357481], [-110.99331510009209, 32.23574810000246], [-110.993937, 32.2357647], [-110.9939591, 32.2357653], [-110.994067, 32.2357682], [-110.9941741, 32.2357699], [-110.99417410304856, 32.23576989998334], [-110.994229, 32.2357696], [-110.9942476, 32.2357698], [-110.995014, 32.2357766], [-110.9962743, 32.2357636], [-110.99723329987135, 32.235753700001325], [-110.9972333, 32.2357537], [-110.9972598, 32.2357534], [-110.998563, 32.2357295], [-110.9995463, 32.2357115], [-111.0004665, 32.2356974], [-111.0014382, 32.2356825], [-111.0015330998304, 32.235681900001076], [-111.0015331, 32.2356819], [-111.00187, 32.2356797], [-111.0021032, 32.2356781], [-111.0023878, 32.235675], [-111.0028606, 32.2356732], [-111.0032857, 32.2356704], [-111.0033709, 32.2356698], [-111.00337090007281, 32.23566979999951], [-111.0039322, 32.2356661], [-111.00397019995702, 32.23566590000023], [-111.0039702, 32.2356659], [-111.003979, 32.2356658], [-111.004122, 32.2356649], [-111.0041804, 32.2356675], [-111.0042131, 32.235669], [-111.00431, 32.2356733], [-111.0043561, 32.2356725], [-111.004436, 32.235671], [-111.00445190193619, 32.23567070369063], [-111.0044521, 32.2356707], [-111.0046653, 32.2356668], [-111.00503568782771, 32.235659918804494], [-111.0050367, 32.2356599], [-111.0052706, 32.2356555], [-111.0053321, 32.2356544], [-111.0057559, 32.2356249], [-111.0062119, 32.23555], [-111.0065498, 32.2354729], [-111.00654989441101, 32.23547287457852], [-111.0071299, 32.2353167], [-111.0077427, 32.2352122], [-111.0083291, 32.2351775], [-111.008936, 32.2351867], [-111.009948, 32.2353213], [-111.01017970314992, 32.235383246343424], [-111.0101814, 32.2353837], [-111.0110731, 32.2356223], [-111.0115054, 32.2357211], [-111.01151452984394, 32.23572318494032], [-111.011963, 32.2358256], [-111.0120048, 32.2358297], [-111.01201681868568, 32.235830863317744], [-111.0127125, 32.2358982], [-111.013042, 32.2359054], [-111.01305169885738, 32.23590569906099], [-111.0136063, 32.2359228], [-111.0147606, 32.2359332], [-111.01476437077604, 32.23593321828937], [-111.0158327, 32.2359384], [-111.0192583, 32.2359352], [-111.02102389726303, 32.23593370000232], [-111.0210239, 32.2359337], [-111.0214160970816, 32.235933300002976], [-111.0214161, 32.2359333], [-111.0215595, 32.2359348], [-111.0216701, 32.2359412], [-111.02167016756924, 32.23594120045868], [-111.02469, 32.2359617], [-111.0247891, 32.2359611], [-111.0254034, 32.2359639], [-111.0261795, 32.2359747], [-111.0268862, 32.2359744], [-111.0281377, 32.2359765], [-111.0284923, 32.2359713], [-111.0287151, 32.2359681], [-111.0290565, 32.2359631], [-111.0302619, 32.235965], [-111.0324503, 32.2359673], [-111.0328307, 32.2359684], [-111.0340876, 32.235975], [-111.03456319134595, 32.235980269985646], [-111.0345659, 32.2359803], [-111.03516088697107, 32.23598683287974], [-111.035167, 32.2359869], [-111.03528915628796, 32.235988225727155], [-111.035296, 32.2359883], [-111.03551198725398, 32.23599070949636], [-111.0355201, 32.2359908], [-111.0358607, 32.2359945], [-111.03612673318592, 32.2360269852662], [-111.0361375, 32.2360283], [-111.0362025, 32.2360361], [-111.03651618458015, 32.23609197355542], [-111.036527, 32.2360939], [-111.0366243, 32.2361112], [-111.03666508065957, 32.23612165453308], [-111.0366754, 32.2361243], [-111.03673309648019, 32.23613915086916], [-111.036743, 32.2361417], [-111.0370626, 32.2362232], [-111.0376087, 32.2364111], [-111.0391413, 32.2370563], [-111.03914130550184, 32.237056302316795], [-111.0393973, 32.2371641], [-111.03939730868098, 32.23716410365409], [-111.040478, 32.237619], [-111.0410831, 32.2378411], [-111.0416122, 32.2380186], [-111.0425087, 32.2382709], [-111.0431798, 32.2384894], [-111.0433741, 32.2385568], [-111.04337998512057, 32.238558901828775], [-111.0441077, 32.2388188], [-111.0442237, 32.2388591], [-111.0444248, 32.2389226], [-111.0445704, 32.2389532], [-111.0447105, 32.2389748], [-111.044862, 32.2389856], [-111.0450485, 32.2389873], [-111.0452456, 32.2389884], [-111.04693697837526, 32.23899239923952], [-111.0469373, 32.2389924], [-111.0475125, 32.2390284], [-111.04810227998793, 32.23908231204101], [-111.0481109, 32.2390831], [-111.0494708, 32.2391784], [-111.0497551, 32.2391954], [-111.0499361, 32.239192], [-111.0501051, 32.2391829], [-111.0502687, 32.2391569], [-111.050547, 32.2390512], [-111.050744, 32.2389341], [-111.0509177, 32.238762], [-111.0510191, 32.238646], [-111.051679, 32.2378906], [-111.0529185, 32.2368311], [-111.0529939, 32.2367786], [-111.0530323938204, 32.23675102803737], [-111.0532963, 32.236562], [-111.05333393417999, 32.23653634033183], [-111.0535625, 32.2363805], [-111.0537187, 32.2362835], [-111.05375480766713, 32.236266255379995], [-111.0538481, 32.2362217], [-111.0539628, 32.2361695], [-111.0540875, 32.2361264], [-111.0542417, 32.2360839], [-111.0543239, 32.2360663], [-111.05433628794029, 32.236064980684354], [-111.0545239, 32.236045], [-111.0549577, 32.2360359], [-111.0566028, 32.2360439], [-111.0568411, 32.2360395], [-111.05684110096067, 32.23603949999849], [-111.0572885, 32.2360388], [-111.0575964, 32.2360385], [-111.0582417, 32.2360502], [-111.0582417064228, 32.23605020012744], [-111.0582669, 32.2360507], [-111.0587261, 32.2360538], [-111.05877049854426, 32.236053899996726], [-111.0587705, 32.2360539], [-111.0589763, 32.2360543], [-111.0594843, 32.2360625], [-111.0597188, 32.2360663], [-111.0601003, 32.2360658], [-111.0605042, 32.2360625], [-111.0609846, 32.2360641], [-111.06139362476226, 32.23606459978588], [-111.0613938, 32.2360646], [-111.0615062, 32.2360541], [-111.0616224, 32.236032], [-111.0617347, 32.2360119], [-111.0619524, 32.235946], [-111.0621531, 32.2358654], [-111.0623975, 32.2357599], [-111.0627464, 32.2356119], [-111.0629529, 32.2355187], [-111.0640468, 32.2350375], [-111.06463, 32.2347468], [-111.0652831, 32.234407], [-111.0657077, 32.2341723], [-111.06593815710664, 32.23404830261987], [-111.0659692, 32.2340316], [-111.0664498, 32.2337729], [-111.06667006920638, 32.23365123161553], [-111.0667038, 32.2336326], [-111.0668131, 32.2335722], [-111.0670476, 32.2334333], [-111.0672745, 32.2332821], [-111.0673838, 32.2331962], [-111.0676469, 32.2329487], [-111.0678677, 32.2327232], [-111.0679332, 32.232652], [-111.0683192, 32.232232], [-111.0685681, 32.2319766], [-111.0687935, 32.2317926], [-111.0689972, 32.2316722], [-111.0692101, 32.2315769], [-111.0694085, 32.231509], [-111.0696658, 32.2314368], [-111.0700955, 32.2313053], [-111.0703247, 32.2312214], [-111.0704852, 32.2311502], [-111.070676, 32.2310383], [-111.0708098, 32.2309363], [-111.0709143, 32.2308488], [-111.0710495, 32.2307179], [-111.0711201, 32.2306355], [-111.07116485876539, 32.23056844825879], [-111.0711719, 32.2305579], [-111.0712257, 32.2304774], [-111.0712924, 32.2303799], [-111.0714711, 32.2301186], [-111.0715897, 32.2299653], [-111.0716488, 32.2299057], [-111.0717022, 32.2298494], [-111.0718413, 32.2297346], [-111.07193, 32.2296944], [-111.0720519, 32.2296393], [-111.0724332, 32.2295215], [-111.0724515, 32.2295157], [-111.0732003, 32.2292751], [-111.0742785, 32.2289236], [-111.07453643906524, 32.22884931278039], [-111.0745469, 32.2288463], [-111.0745978, 32.2288316], [-111.0749418, 32.2287605], [-111.075116, 32.2287273], [-111.0753574, 32.2286894], [-111.0755081, 32.2286722], [-111.0758601, 32.2286451], [-111.0762382, 32.2286163], [-111.0769494, 32.2285637], [-111.0772983, 32.2285398], [-111.0777805, 32.2285004], [-111.0781029, 32.2284691], [-111.07836095436473, 32.22843965037852], [-111.0784166, 32.2284333], [-111.0784482, 32.2284279], [-111.0787154, 32.2283834], [-111.079004, 32.2283331], [-111.0792212, 32.2282884], [-111.079427, 32.228236], [-111.0796164, 32.2281773], [-111.079893, 32.2280762], [-111.0800441, 32.2280235], [-111.0803284, 32.2279475], [-111.0804719, 32.2279175], [-111.0806763, 32.2278945], [-111.0810184, 32.2278937], [-111.0813387, 32.2278882], [-111.081405, 32.2278842], [-111.0816653, 32.2278518], [-111.081835, 32.2278079], [-111.0821298, 32.2277075], [-111.0825936, 32.2275078], [-111.0829522, 32.2273358], [-111.0831042, 32.2272663], [-111.0833549, 32.2271684], [-111.0834725, 32.2271276], [-111.0838816, 32.2270118], [-111.0843249, 32.2268926], [-111.08486, 32.2267367], [-111.0852962, 32.2266105], [-111.0855849, 32.2265235], [-111.0857124, 32.2264728], [-111.0858759, 32.2263904], [-111.0859911, 32.2263041], [-111.0861708, 32.2261455], [-111.08629964983777, 32.2260313961351], [-111.0863342, 32.2260008], [-111.0863789, 32.2259608], [-111.0866542, 32.2257334], [-111.0869596, 32.2255105], [-111.0872648, 32.2252932], [-111.0875577, 32.2251003], [-111.0878198, 32.22494], [-111.0881628, 32.2247474], [-111.0883552, 32.2246584], [-111.0885132, 32.2246014], [-111.0886765, 32.2245596], [-111.0888139, 32.224547], [-111.0891262, 32.2245332], [-111.089404, 32.2245364], [-111.0895764, 32.2245422], [-111.0897641, 32.2245623], [-111.09015, 32.2246141], [-111.0904456, 32.2246595], [-111.0906036, 32.2246743], [-111.0907752, 32.2246706], [-111.0909163, 32.2246542], [-111.091279, 32.2245784], [-111.0914282, 32.2245351], [-111.0917703, 32.2244], [-111.0921779, 32.2242219], [-111.0925573, 32.2240741], [-111.0926981, 32.2240389], [-111.0928255, 32.2240194], [-111.0929815, 32.2240078], [-111.0931139, 32.2240094], [-111.0933153, 32.2240226], [-111.0937458, 32.224058], [-111.0939735, 32.2240728], [-111.0941678, 32.2240807], [-111.094367, 32.2240701], [-111.0945554, 32.2240432], [-111.0946803, 32.2240104], [-111.0948531, 32.2239337], [-111.0949773, 32.2238803], [-111.0951189, 32.2238278], [-111.0952545, 32.2237924], [-111.0954275, 32.223767], [-111.0958431, 32.223718], [-111.0960972, 32.2236817], [-111.0964354, 32.2236252], [-111.0968919, 32.2235499], [-111.0972847, 32.2234834], [-111.0977127, 32.2233985], [-111.098143, 32.2233038], [-111.0982789, 32.2232589], [-111.0985952, 32.2231458], [-111.0988467, 32.2230727], [-111.09909234011111, 32.22300409719549], [-111.0992087, 32.2229716], [-111.0992556, 32.2229523], [-111.0993061, 32.2229316], [-111.0993635, 32.2228962], [-111.0994598, 32.2228231], [-111.0995753, 32.2227622], [-111.0996557, 32.2227392], [-111.099744, 32.2227332], [-111.0998356, 32.2227436], [-111.0999346, 32.222764], [-111.1000872, 32.2227952], [-111.1001674, 32.2227976], [-111.100233, 32.2227904], [-111.1003402, 32.2227632], [-111.1005146, 32.2227181], [-111.1007121, 32.2226671], [-111.1007976149642, 32.22264890849934], [-111.1009415, 32.2226183], [-111.1009745, 32.2226082], [-111.10100144557191, 32.22259999244074], [-111.1010093, 32.2225976], [-111.101079, 32.222539], [-111.1011098, 32.222492], [-111.1011167, 32.2224795], [-111.1011913, 32.2223449], [-111.1012302, 32.2222633], [-111.101261, 32.2221615], [-111.1012587, 32.2221135], [-111.1012342, 32.2220662], [-111.1011904, 32.2220129], [-111.1010549, 32.2219082], [-111.1008479, 32.2217449], [-111.1008041, 32.221706], [-111.100762, 32.221662], [-111.1007106, 32.2215932], [-111.1006175, 32.2214036], [-111.1005673, 32.2213139], [-111.100467, 32.2211888], [-111.1003206, 32.2210566], [-111.1002363, 32.220978], [-111.1001894, 32.2209236], [-111.1001579, 32.2208587], [-111.1001454, 32.2208089], [-111.1001508, 32.2207462], [-111.1001932, 32.2206067], [-111.1002249, 32.2204655], [-111.1002182, 32.2203721], [-111.1001782, 32.2202115], [-111.1001064, 32.2199911], [-111.1000965, 32.2198893], [-111.100101, 32.2198474], [-111.1001385, 32.2197773], [-111.1002207, 32.2197002], [-111.100321, 32.219635], [-111.1003947, 32.2195866], [-111.1004976, 32.219529], [-111.1006231, 32.2194724], [-111.1007908, 32.219417], [-111.1009151, 32.2193851], [-111.1009951, 32.2193752], [-111.101113, 32.219365], [-111.1012822, 32.2193429], [-111.1013612, 32.2193154], [-111.1014521, 32.2192653], [-111.1015446, 32.2191924], [-111.1016154, 32.2191171], [-111.1018199, 32.2188531], [-111.1019468, 32.2186847], [-111.102003, 32.2185986], [-111.1020785, 32.2184597], [-111.1021495, 32.2183688], [-111.1022332, 32.218297], [-111.1023899, 32.2181913], [-111.1024837, 32.2181017], [-111.1026709, 32.2178585], [-111.1027876, 32.2177555], [-111.1028951, 32.2177061], [-111.1029282, 32.2177], [-111.1029688, 32.2176924], [-111.1030167, 32.217694], [-111.1030526, 32.2176953], [-111.1031626, 32.2177307], [-111.10324065358525, 32.21778634540882], [-111.10331192850636, 32.21783715822045], [-111.1033291, 32.2178494], [-111.1034062, 32.2179231], [-111.1035263, 32.218052], [-111.1036408, 32.218194], [-111.1037464, 32.2183407], [-111.1038271, 32.2184197], [-111.1039036, 32.2184806], [-111.1039829, 32.2185335], [-111.1041206, 32.2186004], [-111.1045109, 32.2187734], [-111.1048809, 32.2189427], [-111.1050957, 32.2190337], [-111.1052689, 32.219109], [-111.1054482, 32.2191775], [-111.1057457, 32.2192989], [-111.105954, 32.2193964], [-111.1062604, 32.2195628], [-111.106707, 32.2197856], [-111.107142, 32.220013], [-111.1072281, 32.2200513], [-111.107364, 32.2201023], [-111.1074081, 32.2201189], [-111.1075712, 32.2201658], [-111.1077088, 32.2201909], [-111.10780123720185, 32.22020042649511], [-111.1080455, 32.2202256], [-111.1084799, 32.2202873], [-111.1087198, 32.2203141], [-111.1089099, 32.2203315], [-111.1090915, 32.2203331], [-111.1093119, 32.2203248], [-111.1095047, 32.2203105], [-111.1097084, 32.2202981], [-111.1098878, 32.2202873], [-111.1100811, 32.2202894], [-111.11011322457882, 32.22029124321354], [-111.1101543, 32.2202936], [-111.1102736, 32.2203004], [-111.1105488300501, 32.220321304986264], [-111.11066541863713, 32.220330160424865], [-111.1107581, 32.2203372], [-111.1111825, 32.2203758], [-111.1115435, 32.2204123], [-111.1119795, 32.2204516], [-111.1122699, 32.2204786], [-111.1124906, 32.2205019], [-111.1126589, 32.2205269], [-111.1127816, 32.2205529], [-111.1129666, 32.220592], [-111.11311378874544, 32.220634689383544], [-111.1131883, 32.2206563], [-111.1134515, 32.220743], [-111.1137701, 32.2208422], [-111.1140057, 32.2209029], [-111.1142237, 32.2209461], [-111.1145286, 32.220995], [-111.1147642, 32.2210235], [-111.1147898, 32.2210251], [-111.11510770204158, 32.22104450333549], [-111.1151355, 32.2210462], [-111.1154615, 32.2210505], [-111.1156525, 32.2210481], [-111.1160651, 32.2210349], [-111.1163858, 32.2210231], [-111.1167288, 32.221024], [-111.1170995, 32.22105], [-111.1174275, 32.2210866], [-111.1178442, 32.2211324], [-111.1182017, 32.2211766], [-111.1184626, 32.221209], [-111.1187335, 32.2212401], [-111.1188926, 32.2212638], [-111.1190043, 32.2212808], [-111.1191833, 32.2213238], [-111.1193123, 32.2213611], [-111.1196621, 32.2214753], [-111.1199151, 32.2215417], [-111.1200229, 32.2215592], [-111.1201469, 32.2215686], [-111.1203016, 32.22157], [-111.1203842, 32.2215658], [-111.1205417, 32.2215478], [-111.1208058, 32.2215053], [-111.1211141, 32.2214602], [-111.1213934, 32.2214264], [-111.1216918, 32.2214], [-111.1219692, 32.2213737], [-111.1223468, 32.2213418], [-111.1226639, 32.2213236], [-111.1227821, 32.2213144], [-111.1229048, 32.2213084], [-111.1231757, 32.2213053], [-111.123349, 32.2213134], [-111.1235132, 32.2213259], [-111.1236511, 32.2213433], [-111.123791, 32.2213763], [-111.1239445, 32.2214136], [-111.1241092, 32.2214689], [-111.1242078, 32.2214998], [-111.1242359, 32.2215086], [-111.12434402500845, 32.2215416396773], [-111.1244388, 32.2215706], [-111.12457367743086, 32.22161177939261], [-111.124597, 32.2216189], [-111.1247828, 32.2216645], [-111.1249815, 32.2217002], [-111.1251202, 32.2217091], [-111.1252311, 32.2217069], [-111.1253949, 32.2216966], [-111.1256006, 32.2216806], [-111.1258323, 32.2216574], [-111.1262094, 32.2216218], [-111.12631764186251, 32.22161103853395], [-111.1265373, 32.2215892], [-111.1267132, 32.2215759], [-111.1268729, 32.2215736], [-111.1270715, 32.2215811], [-111.1272022, 32.2215972], [-111.1274472, 32.2216355], [-111.127646, 32.2216556], [-111.1277563, 32.2216616], [-111.1279652, 32.2216719], [-111.1282014, 32.2216786], [-111.1285035, 32.2216974], [-111.1289452, 32.221726], [-111.129242, 32.2217458], [-111.1296487, 32.2217712], [-111.1299562, 32.2217884], [-111.1303283, 32.2218083], [-111.1306189, 32.2218245], [-111.1307354, 32.2218255], [-111.1308909, 32.2218198], [-111.1310488, 32.2218025], [-111.1311271, 32.2217898], [-111.1314907, 32.2217094], [-111.1320388, 32.2216758], [-111.1321673, 32.2216662], [-111.1322113, 32.2218058], [-111.1323078, 32.2219421], [-111.1323211586051, 32.22196138511738], [-111.1324054, 32.222083], [-111.132609, 32.2223552], [-111.1328614, 32.2226397], [-111.1329153, 32.2226891], [-111.1331319, 32.222877], [-111.133221, 32.2229496], [-111.1333383, 32.2230359], [-111.1334654, 32.2231202], [-111.1336988, 32.2232496], [-111.13376069272407, 32.22328391881724], [-111.1339071, 32.2233651], [-111.135159, 32.2240518], [-111.1355582, 32.2242667], [-111.1356975, 32.2243533], [-111.1358235, 32.2244519], [-111.135963, 32.2245741], [-111.1362301, 32.2248805], [-111.1363328, 32.2250095], [-111.1368769, 32.2256321], [-111.1371229, 32.2258882], [-111.1375035, 32.2261529], [-111.1377814, 32.2263475], [-111.1380649, 32.2265381], [-111.1383104, 32.2266805], [-111.1384466, 32.2267328], [-111.13854526939723, 32.22675637137564], [-111.1387572, 32.226807], [-111.1393407, 32.2269205], [-111.1404318, 32.2271249], [-111.1409445, 32.2272631], [-111.1412548, 32.2273772], [-111.1416556, 32.2275614], [-111.1418929, 32.2276906], [-111.1424534, 32.2280086], [-111.1427741, 32.2282228], [-111.1428068734428, 32.2282487093884], [-111.142808, 32.2282496], [-111.1429335, 32.228349], [-111.1431604, 32.228542], [-111.1434016, 32.2287789], [-111.1437238, 32.2291805], [-111.1450577, 32.2309923], [-111.1453907, 32.2314409], [-111.1458469, 32.2320493], [-111.14589706955128, 32.23211749664962], [-111.1465446, 32.2329977], [-111.14664675292632, 32.233122831536235], [-111.1471612, 32.233753], [-111.1472964, 32.233897], [-111.1474306, 32.2340199], [-111.147635, 32.2341666], [-111.147801, 32.2342542], [-111.1481676, 32.23441], [-111.1485407, 32.234537], [-111.1494072, 32.2347974], [-111.1497422, 32.2349047], [-111.1499006, 32.234971], [-111.1503147, 32.2351713], [-111.1504005, 32.2352157], [-111.1509185, 32.2354995], [-111.1517749, 32.2359793], [-111.1528932, 32.2366213], [-111.1534473, 32.236952], [-111.1539556, 32.2372452], [-111.1542419, 32.2374021], [-111.1544458, 32.2375333], [-111.1546229, 32.237681], [-111.1546968, 32.2377733], [-111.1548954, 32.2380414], [-111.1550553, 32.2382051], [-111.1552136, 32.2383444], [-111.1556495, 32.2385909], [-111.1558755, 32.2387281], [-111.155903, 32.2387471], [-111.15607003535864, 32.23886210343075], [-111.1560847, 32.2388722], [-111.1565419, 32.2392252], [-111.1567267, 32.2393644], [-111.1570012, 32.2395647], [-111.1573665, 32.2398437], [-111.1578673, 32.2402345], [-111.158048, 32.2403756], [-111.15827, 32.2405332], [-111.1584845, 32.240663], [-111.1587575, 32.2407657], [-111.1589998, 32.2408177], [-111.159367, 32.2408803], [-111.1595615, 32.2409135], [-111.1595854275709, 32.24091966617598], [-111.1599705, 32.2410189], [-111.1603002, 32.241166], [-111.1605814, 32.2413232], [-111.1606657, 32.2413839], [-111.1607445, 32.2414502], [-111.1608894, 32.2415847], [-111.1612304, 32.2419086], [-111.1614063, 32.2420606], [-111.1615037, 32.2421376], [-111.1616033, 32.2422087], [-111.1617441, 32.2422989], [-111.1621147, 32.2425304], [-111.1624807, 32.2427765], [-111.1625534, 32.2428284], [-111.1626285, 32.2428881], [-111.1627192, 32.2429736], [-111.162784, 32.2430456], [-111.16290294968476, 32.24326346908517], [-111.1630833, 32.2435938], [-111.1631738, 32.2437371], [-111.1632776, 32.2438675], [-111.1633907, 32.243988], [-111.1639512, 32.244457], [-111.1644745, 32.2448641], [-111.1648448, 32.2451621], [-111.1649513, 32.2452466], [-111.16513138191209, 32.2454025163116], [-111.16523635187205, 32.2454934001144], [-111.1654558, 32.2456834], [-111.1656814, 32.2458819], [-111.1658614, 32.246024], [-111.1659997, 32.2461131], [-111.1661426, 32.2461915], [-111.1662839, 32.2462596], [-111.1668236, 32.2465102], [-111.1670095, 32.2466084], [-111.16716353563328, 32.246717057421286], [-111.1672926, 32.2468081], [-111.1677645, 32.2471728], [-111.1678922, 32.2472642], [-111.1680404, 32.2473556], [-111.1681651, 32.2474192], [-111.168315, 32.247479], [-111.1684352, 32.2475226], [-111.1685711, 32.247555], [-111.168727, 32.2475952], [-111.1688995, 32.2476109], [-111.1700643, 32.2476694], [-111.1713797, 32.2477505], [-111.1718345, 32.2477768], [-111.1720126, 32.2477826], [-111.1723435, 32.2477842], [-111.1726291, 32.2477736], [-111.1729155, 32.2477323], [-111.1731234, 32.247693], [-111.1733049, 32.2476481], [-111.173685, 32.2475533], [-111.1748026, 32.2472539], [-111.1761313, 32.246899], [-111.1771716, 32.246618], [-111.178027, 32.2463811], [-111.178315, 32.2463133], [-111.1784374, 32.2462854], [-111.1785876, 32.246278], [-111.1791568, 32.2462694], [-111.1803852, 32.2462345], [-111.1806373, 32.2462575], [-111.1808713, 32.2463099], [-111.1810925, 32.2464046], [-111.1819804, 32.2468975], [-111.1822394, 32.2470496], [-111.1824526, 32.247154], [-111.1826074, 32.2472093], [-111.1827579, 32.2472529], [-111.1828952, 32.2473096], [-111.183071, 32.2473832], [-111.1832692, 32.247508], [-111.1838481, 32.2479261], [-111.1840153, 32.248015], [-111.1841253, 32.2480585], [-111.1842573, 32.248098], [-111.184437, 32.2481285], [-111.1844264, 32.2482068], [-111.1844193, 32.2482553], [-111.1844104, 32.2483618], [-111.1844264, 32.2484624], [-111.1844612, 32.2485454], [-111.1845284, 32.2486187], [-111.18464, 32.2487203], [-111.1849404, 32.2489381], [-111.185144, 32.2490921], [-111.185396, 32.2493154], [-111.1858674, 32.2497366], [-111.1859894, 32.2498638], [-111.1860544, 32.2499754], [-111.1860779, 32.2500723], [-111.1860894, 32.2505741], [-111.1860905, 32.2506291], [-111.186125, 32.2509179], [-111.1861882, 32.2510907], [-111.1863752, 32.2513803], [-111.1865369, 32.2515949], [-111.1865891, 32.2516665], [-111.1866479, 32.2517156], [-111.1867129, 32.2517452], [-111.186785, 32.2517689], [-111.1868781, 32.2517783], [-111.1869638, 32.2517789], [-111.1875826, 32.2517445], [-111.1881646, 32.2516994], [-111.1884255, 32.2516928], [-111.1886215, 32.2517135], [-111.1888554, 32.2517405], [-111.1891387, 32.2517587], [-111.1893178, 32.2517183], [-111.1894502, 32.2516556], [-111.1896799, 32.2515513], [-111.1898235, 32.2515027], [-111.1899495, 32.2514765], [-111.1900328, 32.2514684], [-111.1901433, 32.2514591], [-111.1902493, 32.2514572], [-111.190369, 32.2514603], [-111.1908463, 32.2515092], [-111.1913394, 32.2515788], [-111.1916451, 32.2516233], [-111.1921174, 32.251691], [-111.1923554, 32.2516947], [-111.192545, 32.2516747], [-111.1927338, 32.2516384], [-111.1928152, 32.2516157], [-111.1929609, 32.2515783], [-111.1930737, 32.2515614], [-111.1932073, 32.2515541], [-111.1932901, 32.2515672], [-111.1933661, 32.2515872], [-111.1934787, 32.2516361], [-111.1936196, 32.2517202], [-111.1942015, 32.2520812], [-111.1945631, 32.2523006], [-111.1951199, 32.2526474], [-111.19520356577284, 32.25269855868913], [-111.1953554, 32.2527914], [-111.1955299, 32.252854], [-111.1957354, 32.252921], [-111.1959827, 32.2529839], [-111.1962823, 32.2530222], [-111.19654251672316, 32.253039389914974], [-111.196579, 32.2530418], [-111.1967967, 32.2530659], [-111.1968211, 32.2530686], [-111.19683993495438, 32.253072102842125], [-111.1970179, 32.2531052], [-111.1971066, 32.2531277], [-111.1972076, 32.2531552], [-111.19723416599602, 32.25316424929321], [-111.19734, 32.2532003], [-111.1974991, 32.2532767], [-111.1975718, 32.2533116], [-111.1977722, 32.2534429], [-111.19785432046817, 32.253511104848144], [-111.1979516, 32.2535919], [-111.1980708, 32.2536997], [-111.19817, 32.2537895], [-111.1983781, 32.2539762], [-111.1986867, 32.2542101], [-111.1987736, 32.2542685], [-111.1989523, 32.2543859], [-111.1991768, 32.2545209], [-111.1994925, 32.254685], [-111.2001504, 32.2550096], [-111.2007922, 32.2553099], [-111.20178117458798, 32.25577748301168], [-111.2021192, 32.2559373], [-111.203188, 32.2564726], [-111.2035485, 32.2566614], [-111.2036426, 32.2567086], [-111.2043954, 32.2571163], [-111.2044029, 32.2571201], [-111.204588, 32.2572518], [-111.2047019, 32.2573539], [-111.204994, 32.2576737], [-111.2052404, 32.2579147], [-111.2054966, 32.2581229], [-111.205737, 32.2583433], [-111.2060125, 32.2585793], [-111.206441, 32.2589332], [-111.2067085, 32.2591929], [-111.2069829, 32.2595089], [-111.2072007, 32.2597203], [-111.20742, 32.2598926], [-111.2076737, 32.2601154], [-111.2080601, 32.2604829], [-111.208588, 32.2610261], [-111.2088358, 32.2612699], [-111.2090932, 32.2615026], [-111.2093507, 32.2616913], [-111.2097218, 32.2619615], [-111.209869, 32.2620878], [-111.210054, 32.2622575], [-111.2103263, 32.262529], [-111.210564, 32.2627619], [-111.2108884, 32.2630976], [-111.2109473, 32.2631548], [-111.2110627, 32.2632462], [-111.2112239, 32.2633596], [-111.2116108, 32.2636349], [-111.2118786, 32.2638736], [-111.2121279, 32.2641168], [-111.2123462, 32.2643114], [-111.2126535, 32.264548], [-111.2128621, 32.2646993], [-111.2134063, 32.26508], [-111.2134896, 32.2651399], [-111.2137133, 32.2653232], [-111.2140694, 32.2656247], [-111.2144061, 32.2659154], [-111.2147044, 32.2661864], [-111.2148802, 32.2663602], [-111.2151074, 32.2666056], [-111.2152899, 32.2668418], [-111.215376, 32.266975], [-111.2154657, 32.2671283], [-111.2155877, 32.2674012], [-111.2156967, 32.2676341], [-111.2158652, 32.2680128], [-111.2163561, 32.2691218], [-111.2167391, 32.2698841], [-111.2172146, 32.2708011], [-111.2173116, 32.2709939], [-111.2173204, 32.271008], [-111.2173563, 32.2710525], [-111.2173923, 32.2710796], [-111.21744, 32.2711071], [-111.2174859, 32.2711259], [-111.2175199, 32.2711366], [-111.2176162, 32.2711467], [-111.2178696, 32.2711557], [-111.2180691, 32.2711583], [-111.2181568, 32.2711607], [-111.2181606, 32.2714884], [-111.2181806, 32.2717585], [-111.2182305, 32.2720226], [-111.2182885, 32.2722407], [-111.2183585, 32.2724656], [-111.2184578, 32.2726857], [-111.2186304, 32.2729863], [-111.21872, 32.2731193], [-111.2188022, 32.2732695], [-111.2188424, 32.2734225], [-111.2188661, 32.2735928], [-111.2188504, 32.2737589], [-111.2187933, 32.2739391], [-111.2187254, 32.2740573], [-111.2186224, 32.2741875], [-111.2184944, 32.2743388], [-111.2183735, 32.274496], [-111.2183051, 32.2746226], [-111.2182213, 32.2748718], [-111.2181809, 32.275095], [-111.2181696, 32.275278], [-111.2181634, 32.2753796], [-111.2181583, 32.2763306], [-111.2181504, 32.2874558], [-111.2181494, 32.2888547], [-111.2181475, 32.2915364], [-111.21814750006685, 32.291536401436666], [-111.2181542, 32.2916804], [-111.21816219998725, 32.29377289666717], [-111.2181622, 32.2937729], [-111.21816279999338, 32.294073096688905], [-111.2181628, 32.2940731], [-111.21816509999437, 32.295297697001935], [-111.2181651, 32.2952977], [-111.21817049999741, 32.29814599863237], [-111.2181705, 32.298146], [-111.2181756, 32.3008639], [-111.21817559999916, 32.30086390143461], [-111.2181751, 32.3017262], [-111.21817509999822, 32.30172620294076], [-111.218175, 32.3018923], [-111.21817499999814, 32.30189230324735], [-111.218174, 32.3036405], [-111.21817399999112, 32.30364050671412], [-111.2181739, 32.3037161], [-111.21817389999578, 32.30371610687107], [-111.2181726, 32.3058315], [-111.2181725999878, 32.30583151173335], [-111.2181715, 32.3068887], [-111.21817150012953, 32.306888714324955], [-111.2181893, 32.3088571], [-111.21816870000038, 32.313430599919364], [-111.2181687, 32.3134306], [-111.218168, 32.3135761], [-111.2181879, 32.3145267], [-111.2181781, 32.3153435], [-111.21817810158842, 32.31534352696024], [-111.2181818, 32.3154063], [-111.2181754, 32.3165583], [-111.21817539992927, 32.316558306023175], [-111.218168, 32.3171884], [-111.21816110000033, 32.31867399992989], [-111.2181611, 32.318674], [-111.2181597000007, 32.318959699858404], [-111.2181597, 32.3189597], [-111.21815760000806, 32.31926659882275], [-111.2181576, 32.3192666], [-111.21815570000604, 32.3196542987669], [-111.2181557, 32.3196543], [-111.21815510000492, 32.31979359885779], [-111.2181551, 32.3197936], [-111.21815260000523, 32.3203154989071], [-111.2181526, 32.3203155], [-111.21815190000471, 32.320468098970515], [-111.2181519, 32.3204681], [-111.2181513, 32.320814], [-111.2181513, 32.32204739984873], [-111.2181513, 32.3220474], [-111.2181521, 32.3238171], [-111.2181463, 32.3245555], [-111.2181448, 32.325806], [-111.2181443, 32.3262279], [-111.21814429999476, 32.326227904073136], [-111.2181432, 32.3270823], [-111.21814319998285, 32.327082312376895], [-111.2181427, 32.327443], [-111.21814270030782, 32.32744301590137], [-111.21815, 32.3278201]] } }];
const CONFIG = {
  VERDICT_URL: "https://raw.githubusercontent.com/godfather38/floodplain/data/verdict.json",
  APP_URL: "https://godfather38.github.io/FLOODplain/",
  GATEWAY: "vtext.com",
  TZ: "America/Phoenix",
  HEADS_UP: "2027-03-01",
  ENDED: "2027-04-01",
  MAX_TIMES: 4,
  FREE_PER_DAY: 2,
  DAILY_TEXT_BUDGET: 150,
  // all texts, all people, per day (about $1.50/day max on Twilio)
  CODES_PER_NUMBER_PER_DAY: 3,
  REQUESTS_PER_DAY: 10,
  CATCH_UP_MIN: 10,
  NTFY: "https://ntfy.sh/washwatch",
  MAX_NEW_SIGNUPS_PER_DAY: 40
};
const HEADER = ["phone", "times", "days", "mode", "verified", "code", "code_sent", "last_sent", "created", "key", "sent_day", "sent_count", "codes_day", "area"];
const KEYS_HEADER = ["key", "texts_per_day", "note"];
const C = { phone: 1, times: 2, days: 3, mode: 4, verified: 5, code: 6, codeSent: 7, lastSent: 8, created: 9, key: 10, sentDay: 11, sentCount: 12, codesDay: 13, area: 14 };
const AREA_IDS = ["avra", "picture-rocks"];
const validArea_ = (a) => AREA_IDS.includes(a) ? a : "avra";
function setup() {
  ensureTrigger_();
  sheet_();
  keysSheet_();
  return "ok";
}
function doGet(e) {
  ensureTrigger_();
  if (e && e.parameter && e.parameter.hit === "1") {
    countVisit_(e.parameter.new === "1");
    return json_({ ok: true });
  }
  if (e && e.parameter && e.parameter.feed === "usgs") {
    computeVerdicts_();
    const u = CacheService.getScriptCache().get("usgs");
    return json_(u ? JSON.parse(u) : { error: "unavailable" });
  }
  if (e && e.parameter && e.parameter.feed === "alert") {
    computeVerdicts_();
    const snap = CacheService.getScriptCache().get("alert");
    return json_(snap ? JSON.parse(snap) : { error: "unavailable" });
  }
  return json_({ ok: true, service: "wash-watch-alerts", sender: twilio_() ? "any" : "verizon", freePerDay: CONFIG.FREE_PER_DAY });
}
function doPost(e) {
  ensureTrigger_();
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "bad request" });
  }
  if (body.action === "request") return json_(request_(body));
  if (body.action === "report") return json_(report_(body));
  if (body.action === "push" || body.action === "pushstop") {
    const lock2 = LockService.getScriptLock();
    lock2.waitLock(2e4);
    try {
      return json_(body.action === "push" ? push_(body) : pushStop_(body));
    } finally {
      lock2.releaseLock();
    }
  }
  const phone = String(body.phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!/^\d{10}$/.test(phone)) return json_({ ok: false, error: "Enter a 10-digit US number." });
  const lock = LockService.getScriptLock();
  lock.waitLock(2e4);
  try {
    if (body.action === "signup") return json_(signup_(phone, body));
    if (body.action === "confirm") return json_(confirm_(phone, String(body.code || "")));
    if (body.action === "stop") return json_(stop_(phone));
    if (body.action === "waitlist") return json_(waitlist_(phone, body));
    return json_({ ok: false, error: "unknown action" });
  } finally {
    lock.releaseLock();
  }
}
function signup_(phone, b) {
  const key = String(b.key || "").trim();
  const limit = key ? keyLimit_(key) : CONFIG.FREE_PER_DAY;
  if (key && !limit) return { ok: false, error: "That access key isn't valid." };
  const times = [...new Set((b.times || []).map(String))].filter(validTime_).slice(0, CONFIG.MAX_TIMES);
  if (!times.length) return { ok: false, error: "Pick at least one time." };
  if (times.length > limit) {
    return { ok: false, error: `Texts are limited to ${limit} a day${key ? " for this key" : " without an access key"}. Pick ${limit} time${limit > 1 ? "s" : ""}, or ask for more below.` };
  }
  const days = validDays_(b.days);
  const mode = b.mode === "off" ? "off" : "all";
  const sh = sheet_();
  const row = findRow_(sh, phone);
  const now = Date.now();
  const today = today_();
  let codesToday = 0;
  if (row) {
    const last = Number(sh.getRange(row, C.codeSent).getValue()) || 0;
    if (now - last < 2 * 60 * 1e3) return { ok: false, error: "A code was just sent. Wait 2 minutes." };
    const cd = String(sh.getRange(row, C.codesDay).getValue()).split(" ");
    codesToday = cd[0] === today ? Number(cd[1]) || 0 : 0;
    if (codesToday >= CONFIG.CODES_PER_NUMBER_PER_DAY) return { ok: false, error: "Too many codes for this number today. Try tomorrow." };
  } else if (newToday_() >= CONFIG.MAX_NEW_SIGNUPS_PER_DAY) {
    return { ok: false, error: "Too many sign-ups today. Try tomorrow." };
  }
  const code = String(Math.floor(1e3 + Math.random() * 9e3));
  const keep = row ? sh.getRange(row, 1, 1, HEADER.length).getValues()[0] : [];
  const values = [
    phone,
    times.join(","),
    days,
    mode,
    false,
    code,
    now,
    keep[C.lastSent - 1] || "",
    row ? keep[C.created - 1] : /* @__PURE__ */ new Date(),
    key,
    keep[C.sentDay - 1] || "",
    keep[C.sentCount - 1] || 0,
    `${today} ${codesToday + 1}`,
    validArea_(b.area)
  ];
  if (row) sh.getRange(row, 1, 1, HEADER.length).setValues([values]);
  else sh.appendRow(values);
  text_(phone, `FLOODplain code: ${code}. Enter it in the app to start your texts. If you didn't ask for this, ignore it.`, true);
  return { ok: true, step: "confirm" };
}
function request_(b) {
  const props = PropertiesService.getScriptProperties();
  const today = today_();
  const [day, n] = String(props.getProperty("requests") || "").split(" ");
  const count = day === today ? Number(n) || 0 : 0;
  if (count >= CONFIG.REQUESTS_PER_DAY) return { ok: false, error: "Too many requests today. Try tomorrow." };
  const contact = String(b.contact || "").slice(0, 200).trim();
  const message2 = String(b.message || "").slice(0, 1500).trim();
  if (!contact || !message2) return { ok: false, error: "Add how to reach you and a short message." };
  props.setProperty("requests", `${today} ${count + 1}`);
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    "FLOODplain: request for more texts",
    `From: ${contact}

${message2}

To give them a key, add a row to the "keys" tab of "FLOODplain text subscribers (private)": key | texts_per_day | note.`
  );
  return { ok: true, step: "sent" };
}
function report_(b) {
  const props = PropertiesService.getScriptProperties();
  const today = today_();
  const [day, n] = String(props.getProperty("reports") || "").split(" ");
  const count = day === today ? Number(n) || 0 : 0;
  if (count >= 60) return { ok: false, error: "Lots of reports today. Try tomorrow." };
  props.setProperty("reports", `${today} ${count + 1}`);
  const answers = b.answers && typeof b.answers === "object" ? b.answers : {};
  const clip = (x, k) => String(x || "").slice(0, k);
  const ss = sheet_().getParent();
  let rs = ss.getSheetByName("reports");
  if (!rs) {
    rs = ss.insertSheet("reports");
    rs.appendRow(["when", "area", "crossing_id", "crossing", "answers", "last_seen_water", "note"]);
  }
  rs.appendRow([/* @__PURE__ */ new Date(), clip(b.area, 20), clip(b.fp, 40), clip(b.crossing, 120), JSON.stringify(answers).slice(0, 1500), clip(b.lastSeen, 10), clip(b.note, 1500)]);
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    `FLOODplain: crossing report, ${clip(b.crossing, 80)}`,
    Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join("\n") + (b.lastSeen ? `
Last saw water: ${b.lastSeen}` : "") + (b.note ? `
Note: ${clip(b.note, 1500)}` : "") + '\n\nAll reports: the "reports" tab of "FLOODplain text subscribers (private)".'
  );
  return { ok: true, step: "saved" };
}
function countVisit_(isNew) {
  const lock = LockService.getScriptLock();
  lock.waitLock(1e4);
  try {
    const ss = sheet_().getParent();
    let st = ss.getSheetByName("stats");
    if (!st) {
      st = ss.insertSheet("stats");
      st.appendRow(["date", "app_opens", "new_visitors", "push_channels", "text_subscribers", "crossing_reports", "waitlist"]);
    }
    const today = today_();
    const rows = st.getDataRange().getValues();
    let i = rows.findIndex((r, k) => k > 0 && (r[0] instanceof Date ? Utilities.formatDate(r[0], CONFIG.TZ, "yyyy-MM-dd") : String(r[0])) === today);
    if (i < 0) {
      st.appendRow([today, 0, 0, 0, 0, 0, 0]);
      i = st.getLastRow() - 1;
    }
    const row = i + 1;
    const opens = Number(st.getRange(row, 2).getValue()) || 0;
    const fresh = Number(st.getRange(row, 3).getValue()) || 0;
    const count = (name) => {
      const sh = ss.getSheetByName(name);
      return sh ? Math.max(sh.getLastRow() - 1, 0) : 0;
    };
    st.getRange(row, 2, 1, 6).setValues([[opens + 1, fresh + (isNew ? 1 : 0), count("push"), Math.max(sheet_().getLastRow() - 1, 0), count("reports"), count("waitlist")]]);
  } finally {
    lock.releaseLock();
  }
}
function keyLimit_(key) {
  const rows = keysSheet_().getDataRange().getValues().slice(1);
  const r = rows.find((x) => String(x[0]).trim() === key);
  return r ? Math.max(1, Math.min(Number(r[1]) || 0, CONFIG.MAX_TIMES)) : 0;
}
function confirm_(phone, code) {
  const sh = sheet_();
  const row = findRow_(sh, phone);
  if (!row || String(sh.getRange(row, C.code).getValue()) !== code) return { ok: false, error: "That code doesn't match." };
  sh.getRange(row, C.verified).setValue(true);
  const times = String(sh.getRange(row, C.times).getValue()).split(",").map(label_).join(" & ");
  const days = daysLabel_(String(sh.getRange(row, C.days).getValue()));
  text_(phone, `FLOODplain texts are on: ${times}, ${days}. To stop, use Stop texts in the app's Alerts screen.`);
  return { ok: true, step: "done" };
}
function stop_(phone) {
  const ws = waitSheet_();
  const wrow = findRow_(ws, phone);
  if (wrow) ws.deleteRow(wrow);
  const sh = sheet_();
  const row = findRow_(sh, phone);
  if (row) {
    sh.deleteRow(row);
    text_(phone, "FLOODplain texts stopped.");
  }
  return { ok: true, step: "stopped" };
}
function waitSheet_() {
  const ss = sheet_().getParent();
  let w = ss.getSheetByName("waitlist");
  if (!w) {
    w = ss.insertSheet("waitlist");
    w.appendRow(["phone", "area", "joined", "texted"]);
  }
  return w;
}
function waitlist_(phone, b) {
  const ws = waitSheet_();
  if (findRow_(ws, phone)) return { ok: true, step: "waitlisted" };
  const today = today_();
  const props = PropertiesService.getScriptProperties();
  const [day, n] = String(props.getProperty("waitlist") || "").split(" ");
  const count = day === today ? Number(n) || 0 : 0;
  if (count >= 100) return { ok: false, error: "Lots of sign-ups today. Try tomorrow." };
  props.setProperty("waitlist", `${today} ${count + 1}`);
  ws.appendRow([phone, validArea_(b.area), /* @__PURE__ */ new Date(), ""]);
  return { ok: true, step: "waitlisted" };
}
function notifyWaitlist_() {
  const ws = waitSheet_();
  const rows = ws.getDataRange().getValues().slice(1);
  let sent = 0;
  for (let i = 0; i < rows.length && sent < 30; i++) {
    if (rows[i][3]) continue;
    const phone = String(rows[i][0]);
    if (!text_(phone, `FLOODplain: texts now work on every carrier. You asked to hear when. Sign up here: ${CONFIG.APP_URL}#/alerts . This is the only waitlist text; nothing more unless you sign up.`)) return;
    ws.getRange(i + 2, 4).setValue(/* @__PURE__ */ new Date());
    sent += 1;
  }
}
function tick() {
  const now = /* @__PURE__ */ new Date();
  const today = Utilities.formatDate(now, CONFIG.TZ, "yyyy-MM-dd");
  const props = PropertiesService.getScriptProperties();
  if (!twilio_()) sunset_(today, props);
  else notifyWaitlist_();
  const nowMin = Math.floor(now.getTime() / 6e4);
  const last = Number(props.getProperty("last_min")) || nowMin - 1;
  const from = Math.max(last + 1, nowMin - CONFIG.CATCH_UP_MIN + 1);
  props.setProperty("last_min", String(nowMin));
  if (from > nowMin) return;
  const minutes = [];
  for (let m = from; m <= nowMin; m++) {
    const d = new Date(m * 6e4);
    minutes.push({
      hhmm: Utilities.formatDate(d, CONFIG.TZ, "HH:mm"),
      day: Utilities.formatDate(d, CONFIG.TZ, "yyyy-MM-dd"),
      weekday: Number(Utilities.formatDate(d, CONFIG.TZ, "u")) <= 5,
      dow: Number(Utilities.formatDate(d, CONFIG.TZ, "u")),
      dom: Number(Utilities.formatDate(d, CONFIG.TZ, "d"))
    });
  }
  const verdicts = {};
  const forArea = (a) => {
    const id = validArea_(a);
    if (!verdicts[id]) {
      const v = verdict_(id);
      const fresh = !!(v && Date.now() - Date.parse(v.at) < 45 * 60 * 1e3);
      verdicts[id] = { v, fresh, msg: fresh ? v.sms : "FLOODplain couldn't get fresh data just now. Check the app before you go." };
    }
    return verdicts[id];
  };
  const ps = pushSheet_();
  ps.getDataRange().getValues().slice(1).forEach((r, i) => {
    const [topic, times, days, mode, lastSent, , pArea] = r;
    for (const m of minutes) {
      const key = `${m.day} ${m.hhmm}`;
      if (lastSent === key || !String(times).split(",").includes(m.hhmm) || !dueOn_(String(days), m)) continue;
      ps.getRange(i + 2, 5).setValue(key);
      const { v, fresh, msg } = forArea(pArea);
      if (!(mode === "off" && fresh && !v.off)) ntfy_(String(topic), v, msg);
    }
  });
  const sh = sheet_();
  const rows = sh.getDataRange().getValues().slice(1);
  rows.forEach((r, i) => {
    const phone = String(r[C.phone - 1]);
    if (r[C.verified - 1] !== true) return;
    const limit = r[C.key - 1] ? keyLimit_(String(r[C.key - 1])) || CONFIG.FREE_PER_DAY : CONFIG.FREE_PER_DAY;
    for (const m of minutes) {
      const key = `${m.day} ${m.hhmm}`;
      if (r[C.lastSent - 1] === key || !String(r[C.times - 1]).split(",").includes(m.hhmm)) continue;
      if (!dueOn_(String(r[C.days - 1]), m)) continue;
      sh.getRange(i + 2, C.lastSent).setValue(key);
      r[C.lastSent - 1] = key;
      const { v, fresh, msg } = forArea(r[C.area - 1]);
      if (r[C.mode - 1] === "off" && fresh && !v.off) continue;
      let count = r[C.sentDay - 1] === m.day ? Number(r[C.sentCount - 1]) || 0 : 0;
      if (count >= limit) continue;
      if (!text_(phone, msg)) continue;
      count += 1;
      r[C.sentDay - 1] = m.day;
      r[C.sentCount - 1] = count;
      sh.getRange(i + 2, C.sentDay, 1, 2).setValues([[m.day, count]]);
    }
  });
}
function computeVerdict_(area) {
  const all = computeVerdicts_();
  return all ? all[validArea_(area)] : null;
}
function computeVerdicts_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("verdicts");
  if (hit) return JSON.parse(hit);
  if (typeof evaluate !== "function") return null;
  const urls = sourceUrls(PropertiesService.getScriptProperties().getProperty("USGS_API_KEY"));
  const sites = Object.keys(urls.usgs);
  const ua = { "User-Agent": "FLOODplain/1.0 (github.com/godfather38/floodplain)" };
  const reqs = [
    ...sites.map((s) => ({ url: urls.usgs[s], muteHttpExceptions: true, headers: ua })),
    { url: urls.closures, muteHttpExceptions: true, headers: ua },
    { url: urls.rain, muteHttpExceptions: true, headers: ua },
    { url: urls.stream, muteHttpExceptions: true, headers: ua },
    { url: urls.nws, muteHttpExceptions: true, headers: { ...ua, Accept: "application/geo+json" } }
  ];
  const res = UrlFetchApp.fetchAll(reqs).map((r) => {
    if (r.getResponseCode() !== 200) return null;
    try {
      return JSON.parse(r.getContentText());
    } catch (err) {
      return null;
    }
  });
  const now = Date.now();
  const usgs = Object.fromEntries(sites.map((s, i) => [s, res[i]]));
  const trimmed = Object.fromEntries(sites.map((s) => [s, usgs[s] ? { features: (usgs[s].features || []).map((f) => ({ properties: f.properties })) } : null]));
  cache.put("usgs", JSON.stringify({ fetched_at: new Date(Date.now()).toISOString(), series: trimmed }), 300);
  const [closures, rain, stream, nws] = res.slice(sites.length);
  const alert = rain && stream ? alertSnapshot(rain.data, stream.data, now) : null;
  const out = {};
  for (const id of AREA_IDS) {
    const v = evaluate({ now, usgs, closures, alert, nws, routes: ROUTE_FEATURES }, id);
    out[id] = { at: v.at, text: v.text, sms: v.sms, spoken: v.spoken, off: v.off, title: v.title };
  }
  cache.put("verdicts", JSON.stringify(out), 240);
  if (alert) cache.put("alert", JSON.stringify(alert), 300);
  return out;
}
function verdict_(area) {
  try {
    const v = computeVerdict_(area);
    if (v) return v;
  } catch (err) {
  }
  if (validArea_(area) !== "avra") return null;
  const cache = CacheService.getScriptCache();
  const hit = cache.get("verdict");
  if (hit) return JSON.parse(hit);
  try {
    const t = UrlFetchApp.fetch(CONFIG.VERDICT_URL, { muteHttpExceptions: true }).getContentText();
    const v = JSON.parse(t);
    cache.put("verdict", t, 60);
    return v;
  } catch (err) {
    return null;
  }
}
function ntfy_(topic, v, msg) {
  UrlFetchApp.fetch(topic.startsWith("http") ? topic : `https://ntfy.sh/${topic}`, {
    method: "post",
    payload: msg,
    muteHttpExceptions: true,
    headers: { Title: v && v.title ? v.title : "FLOODplain", Click: CONFIG.APP_URL, Tags: "droplet" }
  });
}
function sunset_(today, props) {
  const stages = [
    [CONFIG.HEADS_UP, "sunset_headsup", "Heads-up from FLOODplain: Verizon ends email-to-text on March 31, 2027, so these texts stop then. Free phone alerts keep working: " + CONFIG.APP_URL + "#/alerts"],
    [CONFIG.ENDED, "sunset_ended", "FLOODplain: Verizon has ended email-to-text, so these texts have stopped. Free phone alerts: " + CONFIG.APP_URL + "#/alerts"]
  ];
  for (const [date, flag, msg] of stages) {
    if (today < date || props.getProperty(flag)) continue;
    props.setProperty(flag, today);
    const rows = sheet_().getDataRange().getValues().slice(1).filter((r) => r[4] === true);
    rows.forEach((r) => text_(String(r[0]), msg));
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      "FLOODplain: Verizon email-to-text " + (flag === "sunset_ended" ? "has ended" : "ends March 31, 2027"),
      msg + "\n\nSubscribers notified: " + rows.length + "."
    );
  }
}
function twilio_() {
  var _a, _b;
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty("TWILIO_APPROVED") !== "yes") return null;
  const file = typeof TWILIO === "object" && TWILIO ? TWILIO : {};
  const sid = p.getProperty("TWILIO_SID") || file.SID;
  const token = p.getProperty("TWILIO_TOKEN") || file.TOKEN;
  if (!sid || !token) return null;
  let from = p.getProperty("TWILIO_FROM") || file.FROM;
  if (!from) {
    try {
      const r = UrlFetchApp.fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=1`, {
        muteHttpExceptions: true,
        headers: { Authorization: "Basic " + Utilities.base64Encode(`${sid}:${token}`) }
      });
      const n = (_b = (_a = JSON.parse(r.getContentText()).incoming_phone_numbers) == null ? void 0 : _a[0]) == null ? void 0 : _b.phone_number;
      if (n) {
        from = n;
        p.setProperty("TWILIO_FROM", n);
      }
    } catch (err) {
      from = null;
    }
  }
  return from ? { sid, token, from } : null;
}
function text_(phone, body, isCode) {
  const props = PropertiesService.getScriptProperties();
  const today = today_();
  const [day, n] = String(props.getProperty("budget") || "").split(" ");
  const used = day === today ? Number(n) || 0 : 0;
  if (used >= CONFIG.DAILY_TEXT_BUDGET) {
    if (!props.getProperty("budget_warned_" + today)) {
      props.setProperty("budget_warned_" + today, "1");
      MailApp.sendEmail(
        Session.getEffectiveUser().getEmail(),
        "FLOODplain: daily text budget reached",
        `All ${CONFIG.DAILY_TEXT_BUDGET} texts for ${today} are used. More texts wait until tomorrow. Change DAILY_TEXT_BUDGET in the script to raise it.`
      );
    }
    return false;
  }
  props.setProperty("budget", `${today} ${used + 1}`);
  const t = twilio_();
  if (t) {
    UrlFetchApp.fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.sid}/Messages.json`, {
      method: "post",
      muteHttpExceptions: true,
      headers: { Authorization: "Basic " + Utilities.base64Encode(`${t.sid}:${t.token}`) },
      payload: { To: `+1${phone}`, From: t.from, Body: body.slice(0, 320) }
    });
    return true;
  }
  if (MailApp.getRemainingDailyQuota() < 1) return false;
  MailApp.sendEmail({ to: `${phone}@${CONFIG.GATEWAY}`, subject: "", body: body.slice(0, 300), name: "FLOODplain" });
  return true;
}
function sheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty("sheet_id");
  let ss = null;
  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
    } catch (err) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create("FLOODplain text subscribers (private)");
    props.setProperty("sheet_id", ss.getId());
    ss.getSheets()[0].setName("subscribers");
    ss.getSheets()[0].appendRow(HEADER);
  }
  return ss.getSheets()[0];
}
function keysSheet_() {
  const ss = sheet_().getParent();
  let k = ss.getSheetByName("keys");
  if (!k) {
    k = ss.insertSheet("keys");
    k.appendRow(KEYS_HEADER);
    k.appendRow(["example-key-change-me", 4, "delete this row; add one per person you give more texts"]);
  }
  return k;
}
function today_() {
  return Utilities.formatDate(/* @__PURE__ */ new Date(), CONFIG.TZ, "yyyy-MM-dd");
}
function findRow_(sh, phone) {
  const col = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (let i = 1; i < col.length; i++) if (String(col[i][0]) === phone) return i + 1;
  return 0;
}
function newToday_() {
  const today = Utilities.formatDate(/* @__PURE__ */ new Date(), CONFIG.TZ, "yyyy-MM-dd");
  return sheet_().getDataRange().getValues().slice(1).filter((r) => r[C.created - 1] instanceof Date && Utilities.formatDate(r[8], CONFIG.TZ, "yyyy-MM-dd") === today).length;
}
function ensureTrigger_() {
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === "tick")) {
    ScriptApp.newTrigger("tick").timeBased().everyMinutes(1).create();
  }
}
function validDays_(d) {
  const m = /^([wm]):([\d,]+)$/.exec(String(d || ""));
  if (!m) return d === "all" ? "w:1,2,3,4,5,6,7" : "w:1,2,3,4,5";
  const max = m[1] === "w" ? 7 : 31;
  const list = [...new Set(m[2].split(",").map(Number))].filter((n) => n >= 1 && n <= max).sort((a, b) => a - b);
  return list.length ? `${m[1]}:${list.join(",")}` : "w:1,2,3,4,5";
}
function dueOn_(days, m) {
  if (days === "all") return true;
  if (days === "wd" || !days) return m.weekday;
  const [kind, list] = days.split(":");
  const nums = String(list || "").split(",").map(Number);
  return kind === "m" ? nums.includes(m.dom) : nums.includes(m.dow);
}
function daysLabel_(days) {
  const d = validDays_(days);
  const [kind, list] = d.split(":");
  const nums = list.split(",").map(Number);
  const ord = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  if (kind === "m") return "on the " + nums.map(ord).join(", ") + " of each month";
  const names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  if (nums.join() === "1,2,3,4,5") return "weekdays";
  if (nums.length === 7) return "every day";
  return nums.map((n) => names[n]).join(", ");
}
function pushSheet_() {
  const ss = sheet_().getParent();
  let p = ss.getSheetByName("push");
  if (!p) {
    p = ss.insertSheet("push");
    p.appendRow(["topic", "times", "days", "mode", "last_sent", "created", "area"]);
  }
  return p;
}
function push_(b) {
  const topic = String(b.topic || "");
  if (!/^washwatch-[a-z0-9]{8,32}$/.test(topic)) return { ok: false, error: "bad topic" };
  const times = [...new Set((b.times || []).map(String))].filter(validTime_).slice(0, CONFIG.MAX_TIMES);
  if (!times.length) return { ok: false, error: "Pick at least one time." };
  const values = [topic, times.join(","), validDays_(b.days), b.mode === "off" ? "off" : "all"];
  const ps = pushSheet_();
  const rows = ps.getDataRange().getValues();
  const i = rows.findIndex((r, k) => k > 0 && r[0] === topic);
  if (i > 0) {
    ps.getRange(i + 1, 1, 1, 4).setValues([values]);
    ps.getRange(i + 1, 7).setValue(validArea_(b.area));
  } else {
    const today = today_();
    const added = rows.slice(1).filter((r) => r[5] instanceof Date && Utilities.formatDate(r[5], CONFIG.TZ, "yyyy-MM-dd") === today).length;
    if (added >= 300) return { ok: false, error: "Too many new sign-ups today. Try tomorrow." };
    ps.appendRow([...values, "", /* @__PURE__ */ new Date(), validArea_(b.area)]);
  }
  return { ok: true, step: "saved", days: daysLabel_(values[2]) };
}
function pushStop_(b) {
  const ps = pushSheet_();
  const rows = ps.getDataRange().getValues();
  const i = rows.findIndex((r, k) => k > 0 && r[0] === String(b.topic || ""));
  if (i > 0) ps.deleteRow(i + 1);
  return { ok: true, step: "stopped" };
}
function validTime_(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}
function label_(t) {
  const [h, m] = t.split(":").map(Number);
  return `${(h + 11) % 12 + 1}:${pad_(m)} ${h < 12 ? "AM" : "PM"}`;
}
function pad_(n) {
  return String(n).padStart(2, "0");
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
