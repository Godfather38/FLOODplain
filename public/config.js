// Everything the morning check knows about your routes, failure points and data.
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
  '09486500': 'Santa Cruz River at Cortaro Rd (upstream of all 3 river bridges)',
  '09486520': 'Santa Cruz River at Trico Rd (just past the Trico-Marana bridge)',
  '09486055': 'Rillito Creek at La Cholla (feeds the Santa Cruz, hours ahead)',
  '09486350': 'Cañada del Oro below Ina Rd (feeds the Santa Cruz, hours ahead)',
  '09487000': 'Brawley Wash near Three Points (~20 mi upstream)',
};

// River flow levels in cfs (cubic feet of water per second).
// Normal is ~40 at Cortaro and ~30 at Trico Rd: treated wastewater, every day.
// Sept 8-9 2014, when the Trico bridge was overtopped: 21,200 at Cortaro, 12,000 at Trico Rd.
export const RIVER = { watchCfs: 300, cautionCfs: 3000, dangerCfs: 10000, earlyCfs: 1000 };

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
};
const LOCAL = ['6110', '6460', '6480'];
const BRAWLEY_BASIN = ['6440', '6420', '6460', '6480'];

// The failure points: places where water can stop you. Coordinates from the route analysis.
export const FAILURE_POINTS = [
  {
    id: 'brawley-dip', kind: 'dip', lat: 32.39322, lon: -111.29459, routes: ['avra'],
    name: 'Brawley Wash dip on Avra Valley Rd',
    where: '0.55 mi east of Trico Rd',
    rain: { local: LOCAL, basin: BRAWLEY_BASIN },
    wash: { alert: ['6443'], usgs: ['09487000'] },
  },
  {
    id: 'elpaso-dip', kind: 'dip', lat: 32.39329, lon: -111.27659, routes: ['avra'],
    name: 'Wash dip on Avra Valley Rd near El Paso Gas Rd',
    where: '0.4 mi west of El Paso Gas Rd',
    rain: { local: LOCAL },
  },
  {
    id: 'clayton-dip', kind: 'dip', lat: 32.40131, lon: -111.24501, routes: ['avra'],
    name: 'Wash dip on Avra Valley Rd near Clayton Rd',
    where: '0.55 mi east of Clayton Rd, 0.65 mi west of Sanders Rd',
    rain: { local: LOCAL },
  },
  {
    id: 'losrobles-bridge', kind: 'bridge', lat: 32.43882, lon: -111.30426,
    routes: ['trico', 'silverbell-north', 'silverbell-south'],
    name: 'Los Robles Wash bridge on Trico Rd',
    where: 'between El Tiro Rd and Silverbell Rd',
    rain: { basin: BRAWLEY_BASIN },
    wash: { alert: ['6443'], usgs: ['09487000'] },
  },
  {
    id: 'sc-trico-marana', kind: 'river', lat: 32.45369, lon: -111.27985, routes: ['trico'],
    name: 'Santa Cruz bridge on Trico-Marana Rd',
    where: 'the river crossing on Trico-Marana Rd',
    river: ['09486520', '09486500'],
  },
  {
    id: 'sc-sanders', kind: 'river', lat: 32.43488, lon: -111.23395, routes: ['silverbell-north'],
    name: 'Santa Cruz bridge on Sanders Rd',
    where: 'Sanders Rd north of Silverbell (Town of Marana road: no county status)',
    river: ['09486500', '09486520'],
  },
  {
    id: 'sc-avra', kind: 'river', lat: 32.40256, lon: -111.14614, routes: ['avra', 'silverbell-south'],
    name: 'Santa Cruz bridge on Avra Valley Rd',
    where: 'just west of I-10',
    river: ['09486500'],
  },
  {
    id: 'silverbell-drainage', kind: 'road', lat: 32.43062, lon: -111.2725,
    routes: ['silverbell-north', 'silverbell-south'],
    name: 'Silverbell Rd puddling / washouts',
    where: 'Silverbell between Trico Rd and Sanders Rd',
    rain: { road: ['6110', '6480'] },
  },
];

// Upstream feeders: if these run, the Santa Cruz rises at the bridges hours later.
export const RIVER_EARLY = ['09486055', '09486350'];

// County barricade points within this distance of a failure point count as "at" it.
export const CLOSURE_RADIUS_M = 450;

// For "Open in Google Maps": points that force Google onto each route. Google
// starts from your current location and allows up to 3 stops on phones.
export const NAV = {
  trico: { via: [[32.4537, -111.2799]], ramp: [32.4611, -111.2170] },
  avra: { via: [[32.3933, -111.2766]], ramp: [32.4006, -111.1313] },
  'silverbell-north': { via: [[32.43062, -111.2725], [32.4349, -111.2340]], ramp: [32.4611, -111.2170] },
  'silverbell-south': { via: [[32.43062, -111.2725], [32.4050, -111.2340]], ramp: [32.4006, -111.1313] },
};

export const LINKS = [
  ['Pima ALERT rain map', 'https://alertmap.rfcd.pima.gov/Gmap/Gmap.html'],
  ['Pima road closures', 'https://www.pima.gov/898'],
  ['NWS Tucson', 'https://www.weather.gov/twc/'],
  ['AZ 511 (I-10)', 'https://az511.com/'],
];
