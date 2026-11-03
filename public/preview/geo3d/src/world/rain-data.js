// The run's rainfall input (hourly mm/h on a latitude/longitude grid) and lookups into it.
export function parseRain(context){
 const r=context?.rainfall;if(!r?.frames?.length)return null;
 return{lat:r.lat,lon:r.lon,frames:r.frames.map(f=>({start:Date.parse(f.start),end:Date.parse(f.end),grid:f.precipMmH}))};
}
// mm/h at a place and moment; zero outside the grid or outside the hours it covers.
export function rainAt(rain,time,lon,lat){
 const f=rain.frames.find(f=>time>=f.start&&time<f.end);if(!f)return 0;
 const fi=(rain.lat[0]-lat)/(rain.lat[0]-rain.lat.at(-1))*(rain.lat.length-1),fj=(lon-rain.lon[0])/(rain.lon.at(-1)-rain.lon[0])*(rain.lon.length-1);
 if(fi<0||fj<0||fi>rain.lat.length-1||fj>rain.lon.length-1)return 0;
 const i=Math.min(rain.lat.length-2,Math.floor(fi)),j=Math.min(rain.lon.length-2,Math.floor(fj)),a=fi-i,b=fj-j,g=f.grid;
 return(g[i][j]*(1-b)+g[i][j+1]*b)*(1-a)+(g[i+1][j]*(1-b)+g[i+1][j+1]*b)*a;
}
