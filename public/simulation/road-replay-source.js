import {readRoadHeights, decodeRoadFlood, ROAD_FLAGS} from './road-heights.js?v=dev';

// Frozen, immutable source binding. This module never consumes the live/current water layer.
export const ROAD_REPLAY = Object.freeze({
  runId: 'refined-full-41344983607',
  summarySha256: 'acd27dd8a64ace76f1c461956c72d845836f21de0e49b0ca6bea070d81da5454',
  roadManifestSha256: '5b087698cc920e21f8acf864d622f8d058d0ef0b069c8b75df4e5613a079a499',
  modelManifestSha256: '6b017b3c2ba0d78fdf760fee07cd2aca186fb99064232a050125ec84a1d7d720',
  thresholdM: 0.03,
});
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export async function checkedRoadBytes(url, {sha256, bytes, fetchImpl = fetch, signal} = {}) {
  if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw Error('Road artifact checksum required');
  const response = await fetchImpl(url, {signal});
  if (!response.ok) throw Error('Road artifact HTTP ' + response.status);
  const body = await response.arrayBuffer();
  if (bytes !== undefined && body.byteLength !== bytes) throw Error('Road artifact byte count mismatch');
  if (hex(await crypto.subtle.digest('SHA-256', body)) !== sha256) throw Error('Road artifact checksum mismatch');
  return body;
}
const json = bytes => JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
export async function readRoadFlood(url, options) {
  const bytes = await checkedRoadBytes(url, options);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return decodeRoadFlood(await new Response(stream).arrayBuffer());
}
export function roadStationReading(flood, sparseIndex, frameIndex, globalStation, station) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= flood.times.length) throw Error('Road replay frame out of range');
  if (!Number.isInteger(globalStation) || globalStation < 0 || globalStation >= flood.stationFace.length) throw Error('Road station out of range');
  const common = {globalStation, elevationM:station.elevationM, flags:station.flags, aboveRoadM:null};
  if (station.elevationM === null || !Number.isFinite(station.elevationM)) return {...common, status:'unknown_height'};
  if (flood.stationFace[globalStation] < 0) return {...common, status:'outside_model'};
  const k = sparseIndex.get(globalStation);
  // The sparse export records stations that exceeded the threshold somewhere in the run.
  // Absence and null cannot establish a dry road, a complete observation or safe passage.
  if (k === undefined) return {...common, status:'no_exceedance_recorded'};
  const value = flood.aboveRoadM(frameIndex, k); // k is NOT the global station ID.
  if (!Number.isFinite(value)) return {...common, status:'unknown_frame'};
  return {...common, status:value >= ROAD_REPLAY.thresholdM ? 'above_road' : 'below_threshold', aboveRoadM:value};
}
export function intersectsRoadBox(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }
export function selectRoadTiles(manifest, tileBounds, bounds, includeArea = false) {
  return manifest.files.filter(f => f.tier === 'routes' || includeArea && intersectsRoadBox(tileBounds[f.path] ?? f.box, bounds));
}
export async function loadRoadReplay({base = new URL('./', import.meta.url), fetchImpl = fetch, signal} = {}) {
  const root = new URL('data/road-heights/', base), run = ROAD_REPLAY.runId;
  const getJSON = async (path, sha256) => json(await checkedRoadBytes(new URL(path, root), {sha256, fetchImpl, signal}));
  const [manifest, summary, model] = await Promise.all([
    getJSON('manifest.json', ROAD_REPLAY.roadManifestSha256),
    getJSON(`flood/${run}/summary.json`, ROAD_REPLAY.summarySha256),
    getJSON('../refined-full-compact-41344983607/manifest.json', ROAD_REPLAY.modelManifestSha256),
  ]);
  if (manifest.kind !== 'road_height_package' || summary.runId !== run || model.runId !== run ||
      model.executionMode !== 'simulated_live_frozen_inputs' || model.status !== 'complete' ||
      summary.roadManifestSha256 !== ROAD_REPLAY.roadManifestSha256 || summary.packageManifestSha256 !== ROAD_REPLAY.modelManifestSha256) throw Error('Road replay source mismatch');
  if (summary.frames.path !== 'frames.bin.gz') throw Error('Unexpected road flood path');
  const flood = await readRoadFlood(new URL(`flood/${run}/${summary.frames.path}`, root), {...summary.frames, fetchImpl, signal});
  if (flood.runId !== run || flood.times.length !== model.frames.length || flood.times.some((t, i) => t !== model.frames[i].time) ||
      JSON.stringify(flood.stationOrder) !== JSON.stringify(manifest.files.map(f => f.path)) || flood.stationFace.length !== summary.stations) throw Error('Road replay station/time binding mismatch');
  const offsets = new Map(); let count = 0;
  for (const f of manifest.files) {
    if (!/^(routes|area_[a-z0-9_]+)\.bin\.gz$/.test(f.path) || !Number.isInteger(f.stationCount) || f.stationCount < 1) throw Error('Invalid road tile');
    offsets.set(f.path, count); count += f.stationCount;
  }
  if (count !== summary.stations) throw Error('Road station count mismatch');
  const sparseIndex = new Map();
  flood.everAboveStations.forEach((id, k) => {
    if (!Number.isInteger(id) || id < 0 || id >= count || sparseIndex.has(id)) throw Error('Invalid sparse road station');
    sparseIndex.set(id, k);
  });
  const cache = new Map(), pending = new Map();
  async function loadTile(path) {
    if (cache.has(path)) return cache.get(path);
    if (pending.has(path)) return pending.get(path);
    const file = manifest.files.find(f => f.path === path); if (!file) throw Error('Unknown road tile');
    const request = readRoadHeights(new URL(path, root), {sha256:file.sha256, fetchImpl, signal}).then(tile => {
      let id = offsets.get(path); const start = id;
      const lines = tile.lines.map((line, lineIndex) => {
        const stationStart = id; id += line.stations.length;
        return {...line, id:`${path}:${lineIndex}`, stationStart, file:path};
      });
      if (id - start !== file.stationCount || lines.length !== file.lineCount) throw Error('Road tile station order mismatch');
      cache.set(path, lines); return lines;
    }).finally(() => pending.delete(path));
    pending.set(path, request); return request;
  }
  function frame(index, {runId = run, sourceSha256 = ROAD_REPLAY.modelManifestSha256} = {}) {
    if (runId !== run || sourceSha256 !== ROAD_REPLAY.modelManifestSha256) throw Error('Road replay frame source mismatch');
    if (!Number.isInteger(index) || index < 0 || index >= flood.times.length) throw Error('Road replay frame out of range');
    return Object.freeze({runId:run, time:flood.times[index], index, sourceSha256,
      roadSha256:ROAD_REPLAY.roadManifestSha256, clockMode:'frozen_replay',
      readStation:(line, stationIndex) => roadStationReading(flood, sparseIndex, index, line.stationStart + stationIndex, line.stations[stationIndex])});
  }
  function retain(paths) { for (const path of cache.keys()) if (path !== 'routes.bin.gz' && !paths.includes(path)) cache.delete(path); }
  return {manifest, model, summary, times:flood.times, loadTile, frame, retain};
}

// Conservative ribbons: only consecutive wet stations form a wet segment. Unknown
// breaks and bridge provenance always split it. Isolated wet samples remain points.
export function roadRibbons(line, frame, {spacingM = 12} = {}) {
  const segments = [], points = [], stations = line.stations;
  if (!stations.length) return {segments, points};
  const readings = stations.map((_, i) => frame.readStation(line, i));
  const bridge = s => s.flags & (ROAD_FLAGS.deckLidar | ROAD_FLAGS.deckApproach | ROAD_FLAGS.structureUntagged);
  let active = null;
  function close() { if (active) { segments.push(active); active = null; } }
  for (let i = 1; i < stations.length; i++) {
    const a = readings[i - 1], b = readings[i];
    const status = a.status === b.status ? a.status : 'unknown_boundary';
    const provenance = bridge(stations[i - 1]) === bridge(stations[i]) ? bridge(stations[i]) : -1;
    const key = status + ':' + provenance;
    if (!active || active.key !== key) {
      close(); active = {key, status, flags:provenance, lineId:line.id, name:line.name || line.routeId || 'Road', kind:line.kind,
        coordinates:[[stations[i - 1].lon, stations[i - 1].lat]], elevationsM:[stations[i - 1].elevationM],
        firstStation:i - 1, lastStation:i, maximumAboveRoadM:null};
    }
    active.lastStation = i;
    if (status === 'above_road') active.maximumAboveRoadM = Math.max(active.maximumAboveRoadM ?? 0, a.aboveRoadM, b.aboveRoadM);
    // Keep local dips/crests, all wet/unknown boundaries, bridge stations, and ends.
    const s = stations[i], prev = stations[i - 1], next = stations[i + 1];
    const extremum = next && Number.isFinite(s.elevationM) && Number.isFinite(prev.elevationM) && Number.isFinite(next.elevationM) &&
      ((s.elevationM < prev.elevationM && s.elevationM <= next.elevationM) || (s.elevationM > prev.elevationM && s.elevationM >= next.elevationM));
    const lastKept = active.keptStation ?? active.firstStation;
    const nextStatus = readings[i + 1]?.status;
    if (i === stations.length - 1 || status !== nextStatus || provenance !== bridge(next ?? s) || bridge(s) || extremum || s.stationM - stations[lastKept].stationM >= spacingM) {
      active.coordinates.push([s.lon, s.lat]); active.elevationsM.push(s.elevationM); active.keptStation = i;
    }
    // Always end a segment at its actual boundary; never bridge a missing stretch.
    if (i === stations.length - 1 || readings[i + 1]?.status !== status || bridge(next ?? s) !== provenance) {
      const last = active.coordinates.at(-1); if (last[0] !== s.lon || last[1] !== s.lat) { active.coordinates.push([s.lon, s.lat]); active.elevationsM.push(s.elevationM); }
      close();
    }
  }
  close();
  readings.forEach((r, i) => {
    if (r.status === 'above_road' && readings[i - 1]?.status !== 'above_road' && readings[i + 1]?.status !== 'above_road') points.push({coordinate:[stations[i].lon, stations[i].lat], ...r, lineId:line.id, name:line.name || line.routeId || 'Road'});
  });
  return {segments:segments.filter(s => s.coordinates.length > 1), points};
}
