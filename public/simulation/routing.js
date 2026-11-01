// Lag + linear reservoir: dS/dt=I-O, S=K*O. Exact solution for constant inflow over each input segment.
// This is a conceptual reach model, not the HEC-RAS model or a hydraulic bridge model.
export function routeGauge(upstream,{lagMinutes,kMinutes,transmission=1},downstreamSite='USGS-09486520') {
  if(!Number.isFinite(lagMinutes)||lagMinutes<0||lagMinutes>1440||!Number.isFinite(kMinutes)||kMinutes<0||kMinutes>1440||!Number.isFinite(transmission)||transmission<0||transmission>1)throw new Error('Invalid routing parameters');
  if(upstream.units!=='m3/s'||upstream.points.length<2)throw new Error('Require upstream m3/s series');
  const input=upstream.points.map(p=>({t:Date.parse(p.time),q:p.valueM3s}));
  if(input.some((p,i)=>!Number.isFinite(p.t)||!Number.isFinite(p.q)||p.q<0||(i&&p.t<=input[i-1].t)))throw new Error('Unsorted/invalid upstream points');
  if(input.slice(1).some((p,i)=>p.t-input[i].t>30*60000))throw new Error('Upstream gap exceeds 30 minutes; do not bridge gaps');
  // Warm-start assumes steady first upstream flow, never reads downstream initial state.
  const first=input[0].t,last=input.at(-1).t,step=15*60000,lag=lagMinutes*60000;
  let q=input[0].q,index=0,at=first;
  const points=[];
  for(let t=Math.ceil(first/step)*step;t<=last;t+=step){
    const target=t-lag;
    if(target>=first){
      while(at<target){
        while(index+1<input.length&&input[index+1].t<=at)index++;
        const end=Math.min(target,input[index+1]?.t??target),dt=(end-at)/60000;
        q=kMinutes===0?input[index].q:input[index].q+(q-input[index].q)*Math.exp(-dt/kMinutes);at=end;
      }
      if(kMinutes===0){while(index+1<input.length&&input[index+1].t<=target)index++;q=input[index].q;}
    }
    points.push({time:new Date(t).toISOString(),valueM3s:q*transmission});
  }
  return {siteId:downstreamSite,units:'m3/s',points,parameters:{lagMinutes,kMinutes,transmission}};
}
