import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {FAILURE_POINTS, USGS_SITES} from '../../public/config.js';
import {decodeCompactQuadtree,acceptQuadtreeGeometry,acceptQuadtreeFrame} from '../../public/simulation/quadtree-output.js';
import {createCoverageIndex} from '../../public/simulation/map-state.js';
import {SCENE_SCHEMA,validateScene,gaugeSummary} from '../../public/simulation/scene-data-contract.js';
import {bindCompletedSilverbell} from './bind-completed-silverbell.mjs';

const root='public/simulation/data/', out=root+'scene-contract/';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=b=>createHash('sha256').update(b).digest('hex');
const write=(p,j)=>fs.writeFileSync(out+p,JSON.stringify(j,null,2)+'\n');
const base=root+'refined-full-compact-41344983607/';
const m=read(base+'manifest.json');
function artifact(base,a,geometry){const bytes=fs.readFileSync(base+a.path);if(hash(bytes)!==a.sha256)throw Error('Checksum '+a.path);const b=gunzipSync(bytes);return a.path.endsWith('.bin.gz')?decodeCompactQuadtree(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),geometry):JSON.parse(b);}
const geometry=acceptQuadtreeGeometry(m,artifact(base,m.geometry));
const coverage=createCoverageIndex(geometry.rings);
const sourceCoverage=read(out+'sources/refined-coverage.json');
if(sourceCoverage.nativeMeshSha256!==m.provenance.meshSha256)throw Error('Solver audit mesh mismatch');
for(const c of sourceCoverage.crossings){
 const i=coverage.find(c.coordinates[1],c.coordinates[0]);
 if((i!==null)!==c.active)throw Error('Source coverage disagrees at '+c.coordinates);
}
const routes=read('public/data/routes.geojson'), crossings=read('public/data/crossings.geojson');
const minima=read(out+'sources/route-minima.geojson');
const extension=read(out+'sources/silverbell-minima.geojson');
const entries=new Map();
const coordKey=c=>c.map(v=>v.toFixed(6)).join(',');
const stable=(prefix,c)=>prefix+'-'+hash(coordKey(c)).slice(0,12);
function routeDistanceM(point, feature){
 const scaleX=111320*Math.cos(point[1]*Math.PI/180),scaleY=111320;
 let best=Infinity;const line=feature.geometry.coordinates;
 for(let i=1;i<line.length;i++){const a=[(line[i-1][0]-point[0])*scaleX,(line[i-1][1]-point[1])*scaleY],b=[(line[i][0]-point[0])*scaleX,(line[i][1]-point[1])*scaleY],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/den)):0;best=Math.min(best,Math.hypot(a[0]+t*dx,a[1]+t*dy));}
 return best;
}
function add(id,coordinates,kind,name,routeIds,evidence){
  let e=entries.get(id);
  if(!e){const i=coverage.find(coordinates[1],coordinates[0]);e={id,coordinates,kind,name,routeIds:[],evidence:[],model:{status:i===null?'outside_coverage':'modeled',runId:m.runId,geometrySha256:m.geometry.sha256,nativeFaceId:i===null?null:geometry.cells[i].nativeFaceId,cellIndex:i,method:'point_in_exact_native_cell_polygon',validFrom:m.validFrom,validTo:m.validTo,clockMode:'frozen_replay',roadDepthValidated:false},risk:{status:'not_yet_assessed',score:null,closure:null}};entries.set(id,e);}
  e.routeIds=[...new Set([...e.routeIds,...routeIds])].sort();e.evidence.push(evidence);return e;
}
for(const p of FAILURE_POINTS)add(p.id,[p.lon,p.lat],p.kind,p.name,p.routes,{source:'public/config.js',identity:p.id});
crossings.features.forEach((f,i)=>{const c=f.geometry.coordinates,p=f.properties;const named=FAILURE_POINTS.find(n=>coordKey([n.lon,n.lat])===coordKey(c));add(named?.id??stable('crossing',c),c,'mapped_crossing',p.water||'Unnamed mapped water crossing',[p.route],{source:'public/data/crossings.geojson',sourceRecordIndex:i,legacyId:'route-crossing-'+i,...p});});
for(const f of minima.features){const p=f.properties;add(stable('terrain-minimum',f.geometry.coordinates),f.geometry.coordinates,'terrain_minimum','Terrain-profile minimum',[p.route],{source:'sources/route-minima.geojson',sourceCommit:'a8089cb',...p});}
for(const f of extension.features){const p=f.properties;const e=add(stable('silverbell-minimum',f.geometry.coordinates),f.geometry.coordinates,'terrain_minimum','West Silverbell terrain-profile minimum',['silverbell-north','silverbell-south'],{source:'sources/silverbell-minima.geojson',sourceCommit:'a8089cb',...p});e.baselineModel=e.model;e.model={status:'not_yet_assessed',runId:'41370039087',resultStatus:'awaiting_verified_output',preparedManifest:'sources/silverbell-manifest.json',preparedNativeFaceId:String(p.extensionNativeFaceId),roadDepthValidated:false};}

// Associations are reach-based context, not nearest-gauge joins or hydraulic corrections.
const gaugeDefinitions=[
  ...Object.entries(USGS_SITES).map(([id,p])=>({id:'USGS-'+id,name:p.name,coordinates:[p.lon,p.lat],source:'https://waterdata.usgs.gov/monitoring-location/USGS-'+id+'/',reach:id==='09487000'?'Brawley Wash':id==='09486055'?'Rillito Creek':id==='09486350'?'Canada del Oro':'Santa Cruz River'})),
  {id:'ALERT-6443',name:'Brawley at Milewide Road',coordinates:[-111.244446,32.248611],reach:'Brawley Wash',source:'https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currentstream.php'}
];
const cache=read('test/fixtures/alert-currentstream-2026-10-31.json');
const cacheIds={'09486500':'10017','09486520':'10019','09486055':'10027','09486350':'10006','09487000':'10015','09482500':'10013','6443':'6443'};
const asOf='2026-11-02T07:00:00Z';
const gauges=gaugeDefinitions.map(g=>{const row=cache.data.find(r=>r.site===cacheIds[g.id.split('-')[1]]);const valid=row&&!row.UnderMaintenance&&row.flow!==null&&String(row.flow).trim()!==''&&Number(row.flow)>=0;const points=valid?[{time:row.last_rpt+'-07:00',valueM3s:Number(row.flow)*0.028316846592,approval:'Provisional',qualifier:'not retained by cached feed',maintenance:false}]:[];return {...g,units:'m3/s',points,summary:gaugeSummary(points,asOf),asOf,cacheSource:'test/fixtures/alert-currentstream-2026-10-31.json',cacheSiteId:row?.site??null,stageDatum:null,stageToRoadCorrection:null,modelInputRole:'context_only',riskInputCrossingIds:FAILURE_POINTS.filter(p=>[...(p.river??[]),...(p.wash?.usgs??[]),...(p.wash?.alert??[])].includes(g.id.split('-')[1])).map(p=>p.id)};});
function associations(e){
  const named=FAILURE_POINTS.find(p=>p.id===e.id);
  const river=named?.kind==='river'||e.evidence.some(p=>p.water==='Santa Cruz River');
  const brawley=['brawley-dip','losrobles-bridge'].includes(e.id)||e.evidence.some(p=>/^(Brawley|Los Robles) Wash$/.test(p.water??''));
  if(brawley)return ['USGS-09487000','ALERT-6443'].map(gaugeId=>({gaugeId,relationship:'upstream_regional',reachPath:e.id==='losrobles-bridge'?'Brawley → Los Robles':'Brawley',evidence:'docs/SENSOR-AUDIT.md: county FEMA study; braided reach, no verified travel time',use:'context_only',roadDepthCorrection:null}));
  if(!river)return [];
  // Santa Cruz flows north through these named crossings. Explicit reach topology
  // orders Tucson / Speedway / Ina / Cortaro / Twin Peaks / Avra / Sanders / Trico.
  return gauges.filter(g=>g.reach==='Santa Cruz River').map(g=>({gaugeId:g.id,relationship:g.coordinates[1]<e.coordinates[1]?'upstream_same_river':'downstream_same_river',reachPath:'Santa Cruz River',evidence:'docs/SENSOR-AUDIT.md; configured station/crossing coordinates and north-flowing reach order',use:'context_only',roadDepthCorrection:null})).concat(e.id==='sc-ina'?[{gaugeId:'USGS-09486350',relationship:'tributary_context',reachPath:'Canada del Oro → Santa Cruz',evidence:'public/config.js sc-ina; confluence proximity does not establish road depth',use:'context_only',roadDepthCorrection:null}]:[]);
}
for(const e of entries.values()){
 // Shared physical road segments preserve all route memberships. This 5 m
 // centerline screen is an association only, never model/road-depth coverage.
 e.geometryRouteAssociations=routes.features.map(f=>({routeId:f.properties.id,distanceM:routeDistanceM(e.coordinates,f)})).filter(r=>r.distanceM<=5);
 e.routeIds=[...new Set([...e.routeIds,...e.geometryRouteAssociations.map(r=>r.routeId)])].sort();
 e.gaugeAssociations=associations(e);
}
const routeIds=[...new Set([...routes.features.map(f=>f.properties.id),...FAILURE_POINTS.flatMap(p=>p.routes)])];
const silverbellBinding=bindCompletedSilverbell(entries);
const inventory={schema:'floodplain-tracking-v1',sourceCommit:'532d85b',modelRunId:m.runId,entries:[...entries.values()].sort((a,b)=>a.id.localeCompare(b.id)),routes:routeIds.map(id=>({id,geometryReference:'public/data/routes.geojson#'+id,entryIds:[...entries.values()].filter(e=>e.routeIds.includes(id)).map(e=>e.id).sort(),terrainScreening: ['trico','avra'].includes(id)?'prepared_centerline_minima_available':id.startsWith('silverbell')?'two_extension_minima_only':'not_yet_assessed',completeness:'All existing mapped crossings and registry points included; not a complete real-world dip survey'})),gauges,limits:['Inventory membership does not establish hydraulic coverage.','Terrain minima are bare-earth candidates, not verified road surface/culvert/flood hazards.','Single cached gauge reading cannot establish a trend; live consumers may supply a series to gaugeSummary.','No new route weights, thresholds or closure rules.']};
inventory.modelRuns=[m.runId,silverbellBinding.runId];
inventory.modelRunIdMeaning='Original baseline only; every entry.model.runId identifies its own geometry and validity';
write('inventory.json',inventory);
write('uncovered.json',{runId:m.runId,outsideCoverage:inventory.entries.filter(e=>e.model.status==='outside_coverage'),awaitingResults:inventory.entries.filter(e=>e.model.status==='not_yet_assessed'),unscreenedRoutes:inventory.routes.filter(r=>r.terrainScreening!=='prepared_centerline_minima_available')});

const center=[-111.29459,32.39322],bounds=[center[0]-.002,center[1]-.002,center[0]+.002,center[1]+.002];
const selected=geometry.cells.map((c,i)=>({c,i})).filter(({c})=>c.lon>=bounds[0]&&c.lon<=bounds[2]&&c.lat>=bounds[1]&&c.lat<=bounds[3]);
const scene={schema:SCENE_SCHEMA,id:'brawley-avra-existing-output',runId:m.runId,clockMode:'frozen_replay',coordinates:{crs:'EPSG:4326',order:'longitude,latitude'},verticalDatum:m.provenance.verticalDatum,units:{length:'m',velocity:'m/s',volume:'m3',discharge:'m3/s',displayLength:'ft'},center,bounds,sourceIssues:m.sourceIssues,modelIssuedAt:null,validFrom:m.validFrom,validTo:m.validTo,geometrySha256:m.geometry.sha256,
  cells:selected.map(({c,i})=>({...c,sourceCellIndex:i,ring:geometry.rings[i].map(([lat,lon])=>[lon,lat])})),frames:[],
  flow:{status:'unavailable',velocityMps:null,direction:null,reason:'Published native package contains volume and zs, no velocity vectors',supportedAlternatives:[{kind:'native_time_sequence',meaning:'Changing modeled extent and elevation; not particle paths'},{kind:'illustrative_highlights',meaning:'Clearly labeled cosmetic motion; no measured speed or model-derived direction'}]},
  extent:{method:'Clip source terrain triangles against native waterSurfaceM per face',depthMeaning:'nativeVolumeM3/full native face area; not actual wet footprint or road depth',displayThresholdM:0.01},
  risk:inventory.entries.find(e=>e.id==='brawley-dip').risk,gauges:gauges.filter(g=>['USGS-09487000','ALERT-6443'].includes(g.id)),terrain:[],terrainGeometryEquivalence:m.terrainDisplay.geometryEquivalence,roads:'brawley-roads.geojson',provenance:{manifest:'../refined-full-compact-41344983607/manifest.json',manifestSha256:hash(fs.readFileSync(base+'manifest.json')),configurationSha256:m.provenance.configurationSha256,meshSha256:m.provenance.meshSha256}};
for(const descriptor of m.frames){const f=acceptQuadtreeFrame(m,geometry,artifact(base,descriptor,geometry),descriptor.time);scene.frames.push({validTime:f.time,sourceSha256:descriptor.sha256,depthM:selected.map(({i})=>f.depthM[i]),waterSurfaceM:selected.map(({i})=>f.waterSurfaceM[i])});}
const terrainBase=root+'refined-partial-41339621278/';
const terrainIndex=artifact(terrainBase,m.terrainDisplay.artifact);
if(terrainIndex.runId!==m.runId||terrainIndex.geometrySha256!==m.geometry.sha256)throw Error('Terrain binding mismatch');
for(const tile of terrainIndex.tiles.filter(t=>t.bounds[0]<=bounds[2]&&t.bounds[2]>=bounds[0]&&t.bounds[1]<=bounds[3]&&t.bounds[3]>=bounds[1])){const a=tile.levels.find(l=>l.level===0).artifact;artifact(terrainBase,a);fs.copyFileSync(terrainBase+a.path,out+a.path);scene.terrain.push({...a,bounds:tile.bounds,source:'../refined-partial-41339621278/'+a.path,verticalDatum:'NAVD88'});}
// A bounded original route segment, not fabricated road geometry.
const roadFeatures=[];
for(const f of routes.features){let segment=[];const flush=()=>{if(segment.length>1)roadFeatures.push({type:'Feature',properties:f.properties,geometry:{type:'LineString',coordinates:segment}});segment=[];};for(const c of f.geometry.coordinates){if(c[0]>=bounds[0]-.001&&c[0]<=bounds[2]+.001&&c[1]>=bounds[1]-.001&&c[1]<=bounds[3]+.001)segment.push(c);else flush();}flush();}
write('brawley-roads.geojson',{type:'FeatureCollection',features:roadFeatures});
write('brawley-scene.json',validateScene(scene));
write('build-report.json',{baseline:'532d85b',solverSource:'a8089cb',silverbellBinding,routes:inventory.routes.length,entries:inventory.entries.length,mappedCrossingRecords:crossings.features.length,terrainMinima:minima.features.length,extensionMinima:extension.features.length,modeled:inventory.entries.filter(e=>e.model.status==='modeled').length,outsideCoverage:inventory.entries.filter(e=>e.model.status==='outside_coverage').length,awaitingResults:inventory.entries.filter(e=>e.model.status==='not_yet_assessed').length,brawleyFaces:scene.cells.length,nativeFrames:scene.frames.length,terrainTiles:scene.terrain.length,checked:'Every compressed geometry/frame/terrain checksum verified; existing native geometry/frame validators passed'});
fs.copyFileSync('docs/SCENE-DATA-CONTRACT.md',out+'README.md');
fs.copyFileSync('public/simulation/scene-data-contract.js',out+'scene-data-contract.js');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
write('package-manifest.json',{schema:'floodplain-example-package-v1',entrypoint:'brawley-scene.json',files:files(out).filter(p=>!p.endsWith('package-manifest.json')).map(p=>({path:path.relative(out,p).replaceAll('\\','/'),sha256:hash(fs.readFileSync(p)),bytes:fs.statSync(p).size}))});
console.log(fs.readFileSync(out+'build-report.json','utf8'));
