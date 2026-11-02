// The one place scene data is chosen. Everywhere except a local development
// address the answer is live data, and a failed request is an error: there is
// no snapshot fallback. Snapshots live outside public/ and never reach Pages.
import {elevationGrid,tilesForScene,tileUrl} from './elevation.js';
const LOCAL_HOSTS=new Set(['localhost','127.0.0.1','[::1]']);
export function resolveDataMode(href){
 const url=new URL(href),name=url.searchParams.get('devSnapshot');
 return name&&LOCAL_HOSTS.has(url.hostname)&&/^[a-z0-9-]+$/.test(name)?{mode:'dev-snapshot',name}:{mode:'live'};
}
async function fetchOk(url,options){
 const response=await fetch(url,options);
 if(!response.ok)throw new Error(`${url} answered ${response.status}`);
 return response;
}
export async function loadTile({z,x,y}){
 const blob=await (await fetchOk(tileUrl(z,x,y))).blob();
 // Heights are stored in the colour channels, so any colour handling corrupts them.
 const bitmap=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
 const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d',{willReadFrequently:true});
 context.drawImage(bitmap,0,0);bitmap.close();
 return{x,y,rgba:context.getImageData(0,0,canvas.width,canvas.height).data};
}
async function loadLive(){
 const [tiles,routes]=await Promise.all([
  Promise.all(tilesForScene().map(loadTile)),
  fetchOk(new URL('../../../data/routes.geojson',import.meta.url),{cache:'no-store'}).then(r=>r.json()),
 ]);
 return{metres:elevationGrid(tiles),routes,source:{mode:'live',label:'Terrain and roads: live data requested on this load. Water: simulated.'}};
}
async function loadSnapshot(name){
 const snapshot=await (await fetchOk(`/__dev/geo3d-snapshots/${name}.json`)).json();
 const bytes=Uint8Array.from(atob(snapshot.metres),c=>c.charCodeAt(0));
 return{metres:new Float32Array(bytes.buffer),routes:snapshot.routes,source:{mode:'dev-snapshot',label:`DEVELOPMENT SNAPSHOT from ${snapshot.capturedAt}: not live data`}};
}
// Heights for wherever the scene grid currently sits. Always live.
export const loadLiveHeights=async()=>elevationGrid(await Promise.all(tilesForScene().map(loadTile)));
export const loadSceneData=(mode=resolveDataMode(location.href))=>mode.mode==='dev-snapshot'?loadSnapshot(mode.name):loadLive();
