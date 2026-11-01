"""Add bounded single-face native discharge observations; no hydraulic changes."""
import argparse,hashlib,json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer

def prepare(source,target,rivers):
 source,target=Path(source),Path(target)
 if target.exists():raise FileExistsError('Preserve prior case')
 case=json.loads((source/'case.json').read_text());target.mkdir(parents=True)
 for item in case['inputArtifacts']:
  data=(source/item['path']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Input changed')
  (target/item['path']).write_bytes(data)
 ny,nx=190,265;tx=Transformer.from_crs(4326,32612,always_xy=True)
 features=json.loads(Path(rivers).read_text())['features']
 # One native-cell-wide buffer around mapped river, plus full source/pocket box.
 geoms=[transform(tx.transform,shape(f['geometry'])).buffer(50) for f in features]
 corridor=np.flipud(rasterize([(g,1) for g in geoms],out_shape=(ny,nx),transform=from_origin(467000,3596000,100,100))).astype(bool)
 x,y=np.meshgrid(467050+np.arange(nx)*100,3577050+np.arange(ny)*100)
 pocket=(x>=490000)&(x<=491500)&(y>=3579000)&(y<=3581500)
 cells=corridor|pocket;faces=set()
 for r,c in zip(*np.where(cells)):
  if c<nx-1:faces.add(('u',int(r),int(c)))
  if c>0:faces.add(('u',int(r),int(c-1)))
  if r<ny-1:faces.add(('v',int(r),int(c)))
  if r>0:faces.add(('v',int(r-1),int(c)))
 if len(faces)>3500:raise ValueError('Diagnostic output exceeds bounded face count')
 sections=case['sections'];meta=[]
 for axis,r,c in sorted(faces):
  name=f'face_{axis}_{r}_{c}';xx=float(x[r,c]);yy=float(y[r,c])
  # 2m observation segments cross exactly one native cell-centre connection.
  # Native routine returns whole-face q*face_width, not a 2m-wide partial flow.
  if axis=='u':xx+=50;points=[(xx,yy+1),(xx,yy-1)]
  else:yy+=50;points=[(xx-1,yy),(xx+1,yy)]
  sections[name]=points;meta.append({'name':name,'axis':axis,'row':r,'column':c,'x':xx,'y':yy,'positiveDirection':'east' if axis=='u' else 'north'})
 with (target/'sections.crs').open('w',newline='\n') as out:
  for name,points in sections.items():
   out.write(name+'\n2 2\n')
   for a,b in points:out.write(f'{a:.3f} {b:.3f}\n')
 case['faceDiagnostic']={'referenceRun':41297523344,'referenceCommit':'38d9a2f','nativeMethod':'sfincs_crosssections.get_discharges_through_crosssections: q(indx)*crs_idir*dxycrs','physicsChanged':False,'selectedFaces':len(faces),'riverBufferM':50,'pocketBox':[490000,3579000,491500,3581500],'samplingSeconds':60,'note':'Observation geometry only; 50m buffer selects outputs, does not alter river geometry; instantaneous native face flows, not time-integrated solver accumulators'}
 for item in case['inputArtifacts']:
  if item['path']=='sections.crs':item['sha256']=hashlib.sha256((target/'sections.crs').read_bytes()).hexdigest()
 (target/'case.json').write_text(json.dumps(case,indent=2)+'\n');(target/'face-observations.json').write_text(json.dumps(meta,indent=2)+'\n')
 print(json.dumps(case['faceDiagnostic']))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('source');p.add_argument('target');p.add_argument('--rivers',required=True);a=p.parse_args();prepare(**vars(a))
