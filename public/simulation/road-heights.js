// Opt-in reader only; nothing imports this yet. Heights are metres NAVD88 and unknown values stay null.
export const ROAD_FLAGS = Object.freeze({deckLidar:1,deckApproach:2,noTerrain:4,structureUntagged:8});
const READ = {u4:['getUint32',4],i4:['getInt32',4],u1:['getUint8',1],i1:['getInt8',1],i2:['getInt16',2]};
function column(view,start,c){const [read,width]=READ[c.type]??[];if(!read||start+c.offset+c.count*width>view.byteLength)throw Error('Invalid road height column');return Array.from({length:c.count},(_,i)=>view[read](start+c.offset+i*width,true));}
export function decodeRoadHeights(buffer){
  const view=new DataView(buffer),size=view.getUint32(0,true);
  if(size>buffer.byteLength-4)throw Error('Invalid road height header');
  const h=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,size)));
  if(h.format!=='floodplain-road-heights-v1')throw Error('Unknown road height format');
  const body=4+size,col=Object.fromEntries(Object.entries(h.columns).map(([k,c])=>[k,column(view,body,c)])),starts=col.lineStart;
  const lines=[];
  for(let i=0;i<starts.length-1;i++){
    const stations=[];let lon=0,lat=0,z=0,s=0;
    for(let j=starts[i];j<starts[i+1];j++){
      lon+=col.dLonE6[j];lat+=col.dLatE6[j];z+=col.dZCm[j];s+=col.dStationDm[j];
      const flags=col.flags[j];
      stations.push({lon:lon/1e6,lat:lat/1e6,stationM:s/10,elevationM:flags&ROAD_FLAGS.noTerrain?null:z/100,lateralRangeM:col.lateralDm[j]===255?null:col.lateralDm[j]/10,flags,source:col.source[j]});
    }
    lines.push({name:h.lines.name[i],kind:h.lines.kind[i],routeId:h.lines.routeId[i],stations});
  }
  return {metadata:h.metadata,lines};
}
export async function readRoadHeights(url,{fetchImpl=fetch,sha256,signal}={}){
  const r=await fetchImpl(url,{signal});if(!r.ok)throw Error('Road heights HTTP '+r.status);
  const bytes=await r.arrayBuffer();
  if(sha256){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==sha256)throw Error('Road height checksum mismatch');}
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return decodeRoadHeights(await new Response(stream).arrayBuffer());
}
export function decodeRoadFlood(buffer){
  const view=new DataView(buffer),size=view.getUint32(0,true),h=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,size)));
  if(h.format!=='floodplain-road-flood-v1')throw Error('Unknown road flood format');
  let at=4+size;const n=h.everAboveCount,frames=h.times.length;
  const stations=column(view,at,{type:'u4',count:n,offset:0});at+=4*n;
  const above=column(view,at,{type:'i2',count:n*frames,offset:0}).map(v=>v===h.nullCm?null:v/100);at+=2*n*frames;
  const faces=column(view,at,{type:'i4',count:h.stationCount,offset:0});
  return {runId:h.runId,times:h.times,stationOrder:h.stationOrder,everAboveStations:stations,stationFace:faces,
    // Metres of modeled water level above the road; null means no water in that face or no result.
    aboveRoadM:(frame,k)=>above[frame*n+k]};
}
