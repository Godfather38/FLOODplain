"""Recrop retained HRRR messages for a new solver-owned domain; no network."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
import eccodes as ec
from pyproj import Transformer
p=argparse.ArgumentParser();p.add_argument('directory');p.add_argument('--grid-bounds',type=float,nargs=4,metavar=('WEST','SOUTH','EAST','NORTH'),help='explicit EPSG:4326 grid-centre bounds (brawley-avra-west); default derives them from the registry as before');p.add_argument('--domain-version',default='all-routes-union-v1');a=p.parse_args();root=Path(a.directory);read=lambda n:json.loads((root/n).read_text(encoding='utf-8-sig'));registry=read('boundary-registry.json');prov=read('rainfall-provenance.json');old=read('rainfall.json');m=read('manifest.json')
b=Transformer.from_crs(registry['crs'],'EPSG:4326',always_xy=True).transform_bounds(*registry['bounds'],densify_pts=41);west=np.floor(b[0]*100)/100-.01;south=np.floor(b[1]*100)/100-.01;east=np.ceil(b[2]*100)/100+.01;north=np.ceil(b[3]*100)/100+.01
if a.grid_bounds:west,south,east,north=a.grid_bounds;assert west<=b[0] and south<=b[1] and east>=b[2] and north>=b[3],'explicit grid bounds do not cover registry bounds'
lon=np.linspace(west,east,round((east-west)/.01)+1).tolist();lat=np.linspace(north,south,round((north-south)/.01)+1).tolist();mapping=None;frames=[];missing=0
for source,oldframe in zip(prov['sources'],old['frames'],strict=True):
 path=root/source['rawFile'];assert hashlib.sha256(path.read_bytes()).hexdigest()==source['sha256']
 with path.open('rb') as f:h=ec.codes_grib_new_from_file(f)
 try:
  if ec.codes_get(h,'md5GridSection')!=prov['nativeGridHash']:raise ValueError('Native grid mismatch')
  if mapping is None:
   yy=ec.codes_get_array(h,'latitudes');xx=(ec.codes_get_array(h,'longitudes')+180)%360-180;ids=np.flatnonzero((yy>south-.1)&(yy<north+.1)&(xx>west-.1)&(xx<east+.1));ry=np.radians(yy[ids]);rx=np.radians(xx[ids]);mapping=[]
   for y in lat:
    row=[]
    for x in lon:
     d=np.sin((ry-np.radians(y))/2)**2+np.cos(ry)*np.cos(np.radians(y))*np.sin((rx-np.radians(x))/2)**2;k=int(np.argmin(d));idx=int(ids[k]);distance=float(6371000*2*np.arcsin(np.sqrt(d[k])));assert distance<=2500;row.append(dict(index=idx,lat=float(yy[idx]),lon=float(xx[idx]),distanceM=distance))
    mapping.append(row)
   for i,j in [(0,0),(len(lat)//2,len(lon)//2),(-1,-1)]:assert ec.codes_grib_find_nearest(h,lat[i],lon[j],npoints=1)[0]['index']==mapping[i][j]['index']
  v=ec.codes_get_values(h);bitmap=ec.codes_get_array(h,'bitmap') if ec.codes_get(h,'bitmapPresent') else None;nodata=ec.codes_get(h,'missingValue');rain=[]
  for row in mapping:
   rr=[]
   for cell in row:
    k=cell['index'];value=float(v[k]);value=None if (bitmap is not None and not bitmap[k]) or value==nodata or not np.isfinite(value) or value<0 else value;missing+=value is None;rr.append(value)
   rain.append(rr)
  frames.append(dict(start=oldframe['start'],end=oldframe['end'],precipMmH=rain,precipMS=[[None if v is None else v/3600000 for v in row] for row in rain]))
 finally:ec.codes_release(h)
prov.update(bounds=[west,south,east,north],mapping=mapping,domainVersion=a.domain_version,recrop='Original retained full-grid HRRR APCP messages; no redownload or weather-model change');(root/'rainfall-provenance.json').write_text(json.dumps(prov,indent=2)+'\n',encoding='utf-8');old.update(lon=lon,lat=lat,frames=frames,missingCellHours=missing,status='complete' if not missing else 'insufficient_data');old['provenance']['manifestSha256']=hashlib.sha256((root/'rainfall-provenance.json').read_bytes()).hexdigest();(root/'rainfall.json').write_text(json.dumps(old,separators=(',',':'))+'\n',encoding='utf-8');m.update(bounds=[west,south,east,north],domainVersion=a.domain_version);(root/'manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8');print('Recropped',len(frames),'frames',len(lat),len(lon),'native cells',len({c['index'] for row in mapping for c in row}),'missing',missing,'bounds',m['bounds'])
