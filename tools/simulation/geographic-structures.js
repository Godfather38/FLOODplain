import * as THREE from 'three';

// Geometry foundation only: callers supply already decoded, viewport-bounded
// geographic features. No fetch, camera, animation, terrain, or water ownership.
// project([lon,lat]) -> local Vector3. groundElevationAt([lon,lat]) -> local Z
// (not metres); when absent/null, project().z is retained. metresToUnits converts
// relative metre distances to local units at the supplied geographic coordinate.
// Heights are cartographic source tags, never surveyed building/bridge clearance.
export const ROAD_WIDTH_METRES = Object.freeze({motorway:14,trunk:12,primary:10,secondary:9,tertiary:8,minor:6,residential:6,unclassified:6,service:4,track:3,path:1.5});
const DEFAULT_BUDGET = {triangles:30000,buildings:600,roadSegments:5000,featureCoordinates:4096,features:4000};
const finite = n => Number.isFinite(n);
function metres(value) {
  if (typeof value === 'number') return finite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^([\d.]+)\s*(m|metres?|meters?|ft|feet|')?$/i);
  if (!m) return null;
  const n = Number(m[1]) * (/^(ft|feet|')$/i.test(m[2] || '') ? .3048 : 1);
  return finite(n) ? n : null;
}
const sourceId = f => f.properties?._featureId ?? f.id ?? null;
const layer = f => f.properties?._sourceLayer ?? f.properties?.sourceLayer;

export function createGeographicStructures({features=[],project,metresToUnits,groundElevationAt,zoom=15,budget={}}={}) {
  if(typeof project !== 'function' || typeof metresToUnits !== 'function') throw new TypeError('project and metresToUnits callbacks required');
  const limits = {...DEFAULT_BUDGET,...budget};
  for(const [key,value] of Object.entries(limits)) if(!Number.isInteger(value)||value<0) throw new TypeError('Invalid geometry budget: '+key);
  const group = new THREE.Group(); group.name='geographic-structures';
  const stats={triangles:0,buildings:0,roadSegments:0,markingTriangles:0,omittedFeatures:0,missingHeight:0,invalidFeatures:0,unresolvedGroundVertices:0,bridgeFeatures:0,tunnelFeatures:0,sourceFeatures:features.length};
  const batches={buildings:[],roads:[],markings:[]},ranges={buildings:[],roads:[],markings:[]};
  const unit=(m,c)=>{const v=metresToUnits(m,c);if(!finite(v)||v<0)throw Error('Invalid distance conversion');return v;};
  const point=c=>{
    if(!Array.isArray(c)||!finite(c[0])||!finite(c[1]))throw Error('Invalid geographic coordinate');
    const p=project(c).clone();if(![p.x,p.y,p.z].every(finite))throw Error('Invalid projected coordinate');
    const z=groundElevationAt?.(c);if(finite(z))p.z=z;else stats.unresolvedGroundVertices++;
    return p;
  };
  const push=(out,a,b,c)=>out.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);
  const quad=(out,a,b,c,d)=>{push(out,a,b,c);push(out,a,c,d);};
  const install=(kind,data,f,metadata={})=>{
    const triangles=data.length/9;if(stats.triangles+triangles>limits.triangles){stats.omittedFeatures++;return false;}
    const start=batches[kind].length/9;for(const n of data)batches[kind].push(n);
    ranges[kind].push({startTriangle:start,triangleCount:triangles,sourceId:sourceId(f),...metadata});stats.triangles+=triangles;return true;
  };
  const ordered=features.slice(0,limits.features).sort((a,b)=>{
    const rank=f=>layer(f)==='transportation'?(f.properties?.class==='motorway'?0:1):2;
    return rank(a)-rank(b);
  });stats.omittedFeatures+=Math.max(0,features.length-ordered.length);
  for(const f of ordered){
    const p=f.properties||{},g=f.geometry;if(!g)continue;
    try {
      if(layer(f)==='building' && ['Polygon','MultiPolygon'].includes(g.type)){
        const height=metres(p.render_height)??metres(p.height);
        if(!(height>0)){stats.missingHeight++;continue;}
        if(stats.buildings>=limits.buildings){stats.omittedFeatures++;continue;}
        const minHeight=metres(p.render_min_height)??metres(p.min_height)??0;
        if(minHeight<0||minHeight>=height){stats.invalidFeatures++;continue;}
        const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
        const coordinateCount=polygons.reduce((n,poly)=>n+poly.reduce((m,r)=>m+r.length,0),0);
        // Conservative bound before expensive triangulation or allocation.
        if(coordinateCount>limits.featureCoordinates||stats.triangles+coordinateCount*4>limits.triangles){stats.omittedFeatures++;continue;}
        const data=[];
        for(const poly of polygons){
          const rings=poly.map(r=>{const s=r.slice();if(s.length>1&&s[0][0]===s.at(-1)[0]&&s[0][1]===s.at(-1)[1])s.pop();return s;});
          if(!rings.length||rings.some(r=>r.length<3))throw Error('Invalid footprint');
          const base=rings.map(r=>r.map(c=>{const q=point(c);q.z+=unit(minHeight,c);return q;}));
          const roof=rings.map((r,i)=>r.map((c,j)=>{const q=base[i][j].clone();q.z+=unit(height-minHeight,c);return q;}));
          const xy=base.map(r=>r.map(q=>new THREE.Vector2(q.x,q.y)));
          const flat=roof.flat();
          for(const t of THREE.ShapeUtils.triangulateShape(xy[0],xy.slice(1)))push(data,flat[t[0]],flat[t[1]],flat[t[2]]);
          for(let r=0;r<rings.length;r++)for(let j=0;j<rings[r].length;j++){
            const k=(j+1)%rings[r].length;quad(data,base[r][j],base[r][k],roof[r][k],roof[r][j]);
          }
        }
        if(install('buildings',data,f,{heightM:height,minHeightM:minHeight,heightSource:p.render_height!=null?'render_height':'height',cartographic:true}))stats.buildings++;
      } else if(layer(f)==='transportation' && ['LineString','MultiLineString'].includes(g.type)){
        const roadClass=p.class||'minor',widthM=ROAD_WIDTH_METRES[roadClass];if(!widthM)continue;
        const bridge=p.brunnel==='bridge'||p.bridge===true||p.bridge==='yes';
        if(p.brunnel==='tunnel'||p.tunnel===true||p.tunnel==='yes'){stats.tunnelFeatures++;continue;}
        if(bridge)stats.bridgeFeatures++;
        const lines=g.type==='LineString'?[g.coordinates]:g.coordinates;
        const count=lines.reduce((n,r)=>n+Math.max(0,r.length-1),0);
        if(count+lines.length>limits.featureCoordinates||stats.roadSegments+count>limits.roadSegments||stats.triangles+count*4>limits.triangles){stats.omittedFeatures++;continue;}
        const data=[],markings=[];
        for(const line of lines){
          const points=line.map(c=>{const q=point(c);q.z+=unit(.04,c);return q;});
          for(let i=1;i<points.length;i++){
            const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<=1e-9)continue;
            const h=unit(widthM,line[i])/2,nx=-dy/length,ny=dx/length;
            const corner=(q,s,w=h)=>new THREE.Vector3(q.x+nx*s*w,q.y+ny*s*w,q.z);
            quad(data,corner(a,1),corner(a,-1),corner(b,-1),corner(b,1));
            // Small joint disk prevents gaps at bends; no bridge deck elevation inferred.
            if(i>1){const previous=points[i-2],pl=Math.hypot(a.x-previous.x,a.y-previous.y);if(pl>1e-9){const px=-(a.y-previous.y)/pl,py=(a.x-previous.x)/pl;for(const s of [-1,1])push(data,a,new THREE.Vector3(a.x+px*s*h,a.y+py*s*h,a.z),corner(a,s));}}
            if(zoom>=16&&widthM>=6){
              const dash=unit(3,line[i]),period=unit(8,line[i]),half=unit(.12,line[i]);
              if(period>0)for(let d=0;d<length;d+=period){
                if(stats.triangles+(data.length+markings.length)/9+2>limits.triangles)break;
                const u=a.clone().lerp(b,d/length),v=a.clone().lerp(b,Math.min(length,d+dash)/length);u.z+=unit(.015,line[i]);v.z+=unit(.015,line[i]);
                quad(markings,corner(u,1,half),corner(u,-1,half),corner(v,-1,half),corner(v,1,half));
              }
            }
          }
        }
        if(install('roads',data,f,{roadClass,widthM,cartographic:true,bridge,bridgeClearanceM:null})){stats.roadSegments+=count;if(install('markings',markings,f,{cartographic:true}))stats.markingTriangles+=markings.length/9;}
      }
    }catch{stats.invalidFeatures++;}
  }
  const colors={buildings:0xc3beb1,roads:0x777977,markings:0xf5edce};
  for(const kind of Object.keys(batches))if(batches[kind].length){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(batches[kind],3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({color:colors[kind],roughness:1,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geometry,material);mesh.name=kind;mesh.userData.sourceRanges=ranges[kind];group.add(mesh);
  }
  group.userData={cartographic:true,groundPlacement:'sampled local ground Z; otherwise projected Z; relative source heights; bridges have no inferred clearance',stats};
  let disposed=false;
  return {group,stats,dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const mesh of group.children){mesh.geometry.dispose();mesh.material.dispose();}group.clear();}};
}

// Key must include viewport tile identity, zoom/style and terrain revision. The
// caller retains scene ownership and adds returned group to its existing scene.
export function createGeographicStructuresController(defaults={}){
  let current=null,key;
  return {update(nextKey,options={}){if(current&&nextKey===key)return current;const replacement=createGeographicStructures({...defaults,...options});current?.dispose();current=replacement;key=nextKey;return current;},dispose(){current?.dispose();current=null;key=undefined;}};
}
