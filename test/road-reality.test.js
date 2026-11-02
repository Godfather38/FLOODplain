import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as cfg from '../public/config.js';
import {rateFailurePoint,rateRoutes,recommend,routeScore,riskScore,barricadesOnRoute,crossingLead} from '../public/logic.js';
import {handCheck,applyHand} from '../public/hand-model.js';

const NOW=Date.parse('2026-11-02T19:00:00Z');
const routes=JSON.parse(readFileSync(new URL('../public/data/routes.geojson',import.meta.url))).features;
const avraArea=routes.filter(r=>r.properties.area==='avra');
const calm={now:NOW,flows:{},alert:null,nws:[]};
const nov2=[
 {location:'Trico Rd south of Trico Marana Rd',status:'Closed',direction:'Northbound',updated:'11/02/26, 10:25',lat:32.45112652226325,lon:-111.30429098657586},
 {location:'Trico Rd south of Hardin Rd',status:'Closed',direction:'Southbound',updated:'11/02/26, 10:27',lat:32.4803,lon:-111.3042},
 {location:'Avra Valley Rd west of the Brawley Wash',status:'Proceed with Caution',direction:'Eastbound',updated:'11/01/26, 11:48',lat:32.3932,lon:-111.2951},
 {location:'Manville Rd east of Trico Rd',status:'Proceed with Caution',direction:'Eastbound',updated:'11/02/26, 11:14',lat:32.2917,lon:-111.3041},
];
const rate=(closures)=>{const d={...calm,closures};const res=Object.fromEntries(cfg.FAILURE_POINTS.map(fp=>[fp.id,rateFailurePoint(fp,d,cfg)]));
 const rated=rateRoutes(avraArea,res,cfg.FAILURE_POINTS,{closures,radiusM:cfg.CLOSURE_RADIUS_M}).map(r=>({...r,score:routeScore(r)}));return {res,rated,rec:recommend(rated)};};

test('a closure on a route between crossings rates it 5 and keeps it from being best',()=>{
 const {rated,rec}=rate(nov2),trico=rated.find(r=>r.id==='trico');
 assert.equal(trico.score,5);assert.equal(trico.level,'danger');
 assert.notEqual(rec.best.id,'trico');
 assert.match(trico.points.find(p=>p.routeBarricade).why,/County says CLOSED: Trico Rd south of Trico Marana Rd, northbound/);
});
test('a barricade off the route line does not count, nor a side street at an intersection',()=>{
 const trico=avraArea.find(r=>r.properties.id==='trico');
 assert.deepEqual(barricadesOnRoute(trico,[nov2[1]]),[]);
 const side={location:'Avra Valley Rd east of Trico Rd',status:'Closed',direction:'',lat:32.45112,lon:-111.30429};
 assert.deepEqual(barricadesOnRoute(trico,[side]),[]);
});
test('Proceed with Caution alone is a 2 and says the other sources are quiet',()=>{
 const {res,rated}=rate(nov2),p=res['brawley-dip'];
 assert.equal(p.level,'watch');assert.equal(riskScore(p),2);
 assert.equal(rated.find(r=>r.id==='avra').score,2);
 assert.match(crossingLead(p),/County says Proceed with Caution.*No local rain, weather alert or flood model/);
});
test('Proceed with Caution with another live sign stays a 3 or more; Closed is never softened',()=>{
 const d={...calm,closures:nov2,nws:[{event:'Flash Flood Warning'}]};
 const p=rateFailurePoint(cfg.FAILURE_POINTS.find(f=>f.id==='brawley-dip'),d,cfg);
 assert.equal(p.level,'caution');assert.ok(riskScore(p)>=3);
 const closed=rateFailurePoint(cfg.FAILURE_POINTS.find(f=>f.id==='brawley-dip'),{...calm,closures:[{...nov2[2],status:'Closed'}]},cfg);
 assert.equal(riskScore(closed),5);
});

const row={id:'x',status:'supported',confidence:{band:'Likely match',score:73,factors:[]},forecast:{kind:'nwm_reach'},nearestReach:{name:'Brawley Wash'},
 app:{order:5,sourceDate:'2024-08-17T00:00:00Z',reachLengthKm:9,calibrated:false,crossingCurve:{stageM:[0,0.3,0.6,1.2,2],dischargeM3s:[0,1,5,20,80]}}};
const forecast=(flow)=>({status:'ok',points:[{time:new Date(NOW+3600000).toISOString(),flowM3s:flow}]});
const road={roadM:606.26,bedM:605.96,roadAboveBedM:0.3,deck:false};
test('wash check compares modeled water with the actual road height',()=>{
 const below=handCheck(row,forecast(0.5),NOW,road);assert.equal(below.raise,false);assert.match(below.why,/ft below the road/);
 const over=handCheck(row,forecast(20),NOW,road);assert.equal(over.raise,true);assert.match(over.why,/ft over the road/);
 const high=handCheck(row,forecast(20),NOW,{roadM:640,bedM:630,roadAboveBedM:10,deck:true});assert.equal(high.raise,false,'water 1.2 m up a 10 m bank is not on the road');
 assert.equal(handCheck(row,forecast(20),NOW,null).raise,true,'no road height keeps the fixed level');
});
test('modeled water over the road restores a county caution to full weight',()=>{
 const {res}=rate(nov2),p=res['brawley-dip'];
 applyHand({'brawley-dip':p},{checks:{'brawley-dip':handCheck(row,forecast(20),NOW,road)}});
 assert.equal(p.level,'caution');assert.ok(riskScore(p)>=3);
});
test('distant gauges and basin rain never back up a county caution',()=>{
 const fp=cfg.FAILURE_POINTS.find(f=>f.id==='brawley-dip');
 const alert={rain:[],stream:[{site:'6443',name:'Brawley Wash at Milewide Rd',flow_cfs:332,last_rpt:new Date(NOW-600000).toISOString(),lat:32.2481,lon:-111.2371}]};
 const p=rateFailurePoint(fp,{...calm,alert,closures:[nov2[2]]},cfg);
 assert.ok(p.checks.some(c=>c.upstream&&c.level==='watch'),'the upstream alert is still listed');
 assert.equal(p.level,'watch');assert.equal(riskScore(p),2);
 assert.match(crossingLead(p),/No local rain, weather alert or flood model/);
});
