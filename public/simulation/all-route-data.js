import {acceptQuadtreeGeometry, acceptQuadtreeFrame, readQuadtreeArtifact} from './quadtree-output.js?v=dev';
import {modelFreshness} from './scene-data-contract.js?v=dev';

// Additive opt-in consumers. No renderer registration, source ranking or route score.
export async function loadAllRouteData({base = new URL('./', import.meta.url), now, fetchImpl = fetch, signal} = {}) {
  modelFreshness(null, now); // Require an explicit assessment clock.
  async function readJSON(url, sha) {
    const response = await fetchImpl(url, {signal});
    if (!response.ok) throw Error('All-route HTTP ' + response.status);
    const bytes = await response.arrayBuffer();
    if (sha) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== sha) throw Error('All-route checksum mismatch');
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const pointer = await readJSON(new URL('data/all-route-publication.json', base));
  if (pointer.path !== 'data/all-route-data/catalog.json' || !/^[a-f0-9]{64}$/.test(pointer.sha256)) throw Error('Invalid all-route pointer');
  const catalogURL = new URL(pointer.path, base);
  const catalog = await readJSON(catalogURL, pointer.sha256);
  if (catalog.schema !== 'all-route-consumers-v1') throw Error('Unsupported route catalog');
  const entries = new Map(catalog.entries.map(e => [e.id, e]));
  const cases = new Map(catalog.cases.map(c => [c.runId, c]));
  function inventory({routeId, time} = {}) {
    return catalog.entries.filter(e => !routeId || e.routeIds.includes(routeId)).map(e => ({...e,
      modelOutputs: e.modelOutputs.map(o => ({...o, freshness: modelFreshness(o, now),
        requestedTimeStatus: time === undefined ? 'not_requested' : o.status !== 'native_output_available' ? 'outside_coverage' :
          cases.get(o.runId).times.includes(time) ? 'available' : 'missing_frame'})),
      overlap: e.overlappingNativeOutputs ? {status: catalog.overlap.status, selection: null, averaging: false,
        comparison: catalog.overlap.readout.maximumAbsoluteDifferenceByIdentity.find(r => r.id === e.id) ?? null} : null}));
  }
  async function openCase(runId) {
    const descriptor = cases.get(runId);
    if (!descriptor) throw Error('Explicit known package runId required');
    let manifestPromise, geometryPromise, pointsPromise;
    const manifest = () => manifestPromise ??= readJSON(descriptor.manifest.url, descriptor.manifest.sha256).then(m => {
      if (m.runId !== runId || m.status !== descriptor.status || m.geometry.sha256 !== descriptor.geometrySha256 ||
          JSON.stringify(m.frames.map(f => f.time)) !== JSON.stringify(descriptor.times)) throw Error('Case identity/window mismatch');
      return m;
    }).catch(error => {manifestPromise = null; throw error;});
    const geometry = () => geometryPromise ??= manifest().then(async m => acceptQuadtreeGeometry(m,
      await readQuadtreeArtifact(descriptor.manifest.url, m.geometry, {fetchImpl, signal})))
      .catch(error => {geometryPromise = null; throw error;});
    function exactIndex(time) {
      const index = descriptor.times.indexOf(time);
      if (index < 0) throw Error('Missing native frame; no extrapolation or substitution');
      return index;
    }
    async function readFrame(time) {
      const index = exactIndex(time), m = await manifest(), g = await geometry();
      return acceptQuadtreeFrame(m, g, await readQuadtreeArtifact(descriptor.manifest.url, m.frames[index],
        {fetchImpl, signal, geometry: g}), time);
    }
    const pointData = () => pointsPromise ??= readQuadtreeArtifact(catalogURL, descriptor.points, {fetchImpl, signal}).then(p => {
      if (p.schema !== 'all-route-points-v1' || p.runId !== runId || JSON.stringify(p.times) !== JSON.stringify(descriptor.times)) throw Error('Point case/window mismatch');
      return p;
    }).catch(error => {pointsPromise = null; throw error;});
    async function readPoint(id, time) {
      const entry = entries.get(id);
      if (!entry) throw Error('Unknown evidence identity');
      const output = entry.modelOutputs.find(o => o.runId === runId);
      if (!output || output.status !== 'native_output_available') return {id, runId, time, status: 'outside_coverage', depthM: null, clearance: null};
      if (!descriptor.times.includes(time)) return {id, runId, time, status: 'missing_frame', depthM: null, clearance: null};
      const p = (await pointData()).points[id];
      if (!p || p.faceKey !== output.faceKey || !(p.areaM2 > 0)) throw Error('Point/native face mismatch');
      const sample = p.samples[exactIndex(time)];
      if (!sample || sample.length !== 2 || sample.some(v => v !== null && !Number.isFinite(v))) throw Error('Invalid native point values');
      const [nativeVolumeM3, waterSurfaceM] = sample;
      return {id, runId, faceKey: p.faceKey, nativeFaceId: p.nativeFaceId, time,
        status: nativeVolumeM3 === null || waterSurfaceM === null ? 'missing_quantity' : 'available',
        nativeVolumeM3, fullCellAreaM2: p.areaM2, depthM: nativeVolumeM3 === null ? null : Math.max(0, nativeVolumeM3) / p.areaM2,
        waterSurfaceM, verticalDatum: 'NAVD88', roadDepthValidated: false, clearance: null};
    }
    return {descriptor, freshness: modelFreshness(descriptor, now), manifest, geometry, readFrame, readPoint,
      terrain: descriptor.terrainDisplay, flow: {status: 'unavailable', velocityMps: null}};
  }
  return {catalog, inventory, openCase};
}

