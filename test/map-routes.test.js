// The Map tab's routes panel and crossing card, laid out like the 3D map page and fed by the live check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {routeRowsHtml,crossingCardHtml,ratingText} from '../public/map-routes.js';

const areas=[{id:'avra',name:'Avra Valley'},{id:'picture-rocks',name:'Picture Rocks'}];
const features=[{properties:{id:'a',km:11.2}},{properties:{id:'b',km:21.1}}];
const crossings=[{id:'x',routes:['a','b']},{id:'y',routes:['b']}];
const info={a:{name:'Trico-Marana',via:'Trico Rd'},b:{name:'Avra Valley <Rd>',via:'Avra Valley Rd'}};

test('every route row shows its rating as a number, a status dot and its crossings',()=>{
 const html=routeRowsHtml({areas,area:'avra',routes:[{id:'a',score:1,level:'ok'},{id:'b',score:3,level:'caution'}],info,features,crossings,selected:'b',issue:r=>r.id==='a'?'Nothing working against it':'Wash running'});
 assert.match(html,/data-map-area="avra" aria-selected="true"/);
 assert.match(html,/<span class="dot ok"[^>]*><\/span>.*Trico-Marana.*11\.2 km · 1 crossing<.*1 of 5 · Low · Nothing working against it/);
 assert.match(html,/data-map-route="b" aria-pressed="true"/);
 assert.match(html,/Avra Valley &lt;Rd&gt;/);
 assert.match(html,/2 crossings<.*class="st status warn">3 of 5 · Moderate · Wash running/);
});

test('the crossing card shows the live rating, each source and the link to its safety screen',()=>{
 const fp={id:'x',kind:'bridge',name:'Santa Cruz bridge',where:'on Trico-Marana Rd',routes:['a']};
 const result={level:'watch',why:'River up',checks:[{src:'river',level:'watch',why:'1,200 cfs at Cortaro'}]};
 const html=crossingCardHtml({fp,result,score:2.5,routeId:'a',sources:{river:['🌊','River']},sentence:{}});
 assert.match(html,/<p class="overline">Bridge<\/p>/);
 assert.match(html,/class="badge lg s2"[^>]*>2\.5</);assert.match(html,/badge-word">Minor</);
 assert.match(html,/<p class="status watch"><span class="dot watch"><\/span>River up/);
 assert.match(html,/River<\/span><span class="st"><span class="dot watch"><\/span> 1,200 cfs at Cortaro/);
 assert.match(html,/href="#\/r\/a\/x">Open the safety screen</);
 assert.equal(ratingText(4),'4 of 5 · High');
});

test('wording stays neutral: nothing on the map panel calls a road safe',()=>{
 const text=readFileSync(new URL('../public/map-routes.js',import.meta.url),'utf8')+readFileSync(new URL('../public/street-map.js',import.meta.url),'utf8');
 assert.doesNotMatch(text,/\bsafe\b(?! screen)/i);
});
