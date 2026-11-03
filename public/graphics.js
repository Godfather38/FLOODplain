// Graphics presets: how much drawing work the map does on this device. They change only how
// sharp and how far things are drawn, never what the data says. The choice is made once per
// device from its graphics chip, memory, processor count, screen and connection, can be set by
// hand in Map layers, and is kept in this browser. The 2D map and the 3D view (a same-origin
// frame) read the same stored choice.
export const PRESET_NAMES=['low','medium','high','ultra'];
export const PRESET_LABELS={low:'Low',medium:'Medium',high:'High',ultra:'Ultra'};
// High is the look the map had before presets. Each field:
//  pixelRatio: 3D drawing pixels per screen pixel (cap; 'full' uses the screen's own ratio,
//   at least superSample); antialias: smooth edges (needs the 3D view reopened);
//  reach: how far each finer ground detail level reaches (×); mesh: ground triangles per 1 km
//   chunk at each level (100 = one per 10 m lidar sample, the data's own spacing);
//  paint: painted street map pixels per chunk at each level; imagery: satellite zoom above the
//   street map tiles, and its highest zoom; anisotropy: texture sharpness at low angles;
//  rain: drops, streak length and the tallest rain column (m); fog and far: draw distance (m);
//  canvas: 2D model layer, street tiles and timeline pixels per screen pixel (cap).
export const PRESETS=Object.freeze({
 low:Object.freeze({pixelRatio:1,antialias:false,reach:.6,mesh:[50,25,10,5],paint:[512,256,128,64],imagery:[1,15],anisotropy:1,rain:{count:2500,length:.025,column:900},fog:[9000,38000],far:60000,canvas:1}),
 medium:Object.freeze({pixelRatio:1.25,antialias:true,reach:.85,mesh:[100,50,25,10],paint:[1024,512,256,128],imagery:[2,16],anisotropy:4,rain:{count:6000,length:.03,column:1200},fog:[12000,50000],far:120000,canvas:1.5}),
 high:Object.freeze({pixelRatio:1.5,antialias:true,reach:1,mesh:[100,50,25,10],paint:[1024,512,256,128],imagery:[2,17],anisotropy:4,rain:{count:9000,length:.03,column:1500},fog:[14000,60000],far:200000,canvas:2}),
 ultra:Object.freeze({pixelRatio:'full',superSample:1.5,antialias:true,reach:1.5,mesh:[100,100,50,20],paint:[2048,1024,512,256],imagery:[3,18],anisotropy:16,rain:{count:30000,length:.05,column:2600},fog:[26000,130000],far:300000,canvas:3}),
});
const rank=name=>PRESET_NAMES.indexOf(name);
const lower=(a,b)=>rank(a)<=rank(b)?a:b;
export const stepDown=name=>PRESET_NAMES[Math.max(0,rank(name)-1)];

// The graphics chip, from its WebGL renderer name, e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 5070
// (0x00002F04) Direct3D11 vs_5_0 ps_5_0, D3D11)". Returns a preset and a plain reason.
export function classifyGpu(name=''){
 const s=String(name);
 if(!s)return{preset:null,reason:'graphics chip not reported'};
 if(/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(s))return{preset:'low',reason:'software drawing, no graphics chip in use'};
 let m;
 if((m=s.match(/RTX\s*(?:PRO\s*)?(\d{4})(\s*(?:Ti|SUPER))?/i))){const n=Number(m[1]),tier=n%100;return{preset:tier>=70&&n>=3000?'ultra':tier>=50?'high':'medium',reason:`NVIDIA RTX ${n}${m[2]?' '+m[2].trim():''}`};}
 if(/RTX\s*A?\d{4}|Quadro RTX|NVIDIA (?:RTX )?A\d{3,4}0/i.test(s))return{preset:'ultra',reason:'NVIDIA workstation RTX'};
 if((m=s.match(/GTX\s*(\d{3,4})/i))){const n=Number(m[1]);return{preset:n>=1070?'high':n>=1050?'medium':'low',reason:`NVIDIA GTX ${n}`};}
 if(/GeForce\s*MX|NVIDIA.*MX\d{3}/i.test(s))return{preset:'medium',reason:'NVIDIA MX laptop chip'};
 if((m=s.match(/RX\s*(\d{4})/i))){const n=Number(m[1]),tier=n%1000;return{preset:n>=6000&&tier>=800||n>=9000&&tier>=70?'ultra':n>=5000?'high':'medium',reason:`AMD Radeon RX ${n}`};}
 if(/Radeon.*(Vega|\(TM\) Graphics|Graphics)|AMD.*Radeon\(TM\)\s*\d{3}M/i.test(s))return{preset:'medium',reason:'AMD built-in graphics'};
 if(/Arc\(TM\)\s*A[57]\d\d|Arc A[57]\d\d|Arc\(TM\) B\d{3}|Arc B\d{3}/i.test(s))return{preset:'high',reason:'Intel Arc graphics card'};
 if(/Intel.*(Iris|Arc)/i.test(s))return{preset:'medium',reason:'Intel Iris or Arc built-in graphics'};
 if(/Intel.*(UHD|HD Graphics|Graphics)/i.test(s))return{preset:'low',reason:'Intel UHD built-in graphics'};
 if((m=s.match(/Apple M(\d)\s*(Pro|Max|Ultra)?/i)))return{preset:/max|ultra/i.test(m[2]??'')?'ultra':'high',reason:`Apple M${m[1]}${m[2]?' '+m[2]:''}`};
 if(/Apple GPU|Apple/i.test(s))return{preset:'medium',reason:'Apple graphics'};
 if((m=s.match(/Adreno\D*(\d{3})/i))){const n=Number(m[1]);return{preset:n>=730?'medium':'low',reason:`Adreno ${n}`};}
 if(/Mali|PowerVR|Immortalis|Xclipse|Maleoon/i.test(s))return{preset:'low',reason:'phone graphics'};
 if(/NVIDIA|GeForce/i.test(s))return{preset:'high',reason:'NVIDIA graphics'};
 if(/AMD|Radeon/i.test(s))return{preset:'high',reason:'AMD graphics'};
 return{preset:null,reason:'graphics chip not recognised'};
}

// The automatic choice. device: {gpu, memoryGB, cores, screen:{w,h}, dpr, touch, mobile,
// saveData, effectiveType}. Phones and low-memory devices start at Low.
export function choosePreset(device={}){
 const gpu=classifyGpu(device.gpu),why=[];
 let preset=gpu.preset??'medium';why.push(gpu.preset?gpu.reason:gpu.reason+', so Medium');
 const cap=(to,reason)=>{if(rank(to)<rank(preset)){preset=to;why.push(reason);}};
 const shortSide=Math.min(device.screen?.w??1e4,device.screen?.h??1e4);
 if(device.mobile||(device.touch&&shortSide<=600))cap('low','a phone');
 if(device.memoryGB!=null&&device.memoryGB<=4)cap('low',`${device.memoryGB} GB of memory`);
 if(device.saveData)cap('low','data saver is on');
 if(/^(slow-2g|2g|3g)$/.test(device.effectiveType??''))cap('low','a slow connection');
 if(device.cores!=null&&device.cores<=4)cap('medium',`${device.cores} processor cores`);
 if(device.memoryGB!=null&&device.memoryGB<=6)cap('medium',`${device.memoryGB} GB of memory`);
 return{preset,reason:why.join('; ')};
}
export const shortGpu=s=>{const t=String(s??'').match(/^ANGLE \([^,]*,\s*(.*?)(?:\s*\(0x[0-9a-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|Metal|,|\))/i)?.[1]??String(s??'');return t.replace(/\s+/g,' ').trim().slice(0,60);};

// The graphics chip's name, from a throwaway WebGL context.
export function readGpu(){
 try{
  const c=document.createElement('canvas'),gl=c.getContext('webgl2')||c.getContext('webgl');if(!gl)return'';
  const ext=gl.getExtension('WEBGL_debug_renderer_info'),name=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  gl.getExtension('WEBGL_lose_context')?.loseContext();return String(name??'');
 }catch{return'';}
}
export function readDevice(){
 const n=globalThis.navigator??{},c=n.connection??{},scr=globalThis.screen??{};
 return{gpu:readGpu(),memoryGB:n.deviceMemory,cores:n.hardwareConcurrency,screen:{w:scr.width,h:scr.height},dpr:globalThis.devicePixelRatio||1,
  touch:(n.maxTouchPoints??0)>0,mobile:!!n.userAgentData?.mobile||/Android.+Mobile|iPhone|iPod/.test(n.userAgent??''),saveData:!!c.saveData,effectiveType:c.effectiveType};
}

// Stored per device: {choice: 'auto'|preset, auto: {preset, reason, gpu, ua}, cap: preset after
// slow frames}. 'auto' resolves to the detected preset, lowered to the cap if one was set.
const KEY='fp-graphics';
const store=globalThis.localStorage;
function readStored(){try{return JSON.parse(store?.getItem(KEY)??'null')??{};}catch{return{};}}
function writeStored(v){try{store?.setItem(KEY,JSON.stringify(v));}catch{}}
export function resolve(saved,detect=readDevice){
 let auto=saved.auto,ua=globalThis.navigator?.userAgent??'';
 if(!auto||auto.ua!==ua||!PRESET_NAMES.includes(auto.preset)){const d=detect();auto={...choosePreset(d),gpu:shortGpu(d.gpu),ua};saved={...saved,auto,cap:null};}
 const choice=PRESET_NAMES.includes(saved.choice)?saved.choice:'auto';
 const preset=choice==='auto'?(saved.cap?lower(auto.preset,saved.cap):auto.preset):choice;
 return{saved:{...saved,choice},choice,preset,auto,cap:saved.cap??null};
}
export function current(){const r=resolve(readStored());writeStored(r.saved);return r;}
// A choice from Map layers. Choosing Automatic again forgets an earlier slow-frame step-down.
export function choose(choice){const s=readStored();writeStored({...s,choice:PRESET_NAMES.includes(choice)?choice:'auto',cap:choice==='auto'?null:s.cap??null});return current();}
// Slow frames on an automatic choice: one step lower, kept for this device.
export function lowerAuto(){const r=current();if(r.choice!=='auto'||r.preset==='low')return r;writeStored({...r.saved,cap:stepDown(r.preset)});return current();}

// What a preset means on this screen.
export function pixelRatioFor(name,dpr=globalThis.devicePixelRatio||1,{w=1920,h=1080}={}){
 const p=PRESETS[name]??PRESETS.high;
 if(p.pixelRatio!=='full')return Math.min(dpr,p.pixelRatio);
 // Full screen sharpness, drawn a little finer still on a standard screen, within ~14 million pixels.
 const want=Math.min(3,Math.max(dpr,p.superSample??1));
 return Math.max(dpr>=1?1:dpr,Math.min(want,Math.sqrt(14e6/Math.max(1,w*h))));
}
export const canvasRatio=(name=activePreset(),dpr=globalThis.devicePixelRatio||1)=>Math.min(dpr,(PRESETS[name]??PRESETS.high).canvas);
// The 3D ground detail levels for a preset: same switching rules, scaled reach and resolution.
export function lodsFor(name,base){
 const p=PRESETS[name]??PRESETS.high;
 return base.map((l,i)=>({...l,n:p.mesh[i],px:p.paint[i],reach:l.reach===Infinity?Infinity:Math.round(l.reach*p.reach)}));
}

// Sustained slow frames: true once at least 70% of frames over 6 s took longer than limitMs.
// Pauses, hidden pages and the first seconds after a change are not counted.
export function createFrameWatch({limitMs=40,windowMs=6000,settleMs=8000,share=.7}={}){
 let since=0,slow=0,count=0,span=0;
 return{
  reset(now){since=now;slow=count=span=0;},
  add(dt,now){
   if(now-since<settleMs)return false;
   count++;span+=Math.min(dt,250);if(dt>limitMs)slow++;
   if(span<windowMs)return false;
   const bad=slow/count>=share;slow=count=span=0;return bad;
  },
 };
}
// The preset in use in this document, for drawing code that asks without being told.
// Read from the stored choice the first time it is asked for.
let active=null;
export const setActive=name=>{if(PRESETS[name])active=name;};
export const activePreset=()=>active??=(globalThis.document?current().preset:'high');
