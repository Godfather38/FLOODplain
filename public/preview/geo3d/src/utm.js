// UTM zone 12N (WGS84), the SFINCS case's EPSG:32612. Standard Krüger series, good to
// well under a metre across the case.
const a=6378137,f=1/298.257223563,k0=.9996,e2=f*(2-f),ep2=e2/(1-e2),LON0=-111,FALSE_E=500000;
const meridian=p=>a*((1-e2/4-3*e2*e2/64-5*e2**3/256)*p-(3*e2/8+3*e2*e2/32+45*e2**3/1024)*Math.sin(2*p)+(15*e2*e2/256+45*e2**3/1024)*Math.sin(4*p)-(35*e2**3/3072)*Math.sin(6*p));
export function toUtm(lon,lat){
 const p=lat*Math.PI/180,l=(lon-LON0)*Math.PI/180,s=Math.sin(p),c=Math.cos(p),t=Math.tan(p);
 const N=a/Math.sqrt(1-e2*s*s),T=t*t,C=ep2*c*c,A=c*l;
 return{
  e:FALSE_E+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120),
  n:k0*(meridian(p)+N*t*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720)),
 };
}
export function fromUtm(e,n){
 const M=n/k0,mu=M/(a*(1-e2/4-3*e2*e2/64-5*e2**3/256)),e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
 const p1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
 const s=Math.sin(p1),c=Math.cos(p1),t=Math.tan(p1),N=a/Math.sqrt(1-e2*s*s),R=a*(1-e2)/(1-e2*s*s)**1.5,T=t*t,C=ep2*c*c,D=(e-FALSE_E)/(N*k0);
 return{
  lat:(p1-N*t/R*(D*D/2-(5+3*T+10*C-4*C*C-9*ep2)*D**4/24+(61+90*T+298*C+45*T*T-252*ep2-3*C*C)*D**6/720))*180/Math.PI,
  lon:LON0+(D-(1+2*T+C)*D**3/6+(5-2*C+28*T-3*C*C+8*ep2+24*T*T)*D**5/120)/c*180/Math.PI,
 };
}
