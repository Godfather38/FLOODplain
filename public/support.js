import {TEXT_API} from './config.js?v=dev';
for(const id of ['stop-form','help-form']) {
 const form=document.getElementById(id);
 form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button'),status=form.querySelector('[role=status]');
  if(button.disabled)return;button.disabled=true;status.textContent='Working…';
  try {
   const fields=Object.fromEntries(new FormData(form));
   const response=await fetch(TEXT_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...fields,action:id==='stop-form'?'stop':'request',purpose:'support'})});
   if(!response.ok)throw new Error('The service is unavailable. Please try again.');
   const result=await response.json();if(!result.ok)throw new Error(result.error||'The request was not accepted.');
   status.textContent=id==='stop-form'?'If that number was signed up, its texts and waitlist entry are stopped.':'Your support request was sent to the operator.';
  }catch(error){status.textContent=error.message||'Could not reach the service. Please try again.';}
  finally{button.disabled=false;}
 });
}
