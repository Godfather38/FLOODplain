import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeGas} from './gas-mock.js';
const src=readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
const phone='5205550123';
function setup(){const clock={now:Date.parse('2026-11-06T12:00:00Z')};const g=makeGas(clock,src,()=>[]);for(const [k,v] of Object.entries({TWILIO_APPROVED:'yes',TWILIO_SID:'AC-test',TWILIO_TOKEN:'test',TWILIO_FROM:'+18005550123'}))g.props.set(k,v);return {...g,clock};}
const signup=g=>g.post({action:'signup',phone,times:['05:45'],consentVersion:'2026-11-06'});
const code=g=>/code: (\d{4})/.exec(g.sent.at(-1).body)[1];
test('provider errors, malformed replies and network failures never claim a code was sent or fall back to Verizon',()=>{
 for(const failure of [{twilioStatus:400,twilioBody:{code:21610,message:'opted out'}},{twilioStatus:429},{twilioStatus:500},{twilioRaw:'bad json'},{twilioBody:{status:'queued'}},{twilioBody:{sid:'SM',status:'failed'}},{twilioThrow:true}]){
  const g=setup();Object.assign(g.clock,failure);assert.equal(signup(g).ok,false);assert.equal(g.post({action:'confirm',phone,code:''}).ok,false);assert.equal(g.api.sheet_().rows[1][4],false);assert.equal(g.sent.filter(s=>s.to.endsWith('@vtext.com')).length,0);
 }
});
test('confirmation has disclosures, records consent and does not send twice on retry',()=>{
 const g=setup();assert.equal(signup(g).ok,true);const c=code(g);const before=g.sent.length;
 assert.equal(g.post({action:'confirm',phone,code:c}).ok,true);assert.match(g.sent.at(-1).body,/FLOODplain.*Up to 1 alerts\/day.*rates.*STOP.*HELP/);
 assert.equal(g.post({action:'confirm',phone,code:c}).ok,true);assert.equal(g.sent.length,before+1);assert.equal(g.api.sheet_().rows[1][14],'2026-11-06');
});
test('expired codes and refused welcome messages do not activate recurring alerts',()=>{
 const g=setup();signup(g);const c=code(g);g.clock.twilioStatus=400;assert.equal(g.post({action:'confirm',phone,code:c}).ok,false);assert.equal(g.api.sheet_().rows[1][4],false);
 g.clock.twilioStatus=201;g.clock.now+=600001;assert.match(g.post({action:'confirm',phone,code:c}).error,/expired/);
});
test('waitlist duplicate and stop are idempotent without enabling all-carrier messaging',()=>{
 const g=setup();g.props.set('TWILIO_APPROVED','no');for(let i=0;i<2;i++)assert.equal(g.post({action:'waitlist',phone,consentVersion:'2026-11-06'}).ok,true);
 assert.equal(g.ss.getSheetByName('waitlist').rows.length,2);assert.equal(g.sent.length,0);assert.equal(g.props.get('TWILIO_APPROVED'),'no');
 for(let i=0;i<2;i++)assert.equal(g.post({action:'stop',phone}).ok,true);assert.equal(g.ss.getSheetByName('waitlist').rows.length,1);
});
test('beta confirmation uses functioning web support instead of claiming monitored replies',()=>{
 const g=setup();g.props.set('TWILIO_APPROVED','no');signup(g);assert.equal(g.post({action:'confirm',phone,code:code(g)}).ok,true);assert.match(g.sent.at(-1).body,/support.html/);assert.doesNotMatch(g.sent.at(-1).body,/Reply STOP/);
});
test('21610 suppresses pending waitlist traffic and broken approved config never falls back',()=>{
 const g=setup();g.post({action:'waitlist',phone});g.clock.twilioStatus=400;g.clock.twilioBody={code:21610};assert.equal(signup(g).ok,false);assert.equal(g.ss.getSheetByName('waitlist').rows[1][3],'opted out');
 const broken=setup();broken.props.delete('TWILIO_TOKEN');assert.equal(signup(broken).ok,false);assert.equal(broken.sent.length,0);
});
test('standalone and legacy policy copies match source and contain complete SMS disclosures',()=>{
 const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');const content=read('sms-policy-content.html');
 for(const p of ['privacy.html','terms.html'])assert.ok(read(p).includes(content));
 assert.ok(read('index.html').includes(content.replaceAll('href="#privacy"','href="privacy.html#privacy"').replaceAll('href="#terms"','href="terms.html#terms"')));
 for(const pattern of [/SMS opt-in data and consent/,/Message and data rates may apply/,/START or UNSTOP/,/Twilio and mobile carriers/,/up to 4/,/Support/])assert.match(content,pattern);
});
