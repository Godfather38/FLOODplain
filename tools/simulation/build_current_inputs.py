"""Acquire a bounded current HRRR + existing river-provider input package (no solver)."""
import sys,argparse,datetime as dt,hashlib,json,math,re,subprocess,time,urllib.request,xml.etree.ElementTree as ET
from pathlib import Path
import eccodes as ec
import numpy as np
UTC=dt.timezone.utc;ROOT=Path(__file__).resolve().parents[2];BASE='https://noaa-hrrr-bdp-pds.s3.amazonaws.com/'
def iso(t):return t.isoformat().replace('+00:00','Z')
def digest(b):return hashlib.sha256(b).hexdigest()
def get(url,maxbytes=3000000,headers=None):
 with urllib.request.urlopen(urllib.request.Request(url,headers=headers or {}),timeout=60) as r:
  status=r.status;meta=dict(r.headers);b=r.read(maxbytes+1)
 if len(b)>maxbytes:raise ValueError('Bounded download exceeded: '+url)
 return b,status,meta
def main():
 p=argparse.ArgumentParser();p.add_argument('--rainfall-only',action='store_true');p.add_argument('--out',required=True);p.add_argument('--registry',required=True);p.add_argument('--bounds',nargs=4,type=float,default=[-111.37,32.31,-111.05,32.52]);p.add_argument('--hours',type=int,default=18);a=p.parse_args()
 if not 1<=a.hours<=18:raise ValueError('Bounded product supports 1–18 forecast hours')
 registry_bytes=Path(a.registry).read_bytes();out=Path(a.out);out.mkdir(parents=True,exist_ok=False);raw=out/'raw';raw.mkdir();(out/'boundary-registry.json').write_bytes(registry_bytes);asof=dt.datetime.now(UTC);west,south,east,north=a.bounds
 if not(-112<west<east<-110 and 31<south<north<34) or east-west>.6 or north-south>.6:raise ValueError('Bounds exceed local package scope')
 selected=None;discover=[]
 for back in range(4):
  cycle=asof.replace(minute=0,second=0,microsecond=0)-dt.timedelta(hours=back);prefix=f'hrrr.{cycle:%Y%m%d}/conus/hrrr.t{cycle:%H}z.wrfsfc'
  url=BASE+'?list-type=2&prefix='+prefix+'&max-keys=150';b,_,_=get(url);keys=[x.text for x in ET.fromstring(b).findall('.//{*}Key')];name=f'discovery-{cycle:%Y%m%d%H}.xml';(raw/name).write_bytes(b);discover.append(dict(url=url,file='raw/'+name,sha256=digest(b)))
  if all(prefix+f'f{h:02}.grib2.idx' in keys for h in range(1,a.hours+1)):selected=(cycle,prefix);break
 if selected is None:raise ValueError('No complete published cycle among bounded four-hour search; no stale substitution')
 cycle,prefix=selected;lon=np.linspace(west,east,round((east-west)/.01)+1).tolist();lat=np.linspace(north,south,round((north-south)/.01)+1).tolist();frames=[];sources=[];mapping=None;grid=None;missing=0
 for hour in range(1,a.hours+1):
  url=BASE+prefix+f'f{hour:02}.grib2';idx,_,_=get(url+'.idx');idxname=f'f{hour:02}.idx';(raw/idxname).write_bytes(idx);lines=idx.decode().splitlines();matches=[]
  for i,line in enumerate(lines):
   if f':APCP:surface:{hour-1}-{hour} hour acc fcst:' in line:matches.append(i)
  if len(matches)!=1 or matches[0]+1>=len(lines):raise ValueError('Exactly one bounded one-hour APCP field required')
  i=matches[0];lo=int(lines[i].split(':')[1]);hi=int(lines[i+1].split(':')[1])-1;b,status,headers=get(url,headers={'Range':f'bytes={lo}-{hi}'})
  if status!=206 or len(b)!=hi-lo+1 or not b.startswith(b'GRIB'):raise ValueError('Unexpected range response; refusing full file')
  name=f'f{hour:02}-apcp.grib2';(raw/name).write_bytes(b)
  with (raw/name).open('rb') as f:h=ec.codes_grib_new_from_file(f)
  try:
   keys=['edition','shortName','units','stepType','stepUnits','startStep','endStep','dataDate','dataTime','validityDate','validityTime','gridType','Nx','Ny','DxInMetres','DyInMetres','bitmapPresent','missingValue','md5GridSection','latitudeOfFirstGridPointInDegrees','longitudeOfFirstGridPointInDegrees','LaDInDegrees','LoVInDegrees','Latin1InDegrees','Latin2InDegrees','scanningMode']
   meta={k:ec.codes_get(h,k) for k in keys}
   if meta['shortName']!='tp' or meta['units']!='kg m**-2' or meta['stepType']!='accum' or meta['stepUnits']!=1 or (meta['startStep'],meta['endStep'])!=(hour-1,hour):raise ValueError('Wrong product/units/accumulation')
   issue=dt.datetime.strptime(str(meta['dataDate'])+f"{meta['dataTime']:04}",'%Y%m%d%H%M').replace(tzinfo=UTC);end=dt.datetime.strptime(str(meta['validityDate'])+f"{meta['validityTime']:04}",'%Y%m%d%H%M').replace(tzinfo=UTC)
   if issue!=cycle or end!=cycle+dt.timedelta(hours=hour):raise ValueError('Issue/valid time mismatch')
   if mapping is None:
    grid=meta['md5GridSection'];yy=ec.codes_get_array(h,'latitudes');xx=(ec.codes_get_array(h,'longitudes')+180)%360-180;indices=np.flatnonzero((yy>=south-.1)&(yy<=north+.1)&(xx>=west-.1)&(xx<=east+.1));ry=np.radians(yy[indices]);rx=np.radians(xx[indices]);mapping=[]
    for y in lat:
     row=[]
     for x in lon:
      d=np.sin((ry-np.radians(y))/2)**2+np.cos(ry)*np.cos(np.radians(y))*np.sin((rx-np.radians(x))/2)**2;k=int(np.argmin(d));idxn=int(indices[k]);distance=float(6371000*2*np.arcsin(np.sqrt(d[k])))
      if distance>2500:raise ValueError('Target cell outside supported HRRR coverage')
      row.append(dict(index=idxn,lat=float(yy[idxn]),lon=float(xx[idxn]),distanceM=distance))
     mapping.append(row)
    for r,c in [(0,0),(len(lat)//2,len(lon)//2),(-1,-1)]:
     if ec.codes_grib_find_nearest(h,lat[r],lon[c],npoints=1)[0]['index']!=mapping[r][c]['index']:raise ValueError('Native mapping cross-check failed')
   if meta['md5GridSection']!=grid:raise ValueError('Grid changes across cycle')
   values=ec.codes_get_values(h);bitmap=ec.codes_get_array(h,'bitmap') if meta['bitmapPresent'] else None;rain=[]
   for row in mapping:
    rr=[]
    for cell in row:
     k=cell['index'];v=float(values[k]);v=None if (bitmap is not None and not bitmap[k]) or v==meta['missingValue'] or not math.isfinite(v) or v<0 else v;missing+=v is None;rr.append(v)
    rain.append(rr)
   frames.append(dict(start=iso(end-dt.timedelta(hours=1)),end=iso(end),precipMmH=rain,precipMS=[[None if v is None else v/3600000 for v in row] for row in rain]))
   sources.append(dict(url=url,byteRange=[lo,hi],rangeStatus=status,etag=headers.get('ETag'),lastModified=headers.get('Last-Modified'),retrievedAt=iso(dt.datetime.now(UTC)),rawFile='raw/'+name,sha256=digest(b),indexFile='raw/'+idxname,indexSha256=digest(idx),metadata=meta));print(f'HRRR {iso(cycle)} f{hour:02}: {len(b)} bytes, missing cell-hours {missing}',flush=True)
  finally:ec.codes_release(h)
  time.sleep(.15)
 provenance=dict(provider='NOAA HRRR',cycle=iso(cycle),asOf=iso(asof),bounds=a.bounds,nativeResolutionM=3000,nativeGridHash=grid,mapping=mapping,discovery=discover,sources=sources,conversion='One-hour APCP kg/m2 equals mm accumulation and mean mm/h; SI mean m/s = mm/h / 3600000',spatialMethod='Nearest native HRRR cell, same established sampling as Stage IV adapter; 0.01-degree output adds no spatial skill',documentation=['https://registry.opendata.aws/noaa-hrrr-pds/','https://rapidrefresh.noaa.gov/hrrr/'])
 (out/'rainfall-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
 forcing=dict(schemaVersion=1,kind='spatial_hourly_rainfall_forcing',status='complete' if not missing else 'insufficient_data',dataRole='forecast',issuedAt=iso(cycle),crs='EPSG:4326',lon=lon,lat=lat,dimensions=['time','lat','lon'],units='mm/h',siUnits='m/s',timeConvention='start inclusive/end exclusive; hourly mean rate from nonoverlapping one-hour forecast accumulation',missingCellHours=missing,sourceQuality=dict(requestedHours=a.hours,availableHours=len(frames),nativeBitmapPreserved=True,forcingReadiness='source_verified_forecast',fieldValidation='not_calibrated'),frames=frames,provenance=dict(manifest='rainfall-provenance.json',manifestSha256=digest((out/'rainfall-provenance.json').read_bytes()),source='NOAA HRRR hourly forecast precipitation'))
 (out/'rainfall.json').write_text(json.dumps(forcing,separators=(',',':'))+'\n')
 if a.rainfall_only:return
 subprocess.run(['node',str(ROOT/'tools/simulation/snapshot-current-providers.mjs'),str(out.resolve()),iso(asof)],cwd=ROOT,check=True)
 start=max(cycle,asof.replace(minute=0,second=0,microsecond=0)+dt.timedelta(hours=1));end=cycle+dt.timedelta(hours=a.hours)
 providers=json.loads((out/'providers.json').read_text());curves=[r for c in providers['boundaryCandidates'] for r in [c['official'],*c['nwm']['reaches']] if r.get('status')=='ok' and r.get('points')]
 for r in curves:
  start=max(start,dt.datetime.fromisoformat(r['points'][0]['time'].replace('Z','+00:00')));end=min(end,dt.datetime.fromisoformat(r['points'][-1]['time'].replace('Z','+00:00')))
 if not curves or start>=end:raise ValueError('No common current provider/rainfall coverage')
 manifest=dict(schemaVersion=1,kind='current_forcing_package',status='inputs_acquired_awaiting_model_and_inlet_registry',asOf=iso(asof),bounds=a.bounds,rainfallCycle=iso(cycle),candidateWindow=dict(start=iso(start),end=iso(end)),rainfallFile='rainfall.json',providerFile='providers.json',rainfallComplete=missing==0,sourceIssuePolicy='All snapshots use the fixed acquisition cutoff; provider issue times are retained separately, never relabeled as HRRR issue time',inletAssignments=[],dependencies=['Solver owner must map unique domain inlets/catchments to candidate forecast reaches and select one issue per inlet without duplicated runoff.','Professional physical inputs, loss configuration and compatible initial state remain solver-owner dependencies.','Restrict case to common temporal coverage; do not pad or extrapolate discharge.'],files={f.name:digest(f.read_bytes()) for f in out.iterdir() if f.is_file()})
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2));subprocess.run(['node',str(ROOT/'tools/simulation/export-current-boundaries.mjs'),str(out.resolve())],cwd=ROOT,check=True)
 sys.path.insert(0,str(Path(__file__).resolve().parent))
 from finalize_current_inputs import finalize
 finalize(out)
if __name__=='__main__':main()
