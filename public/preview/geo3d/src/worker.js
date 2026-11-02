// Same pacing as the demo's worker: 60 Hz physics, at most 20 Hz packets, and
// exactly three transferable packet sets, so nothing is allocated while running.
import {ChannelSimulation} from './channel-sim.js';
const MAX_PACKET_SETS=3,PACKET_INTERVAL=1/20,PHYSICS_DT=1/60,WARMUP_BLOCKS=15;
let sim=null,paused=true,ready=false,timer=null,lastWall=0,debt=0,nextPublish=0,allocated=0,publishCount=0,publishedSinceResume=0,publishWindowAt=0,stepMs=0,stepCount=0,warmupMs=0;
const pool=[];
function schedule(){clearTimeout(timer);if(!paused&&ready)timer=setTimeout(tick,Math.max(1,(PHYSICS_DT-debt)*1000-(performance.now()-lastWall)));}
function tick(){
 if(paused||!ready)return;
 const now=performance.now();debt+=(now-lastWall)/1000;lastWall=now;
 const count=Math.min(6,Math.floor((debt+1e-7)/PHYSICS_DT)),at=performance.now();
 for(let i=0;i<count;i++)sim.step(PHYSICS_DT);
 if(count){stepMs+=performance.now()-at;stepCount+=count;}
 debt-=count*PHYSICS_DT;
 if(sim.time>=nextPublish&&publish())nextPublish=sim.time+PACKET_INTERVAL-.00001;
 schedule();
}
function publish(type='frame'){
 if(!pool.length&&allocated>=MAX_PACKET_SETS)return false;
 const reuse=pool.pop();if(!reuse)allocated++;
 const p=sim.pack(reuse);
 if(type==='frame')publishedSinceResume++;
 const elapsed=(performance.now()-publishWindowAt)/1000;
 const profile={stepMeanMs:stepMs/Math.max(1,stepCount),publishHz:elapsed>0?publishedSinceResume/elapsed:0,warmupMs,allocatedPackets:allocated,debtMs:debt*1000};
 postMessage({type,...p,profile,metrics:type!=='frame'||publishCount%6===0?sim.metrics():undefined},[p.surface.buffer,p.material.buffer,p.flow.buffer]);
 publishCount++;
 return true;
}
onmessage=async ({data})=>{
 if(data.type==='init'){
  sim=new ChannelSimulation(data.grid,data.bed,data.sources);
  const at=performance.now();
  // 60 simulated seconds, so water has reached the outlet before the first frame.
  for(let block=0;block<WARMUP_BLOCKS;block++){
   for(let i=0;i<240;i++)sim.step(PHYSICS_DT);
   postMessage({type:'progress',value:(block+1)/WARMUP_BLOCKS});
   await new Promise(r=>setTimeout(r,0));
  }
  warmupMs=performance.now()-at;ready=true;publish('ready');
 }else if(data.type==='recycle'){
  if(pool.length<Math.min(allocated,MAX_PACKET_SETS))pool.push({surface:data.surface,material:data.material,flow:data.flow});
 }else if(data.type==='pause'){
  paused=!!data.value;
  if(paused)clearTimeout(timer);
  else{lastWall=performance.now();debt=0;nextPublish=sim?.time??0;publishWindowAt=lastWall;publishedSinceResume=0;schedule();}
 }
};
