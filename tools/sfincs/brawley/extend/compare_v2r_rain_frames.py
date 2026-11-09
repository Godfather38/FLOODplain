"""SENSITIVITY v2r vs v2x: mesh-area-weighted hourly rain of the two precip_2d.nc files (nearest 1 km cell at each face centre). Usage: python -I compare_v2r_rain_frames.py <wt> <out.json>"""
import sys, json, numpy as np, xarray as xr
from pathlib import Path
wt = Path(sys.argv[1]); out = Path(sys.argv[2])
c2x = wt/'.sfincs-runs/brawley-avra-west-case-v2x-observed'; c2r = wt/'.sfincs-runs/brawley-avra-west-case-v2r-observed'
q = xr.open_dataset(c2x/'sfincs.nc'); X0,Y0,DX=float(q.attrs['x0']),float(q.attrs['y0']),float(q.attrs['dx'])
lev=q['level'].values.astype(int); n=q['n'].values.astype(int); m=q['m'].values.astype(int); q.close()
s=DX/2.0**(lev-1); area=s*s; xc=X0+(m-0.5)*s; yc=Y0+(n-0.5)*s
def sample(path):
    ds=xr.open_dataset(path); P=ds['Precipitation']; xs=P.x.values; ys=P.y.values
    ix=np.abs(xs[None,:]-xc[:,None]).argmin(1); iy=np.abs(ys[None,:]-yc[:,None]).argmin(1)
    v=P.values[:,iy,ix]; t=[str(x)[:13]+'Z' for x in ds.time.values]; ds.close()
    return t,(v*area).sum(1)/area.sum()
t,a=sample(c2x/'precip_2d.nc'); t2,b=sample(c2r/'precip_2d.nc'); assert t==t2
rows={t[i]:{'v2xMmH':round(float(a[i]),3),'v2rMmH':round(float(b[i]),3),'changed':bool(abs(a[i]-b[i])>0) } for i in range(len(t))}
ch=[k for k in t if rows[k]['changed']]
def tot(x,lo,hi): return round(float(sum(x[i] for i in range(len(t)) if lo<=t[i]<hi)),2)
res={'method':'mesh-area-weighted, nearest 1 km precip_2d cell at each face centre (same as v2x summary)','changedHours':ch,'nChanged':len(ch),
 'hourly':{k:rows[k] for k in t if '2026-11-01T12Z'<=k},
 'totalsMm':{'14Zto18Z_Nov1':{'v2x':tot(a,'2026-11-01T14Z','2026-11-01T18Z'),'v2r':tot(b,'2026-11-01T14Z','2026-11-01T18Z')},
   '18Zto07Z':{'v2x':tot(a,'2026-11-01T18Z','2026-11-02T07Z'),'v2r':tot(b,'2026-11-01T18Z','2026-11-02T07Z')},
   '14Zto07Z':{'v2x':tot(a,'2026-11-01T14Z','2026-11-02T07Z'),'v2r':tot(b,'2026-11-01T14Z','2026-11-02T07Z')},
   'wholeRun':{'v2x':tot(a,'0','9'),'v2r':tot(b,'0','9')}}}
out.write_text(json.dumps(res,indent=1)+'\n',encoding='utf-8',newline=chr(10)); print(json.dumps({k:res[k] for k in ['changedHours','nChanged','totalsMm']},indent=1))
