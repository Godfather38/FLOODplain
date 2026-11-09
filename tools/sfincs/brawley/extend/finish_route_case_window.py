"""Finish the native case with the frozen weather package plus an explicit observed extension (validation copy).

Copy of tools/sfincs/finish_route_case.py with the 63-frame window parameterized: --extension adds observed rain frames
(netcdf precip(time,y,x), interval-start, mm/h) after the frozen frames; the frame count must equal --hours, frames must be
hourly and contiguous from 2026-10-30T16Z, every value finite (no zero-fill), the grid must equal the frozen grid exactly
(xarray join='exact'), and the last interval must end at or after the model tstop (apply_precipitation checks the run window).
"""
import argparse,json,hashlib,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import numpy as np,pandas as pd,xarray as xr,geopandas as gpd
from hydromt import DataCatalog
from hydromt_sfincs import SfincsModel
from prepare_current import apply_precipitation

def main():
 p=argparse.ArgumentParser();p.add_argument('--case',type=Path,required=True);p.add_argument('--rainfall',type=Path,required=True);p.add_argument('--domain',type=Path,required=True)
 p.add_argument('--extension',type=Path,action='append',default=[]);p.add_argument('--hours',type=int,required=True);a=p.parse_args()
 paths=[a.rainfall/'initialization-rainfall/resolved-analysis-precipitation.nc',a.rainfall/'initialization-rainfall/forecast-transition-precipitation.nc',a.rainfall/'precipitation.nc']+a.extension;arrays=[]
 for path in paths:
  with xr.open_dataset(path,decode_coords='all') as ds:arrays.append(ds.precip.load())
 rain=xr.concat(arrays,dim='time',join='exact',coords='minimal',compat='equals');times=pd.DatetimeIndex(rain.time.values)
 if len(times)!=a.hours or not np.all(np.diff(times.asi8)==3600*10**9) or not np.isfinite(rain.values).all() or times[0]!=pd.Timestamp('2026-10-30T16:00'):raise ValueError('Incomplete frozen/extended rainfall')
 end=(times[-1]+pd.Timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ')
 metadata=json.loads((a.rainfall/'precipitation-metadata.json').read_text());metadata.update(intervalEndUtc=end,sourceArtifacts=[{'path':str(f),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in paths])
 model=SfincsModel(root=str(a.case),mode='r+',write_gis=False);model.data_catalog=DataCatalog(fallback_lib=None);model.read_config();model.read_grid();model.set_geoms(gpd.read_file(a.domain).to_crs(32612),name='region')
 result=apply_precipitation(model,rain,metadata);model.write_forcing();model.write_config()
 base=json.loads((a.case/'native-component.json').read_text());base.update(status='prepared_all_routes_case_not_executed',runReady=True,kind='prepared_current_case',rainfall=result,missing=[],publicationHold=[],executionBudgetSeconds=None,proposedExecutionCapSeconds=3600,executionAuthorization='not_granted_for_extension',sourceAsOf=metadata['asOf'],sourceLicensing={'derivedInfiltrationLicense':'ODbL-1.0','notice':'GCN10-NOTICE.txt','sourceMetadata':'GCN10-source-metadata.xml','derivedDatabase':'infiltration.nc'})
 base['artifacts']=[{'path':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in a.case.iterdir() if f.is_file() and f.name!='current-case.json'];(a.case/'current-case.json').write_text(json.dumps(base,indent=2)+'\n',encoding='utf-8');print(json.dumps({'ready':True,'rainfallFrames':len(times),'rainfallShape':list(rain.shape),'end':end,'case':str(a.case)}))
 for h in list(model.logger.handlers):h.close();model.logger.removeHandler(h)
if __name__=='__main__':main()
