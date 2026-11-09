"""Map verified NHD inlets and official HydroMT outflows onto the prepared native quadtree."""
import argparse,json,importlib.util
from pathlib import Path
from types import SimpleNamespace
import numpy as np,geopandas as gpd,xarray as xr,xugrid as xu
from hydromt_sfincs.workflows import river_source_points

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--case-root',type=Path,required=True);p.add_argument('--mesh',type=Path,required=True);p.add_argument('--parameters',type=Path,required=True);p.add_argument('--network',type=Path,required=True)
 # Optional (default off, existing cases unchanged): terrain-verified reversed NHD reaches and extra directed channels for outflow points.
 p.add_argument('--terrain-reversed-reach',type=int,action='append',default=[],help='NHD comid digitized against the terrain; reversed before the HydroMT outflow search only if --terrain shows its start lower than its end')
 p.add_argument('--terrain',type=Path,help='10 m terrain GeoTIFF (EPSG:32612) used to verify --terrain-reversed-reach')
 p.add_argument('--extra-outflow-channels',type=Path,help='GeoJSON of directed mapped channel lines (properties source,id,evidence) passed to the same HydroMT outflow search')
 a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
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
 reversed_=[]
 if a.terrain_reversed_reach:
  import rasterio
  from shapely.geometry import LineString
  if a.terrain is None:raise ValueError('--terrain-reversed-reach needs --terrain')
  with rasterio.open(a.terrain) as src:
   for c in a.terrain_reversed_reach:
    line=rivers.loc[c].geometry
    if line.geom_type=='MultiLineString' and len(line.geoms)==1:line=line.geoms[0]
    if line.geom_type!='LineString':raise ValueError('Multipart reversed reach requires source inspection')
    zs,ze=[float(v[0]) for v in src.sample([line.coords[0],line.coords[-1]])]
    if not zs<ze:raise ValueError(f'Reach {c}: terrain does not fall toward its digitized start ({zs:.2f} vs {ze:.2f})')
    rivers.loc[c,'geometry']=LineString(line.coords[::-1]);reversed_.append({'comid':c,'digitizedStartXY':[round(v,3) for v in line.coords[0]],'terrainAtDigitizedStartM':round(zs,2),'terrainAtDigitizedEndM':round(ze,2),'lengthM':round(line.length,1),'action':'geometry reversed for the HydroMT outflow search only; flowdir attribute kept'})
 outlets=river_source_points(rivers,domain,src_type='outflow',buffer=100,river_upa=0,river_len=0)
 if a.terrain_reversed_reach or a.extra_outflow_channels:outlets['outflowSource']='NHDPlus network'+(' (with terrain-reversed reaches)' if a.terrain_reversed_reach else '')
 extra=[]
 if a.extra_outflow_channels:
  import pandas as pd
  ch=gpd.read_file(a.extra_outflow_channels).to_crs(32612)
  for _,c in ch.iterrows():
   q=river_source_points(gpd.GeoDataFrame(geometry=[c.geometry],crs=32612),domain,src_type='outflow',buffer=100,river_upa=0,river_len=0)
   if q.empty:raise ValueError(f'Extra channel {c["source"]} {c["id"]}: no HydroMT outflow point')
   q['outflowSource']=f'{c["source"]} {c["id"]}';extra.append({'source':c['source'],'id':str(c['id']),'points':[[round(g.x,3),round(g.y,3)] for g in q.geometry]});outlets=gpd.GeoDataFrame(pd.concat([outlets,q],ignore_index=True),crs=32612)
 inlet_gdf=gpd.GeoDataFrame(geometry=points,crs=32612);outpol=outlets.copy();outpol.geometry=outpol.buffer(250);outpol=outpol[~outpol.intersects(inlet_gdf.buffer(1).union_all())]
 spec=importlib.util.spec_from_file_location('official_mask','.sfincs-runs/cht-refinement-source/mask.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 adapter=SimpleNamespace(data=grid,face_coordinates=lambda:(grid.grid.face_coordinates[:,0],grid.grid.face_coordinates[:,1]));model=SimpleNamespace(grid=adapter,crs=grid.grid.crs)
 module.SfincsMask(model).build(include_polygon=domain,outflow_boundary_polygon=outpol)
 if not (grid['mask'].values==3).any():raise ValueError('No native outflow cells')
 for row in rows:
  if grid['mask'].values[row['nativeFaceIndexZeroBased']]!=1:raise ValueError('Inlet conflicts with outflow')
 grid.ugrid.to_netcdf(a.output/'sfincs.nc');np.savetxt(a.output/'sfincs.src',np.array([[r['x'],r['y']] for r in rows]),fmt='%.3f')
 inlet_gdf.to_file(a.output/'inlets.geojson',driver='GeoJSON');outlets.to_file(a.output/'outlets.geojson',driver='GeoJSON')
 if reversed_ or extra:
  fc=grid.grid.face_coordinates;m3=np.flatnonzero(grid['mask'].values==3);attr=[]
  for f in m3:
   pt=gpd.points_from_xy([fc[f,0]],[fc[f,1]],crs=32612)[0];src=sorted({outpol.outflowSource.iloc[i] for i in range(len(outpol)) if outpol.geometry.iloc[i].contains(pt)})
   attr.append({'face':int(f),'x':round(float(fc[f,0]),1),'y':round(float(fc[f,1]),1),'zZmin':round(float(grid['z'].values[f]),2),'sources':src})
 result={'registryVersion':'all-routes-connected-v2','case':root.name,'inlets':rows,'outflowCells':int((grid['mask'].values==3).sum()),'outflowMethod':'Official HydroMT directed outflow points, 500m corridor, official Deltares native mask builder','activeCells':len(grid.grid.face_coordinates),'solverExecuted':False,'status':'Native geometry and boundary locations only; rainfall/case assembly pending'}
 if reversed_ or extra:result.update(terrainReversedReaches=reversed_,extraOutflowChannels=extra,outflowCellSources=attr,outflowMethod=result['outflowMethod']+'; plus the same HydroMT outflow search on the reversed reaches and extra channels listed here (same 100 m edge buffer and 250 m corridor)')
 (a.output/'boundary-placement.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
if __name__=='__main__':main()
