import {loadCurrentRun} from './current-inundation.js';
export async function loadFreshCoarseMap({base,fetchImpl=fetch,now=Date.now()}={}){
 const get=(p,o)=>fetchImpl(new URL(p,base),o);
 const current=await loadCurrentRun({fetchImpl:get,now});
 if(current.status!=='ok'||!current.run)return {status:'unavailable',reason:current.reason};
 const retained=await loadCurrentRun({fetchImpl:(p,o)=>get(p==='data/current-sfincs-manifest.json'?'data/retained-sfincs-manifest.json':p,o),now});
 if(!retained.run)throw Error('Cannot verify unchanged native grid against retained output');
 const a=current.run,b=retained.run;
 if(a.cells.length!==b.cells.length||a.provenance.projectedCrs!==b.provenance.projectedCrs||a.provenance.cellAreaM2!==b.provenance.cellAreaM2||a.cells.some((c,i)=>Math.abs(c.lat-b.cells[i].lat)>1e-9||Math.abs(c.lon-b.cells[i].lon)>1e-9))throw Error('New native grid differs; matching source-proven footprints required');
 const r=await get('data/frozen-cell-footprints.json.gz');if(!r.ok)throw Error('Native footprint HTTP '+r.status);
 const footprints=JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text());
 if(footprints.sourceSha256!==retained.manifest.artifact.sha256||footprints.rings.length!==a.cells.length)throw Error('Retained footprint source mismatch');
 return {status:'ok',loaded:current,footprints:{...footprints,runId:current.manifest.runId,sourceSha256:current.manifest.artifact.sha256,geometryReuse:'Verified identical native cell coordinates/order, CRS and full-cell area against retained run'}};
}
