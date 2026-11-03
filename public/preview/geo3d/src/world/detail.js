// How much detail a 1 km chunk gets at a given distance, kept apart from Three.js so it can be
// tested on its own.
export const CHUNK=1000;
export const LODS=Object.freeze([
 {n:100,reach:2200,px:1024,zoom:14,structures:true},
 {n:50,reach:5500,px:512,zoom:14,structures:true},
 {n:25,reach:13000,px:256,zoom:13,structures:false},
 {n:10,reach:Infinity,px:128,zoom:12,structures:false},
]);
export const lodFor=(distance,current=null,lods=LODS)=>{
 // Coming closer switches at the reach; moving away only switches 15% past it, so a camera
 // resting near a boundary does not flip back and forth.
 for(let i=0;i<lods.length;i++){const reach=lods[i].reach*(current!==null&&current<=i?1.15:1);if(distance<reach)return i;}
 return lods.length-1;
};
