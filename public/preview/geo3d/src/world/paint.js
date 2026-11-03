// The street map painted into the ground, Apple Maps style: land use, washes and roads at
// real widths, with lane markings close up. Painted roads are part of the ground surface, so
// they cannot float above it or sink below it. Bridges are left out here and built in 3D.
const LAND={grass:'#e3e8cc',scrub:'#e1e3c6',wood:'#d3dfba',forest:'#d3dfba',sand:'#f0e5cb',farmland:'#e4e8cf',wetland:'#d5e5d8',rock:'#e2dccf'};
const ROAD={motorway:{w:26,fill:'#f6c86a',edge:'#d39a3d'},trunk:{w:20,fill:'#f9d68c',edge:'#d7a85b'},primary:{w:15,fill:'#fff3cf',edge:'#cdbf9a'},secondary:{w:12,fill:'#ffffff',edge:'#c9c3b6'},tertiary:{w:10,fill:'#ffffff',edge:'#ccc6ba'},minor:{w:7,fill:'#ffffff',edge:'#d0cabe'},service:{w:4,fill:'#fbfaf7',edge:'#d6d0c4'},track:{w:3,fill:'#efe6d4',edge:'#d6cbb4'}};
const ORDER=['track','service','minor','tertiary','secondary','primary','trunk','motorway'];
export const roadWidth=cls=>(ROAD[cls]??ROAD.minor).w;
// Blue is kept for the model's water. Map water areas are drawn as beds: dry washes and
// seasonal rivers in sand, and only standing water such as canals and ponds in grey-blue.
export const mapWaterColour=properties=>properties.intermittent===1||properties.class==='river'?'#eadcbd':'#c4d3d6';
export function paintChunk(canvas,x0,z0,size,tiles,detailed){
 const px=canvas.width,scale=px/size,ctx=canvas.getContext('2d');
 ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#efe8d8';ctx.fillRect(0,0,px,px);
 ctx.setTransform(scale,0,0,scale,-x0*scale,-z0*scale);
 const path=parts=>{ctx.beginPath();for(const ring of parts){ring.forEach(([x,z],i)=>i?ctx.lineTo(x,z):ctx.moveTo(x,z));}};
 const fill=(parts,colour)=>{path(parts);ctx.fillStyle=colour;ctx.fill('evenodd');};
 const each=(name,fn)=>{for(const t of tiles)for(const f of t.layers[name]??[])fn(f);};
 each('landcover',f=>{const c=LAND[f.properties.class];if(c&&f.type===3)fill(f.parts,c);});
 each('landuse',f=>{if(f.type!==3)return;const c={residential:'#ece6dc',commercial:'#ebe2dc',industrial:'#e6e1db',school:'#efe4d8',cemetery:'#dfe6cf',quarry:'#e0d8c8'}[f.properties.class];if(c)fill(f.parts,c);});
 each('park',f=>{if(f.type===3)fill(f.parts,'#d6e6c2');});
 each('water',f=>{if(f.type===3)fill(f.parts,mapWaterColour(f.properties));});
 each('waterway',f=>{if(f.type!==2)return;path(f.parts);ctx.lineCap='round';ctx.strokeStyle='#d9c79f';ctx.lineWidth=f.properties.class==='river'?14:5;ctx.stroke();});
 // Building footprints are painted only far out; close up they are 3D.
 if(!detailed)each('building',f=>{if(f.type===3)fill(f.parts,'#ddd4c6');});
 const roads=[];each('transportation',f=>{if(f.type===2&&f.properties.brunnel!=='bridge'&&f.properties.brunnel!=='tunnel'&&ROAD[f.properties.class])roads.push(f);});
 roads.sort((a,b)=>ORDER.indexOf(a.properties.class)-ORDER.indexOf(b.properties.class));
 ctx.lineCap='round';ctx.lineJoin='round';
 // A road's paint width never drops under a pixel, so far roads stay readable lines.
 const minimum=1.2/scale;
 for(const pass of ['edge','fill'])for(const f of roads){const s=ROAD[f.properties.class];path(f.parts);ctx.strokeStyle=s[pass];ctx.lineWidth=Math.max(minimum*(pass==='edge'?1.6:1),pass==='edge'?s.w+2.5:s.w);ctx.setLineDash(f.properties.class==='track'?[6,5]:[]);ctx.stroke();}
 ctx.setLineDash([]);
 if(detailed){
  // Centre lines and lane dashes on the bigger roads.
  for(const f of roads){
   const cls=f.properties.class;if(!['motorway','trunk','primary','secondary'].includes(cls))continue;
   path(f.parts);ctx.lineWidth=.35;
   if(cls==='motorway'||f.properties.oneway===1){ctx.strokeStyle='#ffffff';ctx.setLineDash([3,9]);}else{ctx.strokeStyle='#e0a429';ctx.setLineDash([]);}
   ctx.stroke();
  }
  ctx.setLineDash([]);
 }
}
