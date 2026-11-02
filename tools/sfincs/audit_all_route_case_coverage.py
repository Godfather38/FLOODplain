"""Record exact prepared native cell containment; never promote preparation to model results."""
import json,hashlib
from pathlib import Path
import numpy as np,xugrid as xu,geopandas as gpd
from pyproj import Transformer
root=Path('tools/sfincs/data/all-routes-extension-v1');ledger=json.loads((root/'inventory/coverage-ledger.json').read_text());rows=[v for k in ['entries','officialRoadJunctions','terrainMinimumCandidates'] for v in ledger[k]];tr=Transformer.from_crs(4326,32612,always_xy=True);xy=np.array([tr.transform(*r['coordinates']) for r in rows]);out=[]
for name in ['northern','picture-rocks-ina-twinpeaks','gates']:
 path=Path('.sfincs-runs')/('all-routes-'+name+'-mesh-v2')/'active-refinement-mesh.nc';grid=xu.open_dataset(path).load();ids=grid.grid.locate_points(xy);levels=grid['level'].values;mask=grid['mask'].values;registry=json.loads((root/'cases-connected-v2'/name/'boundary-registry.json').read_text());cases=[]
 for r,i in zip(rows,ids):
  owned=bool(set(r['routeIds'])&set(registry['routeIds']));active=i>=0 and mask[i]>0
  if owned:cases.append({'id':r['canonicalId'],'routeIds':r['routeIds'],'active':bool(active),'nativeFaceId':int(i) if active else None,'cellSizeM':float(100/2**(int(levels[i])-1)) if active else None,'status':'geometry_prepared_not_simulated','roadDepthValidated':False})
 out.append({'case':name,'meshSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'entries':cases,'ownedEvidenceCount':len(cases),'outsideActive':sum(not r['active'] for r in cases),'coarserThan6_25m':sum(r['active'] and r['cellSizeM']>6.25 for r in cases)})
 grid.close();del grid
(root/'prepared-location-coverage.json').write_text(json.dumps({'schemaVersion':1,'solverExecuted':False,'cases':out},indent=2),encoding='utf-8')
print(json.dumps([{k:c[k] for k in ['case','ownedEvidenceCount','outsideActive','coarserThan6_25m']} for c in out]))
