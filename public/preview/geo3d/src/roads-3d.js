// Road, interstate and bridge models. Roads follow the ground. Where a crossing has a
// measured height, the road sits that far above the channel bed, so an ordinary depth
// test shows water over the road only where the water really is higher.
const STYLE={
 motorway:{width:34,top:[.96,.72,.32],edge:[.55,.38,.14],thick:3},
 trunk:{width:26,top:[.98,.82,.46],edge:[.58,.45,.2],thick:2.4},
 primary:{width:20,top:[.99,.9,.6],edge:[.6,.52,.3],thick:2},
 secondary:{width:15,top:[1,1,1],edge:[.62,.6,.56],thick:1.6},
 tertiary:{width:11,top:[1,1,1],edge:[.66,.64,.6],thick:1.2},
 minor:{width:8,top:[.98,.98,.97],edge:[.7,.68,.64],thick:1},
};
export const roadStyle=cls=>STYLE[cls]??STYLE.minor;
const PIER=[.72,.7,.66],STEP=60,PIER_SPACING=120,ORDER=['motorway','trunk','primary','secondary','tertiary','minor'];
const ANCHOR_REACH=160;
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
function resample(points){
 const out=[points[0]];
 for(let q=1;q<points.length;q++){
  const a=points[q-1],b=points[q],parts=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/STEP));
  for(let s=1;s<=parts;s++)out.push([a[0]+(b[0]-a[0])*s/parts,a[1]+(b[1]-a[1])*s/parts]);
 }
 return out;
}
// roads: [{points:[[x,y]...],cls,bridge}] in local metres. heightAt gives ground in the
// map's exaggerated metres, or null where terrain has not loaded.
export function buildRoadMesh(roads,heightAt,{anchors=[],exaggeration=2,lift=3,maxVertices=200000}={}){
 const positions=[],colors=[],indices=[];
 const vertex=(x,y,z,c)=>{positions.push(x,y,z);colors.push(c[0],c[1],c[2]);return positions.length/3-1;};
 const quad=(a,b,c,d)=>indices.push(a,b,c,b,d,c);
 // Largest roads first, so a busy view loses side streets rather than the interstate.
 const ranked=[...roads].sort((a,b)=>(b.bridge-a.bridge)||(ORDER.indexOf(a.cls)-ORDER.indexOf(b.cls)));
 let dropped=0;
 for(const road of ranked){
  if(positions.length/3>maxVertices){dropped++;continue;}
  const style=roadStyle(road.cls),points=resample(road.points);
  if(points.length<2)continue;
  const ground=points.map(([x,y])=>heightAt(x,y));
  if(ground.some(g=>g==null))continue;
  // A deck runs straight between its abutments, so it spans whatever is below it.
  const a=ground[0],b=ground.at(-1);
  const deck=road.bridge?points.map((_,q)=>a+(b-a)*q/(points.length-1)+6):null;
  let previous=null;
  points.forEach(([x,y],q)=>{
   const p=points[Math.max(0,q-1)],n=points[Math.min(points.length-1,q+1)],dx=n[0]-p[0],dy=n[1]-p[1],size=Math.hypot(dx,dy)||1,nx=-dy/size*style.width/2,ny=dx/size*style.width/2;
   const z=road.bridge?Math.max(deck[q],ground[q]+lift):ground[q]+lift+anchorLift(x,y,anchors,exaggeration),under=z-style.thick;
   const row=[vertex(x+nx,y+ny,z,style.top),vertex(x-nx,y-ny,z,style.top),vertex(x+nx,y+ny,z,style.edge),vertex(x-nx,y-ny,z,style.edge),vertex(x+nx,y+ny,under,style.edge),vertex(x-nx,y-ny,under,style.edge)];
   if(previous){quad(previous[0],previous[1],row[0],row[1]);quad(previous[2],row[2],previous[4],row[4]);quad(previous[3],previous[5],row[3],row[5]);}
   previous=row;
   if(road.bridge&&q%Math.round(PIER_SPACING/STEP)===0&&under-ground[q]>2){
    const w=style.width*.28,t=w*.6,ca=dx/size,sa=dy/size;
    const corners=[[-w,-t],[w,-t],[w,t],[-w,t]].map(([u,v])=>[x-sa*u+ca*v,y+ca*u+sa*v]);
    const top=corners.map(([cx,cy])=>vertex(cx,cy,under,PIER)),bottom=corners.map(([cx,cy])=>vertex(cx,cy,ground[q]-2,PIER));
    for(let c=0;c<4;c++)quad(top[c],top[(c+1)%4],bottom[c],bottom[(c+1)%4]);
   }
  });
 }
 return{positions:new Float32Array(positions),colors:new Float32Array(colors),indices:new Uint32Array(indices),dropped};
}
// Is this road under the water here? Both heights are above the same bed, in real metres.
export const roadCovered=(aboveBedM,waterDepthM)=>waterDepthM>aboveBedM;
