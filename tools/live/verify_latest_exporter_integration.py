import sys,json,tarfile,os,hashlib,datetime as dt
from pathlib import Path
import h5py,numpy as np
root=Path.cwd();sys.path.insert(0,str(root/'tools/live'))
from export_road_forecast import read_columns
from run_live_all_route import export
base=root/'.sfincs-runs/latest-exporter-integration';work=base/'work';work.mkdir(parents=True,exist_ok=True);engine=base/'engine';engine.mkdir(exist_ok=True)
with tarfile.open('H:/AI/Projects/FloodPLAIN-sfincs/.sfincs-runs/engine-41290378239/sfincs-engine.tar.gz') as t:
 for member in t:
  if Path(member.name).name in ('sfincs','SOURCE_COMMIT'):(engine/Path(member.name).name).write_bytes(t.extractfile(member).read())
physical=root/'.sfincs-runs/pr-20z-forcing-reconstruction'
for name in ('sfincs.nc','sfincs_subgrid.nc'):
 if not (work/name).exists():os.link(physical/name,work/name)
(work/'sfincs.inp').write_bytes((physical/'sfincs.inp').read_bytes())
logs=root/'.sfincs-runs/latest-pr-logs-43523529191/work'
for name in ('solver.log','live-case.json'):(work/name).write_bytes((logs/name).read_bytes())
folder=root/'.sfincs-runs/latest-pr-17c34e29';m=json.loads((folder/'manifest.json').read_text());start=dt.datetime.fromisoformat(m['frames'][0]['time'].replace('Z','+00:00'))
# Integration reconstruction from published native columns, not original raw
# NetCDF and not a newly executed forecast. Preserve all signed numeric samples.
with h5py.File(work/'sfincs_map.nc','w') as f:
 ts=f.create_dataset('time',data=[(dt.datetime.fromisoformat(x['time'].replace('Z','+00:00'))-start).total_seconds() for x in m['frames']]);ts.attrs['units']='seconds since '+start.strftime('%Y-%m-%d %H:%M:%S')
 for name in ('subgrid_volume','zs'):f.create_dataset(name,shape=(43,537476),dtype='f4',compression='gzip',compression_opts=1)
 for i,desc in enumerate(m['frames']):
  h,c=read_columns(folder/desc['path'],'floodplain-columns-v1',desc['sha256']);f['subgrid_volume'][i]=c['nativeVolumeM3'];f['zs'][i]=c['waterSurfaceM']
 f['status']=m['solverCompletion']['nativeStatus'];f['total_runtime']=[m['solverCompletion']['nativeRuntimeSeconds']]
export('picture-rocks',work,base/'out',m['runId'])
out=base/'out';mm=json.loads((out/'manifest.json').read_text());s=json.loads((out/'road-forecast.json').read_text());mm['issuedAt']=s['issuedAt']=m['issuedAt'];s['provenance']['offlineIntegrationReplay']=True
raw=(json.dumps(s,separators=(',',':'))+'\n').encode();(out/'road-forecast.json').write_bytes(raw);mm['roadForecast'].update(sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw));(out/'manifest.json').write_text(json.dumps(mm,indent=1))
for original,new in zip(m['frames'],mm['frames']):
 _,a=read_columns(folder/original['path'],'floodplain-columns-v1',original['sha256']);_,b=read_columns(out/new['path'],'floodplain-columns-v1',new['sha256'])
 for key in a:np.testing.assert_array_equal(a[key],b[key])
print('FULL EXPORT PASS; raw columns unchanged; original issue retained; accepted',s['provenance']['nativeDryResidualInterpretation']['stationFrameSamples'])
