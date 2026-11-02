"""Prepare a bounded road-focused mesh with the unmodified Deltares quadtree builder; no solver."""
import argparse,importlib.util,json,hashlib
from pathlib import Path
import geopandas as gpd
import numpy as np
from pyproj import CRS
from shapely import contains_xy

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--builder',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--case-root',type=Path,required=True);a=p.parse_args()
 if (a.output/'refinement-mesh.nc').exists():raise FileExistsError('Preserve prior mesh')
 root=a.case_root
 domain=gpd.read_file(root/'active-domain.geojson').to_crs(32612).geometry.union_all();region=gpd.GeoDataFrame(geometry=[domain],crs=32612)
 import pandas as pd
 zones=gpd.read_file(root/'refinement-zones.geojson').to_crs(32612);bounds=domain.bounds
 x0,y0=np.floor(np.array(bounds[:2])/100)*100;x1,y1=np.ceil(np.array(bounds[2:])/100)*100
 n,m=int((y1-y0)/100),int((x1-x0)/100)
 # Conservative full rectangular base plus refined-area estimate, before native builder.
 estimate=n*m+sum(g.area/(100/(2**int(l)))**2 for g,l in zip(zones.geometry,zones.refinement_level))
 if estimate>750000:raise ValueError('Preparation exceeds scoped 750000-cell envelope')
 a.output.mkdir(parents=True,exist_ok=True)
 region.to_file(a.output/'active-domain.geojson',driver='GeoJSON')
 spec=importlib.util.spec_from_file_location('deltares_quadtree_builder',a.builder);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 data=module.build_quadtree_xugrid(x0=x0,y0=y0,nmax=n,mmax=m,dx=100.,dy=100.,rotation=0.,crs=CRS.from_epsg(32612),refinement_polygons=zones)
 path=a.output/'refinement-mesh.nc';data.ugrid.to_netcdf(path)
 xy=data.grid.face_coordinates;data['mask'].values[:]=contains_xy(domain,xy[:,0],xy[:,1]).astype('int8');data['snapwave_mask'].values[:]=0
 active=module.cut_inactive_cells(data);active.ugrid.to_netcdf(a.output/'active-refinement-mesh.nc')
 levels,counts=np.unique(active['level'].values,return_counts=True)
 info={'status':'mesh_preparation_only_no_physical_fields_no_solver','builder':'Deltares-research/cht_sfincs','builderCommit':'8d29dcc7d4138e75001ecce1708137791cc3eb6f','builderSha256':hashlib.sha256(a.builder.read_bytes()).hexdigest(),'domainAreaKm2':domain.area/1e6,'boundsEPSG32612':[x0,y0,x1,y1],'baseCellSizeM':100,'refinementCellSizesM':[12.5,6.25],'sizes':dict(data.sizes),'meshBytes':path.stat().st_size,'activeCells':len(active.grid.face_coordinates),'levelCounts':dict(zip(map(str,levels.tolist()),counts.tolist())),'missing':['Native source/outlet placement and provider reach crosswalk','1m prepared terrain coverage and subgrid import','Source-qualified structure openings where needed','Expanded frozen inflows/rainfall coverage','Official roughness/infiltration mapping to quadtree','Native volume and section-output configuration']}
 (a.output/'mesh-report.json').write_text(json.dumps(info,indent=2)+'\n',encoding='utf-8');print(json.dumps(info))
if __name__=='__main__':main()
