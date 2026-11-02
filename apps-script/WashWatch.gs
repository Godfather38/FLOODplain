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
  if (county && county.level === result.level && county.level !== "ok") return `${county.why}. ${noDepth}`;
  if (upstream && ["watch", "unknown"].includes(result.level)) {
    return `${upstream.why}${roadUnknown ? " Nothing here reports this road, so whether you can get through is unknown." : ""}`;
  }
  if (roadUnknown && ["ok", "unknown"].includes(result.level)) {
    return "Nothing in the data reports this crossing itself. A quiet reading miles upstream is not a dry road; look as you come up on it.";
  }
  return null;
}
function rateRoutes(routeFeatures, fpResults, fps) {
  return routeFeatures.map((f) => {
    const id = f.properties.id;
    const pts = fps.filter((fp) => fp.routes.includes(id)).map((fp) => fpResults[fp.id]);
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
  const rated = rateRoutes(routes, fpResults, CFG_.FAILURE_POINTS).map((r) => ({ ...r, score: routeScore(r) }));
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
const ROUTE_FEATURES = [{ "properties": { "id": "trico", "area": "avra", "name": "Trico Rd -> Trico-Marana Rd -> Marana Rd", "minutes": 10.4, "km": 11.2 } }, { "properties": { "id": "avra", "area": "avra", "name": "Avra Valley Rd (I-10 Avra Valley exit)", "minutes": 19.5, "km": 21.1 } }, { "properties": { "id": "silverbell-north", "area": "avra", "name": "Silverbell Rd -> Sanders Rd north -> Marana Rd", "minutes": 16.5, "km": 16.5 } }, { "properties": { "id": "silverbell-south", "area": "avra", "name": "Silverbell Rd -> Sanders Rd south -> Avra Valley Rd east", "minutes": 19.7, "km": 20.2 } }, { "properties": { "id": "pr-ina", "area": "picture-rocks", "name": "Picture Rocks Rd -> Ina Rd", "minutes": 17.7, "km": 19.5 } }, { "properties": { "id": "pr-twinpeaks", "area": "picture-rocks", "name": "Sandario Rd -> Twin Peaks Rd", "minutes": 15.4, "km": 16.7 } }, { "properties": { "id": "pr-avra", "area": "picture-rocks", "name": "Sandario Rd -> Avra Valley Rd", "minutes": 15.3, "km": 16.6 } }, { "properties": { "id": "pr-gates", "area": "picture-rocks", "name": "Sandario Rd -> Kinney Rd -> Gates Pass -> Speedway", "minutes": 30.4, "km": 32.3 } }];
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
