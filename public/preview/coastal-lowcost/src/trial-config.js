// One physical coastline, independent solver and visual mesh resolutions.
// Query-string selection is shared by the page and the module worker.
const makeGrid=(nx,nz)=>Object.freeze({nx,nz,x0:-14,z0:-92,dx:72/(nx-1),dz:120/(nz-1)});
export const GRID_PRESETS=Object.freeze({original:makeGrid(241,401),small:makeGrid(48,80),tiny:makeGrid(24,40)});
export const PRESETS=Object.freeze({
 baseline:{label:'A · Original physics / original effects',physics:'original',effects:'original'},
 'original-cheap':{label:'B · Original physics / cheap effects',physics:'original',effects:'cheap'},
 'tiny-original':{label:'C · Tiny physics / original effects',physics:'tiny',effects:'original'},
 'tiny-cheap':{label:'D · Tiny physics / cheap effects',physics:'tiny',effects:'cheap'},
 'small-cheap':{label:'E · Small physics / cheap effects',physics:'small',effects:'cheap'},
 'tiny-toon':{label:'F · Tiny physics / opaque cartoon water',physics:'tiny',effects:'toon'},
});
export function resolveTrial(search=''){
 const requested=new URLSearchParams(search).get('preset');
 const id=Object.hasOwn(PRESETS,requested)?requested:'tiny-cheap';
 const preset=PRESETS[id];
 return Object.freeze({id,...preset,grid:GRID_PRESETS[preset.physics],renderSpacing:.3,publishHz:20,dt:1/60,interpolationDelay:.06,dprCap:.75,bufferLong:1280,bufferShort:720,useBakedState:false,useWasm:false});
}
export const TRIAL=resolveTrial(globalThis.location?.search??'');
