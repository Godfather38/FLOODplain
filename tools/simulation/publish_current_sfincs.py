"""Publish native SFINCS volume output to the existing current app contract; no solver or observations required."""
import argparse,datetime as dt,gzip,hashlib,json,re
from pathlib import Path
import numpy as np
import xarray as xr
from pyproj import Transformer

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def utc(value):
 t=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
 if t.tzinfo is None: raise ValueError('Explicit timezone required')
 return t.astimezone(dt.timezone.utc)
def export(root,config,destination,diagnostic=False):
 root=Path(root).resolve(); config=Path(config).resolve(); destination=Path(destination); c=json.loads(config.read_text(encoding='utf-8-sig')); now=dt.datetime.now(dt.timezone.utc)
 def source(path):
  p=(root/path).resolve()
  if not p.is_relative_to(root): raise ValueError('Input must be inside run directory')
  return p
 if c.get('inputRole')!='forecast' or c.get('nativeTimeZone')!='UTC': raise ValueError('Explicit forecast input role and native UTC convention required')
 start,end,issued,asof=[utc(c[k]) for k in ['validFrom','validTo','issuedAt','sourceAsOf']]
 if not start<end or asof>issued or issued>now+dt.timedelta(minutes=5): raise ValueError('Invalid source/issue/valid window')
 if not diagnostic and end<=now: raise ValueError('Expired historical output cannot be published as current')
 if not re.fullmatch(r'[A-Za-z0-9_-]+',c['runId']): raise ValueError('Invalid runId')
 if not c.get('assumptions') or not c.get('domainDescription') or not c.get('solverVersion'): raise ValueError('Actual assumptions/domain/solver version required')
 if 'Simulation finished' not in source(c.get('logFile','solver.log')).read_text(encoding='utf-8',errors='replace'): raise ValueError('Solver completion marker missing')
 if not c.get('inputArtifacts'): raise ValueError('Input provenance required')
 for item in c['inputArtifacts']:
  if digest(source(item['path']))!=item['sha256']: raise ValueError('Input hash mismatch: '+item['path'])
 native=source(c.get('mapFile','sfincs_map.nc'))
 with xr.open_dataset(native) as ds:
  v=ds['subgrid_volume']
  if v.attrs.get('units')!='m3': raise ValueError('Require native subgrid_volume m3; h is not silently treated as cell-average depth')
  dims=tuple(k for k in v.dims if k!='time'); volume=v.transpose('time',*dims).values
  area=float(c['cellAreaM2'])
  if not np.isfinite(area) or area<=0: raise ValueError('Positive constant cell area required')
  mask=np.load(source(c['activeMaskNpy']),allow_pickle=False).astype(bool)
  if mask.shape!=volume.shape[1:] or not mask.any(): raise ValueError('Explicit active mask shape mismatch/empty')
  x=ds.x.transpose(*dims).values;y=ds.y.transpose(*dims).values
  if x.shape!=mask.shape or y.shape!=mask.shape: raise ValueError('Native coordinate shape mismatch')
  lon,lat=Transformer.from_crs(c['projectedCrs'],4326,always_xy=True).transform(x[mask],y[mask])
  if not np.isfinite(lon).all() or not np.isfinite(lat).all() or (np.abs(lon)>180).any() or (np.abs(lat)>90).any(): raise ValueError('Invalid geographic cells')
  times=np.asarray(ds.time.values,dtype='datetime64[ns]')
  if np.isnat(times).any() or not np.all(np.diff(times)>np.timedelta64(0,'ns')): raise ValueError('Invalid native time axis')
  stamps=[str(t)[:19]+'Z' for t in times]
  select=[i for i,t in enumerate(stamps) if start<=utc(t)<=end]
  if not select or utc(stamps[select[0]])!=start or utc(stamps[select[-1]])!=end: raise ValueError('Native frames must include exact valid endpoints')
  selected=volume[select][:,mask]; tolerance=float(c.get('negativeVolumeToleranceM3',0))
  if tolerance<0 or not np.isfinite(tolerance) or (selected[np.isfinite(selected)] < -tolerance).any(): raise ValueError('Negative native volume exceeds declared display tolerance')
  depths=np.maximum(selected,0)/area
  frames=[{'time':stamps[i],'depthM':[float(v) if np.isfinite(v) else None for v in row]} for i,row in zip(select,depths)]
  cells=[{'lon':float(a),'lat':float(b)} for a,b in zip(lon,lat)]
  crossings=c.get('crossings',[])
  for crossing in crossings:
   k=crossing.get('cellIndex')
   if crossing.get('status')!='supported_neighborhood' or not crossing.get('evidence') or not isinstance(k,int) or not 0<=k<len(cells): raise ValueError('Invalid explicit crossing support')
 quantity={'name':'cell_average_depth','units':'m','definition':'Water volume divided by full grid-cell area; not road or channel depth'}
 provenance={'solverVersion':c['solverVersion'],'runId':c['runId'],'inputArtifacts':c['inputArtifacts'],'projectedCrs':c['projectedCrs'],'verticalDatum':c['verticalDatum'],'sourceAsOf':c['sourceAsOf'],'sourceMetadata':c.get('sourceMetadata',{}),'assumptions':c['assumptions'],'nativeOutput':{'path':native.name,'sha256':digest(native)},'exportConfigurationSha256':digest(config),'activeMaskSha256':digest(source(c['activeMaskNpy'])),'outputQuantity':quantity,'cellAreaM2':area,'negativeVolumeDisplayPolicy':{'toleranceM3':tolerance,'minimumRawVolumeM3':float(np.nanmin(selected)),'clampedForDisplayOnly':True},'forecast':{'inputRole':'forecast','issuedAt':c['issuedAt'],'validFrom':c['validFrom'],'validTo':c['validTo']}}
 run={'schemaVersion':1,'model':'SFINCS','kind':'inundation_scenario','status':'complete','crs':'EPSG:4326','cells':cells,'frames':frames,'provenance':provenance,'support':{'domainDescription':c['domainDescription'],'limitations':c['assumptions']},'uncertainty':c.get('uncertainty',{'status':'not_quantified','plusMinus':None})}
 if diagnostic: run['provenance'].pop('forecast');run['provenance']['diagnosticOnly']=True
 destination.mkdir(parents=True,exist_ok=True); name=c['runId']+('-diagnostic' if diagnostic else '')+'.json.gz'; artifact=destination/name
 if artifact.exists(): raise ValueError('Immutable output already exists')
 artifact.write_bytes(gzip.compress((json.dumps(run,allow_nan=False,separators=(',',':'))+'\n').encode(),mtime=0))
 (destination/(c['runId']+'-provenance.json')).write_text(json.dumps(provenance,indent=2,allow_nan=False)+'\n',encoding='utf-8')
 manifest={'schemaVersion':1,'kind':'diagnostic_inundation_manifest' if diagnostic else 'current_inundation_manifest','status':'complete','runId':c['runId'],'issuedAt':c['issuedAt'],'sourceAsOf':c['sourceAsOf'],'validFrom':c['validFrom'],'validTo':c['validTo'],'artifact':{'path':'data/'+name,'sha256':digest(artifact)},'outputQuantity':quantity,'assumptions':c['assumptions'],'crossings':crossings}
 target=destination/('diagnostic-sfincs-manifest.json' if diagnostic else 'current-sfincs-manifest.json');temp=target.with_suffix('.tmp');temp.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8');temp.replace(target)
 print(json.dumps({'manifest':str(target),'cells':len(cells),'frames':len(frames),'diagnostic':diagnostic}));return manifest
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('root');p.add_argument('--config',required=True);p.add_argument('--destination',required=True);p.add_argument('--diagnostic',action='store_true');a=p.parse_args();export(a.root,a.config,a.destination,a.diagnostic)
