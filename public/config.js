// What the morning check knows about each route and gauge.
// Route geometry and crossings come from data/routes.geojson (tools/build_routes.py).

export const API = 'https://api.waterdata.usgs.gov/ogcapi/v1';

// A reading older than this counts as "no data". Desert gauges transmit
// every 15-60 min, so 3 h of silence means the gauge is down or offline.
export const STALE_MS = 3 * 60 * 60 * 1000;

// Below this flow (cubic feet per second) an ephemeral wash or the Santa Cruz
// counts as dry. Ponded water and sensor noise can read a few tenths.
export const DRY_CFS = 1;

export const GAUGES = {
  '09486520': {
    name: 'Santa Cruz River at Trico Rd',
    // highCfs: flow at which the crossing is known to be in trouble. Unknown
    // until calibrated against past closures (next step), so null for now.
    highCfs: null,
  },
  '09486509': { name: 'Santa Cruz River at Avra Valley Rd', highCfs: null },
  '09486515': { name: 'Santa Cruz River at Sanders Rd', highCfs: null },
  '09487000': { name: 'Brawley Wash near Three Points (upstream)', highCfs: null },
};

// How a gauge reading affects each route.
//   bridge: water passes *under* the road. Flow alone is only "watch";
//           it becomes a problem only near overtopping (highCfs) or on a
//           fast rise.
//   dip:    the road crosses at grade downstream of this gauge, so any flow
//           here means water is headed for the road.
export const ROUTES = {
  trico: {
    gauges: [
      { site: '09486520', kind: 'bridge', role: 'Santa Cruz at the Trico-Marana bridge' },
      { site: '09487000', kind: 'bridge', role: 'Brawley Wash upstream, which feeds the Los Robles Wash bridge on Trico Rd' },
    ],
    blindSpots: ['Los Robles Wash bridge on Trico Rd has no gauge of its own'],
  },
  avra: {
    gauges: [
      { site: '09486509', kind: 'bridge', role: 'Santa Cruz at the Avra Valley Rd bridge' },
      { site: '09487000', kind: 'dip', role: 'Brawley Wash upstream of the Avra Valley Rd crossing' },
    ],
    blindSpots: [
      'Brawley Wash crossing on Avra Valley Rd: the gauge is ~15 mi upstream, and local storms can flood it with no warning there',
      '2 unnamed wash crossings on Avra Valley Rd with no bridge in the map data',
    ],
  },
  'silverbell-north': {
    gauges: [
      { site: '09486515', kind: 'bridge', role: 'Santa Cruz at the Sanders Rd bridge' },
      { site: '09487000', kind: 'bridge', role: 'Brawley Wash upstream, which feeds the Los Robles Wash bridge on Trico Rd' },
    ],
    blindSpots: ['Silverbell Rd can wash out from poor road drainage. That is shallow, but no gauge sees it'],
  },
  'silverbell-south': {
    gauges: [
      { site: '09486509', kind: 'bridge', role: 'Santa Cruz at the Avra Valley Rd bridge' },
      { site: '09487000', kind: 'bridge', role: 'Brawley Wash upstream, which feeds the Los Robles Wash bridge on Trico Rd' },
    ],
    blindSpots: ['Silverbell Rd can wash out from poor road drainage. That is shallow, but no gauge sees it'],
  },
};

export const LINKS = [
  ['Pima County ALERT rain/stream map', 'https://alertmap.rfcd.pima.gov/Gmap/Gmap.html'],
  ['Pima County road closures', 'https://www.pima.gov/898'],
  ['NWS Tucson', 'https://www.weather.gov/twc/'],
  ['AZ 511 (I-10)', 'https://az511.com/'],
];
