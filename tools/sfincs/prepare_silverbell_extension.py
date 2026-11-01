"""Scope named county road segments against retained terrain and completed mesh; no solver."""
from pathlib import Path
import json,hashlib,csv
import geopandas as gpd,numpy as np,rasterio,xugrid as xu
from shapely.geometry import box,mapping,Point
from shapely.ops import linemerge,unary_union
from pyproj import Transformer
from scipy.signal import find_peaks
root=Path('tools/sfincs/data/silverbell-extension-v1');roads=gpd.read_file(root/'county-silverbell.geojson').to_crs(32612)
# Keep only county named road geometry near the already selected route; exclude westward continuation.
selected=gpd.read_file('public/data/routes.geojson').to_crs(32612);corridor=selected[selected.id=='silverbell-north'].geometry.union_all().buffer(40)
parts=[]
for _,r in roads.iterrows():
 g=r.geometry.intersection(corridor)
 if g.is_empty:continue
 for line in ([g] if g.geom_type=='LineString' else g.geoms):
  if line.geom_type=='LineString' and line.length>20:parts.append(line)
merged=linemerge(unary_union(parts));lines=[merged] if merged.geom_type=='LineString' else list(merged.geoms)
route=gpd.GeoDataFrame({'id':['silverbell-'+str(i) for i in range(len(lines))]},geometry=lines,crs=32612);route.to_crs(4326).to_file(root/'target-roads.geojson',driver='GeoJSON')
road=route.geometry.union_all();zones=gpd.GeoDataFrame({'refinement_level':[3,4]},geometry=[road.buffer(500),road.buffer(100)],crs=32612);zones.to_file(root/'refinement-zones.geojson',driver='GeoJSON')
grid=xu.open_dataset('.sfincs-runs/road-native-case-v2/sfincs.nc').load();levels=grid['level'].values;mask=grid['mask'].values
rasters=[rasterio.open(p) for p in sorted(Path('.sfincs-runs/road-terrain-1m-v1').glob('*.tif'))]
# New cached windows, if acquired, augment rather than replace retained baseline tiles.
for p in Path('.sfincs-runs/silverbell-terrain-v1').glob('*.tif'):rasters.append(rasterio.open(p))
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
 for i,prom in peaks:candidates.append({'type':'Feature','geometry':mapping(Point(tr.transform(*xy[i]))),'properties':{'road':'W SILVERBELL RD','segment':r.id,'chainageM':float(ds[i]),'terrainNAVD88M':float(z[i]),'prominenceM':prom,'baselineNativeFace':int(faces[i]),'baselineCellSizeM':float(sizes[i]) if ok[i] else None,'interpretation':'Terrain-profile candidate, not confirmed flood depth or underground drainage'}})
 for i in range(len(ds)):profiles.append([r.id,float(ds[i]),*tr.transform(*xy[i]),float(z[i]) if valid[i] else None,int(faces[i]),float(sizes[i]) if ok[i] else None])
 stats.append({'segment':r.id,'lengthM':r.geometry.length,'samples':len(ds),'outsideActive':int((~ok).sum()),'already6_25m':int((ok&(sizes<=6.25)).sum()),'coarserThan6_25m':int((ok&(sizes>6.25)).sum()),'missing1mSamples':int((~valid).sum())})
geom=road.buffer(525);b=geom.bounds;needed=[]
for x in range(int(np.floor(b[0]/1000)*1000),int(np.ceil(b[2]/1000)*1000),1000):
 for y in range(int(np.floor(b[1]/1000)*1000),int(np.ceil(b[3]/1000)*1000),1000):
  if geom.intersects(box(x,y,x+1000,y+1000)):needed.append({'x':x,'y':y,'cached':any(Path(s.name).name==f'terrain-1m-{x}-{y}.tif' for s in rasters)})
domain=gpd.read_file('tools/sfincs/data/road-dip-refinement/connected-v2/active-domain.geojson').to_crs(32612).geometry.union_all()
report={'modelVersion':'silverbell-extension-v1-preparation','baseline':'connected-v2 / run41344983607 unchanged','source':'https://gisdata.pima.gov/arcgis1/rest/services/GISOpenData/Transportation/MapServer/11','countyRoadIds':roads.ROADID.tolist(),'roadLengthM':sum(s['lengthM'] for s in stats),'segments':stats,'roadBuffer100mOutsideExistingDomainM2':road.buffer(100).difference(domain).area,'context500mOutsideExistingDomainM2':road.buffer(500).difference(domain).area,'terrainWindows':needed,'newTerrainWindows':sum(not x['cached'] for x in needed),'terrainMinimumCandidates':len(candidates),'proposedResolutionM':{'road100mBuffer':6.25,'context500mBuffer':12.5},'solverExecuted':False}
(root/'scope-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8');(root/'terrain-low-point-candidates.geojson').write_text(json.dumps({'type':'FeatureCollection','features':candidates}),encoding='utf-8')
with (root/'road-profile.csv').open('w',newline='') as f:w=csv.writer(f);w.writerow(['segment','chainage_m','lon','lat','terrain_NAVD88_m','baselineFace','baselineCellM']);w.writerows(profiles)
print(json.dumps(report))
