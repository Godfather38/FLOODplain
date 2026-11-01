const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
try{
 const responses=await Promise.all(['official-forecast-events','official-forecast-scores'].map(n=>fetch(`data/${n}.json`)));if(responses.some(r=>!r.ok))throw Error('Recorded data unavailable');
 const [data,scores]=await Promise.all(responses.map(r=>r.json()));
 for(const e of data.events){const o=document.createElement('option');o.value=e.id;o.textContent=e.id;$('event').append(o)}
 $('warning').textContent=scores.warning;
 const num=v=>v==null?'—':v.toFixed(2);
 function chart(row){
  const e=data.events.find(e=>e.id===row.event),f=e.forecasts.filter(p=>p.station===row.station&&p.issued===row.issued),o=e.observations[row.station].filter(p=>p.approval==='Approved');
  const start=Date.parse(e.start),end=Date.parse(e.end),max=Math.max(1,...f.map(p=>p.valueM3s),...o.map(p=>p.valueM3s));$('chart').replaceChildren();
  for(const [pts,color] of [[o,'#ec9d36'],[f,'#40a5ff']]){const line=document.createElementNS(ns,'polyline');line.setAttribute('points',pts.filter(p=>Date.parse(p.time)>=start&&Date.parse(p.time)<end).map(p=>`${40+630*(Date.parse(p.time)-start)/(end-start)},${235-210*p.valueM3s/max}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke',color);line.setAttribute('stroke-width','2');$('chart').append(line)}
  const label=document.createElementNS(ns,'text');label.setAttribute('x','40');label.setAttribute('y','20');label.setAttribute('fill','currentColor');label.textContent=`0–${max.toFixed(1)} m³/s · blue forecast / orange observed`; $('chart').append(label);
  $('detail').textContent=`${row.station}, issued ${row.issued}. UTC event window ${e.start} to ${e.end}. Forecast curve is not shifted or fitted. Observation lines connect samples visually; scoring never interpolates gaps.`;
 }
 function render(){const rows=scores.results.filter(r=>r.event===$('event').value&&r.station===$('station').value&&r.leadHours?.[0]===Number($('lead').value));$('rows').replaceChildren();
  for(const r of rows){const tr=document.createElement('tr'),button=document.createElement('button');button.textContent=r.issued;button.onclick=()=>chart(r);const td=document.createElement('td');td.append(button);tr.append(td);
   for(const value of [`${r.pairedSlots}/${r.expectedHourlySlots} ${r.status}${r.fullLeadWindowAvailable?'':' (event edge)'}`,num(r.forecast?.rmse),num(r.persistence?.rmse),r.pairedPeak?.errorPercent==null?'—':num(r.pairedPeak.errorPercent)+'%',r.pairedPeak?`${r.pairedPeak.timingErrorMinutes} min`:'—']){const cell=document.createElement('td');cell.textContent=value;tr.append(cell)}$('rows').append(tr)}
  $('status').textContent=rows.length?`${rows.length} issuances; ${rows.filter(r=>r.status==='complete'&&r.fullLeadWindowAvailable).length} complete full lead windows. Negative peak timing means early.`:'No archived issuance in this window; this is not a zero-flow forecast.';if(rows.length)chart(rows[0]);else $('chart').replaceChildren();
 }
 for(const id of ['event','station','lead'])$(id).addEventListener('change',render);render();
}catch(e){$('status').textContent=`Cannot load comparison: ${e.message}`}
