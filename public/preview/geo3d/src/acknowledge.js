// One acknowledgement, then out of the way. Blocked storage just means asking again.
const KEY='geo3d-simulation-ack';
export function mountAcknowledgement(card=document.getElementById('simulation-ack'),button=document.getElementById('simulation-ack-ok')){
 let seen=false;try{seen=localStorage.getItem(KEY)==='1';}catch{}
 card.hidden=seen;
 button.onclick=()=>{card.hidden=true;try{localStorage.setItem(KEY,'1');}catch{}};
}
