// I-10 underpasses people asked about. These aren't on the Avra or Picture Rocks routes, so they
// get their own screen and don't change route numbers. No public water sensor has been found in any of them: the rating
// comes from the nearest county rain gauges, county closures and NWS flood alerts, through the
// same rateFailurePoint as every crossing. Locations are the midpoints of each exit's ramps.
export const UNDERPASSES = [
  { id: 'up-marana', short: 'Marana Rd', name: 'Marana Rd at I-10', where: 'Exit 236, Marana', kind: 'dip', lat: 32.46197, lon: -111.21616, rain: { local: ['6110'] } },
  { id: 'up-orange-grove', short: 'Orange Grove Rd', name: 'Orange Grove Rd at I-10', where: 'Exit 250, Tucson', kind: 'dip', lat: 32.3220, lon: -111.0513, rain: { local: ['6010', '1200', '1210'] } },
  { id: 'up-grant', short: 'Grant Rd', name: 'Grant Rd at I-10', where: 'Exit 256, Tucson', kind: 'dip', lat: 32.24945, lon: -110.99212, rain: { local: ['6030', '6160', '6170'] } },
  { id: 'up-speedway', short: 'Speedway Blvd', name: 'Speedway Blvd at I-10', where: 'Exit 257, Tucson', kind: 'dip', lat: 32.23593, lon: -110.98445, rain: { local: ['6030', '6170', '6120'] } },
];
