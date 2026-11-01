"""Read-only coverage and terrain-profile audit of the actual v2 native road case."""
import json,hashlib
from pathlib import Path
import numpy as np,geopandas as gpd,xugrid as xu,rasterio
from shapely.geometry import Point,mapping
from pyproj import Transformer
from scipy.signal import find_peaks
root=Path('tools/sfincs/data/road-dip-refinement');out=root/'coverage-audit-v2';out.mkdir(exist_ok=True)
grid=xu.open_dataset('.sfincs-runs/road-native-case-v2/sfincs.nc').load();levels=grid['level'].values;mask=grid['mask'].values
routes=gpd.read_file(root/'target-routes.geojson').to_crs(32612)
cross=gpd.read_file('public/data/crossings.geojson').to_crs(32612)
rasters=[rasterio.open(p) for p in sorted(Path('.sfincs-runs/road-terrain-1m-v1').glob('terrain-1m-*.tif'))]
to_ll=Transformer.from_crs(32612,4326,always_xy=True)
def terrain(xy):
 z=np.full(len(xy),np.nan)
 for r in rasters:
  b=r.bounds;i=np.flatnonzero((xy[:,0]>=b.left)&(xy[:,0]<b.right)&(xy[:,1]>=b.bottom)&(xy[:,1]<b.top)&~np.isfinite(z))
  if len(i):
   vals=np.array([v[0] for v in r.sample(xy[i],masked=True)]);vals[vals==r.nodata]=np.nan;z[i]=vals
 return z
reports=[];profiles=[];candidates=[]
for _,r in routes.iterrows():
 line=r.geometry;ds=np.unique(np.r_[np.arange(0,line.length,2.),line.length]);xy=np.array([[line.interpolate(d).x,line.interpolate(d).y] for d in ds]);faces=grid.grid.locate_points(xy);ok=faces>=0;sizes=np.full(len(ds),np.nan);sizes[ok]=100/2**(levels[faces[ok]]-1);z=terrain(xy)
 checks=[]
 for offset in [0,25,75,95,250,490]:
  allfaces=[]
  for sign in ([1] if offset==0 else [-1,1]):
   a=np.array([[line.interpolate(max(0,d-1)).x,line.interpolate(max(0,d-1)).y] for d in ds]);b=np.array([[line.interpolate(min(line.length,d+1)).x,line.interpolate(min(line.length,d+1)).y] for d in ds]);v=b-a;v=v/np.maximum(np.linalg.norm(v,axis=1)[:,None],1e-9);q=xy+sign*offset*np.column_stack([-v[:,1],v[:,0]]);f=grid.grid.locate_points(q);allfaces.extend(f.tolist())
  f=np.array(allfaces);good=f>=0;ss=100/2**(levels[f[good]]-1);checks.append({'offsetM':offset,'samples':len(f),'outsideActive':int((~good).sum()),'maxCellM':float(ss.max()) if len(ss) else None,'over6_25m':int((ss>6.25).sum()),'over12_5m':int((ss>12.5).sum())})
 bad=np.flatnonzero(~ok|(sizes>6.25));reports.append({'route':r.id,'lengthM':line.length,'samplesEveryM':2,'centerlineSamples':len(ds),'outsideActive':int((~ok).sum()),'over6_25m':int(np.sum(sizes>6.25)),'missing1mTerrainSamples':int(np.sum(~np.isfinite(z))),'corridorChecks':checks,'badCenterlineLocations':[list(to_ll.transform(*xy[i])) for i in bad[::max(1,len(bad)//25)]]})
 # Screening only: topographic minima, not inferred culverts or flood predictions.
 valid=np.isfinite(z);peaks,props=find_peaks(-np.where(valid,z,np.inf),prominence=.25,distance=13)
 for j,i in enumerate(peaks):
  point=Point(xy[i]);dist=float(cross.distance(point).min());ll=to_ll.transform(*xy[i]);candidates.append({'type':'Feature','geometry':mapping(Point(ll)),'properties':{'route':r.id,'chainageM':float(ds[i]),'terrainElevationNAVD88M':float(z[i]),'profileProminenceM':float(props['prominences'][j]),'nearestMappedCrossingM':dist,'nativeFace':int(faces[i]),'cellSizeM':float(sizes[i]) if ok[i] else None,'interpretation':'Bare-earth centerline screening minimum; not verified road/deck height, culvert, or flood hazard'}})
 for i in range(len(ds)):profiles.append([r.id,round(float(ds[i]),2),*map(float,xy[i]),float(z[i]) if valid[i] else None,int(faces[i]),float(sizes[i]) if ok[i] else None])
 print(json.dumps(reports[-1]),flush=True)
cf=grid.grid.locate_points(np.array([[g.x,g.y] for g in cross.geometry]));cr=[]
for (_,r),f in zip(cross.iterrows(),cf):
 cr.append({'route':r.route,'road':r.road,'water':r.water,'coordinates':list(to_ll.transform(r.geometry.x,r.geometry.y)),'selectedRoute':r.route in set(routes.id),'nativeFace':int(f),'active':bool(f>=0 and mask[f]>0),'cellSizeM':float(100/2**(levels[f]-1)) if f>=0 else None})
report={'modelVersion':'connected-v2','nativeMeshSha256':hashlib.sha256(Path('.sfincs-runs/road-native-case-v2/sfincs.nc').read_bytes()).hexdigest(),'routes':reports,'crossings':cr,'terrainScreening':{'method':'scipy.signal.find_peaks on negative 2m-spaced bare-earth road centerline samples; minimum prominence0.25m, separation26m; no hydrologic interpretation','candidates':len(candidates),'moreThan50mFromMappedCrossing':sum(f['properties']['nearestMappedCrossingM']>50 for f in candidates)},'limitations':['Road centerline may not match pavement center exactly','Bare-earth terrain does not establish bridge deck elevation or underground culvert opening','Point samples do not prove every corridor pixel covered','No changed geometry or solver execution in this audit']}
(out/'coverage.json').write_text(json.dumps(report,indent=2)+'\n');(out/'terrain-low-point-candidates.geojson').write_text(json.dumps({'type':'FeatureCollection','features':candidates})+'\n')
import csv
with (out/'road-profiles.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['route','chainage_m','x_32612','y_32612','terrain_navd88_m','native_face','cell_size_m']);w.writerows(profiles)

# Exact union of native rectangular footprints establishes continuous buffer coverage,
# including round route-end approaches; it does not rely only on sampled centerlines.
import shapely
xy=grid.grid.face_coordinates;side=100/2**(levels-1)
boxes=shapely.box(xy[:,0]-side/2,xy[:,1]-side/2,xy[:,0]+side/2,xy[:,1]+side/2)
coverage=[]
for distance,maxsize in [(100,6.25),(500,12.5)]:
 wanted=routes.buffer(distance).union_all();actual=shapely.union_all(boxes[(side<=maxsize)&(mask>0)])
 missing=wanted.difference(actual)
 coverage.append({'bufferM':distance,'maximumCellSizeM':maxsize,'requiredAreaM2':wanted.area,'uncoveredAreaM2':missing.area,'method':'Exact polygon difference against union of native active rectangular cell footprints, including route end caps'})
 if missing.area>0.01:gpd.GeoDataFrame(geometry=[missing],crs=32612).to_crs(4326).to_file(out/('missing-'+str(distance)+'m.geojson'),driver='GeoJSON')
 print('footprint',coverage[-1],flush=True)
required=routes.buffer(500).union_all();valid_area=0;missing_pixels=0;required_pixels=0
from rasterio.features import geometry_mask
for r in rasters:
 keep=geometry_mask([mapping(required)],out_shape=r.shape,transform=r.transform,invert=True)
 values=r.read(1,masked=True);bad=np.ma.getmaskarray(values)|~np.isfinite(values.data)
 required_pixels+=int(keep.sum());missing_pixels+=int((keep&bad).sum())
report['continuousCorridorCoverage']=coverage
report['actualRetainedTerrainCheck']={'roadBufferM':500,'requiredPixelCentersInRetainedTiles':required_pixels,'missingOrNonfinitePixels':missing_pixels,'resolutionM':1,'note':'Counts actual 1m retained raster pixels; source acquisition metadata remains in fine-terrain-manifest.json'}
report['limitations'].remove('Point samples do not prove every corridor pixel covered')
(out/'coverage.json').write_text(json.dumps(report,indent=2)+'\n')
print('DONE',report['terrainScreening'],report['actualRetainedTerrainCheck'],flush=True)

