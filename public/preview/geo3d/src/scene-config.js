// A real place laid onto the Tiny Toon demo's 72 x 120 unit grid. The demo's
// shader hard-codes those coordinates, so keeping them lets it run unedited.
// Axes: +x north, +y up, +z east. Horizontal scale is uniform; only height is exaggerated.
export const SCENE=Object.freeze({
 name:'Gates Pass, Tucson Mountains',
 center:Object.freeze({lat:32.2245,lon:-111.1}),
 metresPerUnit:50,
 verticalExaggeration:2,
 baseHeight:1, // The solver treats a bed below 0 as sea, so all land stays above it.
 demZoom:13,
 // The part of the grid where the shader shows only solver water, not the demo's ocean.
 visible:Object.freeze({x0:-12,x1:50,z0:-85,z1:20}),
 renderSpacing:.5,
});
const {visible:V}=SCENE;
const midX=(V.x0+V.x1)/2,midZ=(V.z0+V.z1)/2;
const metresPerLat=110540,metresPerLon=111320*Math.cos(SCENE.center.lat*Math.PI/180);
export const project=(lon,lat)=>({x:midX+(lat-SCENE.center.lat)*metresPerLat/SCENE.metresPerUnit,z:midZ+(lon-SCENE.center.lon)*metresPerLon/SCENE.metresPerUnit});
export const unproject=(x,z)=>({lat:SCENE.center.lat+(x-midX)*SCENE.metresPerUnit/metresPerLat,lon:SCENE.center.lon+(z-midZ)*SCENE.metresPerUnit/metresPerLon});
export const inVisible=(x,z)=>x>=V.x0&&x<=V.x1&&z>=V.z0&&z<=V.z1;
export function fineGrid(){
 const s=SCENE.renderSpacing,nx=Math.round((V.x1-V.x0)/s)+1,nz=Math.round((V.z1-V.z0)/s)+1;
 return Object.freeze({nx,nz,x0:V.x0,z0:V.z0,dx:s,dz:s});
}
