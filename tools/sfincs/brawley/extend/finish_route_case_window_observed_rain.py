"""SENSITIVITY ONLY: finish the native case with frozen analysis rain plus observed Stage IV for every former HRRR hour (v2r).

Copy of finish_route_case_window.py with one change: the frozen package's HRRR frames
(initialization-rainfall/forecast-transition-precipitation.nc, 14Z..16Z Nov 1, and precipitation.nc, 17Z Nov 1..06Z Nov 2)
are NOT used. The frozen observation-based analysis frames (initialization-rainfall/resolved-analysis-precipitation.nc,
2026-10-30T16Z..2026-11-01T13Z) are kept unchanged and the --extension files (observed Stage IV 01h from
fetch_stage4_extension.py, same header checks, HRAP grid hash and cell mapping) supply every later hour.
All checks of the window copy are kept: frame count equals --hours, hourly and contiguous from 2026-10-30T16Z, every
value finite (no zero-fill), grid equal to the frozen grid exactly (xarray join='exact'), last interval ends at tstop.
Every extension file must be labelled observation_based_analysis* (no forecast frame can enter).
The metadata handed to apply_precipitation is written for observations (observationOrForecast 'observation').
"""
import argparse,json,hashlib,sys,datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import numpy as np,pandas as pd,xarray as xr,geopandas as gpd
from hydromt import DataCatalog
from hydromt_sfincs import SfincsModel
from prepare_current import apply_precipitation

def main():
 p=argparse.ArgumentParser();p.add_argument('--case',type=Path,required=True);p.add_argument('--rainfall',type=Path,required=True);p.add_argument('--domain',type=Path,required=True)
 p.add_argument('--extension',type=Path,action='append',required=True);p.add_argument('--extension-metadata',type=Path,required=True);p.add_argument('--hours',type=int,required=True);a=p.parse_args()
 paths=[a.rainfall/'initialization-rainfall/resolved-analysis-precipitation.nc']+a.extension;arrays=[]
 for path in paths:
  with xr.open_dataset(path,decode_coords='all') as ds:
   role=ds.precip.attrs.get('data_role','')
   if not role.startswith('observation_based_analysis') or 'reference' in role:raise ValueError(f'{path}: not an observation-based forcing file ({role})')
   arrays.append(ds.precip.load())
 rain=xr.concat(arrays,dim='time',join='exact',coords='minimal',compat='equals');times=pd.DatetimeIndex(rain.time.values)
 if len(times)!=a.hours or not np.all(np.diff(times.asi8)==3600*10**9) or not np.isfinite(rain.values).all() or times[0]!=pd.Timestamp('2026-10-30T16:00'):raise ValueError('Incomplete frozen-analysis/observed rainfall')
 end=(times[-1]+pd.Timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ')
 ext=json.loads(a.extension_metadata.read_text())
 if ext.get('status')!='complete' or ext.get('missingCellHours')!=0:raise ValueError('Extension metadata incomplete')
 frozen=json.loads((a.rainfall/'precipitation-metadata.json').read_text())
 metadata={'status':'complete','units':'mm/h','intervalSeconds':3600,'intervalEndUtc':end,'issuedAt':ext['caseExtension']['endExclusive'],
  'asOf':max(s['retrievedAt'] for s in ext['sources'] if s.get('retrievedAt')),'observationOrForecast':'observation',
  'note':'SENSITIVITY v2r: frozen observation-based analysis 2026-10-30T16Z..2026-11-01T14Z unchanged, observed Stage IV 01h (IEM) for every later hour; no HRRR, no zero-fill',
  'geography':frozen['geography'],'frozenForecastNotUsed':['initialization-rainfall/forecast-transition-precipitation.nc','precipitation.nc'],
  'sourceArtifacts':[{'path':str(f),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in paths+[a.extension_metadata]]}
 model=SfincsModel(root=str(a.case),mode='r+',write_gis=False);model.data_catalog=DataCatalog(fallback_lib=None);model.read_config();model.read_grid();model.set_geoms(gpd.read_file(a.domain).to_crs(32612),name='region')
 result=apply_precipitation(model,rain,metadata);model.write_forcing();model.write_config()
 base=json.loads((a.case/'native-component.json').read_text());base.update(status='prepared_all_routes_case_not_executed',runReady=True,kind='prepared_current_case',rainfall=result,missing=[],publicationHold=[],executionBudgetSeconds=None,proposedExecutionCapSeconds=3600,executionAuthorization='not_granted_for_extension',sourceAsOf=metadata['asOf'],sourceLicensing={'derivedInfiltrationLicense':'ODbL-1.0','notice':'GCN10-NOTICE.txt','sourceMetadata':'GCN10-source-metadata.xml','derivedDatabase':'infiltration.nc'})
 base['artifacts']=[{'path':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in a.case.iterdir() if f.is_file() and f.name!='current-case.json'];(a.case/'current-case.json').write_text(json.dumps(base,indent=2)+'\n',encoding='utf-8');print(json.dumps({'ready':True,'rainfallFrames':len(times),'rainfallShape':list(rain.shape),'end':end,'case':str(a.case)}))
 for h in list(model.logger.handlers):h.close();model.logger.removeHandler(h)
if __name__=='__main__':main()
