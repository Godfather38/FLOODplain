// The 2D map's street map: same colours and road widths as the 3D map page, painted from vector tiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROAD,LAND,BACKGROUND,TILE_MAX_ZOOM,mapWaterColour,metresPerPixel,roadPixels,sourceTile,paintTile,labelCandidates,placeLabels} from '../public/street-map.js';
const read=f=>readFileSync(new URL('../public/'+f,import.meta.url),'utf8');

test('colours match the 3D map page: sand for washes, grey-blue only for standing water',()=>{
 assert.equal(mapWaterColour({intermittent:1,class:'stream'}),'#eadcbd');
 assert.equal(mapWaterColour({class:'river'}),'#eadcbd');
 assert.equal(mapWaterColour({class:'lake'}),'#c4d3d6');
 assert.equal(ROAD.motorway.fill,'#f6c86a');assert.equal(LAND.scrub,'#e1e3c6');assert.equal(BACKGROUND,'#efe8d8');
 // No base-map colour is the model's water blue.
 for(const c of [...Object.values(LAND),...Object.values(ROAD).map(r=>r.fill),BACKGROUND])assert.doesNotMatch(c,/^#(1f7fb4|2585bc|58b5d6)$/);
});

test('roads are drawn at their real width when close and never thinner than their minimum',()=>{
 const close=metresPerPixel(32.4,18),far=metresPerPixel(32.4,10);
 assert.ok(close<1&&far>100);
 assert.ok(Math.abs(roadPixels('motorway',close).fill-26/close)<1e-9);
 assert.equal(roadPixels('motorway',far).fill,ROAD.motorway.min);
 assert.ok(roadPixels('minor',far).edge>roadPixels('minor',far).fill);
});

test('views closer than zoom 14 paint part of a zoom 14 tile',()=>{
 assert.deepEqual(sourceTile({x:5,y:7,z:12}),{x:5,y:7,z:12,k:1,sx:0,sy:0});
 assert.deepEqual(sourceTile({x:4*100+3,y:4*200+1,z:TILE_MAX_ZOOM+2}),{x:100,y:200,z:14,k:4,sx:3,sy:1});
});

function layer(features,extent=4096){return{extent,length:features.length,feature:i=>({type:features[i].type,properties:features[i].properties,loadGeometry:()=>features[i].geometry})};}
function recorder(){const calls=[],ctx={calls,setTransform(){},beginPath(){},moveTo(){},lineTo(){},fill(){calls.push(['fill',ctx.fillStyle])},fillRect(){calls.push(['fillRect',ctx.fillStyle])},stroke(){calls.push(['stroke',ctx.strokeStyle,ctx.lineWidth])},setLineDash(){},globalAlpha:1};return ctx;}

test('a tile paints the land, a wash bed and a road over it',()=>{
 const line=[[{x:0,y:2048},{x:4096,y:2048}]],square=[[{x:0,y:0},{x:4096,y:0},{x:4096,y:4096},{x:0,y:4096},{x:0,y:0}]];
 const tile={x:0,y:0,tile:{layers:{landcover:layer([{type:3,properties:{class:'scrub'},geometry:square}]),water:layer([{type:3,properties:{class:'river',intermittent:1},geometry:square}]),transportation:layer([{type:2,properties:{class:'primary'},geometry:line},{type:2,properties:{class:'service'},geometry:line}])}}};
 const ctx=recorder();paintTile(ctx,tile,{size:256,zoom:12});
 assert.deepEqual(ctx.calls[0],['fillRect',BACKGROUND]);
 assert.ok(ctx.calls.some(c=>c[0]==='fill'&&c[1]===LAND.scrub));
 assert.ok(ctx.calls.some(c=>c[0]==='fill'&&c[1]==='#eadcbd'));
 const strokes=ctx.calls.filter(c=>c[0]==='stroke');
 // Edge then fill for the primary road; service roads wait for zoom 14.
 assert.deepEqual(strokes.map(c=>c[1]),[ROAD.primary.edge,ROAD.primary.fill]);
});

test('names: places, roads and washes, the more important one wins an overlap',()=>{
 const z=12,entry={x:0,y:0,z,tile:{layers:{
  place:layer([{type:1,properties:{class:'town',name:'Marana'},geometry:[[{x:2048,y:2048}]]}]),
  transportation_name:layer([{type:2,properties:{class:'primary',name:'West Avra Valley Road'},geometry:[[{x:0,y:2048},{x:2048,y:2048},{x:4096,y:2048}]]},{type:2,properties:{class:'minor',name:'Too small'},geometry:[[{x:0,y:0},{x:10,y:10}]]}]),
  waterway:layer([{type:2,properties:{class:'stream',name:'Brawley Wash'},geometry:[[{x:100,y:100},{x:200,y:200}]]}])}}};
 const found=labelCandidates(entry,z);
 assert.deepEqual(found.map(c=>[c.kind,c.text]),[['place','Marana'],['road','West Avra Valley Road']]);
 assert.equal(labelCandidates(entry,13).filter(c=>c.kind==='wash').length,1);
 const shown=placeLabels(found,()=>({x:100,y:100}),{width:400,height:400});
 assert.deepEqual(shown.map(s=>s.text),['Marana']);
});

test('the app uses the painted street map, with satellite offered and the OSM tiles as a fallback',()=>{
 const app=read('app.js'),layers=read('simulation/map-layers.js'),html=read('index.html');
 assert.match(app,/createStreetMap\(L, map,/);assert.match(app,/tile\.openstreetmap\.org/);
 assert.match(layers,/data-base="street"[^>]*>Street map</);assert.match(layers,/data-base="satellite"[^>]*>Satellite</);
 assert.doesNotMatch(layers,/L\.control\.layers/);
 assert.match(html,/map-look\.css\?v=dev/);
 assert.match(read('vendor/vector-tiles/vector-tile/index.js'),/from '\.\.\/point-geometry\/index\.js'/);
});

// Staples: the 2D model water, every map type and every map layer are only ever added to.
test('the Map tab is a maps app: 2D model water on every base map, 3D as a layer, nothing dropped',async()=>{
 const appjs=read('map-app.js'),layers=read('simulation/map-layers.js'),app=read('app.js');
 assert.match(app,/mountMapApp\(\{L,map,baseMaps/);
 for(const k of ['street','osm','satellite','terrain','2d','3d','hand','aggregate','off','rain','flow','routes','places','live'])assert.ok(appjs.includes(`['${k}','`),k);
 for(const c of ['data-m-search','data-m-layers','data-m-in','data-m-out','data-m-locate','data-m-fit-routes','data-m-fit-water','data-m-north','data-m-run','data-m-play','data-m-prev','data-m-next','data-m-scrub','data-m-panel'])assert.match(appjs,new RegExp(c));
 // The flat renderer is the Terrain detail map type, and keeps its case, tilt and hour controls.
 assert.match(layers,/flood-terrain-detail/);assert.match(appjs,/\[data-case\]/);assert.match(appjs,/\[data-3d\]/);assert.match(appjs,/data-panel=time/);
 assert.match(read('simulation/world-layer.js'),/preview\/geo3d\/world\.html\?embed=1/);
 const sim=await import(new URL('../public/simulation/sim-2d.js',import.meta.url));
 assert.equal(sim.depthBand(.005),-1);assert.equal(sim.depthBand(.0092),0);assert.equal(sim.depthBand(1),2);assert.equal(sim.depthBand(5),5);
 assert.deepEqual(sim.RUNS.map(r=>r.id),['live','13z','19z','allroutes','stress','extreme']);
});
