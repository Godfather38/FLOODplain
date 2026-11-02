import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {createGeographicStructures,createGeographicStructuresController} from '../tools/simulation/geographic-structures.js';
const defaults={project:([x,y])=>new Vector3(x,y,0),metresToUnits:m=>m,groundElevationAt:()=>100};
const building=(props={height:8},rings=[[[0,0],[10,0],[10,10],[0,10],[0,0]]])=>({id:'actual-footprint',properties:{_sourceLayer:'building',...props},geometry:{type:'Polygon',coordinates:rings}});
const road=(props={})=>({id:'actual-road',properties:{_sourceLayer:'transportation',class:'motorway',...props},geometry:{type:'LineString',coordinates:[[0,0],[40,0],[40,40]]}});
test('actual footprint and tagged relative height bind to supplied local terrain',()=>{
  const result=createGeographicStructures({...defaults,features:[building()]});
  assert.equal(result.stats.buildings,1);const mesh=result.group.children[0],p=mesh.geometry.attributes.position;
  const xs=[],zs=[];for(let i=0;i<p.count;i++){xs.push(p.getX(i));zs.push(p.getZ(i));}
  assert.equal(Math.min(...xs),0);assert.equal(Math.max(...xs),10);assert.equal(Math.min(...zs),100);assert.equal(Math.max(...zs),108);
  assert.equal(mesh.userData.sourceRanges[0].sourceId,'actual-footprint');result.dispose();assert.equal(result.group.children.length,0);result.dispose();
});
test('missing height never creates invented buildings; explicit feet convert',()=>{
  const r=createGeographicStructures({...defaults,features:[building({}),building({height:'10 ft'})]});assert.equal(r.stats.missingHeight,1);assert.equal(r.stats.buildings,1);assert.equal(r.group.children[0].userData.sourceRanges[0].heightM,3.048);r.dispose();
});
test('roof respects real courtyard holes',()=>{
  const r=createGeographicStructures({...defaults,features:[building({height:8},[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[3,3],[3,7],[7,7],[7,3],[3,3]]])]});
  const p=r.group.children[0].geometry.attributes.position;let area=0;
  for(let i=0;i<p.count;i+=3)if([i,i+1,i+2].every(j=>p.getZ(j)===108))area+=Math.abs((p.getX(i+1)-p.getX(i))*(p.getY(i+2)-p.getY(i))-(p.getY(i+1)-p.getY(i))*(p.getX(i+2)-p.getX(i)))/2;
  assert.equal(area,84);r.dispose();
});
test('motorway ribbons and close zoom markings do not invent bridge clearance',()=>{
  const r=createGeographicStructures({...defaults,zoom:17,features:[road({brunnel:'bridge'}),road({brunnel:'tunnel'})]});assert.equal(r.stats.bridgeFeatures,1);assert.equal(r.stats.tunnelFeatures,1);assert.ok(r.stats.markingTriangles>0);
  const mesh=r.group.children.find(m=>m.name==='roads'),range=mesh.userData.sourceRanges[0];assert.equal(range.widthM,14);assert.equal(range.bridgeClearanceM,null);
  const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getZ(i)-100.04)<.0001);r.dispose();
});
test('budgets bound geometry and missing ground is explicit',()=>{
  const r=createGeographicStructures({...defaults,groundElevationAt:()=>null,zoom:18,features:[road(),building()],budget:{triangles:12}});assert.ok(r.stats.triangles<=12);assert.ok(r.stats.omittedFeatures>0);assert.ok(r.stats.unresolvedGroundVertices>0);r.dispose();
});
test('viewport key reuses mesh; replacement and disposal release resources',()=>{
  const c=createGeographicStructuresController(defaults),a=c.update('brawley-tile:terrain1',{features:[building()]});let disposed=0;
  a.group.children[0].geometry.addEventListener('dispose',()=>disposed++);assert.equal(c.update('brawley-tile:terrain1'),a);const b=c.update('brawley-tile:terrain2',{features:[road()]});assert.notEqual(a,b);assert.equal(disposed,1);c.dispose();assert.equal(b.group.children.length,0);
});
