import {test} from 'node:test';import assert from 'node:assert/strict';
import {nearbyMapPoints} from '../public/simulation/map-point-picking.js';
import {createMapClickGuard} from '../public/simulation/map-click-guard.js';
const project=([x,y])=>({x,y});
test('small markers have 48px square targets without changing their location',()=>{
 const item={name:'Gauge',coordinate:[100,100]};
 assert.deepEqual(nearbyMapPoints([item],{x:124,y:124},project),[item]);
 assert.equal(nearbyMapPoints([item],{x:125,y:100},project).length,0);
 assert.deepEqual(item.coordinate,[100,100]);
});
test('overlapping crossing and gauge targets return all choices in stable distance order',()=>{
 const crossing={name:'Crossing',coordinate:[100,100],risk:'5'},gauge={name:'Gauge',coordinate:[112,100]};
 assert.deepEqual(nearbyMapPoints([crossing,gauge],{x:108,y:100},project),[gauge,crossing]);
 assert.deepEqual(nearbyMapPoints([crossing,gauge],{x:106,y:100},project),[crossing,gauge]);
 assert.equal(crossing.risk,'5');
});
test('visible gauge label remains selectable and invalid projection never hits',()=>{
 const label={coordinate:[100,100],labelWidth:120};
 assert.equal(nearbyMapPoints([label],{x:150,y:81},project).length,1);
 assert.equal(nearbyMapPoints([{coordinate:[NaN,0]}],{x:0,y:0},project).length,0);
});
test('drag or cancellation suppresses selection until a fresh gesture',()=>{
 const guard=createMapClickGuard();guard.down({clientX:10,clientY:10});guard.move({clientX:30,clientY:10});assert.equal(guard.allow({detail:1}),false);
 guard.down({clientX:30,clientY:10});guard.move({clientX:32,clientY:11});assert.equal(guard.allow({detail:1}),true);
 guard.cancel();assert.equal(guard.allow({detail:1}),false);
});
