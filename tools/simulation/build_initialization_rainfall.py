"""Observed/estimated hourly Stage IV rainfall for the NWM initialization window."""
import argparse,datetime as dt,hashlib,json,time,urllib.request,urllib.error
from pathlib import Path
import eccodes as ec
import numpy as np
import xarray as xr
from pyproj import CRS
p=argparse.ArgumentParser();p.add_argument('package');a=p.parse_args();root=Path(a.package);read=lambda n:json.loads((root/n).read_text(encoding='utf-8-sig'));forecast=read('rainfall.json');analysis=read('analysis-history.json');boundary=read('boundary-snapshot.json');stamp=lambda t:dt.datetime.fromisoformat(t.replace('Z','+00:00'));iso=lambda t:t.isoformat().replace('+00:00','Z');start=stamp(analysis['commonHistory']['start']);end=stamp(analysis['commonHistory']['end']);hours=int((end-start).total_seconds()/3600);out=root/'initialization-rainfall';out.mkdir(exist_ok=False);raw=out/'raw';raw.mkdir();lat=forecast['lat'];lon=forecast['lon'];frames=[];sources=[];mapping=None;missing=0;grid=None;failures=[]
for i in range(hours):
 finish=start+dt.timedelta(hours=i+1);begin=finish-dt.timedelta(hours=1);name=f'ST4.{finish:%Y%m%d%H}.01h.grib';url=f'https://mesonet.agron.iastate.edu/archive/data/{finish:%Y/%m/%d}/stage4/{name}';cached=Path('../official-forecast-cache')/name;retrieved=None;headers={}
 try:
  if cached.exists():b=cached.read_bytes();delivery='retained_verified_source';note='Earlier availability check retained original bytes; exact HTTP retrieval timestamp was not recorded.'
  else:
   with urllib.request.urlopen(url,timeout=45) as r:b=r.read(4000001);headers=dict(r.headers)
   if len(b)>4000000:raise ValueError('Bounded hourly download exceeded')
   retrieved=iso(dt.datetime.now(dt.timezone.utc));delivery='network';note=None
  (raw/name).write_bytes(b)
 except urllib.error.HTTPError as e:
  if e.code not in [404,410]:raise
  failures.append(dict(start=iso(begin),end=iso(finish),url=url,status=e.code));rain=[[None for _ in lon] for _ in lat];frames.append(dict(start=iso(begin),end=iso(finish),precipMmH=rain));missing+=len(lat)*len(lon);continue
 with (raw/name).open('rb') as f:h=ec.codes_grib_new_from_file(f)
 try:
  keys=['edition','shortName','units','stepType','stepUnits','startStep','endStep','dataDate','dataTime','validityDate','validityTime','gridType','Nx','Ny','bitmapPresent','missingValue','centre','generatingProcessIdentifier','typeOfGeneratingProcess','md5GridSection'];meta={k:ec.codes_get(h,k) for k in keys}
  if meta['shortName']!='tp' or meta['units']!='kg m**-2' or meta['stepType']!='accum' or meta['stepUnits']!=1 or meta['endStep']-meta['startStep']!=1:raise ValueError('Unrecognized Stage IV accumulation')
  valid=dt.datetime.strptime(str(meta['validityDate'])+f"{meta['validityTime']:04}",'%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc);reference=dt.datetime.strptime(str(meta['dataDate'])+f"{meta['dataTime']:04}",'%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc)
  if valid!=finish or reference+dt.timedelta(hours=meta['startStep'])!=begin or reference+dt.timedelta(hours=meta['endStep'])!=finish:raise ValueError('Header and requested interval disagree')
  if mapping is None:
   grid=meta['md5GridSection'];yy=ec.codes_get_array(h,'latitudes');xx=(ec.codes_get_array(h,'longitudes')+180)%360-180;indices=np.flatnonzero((yy>=min(lat)-.15)&(yy<=max(lat)+.15)&(xx>=min(lon)-.15)&(xx<=max(lon)+.15));ry=np.radians(yy[indices]);rx=np.radians(xx[indices]);mapping=[]
   for y in lat:
    row=[]
    for x in lon:
     d=np.sin((ry-np.radians(y))/2)**2+np.cos(ry)*np.cos(np.radians(y))*np.sin((rx-np.radians(x))/2)**2;k=int(np.argmin(d));idx=int(indices[k]);distance=float(6371000*2*np.arcsin(np.sqrt(d[k])));assert distance<5000;row.append(dict(index=idx,lat=float(yy[idx]),lon=float(xx[idx]),distanceM=distance))
    mapping.append(row)
   for r,c in [(0,0),(len(lat)//2,len(lon)//2),(-1,-1)]:assert ec.codes_grib_find_nearest(h,lat[r],lon[c],npoints=1)[0]['index']==mapping[r][c]['index']
  if meta['md5GridSection']!=grid:raise ValueError('Analysis native grid changed')
  values=ec.codes_get_values(h);bitmap=ec.codes_get_array(h,'bitmap') if meta['bitmapPresent'] else None;rain=[]
  for row in mapping:
   rr=[]
   for cell in row:
    k=cell['index'];v=float(values[k]);v=None if (bitmap is not None and not bitmap[k]) or v==meta['missingValue'] or not np.isfinite(v) or v<0 else v;missing+=v is None;rr.append(v)
   rain.append(rr)
  frames.append(dict(start=iso(begin),end=iso(finish),precipMmH=rain));sources.append(dict(url=url,rawFile='raw/'+name,sha256=hashlib.sha256(b).hexdigest(),bytes=len(b),start=iso(begin),end=iso(finish),gribReferenceTime=iso(reference),issuedAt=None,issueTimeNote='GRIB reference time retained; publication/issuance timestamp is not independently supplied by this archive.',retrievedAt=retrieved,delivery=delivery,retrievalNote=note,httpLastModified=headers.get('Last-Modified'),metadata=meta))
 finally:ec.codes_release(h)
 print(f'{i+1}/{hours} {name}: missing cell-hours {missing}',flush=True);time.sleep(.15)
status='complete' if missing==0 and not failures else 'insufficient_data';provenance=dict(schemaVersion=1,product='NCEP Stage IV hourly precipitation analysis via IEM',dataRole='observation_based_analysis_not_forecast',start=iso(start),end=iso(end),status=status,missingCellHours=missing,missingIntervals=failures,nativeGridHash=grid,mapping=mapping,sources=sources,conversion='GRIB one-hour tp kg/m2 -> mm accumulation -> numeric mm/h mean rate',limitations=['Radar/gauge estimated analysis, not direct rainfall measurements at every cell.','Native bitmap preserved; no zero fill, fitted rescaling or forecast substitution.','Archive publication latency/quality revision can differ from GRIB reference time.'])
(out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n',encoding='utf-8')
def netcdf(selected,path,role):
 values=np.array([f['precipMmH'] for f in selected],dtype=float);times=np.array([np.datetime64(stamp(f['start']).replace(tzinfo=None),'ns') for f in selected]);crs=CRS.from_epsg(4326);da=xr.DataArray(values,dims=('time','y','x'),coords={'time':times,'y':lat,'x':lon,'spatial_ref':0},name='precip',attrs={'units':'mm/hour','grid_mapping':'spatial_ref','data_role':role,'interval_label':'start','interval_seconds':3600});da.x.attrs={'axis':'X','standard_name':'longitude','units':'degrees_east'};da.y.attrs={'axis':'Y','standard_name':'latitude','units':'degrees_north'};da.spatial_ref.attrs={**crs.to_cf(),'spatial_ref':crs.to_wkt(),'crs_wkt':crs.to_wkt()};da.to_netcdf(path,engine='netcdf4');return values
values=netcdf(frames,out/'analysis-precipitation.nc','observation_based_analysis');(out/'analysis-rainfall.json').write_text(json.dumps(dict(schemaVersion=1,status=status,dataRole='observation_based_analysis',units='mm/h',lon=lon,lat=lat,frames=frames,missingCellHours=missing),separators=(',',':'))+'\n',encoding='utf-8')
transition=[f for f in forecast['frames'] if stamp(f['start'])>=end and stamp(f['end'])<=stamp(boundary['start'])];available=bool(transition) and stamp(transition[0]['start'])==end and stamp(transition[-1]['end'])==stamp(boundary['start']);
if transition:netcdf(transition,out/'forecast-transition-precipitation.nc','forecast_not_observation')
metadata=dict(schemaVersion=1,status=status,units='mm/h',intervalSeconds=3600,intervalEndUtc=iso(end),issuedAt=None,asOf=iso(dt.datetime.now(dt.timezone.utc)),sourceArtifacts=sources,dataRole='observation_based_analysis',forecastTransition=dict(start=iso(end),end=boundary['start'],available=available,intervalCount=len(transition),source='retained NOAA HRRR forecast',issuedAt=forecast['issuedAt'],role='forecast_not_observation',file='forecast-transition-precipitation.nc' if transition else None),interpretation='Requested analysis intervals are retained including native missing masks. status=insufficient_data prohibits treating the full window as complete. Separate forecast transition is supplied explicitly, not silently relabeled or automatically stitched. Initial-state method belongs to solver owner.')
(out/'metadata.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8');print(json.dumps(dict(status=status,hours=hours,missingCellHours=missing,nativeCells=len({c['index'] for row in mapping for c in row}),transition=metadata['forecastTransition'],totalRangeMm=[float(np.nanmin(values.sum(axis=0))),float(np.nanmax(values.sum(axis=0)))]),indent=2))
