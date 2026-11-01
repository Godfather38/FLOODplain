import test from 'node:test';import assert from 'node:assert/strict';
import {createLiveFetch} from '../public/live-map.js';
import {acceptCurrentManifest} from '../public/simulation/current-inundation.js';
test('current feed requests share work and preserve cached source timestamps',async()=>{let count=0,clock=1000;const get=createLiveFetch(async()=>{count++;return new Response('{"issuedAt":"2026-11-01T12:00:00Z"}')},()=>clock);const [a,b]=await Promise.all([get('x'),get('x')]);assert.equal(count,1);assert.equal((await a.json()).issuedAt,(await b.json()).issuedAt);clock+=300001;await get('x');assert.equal(count,2)});
test('rate limiting is not retried or replaced with a false fresh response',async()=>{let count=0;const get=createLiveFetch(async()=>{count++;return new Response('',{status:429})});await assert.rejects(get('x'),/429/);assert.equal(count,1)});
test('absent current SFINCS remains unavailable',()=>assert.equal(acceptCurrentManifest({schemaVersion:1,kind:'current_inundation_manifest',status:'unavailable'}).status,'unavailable'));
