"""Two native synthetic runs, <=150 seconds each; preserve all signed output."""
import hashlib,json,os,subprocess,sys,tarfile,time
from pathlib import Path
import h5py,numpy as np
fixture,engine,out=map(Path,sys.argv[1:]);engine=engine.resolve();out.mkdir(parents=True,exist_ok=False)
assert hashlib.sha256(engine.read_bytes()).hexdigest()=='c4917bc54158b0943d6d128b45c4346a33d059fb5d93808d05520c975e38f090'
meta=json.loads(fixture.with_name('fixture.json').read_text()); assert hashlib.sha256(fixture.read_bytes()).hexdigest()==meta['archiveSha256']
results=[]
for alpha in (.5,.25):
 work=out/str(alpha);work.mkdir()
 with tarfile.open(fixture) as t:t.extractall(work,filter='data')
 p=work/'sfincs.inp';lines=p.read_text().splitlines();matches=[i for i,l in enumerate(lines) if '=' in l and l.split('=',1)[0].strip()=='alpha'];assert len(matches)==1
 lines[matches[0]]=f'alpha = {alpha}';p.write_text('\n'.join(lines)+'\n')
 start=time.monotonic()
 with (work/'solver.log').open('w') as log:
  try:r=subprocess.run([str(engine)],cwd=work,env=dict(os.environ,OMP_NUM_THREADS='1'),stdout=log,stderr=subprocess.STDOUT,timeout=150,check=False)
  except subprocess.TimeoutExpired:raise RuntimeError('150-second native cap reached; no correctness claim')
 assert r.returncode==0 and 'Simulation finished' in (work/'solver.log').read_text()
 with h5py.File(work/'sfincs_map.nc') as f:
  assert len(f['time'])==241, 'Incomplete four-hour output'; assert np.all(f['status'][()]==0), 'Native status failure'
  v=f['subgrid_volume'][:];valid=np.isfinite(v)&(v!=-99999);assert valid.any();assert (v[valid]>0).any(),'Wet control failed'
  results.append({'alpha':alpha,'elapsedSeconds':time.monotonic()-start,'negativeSamples':int((valid&(v<0)).sum()),'minimumVolumeM3':float(v[valid].min()),'maximumVolumeM3':float(v[valid].max()),'frames':len(f['time']),'status':[int(x) for x in np.ravel(f['status'][()])]})
 (out/'result.json').write_text(json.dumps({'syntheticNotForecast':True,'solverCapSecondsPerRun':150,'threads':1,'results':results},indent=2))
print(json.dumps(results))

