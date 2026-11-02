// Everything FLOODplain knows about the routes, failure points and data.
// Plain-language definitions of each failure point: docs/FAILURE-POINTS.md

export const SOURCES = {
  usgs: 'https://api.waterdata.usgs.gov/ogcapi/v1',
  // Pima County DOT flood barricade points with live status (Open / Proceed with Caution / Closed).
  closures: 'https://services2.arcgis.com/UTBp78iglGpbqp1B/arcgis/rest/services/Road_Closures_viewPAG/FeatureServer/0',
  // Pima County ALERT rain + stream sensors, copied every ~10 min by .github/workflows/alert-snapshot.yml.
  alert: 'https://raw.githubusercontent.com/godfather38/floodplain/data/alert.json',
  // National Weather Service warnings for a point in Avra Valley.
  nws: 'https://api.weather.gov/alerts/active?point=32.41,-111.27',
};

export const STALE_MS = 3 * 60 * 60 * 1000; // a sensor silent this long counts as "no data"
export const SNAPSHOT_STALE_MS = 45 * 60 * 1000; // ALERT copy older than this counts as "no data"

// Live USGS gauges (checked Oct 31, 2026). The old Avra Valley Rd (09486509) and
// Sanders Rd (09486515) gauges no longer report, so they are not used.
export const USGS_SITES = {
  '09486500': { name: 'Santa Cruz River at Cortaro Rd', lat: 32.3507, lon: -111.0959 },
  '09486520': { name: 'Santa Cruz River at Trico Rd', lat: 32.4716, lon: -111.3020 },
  '09486055': { name: 'Rillito Creek at La Cholla', lat: 32.3028, lon: -111.0114 },
  '09486350': { name: 'Cañada del Oro below Ina Rd', lat: 32.3362, lon: -111.0421 },
  '09487000': { name: 'Brawley Wash near Three Points', lat: 32.0757, lon: -111.3387 },
  '09482500': { name: 'Santa Cruz River at Tucson', lat: 32.2212, lon: -110.9818 },
};

// Areas: each has a public hub where its routes start.
export const AREAS = [
  { id: 'avra', name: 'Avra Valley', hub: 'Trico & El Tiro', hubAt: [32.4295, -111.3045] },
  { id: 'picture-rocks', name: 'Picture Rocks', hub: 'Niko\'s & the Speedways', hubAt: [32.32782, -111.21815] },
];

// River flow levels in cfs (cubic feet of water per second).
// Normal is ~40 at Cortaro and ~30 at Trico Rd: treated wastewater, every day.
// Sept 8-9 2014, when the Trico bridge was overtopped: 21,200 at Cortaro, 12,000 at Trico Rd.
export const RIVER = { watchCfs: 300, cautionCfs: 3000, dangerCfs: 10000, earlyCfs: 1000 };

// Wash flow sensors (county ALERT stream sensors + USGS gauges on the washes).
// Two crossings list them: the Brawley Wash dip and the Los Robles Wash bridge. Both lists
// are a configuration choice about which sensors are worth showing there — not a verified
// hydrologic relationship. Every sensor in them sits miles up the wash from the road, and no
// rating curve, travel time or channel-loss relation between any of them and either crossing
// has been established. So a number from them is an upstream alert, never a statement about
// the pavement: `bigFlowCfs` only decides when a reading is called out as a big flow.
// See docs/BRAWLEY-UPSTREAM-EVIDENCE.md.
export const WASH = { bigFlowCfs: 500 };

// Rain thresholds in inches. Starting values for desert flash floods. They get tuned
// against what you see at the crossings. Windows: h1 = last hour, h3 = 3 hours, etc.
export const RAIN = {
  local: { // rain right over a small wash that crosses the road at grade (a dip)
    danger: { h1: 0.75, h3: 1.25 },
    caution: { h1: 0.4, h3: 0.6, h6: 0.9 },
    watch: { h1: 0.15, h3: 0.3, h6: 0.5 },
  },
  basin: { // rain over a whole upstream watershed (water arrives hours later)
    caution: { h3: 0.6, h6: 0.9, d1: 1.25 },
    watch: { h3: 0.3, h6: 0.5, d1: 0.75 },
  },
  road: { // poor road drainage (Silverbell): shallow, never "high"
    caution: { h1: 0.4, h3: 0.6 },
    watch: { h1: 0.2, h3: 0.35 },
  },
};
// Checked against Oct 31, 2026: 0.20" over 6 h at Avra Valley Air Park, roads drove fine -> Low.

// ALERT rain gauges (site id -> short name), by area.
export const RAIN_GAUGES = {
  '6110': 'Avra Valley Air Park',
  '6460': 'Picture Rocks Community Ctr',
  '6480': 'Trico Rd north of Manville',
  '6440': 'Brawley Wash at Milewide Rd',
  '6420': 'Brawley Wash at Three Points',
  '6130': 'Continental Reserve (Marana)',
  '6520': 'El Camino del Cerro trailhead',
  '6500': 'Arizona-Sonora Desert Museum',
  '6490': 'Old Tucson',
};
const PR_NORTH = ['6460', '6110', '6440'];   // Sandario north of the hub
const PR_EAST = ['6130', '6520', '6460'];    // Picture Rocks Rd / Ina side
const PR_SOUTH = ['6460', '6500', '6440'];   // Sandario south toward Kinney
const TUCSON_MTNS = ['6500', '6490', '6520']; // Kinney, Gates Pass, west Speedway
const LOCAL = ['6110', '6460', '6480'];
const BRAWLEY_BASIN = ['6440', '6420', '6460', '6480'];

// The failure points: places where water can stop you. Coordinates from the route analysis.
export const FAILURE_POINTS = [
  {
    id: 'brawley-dip', short: 'Brawley Wash dip', kind: 'dip', lat: 32.39322, lon: -111.29459, routes: ['avra'],
    name: 'Brawley Wash dip on Avra Valley Rd',
    where: '0.55 mi east of Trico Rd',
    rain: { local: LOCAL, basin: BRAWLEY_BASIN },
    wash: { alert: ['6443'], usgs: ['09487000'] },
  },
  {
    id: 'elpaso-dip', short: 'El Paso Gas Rd dip', kind: 'dip', lat: 32.39329, lon: -111.27659, routes: ['avra'],
    name: 'Wash dip on Avra Valley Rd near El Paso Gas Rd',
    where: '0.4 mi west of El Paso Gas Rd',
    rain: { local: LOCAL },
  },
  {
    id: 'clayton-dip', short: 'Clayton Rd dip', kind: 'dip', lat: 32.40131, lon: -111.24501, routes: ['avra'],
    name: 'Wash dip on Avra Valley Rd near Clayton Rd',
    where: '0.55 mi east of Clayton Rd, 0.65 mi west of Sanders Rd',
    rain: { local: LOCAL },
  },
  {
    id: 'losrobles-bridge', short: 'Los Robles bridge', kind: 'bridge', lat: 32.43882, lon: -111.30426,
    routes: ['trico', 'silverbell-north', 'silverbell-south'],
    name: 'Los Robles Wash bridge on Trico Rd',
    where: 'between El Tiro Rd and Silverbell Rd',
    rain: { basin: BRAWLEY_BASIN },
    wash: { alert: ['6443'], usgs: ['09487000'] },
  },
  {
    id: 'sc-trico-marana', short: 'Trico-Marana river bridge', kind: 'river', lat: 32.45369, lon: -111.27985, routes: ['trico'],
    name: 'Santa Cruz bridge on Trico-Marana Rd',
    where: 'the river crossing on Trico-Marana Rd',
    river: ['09486520', '09486500'],
  },
  {
    id: 'sc-sanders', short: 'Sanders Rd river bridge', kind: 'river', lat: 32.43488, lon: -111.23395, routes: ['silverbell-north'],
    name: 'Santa Cruz bridge on Sanders Rd',
    where: 'Sanders Rd north of Silverbell (Town of Marana road: no county status)',
    river: ['09486500', '09486520'],
  },
  {
    id: 'sc-avra', short: 'Avra Valley Rd river bridge', kind: 'river', lat: 32.40256, lon: -111.14614, routes: ['avra', 'silverbell-south', 'pr-avra'],
    name: 'Santa Cruz bridge on Avra Valley Rd',
    where: 'just west of I-10',
    river: ['09486500'],
  },
  {
    id: 'silverbell-drainage', short: 'Silverbell drainage', kind: 'road', lat: 32.43062, lon: -111.2725,
    routes: ['silverbell-north', 'silverbell-south'],
    name: 'Silverbell Rd puddling / washouts',
    where: 'Silverbell between Trico Rd and Sanders Rd',
    rain: { road: ['6110', '6480'] },
  },

  // ----- Picture Rocks (hub: Sandario & Picture Rocks Rd) -----
  {
    id: 'pr-sandario-pr', short: 'Sandario dip by Picture Rocks Rd', kind: 'dip', lat: 32.3290, lon: -111.2181, routes: ['pr-twinpeaks', 'pr-avra'],
    name: 'Sandario Rd dip just north of Picture Rocks Rd', where: 'county barricade point "Sandario Rd north of Picture Rocks Rd"',
    rain: { local: PR_NORTH },
  },
  {
    id: 'pr-sandario-ina', short: 'Sandario dip by Ina Rd', kind: 'dip', lat: 32.3353, lon: -111.2166, routes: ['pr-twinpeaks', 'pr-avra'],
    name: 'Sandario Rd dip south of Ina Rd', where: 'county barricade point "Sandario Rd south of Ina Rd"',
    rain: { local: PR_NORTH },
  },
  {
    id: 'pr-sandario-magee', short: 'Sandario dip by Magee Rd', kind: 'dip', lat: 32.3519, lon: -111.2166, routes: ['pr-twinpeaks', 'pr-avra'],
    name: 'Sandario Rd dip south of Magee Rd', where: 'county barricade point "Sandario Rd south of Magee Rd"',
    rain: { local: PR_NORTH },
  },
  {
    id: 'pr-sandario-emigh', short: 'Sandario dip by Emigh Rd', kind: 'dip', lat: 32.3659, lon: -111.2167, routes: ['pr-twinpeaks', 'pr-avra'],
    name: 'Sandario Rd dip south of Emigh Rd', where: 'county barricade point "Sandario Rd south of Emigh Rd"',
    rain: { local: PR_NORTH },
  },
  {
    id: 'pr-picture-rocks-wash', short: 'Picture Rocks Wash dip', kind: 'dip', lat: 32.32598, lon: -111.12082, routes: ['pr-ina'],
    name: 'Picture Rocks Wash dip on Picture Rocks Rd', where: 'near Wade Rd (confirmed dip)',
    rain: { local: PR_EAST },
  },
  {
    id: 'pr-ina-flat', short: 'Ina Rd flat dip', kind: 'flat', lat: 32.33758, lon: -111.10526, routes: ['pr-ina'],
    name: 'Large flat dip on Ina Rd', where: 'west of Yuma Mine Wash. Washes out; trucks and most cars usually get through',
    rain: { local: PR_EAST },
  },
  {
    id: 'pr-yuma-mine', short: 'Yuma Mine Wash dip', kind: 'dip', lat: 32.33759, lon: -111.09519, routes: ['pr-ina'],
    name: 'Yuma Mine Wash dip on Ina Rd', where: 'the road drops into the wash (confirmed dip)',
    rain: { local: PR_EAST },
  },
  {
    id: 'sc-ina', short: 'Ina Rd river bridge', kind: 'river', lat: 32.33759, lon: -111.08151, routes: ['pr-ina'],
    name: 'Santa Cruz bridge on Ina Rd', where: 'just west of I-10; Cañada del Oro joins here',
    river: ['09486500', '09486350'],
  },
  {
    id: 'pr-twinpeaks-washes', short: 'Twin Peaks Rd washes (not confirmed)', kind: 'dip', lat: 32.3783, lon: -111.1487, routes: ['pr-twinpeaks'],
    name: 'Small washes on Twin Peaks Rd (not confirmed)', where: 'four crossings with no bridge in the map data, between Sandario and I-10',
    rain: { local: ['6130', '6110', '6460'] },
  },
  {
    id: 'sc-twinpeaks', short: 'Twin Peaks Rd river bridge', kind: 'river', lat: 32.37581, lon: -111.11538, routes: ['pr-twinpeaks'],
    name: 'Santa Cruz bridge on Twin Peaks Rd', where: 'just west of I-10',
    river: ['09486500', '09486520'],
  },
  {
    id: 'pr-sandario-south', short: 'Sandario dips by Golden Gate', kind: 'dip', lat: 32.2746, lon: -111.2183, routes: ['pr-gates'],
    name: 'Sandario Rd dips near Golden Gate and Kinney', where: 'county barricade points "Sandario south of Golden Gate" and "Sandario at Kinney"',
    rain: { local: PR_SOUTH },
  },
  {
    id: 'pr-kinney-javelina', short: 'Kinney Rd at Javelina Wash', kind: 'dip', lat: 32.2543, lon: -111.1987, routes: ['pr-gates'],
    name: 'Kinney Rd at Javelina Wash (Tucson Mountain Park)', where: 'county barricade points on Kinney by Mile Wide and Hohokam',
    rain: { local: TUCSON_MTNS },
  },
  {
    id: 'pr-kinney-washes', short: 'Kinney & Gates Pass washes (not confirmed)', kind: 'dip', lat: 32.2340, lon: -111.1480, routes: ['pr-gates'],
    name: 'Small washes on Kinney Rd and Gates Pass Rd (not confirmed)', where: 'about a dozen crossings with no bridge in the map data',
    rain: { local: TUCSON_MTNS },
  },
  {
    id: 'pr-speedway-washes', short: 'Speedway washes (not confirmed)', kind: 'dip', lat: 32.2360, lon: -111.0250, routes: ['pr-gates'],
    name: 'Greasewood and Anklam Wash crossings on Speedway (not confirmed)', where: 'west of Silverbell Rd',
    rain: { local: TUCSON_MTNS },
  },
  {
    id: 'sc-speedway', short: 'Speedway river bridge', kind: 'river', lat: 32.23567, lon: -110.98614, routes: ['pr-gates'],
    name: 'Santa Cruz bridge on Speedway', where: 'just west of I-10',
    river: ['09482500'],
  },
];

// Upstream feeders: if these run, the Santa Cruz rises at the bridges hours later.
export const RIVER_EARLY = ['09486055', '09486350'];

// County barricade points within this distance of a failure point count as "at" it.
export const CLOSURE_RADIUS_M = 450;

// For "Open in Google Maps": points that force Google onto each route. Google
// starts from your current location and allows up to 3 stops on phones.
export const ROUTE_INFO = {
  trico: { name: 'Trico-Marana', via: 'Trico Rd · Trico-Marana Rd · Marana Rd' },
  'silverbell-north': { name: 'Silverbell–Sanders north', via: 'Trico Rd · Silverbell Rd · Sanders Rd · Marana Rd' },
  avra: { name: 'Avra Valley Rd', via: 'Trico Rd · Avra Valley Rd' },
  'silverbell-south': { name: 'Silverbell–Sanders south', via: 'Trico Rd · Silverbell Rd · Sanders Rd · Avra Valley Rd' },
  'pr-ina': { name: 'Picture Rocks–Ina', via: 'Picture Rocks Rd · Wade Rd · Ina Rd' },
  'pr-twinpeaks': { name: 'Twin Peaks', via: 'Sandario Rd · Twin Peaks Rd' },
  'pr-avra': { name: 'Sandario–Avra Valley Rd', via: 'Sandario Rd · Avra Valley Rd' },
  'pr-gates': { name: 'Gates Pass', via: 'Sandario Rd · Kinney Rd · Gates Pass Rd · Speedway' },
};

// Fixed places shown on the map. Trico & El Tiro is where the routes meet on the valley side.
export const PLACES = [
  { area: 'avra', name: 'Trico & El Tiro', lat: 32.4295, lon: -111.3045, side: 'below' },
  { area: 'avra', name: 'Marana exit (I-10)', lat: 32.4611, lon: -111.2170, side: 'right' },
  { area: 'avra', name: 'Avra Valley exit (I-10)', lat: 32.4006, lon: -111.1313, side: 'above-left' },
  { area: 'picture-rocks', name: 'Niko\'s & the Speedways', lat: 32.32782, lon: -111.21815, side: 'below' },
  { area: 'picture-rocks', name: 'Ina exit', lat: 32.3389, lon: -111.0686, side: 'right' },
  { area: 'picture-rocks', name: 'Twin Peaks exit', lat: 32.3777, lon: -111.1094, side: 'right' },
  { area: 'picture-rocks', name: 'Avra Valley exit', lat: 32.4006, lon: -111.1313, side: 'above-left' },
  { area: 'picture-rocks', name: 'Speedway exit', lat: 32.2300, lon: -110.9827, side: 'above-left' },
];

// Free text-style alerts through the ntfy app: one topic per time slot, day set and mode.
export const ALERTS = { server: 'https://ntfy.sh', prefix: 'washwatch' };
// Verizon text alerts: the Google Apps Script web app in apps-script/Code.gs. Empty = not connected yet.
export const TEXT_API = 'https://script.google.com/macros/s/AKfycbyUBBx52nXVcdFB-AFy-dXslYBOKA6XrTzxeaAadGcWZ7xeafEa_BdsljbYwp8tk_EBGg/exec';
export const alertTopic = (hhmm, days, mode) => `${ALERTS.prefix}-${hhmm.replace(':', '')}-${days}-${mode}`;

// Where crossing reports go before the alert service is connected: an ntfy topic the
// owner subscribes to. Reports carry no contact details on this path (topics are public).
export const REPORT_TOPIC = 'washwatch-reports-1o6j4d6';

// Plain questions for drivers, asked about any crossing. Answers fill the gaps in the map data.
export const REPORT_QUESTIONS = [
  { id: 'kind', q: 'What is it?', a: ['A dip: the road goes down through the wash', 'A bridge or big culvert: water goes under the road', 'Flat road, no wash here', 'Not sure'] },
  { id: 'often', q: 'When it rains hard, does water run across the road here?', a: ['Almost every big storm', 'Sometimes', 'Rarely', 'Never seen it'] },
  { id: 'depth', q: 'The deepest you have seen it:', a: ['Just wet pavement', 'A few inches, up to the curb', 'Up to a car tire (6 to 12 inches)', 'Deeper than a tire', 'Never seen water here'] },
  { id: 'cars', q: 'When water is running, who gets through?', a: ['Any car', 'Trucks and SUVs, most cars', 'Only trucks', 'Nobody, people turn around'] },
  { id: 'lasts', q: 'After the rain stops, how long until it is dry enough to drive?', a: ['Under an hour', 'A few hours', 'Half a day or more', 'Not sure'] },
  { id: 'barricade', q: 'Does the county put up barricades or signs here?', a: ['Yes, often', 'Sometimes', 'Never seen them', 'Not sure'] },
  { id: 'damage', q: 'Does the road get damaged here (washed-out edges, sand, rocks, potholes)?', a: ['Yes, after most storms', 'Sometimes', 'No', 'Not sure'] },
];

export const NAV = {
  trico: { via: [[32.4537, -111.2799]], ramp: [32.4611, -111.2170] },
  avra: { via: [[32.3933, -111.2766]], ramp: [32.4006, -111.1313] },
  'silverbell-north': { via: [[32.43062, -111.2725], [32.4349, -111.2340]], ramp: [32.4611, -111.2170] },
  'silverbell-south': { via: [[32.43062, -111.2725], [32.4050, -111.2340]], ramp: [32.4006, -111.1313] },
  'pr-ina': { via: [[32.3260, -111.1300], [32.3376, -111.0700]], ramp: [32.3389, -111.0686], hub: [32.32782, -111.21815] },
  'pr-twinpeaks': { via: [[32.3700, -111.2167], [32.3800, -111.1600]], ramp: [32.3777, -111.1094], hub: [32.32782, -111.21815] },
  'pr-avra': { via: [[32.3700, -111.2167], [32.4000, -111.2000]], ramp: [32.4006, -111.1313], hub: [32.32782, -111.21815] },
  'pr-gates': { via: [[32.2470, -111.1835], [32.2250, -111.1000]], ramp: [32.2300, -110.9827], hub: [32.32782, -111.21815] },
};

export const LINKS = [
  ['Pima ALERT rain map', 'https://alertmap.rfcd.pima.gov/Gmap/Gmap.html'],
  ['Pima road closures', 'https://www.pima.gov/898'],
  ['NWS Tucson', 'https://www.weather.gov/twc/'],
  ['AZ 511 (I-10)', 'https://az511.com/'],
];

// Include every rated crossing plus enough margin for nearby barricades.
export const CLOSURE_BOUNDS = [
  Math.min(...FAILURE_POINTS.map((p) => p.lon)) - 0.01,
  Math.min(...FAILURE_POINTS.map((p) => p.lat)) - 0.01,
  Math.max(...FAILURE_POINTS.map((p) => p.lon)) + 0.01,
  Math.max(...FAILURE_POINTS.map((p) => p.lat)) + 0.01,
].join(',');

// Operator-selected fractions of estimated roadway height ABOVE the same-site channel.
// Decision policy, not an uncertainty/confidence interval.
export const BRIDGE_POLICY = { warningFraction: 0.9, roadwayFraction: 1, likelyClosedFraction: 1.1, warningPoints: 0.5, roadwayPoints: 1 };
