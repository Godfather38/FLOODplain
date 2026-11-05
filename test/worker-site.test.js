import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSite} from '../worker/site.js';

const req = (path, method = 'GET') => new Request('https://example.test' + path, {method});
test('frontend URLs and queries pass unchanged to assets, never the backend', async () => {
  const seen = [];
  const site = createSite({fetch() { throw Error('unexpected API'); }});
  const env = {ASSETS: {fetch(r) { seen.push(r); return new Response('asset'); }}};
  for (const path of ['/', '/index.html', '/app.js?v=dev', '/data/routes.geojson', '/?feed=all', '/apiary']) {
    const request = req(path);
    assert.equal(await (await site.fetch(request, env)).text(), 'asset');
    assert.equal(seen.at(-1), request);
  }
  assert.equal((await site.fetch(req('/app.js', 'HEAD'), env)).status, 200);
});
test('missing assets preserve 404 and never become synthetic backend health', async () => {
  const response = new Response('missing', {status:404});
  assert.equal(await createSite().fetch(req('/missing.js'), {ASSETS:{fetch:()=>response}}), response);
});
test('only exact API endpoint dispatches, with context and bindings preserved', async () => {
  const env = {}, ctx = {};
  const site = createSite({fetch(r,e,c) {
    assert.equal(e,env); assert.equal(c,ctx);
    return Response.json({feed:new URL(r.url).searchParams.get('feed')});
  }});
  for (const path of ['/api?feed=health','/api/?feed=health']) {
    assert.deepEqual(await (await site.fetch(req(path),env,ctx)).json(),{feed:'health'});
  }
  for (const path of ['/api/missing','/api/index.html','/api/%2Fanything']) {
    const r=await site.fetch(req(path),env,ctx);
    assert.equal(r.status,404); assert.match(r.headers.get('content-type'),/json/);
  }
});
test('integrated API keeps writes and real AZ511 calls disabled', async () => {
  const site=createSite();
  assert.equal((await site.fetch(req('/api','POST'),{})).status,405);
  assert.equal((await site.fetch(req('/api?action=push'),{})).status,405);
  assert.equal((await site.fetch(req('/','POST'),{})).status,405);
  const result=await (await site.fetch(req('/api?feed=az511'),{})).json();
  assert.equal(result.status,'disabled');
  assert.equal(result.roadEvents,null);
  assert.equal('scheduled' in site,false);
});
test('root configuration packages frontend and reserves API paths without SPA fallback', () => {
  const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(config.name,'floodplain');
  assert.equal(config.main,'worker/site.js');
  assert.deepEqual(config.assets,{directory:'./public',binding:'ASSETS',run_worker_first:['/api','/api/*'],not_found_handling:'none'});
  assert.deepEqual(config.vars,{PUBLIC_LIVE:'false',AZ511_ENABLED:'false'});
  assert.deepEqual(config.triggers.crons,[]);
  assert.equal(config.routes,undefined);
});
