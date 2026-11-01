const $=id=>document.getElementById(id);
try {
 const response=await fetch('data/sfincs-trico-stage4-2014.json');if(!response.ok)throw Error(`HTTP ${response.status}`);
 const data=await response.json();
 $('status').textContent=`${data.frames.length} contiguous hourly analyses; ${data.missingCellHours} missing cell-hours. Source coverage status: ${data.status}. No local flood accuracy interval is inferred.`;
 const slider=$('hour');slider.max=data.frames.length-1;slider.disabled=false;
 function draw(){const f=data.frames[Number(slider.value)],ctx=$('map').getContext('2d'),w=480/data.lon.length,h=560/data.lat.length;
  f.precipMmH.forEach((row,y)=>row.forEach((v,x)=>{ctx.fillStyle=v===null?'#777':`hsl(205 65% ${94-Math.min(v/20,1)*65}%)`;ctx.fillRect(x*w,y*h,w+0.2,h+0.2);}));
  $('time').textContent=`${f.start} through ${f.end}`;
  const values=f.precipMmH.flat().filter(Number.isFinite);$('summary').textContent=`Selected-hour maximum ${Math.max(...values).toFixed(2)} mm. Padded local domain ${Math.min(...data.lon)} to ${Math.max(...data.lon)} longitude, ${Math.min(...data.lat)} to ${Math.max(...data.lat)} latitude.`;
 }slider.addEventListener('input',draw);draw();
}catch(error){$('status').textContent=`Recorded forcing unavailable: ${error.message}`;}
