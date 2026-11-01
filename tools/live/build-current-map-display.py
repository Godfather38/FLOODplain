"""Bind new original-grid SFINCS output to existing terrain and regenerate its flat display polygons.
Reuses export-water-footprints.py's source-defined terrain intersection; no solver or new terrain.
Run after the existing publisher writes to a staging directory; publish its manifest last.
"""
import argparse,gzip,hashlib,json
from pathlib import Path
import numpy as np
import xarray as xr
from pyproj import Transformer
from rasterio.features import shapes
from rasterio.transform import Affine
from rasterio.warp import transform_geom
p=argparse.ArgumentParser();p.add_argument('--staging',type=Path,required=True);p.add_argument('--retained',type=Path,required=True);p.add_argument('--native',type=Path,required=True);p.add_argument('--config',type=Path,required=True);a=p.parse_args()
def read(p):return json.loads(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_text(encoding='utf-8-sig'))
def save(p,obj):p.write_bytes(gzip.compress(json.dumps(obj,allow_nan=False,separators=(',',':')).encode(),mtime=0))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
m=read(a.staging/'current-sfincs-manifest.json');c=read(a.config);run=read(a.staging/Path(m['artifact']['path']).name);oldm=read(a.retained/'retained-sfincs-manifest.json');old=read(a.retained/Path(oldm['artifact']['path']).name)
assert c['projectedCrs']=='EPSG:32612' and c['cellAreaM2']==10000
assert len(run['cells'])==len(old['cells'])==29685
assert all(abs(x['lat']-y['lat'])<1e-9 and abs(x['lon']-y['lon'])<1e-9 for x,y in zip(run['cells'],old['cells'])),'Native grid/order changed'
terrain=read(a.retained/'frozen-terrain-display.json.gz');assert terrain['sourceSha256']==oldm['artifact']['sha256']
vertices=np.array(terrain['vertices']);rows,cols=vertices[:,3].astype(int),vertices[:,4].astype(int)
x,y=Transformer.from_crs(4326,32612,always_xy=True).transform([v['lon'] for v in run['cells']],[v['lat'] for v in run['cells']]);assert np.max(np.abs(x-(467700+cols*100+50)))<.01 and np.max(np.abs(y-(3572300+rows*100+50)))<.01,'Retained terrain ordering mismatch'
mask=np.load(a.native/c['activeMaskNpy'],allow_pickle=False).astype(bool)
with xr.open_dataset(a.native/c.get('mapFile','sfincs_map.nc')) as ds:
 z=ds['zs'];dims=tuple(k for k in z.dims if k!='time');zs=z.transpose('time',*dims).values;assert zs.shape[1:]==mask.shape
 stamps=[str(t)[:19]+'Z' for t in np.asarray(ds.time.values,dtype='datetime64[ns]')];water=[]
 for f in run['frames']:
  values=zs[stamps.index(f['time'])][mask];water.append({'time':f['time'],'surfaceM':[float(v) if np.isfinite(v) else None for v in values]})
terrain.update(runId=m['runId'],sourceSha256=m['artifact']['sha256'],nativeMapSha256=sha(a.native/c.get('mapFile','sfincs_map.nc')),waterFrames=water)
folder=a.staging/(m['runId']+'-map');folder.mkdir(exist_ok=False);save(folder/'frozen-terrain-display.json.gz',terrain)
detail=np.frombuffer(gzip.decompress((a.retained/'frozen-voxel-terrain.f32.gz').read_bytes()),dtype='<f4').reshape(-1,100);assert detail.shape[0]==len(run['cells'])
yy,xx=rows[:,None]*10+np.arange(100)//10,cols[:,None]*10+np.arange(100)%10
for index,(frame,w) in enumerate(zip(run['frames'],water)):
 depth=np.array(frame['depthM'],dtype=float);surface=np.array(w['surfaceM'],dtype=float);valid=np.isfinite(depth)&np.isfinite(surface)&(depth>=.01);categories=np.searchsorted([.01,.1,.3,1,2,4],depth,side='right').astype('uint8');labels=np.where(valid[:,None]&np.isfinite(detail)&(detail<surface[:,None]),categories[:,None],0);raster=np.zeros(((rows.max()+1)*10,(cols.max()+1)*10),dtype='uint8');raster[yy,xx]=labels;features=[]
 for geometry,value in shapes(raster,mask=raster>0,connectivity=4,transform=Affine(10,0,467700,0,10,3572300)):
  features.append({'type':'Feature','properties':{'depthClass':int(value)-1},'geometry':transform_geom('EPSG:32612','EPSG:4326',geometry,precision=7)})
 save(folder/f'water-footprints-{index}.json.gz',{'type':'FeatureCollection','time':frame['time'],'sourceSha256':m['artifact']['sha256'],'displayResolutionM':10,'hydraulicResolutionM':100,'verticalDatum':'NAVD88','method':'New native zs intersected with unchanged retained 10m terrain; color is full-cell average depth. Not solved 10m shoreline or road depth.','features':features});print(index,len(features),flush=True)
m['mapDisplay']={'base':'data/'+folder.name+'/','geometryReuse':'Every native cell coordinate/order, full-cell area and CRS matched to retained original model before terrain reuse','terrainSourceSha256':terrain['terrainSourceSha256'],'artifacts':{f.name:{'sha256':sha(f),'bytes':f.stat().st_size} for f in folder.iterdir() if f.is_file()}}
(a.staging/'current-sfincs-manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8');print('Staged display complete; copy immutable files before current manifest.')
