import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {ledgerRows,ledgerCoverage,caseName} from '../public/simulation/all-route-point-view.js';
const catalog=JSON.parse(readFileSync(new URL('../public/simulation/data/all-route-data/catalog.json',import.meta.url)));
const data={inventory:({routeId})=>catalog.entries.filter(e=>e.routeIds.includes(routeId))};
test('route detail keeps canonical shared identities and exact crossing scope',()=>{for(const route of new Set(catalog.entries.flatMap(e=>e.routeIds))){const rows=ledgerRows(data,route);assert.equal(new Set(rows.map(e=>e.id)).size,rows.length);}assert.equal(ledgerRows(data,'avra','brawley-dip').length,1);assert.equal(ledgerRows(data,'pr-gates','brawley-dip').length,0);});
test('coverage labels do not turn missing output into dry roads or confirmed dips',()=>{assert.match(ledgerCoverage({coverageStatus:'uncovered'}),/unknown/);assert.match(ledgerCoverage({coverageStatus:'partial_window'}),/missing/);assert.equal(caseName('all-routes-northern-v3-41382880257'),'Northern routes');assert.equal(caseName('all-routes-picture-rocks-v2-41382872468'),'Picture Rocks');});
