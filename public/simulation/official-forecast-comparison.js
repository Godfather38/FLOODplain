const hour=3600000;
export function scoreOfficialForecasts(data){
 const result=[];
 for(const event of data.events) for(const station of Object.keys(data.protocol.stations)){
  const observations=event.observations[station].filter(p=>p.approval==='Approved'&&p.qualifier===null).map(p=>({...p,t:Date.parse(p.time)})).sort((a,b)=>a.t-b.t);
  const obs=new Map(observations.map(p=>[p.t,p.valueM3s]));
  const issues=[...new Set(event.forecasts.filter(p=>p.station===station&&Date.parse(p.issued)>=Date.parse(event.start)&&Date.parse(p.issued)<Date.parse(event.end)).map(p=>p.issued))].sort();
  for(const issued of issues){
   const it=Date.parse(issued),prior=observations.filter(p=>p.t<=it&&it-p.t<=hour).at(-1);
   const curve=event.forecasts.filter(p=>p.station===station&&p.issued===issued).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
   for(const [lo,hi] of data.protocol.leadBinsHours){
    const eligible=curve.filter(p=>{const t=Date.parse(p.time),lead=(t-it)/hour;return lead>0&&lead>=lo&&lead<hi&&t>=Date.parse(event.start)&&t<Date.parse(event.end)});
    const pairs=eligible.filter(p=>obs.has(Date.parse(p.time))).map(p=>({time:p.time,forecast:p.valueM3s,observed:obs.get(Date.parse(p.time)),persistence:prior?.valueM3s??null}));
    // Archive forecasts are hourly, aligned to UTC clock hours (issue may be off-hour).
    let expected=0;for(let t=Math.ceil(it/hour)*hour;t<Math.min(it+hi*hour,Date.parse(event.end));t+=hour)if(t>it&&t>=it+lo*hour&&t>=Date.parse(event.start))expected++;
    const stats=values=>values.length?{mae:values.reduce((s,v)=>s+Math.abs(v),0)/values.length,rmse:Math.sqrt(values.reduce((s,v)=>s+v*v,0)/values.length),bias:values.reduce((s,v)=>s+v,0)/values.length}:null;
    const fp=pairs.reduce((a,p)=>!a||p.forecast>a.forecast?p:a,null),op=pairs.reduce((a,p)=>!a||p.observed>a.observed?p:a,null);
    result.push({event:event.id,station,issued,leadHours:[lo,hi],expectedHourlySlots:expected,forecastSlots:eligible.length,pairedSlots:pairs.length,coverage:expected?pairs.length/expected:null,status:expected===0?'outside_event':pairs.length===expected?'complete':'incomplete',fullLeadWindowAvailable:it+hi*hour<=Date.parse(event.end),forecast:stats(pairs.map(p=>p.forecast-p.observed)),persistence:prior?stats(pairs.map(p=>p.persistence-p.observed)):null,pairedPeak:fp?{forecastM3s:fp.forecast,observedM3s:op.observed,errorPercent:op.observed?100*(fp.forecast/op.observed-1):null,timingErrorMinutes:(Date.parse(fp.time)-Date.parse(op.time))/60000}:null,pairs});
   }
  }
  if(!issues.length)result.push({event:event.id,station,status:'no_issuances',pairs:[]});
 }
 return {schemaVersion:1,units:'m3/s',protocol:data.protocol,provenance:data.provenance,warning:'Retrospective archived issued forecasts; matched-sample scores, not instantaneous crest accuracy. Overlapping issuances are dependent. No calibrated ± accuracy implied.',results:result};
}
