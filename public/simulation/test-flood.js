// "Test and view a flood!" is the one place a saved model run may appear. It only turns on from
// its own link, is never remembered, and never feeds ratings or alerts. See docs/LIVE-DATA-ONLY.md.
export const isTestFlood=(search=location.search)=>new URLSearchParams(search).get('mode')==='test-flood';
export function testFloodHref(href=location.href,on=true){
 const url=new URL(href);
 url.searchParams.delete('mode');url.searchParams.delete('case');
 if(on)url.searchParams.set('mode','test-flood');
 url.hash=on?'/map':'/';
 return url.href;
}
export function mountTestFloodBanner(){
 const banner=document.createElement('div');banner.className='test-flood-banner';banner.setAttribute('role','status');
 banner.innerHTML=`<strong>Test flood</strong><span>Saved model run from Nov 1–2, 2026. Not current conditions. Routes and alerts still use live data.</span><a href="${testFloodHref(location.href,false)}">Back to live</a>`;
 document.body.prepend(banner);document.body.classList.add('test-flood-mode');
}
