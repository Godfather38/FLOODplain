"""Standard Deltares quadtree subgrid and HydroMT CN parameter intake; no solver run."""
import argparse,importlib.util,json,hashlib
from pathlib import Path
import numpy as np,pandas as pd,xarray as xr,xugrid as xu,rioxarray
from pyproj import CRS
from cht_bathymetry.database import BathymetryDatabase
from hydromt_sfincs.workflows import cn_to_s

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--mesh',type=Path,default=Path('.sfincs-runs/road-dip-refinement-v1/active-refinement-mesh.nc'));p.add_argument('--context',type=Path,default=Path('.sfincs-runs/road-context-rasters-v1'));a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 mesh=a.mesh;context=a.context;fine=Path('.sfincs-runs/road-terrain-1m-v1');grid=xu.open_dataset(mesh).load();db=BathymetryDatabase(check_online=False);bathy=[]
 fine_files={p.name:p for p in fine.glob('terrain-1m-*.tif')};fine_files.update({p.name:p for p in Path('.sfincs-runs/silverbell-terrain-v1').glob('terrain-1m-*.tif')})
 fine_files.update({p.name:p for p in Path('.sfincs-runs/all-routes-terrain-v1').glob('terrain-1m-*.tif')})
 for f in sorted(fine_files.values()):
  db.add_dataset_from_file(f.stem,str(f));bathy.append({'name':f.stem})
 db.add_dataset_from_file('context',str(context/'terrain.tif'));bathy.append({'name':'context'})
 lulc=rioxarray.open_rasterio(context/'lulc.tif').squeeze('band',drop=True);mapping=pd.read_csv(context/'esa_worldcover_mapping.csv',index_col=0)
 values=np.full(lulc.shape,np.nan,dtype='float32')
 for code,row in mapping.iterrows():values[lulc.values==int(code)]=row['N']
 if not np.isfinite(values).all() or (values<=0).any():raise ValueError('Missing roughness mapping')
 man=lulc.copy(data=values);man.rio.write_nodata(np.nan,inplace=True);db.add_dataarray_dataset(man,'manning')
 target=a.output/'sfincs_subgrid.nc'
 if not target.exists():
  spec=importlib.util.spec_from_file_location('official_subgrid','.sfincs-runs/cht-refinement-source/subgrid_quadtree_builder.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  table=module.build_subgrid_table_quadtree(grid,bathymetry_sets=bathy,roughness_sets=[{'name':'manning'}],nr_levels=10,nr_subgrid_pixels=6,depth_factor=1.0,zfill=None,bathymetry_database=db,quiet=False)
  # Official builder zero-fills missing raster samples: reject a local zero-elevation artifact.
  for name in ['z_zmin','uv_zmin']:
   if not np.isfinite(table[name]).all() or float(table[name].min())<=0:raise ValueError('Uncovered local terrain reached native subgrid tables')
  table.to_netcdf(target)
 cn_raster=rioxarray.open_rasterio(context/'cn.tif').squeeze('band',drop=True).astype('float32');db.add_dataarray_dataset(cn_raster,'cn');xy=grid.grid.face_coordinates;cn=db.get_bathymetry_on_grid(xy[:,0],xy[:,1],CRS.from_epsg(32612),[{'name':'cn'}],method='nearest',coords='points',dxmin=6.25)
 if not np.isfinite(cn).all() or (cn<1).any() or (cn>100).any():raise ValueError('Missing native CN support')
 scs=cn_to_s(xr.DataArray(cn,dims='np'),xr.DataArray(np.ones(len(cn),dtype=bool),dims='np')).round(3)
 xr.Dataset({'scs':xr.DataArray(scs.values.astype('float32'),dims='mesh2d_nFaces',attrs={'units':'inches','long_name':'SCS retention; fair ARCII undrained scenario'})}).to_netcdf(a.output/'infiltration.nc')
 result={'status':'parameters_prepared_not_runnable_case','cells':len(cn),'subgridPixelsPerCellSide':6,'finestSubgridSamplingM':6.25/6,'sourceFineResolutionM':1,'terrainSources':'2021/2023 road windows;2019 only missing peripheral context','roughness':'WorldCover2021 with pinned official mapping through official quadtree builder','infiltration':'GCN10 fair ARCII undrained scenario; official HydroMT cn_to_s; retention inches','cnRange':[float(cn.min()),float(cn.max())],'scsRangeInches':[float(scs.min()),float(scs.max())],'nativeInput':{'inffile':'infiltration.nc','inftype':'cna'},'solverExecuted':False,'files':[{'name':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in [target,a.output/'infiltration.nc']]}
 (a.output/'parameter-report.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
if __name__=='__main__':main()
