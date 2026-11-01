"""Assemble supplied history and forecast into a prepared native case; no solver run."""
import argparse,json,hashlib,shutil
from pathlib import Path
import numpy as np
import pandas as pd
import xarray as xr
from hydromt import DataCatalog
from hydromt_sfincs import SfincsModel
from prepare_current import apply_discharge,apply_precipitation
from prepare_current_history import prepare


def main():
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['model','package','registry','output']:p.add_argument('--'+k,type=Path,required=True)
 a=p.parse_args()
 if a.output.exists():raise FileExistsError('Preserve existing native case')
 registry=json.loads(a.registry.read_text());boundary=prepare(a.package,registry)
 paths=[a.package/'initialization-rainfall/resolved-analysis-precipitation.nc',a.package/'initialization-rainfall/forecast-transition-precipitation.nc',a.package/'precipitation.nc']
 arrays=[]
 for path in paths:
  with xr.open_dataset(path) as ds:arrays.append(ds['precip'].load())
 rain=xr.concat(arrays,dim='time',join='exact',coords='minimal',compat='equals')
 times=pd.DatetimeIndex(rain.time.values)
 if times.has_duplicates or not times.is_monotonic_increasing or not np.all(np.diff(times.asi8)==3600*10**9):raise ValueError('Rainfall history/transition gaps or overlaps')
 if not np.isfinite(rain.values).all() or (rain.values<0).any():raise ValueError('Missing rainfall')
 if times[0]!=pd.Timestamp(boundary['start']).tz_localize(None) or times[-1]+pd.Timedelta(hours=1)!=pd.Timestamp(boundary['end']).tz_localize(None):raise ValueError('Flow/rainfall window mismatch')
 forecast_meta=json.loads((a.package/'precipitation-metadata.json').read_text());history_meta=json.loads((a.package/'initialization-rainfall/resolved-analysis-metadata.json').read_text())
 metadata={**forecast_meta,'status':'complete','asOf':max(forecast_meta['asOf'],history_meta['createdAt']),'intervalEndUtc':boundary['end'],'dataRole':'observation_based_history_then_forecast','sourceArtifacts':[{'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in paths]}
 for name in ['GCN10-NOTICE.txt','GCN10-source-metadata.xml']:
  if not (a.model/name).is_file():raise ValueError('Missing canonical license notice '+name)
 shutil.copytree(a.model,a.output)
 model=SfincsModel(root=str(a.output),mode='r+',write_gis=False);model.data_catalog=DataCatalog(fallback_lib=None);model.read()
 model.setup_config(tref=pd.Timestamp(boundary['start']).strftime('%Y%m%d %H%M%S'),tstart=pd.Timestamp(boundary['start']).strftime('%Y%m%d %H%M%S'),tstop=pd.Timestamp(boundary['end']).strftime('%Y%m%d %H%M%S'),zsini=0.0,latitude=32.44,dtrstout=3600.0,dtout=3600.0,dthisout=600.0)
 flow_result=apply_discharge(model,registry,boundary['series'],boundary['start'],boundary['end'],boundary['asOf'])
 rain_result=apply_precipitation(model,rain,metadata);model.write()
 result={'schemaVersion':1,'kind':'prepared_current_case','solverExecuted':False,'forecastStart':boundary['forecastStart'],'end':boundary['end'],'sourceAsOf':boundary['asOf'],'boundary':flow_result,'rainfall':rain_result,'initialization':{'time':boundary['start'],'method':'Explicit dry assumed state at antecedent start followed by supplied analysis discharge and observed rainfall; continuous state into forecast','notMeasuredState':True,'convergenceEstablished':False},'physicalModel':'Catchment-aligned 2021 terrain with verified 2023 edge; published roughness/CN scenario; seven directed free-outflow cells','publicationHold':['Refresh forecast issuance before execution'],'sourceLicensing':{'derivedInfiltrationLicense':'ODbL-1.0','notice':'GCN10-NOTICE.txt','sourceMetadata':'GCN10-source-metadata.xml','derivedDatabase':'sfincs.scs'},'artifacts':[{'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in a.output.iterdir() if p.is_file() and (p.name.startswith('sfincs') or p.suffix=='.nc')]}
 (a.output/'current-case.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'output':str(a.output),'rainfallFrames':len(times),'inlets':flow_result['sourceCount'],'forecastStart':boundary['forecastStart'],'solverExecuted':False}))
 for h in list(model.logger.handlers):h.close();model.logger.removeHandler(h)

if __name__=='__main__':main()
