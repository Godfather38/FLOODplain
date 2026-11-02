// Browser observations, not a phone simulator. GPU queries are optional.
export const summarize=values=>{
 if(!values.length)return null;
 const sorted=values.slice().sort((a,b)=>a-b),p=q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))];
 return {mean:values.reduce((a,b)=>a+b,0)/values.length,p50:p(.5),p95:p(.95),p99:p(.99),max:sorted.at(-1),over33ms:values.filter(x=>x>1000/30).length,over100ms:values.filter(x=>x>100).length};
};
export class FrameProfile{
 constructor(){this.run=null;this.queryPending=false;this.last=null;}
 record(frameMs,cpuMs,renderer){
  const run=this.run;
  if(run){run.frame.push(frameMs);run.cpu.push(cpuMs);run.triangles=renderer.info.render.triangles;run.drawCalls=renderer.info.render.drawCalls??renderer.info.render.calls;}
  if(renderer.backend.trackTimestamp&&!this.queryPending){
   this.queryPending=true;
   renderer.resolveTimestampsAsync().then(ms=>{if(run&&this.run===run&&Number.isFinite(ms))run.gpu.push(ms);}).catch(()=>{}).finally(()=>{this.queryPending=false;});
  }
 }
 async measure(seconds,snapshot){
  if(this.run)throw new Error('A measurement is already running');
  if(!Number.isFinite(seconds)||seconds<5||seconds>30)throw new Error('Use 5–30 seconds');
  const start=snapshot(),at=performance.now(),heap=performance.memory?.usedJSHeapSize??null;
  const run=this.run={frame:[],cpu:[],gpu:[]};
  await new Promise(resolve=>setTimeout(resolve,seconds*1000));
  this.run=null;
  const elapsed=(performance.now()-at)/1000,end=snapshot(),canvas=document.querySelector('canvas'),frameMs=summarize(run.frame);
  return this.last={label:'Local cloud trial — not a phone benchmark',seconds:elapsed,frames:run.frame.length,fps:run.frame.length/elapsed,frameMs,cpuMs:summarize(run.cpu),gpuMs:summarize(run.gpu),simulationRate:(end.time-start.time)/elapsed,renderTimeRate:(end.renderTime-start.renderTime)/elapsed,interpolationHoldFrames:end.interpolationHoldFrames-start.interpolationHoldFrames,triangles:run.triangles,drawCalls:run.drawCalls,viewport:[innerWidth,innerHeight],buffer:[canvas.width,canvas.height],devicePixelRatio,heapBytes:{supported:heap!==null,start:heap,end:performance.memory?.usedJSHeapSize??null},availableSystemMemory:null,proposedGate:{target:'30 FPS, 720p cap; real-phone acceptance still required',frameP95AtMost33_34ms:frameMs?frameMs.p95<=33.34:null,simulationRateAtLeast0_95:(end.time-start.time)/elapsed>=.95},userAgent:navigator.userAgent,start,end};
 }
}
