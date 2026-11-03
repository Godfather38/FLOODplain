// The simulator's panels for the Map tab (map-app.js): the scenario deck, the crossing
// scoreboard, the run's timeline figure and the methods note. Every number comes from the run
// that is loaded; nothing here is observed water.
import {COVER_M} from './simulation/sim-2d.js?v=dev';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const ft=m=>m/.3048;
const hourText=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/Phoenix',hour:'numeric'});
const num=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'–';

// --- scenario deck ---
export function deckHtml(runs,current,live){
 return `<div class="sim-deck">${runs.map(r=>{
  const c=r.card??{},on=r.id===current;
  const pips=c.severity?`<span class="sev" aria-label="Severity ${c.severity} of 5">${[1,2,3,4,5].map(i=>`<i class="${i<=c.severity?'on':''}"></i>`).join('')}</span>`:'<span class="sev live-dot" aria-label="Updates every hour"><i class="on"></i>hourly</span>';
  const stats=r.live?(live?`<dl><div><dt>Peak wet</dt><dd>${num(live.wetKm2,1)} km²</dd></div><div><dt>Rain</dt><dd>${num(live.rainInH,2)} in/h</dd></div><div><dt>River</dt><dd>${Math.round(live.riverCfs).toLocaleString()} ft³/s</dd></div></dl>`:'<dl><div><dt>Status</dt><dd>Newest hourly run</dd></div></dl>')
   :`<dl><div><dt>Peak rain</dt><dd>${num(c.rainInH,2)} in/h</dd></div><div><dt>River</dt><dd>${Math.round(c.riverCfs).toLocaleString()} ft³/s</dd></div><div><dt>Peak wet</dt><dd>${num(c.wetKm2,1)} km²</dd></div></dl>`;
  return `<article class="sim-card k-${(c.kind??'').toLowerCase().replace(/[^a-z]/g,'')}${on?' on':''}"><header><span class="kind">${esc(c.kind??'')}</span>${pips}</header><h4>${esc(c.short??r.label)}</h4><p>${esc(c.blurb??'')}</p>${stats}<button type="button" data-sim-load="${r.id}"${on?' aria-pressed="true"':''}>${on?'Loaded':'Load scenario'}</button></article>`;
 }).join('')}</div>`;
}

// --- crossing scoreboard ---
// over: water surface minus road height (m). Neutral words: water over the road, water near it, none.
export function crossingWord(over){
 if(!Number.isFinite(over))return{cls:'none',text:'No model result'};
 if(over>COVER_M)return{cls:'over',text:`${num(ft(over),1)} ft over the road`};
 if(over>-.3)return{cls:'near',text:`Water within ${num(Math.max(0,ft(-over)),1)} ft of the road`};
 return{cls:'dry',text:'No water at the road'};
}
export function scoreboardHtml(list,hour,times){
 if(!list)return'<p class="sim-muted">Loading road and bridge-deck heights…</p>';
 const inside=list.filter(c=>c.inside),now=c=>c.over[hour];
 const overCount=inside.filter(c=>now(c)>COVER_M).length;
 const rows=[...inside].sort((a,b)=>(now(b)||-99)-(now(a)||-99)).map(c=>{
  const v=now(c),w=crossingWord(v),peakIdx=c.over.reduce((b,x,k)=>x>(c.over[b]??-99)?k:b,0),peak=c.over[peakIdx];
  const pct=Math.max(0,Math.min(100,(ft(v)+3)/6*100));
  return `<button type="button" class="sim-row ${w.cls}" data-sim-crossing="${esc(c.fp.id)}"><span class="name">${esc(c.fp.short??c.fp.name)}<small>${c.road.deck?'Bridge deck':'Road'} ${num(ft(c.road.m),1)} ft NAVD88</small></span><span class="meter" aria-hidden="true"><i style="width:${pct}%"></i><b></b></span><span class="word">${w.text}</span><small class="peak">${peak>COVER_M?`Peak ${num(ft(peak),1)} ft over at ${hourText(times[peakIdx])}`:`Highest: ${crossingWord(peak).text.toLowerCase()}`}</small></button>`;
 }).join('');
 const outside=list.length-inside.length;
 return `<div class="sim-score"><div class="sim-big"><b>${overCount}</b><span>of ${inside.length} crossings with water over the road this hour</span></div>${rows}${outside?`<p class="sim-muted">${outside} crossing${outside>1?'s are':' is'} outside the model area.</p>`:''}<p class="sim-fig"><b>Table 2.</b> Water surface in the model cell at each crossing's road point minus the lidar road or bridge-deck height. The meter runs from 3 ft below the road to 3 ft over it.</p></div>`;
}

// --- timeline figure: rain from the top (a hyetograph), wet area from the bottom, river inflow as
// a line, crossings with water over the road as red ticks, and the current hour.
export function drawTimeline(canvas,run,clock,overByHour){
 const r=Math.min(2,devicePixelRatio||1),w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
 canvas.width=w*r;canvas.height=h*r;const ctx=canvas.getContext('2d');ctx.setTransform(r,0,0,r,0,0);ctx.clearRect(0,0,w,h);
 const s=run?.series;if(!s?.length)return;
 const n=s.length,x=i=>n<2?w/2:6+(w-12)*i/(n-1),bw=Math.max(2,(w-12)/n*.7);
 const css=getComputedStyle(canvas),grid=css.getPropertyValue('--divider')||'#ccc';
 ctx.strokeStyle=grid;ctx.lineWidth=1;ctx.beginPath();for(let i=0;i<n;i++){ctx.moveTo(x(i)+.5,0);ctx.lineTo(x(i)+.5,h);}ctx.globalAlpha=.35;ctx.stroke();ctx.globalAlpha=1;
 const maxR=Math.max(...s.map(v=>v.rainMmH),.5),maxW=Math.max(...s.map(v=>v.wetKm2),.1),maxQ=Math.max(...s.map(v=>v.inflowM3s),1);
 ctx.fillStyle='#3cbf4a';for(let i=0;i<n;i++){const b=s[i].rainMmH/maxR*h*.38;ctx.fillRect(x(i)-bw/2,0,bw,b);}
 ctx.beginPath();ctx.moveTo(x(0),h);for(let i=0;i<n;i++)ctx.lineTo(x(i),h-s[i].wetKm2/maxW*h*.55);ctx.lineTo(x(n-1),h);ctx.closePath();ctx.fillStyle='rgba(58,159,208,.55)';ctx.fill();ctx.strokeStyle='#2272b5';ctx.lineWidth=1.5;ctx.beginPath();for(let i=0;i<n;i++){const y=h-s[i].wetKm2/maxW*h*.55;i?ctx.lineTo(x(i),y):ctx.moveTo(x(i),y);}ctx.stroke();
 if(s.some(v=>v.inflowM3s>0)){ctx.strokeStyle='#0f6f6a';ctx.setLineDash([4,3]);ctx.beginPath();for(let i=0;i<n;i++){const y=h-4-s[i].inflowM3s/maxQ*h*.7;i?ctx.lineTo(x(i),y):ctx.moveTo(x(i),y);}ctx.stroke();ctx.setLineDash([]);}
 if(overByHour)for(let i=0;i<n;i++)if(overByHour[i]){ctx.fillStyle='#d6304f';ctx.beginPath();ctx.arc(x(i),h-6,Math.min(6,2.5+overByHour[i]),0,7);ctx.fill();}
 const px=x(0)+(x(n-1)-x(0))*clock/Math.max(1,n-1);ctx.strokeStyle=css.getPropertyValue('--on')||'#111';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,h);ctx.stroke();
 ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(px-5,0);ctx.lineTo(px+5,0);ctx.lineTo(px,6);ctx.fill();
}
export const timelineKeyHtml='<span><i class="k-rain"></i>Rain (model average)</span><span><i class="k-wet"></i>Wet area</span><span><i class="k-q"></i>River inflow</span><span><i class="k-x"></i>Crossings with water over the road</span>';

// --- methods: the run's technical note ---
export function methodsHtml(run,crossings){
 const s=run?.series??[],peak=s.reduce((b,v)=>v.wetKm2>(b?.wetKm2??-1)?v:b,null),deep=s.reduce((m,v)=>Math.max(m,v.deepM),0);
 const row=(k,v)=>`<tr><th scope="row">${k}</th><td>${v}</td></tr>`;
 return `<article class="sim-paper">
 <p class="sim-eyebrow">Technical note · FLOODplain simulator · Nov 2026</p>
 <h3>A homemade SFINCS and HAND flood simulator for Avra Valley and Picture Rocks</h3>
 <p class="sim-abstract"><b>Abstract.</b> A reduced-complexity 2D flood model of the lower Santa Cruz River corridor runs every hour on free cloud runners from public forecasts, and on saved what-if storms. Each 100 m cell's simulated water surface is compared with lidar road and bridge-deck heights at the crossings drivers use. The map is a model, not observed water, and never overrides closures or live readings.</p>
 <h4>1 · Model</h4>
 <p>SFINCS (Leijnse et al., 2021) solves the local inertial shallow-water equations (Bates et al., 2010) on a regular grid:</p>
 <p class="sim-eq">q<sub>t+Δt</sub> = (q<sub>t</sub> − g h Δt ∂ζ/∂x) / (1 + g Δt n² |q<sub>t</sub>| / h<sup>7/3</sup>)</p>
 <p>with unit-width flux <i>q</i>, water depth <i>h</i>, surface <i>ζ</i> and Manning's <i>n</i>. The grid has 29,685 active 100 m cells in UTM 12N, with subgrid terrain from the USGS 3DEP lidar. The engine is a pinned build, verified by checksum before every run.</p>
 <h4>2 · Forcing</h4>
 <p>Live runs: NOAA HRRR hourly rain, read straight from the forecast files, and National Water Model river flows at the model's two inlets, after a 45-hour warm-up. What-if runs: NOAA Atlas 14 6-hour storms on every cell, and the Santa Cruz at its 1983 record (65,000 ft³/s) or twice it.</p>
 <h4>3 · HAND</h4>
 <p>Height Above Nearest Drainage (Nobre et al., 2011): a terrain-only estimate of where river water could reach for a given flow. It is shown for the Nov 1, 13Z run, beside the simulated water, never mixed into it.</p>
 <h4>4 · Roads and crossings</h4>
 <p>Road surfaces every 5 m from USGS 3DEP 1 m lidar; bridge decks from the 2021 lidar's bridge-deck returns. Water over a road = model water surface − road height${crossings?`, at ${crossings.filter(c=>c.inside).length} crossings inside the model`:''}.</p>
 <table class="sim-table"><caption><b>Table 1.</b> The loaded run</caption><tbody>
 ${run?row('Run',esc(run.def.short??run.def.card?.short??run.def.label))+row('Hours',`${s.length} · ${s[0]?hourText(s[0].time):''} to ${s.at(-1)?hourText(s.at(-1).time):''} MST`)+row('Peak wet area',peak?`${num(peak.wetKm2,1)} km² at ${hourText(peak.time)}`:'–')+row('Deepest cell',`${num(ft(deep),1)} ft (cell average; pits and channels count)`)+row('Peak rain (model average)',`${num(Math.max(...s.map(v=>v.rainMmH))/25.4,2)} in/h`)+row('Peak river inflow',`${Math.round(Math.max(...s.map(v=>v.inflowM3s))*35.3147).toLocaleString()} ft³/s`):row('Run','Loading')}
 </tbody></table>
 <h4>5 · Limits</h4>
 <ul><li>100 m cells average the ground: a narrow dip can flood while its cell reads shallow.</li><li>No culverts or bridge openings are modeled.</li><li>Live runs cold-start from the warm-up; soil and channel state are model guesses.</li><li>What-if storms are deliberately rare. They are not forecasts.</li></ul>
 <h4>References</h4>
 <ol class="sim-refs"><li>Leijnse, T., van Ormondt, M., Nederhoff, K., van Dongeren, A. (2021). Modeling compound flooding in coastal systems using a computationally efficient reduced-physics solver. <i>Coastal Engineering</i> 163.</li><li>Bates, P. D., Horritt, M. S., Fewtrell, T. J. (2010). A simple inertial formulation of the shallow water equations for efficient two-dimensional flood inundation modelling. <i>Journal of Hydrology</i> 387.</li><li>Nobre, A. D., et al. (2011). Height Above the Nearest Drainage – a hydrologically relevant new terrain model. <i>Journal of Hydrology</i> 404.</li><li>NOAA Atlas 14, Volume 1: Semiarid Southwest. NOAA National Weather Service.</li><li>Dowell, D. C., et al. (2022). The High-Resolution Rapid Refresh (HRRR). <i>Weather and Forecasting</i> 37.</li></ol>
 <p class="sim-cite"><b>Budget.</b> Compute: free GitHub Actions runners. Data: public. Hardware: whatever is in your pocket.</p>
 </article>`;
}
