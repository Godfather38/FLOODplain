"""Read actual native road output; preserve signed quantities and prove cell correspondence."""
import argparse,json,hashlib,re
from pathlib import Path
import numpy as np,xarray as xr
p=argparse.ArgumentParser();p.add_argument('directory',type=Path);p.add_argument('--run-id',required=True);a=p.parse_args();r=a.directory
m=xr.open_dataset(r/'sfincs_map.nc',decode_times=False);g=xr.open_dataset(r/'sfincs.nc',decode_times=False)
def bounds(d):
 c=d.mesh2d_face_nodes;idx=np.asarray(c.values);base=int(c.attrs.get('start_index',0));valid=np.isfinite(idx)&(idx>=base);idx=np.where(valid,idx-base,0).astype(int);x=d.mesh2d_node_x.values[idx];y=d.mesh2d_node_y.values[idx];return np.column_stack([np.where(valid,x,np.inf).min(1),np.where(valid,y,np.inf).min(1),np.where(valid,x,-np.inf).max(1),np.where(valid,y,-np.inf).max(1)])
b=bounds(m);bi=bounds(g);key=lambda row:tuple(row.tolist());lookup={key(v):i for i,v in enumerate(bi)}
if len(lookup)!=len(bi):raise ValueError('Nonunique input cell bounds')
ids=np.array([lookup[key(v)] for v in b]);area=(b[:,2]-b[:,0])*(b[:,3]-b[:,1]);np.save(r/'output-to-source-face-id.npy',g.mesh2d_nFaces.values[ids])
t=xr.coding.times.decode_cf_datetime(m.time.values,m.time.attrs['units']);times=[str(v).replace(' ','T')[:19]+'Z' for v in t]
v=m.subgrid_volume.values.astype('float64');ratio=v/area[None,:];zs=m.zs.values
log=(r/'solver.log').read_text(errors='replace');native=(r/'sfincs.log').read_text(errors='replace')
summary={'runId':a.run_id,'completionMarkerPresent':bool(re.search(r'simulation\s+finished',log+'\n'+native,re.I)),'frames':len(t),'validFrom':times[0],'validTo':times[-1],'requestedValidTo':'2026-11-02T07:00:00Z','faces':len(area),'faceCorrespondence':{'method':'Exact unique rectangle bounds independently matched between native input/output connectivity','matchedFaces':len(ids),'identityOrder':bool(np.array_equal(ids,np.arange(len(ids)))),'maxBoundsDifferenceM':float(np.max(np.abs(b-bi[ids])))},'volumeUnits':m.subgrid_volume.attrs.get('units'),'allVolumeFinite':bool(np.isfinite(v).all()),'negativeCellFrames':int((v<0).sum()),'minRawVolumeM3':float(np.nanmin(v)),'maxRawVolumeM3':float(np.nanmax(v)),'minRawVolumePerFullCellAreaM':float(np.nanmin(ratio)),'maxRawVolumePerFullCellAreaM':float(np.nanmax(ratio)),'firstLastTotalStoredVolumeM3':[float(v[0].sum()),float(v[-1].sum())],'surfaceElevationRangeM':[float(np.nanmin(zs)),float(np.nanmax(zs))],'surfaceElevationDatum':'NAVD88, not depth','riverSectionFlow':'Not recorded; no configured observation section','restartFiles':[f.name for f in sorted(r.glob('*.rst'))],'restartLimitation':'Type1 restores water/momentum but not cumulative cna precipitation/infiltration state; not an identical continuation','hashes':{n:hashlib.sha256((r/n).read_bytes()).hexdigest() for n in ['sfincs.nc','sfincs_map.nc','solver.log']}}
for name in ['status','total_runtime','average_dt']:
 if name in m:summary[name]=m[name].values.tolist()
if 'precipitation_rate' in m:summary['nativePrecipitationRate']={'units':m.precipitation_rate.attrs.get('units'),'range':[float(m.precipitation_rate.min()),float(m.precipitation_rate.max())]}
summary['cellSupportAreaKm2']={'quantity':'Sum of full computational-cell areas where native volume/full cell area exceeds threshold; NOT actual wet area or road depth','thresholdM':.01,'firstLast':[float(area[ratio[0]>.01].sum()/1e6),float(area[ratio[-1]>.01].sum()/1e6)]}
(r/'result-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))

import csv
base=Path('tools/sfincs/data/road-dip-refinement/coverage-audit-v2')
coverage=json.loads((base/'coverage.json').read_text())
if coverage['nativeMeshSha256'] != summary['hashes']['sfincs.nc']:raise ValueError('Road registry does not match this native mesh')
candidates=json.loads((base/'terrain-low-point-candidates.geojson').read_text())
points=[{'kind':'mapped_crossing','name':str(c['water'])+' / '+c['road'],'nativeFace':c['nativeFace']} for c in coverage['crossings'] if c['selectedRoute']]
points += [{'kind':'terrain_screening_candidate','name':f['properties']['route']+' chainage '+str(f['properties']['chainageM'])+'m','nativeFace':f['properties']['nativeFace']} for f in candidates['features']]
inverse={int(g.mesh2d_nFaces.values[k]):j for j,k in enumerate(ids)};point_summary=[]
with (r/'point-output-series.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['kind','name','native_face','time_utc','raw_volume_m3','full_cell_area_m2','volume_per_full_cell_area_m','water_surface_navd88_m'])
 for pnt in points:
  j=inverse[int(pnt['nativeFace'])]
  point_summary.append({**pnt,'areaM2':float(area[j]),'maxVolumePerFullCellAreaM':float(np.max(ratio[:,j])),'maxWaterSurfaceNAVD88M':float(np.max(zs[:,j]))})
  for k,time in enumerate(times):w.writerow([pnt['kind'],pnt['name'],pnt['nativeFace'],time,float(v[k,j]),float(area[j]),float(ratio[k,j]),float(zs[k,j])])
(r/'point-output-summary.json').write_text(json.dumps({'runId':a.run_id,'quantity':'Native water volume per full computational-cell area and absolute water surface; NOT road/deck depth or passability','points':point_summary},indent=2)+'\n')
