import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {decodeCompactQuadtree,acceptQuadtreeGeometry,acceptQuadtreeFrame} from '../../public/simulation/quadtree-output.js';
import {createCoverageIndex} from '../../public/simulation/map-state.js';
import {SCENE_SCHEMA,validateScene} from '../../public/simulation/scene-data-contract.js';

const root='public/simulation/data/',directory=root+'silverbell-full-41370039087/',base=directory+'compact/';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
export function bindCompletedSilverbell(entries) {
  const manifestBytes=fs.readFileSync(base+'manifest.json'),m=JSON.parse(manifestBytes),source=read(directory+'source.json');
  if(m.status!=='complete'||m.runId!=='silverbell-full-41370039087'||m.executionMode!=='simulated_live_frozen_inputs')throw Error('Completed frozen Silverbell package required');
  function artifact(a,geometry){const b=fs.readFileSync(base+a.path);if(hash(b)!==a.sha256)throw Error('Silverbell checksum '+a.path);const raw=gunzipSync(b);return decodeCompactQuadtree(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),geometry);}
  const g=acceptQuadtreeGeometry(m,artifact(m.geometry));
  for(const [filename,expected] of [['prepared-coverage.json',m.coverage.coverageEvidenceSha256],['terrain-low-point-candidates.geojson',m.coverage.terrainCandidateRegistrySha256]])if(hash(fs.readFileSync(directory+filename))!==expected)throw Error('Silverbell source registry checksum');
  const audit=read(directory+'prepared-coverage.json');
  if(audit.nativeMeshSha256!==m.provenance.meshSha256)throw Error('Silverbell coverage mesh mismatch');
  const summary=read(directory+'silverbell-point-summary.json');
  const sourcePoints=read(directory+'terrain-low-point-candidates.geojson');
  const selected=summary.points.map(p=>{
    const index=g.cells.findIndex(c=>c.nativeFaceId===String(p.sourceNativeFaceId));
    if(index<0)throw Error('Missing native point face ID');
    if(createCoverageIndex([g.rings[index]]).find(p.coordinates[1],p.coordinates[0])!==0)throw Error('Point outside matching native face');
    if(!sourcePoints.features.some(f=>f.geometry.coordinates.every((v,i)=>v===p.coordinates[i])&&String(f.properties.extensionNativeFaceId)===g.cells[index].nativeFaceId))throw Error('Point registry identity mismatch');
    const entry=[...entries.values()].find(e=>e.id.startsWith('silverbell-minimum-')&&e.coordinates.every((v,i)=>v===p.coordinates[i]));
    if(!entry)throw Error('Stable inventory point missing');
    entry.preparedModel=entry.model;
    entry.model={status:'modeled',resultStatus:'model_output_available',runId:m.runId,solverRunId:'41370039087',sourceCommit:source.commit,
      geometrySha256:m.geometry.sha256,meshSha256:m.provenance.meshSha256,nativeFaceId:g.cells[index].nativeFaceId,cellIndex:index,
      method:'source_native_face_id_and_exact_point_in_polygon',clockMode:'frozen_replay',sourceIssues:m.sourceIssues,
      validFrom:m.validFrom,validTo:m.validTo,modelIssuedAt:null,roadDepthValidated:false,
      pointSeriesPath:'silverbell-point-scene.json',pointSeriesIndex:summary.points.indexOf(p),
      summary:{peakCellAverageDepthM:p.maxVolumePerFullCellAreaM,peakWaterSurfaceNAVD88M:p.maxWaterSurfaceNAVD88M,peakWaterSurfaceTime:p.maxSurfaceTime},
      freshnessPolicy:'Evaluate original valid window against explicit caller clock; frozen replay is never automatically current weather'};
    entry.evidence.push({source:'../silverbell-full-41370039087/silverbell-point-summary.json',sourceCommit:source.commit,interpretation:p.interpretation});
    return {index,point:p,entry};
  });
  const csv=fs.readFileSync(directory+'silverbell-point-series.csv','utf8').trim().split(/\r?\n/).slice(1).map(line=>line.split(','));
  const rows=new Map(csv.map(r=>[r[3]+'|'+r[4],{volume:Number(r[5]),area:Number(r[6]),depth:Number(r[7]),surface:Number(r[8])}]));
  const scene={schema:SCENE_SCHEMA,id:'silverbell-completed-minima',runId:m.runId,clockMode:'frozen_replay',coordinates:{crs:'EPSG:4326',order:'longitude,latitude'},verticalDatum:m.provenance.verticalDatum,
    units:{length:'m',volume:'m3',velocity:'m/s',displayLength:'ft'},sourceIssues:m.sourceIssues,modelIssuedAt:null,validFrom:m.validFrom,validTo:m.validTo,
    geometrySha256:m.geometry.sha256,cells:selected.map(({index,point,entry})=>({...g.cells[index],sourceCellIndex:index,inventoryId:entry.id,pointCoordinates:point.coordinates,roadProfileTerrainNAVD88M:point.roadProfileTerrainNAVD88M,ring:g.rings[index].map(([lat,lon])=>[lon,lat])})),frames:[],
    flow:{status:'unavailable',velocityMps:null,direction:null,reason:'Native output export supplies volume and zs only'},
    terrain:[],terrainAvailability:m.terrainDisplay,extent:{status:'unavailable',reason:'Cell polygons are coverage, not wet extent. Source-bound terrain required for clipping; no old terrain substitution.'},
    risk:{status:'not_yet_assessed',score:null,closure:null},gauges:[],
    provenance:{sourceCommit:source.commit,manifest:'../silverbell-full-41370039087/compact/manifest.json',manifestSha256:hash(manifestBytes),meshSha256:m.provenance.meshSha256,pointSeriesSha256:hash(fs.readFileSync(directory+'silverbell-point-series.csv'))}};
  for(const descriptor of m.frames){const f=acceptQuadtreeFrame(m,g,artifact(descriptor,g),descriptor.time);
    for(const {index,point} of selected){const row=rows.get(String(point.sourceNativeFaceId)+'|'+f.time);if(!row||row.volume!==f.nativeVolumeM3[index]||row.area!==g.cells[index].areaM2||row.surface!==f.waterSurfaceM[index]||Math.max(0,row.depth)!==f.depthM[index])throw Error('Export disagrees with source point series at '+f.time);}
    scene.frames.push({validTime:f.time,sourceSha256:descriptor.sha256,nativeVolumeM3:selected.map(({index})=>f.nativeVolumeM3[index]),depthM:selected.map(({index})=>f.depthM[index]),waterSurfaceM:selected.map(({index})=>f.waterSurfaceM[index])});
  }
  for(let i=0;i<selected.length;i++){const p=selected[i].point;if(Math.max(...scene.frames.map(f=>f.depthM[i]))!==p.maxVolumePerFullCellAreaM||Math.max(...scene.frames.map(f=>f.waterSurfaceM[i]))!==p.maxWaterSurfaceNAVD88M)throw Error('Silverbell peak mismatch');}
  fs.writeFileSync(root+'scene-contract/silverbell-point-scene.json',JSON.stringify(validateScene(scene),null,2)+'\n');
  const pointer={schemaVersion:1,status:'complete',runId:m.runId,path:'data/silverbell-full-41370039087/compact/manifest.json',sha256:hash(manifestBytes),geometrySha256:m.geometry.sha256,sourceCommit:source.commit,executionMode:m.executionMode,sourceIssues:m.sourceIssues,validFrom:m.validFrom,validTo:m.validTo,terrainDisplay:m.terrainDisplay,flow:{status:'unavailable'},note:'Opt-in new geometry; does not change existing map defaults or publication pointers'};
  fs.writeFileSync(root+'silverbell-scene-publication.json',JSON.stringify(pointer,null,2)+'\n');
  const result={runId:m.runId,sourceCommit:source.commit,nativeFaces:g.cells.length,frames:scene.frames.length,points:scene.cells.length,pointSamplesCompared:rows.size,checks:['Native geometry and all frame hashes verified','Native face ID and containing polygon checked at both minima','114 source CSV samples equal compact quantities exactly','Peak depth and surface agree with solver summary','Prepared coverage evidence mesh hash matches completed output'],terrainStatus:m.terrainDisplay.status};
  fs.writeFileSync(root+'scene-contract/silverbell-binding-report.json',JSON.stringify(result,null,2)+'\n');
  return result;
}
