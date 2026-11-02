// "Test and view a flood!" is the one place a saved model run may appear. It only turns on from
// its own link, is never remembered, and never feeds ratings or alerts. Its acknowledgement and
// on-screen wording say what it is; there is no permanent banner. See docs/LIVE-DATA-ONLY.md.
export const isTestFlood=(search=location.search)=>new URLSearchParams(search).get('mode')==='test-flood';
export function testFloodHref(href=location.href,on=true){
 const url=new URL(href);
 url.searchParams.delete('mode');url.searchParams.delete('case');
 if(on)url.searchParams.set('mode','test-flood');
 url.hash=on?'/map':'/';
 return url.href;
}
