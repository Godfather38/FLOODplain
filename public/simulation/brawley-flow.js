// Opt-in native transport data. No visual solver, renderer or implicit time interpolation.
export function boundaryTransport(geometry, frame, maskName) {
  const mask = geometry.masks[maskName];
  if (!mask || mask.inwardSign.length !== geometry.edges.length || frame.qM2s.length !== geometry.edges.length) throw Error('Flow mask/shape mismatch');
  const boundary = [];
  let inflowM3s = 0, outflowM3s = 0;
  geometry.edges.forEach((edge, i) => {
    const sign = mask.inwardSign[i], q = frame.qM2s[i];
    if (![-1, 0, 1].includes(sign) || !Number.isFinite(q) || !(edge.widthM > 0)) throw Error('Invalid native transport');
    if (!sign) return;
    const signedInflowM3s = sign * q * edge.widthM;
    inflowM3s += Math.max(0, signedInflowM3s);
    outflowM3s += Math.max(0, -signedInflowM3s);
    boundary.push({edgeIndex: i, edgeId: edge.id, endpointsUTM: edge.endpointsUTM,
      inwardNormalEN: edge.positiveNormalEN.map(n => n * sign), signedInflowM3s});
  });
  return {boundary, inflowM3s, outflowM3s, netInflowM3s: inflowM3s - outflowM3s};
}

export async function loadBrawleyFlow({base = new URL('./', import.meta.url), scene, fetchImpl = fetch, signal} = {}) {
  async function json(url, sha, compressed = false) {
    const response = await fetchImpl(url, {signal});
    if (!response.ok) throw Error('Flow HTTP ' + response.status);
    const bytes = await response.arrayBuffer();
    if (sha) {
      const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (actual !== sha) throw Error('Flow checksum mismatch');
    }
    const raw = compressed ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes);
    return JSON.parse(raw);
  }
  const pointer = await json(new URL('data/brawley-flow-publication.json', base));
  if (pointer.path !== 'data/brawley-flow/manifest.json' || !/^[a-f0-9]{64}$/.test(pointer.sha256)) throw Error('Invalid flow pointer');
  const manifestURL = new URL(pointer.path, base);
  const manifest = await json(manifestURL, pointer.sha256);
  if (manifest.schema !== 'brawley-flow-v1' || manifest.runId !== 'refined-full-41344983607') throw Error('Unsupported native flow');
  if (!scene || scene.runId !== manifest.runId || scene.geometrySha256 !== manifest.sceneGeometrySha256) throw Error('Flow/source scene geometry mismatch');
  const geometry = await json(new URL(manifest.geometry.path, manifestURL), manifest.geometry.sha256, true);
  if (geometry.schema !== 'brawley-flow-geometry-v1' || geometry.edges.length !== manifest.exportedEdgeCount) throw Error('Invalid flow geometry');
  const sceneIDs = scene.cells.map(c => Number(c.nativeFaceId)).sort((a, b) => a - b);
  if (JSON.stringify(sceneIDs) !== JSON.stringify(geometry.masks.scene.nativeFaceIds)) throw Error('Flow/source scene faces mismatch');
  async function readFrame(index) {
    if (!Number.isInteger(index) || index < 0 || index >= manifest.frames.length) throw Error('Flow frame index out of range');
    const descriptor = manifest.frames[index];
    const frame = await json(new URL(descriptor.path, manifestURL), descriptor.sha256, true);
    if (frame.schema !== 'brawley-flow-frame-v1' || frame.time !== descriptor.time || frame.qM2s.length !== geometry.edges.length || !frame.qM2s.every(Number.isFinite)) throw Error('Flow frame identity/values mismatch');
    for (const mask of Object.keys(geometry.masks)) {
      const actual = boundaryTransport(geometry, frame, mask), expected = frame.budgets[mask];
      for (const key of ['inflowM3s', 'outflowM3s', 'netInflowM3s']) if (!expected || Math.abs(actual[key] - expected[key]) > 1e-10) throw Error('Flow boundary budget mismatch');
    }
    return frame;
  }
  function exactFrameIndex(time) {
    const index = manifest.frames.findIndex(f => f.time === time);
    if (index < 0) throw Error('No exact hourly flow snapshot; no implicit interpolation');
    return index;
  }
  return {manifest, geometry, readFrame, exactFrameIndex, boundaryTransport: (frame, mask) => boundaryTransport(geometry, frame, mask)};
}
