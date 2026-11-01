"""Bounded 72/96-hour Stage IV forcing for Trico; preserve native bitmap and mapping."""
import datetime as dt
import argparse
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.request
import eccodes as ec
import numpy as np

UTC=dt.timezone.utc
CACHE=Path('../rainfall-cache');CACHE.mkdir(exist_ok=True)
OUT=Path('public/simulation/data')
p=argparse.ArgumentParser();p.add_argument('--reach',action='store_true');p.add_argument('--spinup',action='store_true');p.add_argument('--event',choices=['2014','2013-july'],default='2014');args=p.parse_args()
if args.spinup and not args.reach:p.error('--spinup requires --reach')
if args.event=='2013-july':args.reach=True
hours=96 if args.spinup or args.event=='2013-july' else 72
first_end=dt.datetime(2013,7,19,8,tzinfo=UTC) if args.event=='2013-july' else dt.datetime(2014,9,7 if args.spinup else 8,8,tzinfo=UTC)
west,south,east,north=(-111.37,32.31,-111.05,32.52) if args.reach else (-111.36,32.38,-111.25,32.51)
lon=[round(west+i*.01,3) for i in range(round((east-west)/.01)+1)]
lat=[round(north-i*.01,3) for i in range(round((north-south)/.01)+1)]
frames=[];sources=[];mapping=None;grid=None;missing=0
for i in range(hours):
    end=first_end+dt.timedelta(hours=i)
    name=f'ST4.{end:%Y%m%d%H}.01h.grib'
    url=f'https://mesonet.agron.iastate.edu/archive/data/{end:%Y/%m/%d}/stage4/{name}'
    path=CACHE/name
    if not path.exists():
        with urllib.request.urlopen(url,timeout=45) as response:data=response.read(4_000_001)
        if len(data)>4_000_000:raise ValueError('Source exceeds bounded download')
        path.write_bytes(data);time.sleep(.25)
    data=path.read_bytes()
    with path.open('rb') as stream:h=ec.codes_grib_new_from_file(stream)
    try:
        keys=['edition','shortName','units','gridType','startStep','endStep','stepUnits','stepType','validityDate','validityTime','bitmapPresent','missingValue','Nx','Ny','DxInMetres','DyInMetres','md5GridSection','centre','subCentre','generatingProcessIdentifier','table2Version','indicatorOfParameter','latitudeOfFirstGridPointInDegrees','longitudeOfFirstGridPointInDegrees','orientationOfTheGridInDegrees','scanningMode']
        meta={k:ec.codes_get(h,k) for k in keys}
        if meta['shortName']!='tp' or meta['units']!='kg m**-2' or meta['stepType']!='accum' or meta['endStep']-meta['startStep']!=1 or meta['stepUnits']!=1:raise ValueError('Unrecognized product or interval')
        valid=dt.datetime.strptime(str(meta['validityDate'])+f"{meta['validityTime']:04}",'%Y%m%d%H%M').replace(tzinfo=UTC)
        if valid!=end:raise ValueError('Filename and GRIB interval disagree')
        if grid is None:
            grid=meta['md5GridSection'];mapping=[]
            # Read native coordinates once; avoid rescanning a million-cell grid
            # for every target point. Great-circle nearest sampling is unchanged.
            native_lat=ec.codes_get_array(h,'latitudes');native_lon=(ec.codes_get_array(h,'longitudes')+180)%360-180
            indices=np.flatnonzero((native_lat>=south-1)&(native_lat<=north+1)&(native_lon>=west-1)&(native_lon<=east+1))
            yy=np.radians(native_lat[indices]);xx=np.radians(native_lon[indices])
            for y in lat:
                row=[]
                for x in lon:
                    d=np.sin((yy-np.radians(y))/2)**2+np.cos(yy)*np.cos(np.radians(y))*np.sin((xx-np.radians(x))/2)**2
                    nearest=int(np.argmin(d));idx=int(indices[nearest])
                    row.append({'index':idx,'lat':float(native_lat[idx]),'lon':float(native_lon[idx]),'distance':float(6371*2*np.arcsin(np.sqrt(d[nearest])))})
                mapping.append(row)
            # Independent ecCodes nearest lookup verifies corners and center.
            for r,c in [(0,0),(len(lat)//2,len(lon)//2),(-1,-1)]:
                if ec.codes_grib_find_nearest(h,lat[r],lon[c],npoints=1)[0]['index']!=mapping[r][c]['index']:raise ValueError('Nearest native mapping disagrees with ecCodes')
        if meta['md5GridSection']!=grid:raise ValueError('Native grid changed')
        values=ec.codes_get_values(h)
        bitmap=ec.codes_get_array(h,'bitmap') if meta['bitmapPresent'] else None
        rain=[]
        for row in mapping:
            rr=[]
            for p in row:
                idx=p['index'];v=float(values[idx])
                v=None if (bitmap is not None and not bitmap[idx]) or v==meta['missingValue'] or not math.isfinite(v) or v<0 else v
                missing+=v is None;rr.append(v)
            rain.append(rr)
        start=(end-dt.timedelta(hours=1)).isoformat().replace('+00:00','Z');finish=end.isoformat().replace('+00:00','Z')
        frames.append({'start':start,'end':finish,'precipMmH':rain})
        sources.append({'start':start,'end':finish,'url':url,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'metadata':meta})
        print(f'{i+1}/{hours} {name}: cumulative missing={missing}',flush=True)
    finally:ec.codes_release(h)
limitations=['Historical Stage IV radar/gauge precipitation analysis, not measured rainfall at every cell or a calibrated flood prediction.','Nearest native roughly 4 km cells mapped onto a padded 0.01 degree forcing grid; finer output spacing adds no rainfall detail.','No missing-value fill, no fitted rescaling, and no blending with obsolete IEM PNG products.','Hourly constant rates omit subhour variability. This forcing does not supply upstream river inflow or downstream hydraulic boundaries.']
manifest={'schemaVersion':1,'source':'NCEP Stage IV hourly precipitation analysis, IEM archive','retrievedAt':dt.datetime.now(UTC).isoformat(),'sourceDocumentation':'https://mesonet.agron.iastate.edu/iemre/','historicalProductDocumentation':'https://gdex.ucar.edu/datasets/d507005/','conversion':'GRIB tp/accum kg m**-2: 1 kg/m2 water = 1 mm; exactly one hour gives mm/h numerically','sources':sources,'mapping':mapping,'mappingDimensions':['lat','lon'],'mappingDistanceUnits':'km','nativeGridHash':grid,'limitations':limitations}
manifest_path=OUT/('stage4-reach-2013-july-96h-provenance.json' if args.event=='2013-july' else 'stage4-reach-2014-96h-provenance.json' if args.spinup else 'stage4-reach-2014-provenance.json' if args.reach else 'stage4-forcing-2014-provenance.json')
manifest_path.write_text(json.dumps(manifest,indent=2,allow_nan=False)+'\n',encoding='utf-8')
result={'schemaVersion':1,'kind':'spatial_hourly_rainfall_forcing','status':'complete' if not missing else 'insufficient_data','crs':'EPSG:4326','lon':lon,'lat':lat,'dimensions':['time','lat','lon'],'units':'mm/h','timeConvention':'Frame start inclusive, end exclusive; constant mean rate for exactly one hour','missingCellHours':missing,'sourceQuality':{'requestedHours':hours,'availableHours':len(frames),'nativeBitmapPreserved':True,'forcingReadiness':'source_verified_historical_analysis','fieldValidation':'not_calibrated'},'frames':frames,'provenance':{'manifest':str(manifest_path),'manifestSha256':hashlib.sha256(manifest_path.read_bytes()).hexdigest(),'source':manifest['source'],'spatialMethod':'Nearest native cell, fixed mapping with native indices and distances retained','limitations':limitations}}
(OUT/('sfincs-reach-stage4-2013-july-96h.json' if args.event=='2013-july' else 'sfincs-reach-stage4-2014-96h.json' if args.spinup else 'sfincs-reach-stage4-2014.json' if args.reach else 'sfincs-trico-stage4-2014.json')).write_text(json.dumps(result,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
print(result['status'],missing,'missing cell-hours;',len(set(p['index'] for row in mapping for p in row)),'distinct native cells',flush=True)
