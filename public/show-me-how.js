// Explicitly opened, session-only help. Never changes route, time, or model state.
const steps = [
 ['Choose your route','Open Routes & conditions. Choose your road from the route list, or open a saved route. Details shows the crossings along that route. The suggested route has the least going against it; it is not a promise of a clear road.'],
 ['Read warnings and freshness','Read the closure and warning text before the risk number. Open a crossing to see each source and its time. A recent check does not make an old reading fresh. “No data”, “Missing” and “Stale” mean conditions are unknown, not dry. County closures still apply.'],
 ['Inspect time and details','Open Map, then Map options to choose a view or model. When model water is shown, read its displayed date and hour; use the hour buttons or Time to inspect available hours. Tap a crossing or model cell for details. Depth is shown in feet and is separate from route risk. A frozen replay is not current weather.']
];
function openTour(opener) {
 if(document.querySelector('.how-dialog'))return;
 const dialog=document.createElement('dialog');dialog.className='how-dialog';dialog.setAttribute('aria-labelledby','how-title');
 dialog.innerHTML='<header><p data-guide-progress></p><button type="button" data-guide-close>Close guide</button></header><h2 id="how-title" tabindex="-1"></h2><p data-guide-copy></p><footer><button type="button" data-guide-back>Back</button><button type="button" data-guide-skip>Skip guide</button><button type="button" class="btn-primary" data-guide-next>Next</button></footer>';
 document.body.append(dialog);let step=0;
 const draw=()=>{dialog.querySelector('[data-guide-progress]').textContent=`Step ${step+1} of 3`;dialog.querySelector('h2').textContent=steps[step][0];dialog.querySelector('[data-guide-copy]').textContent=steps[step][1];dialog.querySelector('[data-guide-back]').disabled=step===0;dialog.querySelector('[data-guide-next]').textContent=step===2?'Done':'Next';dialog.querySelector('h2').focus();};
 dialog.querySelector('[data-guide-back]').onclick=()=>{step--;draw()};dialog.querySelector('[data-guide-next]').onclick=()=>{if(step===2)dialog.close();else{step++;draw()}};
 dialog.querySelector('[data-guide-close]').onclick=dialog.querySelector('[data-guide-skip]').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{dialog.remove();if(opener?.isConnected)opener.focus()});dialog.showModal();draw();
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-show-me-how]');if(button)openTour(button)});
const help=document.createElement('a');help.href='#/how';help.className='help-link';help.textContent='Help';document.querySelector('.appbar').append(help);
const riskKey=()=>{const el=document.createElement('details');el.className='risk-key';el.innerHTML='<summary>Route risk key — numbers and colors</summary><ul>'+['Low','Minor','Moderate','High','Severe','Unknown'].map((word,i)=>`<li><span class="badge ${i===5?'sq':'s'+(i+1)}">${i===5?'?':i+1}</span>${word}</li>`).join('')+'</ul><p>Risk numbers describe route evidence. Blue-to-purple model shading shows water depth in feet, not route safety. Missing or stale readings do not mean dry.</p>';return el};
window.addEventListener('flood-screen-rendered',()=>{if(!document.querySelector('.map-dock .risk-key'))document.querySelector('.map-dock')?.append(riskKey());const screen=document.querySelector('#screen');if(screen?.querySelector('.hero')&&!screen.querySelector('.risk-key'))screen.append(riskKey());});

