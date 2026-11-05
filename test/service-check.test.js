import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkJson, checkService, validStatus, validRiverFeed } from '../tools/check_service.mjs';
const url = 'https://example.test/private-url';
const good = { ok: true, service: 'wash-watch-alerts' };
const opts = overrides => ({ log() {}, pause: async () => {}, delayMs: 0, ...overrides });

test('service check recovers from empty, HTML, and HTTP failures without logging response data', async () => {
  for (const bad of [() => new Response(''), () => new Response('<html>SECRET</html>'), () => new Response('SECRET', { status: 503 })]) {
    let calls = 0; const logs = [];
    assert.deepEqual(await checkJson(url, 'Service', validStatus, opts({
      fetcher: async () => ++calls === 1 ? bad() : Response.json(good), log: s => logs.push(s),
    })), good);
    assert.equal(calls, 2); assert.doesNotMatch(logs.join('\n'), /SECRET|private-url/);
  }
});
test('service check fails after bounded retries, without exposing exception messages', async () => {
  let calls = 0, pauses = 0; const logs = [];
  await assert.rejects(checkJson(url, 'Service', validStatus, opts({
    fetcher: async () => { calls++; throw Error('SECRET'); },
    pause: async () => { pauses++; }, log: s => logs.push(s),
  })), /3 attempts; upload is not retried/);
  assert.equal(calls, 3); assert.equal(pauses, 2); assert.doesNotMatch(logs.join('\n'), /SECRET/);
});
test('service check aborts timed-out requests', async () => {
  let aborted = false;
  await assert.rejects(checkJson(url, 'Service', validStatus, opts({ attempts: 1, timeoutMs: 5,
    fetcher: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('SECRET')); })),
  })), /1 attempts/);
  assert.equal(aborted, true);
});
test('service check rejects oversized or wrong-shape JSON responses', async () => {
  for (const [body, maxBytes] of [[{ ok: true }, 1000], [good, 3]]) {
    await assert.rejects(checkJson(url, 'Service', validStatus, opts({ attempts: 1, maxBytes, fetcher: async () => Response.json(body) })), /verification failed/);
  }
  assert.equal(validRiverFeed({ fetched_at: 'invalid', series: {} }), false);
  assert.equal(validRiverFeed({ fetched_at: new Date().toISOString(), series: [] }), false);
  assert.equal(validRiverFeed({ fetched_at: new Date().toISOString(), series: {} }), false);
});
test('service check reads status then river feed without invoking an upload', async () => {
  const requests = [];
  await checkService(url, opts({ fetcher: async target => {
    requests.push(String(target));
    return Response.json(requests.length === 1 ? good : { fetched_at: '2026-11-05T10:35:00Z', series: { gauge: null } });
  } }));
  assert.deepEqual(requests, [url, `${url}?feed=usgs`]);
});
test('deployment invokes bounded checker without adding upload triggers', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy-service.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node tools\/check_service\.mjs/);
  assert.doesNotMatch(workflow, /curl -sSL/);
  assert.match(workflow, /paths: \['apps-script\/\*\*', 'public\/config.js', 'public\/logic.js', 'public\/engine.js', 'tools\/build_gas.mjs'\]/);
});
