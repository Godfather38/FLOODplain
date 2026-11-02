// A bookmarked view of an existing native run, never a new simulation or observation.
export const BRAWLEY_REPLAY={id:'brawley-nov1',runId:'refined-full-41344983607',geometrySha256:'77d581fff18b51fba5d1f6f935de78285364c4223824e2251c242e211d7e8b7b',time:'2026-11-01T22:00:00Z',center:[32.39285,-111.29485],zoom:17};
export const savedReplay=search=>new URLSearchParams(search).get('replay')===BRAWLEY_REPLAY.id?BRAWLEY_REPLAY:null;
export function replayFrame(manifest,frames,replay=BRAWLEY_REPLAY){
 if(manifest.runId!==replay.runId||manifest.geometry?.sha256!==replay.geometrySha256)throw Error('Saved replay source is unavailable; no different run substituted');
 const index=frames.findIndex(f=>f.time===replay.time);if(index<0)throw Error('Saved replay time is unavailable');return index;
}
export function replayURL(href,enabled){const url=new URL(href);url.hash='/map';if(enabled){url.searchParams.set('case','refined');url.searchParams.set('replay',BRAWLEY_REPLAY.id);url.searchParams.delete('live');}else{url.searchParams.delete('case');url.searchParams.delete('replay');url.searchParams.set('live','1');}return url.href;}
export function mountSavedReplay(dock,sharedState){
 const replay=savedReplay(location.search),box=document.createElement('section');box.className='saved-replay';box.setAttribute('aria-label','Saved model replay');
 if(replay){box.innerHTML='<div><strong>REPLAY · Saved model run</strong><a data-return-live>Return to live</a></div><p data-replay-time role="status">Loading Nov 1, 2026, 3:00 PM MST…</p><details><summary>About this replay</summary><p>Brawley Wash · frozen Nov 1–2, 2026 model. Not observed historical flooding. Blue/purple water is modeled cell-average depth; deeper water south of the road is not road depth. No flow animation is shown.</p><p>Route and gauge symbols are current warnings/readings, not evidence from the replay date. Open Routes for their source times. Existing closures and warnings still apply.</p></details>';
  box.querySelector('[data-return-live]').href=replayURL(location.href,false);
  sharedState.subscribe(s=>{box.querySelector('[data-replay-time]').textContent=s.displayed?.runId===replay.runId?new Date(s.displayed.time).toLocaleString('en-US',{timeZone:'America/Phoenix',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MST · model water':s.status==='error'?'Replay unavailable — no replacement run shown':'Loading saved model water…';});
 }else{const link=document.createElement('a');link.href=replayURL(location.href,true);link.textContent='Preview saved water · Brawley';link.dataset.startReplay='';box.append(link);}
 dock.prepend(box);document.body.classList.toggle('saved-replay-active',Boolean(replay));
 return replay;
}
