import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {GRID_PRESETS} from '../src/trial-config.js';

async function harness(grid){
 const messages=[],fetches=[];let sim,now=0;
 class FakeSimulation{
  constructor(){sim=this;this.g=grid;this.n=grid.nx*grid.nz;this.time=0;this.steps=0;this.state={};}
  step(dt){this.time+=dt;this.steps++;}
  configure(){}
  metrics(){return {nonfinite:0};}
  pack(reuse){return {...(reuse||Object.fromEntries(['surface','material','flow'].map(k=>[k,new Float32Array(this.n*4)]))),time:this.time,state:{...this.state}};}
 }
 const sandbox={ShoreSimulation:FakeSimulation,Float32Array,Set,Number,Math,Promise,URL,performance:{now:()=>++now},
  setTimeout:cb=>{queueMicrotask(cb);return 1;},clearTimeout:()=>{},
  postMessage:(data,transfer)=>messages.push(structuredClone(data,{transfer})),
  fetch:async url=>{fetches.push(String(url));throw new Error('Unexpected binary fetch');}};
 vm.createContext(sandbox);
 const source=(await readFile(new URL('../src/worker.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',"'https://localhost/src/worker.js'");
 new vm.Script(source).runInContext(sandbox);
 const send=data=>sandbox.onmessage({data});
 const recycle=packet=>send(structuredClone({type:'recycle',surface:packet.surface,material:packet.material,flow:packet.flow},{transfer:[packet.surface.buffer,packet.material.buffer,packet.flow.buffer]}));
 return {messages,fetches,send,recycle,get sim(){return sim;}};
}
test('all presets skip unavailable binaries and warm deterministically before ready',async()=>{
 for(const grid of Object.values(GRID_PRESETS)){
  const h=await harness(grid);await h.send({type:'init',profile:true});
  const ready=h.messages.find(x=>x.type==='ready');assert.ok(ready);assert.equal(h.sim.steps,2160);
  assert.equal(ready.profile.warmupSteps,2160);assert.equal(ready.profile.hydrated,false);
  assert.equal(ready.profile.kernel,'JavaScript');assert.equal(ready.profile.publishTargetHz,20);
  assert.equal(ready.profile.grid.nx,grid.nx);assert.equal(ready.profile.grid.nz,grid.nz);
  assert.equal(ready.surface.length,grid.nx*grid.nz*4);assert.equal(ready.profile.packetBytes,grid.nx*grid.nz*48);
  assert.deepEqual(h.fetches,[]);
  await h.send({type:'init',profile:true});assert.equal(h.sim.steps,2160,'duplicate init must not warm twice');
 }
});
test('backpressure never allocates a fourth packet and rejects wrong or duplicate recycle buffers',async()=>{
 const h=await harness(GRID_PRESETS.tiny);await h.send({type:'init',profile:true});
 for(let i=0;i<10;i++)await h.send({type:'step',count:1});
 let frames=h.messages.filter(x=>x.surface);assert.equal(frames.length,3);assert.equal(frames.at(-1).profile.allocatedPackets,3);
 await h.send({type:'recycle',surface:new Float32Array(4),material:new Float32Array(4),flow:new Float32Array(4)});
 const packet=frames[0],returned=structuredClone({type:'recycle',surface:packet.surface,material:packet.material,flow:packet.flow},{transfer:[packet.surface.buffer,packet.material.buffer,packet.flow.buffer]});
 await h.send(returned);await h.send(returned);
 await h.send({type:'step',count:1});frames=h.messages.filter(x=>x.surface);
 assert.equal(frames.length,4);assert.equal(frames.at(-1).profile.allocatedPackets,3);
 assert.equal(frames.at(-1).profile.rejectedRecycles,2);
 await h.send({type:'quality',interval:1/60});await h.recycle(frames[1]);await h.send({type:'step',count:1});
 assert.equal(h.messages.filter(x=>x.surface).at(-1).profile.publishTargetHz,20);
});
