// UI-owned state. Rendering acknowledges a request; requesting never relabels an old frame.
export function createMapState(){
 let revision=0,dataset=null,state={clockMode:'frozen_replay',range:{start:0,end:0},requested:{requestId:0,model:'off',view:'flat',index:0,time:null},displayed:null,status:'off',error:null,viewport:null,selection:null};const listeners=new Set();
 const snapshot=()=>structuredClone(state),emit=()=>listeners.forEach(fn=>fn(snapshot()));
 function setDataset(meta){if(!meta.runId||!meta.frameTimes?.length||meta.frameTimes.some(t=>!Number.isFinite(Date.parse(t))))throw Error('Invalid frame catalogue');dataset={...meta,frameTimes:[...meta.frameTimes]};state.range.end=meta.frameTimes.length-1;state.requested.time=meta.frameTimes[state.requested.index]??null;emit()}
 function request({model=state.requested.model,index=state.requested.index,view=state.requested.view}={}){if(!['off','hand','2d','aggregate'].includes(model)||!['flat','3d'].includes(view))throw Error('Unsupported map mode');if(!Number.isInteger(index)||index<state.range.start||(dataset&&index>state.range.end))throw Error('Hour outside browsing window');state.requested={requestId:++revision,model,index,view,time:dataset?.frameTimes[index]??null};state.status=model==='off'?'off':'loading';state.error=null;if(model==='off')state.displayed=null;emit();return revision}
 function acknowledge({requestId,time,model,view=state.requested.view}){const r=state.requested;if(requestId!==r.requestId)return false;if(time!==r.time||model!==r.model||view!==r.view)throw Error('Rendered frame does not match requested state');state.displayed={...r,runId:dataset?.runId};state.status='ready';state.error=null;emit();return true}
 function fail(requestId,message){if(requestId!==state.requested.requestId)return false;state.status='error';state.error=String(message);state.displayed=null;emit();return true}
 function setRange(start,end){if(!dataset||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>=dataset.frameTimes.length||end<=start)throw Error('Invalid browsing window');state.range={start,end};emit();return Math.max(start,Math.min(end,state.requested.index))}
 function setViewport(v){if(!v?.center||!v.center.every(Number.isFinite)||!Number.isFinite(v.zoom))throw Error('Invalid geographic viewport');state.viewport=structuredClone(v);emit()}
 function select(value){state.selection=value===null?null:structuredClone(value);emit()}
 return {snapshot,setDataset,request,acknowledge,fail,setRange,setViewport,select,isCurrent:id=>id===state.requested.requestId,subscribe(fn){listeners.add(fn);fn(snapshot());return()=>listeners.delete(fn)}};
}

export function nativeCellReadout(frame,index){if(index===null||index===undefined||index<0)return {status:'outside_domain',depthM:null,time:frame?.time??null};const value=frame?.depthM?.[index];if(value===null||value===undefined||!Number.isFinite(value)||value<0)return {status:'no_result',depthM:null,cellIndex:index,time:frame?.time??null};return {status:value===0?'zero':'depth',depthM:value,depthFt:value*3.280839895,cellIndex:index,time:frame.time,quantity:'cell_average_depth'};}

// Exact geographic footprints determine cell membership. A bounding box or nearby cell is not coverage.
export function createCoverageIndex(rings){
 const bins=new Map(),step=.01,key=(x,y)=>x+','+y;
 rings.forEach((r,i)=>{const lat=r.map(p=>p[0]),lon=r.map(p=>p[1]);for(let y=Math.floor(Math.min(...lat)/step);y<=Math.floor(Math.max(...lat)/step);y++)for(let x=Math.floor(Math.min(...lon)/step);x<=Math.floor(Math.max(...lon)/step);x++){const k=key(x,y);if(!bins.has(k))bins.set(k,[]);bins.get(k).push(i)}});
 function inside(lat,lon,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [yi,xi]=ring[i],[yj,xj]=ring[j];const cross=(lon-xi)*(yj-yi)-(lat-yi)*(xj-xi);if(Math.abs(cross)<1e-12&&lon>=Math.min(xi,xj)-1e-10&&lon<=Math.max(xi,xj)+1e-10&&lat>=Math.min(yi,yj)-1e-10&&lat<=Math.max(yi,yj)+1e-10)return true;if((yi>lat)!==(yj>lat)&&lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)hit=!hit}return hit}
 return {find(lat,lon){if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;for(const i of bins.get(key(Math.floor(lon/step),Math.floor(lat/step)))??[])if(inside(lat,lon,rings[i]))return i;return null;}};
}

export function crossingCoverage(registry,{runId,sha256,crossingId}){
 if(!registry||registry.schemaVersion!==1||registry.runId!==runId||registry.artifactSha256!==sha256)return {status:'unverified',reason:'Crossing coverage registry unavailable or mismatched'};
 const record=registry.records?.find(r=>r.crossingId===crossingId);
 if(!record||!['inside_native_cell','outside_domain'].includes(record.status))return {status:'unverified',reason:'Crossing not mapped in this registry'};
 if(record.status==='inside_native_cell'&&(!Number.isInteger(record.cellIndex)||record.cellIndex<0||!record.method))return {status:'unverified',reason:'Incomplete native-cell mapping'};
 return {...record};
}
