"""Compare retained terrain with existing native subgrid at screened road low points; no solver."""
from pathlib import Path
import xugrid as xu
import json,geopandas as gpd,xarray as xr,numpy as np,rasterio
from rasterio.features import geometry_mask,geometry_window
from shapely.geometry import box,mapping
p=Path('tools/sfincs/data/road-dip-refinement/coverage-audit-v2');f=gpd.read_file(p/'terrain-low-point-candidates.geojson').to_crs(32612);rivers=gpd.read_file('tools/sfincs/data/road-dip-refinement/network-query.geojson').to_crs(32612)
g=xu.open_dataset('.sfincs-runs/road-native-case-v2/sfincs.nc');s=xr.open_dataset('.sfincs-runs/road-native-case-v2/sfincs_subgrid.nc');rasters=[rasterio.open(q) for q in Path('.sfincs-runs/road-terrain-1m-v1').glob('terrain-1m-*.tif')]
rows=[]
for _,row in f.iterrows():
 i=int(row.nativeFace);x,y=map(float,g.grid.face_coordinates[i]);size=100/2**(int(g.level[i])-1);b=(x-size/2,y-size/2,x+size/2,y+size/2);vals=[]
 for r in rasters:
  if r.bounds.left<b[2] and r.bounds.right>b[0] and r.bounds.bottom<b[3] and r.bounds.top>b[1]:
   w=geometry_window(r,[mapping(box(*b))]);a=r.read(1,window=w,masked=True);t=r.window_transform(w);keep=geometry_mask([mapping(box(*b))],out_shape=a.shape,transform=t,invert=True);v=a[keep].compressed();vals.extend(v[np.isfinite(v)].tolist())
 zmin=float(s.z_zmin[i]);actual=min(vals) if vals else None
 rows.append({'nativeFace':i,'route':row.route,'chainageM':float(row.chainageM),'distanceToMappedNhdFlowlineM':float(rivers.distance(row.geometry).min()),'retained1mCellMinimumNAVD88M':actual,'nativeSubgridMinimumNAVD88M':zmin,'nativeMinusRetainedMinimumM':zmin-actual if actual is not None else None,'interpretation':'Comparison of different raster sampling footprints; not proof of road/deck elevation or culvert connectivity'})
(p/'low-point-subgrid-evidence.json').write_text(json.dumps({'modelVersion':'connected-v2','sourceMeshSha256':'91ce69c66c8fc5c667254f3cf279fc3d12449223c19d4c8b547f7a7e81ef4ffb','points':rows},indent=2)+'\n')
print(json.dumps(rows,indent=2))
