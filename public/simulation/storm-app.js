import {validateStormFrame,cellAt} from './storm.js';
const $=id=>document.getElementById(id);let manifest,gauge,version=0;
async function json(url){const r=await fetch(url);if(!r.ok)throw Error(`Recorded data HTTP ${r.status}`);return r.json();}
function observation(entry){
 const start=Date.parse(manifest.start),end=Date.parse(manifest.end),peak=Math.max(...gauge.points.map(p=>p.valueM3s)),x=t=>40+(Date.parse(t)-start)/(end-start)*540;
 const points=gauge.points.filter(p=>Date.parse(p.time)>=start&&Date.parse(p.time)<=end),path=points.map((p,i)=>`${i?'L':'M'}${x(p.time)},${240-p.valueM3s/peak*205}`).join(' ');
 $('storm-gauge').innerHTML=`<path d="M40 20V240H580" fill="none" stroke="#879ea9"/><path d="${path}" fill="none" stroke="#edbb66" stroke-width="2"/><path d="M${x(entry.end)} 25V240" stroke="#82b6ff"/><text x="40" y="16" fill="white">${peak.toFixed(1)} m³/s</text><text x="40" y="270" fill="white">Sep 8 07Z</text><text x="470" y="270" fill="white">Sep 11 07Z</text>`;
 const p=points.find(p=>Date.parse(p.time)===Date.parse(entry.end));
 $('storm-observation').textContent=p?`${gauge.siteId}: ${p.valueM3s.toFixed(2)} m³/s at ${p.time}. Quality: ${JSON.stringify({approval:p.approval,qualifier:p.qualifier})}.`:'No exact observation at this hour endpoint; no interpolation.';
}
async function draw(){if(!manifest)return;const token=++version,index=Number($('storm-hour').value),entry=manifest.hours[index],ctx=$('storm-map').getContext('2d');ctx.clearRect(0,0,600,550);$('storm-rain').textContent='';$('storm-time').textContent=`${entry.start} through ${entry.end} (UTC), preceding one-hour accumulation`;observation(entry);
 try{if(entry.status==='unavailable')throw Error('This rainfall hour is unavailable; no zero substitution');const frame=validateStormFrame(manifest,entry,await json('./data/storm-2014/'+entry.file));if(token!==version)return;
 const g=manifest.grid,w=600/g.cols,h=550/g.rows;frame.depthMm.forEach((v,i)=>{ctx.fillStyle=v===null?'#777':`hsl(205 65% ${94-Math.min(v/20,1)*65}%)`;ctx.fillRect(i%g.cols*w,Math.floor(i/g.cols)*h,w+.2,h+.2);});
 const at=cellAt(g,-111.3019666667,32.4715888889);if(at!==null){ctx.strokeStyle='#e5ac26';ctx.lineWidth=3;ctx.strokeRect(at%g.cols*w-3,Math.floor(at/g.cols)*h-3,10,10);}
 $('storm-rain').textContent=`${entry.validCells} valid cells; ${entry.missingCells} missing. Regional max ${entry.maximumMm} mm. Trico-location radar cell: ${at===null||frame.depthMm[at]===null?'missing':frame.depthMm[at]+' mm'}.`;$('storm-status').textContent='Historical radar replay — no simulated depths';
 }catch(e){if(token===version)$('storm-status').textContent=e.message;}}
$('storm-hour').oninput=draw;$('storm-prev').onclick=()=>{$('storm-hour').value=Math.max(0,Number($('storm-hour').value)-1);return draw();};$('storm-next').onclick=()=>{$('storm-hour').value=Math.min(71,Number($('storm-hour').value)+1);return draw();};
try{[manifest,gauge]=await Promise.all([json('./data/storm-2014/manifest.json'),json('./data/trico-benchmark-2014-09.json').then(x=>x.normalized)]);$('storm-domain').textContent=manifest.domain;$('storm-quality').textContent=JSON.stringify({quality:manifest.quality,dailyCrossChecks:manifest.dailyCrossChecks,limitations:manifest.limitations},null,2);await draw();}catch(e){$('storm-status').textContent=`Cannot load storm replay: ${e.message}`;}
