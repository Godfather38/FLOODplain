"""Scope named county road segments against retained terrain and completed mesh; no solver."""
from pathlib import Path
import json,hashlib,csv
import geopandas as gpd,numpy as np,rasterio,xugrid as xu
from shapely.geometry import box,mapping,Point
from shapely.ops import linemerge,unary_union
from pyproj import Transformer
from scipy.signal import find_peaks
root=Path('tools/sfincs/data/all-routes-extension-v1')
route=gpd.read_file('public/data/routes.geojson').to_crs(32612).explode(index_parts=False).reset_index(drop=True)
route['routeId']=route['id'];route['id']=[str(r.routeId)+'-part-'+str(i) for i,r in route.iterrows()]
road=route.geometry.union_all()
grid=xu.open_dataset('.sfincs-runs/silverbell-native-case-v1/sfincs.nc').load();levels=grid['level'].values;mask=grid['mask'].values
rasters=[rasterio.open(p) for p in sorted(Path('.sfincs-runs/road-terrain-1m-v1').glob('*.tif'))]
# New cached windows, if acquired, augment rather than replace retained baseline tiles.
for p in Path('.sfincs-runs/silverbell-terrain-v1').glob('*.tif'):rasters.append(rasterio.open(p))
for p in Path('.sfincs-runs/all-routes-terrain-v1').glob('*.tif'):rasters.append(rasterio.open(p))
tr=Transformer.from_crs(32612,4326,always_xy=True);profiles=[];candidates=[];stats=[]
for _,r in route.iterrows():
 ds=np.arange(0,r.geometry.length,2);xy=np.array([[p.x,p.y] for p in [r.geometry.interpolate(float(s)) for s in ds]]);z=np.full(len(ds),np.nan)
 for src in rasters:
  b=src.bounds;idx=np.flatnonzero((xy[:,0]>=b.left)&(xy[:,0]<b.right)&(xy[:,1]>b.bottom)&(xy[:,1]<=b.top)&~np.isfinite(z))
  if len(idx):
   v=np.array([a[0] for a in src.sample(xy[idx])]);good=np.isfinite(v)&(v!=src.nodata);z[idx[good]]=v[good]
 faces=grid.grid.locate_points(xy);ok=faces>=0;sizes=np.full(len(ds),np.nan);sizes[ok]=100/2**(levels[faces[ok]]-1);ok[ok]&=mask[faces[ok]]>0
 # Do not allow missing elevations to create artificial minima at gap boundaries.
 valid=np.isfinite(z);edges=np.flatnonzero(np.diff(np.r_[False,valid,False]));peaks=[]
 for a,b in zip(edges[::2],edges[1::2]):
  ii,prop=find_peaks(-z[a:b],prominence=.25,distance=13)
  for j,k in enumerate(ii):peaks.append((a+int(k),float(prop['prominences'][j])))
 for i,prom in peaks:candidates.append({'type':'Feature','geometry':mapping(Point(tr.transform(*xy[i]))),'properties':{'road':r['name'],'route':r.routeId,'segment':r.id,'chainageM':float(ds[i]),'terrainNAVD88M':float(z[i]),'prominenceM':prom,'baselineNativeFace':int(faces[i]),'baselineCellSizeM':float(sizes[i]) if ok[i] else None,'interpretation':'Terrain-profile candidate, not confirmed flood depth or underground drainage'}})
 for i in range(len(ds)):profiles.append([r.id,float(ds[i]),*tr.transform(*xy[i]),float(z[i]) if valid[i] else None,int(faces[i]),float(sizes[i]) if ok[i] else None])
 stats.append({'segment':r.id,'lengthM':r.geometry.length,'samples':len(ds),'outsideActive':int((~ok).sum()),'already6_25m':int((ok&(sizes<=6.25)).sum()),'coarserThan6_25m':int((ok&(sizes>6.25)).sum()),'missing1mSamples':int((~valid).sum())})
report={'modelVersion':'all-routes-extension-v1-preparation','baseline':'Completed Silverbell native grid, unchanged','userRequest':"I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river.",'segments':stats,'terrainMinimumCandidates':len(candidates),'screeningMethod':'2m samples, 0.25m prominence, 26m separation; inventory criteria only, not flood thresholds','solverExecuted':False}
(root/'scope-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
(root/'terrain-low-point-candidates.geojson').write_text(json.dumps({'type':'FeatureCollection','features':candidates}),encoding='utf-8')
with (root/'road-profile.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['segment','chainage_m','lon','lat','terrain_NAVD88_m','baselineFace','baselineCellM']);w.writerows(profiles)
print(json.dumps(report))
