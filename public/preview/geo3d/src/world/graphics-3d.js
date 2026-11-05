// The graphics preset in the 3D view: drawing sharpness, ground detail and map resolution,
// satellite zoom, rain, fog and draw distance. The choice is the app's (see graphics.js); this
// page applies it, measures its own frame times, and lowers an automatic choice one step when
// frames stay slow. Edge smoothing is fixed when the view starts, so it changes on the next open.
import {current,choose,lowerAuto,PRESETS,PRESET_LABELS,pixelRatioFor,lodsFor,createFrameWatch,setActive} from '../../../../graphics.js';
import {LODS} from './detail.js';
export function startGraphics(){const g=current();setActive(g.preset);return{...g,settings:PRESETS[g.preset]};}
export const chunkDetail=name=>{const p=PRESETS[name];return{lods:lodsFor(name,LODS),anisotropy:p.anisotropy,imagery:p.imagery};};
export function mountGraphics({start,renderer,scene,camera,chunks,rain,size,busy,log}){
 let state=start,antialias=start.settings.antialias,note='';
 const watch=createFrameWatch();let lastFrame=0;
 const ratio=()=>{const [w,h]=size();return pixelRatioFor(state.preset,devicePixelRatio,{w,h});};
 function apply(next,why){
  const changed=next.preset!==state.preset;state=next;setActive(state.preset);
  const p=PRESETS[state.preset];
  note=p.antialias!==antialias?'Edge smoothing changes the next time 3D opens.':'';
  renderer.setPixelRatio(ratio());renderer.setSize(...size());
  scene.fog.near=p.fog[0];scene.fog.far=p.fog[1];camera.far=p.far;camera.updateProjectionMatrix();
  if(changed){chunks.setDetail(chunkDetail(state.preset));rain.setDetail(p.rain);}
  watch.reset(performance.now());
  log(`Graphics ${PRESET_LABELS[state.preset]} (${state.choice==='auto'?'automatic':'chosen'}): ${why}`);
 }
 apply(start,start.choice==='auto'?start.auto.reason+(start.cap?`; lowered after slow frames`:''):'chosen in Map layers');
 new ResizeObserver(()=>renderer.setPixelRatio(ratio())).observe(renderer.domElement.parentElement);
 // Choices sent by the app (embed.js), or from this page's own settings.
 window.fp3dGraphics=choice=>{const next=choose(choice);if(next.preset!==state.preset||next.choice!==state.choice)apply(next,choice==='auto'?next.auto.reason:'chosen in Map layers');};
 window.fp3dGraphicsState=()=>({choice:state.choice,preset:state.preset,reason:state.auto.reason,cap:state.cap,note});
 return{
  // Called every drawn frame. A gap (paused, hidden) starts the measuring over.
  frame(dt,now){
   if(now-lastFrame>500||document.visibilityState!=='visible'||busy())watch.reset(now);lastFrame=now;
   if(!watch.add(dt,now))return;
   const before=state.preset,next=lowerAuto();
   if(next.preset!==before)apply(next,`frames stayed slower than 25 per second on ${PRESET_LABELS[before]}`);
   else{log(`Frames stayed slower than 25 per second on ${PRESET_LABELS[before]}${state.choice==='auto'?'':' (chosen by hand, so left as it is)'}`);watch.reset(now+60000);}
  },
  get preset(){return state.preset;},
 };
}
