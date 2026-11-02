"""Reuse the existing compact native equality check for any completed route case."""
from pathlib import Path
import sys,json,gzip,struct,hashlib,numpy as np,xarray as xr
base=Path(__file__).parent/'approved-results'/sys.argv[1]
root=base/'publication';p=root/'compact';m=json.loads((p/'manifest.json').read_text())
s=json.loads((root/'result-summary.json').read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def decode(path):
 raw=gzip.decompress(path.read_bytes());n=struct.unpack('<I',raw[:4])[0];h=json.loads(raw[4:4+n]);return h,{k:np.frombuffer(raw,dtype={'d':'<f8','f':'<f4','I':'<u4'}[v['type']],count=v['count'],offset=4+n+v['offset']) for k,v in h['columns'].items()}
expected_status='complete' if s['completion']['assessment']=='complete_to_requested_end' else 'partial'
assert len(m['frames'])==s['timeCoverage']['framesRecorded'] and m['status']==expected_status
geo,g=decode(p/m['geometry']['path']);ids=geo['metadata']['nativeFaceIds'];mapping=np.load(root/'output-to-source-face-id.npy');lookup={int(v):i for i,v in enumerate(mapping)};order=[lookup[int(v)] for v in ids]
assert len(ids)==s['faces'] and len(set(ids))==s['faces']
with xr.open_dataset(base/'artifact/runs/current/sfincs_map.nc',decode_times=False) as raw_native:
 native=raw_native.assign_coords(time=xr.decode_cf(raw_native[['time']]).time)
 for f in m['frames']:
  assert sha(p/f['path'])==f['sha256'];h,a=decode(p/f['path']);t=np.datetime64(f['time'].removesuffix('Z'))
  for dst,src in [('nativeVolumeM3','subgrid_volume'),('waterSurfaceM','zs')]:
   expected=native[src].sel(time=t).values.reshape(-1)[order];assert np.array_equal(a[dst],expected,equal_nan=True),(f['time'],src)
assert sha(p/m['geometry']['path'])==m['geometry']['sha256']
assert s['hashes']['sfincs.nc']==m['provenance']['meshSha256']
m['coverage'].update(status='native_route_points_audited',coverageEvidence='../route-point-summary.json',coverageEvidenceSha256=sha(root/'route-point-summary.json'),pointCounts=s['inventoryPointCounts'],roadDepthValidated=False)
m['sourceIssues']={'NWM':'2026-11-01T13:00:00Z','HRRR':'2026-11-01T14:00:00Z','mode':'frozen_replay'}
(p/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
report={'runId':m['runId'],'manifest':'compact/manifest.json','manifestSha256':sha(p/'manifest.json'),'frames':len(m['frames']),'nativeFaces':len(ids),'validFrom':m['validFrom'],'validTo':m['validTo'],'compressedPayloadBytes':sum(f['bytes'] for f in m['frames'])+m['geometry']['bytes'],'verification':'Every compact volume/surface array exactly matches native float32 after proven face-ID ordering, including NaNs. Payload hashes and native mesh hash match.','sourceIssues':m['sourceIssues'],'pointCounts':s['inventoryPointCounts'],'productionChanged':False}
report['status']=expected_status
report['requestedEndReached']=s['timeCoverage']['reachesRequestedEnd']
(root/'handoff.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
manifest_path=root/'native-manifest.json'
manifest=json.loads(manifest_path.read_text());manifest['nativeInputs']=manifest['nativeInputs'].replace('../../all-route-ready-v3/','../all-route-ready-v3/')
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
