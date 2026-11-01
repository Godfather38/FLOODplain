"""Controlled source alignment to the independently mapped river; no channel edits."""
import argparse,hashlib,json,math
from pathlib import Path
import xarray as xr

def prepare(source,target):
 source,target=Path(source),Path(target)
 if target.exists():raise FileExistsError('Preserve prior case')
 case=json.loads((source/'case.json').read_text());target.mkdir(parents=True)
 for item in case['inputArtifacts']:
  data=(source/item['path']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Reference input changed')
  (target/item['path']).write_bytes(data)
 x,y=491030.431,3579398.680
 old=case['upstream'].copy();assert (old['cellRow'],old['cellColumn'])==(23,239)
 (target/'sfincs.src').write_text(f'{x:.3f} {y:.3f}\n')
 case['upstream'].update({'x':x,'y':y,'cellRow':23,'cellColumn':240,'cellCenterDistanceM':math.hypot(x-491050,y-3579350),
  'placement':{'method':'Nearest point on official USGS NLDI river path; NOAA independent path agrees on same adjacent cell','shiftM':math.hypot(x-old['x'],y-old['y']),'originalGaugeX':old['x'],'originalGaugeY':old['y'],'actualGaugeLongitude':old['lon'],'actualGaugeLatitude':old['lat'],'sourceUrl':'https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-09486500/navigation/DM/flowlines?distance=35','NOAANearestPoint':[491034.1654894415,3579392.97738971],'selectedWithoutTargetFitting':True}})
 with xr.open_dataset(target/'sfincs_subgrid.nc') as sg:case['upstream']['cellBedM']=float(sg.z_zmin.values.reshape((190,265),order='F')[23,240])
 case['upstream']['cellBedDefinition']='Native subgrid minimum, not original coarse terrain mean'
 sections=case['sections'];sections.update({'pocket_west':[(490000,3579000),(490000,3581500)],'pocket_north':[(490000,3581500),(491500,3581500)],'pocket_east':[(491500,3581500),(491500,3579000)],'pocket_south':[(491500,3579000),(490000,3579000)]})
 with (target/'sections.crs').open('w',newline='\n') as out:
  for name,points in sections.items():
   out.write(name+'\n2 2\n')
   for a,b in points:out.write(f'{a:.3f} {b:.3f}\n')
 changed=[]
 for item in case['inputArtifacts']:
  value=hashlib.sha256((target/item['path']).read_bytes()).hexdigest()
  if value!=item['sha256']:changed.append(item['path']);item['sha256']=value
 assert set(changed)=={'sfincs.src','sections.crs'}
 case['placementComparison']={'referenceRun':41297523344,'hydraulicChange':'source location only, one adjacent cell','additionalChange':'four observation-only enclosing pocket sections','geometryAndParametersUnchanged':True,'changedNativeFiles':changed,'sourceCellBefore':[23,239],'sourceCellAfter':[23,240]}
 case['validationRole']='Controlled independently mapped source-placement comparison after failed 2013 scenario; not held-out validation'
 case['limitations']=[s.replace('Cortaro discharge enters its containing grid cell without prescribed velocity distribution','Observed Cortaro discharge enters the adjacent independently mapped river cell; actual gauge coordinates retained; unresolved velocity distribution') for s in case['limitations']]
 (target/'case.json').write_text(json.dumps(case,indent=2)+'\n');print(json.dumps(case['placementComparison']))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('source');p.add_argument('target');a=p.parse_args();prepare(**vars(a))
