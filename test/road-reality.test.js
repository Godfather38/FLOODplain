import test from 'node:test';

import assert from 'node:assert/strict';

import {readFileSync} from 'node:fs';

import * as cfg from '../public/config.js';

import {rateFailurePoint,rateRoutes,recommend,routeScore,riskScore,barricadesOnRoute,crossingLead,normalizeRoadEvents,roadEventsOnRoute,routeRunAlongLeg,routeClosures,correctLeg} from '../public/logic.js';

import {handCheck,applyHand} from '../public/hand-model.js';



const NOW=Date.parse('2026-11-02T19:00:00Z');

const routes=JSON.parse(readFileSync(new URL('../public/data/routes.geojson',import.meta.url))).features;

const avraArea=routes.filter(r=>r.properties.area==='avra');

const calm={now:NOW,flows:{},alert:null,nws:[]};
// A test barricade on the Trico route's own leg of Trico Rd, between Silverbell Rd and Trico Marana Rd, where only the Trico route runs.
// (The county's Nov 2 Trico Rd record below names the south leg, but it stands on the north leg:
// see LEG_CORRECTIONS in logic.js.)
const onTrico={location:'Trico Rd north of Silverbell Rd',status:'Closed',direction:'Northbound',updated:'11/02/26, 10:25',lat:32.44702228874744,lon:-111.30427390008394};

const nov2=[

 {location:'Trico Rd south of Trico Marana Rd',status:'Closed',direction:'Northbound',updated:'11/02/26, 10:25',lat:32.45112652226325,lon:-111.30429098657586},

 {location:'Trico Rd south of Hardin Rd',status:'Closed',direction:'Southbound',updated:'11/02/26, 10:27',lat:32.4803,lon:-111.3042},

 {location:'Avra Valley Rd west of the Brawley Wash',status:'Proceed with Caution',direction:'Eastbound',updated:'11/01/26, 11:48',lat:32.3932,lon:-111.2951},

 {location:'Manville Rd east of Trico Rd',status:'Proceed with Caution',direction:'Eastbound',updated:'11/02/26, 11:14',lat:32.2917,lon:-111.3041},

];

const rate=(closures)=>{const d={...calm,closures};const res=Object.fromEntries(cfg.FAILURE_POINTS.map(fp=>[fp.id,rateFailurePoint(fp,d,cfg)]));

 const rated=rateRoutes(avraArea,res,cfg.FAILURE_POINTS,{closures,radiusM:cfg.CLOSURE_RADIUS_M}).map(r=>({...r,score:routeScore(r)}));return {res,rated,rec:recommend(rated)};};



test('a closure on a route between crossings rates it 5 and keeps it from being best',()=>{

 const {rated,rec}=rate([onTrico,...nov2.slice(1)]),trico=rated.find(r=>r.id==='trico');

 assert.equal(trico.score,5);assert.equal(trico.level,'danger');

 assert.notEqual(rec.best.id,'trico');

 assert.match(trico.points.find(p=>p.routeBarricade).why,/County says CLOSED: Trico Rd north of Silverbell Rd, northbound/);

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

// Shapes as TransView returned them on November 2, 2026.
const tvClosures=[{KeyID:'452426',headline:'Flooding Trico Rd south of Trico Marana Rd  Northbound',trafficImpacts:'Road Closed',description:'Trico Rd south of Trico Marana Rd Northbound.  Status: Closed due to Flooding<br /><b>For more',jurisdiction:'Pima County',Geo:'MULTIPOINT ((-111.304290986576 32.4511265222633))'}];
const tvWork={452453:{KeyID:452453,Headline:'SCENIC DRIVE CONSTRUCTION',Jurisdiction:'Town of Marana',EventSubTypes:['UTILITY_WORK_ROAD_CLOSED'],StartDate:'11/2/2026 12:00:00 AM',StopDate:'11/5/2026 12:00:00 AM',DailyStartTime:'06:00:00',DailyEndTime:'14:30:00',Links:['','https://example.org/scenic'],Geography:'MULTILINESTRING ((-111.1399669513407 32.357422019256205, -111.13918911072626 32.357521711381452))'}};
const trico=avraArea.find(r=>r.properties.id==='trico');
const tricoLine=trico.geometry.coordinates;
const lineOn=(a,b)=>`MULTILINESTRING ((${tricoLine.slice(a,b).map(p=>p.join(' ')).join(', ')}))`;
const work=(over)=>({111:{KeyID:111,Headline:'Utility job',EventSubTypes:['UTILITY_WORK_ROAD_CLOSED'],StartDate:'11/2/2026 12:00:00 AM',StopDate:'11/5/2026 12:00:00 AM',DailyStartTime:'06:00:00',DailyEndTime:'14:30:00',Links:[],Geography:lineOn(30,60),...over}});

test('the utility closure on Scenic Drive is not on any route',()=>{
 const events=normalizeRoadEvents(tvClosures,tvWork);
 assert.equal(events[1].reason,'utility work');assert.equal(events[0].reason,null,'the county reason field is not trusted');
 for(const r of avraArea)assert.ok(!roadEventsOnRoute(r,[events[1]],NOW).length,r.properties.id);
});
test('a closure line overlapping the route counts while it is in effect',()=>{
 const events=normalizeRoadEvents(null,work());
 const hit=roadEventsOnRoute(trico,events,NOW);
 assert.equal(hit.length,1);assert.equal(hit[0].how,'line_overlap');assert.ok(hit[0].overlapM>=30);
 assert.equal(roadEventsOnRoute(trico,events,Date.parse('2026-11-03T03:00:00Z')).length,0,'8 PM is outside its daily hours');
 assert.equal(roadEventsOnRoute(trico,events,Date.parse('2026-11-06T19:00:00Z')).length,0,'past its end date');
 const lanes=normalizeRoadEvents(null,work({EventSubTypes:['ROAD_MAINTENANCE']}));
 assert.equal(roadEventsOnRoute(trico,lanes,NOW).length,0,'lane closures are not road closures');
 const rated=rateRoutes([trico],Object.fromEntries(cfg.FAILURE_POINTS.map(fp=>[fp.id,rateFailurePoint(fp,{...calm,closures:[]},cfg)])),cfg.FAILURE_POINTS,{closures:[],radiusM:cfg.CLOSURE_RADIUS_M,roadEvents:events,now:NOW});
 assert.equal(routeScore(rated[0]),5);assert.match(rated[0].points.find(p=>p.routeBarricade).why,/closed for utility work/);
});
test('a street crossing the route does not count as on it',()=>{
 const mid=tricoLine.find(p=>p[1]>32.44&&p[1]<32.445);
 const cross=`MULTILINESTRING ((${mid[0]-0.002} ${mid[1]}, ${mid[0]+0.002} ${mid[1]}))`;
 const events=normalizeRoadEvents(null,work({Geography:cross}));
 assert.equal(roadEventsOnRoute(trico,events,NOW).length,0);
});
test('the county wording confirms which leg a barricade is on',()=>{
 assert.ok(routeRunAlongLeg([tricoLine],onTrico)>=100,'the route runs north from the barricade');
 assert.equal(barricadesOnRoute(trico,[onTrico]).length,1);
 const farLeg={...nov2[0],location:'Trico Rd north of Trico Marana Rd',direction:'Southbound'};
 assert.equal(barricadesOnRoute(trico,[farLeg]).length,0,'the route turns east here and never takes the north leg');
 const tvOn=[{...tvClosures[0],headline:'Flooding Trico Rd north of Silverbell Rd  Northbound',Geo:`MULTIPOINT ((${onTrico.lon} ${onTrico.lat}))`}];
 const events=normalizeRoadEvents(tvOn,null),blocked=[onTrico,...nov2.slice(1)];
 const res=Object.fromEntries(cfg.FAILURE_POINTS.map(fp=>[fp.id,rateFailurePoint(fp,{...calm,closures:blocked},cfg)]));
 const r=rateRoutes([trico],res,cfg.FAILURE_POINTS,{closures:blocked,radiusM:cfg.CLOSURE_RADIUS_M,roadEvents:events,now:NOW})[0];
 const added=r.points.filter(p=>p.routeBarricade);
 assert.equal(added.length,1,'county point and TransView copy are one barricade');
 assert.ok(!/flooding/i.test(added[0].why),'no reason is claimed');
 assert.equal(routeScore(r),5);
});
test('a failed TransView feed changes nothing',()=>{
 const res=Object.fromEntries(cfg.FAILURE_POINTS.map(fp=>[fp.id,rateFailurePoint(fp,{...calm,closures:[]},cfg)]));
 const r=rateRoutes([trico],res,cfg.FAILURE_POINTS,{closures:[],radiusM:cfg.CLOSURE_RADIUS_M,roadEvents:null,now:NOW})[0];
 assert.equal(routeScore(r),1);
});

test('the Nov 2 Trico Rd barricade the county lists as south of Trico Marana Rd is on the north leg, off the route',()=>{
 // Local report: it stands just north of the intersection; the route turns east there.
 assert.equal(correctLeg(nov2[0]).location,'Trico Rd north of Trico Marana Rd');assert.equal(correctLeg(nov2[0]).countySaid,'Trico Rd south of Trico Marana Rd');
 assert.equal(correctLeg({...nov2[0],lat:32.46}).location,nov2[0].location,'a barricade elsewhere is read as the county says');
 assert.deepEqual(barricadesOnRoute(trico,[nov2[0]]),[]);
 assert.deepEqual(roadEventsOnRoute(trico,normalizeRoadEvents(tvClosures,null),NOW),[],'nor its TransView copy');
 const {rated}=rate(nov2);assert.equal(routeClosures(rated.find(r=>r.id==='trico')).length,0);
});

test('closed routes are identified and always rank behind open ones',()=>{
 const {rated,rec}=rate([onTrico,...nov2.slice(1)]);
 assert.equal(routeClosures(rated.find(r=>r.id==='trico')).length,1);
 assert.equal(routeClosures(rated.find(r=>r.id==='avra')).length,0,'a caution is not a closure');
 assert.equal(routeClosures(rec.best).length,0);assert.equal(rec.order.at(-1).id,'trico');
});
