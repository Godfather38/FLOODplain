"""Apply one prebuilt official channel setup to preserved event inputs without recompiling."""
import argparse,hashlib,json,math
from pathlib import Path
import xarray as xr
def stage(source,target,geometry):
 source,target,geometry=map(Path,(source,target,geometry))
 if target.exists():raise FileExistsError(target)
 case=json.loads((source/'case.json').read_text());meta=json.loads((geometry/'preparation.json').read_text())
 target.mkdir(parents=True)
 for item in case['inputArtifacts']:
  raw=(source/item['path']).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=item['sha256']:raise ValueError('Baseline input hash mismatch: '+item['path'])
  (target/item['path']).write_bytes(raw)
 raw=(geometry/'sfincs_subgrid.nc').read_bytes()
 if hashlib.sha256(raw).hexdigest()!=meta['subgridSha256']:raise ValueError('Prepared channel hash mismatch')
 (target/'sfincs_subgrid.nc').write_bytes(raw)
 (target/'sfincs.src').write_text('491030.431 3579398.680\n')
 with xr.open_dataset(target/'sfincs_subgrid.nc') as s:bed=float(s.z_zmin.values[240*190+23])
 original=[case['upstream']['x'],case['upstream']['y']]
 case['upstream'].update({'originalGaugeXY':original,'x':491030.431,'y':3579398.680,'cellRow':23,'cellColumn':240,'cellBedM':bed,'cellCenterDistanceM':math.hypot(491030.431-491050,3579398.680-3579350),'modelInjectionXY':[491030.431,3579398.680],'placement':{'method':'Independent USGS NLDI nearest river point; same position in both events','shiftM':math.hypot(491030.431-original[0],3579398.680-original[1])}})
 case['prefabChannelIntegration']=meta
 case['geometryIntegration']['channelBurning']=True
 case['geometryIntegration']['publishedEstimatedChannel']=meta
 case['validationRole']='Published estimated-channel setup evaluation after prior failures; not blind validation'
 case['limitations']+=meta['limitations']
 case['inputArtifacts']=[{'path':i['path'],'sha256':hashlib.sha256((target/i['path']).read_bytes()).hexdigest()} for i in case['inputArtifacts']]
 case['prefabChangedNativeFiles']=['sfincs_subgrid.nc','sfincs.src']
 (target/'case.json').write_text(json.dumps(case,indent=2)+'\n')
 print(json.dumps({'case':str(target),'start':case['start'],'end':case['end'],'sourceBedM':bed,'changed':case['prefabChangedNativeFiles']}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('target');p.add_argument('--geometry',default='tools/sfincs/data/prefab-channel');a=p.parse_args();stage(**vars(a))
