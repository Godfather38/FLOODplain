"""SENSITIVITY v2r vs v2x: hour-by-hour section flux (from validation-full.json) and crossing over-topping (zs - roadZ, wet frames only).

Usage: python -I compare_v2r_hourly.py <wt> <v2x runs/current> <v2r runs/current> <v2x validation-full.json> <v2r validation-full.json> <out.json>
"""
import sys, gzip, json, math
from pathlib import Path
import numpy as np, xarray as xr, pyproj
WT=Path(sys.argv[1]); RX=Path(sys.argv[2]); RR=Path(sys.argv[3]); VX=Path(sys.argv[4]); VR=Path(sys.argv[5]); OUT=Path(sys.argv[6])
TO_UTM=pyproj.Transformer.from_crs(4326,32612,always_xy=True); DRY=0.0091
q=xr.open_dataset(RR/'sfincs.nc'); X0,Y0,DX=float(q.attrs['x0']),float(q.attrs['y0']),float(q.attrs['dx'])
level=q['level'].values.astype(int); nidx=q['n'].values.astype(int); midx=q['m'].values.astype(int); q.close()
size=DX/2.0**(level-1); area=size*size; lookup={(level[i],nidx[i],midx[i]):i for i in range(level.size)}; LV=sorted(set(level.tolist()))
def face_at(x,y):
    for L in LV:
        s=DX/2.0**(L-1); f=lookup.get((L,int(math.floor((y-Y0)/s))+1,int(math.floor((x-X0)/s))+1))
        if f is not None: return f
st=json.load(gzip.open(WT/'tools/live/road-stations/brawley-avra-west-local-v2.json.gz'))['columns']
sz=np.array([np.nan if v is None else v for v in st['roadZ']],float); sx,sy=TO_UTM.transform(np.array(st['lon']),np.array(st['lat']))
meta=json.loads((WT/'docs/upgrade/validation-brawley-prerun-20261108.json').read_text())
sites=[(c['road'],c['lon'],c['lat']) for c in meta['brawleyCrossings']]+[(f"{c['road']} {c['depthM']} m dip",c['lon'],c['lat']) for c in meta['repDips'] if 'Manville' in c['road'] or 'Snyder' in c['road']]
sel={}
for lab,lon,lat in sites:
    x,y=TO_UTM.transform(lon,lat); ids=[s for s in np.where(np.hypot(sx-x,sy-y)<=25.0)[0] if not np.isnan(sz[s])]
    sel[lab]=[(s,face_at(sx[s],sy[s])) for s in ids]
faces=sorted({f for v in sel.values() for _,f in v if f is not None})
def load(D):
    m=xr.open_dataset(D/'sfincs_map.nc'); T=[str(t)[:16]+'Z' for t in m['time'].values]
    zs=m['zs'].values[:,faces].astype(float); vol=m['subgrid_volume'].values[:,faces].astype(float); m.close()
    return T,dict(zip(faces,zs.T)),dict(zip(faces,(vol/area[faces][None,:]).T))
out={'note':'SENSITIVITY v2r (all observed rain) vs v2x (frozen HRRR 14Z-07Z); over = max over stations of cell zs - station roadZ, only frames where vol/area >= 0.0091 m; NaN = no wet station that frame (not dry evidence)','crossingsHourlyMaxOverM':{},'crossingsFirstOver':{},'sectionsHourlyM3s':{}}
TX,zx,hx=load(RX); TR,zr,hr=load(RR); assert TX==TR
for lab,lst in sel.items():
    row={}; first={}
    for name,zz,hh in [('v2x',zx,hx),('v2r',zr,hr)]:
        ov=np.full(len(TX),np.nan)
        for s,f in lst:
            if f is None: continue
            d=np.where(hh[f]>=DRY,zz[f]-sz[s],np.nan); ov=np.fmax(ov,d)
        row[name]=ov; idx=np.where(ov>0)[0]; first[name]=TX[idx[0]] if idx.size else None
    out['crossingsHourlyMaxOverM'][lab]={TX[i]:{'v2x':None if np.isnan(row['v2x'][i]) else round(float(row['v2x'][i]),3),'v2r':None if np.isnan(row['v2r'][i]) else round(float(row['v2r'][i]),3)} for i in range(0,len(TX),4)}
    out['crossingsFirstOver'][lab]=first|{'stations':len(lst)}
jx=json.loads(VX.read_text())['sectionsHourlyM3s']; jr=json.loads(VR.read_text())['sectionsHourlyM3s']
for k in ['Donaldson Ranch (15877627)','Mile Wide Black Wash 15876815 band (ALERT 6443)','Mile Wide Brawley 15877627 band','Mile Wide both bands','Manville (15876771)','Tucker (15876711)','Outlet 720060498 (outflow links)','All outflow cells']:
    out['sectionsHourlyM3s'][k]={t:{'v2x':jx[k].get(t),'v2r':jr[k].get(t)} for t in jr[k]}
OUT.write_text(json.dumps(out,indent=1)+'\n',encoding='utf-8',newline=chr(10))
for k in out['sectionsHourlyM3s']:
    print(k); print('  '+' '.join(f"{t[11:13]}:{v['v2x']}/{v['v2r']}" for t,v in out['sectionsHourlyM3s'][k].items()))
for k,v in out['crossingsHourlyMaxOverM'].items():
    print(k, out['crossingsFirstOver'][k]); print('  '+' '.join(f"{t[11:13]}:{w['v2x']}/{w['v2r']}" for t,w in v.items()))
