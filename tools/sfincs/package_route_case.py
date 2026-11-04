"""Label a finished native route case and commit it as hash-checked 40 MB parts for the saved-engine workflow."""
import argparse,hashlib,json,subprocess,sys
from pathlib import Path
sha=lambda b:hashlib.sha256(b).hexdigest()

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('case',type=Path);p.add_argument('output',type=Path);p.add_argument('--labels',type=Path,required=True,help='JSON merged into current-case.json (modelVersion, caseId, scope, ...)');a=p.parse_args()
 if a.output.exists():raise FileExistsError('Preserve versioned prepared case')
 labels=json.loads(a.labels.read_text());case=json.loads((a.case/'current-case.json').read_text());case.update(labels)
 case['nativeMeshSha256']=sha((a.case/'sfincs.nc').read_bytes());case['artifacts']=[{'path':f.name,'bytes':f.stat().st_size,'sha256':sha(f.read_bytes())} for f in sorted(a.case.iterdir()) if f.is_file() and f.name!='current-case.json']
 (a.case/'current-case.json').write_text(json.dumps(case,indent=2)+'\n',encoding='utf-8')
 archive=a.output.with_suffix('.tar.gz');subprocess.run([sys.executable,str(Path(__file__).with_name('package_current_case.py')),str(a.case),str(archive)],check=True)
 data=archive.read_bytes();a.output.mkdir(parents=True);parts=[]
 for i in range(0,len(data),40_000_000):
  chunk=data[i:i+40_000_000];name=f'case.part{i//40_000_000+1:02d}';(a.output/name).write_bytes(chunk);parts.append({'path':name,'bytes':len(chunk),'sha256':sha(chunk)})
 (a.output/'current-case.json').write_text(json.dumps(case,indent=2)+'\n',encoding='utf-8')
 manifest={'modelVersion':case['modelVersion'],'kind':'prepared_native_case','caseId':case['caseId'],'runReady':True,'solverExecuted':False,'approvedExecutionCapSeconds':case['approvedExecutionCapSeconds'],'archiveBytes':len(data),'archiveSha256':sha(data),'parts':parts,'forecastIssue':case['forecastIssue'],'start':case['start'],'end':case['end'],'gridCells':case['gridCells'],'inlets':case['inlets'],'scope':case.get('scope'),'executionAuthorization':case['executionAuthorization']}
 (a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8');archive.unlink();print(json.dumps({k:manifest[k] for k in ['modelVersion','archiveBytes','archiveSha256','gridCells','inlets']}|{'parts':len(parts)}))
if __name__=='__main__':main()
