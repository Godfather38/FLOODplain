import { gridIdentity, validateTerrain, validateRain } from './model.js';
// NOAA wgrib2 -csv: reference time, valid time, field, level, longitude, latitude, value.
// Accept only the named MRMS instantaneous rate in documented mm/h. Never reinterpret hourly accumulations as rates.
export function importMrmsCsv(csv, terrain, source) {
  validateTerrain(terrain);
  if (typeof source !== 'string' || !/^https:\/\//.test(source)) throw new Error('Record an HTTPS source URL for the original MRMS files');
  if (csv.length > 8 * 1024 * 1024) throw new Error('Crop CSV to the local region first (8 MB limit)');
  const groups = new Map();
  for (const line of csv.trim().split(/\r?\n/)) {
    const match = /^"([^"]+)","([^"]+)","([^"]+)","([^"]+)",([^,]+),([^,]+),([^,]+)$/.exec(line);
    if (!match) throw new Error('Expected seven-column wgrib2 CSV without a header');
    const [, reference, valid, field, , longitude, latitude, value] = match;
    if (!['PrecipRate', 'MRMS_PrecipRate'].includes(field)) throw new Error(`Unsupported field ${field}; require MRMS PrecipRate in mm/h`);
    if (reference !== valid) throw new Error('Expected instantaneous analysis, not accumulation or forecast');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(valid)) throw new Error('Invalid UTC radar time');
    const start = valid.replace(' ', 'T') + 'Z', time = Date.parse(start);
    if (!Number.isFinite(time)) throw new Error('Invalid radar time');
    let lon = Number(longitude); if (lon > 180) lon -= 360;
    const lat = Number(latitude), rate = Number(value);
    if (![lon, lat, rate].every(Number.isFinite) || Math.abs(lon) > 180 || Math.abs(lat) > 90 || rate < 0 || rate > 500) throw new Error('Missing/invalid MRMS sample; cannot treat it as dry');
    if (!groups.has(time)) groups.set(time, []);
    const points = groups.get(time);
    if (points.some(p => p.lon === lon && p.lat === lat)) throw new Error('Duplicate radar pixel/time');
    points.push({ lon, lat, rate });
  }
  const frames = [...groups].sort(([a],[b]) => a-b).map(([time, points]) => ({
    start: new Date(time).toISOString(), durationMinutes: 2,
    rates: terrain.cells.map(cell => {
      const distances = points.map(p => ({ ...p, d: Math.hypot((p.lon-cell.lon)*Math.cos(cell.lat*Math.PI/180)*111320, (p.lat-cell.lat)*111320) })).sort((a,b) => a.d-b.d);
      if (!distances.length || distances[0].d > 850) throw new Error('Radar grid does not cover terrain (nearest pixel exceeds 850 m)');
      return distances[0].rate;
    })
  }));
  const rain = { schemaVersion: 1, units: 'mm/h', kind: 'radar-estimate', grid: gridIdentity(terrain), source,
    method: 'NOAA MRMS PrecipRate; nearest pixel <=850 m; forward-held for 2 min; no gap filling', frames };
  validateRain(rain, terrain);
  return rain;
}
