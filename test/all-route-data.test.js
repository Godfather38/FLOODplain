import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadAllRouteData} from '../public/simulation/all-route-data.js';
const base = 'https://app.invalid/simulation/';
const commit = '3dce053f1b22f80bbfb8cb9d3fbe46636fba6620';
const requests = [];
const fetchImpl = async url => {
  const u = new URL(url); requests.push(String(url));
  if (u.hostname === 'app.invalid') return new Response(fs.readFileSync('public' + u.pathname));
  const prefix = `/Godfather38/FLOODplain/${commit}/`;
  assert.equal(u.hostname, 'raw.githubusercontent.com'); assert.ok(u.pathname.startsWith(prefix));
  return new Response(execFileSync('C:\\Program Files\\Git\\cmd\\git.exe', ['show', commit + ':' + u.pathname.slice(prefix.length)], {maxBuffer: 64 * 1024 * 1024}));
};
const load = () => loadAllRouteData({base, now:'2026-11-03T00:00:00Z', fetchImpl});

test('ledger has actual full/partial/uncovered states; route membership never multiplies identity', async () => {
  const data = await load(), rows = data.inventory();
  assert.equal(rows.length, 458); assert.equal(new Set(rows.map(e => e.id)).size, 458);
  assert.deepEqual(data.catalog.counts, {full_window:234, partial_window:165, uncovered:59});
  assert.equal(rows.filter(e => e.overlap).length, 24);
  assert.ok(rows.every(e => e.modelOutputs.every(o => o.freshness.currentWeather === false && o.freshness.temporalStatus === 'expired')));
  for (const e of rows) for (const o of e.modelOutputs) if (o.nativeFaceId !== null) assert.equal(o.faceKey, `${o.runId}:${o.nativeFaceId}`);
  for (const route of new Set(rows.flatMap(e => e.routeIds))) assert.deepEqual(data.inventory({routeId:route}).map(e => e.id), rows.filter(e => e.routeIds.includes(route)).map(e => e.id));
  assert.ok(data.catalog.openItems.some(e => e.kind === 'missing_selected_terrain' && e.uncoveredEvidenceIdentities === 59));
});

test('partial missing end is unknown, not zero, extrapolated or silently replaced', async () => {
  const data = await load(), descriptor = data.catalog.cases.find(c => c.status === 'partial');
  assert.equal(descriptor.times.length, 56); assert.equal(descriptor.validTo,'2026-11-02T06:45:00Z');
  const c = await data.openCase(descriptor.runId), entry = data.inventory().find(e => e.coverageStatus === 'partial_window');
  const before = requests.length;
  assert.equal((await c.readPoint(entry.id,'2026-11-02T07:00:00Z')).status,'missing_frame');
  await assert.rejects(() => c.readFrame('2026-11-02T07:00:00Z'), /Missing native frame/);
  assert.equal(requests.length, before);
  const point = await c.readPoint(entry.id,'2026-11-02T06:45:00Z');
  assert.equal(point.status,'available'); assert.equal(point.clearance,null);
  const uncovered = data.inventory().find(e => e.coverageStatus === 'uncovered');
  const gates = await data.openCase(data.catalog.cases.find(c => c.sourceRunId === '41382857288').runId);
  assert.deepEqual((await gates.readPoint(uncovered.id,'2026-11-02T07:00:00Z')).depthM,null);
});

test('actual overlap conflict stays separate with exact source surfaces', async () => {
  const data = await load();
  const id = 'terrain-minimum-f39cdaa394b1', time = '2026-11-02T02:45:00Z';
  const entry = data.inventory().find(e => e.id === id);
  assert.equal(entry.overlap.status,'unresolved'); assert.equal(entry.overlap.selection,null);
  const outputs = [];
  for (const o of entry.modelOutputs) outputs.push(await (await data.openCase(o.runId)).readPoint(id,time));
  assert.equal(outputs.length,2); assert.notEqual(outputs[0].faceKey,outputs[1].faceKey);
  assert.equal(Math.abs(outputs[0].waterSurfaceM - outputs[1].waterSurfaceM),1.4583740234375);
  assert.ok(outputs.every(p => p.roadDepthValidated === false));
});

test('each case uses its own checked compact geometry/frame and agrees with point output',
  {skip: !process.env.FLOODPLAIN_NATIVE_CHECK && 'Set FLOODPLAIN_NATIVE_CHECK=1 with the pinned source commit fetched'}, async () => {
  const data = await load();
  for (const descriptor of data.catalog.cases) {
    await (async () => {
      const c = await data.openCase(descriptor.runId), time = descriptor.validTo;
      const entry = data.inventory().find(e => e.modelOutputs.some(o => o.runId === descriptor.runId && o.status === 'native_output_available'));
      const point = await c.readPoint(entry.id,time), geometry = await c.geometry(), frame = await c.readFrame(time);
      assert.equal(geometry.cells.length,descriptor.nativeFaces);
      assert.equal(frame.runId,descriptor.runId);
      const index = geometry.cells.findIndex(f => f.nativeFaceId === point.nativeFaceId);
      assert.ok(index >= 0);
      assert.equal(frame.nativeVolumeM3[index],point.nativeVolumeM3);
      assert.equal(frame.waterSurfaceM[index],point.waterSurfaceM);
      assert.equal(frame.depthM[index],point.depthM);
      assert.equal(c.terrain.status,'unavailable');
    })();
    global.gc?.();
  }
});

test('catalog corruption is rejected', async () => {
  const corrupt = async url => {
    const bytes = fs.readFileSync('public' + new URL(url).pathname);
    if (String(url).endsWith('catalog.json')) bytes[10] ^= 1;
    return new Response(bytes);
  };
  await assert.rejects(() => loadAllRouteData({base,now:'2026-11-03T00:00:00Z',fetchImpl:corrupt}), /checksum/);
});
