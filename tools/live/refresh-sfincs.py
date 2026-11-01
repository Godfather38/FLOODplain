"""Manual refresh chain using existing acquisition, HydroMT, solver and exporter. No scheduler."""
import argparse,json,subprocess,sys,datetime as dt
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('phase',choices=['acquire','assemble','run','publish']);p.add_argument('--inputs-repo',type=Path,required=True);p.add_argument('--solver-repo',type=Path,required=True);p.add_argument('--package',type=Path,required=True);p.add_argument('--registry',type=Path,required=True);p.add_argument('--model',type=Path);p.add_argument('--case',type=Path,required=True);p.add_argument('--binary',type=Path);p.add_argument('--config',type=Path);p.add_argument('--destination',type=Path,default=Path('public/simulation/data'));p.add_argument('--bounds',nargs=4,required=True);a=p.parse_args()
for name in ('inputs_repo','solver_repo','package','registry','model','case','binary','config','destination'):
 value=getattr(a,name)
 if value is not None:setattr(a,name,value.resolve())
run=lambda args,**kw:subprocess.run([str(x) for x in args],check=True,**kw)
if a.phase=='acquire':
 run([sys.executable,a.inputs_repo/'tools/simulation/build_current_inputs.py','--out',a.package,'--registry',a.registry,'--bounds',*a.bounds],cwd=a.inputs_repo)
 print('Forecast inputs acquired. Initialization rainfall/history must also cover the same interval; no zero fill. Assemble refuses absent inputs.')
elif a.phase=='assemble':
 if not a.model: p.error('--model required')
 run([sys.executable,a.solver_repo/'tools/sfincs/assemble_current_case.py','--model',a.model,'--package',a.package,'--registry',a.registry,'--output',a.case],cwd=a.solver_repo)
elif a.phase=='run':
 if not a.binary or not a.binary.is_file():p.error('--binary must name the retained SFINCS executable')
 meta=json.loads((a.case/'current-case.json').read_text());end=dt.datetime.fromisoformat(meta['end'].replace('Z','+00:00'))
 if end<=dt.datetime.now(dt.timezone.utc):raise ValueError('Prepared forecast is expired; refresh inputs before running')
 run([a.binary.resolve()],cwd=a.case)
else:
 if not a.config:p.error('--config required: actual case/export provenance, not a copied replay configuration')
 run([sys.executable,a.inputs_repo/'tools/simulation/publish_current_sfincs.py',a.case,'--config',a.config,'--destination',a.destination.resolve()])
 print('Immutable output written and current manifest switched last. Review before publishing the experimental branch. No upload/deployment performed.')
