// The freeze watchdog: it runs on its own thread, so it still works while the page is frozen.
// The page sends a heartbeat every second with what the person last did and its recent log.
// When beats stop for 4 s while the page is showing, this reports the freeze straight away, so
// the report arrives even if the person then closes the tab.
let topic='',session='',lastBeat=0,visible=true,report='',action='',frozenSince=0,sent=false;
self.onmessage=e=>{
 const m=e.data;
 if(m.type==='start'){topic=m.topic;session=m.session;lastBeat=Date.now();return;}
 if(m.type==='beat'){
  if(frozenSince&&sent){const s=Math.round((Date.now()-frozenSince)/1000);post(`Recovered after about ${s} s`,'white_check_mark');}
  lastBeat=Date.now();visible=m.visible;report=m.report;action=m.action;frozenSince=0;sent=false;
 }
};
function post(title,tag){
 if(!topic)return;
 fetch(`https://ntfy.sh/${topic}`,{method:'POST',body:report,headers:{Title:`FLOODplain freeze: ${title}`.slice(0,120),Tags:tag}}).catch(()=>{});
}
setInterval(()=>{
 if(!lastBeat||!visible)return;
 const gap=Date.now()-lastBeat;
 if(gap>4000&&!sent){frozenSince=lastBeat;sent=true;self.postMessage({type:'frozen',seconds:Math.round(gap/1000)});post(`page frozen ${Math.round(gap/1000)} s during: ${action}`,'hourglass');}
},1000);
