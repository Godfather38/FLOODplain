import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapClickGuard} from '../public/simulation/map-click-guard.js';
test('drag suppresses ensuing click but fresh taps and keyboard selection remain available',()=>{
 const g=createMapClickGuard();
 g.down({clientX:10,clientY:10});g.move({clientX:30,clientY:10});
 g.move({clientX:10,clientY:10});assert.equal(g.allow({detail:1}),false);
 assert.equal(g.allow({detail:0}),true);
 g.down({clientX:10,clientY:10});g.move({clientX:12,clientY:12});assert.equal(g.allow({detail:1}),true);
 g.cancel();assert.equal(g.allow({detail:1}),false);
 g.down({clientX:10,clientY:10});assert.equal(g.allow({detail:1}),true);
});
