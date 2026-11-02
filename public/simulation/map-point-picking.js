// Screen-space picking only: does not alter marker geometry, coordinates or risk.
export function nearbyMapPoints(items, point, project, {size=48}={}) {
  const half=size/2;
  return items.map((item,index)=>{
    const p=project(item.coordinate),dx=point.x-p.x,dy=point.y-p.y;
    const markerHit=Math.abs(dx)<=half&&Math.abs(dy)<=half;
    // Preserve selection across a visible gauge label as well as its small dot.
    const labelHit=item.labelWidth>0&&Math.abs(dx)<=item.labelWidth/2&&Math.abs(dy+19)<=12;
    return {item,index,distance:dx*dx+dy*dy,hit:Number.isFinite(dx)&&Number.isFinite(dy)&&(markerHit||labelHit)};
  }).filter(p=>p.hit).sort((a,b)=>a.distance-b.distance||a.index-b.index).map(p=>p.item);
}
