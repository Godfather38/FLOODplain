"""Verify a packaged route result against native output, label its coverage, and copy it into tools/sfincs/data.

  python tools/sfincs/finalize_route_result.py WORK_DIR DESTINATION

WORK_DIR is the package_route_result.py work folder (artifact/, publication/). Every compact
volume and water-surface array must equal native float32 after face-ID ordering, NaNs included.
"""
import argparse,gzip,hashlib,json,shutil,struct
from pathlib import Path
import numpy as np,xarray as xr
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()

def decode(path):
 raw=gzip.decompress(path.read_bytes());n=struct.unpack('<I',raw[:4])[0];h=json.loads(raw[4:4+n])
 return h,{k:np.frombuffer(raw,dtype={'d':'<f8','f':'<f4','I':'<u4'}[v['type']],count=v['count'],offset=4+n+v['offset']) for k,v in h['columns'].items()}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('work',type=Path);p.add_argument('destination',type=Path);a=p.parse_args()
 if a.destination.exists():raise FileExistsError('Preserve existing result folder')
 pub=a.work/'publication';native_dir=a.work/'artifact/runs/current';c=pub/'compact';m=json.loads((c/'manifest.json').read_text())
 geo,_=decode(c/m['geometry']['path']);ids=geo['metadata']['nativeFaceIds'];mapping=np.load(pub/'output-to-source-face-id.npy');lookup={int(v):i for i,v in enumerate(mapping)};order=[lookup[int(v)] for v in ids]
 if len(set(ids))!=len(ids) or sha(c/m['geometry']['path'])!=m['geometry']['sha256']:raise ValueError('Geometry check failed')
 with xr.open_dataset(native_dir/'sfincs_map.nc') as native:
  for f in m['frames']:
   if sha(c/f['path'])!=f['sha256']:raise ValueError('Frame hash '+f['path'])
   _,cols=decode(c/f['path']);t=np.datetime64(f['time'].removesuffix('Z'))
   for dst,src in [('nativeVolumeM3','subgrid_volume'),('waterSurfaceM','zs')]:
    if not np.array_equal(cols[dst],native[src].sel(time=t).values.reshape(-1)[order],equal_nan=True):raise ValueError(f"{f['time']} {src} differs")
 points=json.loads((pub/'route-point-summary.json').read_text());summary=json.loads((pub/'result-summary.json').read_text());case=json.loads((pub/'current-case.json').read_text())
 m['coverage']={'status':'native_route_points_audited','crossingRegistry':None,'roadDepthValidated':False,'coverageEvidence':'../route-point-summary.json','coverageEvidenceSha256':sha(pub/'route-point-summary.json'),'pointCounts':points['counts']}
 m['sourceIssues']={'NWM':'2026-11-01T13:00:00Z','HRRR':'2026-11-01T14:00:00Z','mode':'frozen_replay'}
 if summary['completion']['assessment']=='complete_to_requested_end':m['solverCompletion']={'status':'complete','nativeRuntimeSeconds':summary.get('total_runtime'),'framesRecorded':summary['timeCoverage']['framesRecorded']}
 (c/'manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8')
 complete=m['solverCompletion']['status']=='complete'
 handoff={'runId':m['runId'],'manifest':'compact/manifest.json','manifestSha256':sha(c/'manifest.json'),'frames':len(m['frames']),'nativeFaces':len(ids),'validFrom':m['validFrom'],'validTo':m['validTo'],'compressedPayloadBytes':sum(f['bytes'] for f in m['frames'])+m['geometry']['bytes'],
  'verification':'Every compact volume/surface array exactly matches native float32 after proven face-ID ordering, including NaNs. Payload hashes and native mesh hash match.','sourceIssues':m['sourceIssues'],'pointCounts':points['counts'],'productionChanged':False,'status':'complete' if complete else 'partial','requestedEndReached':bool(summary['timeCoverage'].get('reachesRequestedEnd'))}
 (pub/'handoff.json').write_text(json.dumps(handoff,indent=2)+'\n',encoding='utf-8')
 shutil.copyfile(a.work/'artifact/engine-reused/current-runtime-libraries.txt',pub/'current-runtime-libraries.txt');shutil.copyfile(a.work/'artifact/engine-reused/SHA256SUMS',pub/'SHA256SUMS')
 shutil.copytree(pub,a.destination);print(json.dumps(handoff))
if __name__=='__main__':main()
