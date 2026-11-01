import * as THREE from 'three';
// Ordinary visible-viewport tiles only; no offline scraping or background prefetch.
export function createMapTexture({project,origin,onTexture,onError=()=>{}}){
  let generation=0,dead=false,lastKey='';
  const tileX=(lon,z)=>(lon+180)/360*2**z;
  const tileY=(lat,z)=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z;
  const lon=(x,z)=>x/2**z*360-180;
  const lat=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
  async function update(extent,zoom){
    let z=Math.min(16,Math.max(8,Math.floor(zoom))),a,b,c,d;
    do{a=Math.floor(tileX(extent.xmin,z));b=Math.floor(tileX(extent.xmax,z));c=Math.floor(tileY(extent.ymax,z));d=Math.floor(tileY(extent.ymin,z));if((b-a+1)*(d-c+1)<=36)break;z--;}while(z>0);
    const key=[z,a,b,c,d].join('/');if(dead||key===lastKey)return;lastKey=key;const token=++generation;
    const canvas=document.createElement('canvas');canvas.width=(b-a+1)*256;canvas.height=(d-c+1)*256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#e0e3db';ctx.fillRect(0,0,canvas.width,canvas.height);
    const jobs=[];for(let y=c;y<=d;y++)for(let x=a;x<=b;x++)jobs.push({x,y});
    // Two concurrent requests; normal browser cache and OSM attribution retained by host.
    let cursor=0,failures=0;
    async function worker(){while(cursor<jobs.length){if(dead||token!==generation)return;const {x,y}=jobs[cursor++];
      await new Promise(resolve=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{ctx.drawImage(img,(x-a)*256,(y-c)*256);resolve();};img.onerror=()=>{failures++;resolve();};img.src=`https://tile.openstreetmap.org/${z}/${x}/${y}.png`;});}}
    await Promise.all([worker(),worker()]);if(dead||token!==generation)return;
    const sw=project([lon(a,z),lat(d+1,z)]).sub(origin),ne=project([lon(b+1,z),lat(c,z)]).sub(origin);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    onTexture(texture,new THREE.Vector4(sw.x,sw.y,ne.x-sw.x,ne.y-sw.y));if(failures)onError(`${failures} map imagery tiles unavailable`);
  }
  return {update,dispose(){dead=true;generation++;}};
}
