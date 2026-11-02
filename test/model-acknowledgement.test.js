// Modeled and simulated water must be clearly not real, through one dismissible notice and the
// wording already on screen. Permanent banners and tags are not used. See docs/LIVE-DATA-ONLY.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ACKNOWLEDGEMENTS,showAcknowledgement,isAcknowledged,resetForTest} from '../public/model-acknowledgement.js';

const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');
const memoryStorage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}};
function fakeDocument(){
 const el=(tag)=>{const n={tag,dataset:{},children:[],listeners:{},setAttribute(){},append(...c){n.children.push(...c)},remove(){n.removed=true},focus(){},showModal(){n.opened=true},close(){n.listeners.close?.()},addEventListener(t,f){n.listeners[t]=f}};return n};
 const doc={created:[],head:el('head'),body:el('body'),querySelector:()=>null,createElement(t){const n=el(t);doc.created.push(n);return n}};
 return doc;
}
const dialogOf=doc=>doc.created.find(n=>n.tag==='dialog');
const text=(n)=>n.children.map(c=>c.textContent).join(' | ');

test('simulated water uses the exact agreed wording',()=>{
 assert.equal(ACKNOWLEDGEMENTS.simulated.title,'This water is simulated');
 assert.equal(ACKNOWLEDGEMENTS.simulated.body,"It is a 3D model, not real conditions or a forecast. If you see water on a real road, turn around, don't drown.");
 assert.match(read('model-acknowledgement.js'),/textContent='Got it'/);
});
test('HAND and Test flood say which kind they are, in the same neutral tone',()=>{
 assert.match(ACKNOWLEDGEMENTS.estimate.title,/model estimate/);
 assert.match(ACKNOWLEDGEMENTS.savedRun.title,/saved run/);
 for(const {title,body} of Object.values(ACKNOWLEDGEMENTS)){
  assert.match(body,/If you see water on a real road, turn around, don't drown\.$/);
  assert.doesNotMatch(title+body,/\bsafe\b|\bdeadly\b|\bdanger/i);
 }
});
test('it shows once, and stays gone after dismissing',()=>{
 resetForTest();const storage=memoryStorage(),doc=fakeDocument();
 assert.equal(showAcknowledgement('simulated',{document:doc,storage}),true);
 const dialog=dialogOf(doc);assert.equal(dialog.opened,true);assert.match(text(dialog),/This water is simulated.*Got it/);
 assert.equal(showAcknowledgement('simulated',{document:doc,storage}),false,'no second copy while open');
 dialog.children.at(-1).onclick();assert.equal(dialog.removed,true);
 assert.equal(isAcknowledged('simulated',storage),true);
 resetForTest();
 const later=fakeDocument();assert.equal(showAcknowledgement('simulated',{document:later,storage}),false,'still gone on a new visit');
 assert.equal(later.created.length,0);
});
test('a different kind still shows, one at a time',()=>{
 resetForTest();const storage=memoryStorage(),doc=fakeDocument();
 showAcknowledgement('savedRun',{document:doc,storage});showAcknowledgement('simulated',{document:doc,storage});
 const dialogs=()=>doc.created.filter(n=>n.tag==='dialog');
 assert.equal(dialogs().length,1);dialogs()[0].close();
 assert.equal(dialogs().length,2);assert.equal(dialogs()[1].dataset.kind,'simulated');dialogs()[1].close();
});
test('blocked storage still dismisses for this page and never breaks the map',()=>{
 resetForTest();const storage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}},doc=fakeDocument();
 assert.equal(showAcknowledgement('estimate',{document:doc,storage}),true);dialogOf(doc).close();
 assert.equal(showAcknowledgement('estimate',{document:doc,storage}),false);
 resetForTest();
});
test('Got it saves the dismissal even if the close event never arrives',()=>{
 resetForTest();const storage=memoryStorage(),doc=fakeDocument();
 showAcknowledgement('savedRun',{document:doc,storage});
 const dialog=dialogOf(doc);dialog.close=()=>{};dialog.open=true;
 dialog.children.at(-1).onclick();
 assert.equal(dialog.removed,true);assert.equal(storage.getItem('floodplain-ack-savedRun'),'1');
 resetForTest();assert.equal(showAcknowledgement('savedRun',{document:fakeDocument(),storage}),false);
 const again=fakeDocument();assert.equal(showAcknowledgement('simulated',{document:again,storage}),true,'nothing left blocking the next notice');
 dialogOf(again).children.at(-1).onclick();resetForTest();
});
test('every simulated or modeled view opens the notice',()=>{
 assert.match(read('live-map.js'),/showAcknowledgement\('estimate'\)/);
 assert.match(read('inundation/app.js'),/showAcknowledgement\('estimate'\)/);
 const layers=read('simulation/map-layers.js');
 assert.match(layers,/showAcknowledgement\('savedRun'\)/);
 assert.match(layers,/next==='3d'\)showAcknowledgement\('simulated'\)/);
});
test('no permanent banner or tag marks simulated content',()=>{
 const files=['app.js','live-map.js','live-map.css','accessible-ui.css','simulation/test-flood.js','simulation/map-layers.js','simulation/map-shell.js','simulation/map-layers.css'];
 for(const f of files)assert.doesNotMatch(read(f),/test-flood-banner|mountTestFloodBanner|flood-tag">/,f);
});
test('existing wording says simulated, modeled or estimated',()=>{
 const shell=read('simulation/map-shell.js'),layers=read('simulation/map-layers.js'),live=read('live-map.js'),geo=read('simulation/geographic-view.js'),app=read('app.js'),page=read('inundation/index.html');
 assert.match(shell,/Simulated water: saved model run, Nov 1–2, 2026 · not real conditions/);
 assert.match(shell,/'Saved model run'\)\+' issued '/);
 assert.match(layers,/Simulated time · Arizona/);assert.match(layers,/'Flat map':'3D simulation'/);assert.match(layers,/Simulated water \(saved SFINCS run\)/);
 assert.match(live,/Modeled water estimate · HAND/);assert.match(live,/Model estimate valid /);assert.match(live,/Modeled water depth estimate \(ft\)/);
 assert.match(geo,/Simulated water: 10 m terrain-intersected display/);assert.match(geo,/Simulated water\. Terrain intersection/);assert.match(geo,/ft simulated cell-average depth/);
 assert.match(app,/\['Simulated flood', ?'Saved model run, not real conditions'\]/);assert.match(app,/Live readings and model estimates/);
 assert.match(page,/<h1>Modeled flood extent estimate<\/h1>/);assert.match(page,/<title>FLOODplain modeled flood extent estimate<\/title>/);assert.match(page,/Modeled at this flow/);
 assert.match(read('index.html'),/Experimental: modeled flood extent estimate/);
});
test('a Map screen with 3D not opened loads no 3D or terrain files',()=>{
 const app=read('app.js'),layers=read('simulation/map-layers.js');
 for(const s of [app,layers,read('simulation/map-shell.js'),read('live-map.js'),read('index.html')]){
  assert.doesNotMatch(s,/^\s*import [^\n]*(geographic-view|renderer-chunks|geographic-3d)/m);
  assert.doesNotMatch(s,/href="[^"]*geographic-view/);
 }
 const dynamic=[...layers.matchAll(/import\('\.\/geographic-view\.js[^']*'\)/g)];assert.equal(dynamic.length,1);
 assert.match(layers,/async function ensureRenderer\(\)/);
 assert.match(layers,/async function enterMap\(\)\{if\(!testFlood\)\{notifyRender\(\{status:'off'/);
});
test('the rule keeps saved runs out and defines always-on simulated visuals',()=>{
 const doc=readFileSync(new URL('../docs/LIVE-DATA-ONLY.md',import.meta.url),'utf8');
 assert.match(doc,/Saved model runs NEVER appear in the live app/);
 assert.match(doc,/## Always-on simulated visuals/);
 assert.match(doc,/not a saved run/i);assert.match(doc,/not fed from real conditions/i);assert.match(doc,/never feed ratings, closures, bridge evidence or alerts/i);
 assert.match(doc,/With 3D not opened, the browser requests no 3D or terrain files/);
 assert.doesNotMatch(doc,/Confirm that no saved date, "replay", "simulation"/);
 assert.match(doc,/Permanent banners, tags and labels are not used/);
});
