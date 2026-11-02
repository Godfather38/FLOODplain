// The one notice for simulated or modeled water: shown when a viewer first opens that content,
// and not again after they dismiss it. Permanent banners and tags are deliberately not used.
export const ACKNOWLEDGEMENTS=Object.freeze({
 simulated:{title:'This water is simulated',body:"It is a 3D model, not real conditions or a forecast. If you see water on a real road, turn around, don't drown."},
 estimate:{title:'This water is a model estimate',body:"It is estimated by a model from river flow and terrain, not observed water or a measured depth. If you see water on a real road, turn around, don't drown."},
 savedRun:{title:'This water is from a saved run',body:"It is a saved model run from November 2026, not real conditions or a forecast. If you see water on a real road, turn around, don't drown."},
});
const key=kind=>'floodplain-ack-'+kind;
const dismissedThisPage=new Set();
function read(kind,storage){try{return storage?.getItem(key(kind))==='1'}catch{return false}}
export function isAcknowledged(kind,storage=globalThis.localStorage){return dismissedThisPage.has(kind)||read(kind,storage)}
export function acknowledge(kind,storage=globalThis.localStorage){
 dismissedThisPage.add(kind);
 try{storage?.setItem(key(kind),'1')}catch{/* Blocked storage: remembered for this page only. */}
}
export function resetForTest(){dismissedThisPage.clear()}

const CSS='.model-ack{background:var(--surface,#fff);color:var(--on,#1b1b1a);border:2px solid var(--muted,#55544f);border-radius:16px;padding:20px;width:min(26rem,calc(100% - 32px));line-height:1.5;font:inherit}.model-ack::backdrop{background:#0007}.model-ack h2{margin:0 0 8px;font-size:1.25rem;line-height:1.3}.model-ack p{margin:0 0 16px}.model-ack button{min-height:48px;min-width:96px;padding:10px 18px;border:0;border-radius:12px;background:var(--primary,#155fbd);color:var(--on-primary,#fff);font:inherit;font-weight:700;cursor:pointer}';
let open=null;const waiting=[];
function next(doc,storage){const kind=waiting.shift();if(kind)showAcknowledgement(kind,{document:doc,storage})}
// Call this when simulated or modeled water first appears on screen.
export function showAcknowledgement(kind,{document:doc=globalThis.document,storage=globalThis.localStorage}={}){
 const text=ACKNOWLEDGEMENTS[kind];
 if(!text)throw Error('Unknown acknowledgement: '+kind);
 if(!doc||isAcknowledged(kind,storage))return false;
 if(open){if(open!==kind&&!waiting.includes(kind))waiting.push(kind);return false}
 if(!doc.querySelector('style[data-model-ack]')){const style=doc.createElement('style');style.dataset.modelAck='';style.textContent=CSS;doc.head.append(style)}
 const dialog=doc.createElement('dialog');dialog.className='model-ack';dialog.dataset.kind=kind;dialog.setAttribute('aria-labelledby','model-ack-title');
 const title=doc.createElement('h2');title.id='model-ack-title';title.textContent=text.title;
 const body=doc.createElement('p');body.textContent=text.body;
 const button=doc.createElement('button');button.type='button';button.textContent='Got it';
 dialog.append(title,body,button);doc.body.append(dialog);open=kind;
 // Save the dismissal at the click: the close event can lag on a busy or backgrounded page.
 let finished=false;
 const finish=()=>{if(finished)return;finished=true;acknowledge(kind,storage);if(dialog.open)dialog.close();dialog.remove();open=null;next(doc,storage)};
 button.onclick=finish;
 // Closing by any other route, including Escape, counts as dismissing it too.
 dialog.addEventListener('close',finish);
 dialog.showModal();button.focus();
 return true;
}
