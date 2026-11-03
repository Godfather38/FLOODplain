// The run's rainfall input (hourly mm/h) and lookups into it. A grid is either latitude/longitude
// (the 13Z map context) or UTM 12N metres (a run's own precip_2d.nc, exported as rainfall.json).
import {toUtm,fromUtm} from '../utm.js';
export function parseRain(context){
 const r=context?.rainfall??context;if(!r?.frames?.length)return null;
 const utm=r.crs==='EPSG:32612';
 return{utm,rows:utm?r.y:r.lat,cols:utm?r.x:r.lon,frames:r.frames.map(f=>({start:Date.parse(f.start),end:Date.parse(f.end),grid:f.precipMmH}))};
}
// mm/h at a place and moment; zero outside the grid or outside the hours it covers.
export function rainAt(rain,time,lon,lat){
 if(!rain.utm)return sample(rain,time,lat,lon);
 const u=toUtm(lon,lat);return sample(rain,time,u.n,u.e);
}
// The same from UTM 12N metres, without a round trip through latitude/longitude on a UTM grid.
export function rainAtUtm(rain,time,e,n){
 if(rain.utm)return sample(rain,time,n,e);
 const ll=fromUtm(e,n);return sample(rain,time,ll.lat,ll.lon);
}
function sample(rain,time,row,col){
 const f=rain.frames.find(f=>time>=f.start&&time<f.end);if(!f)return 0;
 const {rows,cols}=rain,fi=(rows[0]-row)/(rows[0]-rows.at(-1))*(rows.length-1),fj=(col-cols[0])/(cols.at(-1)-cols[0])*(cols.length-1);
 if(fi<0||fj<0||fi>rows.length-1||fj>cols.length-1)return 0;
 const i=Math.min(rows.length-2,Math.floor(fi)),j=Math.min(cols.length-2,Math.floor(fj)),a=fi-i,b=fj-j,g=f.grid;
 return(g[i][j]*(1-b)+g[i][j+1]*b)*(1-a)+(g[i+1][j]*(1-b)+g[i+1][j+1]*b)*a;
}
