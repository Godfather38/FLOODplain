"""Extract scoped inlet series from fixed NOAA archive times using standard HTTP range reads."""
import argparse,json,hashlib
from pathlib import Path
from datetime import datetime,timedelta,timezone
from concurrent.futures import ThreadPoolExecutor
import requests,fsspec,xarray as xr,numpy as np

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--history',action='store_true');p.add_argument('--crosswalk',type=Path,default=Path('.sfincs-runs/nwm-frozen-13z/crosswalk.json'));a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 cross=json.loads(a.crosswalk.read_text());ids=list(cross['indices']);indices=[cross['indices'][k] for k in ids]
 if a.history:
  times=[datetime(2026,10,30,16,tzinfo=timezone.utc)+timedelta(hours=i) for i in range(47)]
  urls=[f'https://noaa-nwm-pds.s3.amazonaws.com/nwm.{t:%Y%m%d}/analysis_assim/nwm.t{t:%H}z.analysis_assim.channel_rt.tm00.conus.nc' for t in times]
 else:urls=[f'https://noaa-nwm-pds.s3.amazonaws.com/nwm.20261101/short_range/nwm.t13z.short_range.channel_rt.f{i:03d}.conus.nc' for i in range(1,19)]
 def read(pair):
  number,url=pair;path=a.output/f'frame-{number:03d}.json'
  if path.exists():return json.loads(path.read_text())
  head=requests.head(url,timeout=30);head.raise_for_status()
  with fsspec.open(url,mode='rb',block_size=262144).open() as f:
   with xr.open_dataset(f,engine='h5netcdf',decode_times=False) as ds:
    got=ds.feature_id.isel(feature_id=indices).values
    if not np.array_equal(got,np.array(ids,dtype='int64')):raise ValueError('Archive feature ordering changed')
    q=ds.streamflow.isel(feature_id=indices).values
    if ds.streamflow.attrs.get('units')!='m3 s-1' or not np.isfinite(q).all() or (q<0).any():raise ValueError('Missing/invalid native flow')
    valid=ds.attrs['model_output_valid_time'];issue=ds.attrs['model_initialization_time']
  result={'url':url,'etag':head.headers.get('ETag'),'contentLength':head.headers.get('Content-Length'),'identityNote':'ETag is source object identifier, not asserted SHA256 of whole remote file','issuedAt':issue.replace('_','T')+'Z','time':valid.replace('_','T')+'Z','units':'m3/s','values':{k:float(v) for k,v in zip(ids,q)}}
  path.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(f'{number+1}/{len(urls)} fixed archive frames retained',flush=True);return result
 with ThreadPoolExecutor(max_workers=3) as pool:frames=list(pool.map(read,enumerate(urls)))
 frames.sort(key=lambda f:f['time']);result={'schemaVersion':1,'status':'complete','kind':'archived_analysis' if a.history else 'frozen_forecast','source':'NOAA National Water Model archived native channel_rt','series':[{'reachId':k,'units':'m3/s','points':[{'time':f['time'],'flowM3s':f['values'][k]} for f in frames]} for k in ids],'sourceFrames':frames}
 (a.output/'series.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps({'reaches':len(ids),'frames':len(frames),'first':frames[0]['time'],'last':frames[-1]['time']}))
if __name__=='__main__':main()
