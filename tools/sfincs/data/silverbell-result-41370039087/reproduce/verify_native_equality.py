from pathlib import Path
import json,gzip,struct,hashlib,numpy as np,xarray as xr
root=Path('tools/sfincs/data/silverbell-result-41370039087');p=root/'compact';m=json.loads((p/'manifest.json').read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def decode(path):
 raw=gzip.decompress(path.read_bytes());n=struct.unpack('<I',raw[:4])[0];h=json.loads(raw[4:4+n]);return h,{k:np.frombuffer(raw,dtype={'d':'<f8','f':'<f4','I':'<u4'}[v['type']],count=v['count'],offset=4+n+v['offset']) for k,v in h['columns'].items()}
assert len(m['frames'])==57 and m['status']=='complete'
geo,g=decode(p/m['geometry']['path']);ids=geo['metadata']['nativeFaceIds'];mapping=np.load(root/'output-to-source-face-id.npy');lookup={int(v):i for i,v in enumerate(mapping)};order=[lookup[int(v)] for v in ids]
assert len(ids)==480227 and len(set(ids))==480227
native=xr.open_dataset('.sfincs-runs/silverbell-result-41370039087/artifact/runs/current/sfincs_map.nc')
for f in m['frames']:
 assert sha(p/f['path'])==f['sha256'];h,a=decode(p/f['path']);t=np.datetime64(f['time'].removesuffix('Z'))
 for dst,src in [('nativeVolumeM3','subgrid_volume'),('waterSurfaceM','zs')]:
  expected=native[src].sel(time=t).values.reshape(-1)[order];assert np.array_equal(a[dst],expected,equal_nan=True),(f['time'],src)
assert sha(p/m['geometry']['path'])==m['geometry']['sha256']
c=json.loads((root/'prepared-coverage.json').read_text());assert c['nativeMeshSha256']==m['provenance']['meshSha256']
m['coverage'].update({'status':'audited_silverbell_road','crossingRegistry':None,'coverageEvidence':'../prepared-coverage.json','coverageEvidenceSha256':sha(root/'prepared-coverage.json'),'terrainCandidateRegistry':'../terrain-low-point-candidates.geojson','terrainCandidateRegistrySha256':sha(root/'terrain-low-point-candidates.geojson'),'roadDepthValidated':False})
m['sourceIssues']={'NWM':'2026-11-01T13:00:00Z','HRRR':'2026-11-01T14:00:00Z','mode':'frozen_replay'}
(p/'manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8')
report={'runId':m['runId'],'manifest':'compact/manifest.json','manifestSha256':sha(p/'manifest.json'),'frames':57,'nativeFaces':len(ids),'validFrom':m['validFrom'],'validTo':m['validTo'],'compressedPayloadBytes':sum(f['bytes'] for f in m['frames'])+m['geometry']['bytes'],'verification':'All57 compact volume/surface arrays exactly match native float32 values after proven face-ID ordering, including NaNs; all payload hashes match; coverage native-mesh hash matches.','sourceIssues':m['sourceIssues'],'exporters':{x.name:sha(x) for x in (root/'reproduce').glob('*.py')},'productionChanged':False}
(root/'handoff.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
