"""Finish the native refined case with the complete, frozen, recropped weather package."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np,pandas as pd,xarray as xr,geopandas as gpd
from hydromt import DataCatalog
from hydromt_sfincs import SfincsModel
from prepare_current import apply_precipitation

def main():
 p=argparse.ArgumentParser();p.add_argument('--case',type=Path,required=True);p.add_argument('--rainfall',type=Path,required=True);p.add_argument('--domain',type=Path,required=True);a=p.parse_args()
 paths=[a.rainfall/'initialization-rainfall/resolved-analysis-precipitation.nc',a.rainfall/'initialization-rainfall/forecast-transition-precipitation.nc',a.rainfall/'precipitation.nc'];arrays=[]
 for path in paths:
  with xr.open_dataset(path,decode_coords='all') as ds:arrays.append(ds.precip.load())
 rain=xr.concat(arrays,dim='time',join='exact',coords='minimal',compat='equals');times=pd.DatetimeIndex(rain.time.values)
 if len(times)!=63 or not np.all(np.diff(times.asi8)==3600*10**9) or not np.isfinite(rain.values).all():raise ValueError('Incomplete frozen rainfall')
 metadata=json.loads((a.rainfall/'precipitation-metadata.json').read_text());metadata.update(intervalEndUtc='2026-11-02T07:00:00Z',sourceArtifacts=[{'path':str(f),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in paths])
 model=SfincsModel(root=str(a.case),mode='r+',write_gis=False);model.data_catalog=DataCatalog(fallback_lib=None);model.read_config();model.read_grid();model.set_geoms(gpd.read_file(a.domain).to_crs(32612),name='region')
 result=apply_precipitation(model,rain,metadata);model.write_forcing();model.write_config()
 base=json.loads((a.case/'native-component.json').read_text());base.update(status='prepared_all_routes_case_not_executed',runReady=True,kind='prepared_current_case',rainfall=result,missing=[],publicationHold=[],executionBudgetSeconds=None,proposedExecutionCapSeconds=3600,executionAuthorization='not_granted_for_extension',sourceAsOf=metadata['asOf'],sourceLicensing={'derivedInfiltrationLicense':'ODbL-1.0','notice':'GCN10-NOTICE.txt','sourceMetadata':'GCN10-source-metadata.xml','derivedDatabase':'infiltration.nc'})
 base['artifacts']=[{'path':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in a.case.iterdir() if f.is_file() and f.name!='current-case.json'];(a.case/'current-case.json').write_text(json.dumps(base,indent=2)+'\n',encoding='utf-8');print(json.dumps({'ready':True,'rainfallFrames':len(times),'rainfallShape':list(rain.shape),'case':str(a.case)}))
 for h in list(model.logger.handlers):h.close();model.logger.removeHandler(h)
if __name__=='__main__':main()
