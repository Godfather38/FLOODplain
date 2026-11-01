"""Archive an assembled native current case for the existing saved-engine runner."""
import argparse,tarfile,json
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('case',type=Path);p.add_argument('archive',type=Path);a=p.parse_args()
if a.archive.exists():raise FileExistsError('Preserve versioned case archive')
required=['sfincs.inp','sfincs.dis','sfincs.src','sfincs.ind','sfincs.msk','sfincs.scs','sfincs_subgrid.nc','precip_2d.nc','current-case.json','GCN10-NOTICE.txt','GCN10-source-metadata.xml']
for name in required:
 if not (a.case/name).is_file():raise FileNotFoundError(name)
a.archive.parent.mkdir(parents=True,exist_ok=True)
with tarfile.open(a.archive,'w:gz') as tf:
 for name in required:tf.add(a.case/name,arcname=name)
print(json.dumps({'archive':str(a.archive),'bytes':a.archive.stat().st_size,'solverExecuted':False}))
