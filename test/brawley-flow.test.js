import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadBrawleyFlow, boundaryTransport} from '../public/simulation/brawley-flow.js';
const scene = JSON.parse(fs.readFileSync('public/simulation/data/scene-contract/brawley-scene.json'));
const base = 'https://example.invalid/simulation/';
const fetchImpl = async url => new Response(fs.readFileSync(path.join('public', new URL(url).pathname)));

test('all hourly flows preserve physical edge incidence, source signs and boundary budgets', async () => {
  const loaded = await loadBrawleyFlow({base, scene, fetchImpl});
  const {manifest, geometry} = loaded;
  assert.equal(manifest.frames.length, 14);
  assert.equal(manifest.physicalEdgeCount, 800462);
  assert.equal(manifest.waterFrames.count, 57);
  assert.equal(manifest.velocity, null);
  assert.equal(geometry.masks.junction160.nativeFaceIds.length, 676);
  assert.equal(new Set(geometry.edges.map(e => e.id)).size, geometry.edges.length);
  for (const [name, mask] of Object.entries(geometry.masks)) {
    const faces = new Set(mask.nativeFaceIds);
    geometry.edges.forEach((e, i) => {
      assert.ok(e.solverIndexZeroBased < manifest.physicalEdgeCount);
      assert.equal(e.id, 'q:' + e.solverIndexZeroBased);
      assert.equal(mask.inwardSign[i], Number(faces.has(e.toFace)) - Number(faces.has(e.fromFace)));
      assert.equal(Math.hypot(e.endpointsUTM[1][0] - e.endpointsUTM[0][0], e.endpointsUTM[1][1] - e.endpointsUTM[0][1]), e.widthM);
    });
    for (let index = 0; index < 14; index++) {
      const frame = await loaded.readFrame(index);
      let incidence = 0;
      geometry.edges.forEach((e, i) => {const q = frame.qM2s[i] * e.widthM; if (faces.has(e.fromFace)) incidence -= q; if (faces.has(e.toFace)) incidence += q;});
      assert.ok(Math.abs(incidence - frame.budgets[name].netInflowM3s) < 1e-10);
    }
  }
  const frame = await loaded.readFrame(loaded.exactFrameIndex('2026-11-01T22:00:00Z'));
  const budget = loaded.boundaryTransport(frame, 'junction160');
  assert.ok(Math.abs(budget.inflowM3s - .6156542878073878) < 1e-12);
  assert.ok(Math.abs(budget.outflowM3s - .6151355654090196) < 1e-12);
  const north = geometry.edges.findIndex(e => e.solverIndexZeroBased === 537505);
  assert.deepEqual([geometry.edges[north].fromFace, geometry.edges[north].toFace], [267134, 267135]);
  assert.deepEqual(geometry.edges[north].positiveNormalEN, [0, 1]);
  assert.equal(frame.qM2s[north], .019177289679646492);
  assert.throws(() => loaded.exactFrameIndex('2026-11-01T22:15:00Z'), /No exact/);
  await assert.rejects(() => loaded.readFrame(-1), /index/);
});

test('positive inflow, reverse flow and internal-edge cancellation', () => {
  const geometry = {edges: [{id:'a',fromFace:1,toFace:2,widthM:2,positiveNormalEN:[1,0],endpointsUTM:[[0,0],[0,2]]}], masks:{target:{inwardSign:[1]}}};
  assert.equal(boundaryTransport(geometry, {qM2s:[3]}, 'target').inflowM3s, 6);
  assert.equal(boundaryTransport(geometry, {qM2s:[-3]}, 'target').outflowM3s, 6);
  geometry.masks.target.inwardSign = [0];
  assert.equal(boundaryTransport(geometry, {qM2s:[3]}, 'target').boundary.length, 0);
});

test('loader rejects changed source geometry and corrupted compressed bytes', async () => {
  await assert.rejects(() => loadBrawleyFlow({base,scene:{...scene,geometrySha256:'wrong'},fetchImpl}), /geometry mismatch/);
  const corrupt = async url => {
    const bytes = fs.readFileSync(path.join('public', new URL(url).pathname));
    if (String(url).endsWith('geometry.json.gz')) bytes[20] ^= 1;
    return new Response(bytes);
  };
  await assert.rejects(() => loadBrawleyFlow({base,scene,fetchImpl:corrupt}), /checksum/);
});
