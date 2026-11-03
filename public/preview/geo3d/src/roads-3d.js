// Road, interstate and bridge models. Roads follow the ground. Where a crossing has a
// measured height, the road sits that far above the channel bed, so an ordinary depth
// test shows water over the road only where the water really is higher.
const ASPHALT=[.27,.28,.3],CONCRETE=[.72,.71,.68],SHADOW=[.5,.49,.47],WHITE=[.95,.95,.92],YELLOW=[.95,.78,.22],STEEL=[.45,.47,.5],SIGN=[.05,.36,.2];
const STYLE={
 motorway:{width:34,far:[.96,.72,.32],edge:[.55,.38,.14],thick:3,lanes:3},
 trunk:{width:26,far:[.98,.82,.46],edge:[.58,.45,.2],thick:2.4,lanes:2},
 primary:{width:20,far:[.99,.9,.6],edge:[.6,.52,.3],thick:2,lanes:2},
 secondary:{width:15,far:[1,1,1],edge:[.62,.6,.56],thick:1.6,lanes:1},
 tertiary:{width:11,far:[1,1,1],edge:[.66,.64,.6],thick:1.2,lanes:1},
 minor:{width:8,far:[.98,.98,.97],edge:[.7,.68,.64],thick:1,lanes:1},
};
export const roadStyle=cls=>STYLE[cls]??STYLE.minor;
const PIER=[.68,.66,.62],STEP=60,PIER_SPACING=120,ORDER=['motorway','trunk','primary','secondary','tertiary','minor'];
const ANCHOR_REACH=160,POLE_SPACING=240,GANTRY_SPACING=1800,DASH=2;
// "west-avra-valley-road-32-39322-111-29459" -> 32.39322, -111.29459
export function parseRoadHeights(json){
 const out=[];
 for(const [id,p] of Object.entries(json.points??{})){
  const m=id.match(/-(\d+)-(\d+)-(\d+)-(\d+)$/);if(!m)continue;
  out.push({id,lat:Number(`${m[1]}.${m[2]}`),lon:-Number(`${m[3]}.${m[4]}`),aboveBedM:p.roadAboveBedM,deck:!!p.deck,roadM:p.roadM,bedM:p.bedM});
 }
 return out;
}
const smooth=t=>{const c=Math.max(0,Math.min(1,t));return c*c*(3-2*c);};
// Height above the ground the road should sit here, in the map's exaggerated metres. Only
// at-grade measured crossings apply: at those, ground is the cut channel floor.
export function anchorLift(x,y,anchors,exaggeration){
 let lift=0;
 for(const a of anchors){
  if(a.deck)continue;
  const d=Math.hypot(a.x-x,a.y-y);if(d>=ANCHOR_REACH)continue;
  lift=Math.max(lift,a.aboveBedM*exaggeration*(1-smooth(d/ANCHOR_REACH)));
 }
 return lift;
}
function resample(points,STEP){
 const out=[points[0]];
 for(let q=1;q<points.length;q++){
  const a=points[q-1],b=points[q],parts=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/STEP));
  for(let s=1;s<=parts;s++)out.push([a[0]+(b[0]-a[0])*s/parts,a[1]+(b[1]-a[1])*s/parts]);
 }
 return out;
}
const hash=(x,y)=>{let v=Math.imul(Math.round(x),374761393)+Math.imul(Math.round(y),668265263);v=Math.imul(v^(v>>>13),1274126177);return((v^(v>>>16))>>>0)/4294967295;};
// roads: [{points:[[x,y]...],cls,bridge,oneway}] in local metres. heightAt gives ground in the
// map's exaggerated metres, or null where terrain has not loaded. detail adds the close-up
// asphalt, markings, barriers and roadside furniture. widthScale keeps roads readable far out.
export function buildRoadMesh(roads,heightAt,{anchors=[],exaggeration=2,lift=3,step=STEP,detail=false,widthScale=1,plants=[],skipPlant=null,channelAt=null,fordAt=null,focus=null,detailReach=3500}={}){
 const positions=[],colors=[],indices=[];
 const vertex=(x,y,z,c)=>{positions.push(x,y,z);colors.push(c[0],c[1],c[2]);return positions.length/3-1;};
 const quad=(a,b,c,d)=>indices.push(a,b,c,b,d,c);
 // An upright box, with u along the road and v across it.
 const box=(x,y,z0,z1,hu,hv,ca,sa,c,top=c)=>{
  const corners=[[-hu,-hv],[hu,-hv],[hu,hv],[-hu,hv]].map(([u,v])=>[x+ca*u-sa*v,y+sa*u+ca*v]);
  const up=corners.map(([cx,cy])=>vertex(cx,cy,z1,c)),down=corners.map(([cx,cy])=>vertex(cx,cy,z0,c));
  for(let k=0;k<4;k++)quad(up[k],up[(k+1)%4],down[k],down[(k+1)%4]);
  const lid=corners.map(([cx,cy])=>vertex(cx,cy,z1,top));quad(lid[0],lid[1],lid[3],lid[2]);
 };
 // A strip along the road: offsets across it, and heights relative to the road's surface.
 const strip=(rows,o0,o1,z0,z1,c,step=1)=>{
  let previous=null;
  rows.forEach((r,q)=>{
   if(step>1&&Math.floor(q/step)%2){previous=null;return;}
   const row=[vertex(r.x+r.nx*o0,r.y+r.ny*o0,r.z+z0,c),vertex(r.x+r.nx*o1,r.y+r.ny*o1,r.z+z1,c)];
   if(previous)quad(previous[0],previous[1],row[0],row[1]);
   previous=row;
  });
 };
 const taken=new Set();
 const mark=(x,y)=>taken.add(`${Math.round(x/70)},${Math.round(y/70)}`);
 // Roads are cut into pieces. Terrain may have loaded for only part of a road, which must
 // not lose the rest of it. Where a road meets a channel it becomes a bridge, unless that
 // spot is a known ford, and the deck reaches one sample past each bank.
 let spans=0,missing=0;
 const pieces=[];
 for(const road of roads){
  const all=resample(road.points,step);
  const known=all.map(([x,y])=>heightAt(x,y)!=null);
  if(known.includes(false))missing++;
  const wet=all.map(([x,y],q)=>known[q]&&!road.bridge&&!!channelAt?.(x,y)&&!fordAt?.(x,y));
  const span=wet.map((w,q)=>w||!!wet[q-1]||!!wet[q+1]);
  let start=0;
  for(let q=1;q<=all.length;q++){
   if(q<all.length&&known[q]===known[start]&&span[q]===span[start])continue;
   if(known[start]){
    // Plain pieces overlap by one sample so they meet their neighbours, but never into missing terrain.
    const from=span[start]||start===0||!known[start-1]?start:start-1,to=span[start]||q>=all.length||!known[q]?q:q+1;
    const part=all.slice(from,to);
    if(part.length>=2&&(span[start]||!road.spanOnly)){
     pieces.push({...road,points:part,bridge:road.bridge||span[start]});
     if(span[start])spans++;
    }
   }
   start=q;
  }
 }
 // Interstate and major roads first, then nearest first, so a busy view loses distant side
 // streets. Full detail is spent only near the middle of the view.
 const away=road=>{if(!focus)return 0;const m=road.points[road.points.length>>1];return Math.hypot(m[0]-focus[0],m[1]-focus[1]);};
 const rank=road=>ORDER.indexOf(road.cls)*1500+away(road);
 const ranked=pieces.map(road=>({road,order:rank(road)})).sort((a,b)=>a.order-b.order).map(p=>p.road);
 for(const road of ranked){
  const style=roadStyle(road.cls),points=road.points;
  if(points.length<2)continue;
  const ground=points.map(([x,y])=>heightAt(x,y));
  if(ground.some(g=>g==null))continue;
  // A deck runs straight between its abutments, so it spans whatever is below it.
  const a=ground[0],b=ground.at(-1);
  const deck=road.bridge?points.map((_,q)=>a+(b-a)*q/(points.length-1)+6):null;
  const close=detail&&away(road)<detailReach,half=style.width*widthScale/2,top=close?ASPHALT:style.far,thick=style.thick*Math.max(1,widthScale*.5);
  const rows=points.map(([x,y],q)=>{
   const p=points[Math.max(0,q-1)],n=points[Math.min(points.length-1,q+1)],dx=n[0]-p[0],dy=n[1]-p[1],size=Math.hypot(dx,dy)||1;
   const z=road.bridge?Math.max(deck[q],ground[q]+lift):ground[q]+lift+anchorLift(x,y,anchors,exaggeration);
   mark(x,y);
   return{x,y,z,nx:-dy/size,ny:dx/size,ca:dx/size,sa:dy/size,ground:ground[q]};
  });
  strip(rows,-half,half,0,0,top);
  strip(rows,half,half,0,-thick,style.edge);
  strip(rows,-half,-half,0,-thick,style.edge);
  if(close){
   const mark2=.25;
   // Edge lines, then the centre line or lane dashes.
   strip(rows,half-1.6,half-1.1,mark2,mark2,WHITE);
   strip(rows,-half+1.1,-half+1.6,mark2,mark2,road.cls==='motorway'||road.oneway?YELLOW:WHITE);
   if(road.oneway){
    for(let lane=1;lane<style.lanes+1;lane++){const o=-half+2*half*lane/(style.lanes+1);strip(rows,o-.2,o+.2,mark2,mark2,WHITE,DASH);}
   }else{strip(rows,-.55,-.1,mark2,mark2,YELLOW);strip(rows,.1,.55,mark2,mark2,YELLOW);}
  }
  if(road.bridge){
   // Girder beneath the deck, parapets on it, abutments at the ends and capped piers under it.
   strip(rows,-half*.7,half*.7,-thick,-thick*2.4,SHADOW);
   strip(rows,-half*.7,-half*.7,-thick,-thick*2.4,SHADOW);
   strip(rows,half*.7,half*.7,-thick,-thick*2.4,SHADOW);
   for(const side of[-1,1]){strip(rows,side*half,side*half,0,2.4,CONCRETE);strip(rows,side*(half+.6),side*(half+.6),0,2.4,SHADOW);strip(rows,side*half,side*(half+.6),2.4,2.4,CONCRETE);}
   const under=rows.map(r=>r.z-thick*2.4);
   for(const end of[0,rows.length-1]){const r=rows[end];if(under[end]-r.ground>-1)box(r.x,r.y,r.ground-2,r.z-thick,half*.5,half*1.05,r.ca,r.sa,CONCRETE);}
   rows.forEach((r,q)=>{
    if(q%Math.max(1,Math.round(PIER_SPACING/step))||q===0||q===rows.length-1||under[q]-r.ground<=2)return;
    box(r.x,r.y,under[q]-3,under[q],half*.2,half*.85,r.ca,r.sa,PIER);
    for(const o of[-.45,.45])box(r.x+r.nx*half*o,r.y+r.ny*half*o,r.ground-2,under[q]-3,half*.13,half*.13,r.ca,r.sa,PIER);
   });
  }else if(close&&road.cls==='motorway'){
   // Median barrier on the inside edge, then poles and overhead signs along the outside.
   strip(rows,-half-.3,-half-.3,0,2.2,CONCRETE);strip(rows,-half+.3,-half+.3,0,2.2,SHADOW);strip(rows,-half-.3,-half+.3,2.2,2.2,WHITE);
   rows.forEach((r,q)=>{
    const along=q*step;
    if(along%POLE_SPACING<step){const px=r.x+r.nx*(half+3),py=r.y+r.ny*(half+3);box(px,py,r.z-1,r.z+22,.35,.35,r.ca,r.sa,STEEL);box(r.x+r.nx*(half-1),r.y+r.ny*(half-1),r.z+21.5,r.z+22.5,.3,4,r.ca,r.sa,STEEL);}
    if(along%GANTRY_SPACING<step&&hash(r.x,r.y)>.3){
     for(const side of[-1,1])box(r.x+r.nx*side*(half+2),r.y+r.ny*side*(half+2),r.z-1,r.z+20,.5,.5,r.ca,r.sa,STEEL);
     box(r.x,r.y,r.z+19,r.z+20,.4,half+2,r.ca,r.sa,STEEL);
     box(r.x,r.y,r.z+13,r.z+19,.3,half*.6,r.ca,r.sa,SIGN,SIGN);
    }
   });
  }
 }
 // Desert plants, low-poly: saguaro with arms, and rounded creosote and palo verde shrubs.
 let planted=0;
 for(const plant of plants){
  const {x,y}=plant;
  if(taken.has(`${Math.round(x/70)},${Math.round(y/70)}`)||skipPlant?.(x,y))continue;
  const g=heightAt(x,y);if(g==null)continue;
  const seed=hash(x*3,y*7),size=.7+seed*.8;
  if(seed<.3){
   const c=[.25,.42,.24],h=20*size;
   box(x,y,g-1,g+h,1.1*size,1.1*size,1,0,c);
   for(const side of[-1,1]){const ax=x+side*3.2*size;box(x+side*1.6*size,y,g+h*.42,g+h*.5,1.6*size,.7*size,1,0,c);box(ax,y,g+h*.42,g+h*.8,.8*size,.8*size,1,0,c);}
  }else{
   const c=seed<.65?[.46,.5,.26]:[.58,.6,.3],r=4*size;
   box(x,y,g-.5,g+r*.9,r,r*.75,.7,.7,c,[c[0]*1.1,c[1]*1.1,c[2]*1.05]);
   box(x,y,g+r*.6,g+r*1.5,r*.6,r*.5,.9,.4,[c[0]*1.1,c[1]*1.12,c[2]*1.05]);
  }
  planted++;
 }
 return{positions:new Float32Array(positions),colors:new Float32Array(colors),indices:new Uint32Array(indices),planted,spans,missing};
}
// Evenly scattered places for plants, fixed to the ground so they do not move between views.
export function plantSpots(cx,cy,radius,spacing=75){
 const out=[];
 const x0=Math.floor((cx-radius)/spacing),x1=Math.ceil((cx+radius)/spacing),y0=Math.floor((cy-radius)/spacing),y1=Math.ceil((cy+radius)/spacing);
 for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){
  const x=(i+hash(i,j)*.8)*spacing,y=(j+hash(j,i)*.8)*spacing;
  if(Math.hypot(x-cx,y-cy)<=radius)out.push({x,y});
 }
 return out;
}
// Level of detail for a ground chunk, by its distance from the middle of the view.
export const LODS=Object.freeze([{reach:3500,step:60,detail:true,plants:true,classes:null},{reach:10000,step:120,detail:false,plants:false,classes:null},{reach:Infinity,step:300,detail:false,plants:false,classes:['motorway','trunk','primary','secondary']}]);
export const lodFor=distance=>LODS.findIndex(l=>distance<l.reach);
// Is this road under the water here? Both heights are above the same bed, in real metres.
export const roadCovered=(aboveBedM,waterDepthM)=>waterDepthM>aboveBedM;
