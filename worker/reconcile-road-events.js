// Offline policy experiment. Not imported by the Worker or public app.
// Links must come from independently verified source crosswalks, never proximity.
import {roadEventTiming} from '../public/logic.js';
const key=e=>JSON.stringify([e.source,e.id]);
const direction=e=>['northbound','southbound','eastbound','westbound','both directions','all directions'].includes(e.direction?.toLowerCase())?e.direction.toLowerCase():null;
const roadway=e=>typeof e.roadway==='string' ? e.roadway.trim().toLowerCase().replace(/\s+/g,' ') : '';
const scopes=new Set(['ramp','mainline','frontage','local']);
function shape(e) {
  if(e.geometryUnknown || !['POINT','LINESTRING'].includes(e.type) || !Array.isArray(e.parts) || e.parts.length!==1) return null;
  const part=e.parts[0];
  if(!Array.isArray(part) || !part.length || part.length>4096 || (e.type==='POINT' && part.length!==1)) return null;
  if(part.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)) return null;
  // Exact coordinate equality only. Reverse vertex order is equivalent geometry,
  // but travel direction is checked separately. No nearby-line tolerance.
  return e.type+':'+[JSON.stringify(part),JSON.stringify([...part].reverse())].sort()[0];
}
export function reconciliationCompatibility(a,b,now) {
  const reasons=[];
  if(!scopes.has(a.scope)||!scopes.has(b.scope)) reasons.push('scope-unknown');
  else if(a.scope!==b.scope) reasons.push('scope-conflict');
  if(!direction(a)||!direction(b)) reasons.push('direction-unknown');
  else if(direction(a)!==direction(b)) reasons.push('direction-conflict');
  if(!roadway(a)||!roadway(b)) reasons.push('roadway-unknown');
  else if(roadway(a)!==roadway(b)) reasons.push('roadway-conflict');
  if(!shape(a)||!shape(b)) reasons.push('geometry-unknown');
  else if(shape(a)!==shape(b)) reasons.push('geometry-conflict');
  if(typeof a.closed!=='boolean'||typeof b.closed!=='boolean'||a.closed!==b.closed) reasons.push('closure-conflict');
  const timingA=roadEventTiming(a,now),timingB=roadEventTiming(b,now);
  if(timingA==='unknown'||timingB==='unknown') reasons.push('timing-unknown');
  else if(timingA!==timingB || ['start','stop','dailyStart','dailyEnd'].some(k=>(a[k]??null)!==(b[k]??null))) reasons.push('timing-conflict');
  // Even with known outer bounds, no unresolved recurrence may be deduplicated.
  if([a,b].some(e=>e.recurrence || e.recurrenceSchedules)) reasons.push('recurrence-unresolved');
  return {compatible:reasons.length===0,reasons};
}

export function reconcileRoadEvents(events,{verifiedLinks=[],now}={}) {
  if(!Array.isArray(events)||events.length>5000||!Array.isArray(verifiedLinks)||verifiedLinks.length>5000||!Number.isFinite(now)) throw Error('Invalid reconciliation input');
  const byKey=new Map(),groups=events.map((e,i)=>({members:[i]})),owner=events.map((_,i)=>i),decisions=[];
  events.forEach((e,i)=>{
    if(!e || typeof e.source!=='string'||!e.source || typeof e.id!=='string'||!e.id) throw Error('Missing event identity');
    const k=key(e);byKey.set(k,[...(byKey.get(k)||[]),i]);
  });
  for(const link of verifiedLinks) {
    const left=byKey.get(key(link?.left||{}))||[],right=byKey.get(key(link?.right||{}))||[];
    const reasons=[];
    // This is operator-supplied provenance, not an upstream event boolean.
    if(typeof link?.evidence!=='string'||!/^https:\/\//.test(link.evidence)||link.evidence.length>2048) reasons.push('missing-verification-evidence');
    if(left.length!==1||right.length!==1) reasons.push('identity-missing-or-ambiguous');
    if(link?.left?.source===link?.right?.source) reasons.push('cross-source-link-required');
    if(!reasons.length) reasons.push(...reconciliationCompatibility(events[left[0]],events[right[0]],now).reasons);
    if(!reasons.length) {
      const target=owner[left[0]],from=owner[right[0]];
      if(target!==from) {
        if(groups[target].members.length+groups[from].members.length>16) reasons.push('equivalence-group-limit');
        // Compare every member before joining groups; never hide a transitive conflict.
        if(!reasons.length) for(const a of groups[target].members) for(const b of groups[from].members)
          reasons.push(...reconciliationCompatibility(events[a],events[b],now).reasons);
        if(!reasons.length) {
          for(const index of groups[from].members){owner[index]=target;groups[target].members.push(index);}
          groups[from].members=[];
        }
      }
    }
    decisions.push({left:link?.left,right:link?.right,evidence:link?.evidence,
      status:reasons.length?'retained-conflict':'equivalent',reasons:[...new Set(reasons)]});
  }
  const retained=groups.filter(g=>g.members.length).map(g=>{
    const originals=g.members.map(i=>events[i]);
    return {event:originals[0],sources:[...new Set(originals.map(e=>e.source))],originals,
      status:originals.length>1?'equivalent':'retained'};
  });
  // Original records and conflicts remain visible; consumers must not erase these.
  return {groups:retained,decisions,events:retained.map(g=>g.event)};
}
