"""Read immutable current inputs without rerunning acquisition or assigning hydrology."""
import datetime as dt,hashlib,json
from pathlib import Path
def load_current_inputs(directory):
 root=Path(directory);manifest=json.loads((root/'manifest.json').read_text())
 if manifest.get('kind')!='current_forcing_package':raise ValueError('Wrong package kind')
 for name,expected in manifest['files'].items():
  if Path(name).name!=name or hashlib.sha256((root/name).read_bytes()).hexdigest()!=expected:raise ValueError('Package file/hash mismatch: '+name)
 rain=json.loads((root/manifest['rainfallFile']).read_text());providers=json.loads((root/manifest['providerFile']).read_text());start=dt.datetime.fromisoformat(manifest['candidateWindow']['start'].replace('Z','+00:00'));end=dt.datetime.fromisoformat(manifest['candidateWindow']['end'].replace('Z','+00:00'))
 frames=[f for f in rain['frames'] if dt.datetime.fromisoformat(f['start'].replace('Z','+00:00'))>=start and dt.datetime.fromisoformat(f['end'].replace('Z','+00:00'))<=end]
 if not frames or frames[0]['start']!=manifest['candidateWindow']['start'] or frames[-1]['end']!=manifest['candidateWindow']['end']:raise ValueError('Rainfall does not cover the common window')
 previous=start
 for f in frames:
  a=dt.datetime.fromisoformat(f['start'].replace('Z','+00:00'));b=dt.datetime.fromisoformat(f['end'].replace('Z','+00:00'))
  if a!=previous or (b-a).total_seconds()!=3600:raise ValueError('Rainfall interval gap/overlap')
  if any(v is None for row in f['precipMS'] for v in row):raise ValueError('Missing rainfall is not zero')
  previous=b
 return {'manifest':manifest,'rainfall':{**rain,'frames':frames},'providers':providers,'modelReady':False,'reason':'Full inlet coverage/partition, physical inputs and initial state remain external dependencies; this loader does not invent them.'}
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('directory');a=p.parse_args();d=load_current_inputs(a.directory);print(json.dumps({'asOf':d['manifest']['asOf'],'window':d['manifest']['candidateWindow'],'rainfallHours':len(d['rainfall']['frames']),'candidateStations':[c['siteId'] for c in d['providers']['boundaryCandidates']],'modelReady':d['modelReady'],'reason':d['reason']},indent=2))
