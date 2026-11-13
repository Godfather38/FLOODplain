import json,hashlib,time
from pathlib import Path
import numpy as np
from export_road_forecast import RoadForecast,read_columns
from native_dry_residuals import load_evidence,SOURCE_COMMIT
root=Path(__file__).resolve().parents[2];folder=root/'.sfincs-runs/audit-picture-rocks-dfe68555';m=json.loads((folder/'manifest.json').read_text());c=next(c for c in json.load(open(root/'tools/live/all-route-cases.json'))['cases'] if c['case']=='picture-rocks');order=np.argsort(np.load(root/c['faceMapping']['path']))
rf=RoadForecast.load('picture-rocks',folder/m['geometry']['path'],m['geometry']['sha256']);rf.native_dry_evidence=load_evidence(root/'.sfincs-runs/pr-20z-forcing-reconstruction',order,'picture-rocks',m['solverCompletion']['status']=='complete' and m['solverCompletion']['nativeStatus']==[0],SOURCE_COMMIT);assert rf.native_dry_evidence is not None
before={f['path']:hashlib.sha256((folder/f['path']).read_bytes()).hexdigest() for f in m['frames']}
for f in m['frames']:
 h,col=read_columns(folder/f['path'],'floodplain-columns-v1',f['sha256']);rf.add_frame(f['time'],col['nativeVolumeM3'],col['waterSurfaceM'])
out=root/'.sfincs-runs/native-dry-interpretation-validation';out.mkdir(exist_ok=True);rf.write(out/'road-forecast.json',m)
assert before=={f['path']:hashlib.sha256((folder/f['path']).read_bytes()).hexdigest() for f in m['frames']}
r={'sourceRunId':m['runId'],'policy':rf.native_dry_evidence.provenance,'interpretedStationFrames':rf.residual_station_samples,'minimumInterpretedDepthM':rf.minimum_interpreted_depth_m,'rawFramesUnchanged':True,'routes':{k:{'totalStations':v['totalStations'],'minimumValidStations':min(f['validStations'] for f in v['frames']),'allFramesComplete':all(f['coverage']=='complete' for f in v['frames']),'interpretedStationFrames':sum(f['nativeDryResidualStations'] for f in v['frames'])} for k,v in rf.routes.items()}}
(root/'docs/native-dry-real-validation.json').write_text(json.dumps(r,indent=2));print(json.dumps(r))
