"""Package already completed native output with the retained, unchanged exporters."""
import sys,json,hashlib,subprocess,tarfile,shutil
from pathlib import Path
root=Path(__file__).parent
repo=Path('H:/AI/Projects/FloodPLAIN-sfincs')
run_id=sys.argv[1]
base=root/'approved-results'/run_id
native=base/'artifact/runs/current'
inspection=base/'inspection'
summary=json.loads((inspection/'result-summary.json').read_text())
case=json.loads((native/'current-case.json').read_text())
partial = summary['completion']['assessment']!='complete_to_requested_end'
proof_path=base/'partial-proof.json'
if partial:
    proof=json.loads(proof_path.read_text())
    if proof['status']!='partial_budget_timeout' or proof['exitCode']!=124:
        raise SystemExit('Verified timeout proof required for a partial export')
destination=base/'publication'
destination.mkdir(exist_ok=False)
sha=lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
for p in inspection.iterdir():
    if p.is_file():shutil.copyfile(p,destination/p.name)
for name in ['current-case.json','solver.log','sfincs.log','execution-started.txt','GCN10-NOTICE.txt','GCN10-source-metadata.xml']:
    shutil.copyfile(native/name,destination/name)
exporters=repo/'tools/sfincs/data/silverbell-result-41370039087/reproduce'
config=json.loads((exporters.parent/'export-config.local.json').read_text())
config.update(runId=case['modelVersion']+'-'+run_id,meshFile=str(native/'sfincs.nc'),mapFile=str(native/'sfincs_map.nc'),logFile=str(native/'solver.log'),validFrom=summary['timeCoverage']['recordedValidFrom'],validTo=summary['timeCoverage']['recordedValidTo'])
config['faceMapping']={'path':str(inspection/'output-to-source-face-id.npy'),'sha256':sha(inspection/'output-to-source-face-id.npy')}
if partial:
    config['partialProof']={'path':str(proof_path),'sha256':sha(proof_path)}
    shutil.copyfile(proof_path,destination/'partial-proof.json')
    shutil.copyfile(root/'picture-rocks-workflow-failure.log',destination/'workflow-failure.log')
config['negativeVolumeToleranceM3']=max(0,-summary['rawVolumeRangeM3'][0])
config['assumptions']=[
 'Frozen NWM 2026-11-01 13Z and HRRR 14Z inputs; not automatically current.',
 'Native signed volumes and NAVD88 water surfaces are preserved exactly. Volume/full cell area is not validated road depth or wet extent.',
 'The legacy JSON display clamps negative storage to zero; its declared bound is the observed minimum, not a validated numerical-error tolerance. Compact native columns retain every signed value.',
 '6.25 m road computational cells; source terrain sampling does not constitute an independent 1 m flow solution.',
 'Missing bridge/culvert geometry and initial-state assumptions remain explicit; no confidence interval established.',
 'Supported Gates excludes 59 tracked memberships; do not extrapolate beyond native geometry.' if 'gates' in case['modelVersion'] else 'See route-point-summary.json for independently located coverage.'
]
config['inputArtifacts']=[{'path':str(p),'sha256':sha(p)} for p in [native/'sfincs.nc',inspection/'output-to-source-face-id.npy',native/'GCN10-NOTICE.txt',native/'GCN10-source-metadata.xml']]
config_path=destination/'export-config.local.json'
config_path.write_text(json.dumps(config,indent=2))
subprocess.run([sys.executable,str(exporters/'export_quadtree_output.py'),'--config',str(config_path),'--destination',str(base/'expanded-export')],check=True)
subprocess.run([sys.executable,str(exporters/'compact_quadtree.py'),str(base/'expanded-export'),str(destination/'compact')],check=True)
archive=base/'native-output.tar.gz'
names=['sfincs_map.nc','sfincs.nc','solver.log','sfincs.log','current-case.json','execution-started.txt','GCN10-NOTICE.txt','GCN10-source-metadata.xml']+[p.name for p in sorted(native.glob('*.rst'))]
with tarfile.open(archive,'w:gz',compresslevel=3) as tf:
    for name in names:tf.add(native/name,arcname=name)
parts=[]
with archive.open('rb') as f:
    i=0
    while data:=f.read(64*1024*1024):
        p=destination/f'native-output.tar.gz.part{i:02d}';p.write_bytes(data)
        parts.append({'path':p.name,'bytes':len(data),'sha256':sha(p)});i+=1
manifest={'runId':run_id,'runUrl':f'https://github.com/Godfather38/FLOODplain/actions/runs/{run_id}','modelVersion':case['modelVersion'],'executionCommit':'3dbf2d44315fc384a4df9810fe79686f67c27d36','status':'partial_budget_timeout' if partial else 'completed_full_interval','nativeRuntimeSeconds':summary.get('total_runtime'),'executionMode':'simulated_live_frozen_inputs','archiveSha256':sha(archive),'archiveBytes':archive.stat().st_size,'parts':parts,'archiveContents':names,'reassembly':'Concatenate parts in order and extract. Unchanged forcing/subgrid inputs remain in the referenced prepared archive.','nativeInputs':f'../all-route-ready-v3/{case["caseId"]}/manifest.json','pointSummary':'route-point-summary.json','pointSeries':'route-point-series.csv','compact':'compact/manifest.json','resultSummary':'result-summary.json','sourceMeshSha256':summary['hashes']['sfincs.nc'],'sourceMapSha256':summary['hashes']['sfincs_map.nc'],'restartLimitation':summary['restartLimitation'],'fullGatesCoverage':case.get('fullGatesCoverage')}
(destination/'native-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'runId':run_id,'publication':str(destination),'archiveBytes':archive.stat().st_size,'frames':summary['timeCoverage']['framesRecorded']}),flush=True)
