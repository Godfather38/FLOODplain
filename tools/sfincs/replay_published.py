"""One-command retrieval or explicit replay of the published two-event SFINCS setup.

Requires Python and authenticated GitHub CLI. Uses existing Linux workflow and saved
engine; never compiles or launches an alternative model. Default retrieves results.
"""
import argparse,hashlib,json,re,shutil,subprocess
from datetime import datetime
from pathlib import Path
REPO='Godfather38/FLOODplain'
def gh(*args):
 return subprocess.check_output(['gh',*args,'--repo',REPO],text=True)
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--run',action='store_true',help='Explicitly execute both historical events; otherwise retrieve a completed run')
 p.add_argument('--from-run',default='41311500838',help='Completed workflow run to retrieve')
 p.add_argument('--branch',default='experiment/sfincs-engine')
 a=p.parse_args();base=Path(__file__).resolve().parents[2]
 run_id=a.from_run
 if a.run:
  runs=json.loads(gh('run','list','--workflow','sfincs.yml','--branch',a.branch,'--limit','20','--json','databaseId,status'))
  active=[r for r in runs if r['status']!='completed']
  if active:
   run_id=str(active[0]['databaseId']);print(f'Reusing active workflow {run_id}; no duplicate dispatched.',flush=True)
  else:
   response=gh('workflow','run','sfincs.yml','--ref',a.branch,'-f','engine_run_id=41290378239')
   match=re.search(r'/actions/runs/(\d+)',response)
   if not match:raise RuntimeError('Dispatch response did not identify run; check GitHub before retrying. '+response)
   run_id=match.group(1)
  print(f'https://github.com/{REPO}/actions/runs/{run_id}',flush=True)
  subprocess.run(['gh','run','watch',run_id,'--repo',REPO,'--exit-status','--interval','30'],check=True)
 info=json.loads(gh('run','view',run_id,'--json','conclusion,headSha,status'))
 if info['status']!='completed' or info['conclusion']!='success':raise RuntimeError('Run is not a completed successful export: '+json.dumps(info))
 cache=base/'.sfincs-runs'/('ci-'+run_id)
 if not cache.exists():gh('run','download',run_id,'--name','sfincs-verification','--dir',str(cache))
 result=cache/'app-results';result.mkdir(exist_ok=True)
 manifest={'schemaVersion':1,'solver':'SFINCS','runId':int(run_id),'inputCommit':info['headSha'],'engineBuildRun':41290378239,'operationalForecast':False,'conditioning':'Observed upstream discharge; historical replay, not an issued forecast','sampleSize':2,'generalPredictionUncertainty':None,'geometryTemporalLimitation':'2015 terrain and later estimated channel geometry; historical diagnostic only','cases':[]}
 for year in ['2013','2014']:
  source=cache/'runs'/('prefab-'+year);checks=json.loads((source/'checks.json').read_text());c=checks['comparison']
  if not checks['completed']:raise ValueError('Incomplete event: '+year)
  dest=result/year;dest.mkdir(exist_ok=True)
  for name in ['inundation.json.gz','checks.json','case.json','solver.log']:shutil.copy2(source/name,dest/name)
  item={'event':year,'path':f'{year}/inundation.json.gz','sha256':hashlib.sha256((dest/'inundation.json.gz').read_bytes()).hexdigest(),'peakErrorPercent':100*(c['modelPeakM3s']/c['observedPeakM3s']-1),'timingErrorMinutes':(datetime.fromisoformat(c['modelPeakTime'])-datetime.fromisoformat(c['observedPeakTime'])).total_seconds()/60,'peakM3s':c['modelPeakM3s'],'observedPeakM3s':c['observedPeakM3s'],'rainfallStatus':checks['rainfallStatus']}
  manifest['cases'].append(item)
 (result/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print(json.dumps({'manifest':str(result/'manifest.json'),'results':manifest['cases']},indent=2))
if __name__=='__main__':main()
