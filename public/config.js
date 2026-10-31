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
      { site: '09486520', kind: 'bridge', role: 'Santa Cruz River, under the Trico-Marana bridge' },
      { site: '09487000', kind: 'bridge', role: 'Brawley Wash, 20 mi upstream of the Los Robles bridge on Trico Rd' },
    ],
    blindSpots: [
      'Los Robles Wash bridge on Trico Rd (0.4 mi south of Silverbell): no gauge there. Rain on the valley can fill it unseen.',
    ],
  },
  avra: {
    gauges: [
      { site: '09486509', kind: 'bridge', role: 'Santa Cruz River, under the Avra Valley Rd bridge' },
      { site: '09487000', kind: 'dip', role: 'Brawley Wash, 20 mi upstream of the Avra Valley Rd crossing' },
    ],
    blindSpots: [
      'Brawley Wash crossing (0.55 mi east of Trico): probably a dip. Rain on the valley floods it with no gauge warning. Skip this route if it rained overnight.',
      'Two unnamed wash crossings (0.4 mi west of El Paso Gas Rd; 0.65 mi west of Sanders): unknown whether bridge or dip, no gauge.',
    ],
  },
  'silverbell-north': {
    gauges: [
      { site: '09486515', kind: 'bridge', role: 'Santa Cruz River, under the Sanders Rd bridge' },
      { site: '09487000', kind: 'bridge', role: 'Brawley Wash, 20 mi upstream of the Los Robles bridge on Trico Rd' },
    ],
    blindSpots: [
      'Los Robles Wash bridge on Trico Rd: no gauge there.',
      'Silverbell Rd puddling/washouts after rain: shallow, but slow down.',
    ],
  },
  'silverbell-south': {
    gauges: [
      { site: '09486509', kind: 'bridge', role: 'Santa Cruz River, under the Avra Valley Rd bridge' },
      { site: '09487000', kind: 'bridge', role: 'Brawley Wash, 20 mi upstream of the Los Robles bridge on Trico Rd' },
    ],
    blindSpots: [
      'Los Robles Wash bridge on Trico Rd: no gauge there.',
      'Silverbell Rd puddling/washouts after rain: shallow, but slow down.',
    ],
  },
};

export const LINKS = [
  ['Pima County ALERT rain/stream map', 'https://alertmap.rfcd.pima.gov/Gmap/Gmap.html'],
  ['Pima County road closures', 'https://www.pima.gov/898'],
  ['NWS Tucson', 'https://www.weather.gov/twc/'],
  ['AZ 511 (I-10)', 'https://az511.com/'],
];
