"""Resolve one source-masked Stage IV hour using retained NOAA MRMS Pass2 QPE."""
import sys,json,gzip,hashlib,csv,datetime as dt
from pathlib import Path
import eccodes as ec
import numpy as np
import xarray as xr
root=Path(sys.argv[1]); out=root/'initialization-rainfall'; raw=out/'raw'
name='MRMS_MultiSensor_QPE_01H_Pass2_00.00_20261101-130000.grib2.gz'; b=(raw/name).read_bytes(); h=ec.codes_new_from_message(gzip.decompress(b))
keys=['discipline','parameterCategory','parameterNumber','dataDate','dataTime','Ni','Nj','latitudeOfFirstGridPointInDegrees','longitudeOfFirstGridPointInDegrees','iDirectionIncrementInDegrees','jDirectionIncrementInDegrees','iScansNegatively','jScansPositively','jPointsAreConsecutive','productDefinitionTemplateNumber','stepType','bitmapPresent']
meta={k:ec.codes_get(h,k) for k in keys}; assert (meta['discipline'],meta['parameterCategory'],meta['parameterNumber'])==(209,6,37)
assert (meta['dataDate'],meta['dataTime'])==(20261101,1300)
assert not any(meta[k] for k in ['iScansNegatively','jScansPositively','jPointsAreConsecutive'])
table=list(csv.DictReader((raw/'UserTable_MRMS_v12.2.csv').read_text(encoding='utf-8-sig').splitlines())); row=next(r for r in table if r['Discipline']=='209' and r['Category']=='6' and r['Parameter']=='37'); assert row['Unit']=='mm'
d=xr.load_dataset(out/'analysis-precipitation.nc'); values=ec.codes_get_values(h); bitmap=ec.codes_get_array(h,'bitmap') if meta['bitmapPresent'] else None
mapped=np.empty((len(d.y),len(d.x))); mapping=[]
for iy,y in enumerate(d.y.values):
 for ix,x in enumerate(d.x.values):
  r=int(np.rint((meta['latitudeOfFirstGridPointInDegrees']-y)/meta['jDirectionIncrementInDegrees'])); c=int(np.rint(((x%360)-meta['longitudeOfFirstGridPointInDegrees'])/meta['iDirectionIncrementInDegrees'])); assert 0<=r<meta['Nj'] and 0<=c<meta['Ni']; idx=r*meta['Ni']+c
  v=values[idx]; mapped[iy,ix]=np.nan if v<0 or not np.isfinite(v) or (bitmap is not None and not bitmap[idx]) else v
  mapping.append({'outputRow':iy,'outputColumn':ix,'nativeIndex':idx,'nativeRow':r,'nativeColumn':c})
ec.codes_release(h)
assert np.isfinite(mapped).all(),'MRMS coverage incomplete; no replacement written'
k=int(np.where(d.time.values==np.datetime64('2026-11-01T12:00:00'))[0][0]); assert np.isnan(d.precip.values[k]).all(); original=d.precip.values.copy(); d.precip.values[k]=mapped
assert np.array_equal(np.delete(original,k,0),np.delete(d.precip.values,k,0))
d.precip.attrs['data_role']='observation_based_analysis_mixed_sources';d.attrs['source_transition']='Stage IV except 2026-11-01 12:00-13:00 UTC: NOAA MRMS MultiSensor QPE Pass2'; d.to_netcdf(out/'resolved-analysis-precipitation.nc',engine='netcdf4')
source={'url':'https://noaa-mrms-pds.s3.amazonaws.com/CONUS/MultiSensor_QPE_01H_Pass2_00.00/20261101/'+name,'rawFile':'raw/'+name,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'retrievedAt':None,'retrievalNote':'Fetched during this task; exact HTTP completion timestamp not recorded.','issuedAt':None,'validEnd':'2026-11-01T13:00:00Z','intervalStart':'2026-11-01T12:00:00Z','intervalSeconds':3600,'gribMetadata':meta,'parameterDefinition':row,'parameterTableUrl':'https://raw.githubusercontent.com/NOAA-National-Severe-Storms-Laboratory/mrms-support/main/GRIB2_TABLES/UserTable_MRMS_v12.2.csv','parameterTableSha256':hashlib.sha256((raw/'UserTable_MRMS_v12.2.csv').read_bytes()).hexdigest(),'intervalInterpretation':'MRMS product-defined preceding 1-hour accumulation ending at product valid timestamp. Generic GRIB template 0 instant is not interpreted as instantaneous rainfall.','conversion':'One-hour accumulated mm numerically equals mean mm/hour. Negative missing/no-coverage values remain missing.','nativeMapping':mapping}
metaout={'schemaVersion':1,'status':'complete','dataRole':'observation_based_analysis_mixed_sources','file':'resolved-analysis-precipitation.nc','start':'2026-10-30T16:00:00Z','end':'2026-11-01T14:00:00Z','intervalSeconds':3600,'units':'mm/h','issuedAt':None,'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'sourceReplacement':source,'missingCellHours':0,'replacementRangeMm':[float(mapped.min()),float(mapped.max())],'originalStageIV':'analysis-precipitation.nc','forecastTransition':'forecast-transition-precipitation.nc','limitations':['Stage IV and MRMS are distinct observation-based estimates; this substitution is explicit, not homogeneous product history.','A zero value is decoded source evidence, not gap filling.','Original Stage IV missing interval remains immutable.','Forecast transition remains separate; no initialized hydraulic state is claimed.']}
(out/'resolved-analysis-metadata.json').write_text(json.dumps(metaout,indent=2)+'\n',encoding='utf-8')
index=json.loads((root/'initialization-rainfall-manifest.json').read_text(encoding='utf-8'));index['resolvedAnalysis']={k:v for k,v in metaout.items() if k not in ['sourceReplacement']};index['files']={str(p.relative_to(out)).replace('\\','/'):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in out.rglob('*') if p.is_file()}; idx=root/'initialization-rainfall-manifest.json';idx.write_text(json.dumps(index,indent=2)+'\n',encoding='utf-8');m=json.loads((root/'manifest.json').read_text(encoding='utf-8'));m['initializationRainfall'].update(sha256=hashlib.sha256(idx.read_bytes()).hexdigest(),status='complete_with_explicit_source_substitution',note='Use resolved-analysis-precipitation.nc; original Stage IV gap retained. HRRR transition remains separate.');(root/'manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':'complete','shape':list(d.precip.shape),'MRMSReplacementRangeMm':metaout['replacementRangeMm'],'missing':0,'unchangedOtherHours':45}))
