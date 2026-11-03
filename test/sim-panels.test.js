import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crossingWord,deckHtml,scoreboardHtml,methodsHtml} from '../public/sim-panels.js';
import {RUNS} from '../public/preview/geo3d/src/runs.js';
const read=f=>readFileSync(new URL('../public/'+f,import.meta.url),'utf8');

test('crossing words stay neutral: water over the road, water near it, or none',()=>{
 assert.equal(crossingWord(.5).cls,'over');assert.match(crossingWord(.5).text,/1\.6 ft over the road/);
 assert.equal(crossingWord(-.1).cls,'near');assert.equal(crossingWord(-1).cls,'dry');assert.equal(crossingWord(NaN).cls,'none');
 for(const v of [1,-.1,-2,NaN])assert.doesNotMatch(crossingWord(v).text,/\bsafe\b/i);
});

test('every run is a scenario card with its own peak numbers, and the loaded one says so',()=>{
 for(const r of RUNS)assert.ok(r.card?.short&&r.card?.kind&&r.card?.blurb,r.id);
 const html=deckHtml(RUNS,'stress',null);
 assert.equal((html.match(/data-sim-load=/g)??[]).length,RUNS.length);
 assert.match(html,/data-sim-load="stress" aria-pressed="true">Loaded/);
 assert.match(html,/65,000 ft³\/s/);assert.match(html,/130,000 ft³\/s/);
});

test('the scoreboard counts crossings with water over the road this hour, deepest first',()=>{
 const c=(id,over,deck=false)=>({fp:{id,short:id},inside:true,road:{m:600,deck},over});
 const html=scoreboardHtml([c('a',[-1,.4]),c('b',[-1,-.1],true),c('c',[-2,-2]),{fp:{id:'d'},inside:false}],1,[0,3600e3]);
 assert.match(html,/<b>1<\/b><span>of 3 crossings with water over the road this hour/);
 assert.ok(html.indexOf('data-sim-crossing="a"')<html.indexOf('data-sim-crossing="b"'));
 assert.match(html,/1 crossing is outside the model area/);
 assert.match(scoreboardHtml(null,0,[]),/Loading road and bridge-deck heights/);
});

test('the methods note cites its sources and reads the loaded run',()=>{
 const run={def:{card:{short:'100-year storm'}},series:[{time:0,wetKm2:1,deepM:1,rainMmH:10,inflowM3s:100},{time:3600e3,wetKm2:5,deepM:2,rainMmH:0,inflowM3s:200}]};
 const html=methodsHtml(run,null);
 for(const s of ['Leijnse','Bates','Nobre','Atlas 14','HRRR','100-year storm','5.0 km²'])assert.match(html,new RegExp(s));
});

test('the Map tab offers the scenarios, crossings, routes and model panels and the run timeline',()=>{
 const app=read('map-app.js');
 for(const k of ['scenarios','crossings','routes','model'])assert.match(app,new RegExp(`\\['${k}','`));
 for(const s of ['data-m-scenarios','data-m-hud','data-m-timeline','data-m-try'])assert.match(app,new RegExp(s));
 assert.match(read('index.html'),/sim\.css\?v=dev/);
});
