// Modeled and simulated water must be clearly not real, through one dismissible notice and the
// wording already on screen. Permanent banners and tags are not used. See docs/SIMULATED-CONTENT.md.
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
test('it shows once a session, whichever kind comes first',()=>{
 resetForTest();const storage=memoryStorage(),doc=fakeDocument();
 assert.equal(showAcknowledgement('estimate',{document:doc,storage}),true);
 const dialog=dialogOf(doc);assert.equal(dialog.opened,true);assert.match(text(dialog),/This water is a model estimate.*Got it/);
 assert.equal(showAcknowledgement('estimate',{document:doc,storage}),false,'no second copy while open');
 assert.equal(showAcknowledgement('simulated',{document:doc,storage}),false,'no queued second notice');
 dialog.children.at(-1).onclick();assert.equal(dialog.removed,true);
 assert.equal(isAcknowledged(storage),true);
 for(const kind of Object.keys(ACKNOWLEDGEMENTS))assert.equal(showAcknowledgement(kind,{document:doc,storage}),false,kind);
 resetForTest();
 const nextPage=fakeDocument();assert.equal(showAcknowledgement('simulated',{document:nextPage,storage}),false,'still gone on the next page this session');
 assert.equal(nextPage.created.length,0);
 resetForTest();
 const newSession=fakeDocument();assert.equal(showAcknowledgement('simulated',{document:newSession,storage:memoryStorage()}),true,'a new session sees it again');
 dialogOf(newSession).children.at(-1).onclick();resetForTest();
});
test('it is kept for the session, not remembered across sessions',()=>{
 const code=read('model-acknowledgement.js');
 assert.match(code,/globalThis\.sessionStorage/);assert.doesNotMatch(code,/localStorage/);
});
test('Escape or any other close counts as dismissing',()=>{
 resetForTest();const storage=memoryStorage(),doc=fakeDocument();
 showAcknowledgement('simulated',{document:doc,storage});dialogOf(doc).close();
 assert.equal(isAcknowledged(storage),true);resetForTest();
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
 assert.equal(dialog.removed,true);assert.equal(storage.getItem('floodplain-ack'),'1');
 resetForTest();assert.equal(showAcknowledgement('savedRun',{document:fakeDocument(),storage}),false);
 const fresh=fakeDocument();assert.equal(showAcknowledgement('simulated',{document:fresh,storage:memoryStorage()}),true,'nothing left blocking a later session');
 dialogOf(fresh).children.at(-1).onclick();resetForTest();
});
test('every simulated or modeled view opens the notice',()=>{
 assert.match(read('live-map.js'),/showAcknowledgement\('estimate'\)/);
 assert.match(read('inundation/app.js'),/showAcknowledgement\('estimate'\)/);
 const layers=read('simulation/map-layers.js');
 assert.match(layers,/showAcknowledgement\('savedRun'\);notifyRender\(\{status:'loading'/);
 assert.match(layers,/next==='3d'\)showAcknowledgement\('simulated'\)/);
});
test('no permanent banner or tag marks simulated content',()=>{
 const files=['app.js','live-map.js','live-map.css','accessible-ui.css','simulation/map-layers.js','simulation/map-shell.js','simulation/map-layers.css'];
 for(const f of files)assert.doesNotMatch(read(f),/test-flood-banner|mountTestFloodBanner/,f);
});
test('existing wording says simulated, modeled or estimated',()=>{
 const shell=read('simulation/map-shell.js'),layers=read('simulation/map-layers.js'),live=read('live-map.js'),geo=read('simulation/geographic-view.js'),app=read('app.js'),page=read('inundation/index.html');
 assert.match(shell,/Simulated water: saved model run, Nov 1–2, 2026 · not real conditions/);
 assert.match(shell,/'Saved model run'\)\+' issued '/);assert.match(shell,/Show 2-hour simulated outlook/);
 assert.match(layers,/Simulated time · Arizona/);assert.match(layers,/'Flat map':'3D simulation'/);assert.match(layers,/Simulated water \(SFINCS 2D\)/);assert.match(layers,/SIMULATED FLOOD · NOV 1–2, 2026/);
 assert.match(live,/Modeled water estimate · HAND/);assert.match(live,/Model estimate valid /);assert.match(live,/Modeled water depth estimate \(ft\)/);
 assert.match(geo,/Simulated water: 10 m terrain-intersected display/);assert.match(geo,/Simulated water\. Terrain intersection/);assert.match(geo,/ft simulated cell-average depth/);
 assert.match(app,/Live readings, model estimates and simulated water/);
 assert.match(page,/<h1>Modeled flood extent estimate<\/h1>/);assert.match(page,/Modeled at this flow/);
 assert.match(read('index.html'),/Experimental: modeled flood extent estimate/);
});
test('the simulator is where the original design put it, not behind a mode',()=>{
 const layers=read('simulation/map-layers.js'),shell=read('simulation/map-shell.js'),app=read('app.js');
 assert.doesNotMatch(layers+shell+app,/isTestFlood|testFlood|test-flood/);
 assert.match(layers,/<select data-case>/);assert.match(layers,/<option value="2d">/);assert.match(layers,/<option value="aggregate">/);assert.match(layers,/data-3d/);
 assert.match(layers,/async function enterMap\(\)\{if\(location\.hash!=='#\/map'\)return;/);assert.match(layers,/q\('\[data-model\]'\)\.value='2d'/);
 assert.match(shell,/<button data-panel="time">Time<\/button>/);assert.match(shell,/mapWrap\.append\(preview\)/);
 assert.match(read('index.html'),/<nav class="exp-link"/);
 // Saved simulation controls remain available; production bridge evidence is static only.
 assert.doesNotMatch(read('simulation/bridge-evidence.js'),/current-sfincs-manifest\.json/);
 assert.match(read('inundation/index.html'),/id="recorded"/);
});
