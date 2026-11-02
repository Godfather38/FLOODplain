"""Map verified NHD inlets and official HydroMT outflows onto the prepared native quadtree."""
import argparse,json,importlib.util
from pathlib import Path
from types import SimpleNamespace
import numpy as np,geopandas as gpd,xarray as xr,xugrid as xu
from hydromt_sfincs.workflows import river_source_points

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--case-root',type=Path,required=True);p.add_argument('--mesh',type=Path,required=True);p.add_argument('--parameters',type=Path,required=True);p.add_argument('--network',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 root=a.case_root;registry=json.loads((root/'boundary-registry.json').read_text());grid=xu.open_dataset(a.mesh).load();table=xr.open_dataset(a.parameters/'sfincs_subgrid.nc');grid['z'].values[:]=table.z_zmin.values
 domain=gpd.read_file(root/'active-domain.geojson').to_crs(32612);rivers=gpd.read_file(a.network).to_crs(32612);rivers.index=rivers.comid.astype(int)
 if set(rivers.flowdir)!={'With Digitized'}:raise ValueError('Unverified river directions')
 points=[];rows=[]
 for item in registry['externalInlets']:
  line=rivers.loc[int(item['receivingReachId'])].geometry
  if line.geom_type=='MultiLineString' and len(line.geoms)==1:line=line.geoms[0]
  if line.geom_type!='LineString':raise ValueError('Multipart receiving river requires source inspection')
  distances=np.arange(1,min(201,line.length),1);candidates=[line.interpolate(d) for d in distances];xy=np.array([[q.x,q.y] for q in candidates]);faces=grid.grid.locate_points(xy);valid=np.flatnonzero(faces>=0)
  if not len(valid):raise ValueError('No native active receiving face within 200m for '+item['reachId'])
  i=int(valid[0]);point=candidates[i];face=int(faces[i]);points.append(point);rows.append({**item,'x':point.x,'y':point.y,'nativeFaceIndexZeroBased':face,'downstreamOffsetM':float(distances[i]),'placement':'First active native face along verified directed receiving river, no elevation-based relocation'})
 outlets=river_source_points(rivers,domain,src_type='outflow',buffer=100,river_upa=0,river_len=0)
 inlet_gdf=gpd.GeoDataFrame(geometry=points,crs=32612);outpol=outlets.copy();outpol.geometry=outpol.buffer(250);outpol=outpol[~outpol.intersects(inlet_gdf.buffer(1).union_all())]
 spec=importlib.util.spec_from_file_location('official_mask','.sfincs-runs/cht-refinement-source/mask.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 adapter=SimpleNamespace(data=grid,face_coordinates=lambda:(grid.grid.face_coordinates[:,0],grid.grid.face_coordinates[:,1]));model=SimpleNamespace(grid=adapter,crs=grid.grid.crs)
 module.SfincsMask(model).build(include_polygon=domain,outflow_boundary_polygon=outpol)
 if not (grid['mask'].values==3).any():raise ValueError('No native outflow cells')
 for row in rows:
  if grid['mask'].values[row['nativeFaceIndexZeroBased']]!=1:raise ValueError('Inlet conflicts with outflow')
 grid.ugrid.to_netcdf(a.output/'sfincs.nc');np.savetxt(a.output/'sfincs.src',np.array([[r['x'],r['y']] for r in rows]),fmt='%.3f')
 inlet_gdf.to_file(a.output/'inlets.geojson',driver='GeoJSON');outlets.to_file(a.output/'outlets.geojson',driver='GeoJSON')
 result={'registryVersion':'all-routes-connected-v2','case':root.name,'inlets':rows,'outflowCells':int((grid['mask'].values==3).sum()),'outflowMethod':'Official HydroMT directed outflow points, 500m corridor, official Deltares native mask builder','activeCells':len(grid.grid.face_coordinates),'solverExecuted':False,'status':'Native geometry and boundary locations only; rainfall/case assembly pending'}
 (a.output/'boundary-placement.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
if __name__=='__main__':main()
