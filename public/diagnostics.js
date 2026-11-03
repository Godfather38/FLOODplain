// Error and hang logging. It records what went wrong, what the person had just done and on
// which device: errors, failed or slow downloads, page freezes, the 3D view's own errors and
// loading steps. The last 300 entries stay in this browser (they survive a reload), and
// errors and freezes are also sent to the developer's diagnostics topic (DIAG_TOPIC), at most
// one report every 30 s. No location, account or other personal data is recorded.
//
// A freeze is caught two ways: a watchdog worker on its own thread notices missed heartbeats
// while the page is still frozen (and reports even if the tab is then closed), and the page
// measures the gap once it recovers.
import {DIAG_TOPIC} from './config.js?v=dev';
const KEY='fp-diag-log',MAX=300,SEND_GAP_MS=30000,STALL_MS=1500,SLOW_FETCH_MS=10000;
const session=Math.random().toString(36).slice(2,8);
let log=[];try{log=JSON.parse(localStorage.getItem(KEY)??'[]');}catch{}
let crumbs=[],lastAction='page opened',lastSent=0,queued=null,listeners=new Set(),worker=null;
const now=()=>new Date().toISOString();
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(log.slice(-MAX)));}catch{}};
const device=()=>({ua:navigator.userAgent,screen:`${screen.width}x${screen.height}@${devicePixelRatio}`,viewport:`${innerWidth}x${innerHeight}`,memoryGB:navigator.deviceMemory,cores:navigator.hardwareConcurrency,connection:navigator.connection?.effectiveType,heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):undefined});
const short=s=>String(s??'').replace(/\s+/g,' ').slice(0,300);

export function record(kind,message,detail={}){
 const e={t:now(),session,kind,message:short(message),action:lastAction,hash:location.hash,...detail};
 log.push(e);if(log.length>MAX)log=log.slice(-MAX);save();
 for(const fn of listeners)fn(e);
 if(kind==='error'||kind==='freeze'||kind==='3d-failed')send(e);
 return e;
}
// What the person just did, kept short, for the context of the next error or freeze.
export function crumb(text){lastAction=short(text);crumbs.push(`${new Date().toISOString().slice(11,19)} ${lastAction}`);if(crumbs.length>25)crumbs=crumbs.slice(-25);}
export const entries=()=>log.slice();
export const onEntry=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export function clear(){log=[];save();for(const fn of listeners)fn(null);}
export function reportText(extra=[]){
 return JSON.stringify({session,version:document.querySelector('script[src*="app.js"]')?.src.split('?')[1]??'',url:location.href.split('#')[0],device:device(),recent:crumbs,log:[...log.slice(-40),...extra]},null,1);
}
// Send to the diagnostics topic; a burst becomes one report.
export function send(e,{force=false}={}){
 if(!DIAG_TOPIC)return Promise.resolve(false);
 const wait=lastSent+SEND_GAP_MS-Date.now();
 if(wait>0&&!force){if(!queued){queued=setTimeout(()=>{queued=null;send(e,{force:true});},wait);}return Promise.resolve(false);}
 lastSent=Date.now();
 const body=reportText().slice(-3800);
 return fetchRaw(`https://ntfy.sh/${DIAG_TOPIC}`,{method:'POST',body,headers:{Title:`FLOODplain ${e?.kind??'report'}: ${short(e?.message).slice(0,80)}`,Tags:e?.kind==='freeze'?'hourglass':'warning'}}).then(r=>r.ok).catch(()=>false);
}
let fetchRaw=(...a)=>fetch(...a);

export function mountDiagnostics(){
 if(window.__fpDiag)return;window.__fpDiag=true;
 // Errors anywhere on the page, including scripts that never arrive.
 addEventListener('error',e=>{
  const t=e.target;
  if(t&&t!==window&&(t.tagName==='SCRIPT'||t.tagName==='LINK'))record('error',`${t.tagName.toLowerCase()} did not load: ${t.src||t.href}`);
  else record('error',e.message||'Script error',{where:e.filename?`${e.filename.split('/').pop()}:${e.lineno}:${e.colno}`:undefined,stack:short(e.error?.stack)});
 },true);
 addEventListener('unhandledrejection',e=>record('error','Unhandled: '+(e.reason?.message??e.reason),{stack:short(e.reason?.stack)}));
 const ce=console.error.bind(console);console.error=(...a)=>{record('console',a.map(x=>x?.message??(typeof x==='object'?JSON.stringify(x):x)).join(' '));ce(...a);};
 // Downloads that fail or crawl.
 const raw=window.fetch.bind(window);fetchRaw=raw;
 window.fetch=async(input,init)=>{
  const url=String(input?.url??input),started=performance.now();
  try{
   const r=await raw(input,init),ms=Math.round(performance.now()-started);
   if(!r.ok&&r.status!==404)record('fetch',`${r.status} from ${url.split('?')[0]}`,{ms});
   else if(ms>SLOW_FETCH_MS)record('slow',`${url.split('?')[0]} took ${(ms/1000).toFixed(1)} s to answer`,{ms});
   return r;
  }catch(err){if(err?.name!=='AbortError')record('fetch',`${url.split('?')[0]} failed: ${err?.message}`,{ms:Math.round(performance.now()-started)});throw err;}
 };
 // Taps and key presses on controls, as context.
 addEventListener('click',e=>{const el=e.target.closest?.('button,a,input,select,[role=tab],[role=menuitemradio]');if(!el)return;crumb(`tap ${el.getAttribute('aria-label')||el.dataset.menuRun||el.value&&el.type==='radio'&&`${el.name}=${el.value}`||el.textContent.trim().slice(0,40)||el.tagName}`);},true);
 addEventListener('change',e=>{const el=e.target;if(el.matches?.('select'))crumb(`choose ${el.getAttribute('aria-label')||el.name||'select'}=${el.value}`);},true);
 addEventListener('hashchange',()=>crumb('screen '+location.hash));
 // Freezes: measured on recovery here, and caught live by the watchdog worker.
 // A page that was hidden in between (another tab, the phone locked) is not a freeze.
 let last=performance.now(),shownAt=0;addEventListener('visibilitychange',()=>{shownAt=performance.now();});
 (function beat(t){const gap=t-last;last=t;if(gap>STALL_MS&&document.visibilityState==='visible'&&shownAt<t-gap)record('freeze',`Page froze for ${(gap/1000).toFixed(1)} s`,{ms:Math.round(gap)});requestAnimationFrame(beat);})(last);
 try{
  worker=new Worker(new URL('./diag-worker.js',import.meta.url));
  worker.postMessage({type:'start',topic:DIAG_TOPIC,session});
  setInterval(()=>worker.postMessage({type:'beat',visible:document.visibilityState==='visible',action:lastAction,report:reportText()}),1000);
 }catch{}
 // A previous visit the watchdog saw freeze, and that never came back to say so.
 try{const p=JSON.parse(localStorage.getItem('fp-diag-open')??'null');if(p&&p.session!==session&&!p.closed&&p.frozen)record('freeze',`The last visit was frozen when it ended (${p.frozen} s, during: ${p.action})`,{previous:p.session});}catch{}
 const mark=extra=>{try{localStorage.setItem('fp-diag-open',JSON.stringify({session,action:lastAction,closed:false,...extra}));}catch{}};
 mark();setInterval(()=>mark(),5000);
 worker?.addEventListener('message',e=>{if(e.data?.type==='frozen')mark({frozen:e.data.seconds});});
 addEventListener('pagehide',()=>mark({closed:true}));
 // The 3D view in its frame reports its own errors and steps.
 addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data?.fp3d)return;
  if(e.data.fp3d==='log')record(e.data.kind==='error'?'error':'3d',`3D: ${e.data.message}`,{where:e.data.where});
  else if(e.data.fp3d==='state'){
   const s=e.data;if(s.step&&s.step.split(' · ')[0]!==mount3dStep){mount3dStep=s.step.split(' · ')[0];record('3d',`3D step: ${mount3dStep}`);}
   if((s.failed||s.error)&&s.error!==last3dError){last3dError=s.error;record('3d-failed',`3D could not load: ${s.error}`);}
  }
 });
 record('open',`Opened ${location.pathname.split('/').pop()||'app'}${location.hash}`,{device:device()});
}
let mount3dStep='',last3dError='';
