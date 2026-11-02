import {ShoreSimulation} from './simulation.js?v=1.3.0';
const sim=new ShoreSimulation();
const MAX_PACKET_SETS=3,PACKET_INTERVAL=1/20,PHYSICS_DT=1/60;
// Binary artifacts could not be materialized through the authorized connector.
// Compare all variants on the same JavaScript solver and procedural warm start.
const USE_BAKED_STATE=false;
let paused=true,ready=false,initializing=false,publishCount=0,allocated=0,timer=null,lastWall=0,debt=0,nextPublish=0;
const pool=[];
let profiling=false,stepMs=0,stepCount=0,stepPeak=0,rejectedRecycles=0;
let publishedSinceResume=0,publishWindowAt=0;
const startup={hydrated:false,warmupMs:0,warmupSteps:0,accelerationMs:0,hydrationMs:0,kernelReason:'JavaScript for every preset; binary artifacts unavailable'};

// Exactly three transferable packet sets serve rendering, interpolation and
// transit. Backpressure skips publication, never allocates a fourth set.
// Physics remains 60 Hz; every preset publishes at the same 20 Hz maximum.
function schedule(){clearTimeout(timer);if(!paused&&ready)timer=setTimeout(tick,Math.max(1,(PHYSICS_DT-debt)*1000-(performance.now()-lastWall)));}
function tick(){
 if(paused||!ready)return;
 const now=performance.now();debt+=(now-lastWall)/1000;lastWall=now;
 const count=Math.min(6,Math.floor((debt+1e-7)/PHYSICS_DT));
 const stepStart=profiling?performance.now():0;
 for(let i=0;i<count;i++)sim.step(PHYSICS_DT);
 if(profiling&&count){const elapsed=performance.now()-stepStart;stepMs+=elapsed;stepCount+=count;stepPeak=Math.max(stepPeak,elapsed/count);}
 debt-=count*PHYSICS_DT;
 if(sim.time>=nextPublish&&publish())nextPublish=sim.time+PACKET_INTERVAL-.00001;
 schedule();
}
function resume(){lastWall=performance.now();debt=0;nextPublish=sim.time;publishWindowAt=lastWall;publishedSinceResume=0;schedule();}
function publish(type='frame'){
 if(!pool.length&&allocated>=MAX_PACKET_SETS)return false;
 const reuse=pool.pop();if(!reuse)allocated++;
 const packStart=performance.now(),p=sim.pack(reuse),packMs=performance.now()-packStart;
 if(type==='frame')publishedSinceResume++;
 const elapsed=(performance.now()-publishWindowAt)/1000;
 const profile={
  kernel:sim.kernels?'WebAssembly':'JavaScript',grid:{...sim.g},cells:sim.n,
  packetBytes:sim.n*4*4*3,publishTargetHz:1/PACKET_INTERVAL,
  publishHz:elapsed>0?publishedSinceResume/elapsed:0,published:publishCount,
  allocatedPackets:allocated,pooledPackets:pool.length,rejectedRecycles,
  stepMeanMs:profiling?stepMs/Math.max(1,stepCount):null,
  stepPeakMs:profiling?stepPeak:null,packMs,reconstructionMs:sim.reconstructionMs,
  debtMs:debt*1000,steps:stepCount,totalSteps:sim.steps,...startup
 };
 postMessage({type,...p,profile,metrics:type!=='frame'||publishCount%6===0?sim.metrics():undefined},[p.surface.buffer,p.material.buffer,p.flow.buffer]);
 publishCount++;
 return true;
}
function recycle(data){
 const keys=['surface','material','flow'];
 const valid=keys.every(key=>data[key] instanceof Float32Array&&data[key].length===sim.n*4);
 const unique=valid&&new Set(keys.map(key=>data[key].buffer)).size===keys.length;
 const duplicate=valid&&pool.some(p=>keys.some(key=>p[key].buffer===data[key].buffer));
 if(!valid||!unique||duplicate||pool.length>=Math.min(allocated,MAX_PACKET_SETS)){rejectedRecycles++;return;}
 pool.push({surface:data.surface,material:data.material,flow:data.flow});
}
onmessage=async ({data})=>{
 if(data.type==='init'){
  if(initializing||ready)return;
  initializing=true;profiling=!!data.profile;
  // The baked original-grid state is never downloaded or reinterpreted for a
  // coarse grid. All fallback starts run exactly 2,160 deterministic steps.
  const hydrationAt=performance.now();
  if(USE_BAKED_STATE&&sim.g.nx===241&&sim.g.nz===401&&sim.g.dx===.3&&sim.g.dz===.3){
   try{
    const response=await fetch(new URL('../initial-state.bin.gz',import.meta.url));
    if(!response.ok)throw new Error('No baked state');
    const raw=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const a=new Float32Array(raw),keys=['h','u','v','foam','old','wet','film','qx','qz'];
    if(a[0]!==185||a[1]!==sim.g.nx||a[2]!==sim.g.nz||a.length!==8+sim.n*keys.length||!Number.isFinite(a[3])||!Number.isFinite(a[4]))throw new Error('Incompatible state');
    keys.forEach((key,i)=>sim[key].set(a.subarray(8+i*sim.n,8+(i+1)*sim.n)));
    sim.time=a[3];sim.steps=a[4];startup.hydrated=true;
    postMessage({type:'progress',value:1});
   }catch{}
  }
  startup.hydrationMs=performance.now()-hydrationAt;
  const warmupAt=performance.now();
  for(let block=0;!startup.hydrated&&block<9;block++){
   for(let i=0;i<240;i++){sim.step(PHYSICS_DT);startup.warmupSteps++;}
   postMessage({type:'progress',value:(block+1)/9});
   await new Promise(r=>setTimeout(r,0));
  }
  startup.warmupMs=startup.hydrated?0:performance.now()-warmupAt;
  ready=true;publish('ready');
 }else if(data.type==='recycle')recycle(data);
 else if(data.type==='step'&&ready){
  if(!paused){const count=Math.max(0,Math.min(6,Math.floor(Number(data.count)||0)));for(let i=0;i<count;i++)sim.step(PHYSICS_DT);}
  publish();
 }else if(data.type==='configure')sim.configure(data.value);
 else if(data.type==='pause'){paused=!!data.value;if(paused)clearTimeout(timer);else resume();}
 // Quality is render-only in this comparison; never change publication cadence.
};
