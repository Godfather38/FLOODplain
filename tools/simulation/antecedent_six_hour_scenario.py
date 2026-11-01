"""Separate total-conserving scenario; never modify or call allocated rain observed hourly."""
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import eccodes as ec

ROOT=Path('public/simulation/data')
original=ROOT/'sfincs-reach-stage4-2013-july05-23-432h.json'
raw=original.read_bytes();original_hash=hashlib.sha256(raw).hexdigest();rain=json.loads(raw)
manifest=json.loads((ROOT/'stage4-reach-2013-july05-23-432h-provenance.json').read_text())
source=Path('test/fixtures/stage4/ST4.2013071606.06h.grib')
source_bytes=source.read_bytes()
with source.open('rb') as f:h=ec.codes_grib_new_from_file(f)
try:
 keys=['edition','shortName','units','dataDate','dataTime','startStep','endStep','stepUnits','stepType','validityDate','validityTime','bitmapPresent','missingValue','md5GridSection','gridType','centre','subCentre','generatingProcessIdentifier']
 meta={k:ec.codes_get(h,k) for k in keys}
 assert meta['shortName']=='tp' and meta['units']=='kg m**-2' and meta['stepType']=='accum' and meta['stepUnits']==1
 assert meta['endStep']-meta['startStep']==6 and meta['md5GridSection']==manifest['nativeGridHash']
 reference=dt.datetime.strptime(str(meta['dataDate'])+f"{meta['dataTime']:04}",'%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc)
 start=reference+dt.timedelta(hours=meta['startStep']);end=reference+dt.timedelta(hours=meta['endStep'])
 assert start==dt.datetime(2013,7,16,0,tzinfo=dt.timezone.utc) and end==dt.datetime(2013,7,16,6,tzinfo=dt.timezone.utc)
 values=ec.codes_get_values(h);mask=ec.codes_get_array(h,'bitmap')
 totals=[]
 for row in manifest['mapping']:
  rr=[]
  for cell in row:
   idx=cell['index'];assert mask[idx] and values[idx]>=0 and values[idx]!=meta['missingValue'];rr.append(float(values[idx]))
  totals.append(rr)
finally:ec.codes_release(h)

result=copy.deepcopy(rain);replaced=[];known_sums=[[0.0 for _ in rain['lon']] for _ in rain['lat']]
for i,frame in enumerate(result['frames']):
 stamp=dt.datetime.fromisoformat(frame['start'].replace('Z','+00:00'))
 if start<=stamp<end:
  replaced.append(i)
  for y,row in enumerate(frame['precipMmH']):
   for x,v in enumerate(row):
    if v is not None:known_sums[y][x]+=v
  frame['precipMmH']=[[v/6 for v in row] for row in totals]
  frame['temporalQuality']='uniform_allocation_of_observed_six_hour_analysis_not_observed_hourly'
assert len(replaced)==6
for y in range(len(totals)):
 for x in range(len(totals[y])):assert abs(sum(result['frames'][i]['precipMmH'][y][x] for i in replaced)-totals[y][x])<1e-12
for i in range(432):
 if i not in replaced:assert result['frames'][i]==rain['frames'][i]
assert result['frames'][336:]==json.loads((ROOT/'sfincs-reach-stage4-2013-july-96h.json').read_text())['frames']
missing=sum(v is None for f in result['frames'] for row in f['precipMmH'] for v in row);assert missing==0
differences=[totals[y][x]-known_sums[y][x] for y in range(len(totals)) for x in range(len(totals[y]))]
provenance={'schemaVersion':1,'kind':'coarse_accumulation_temporal_allocation','createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),
 'originalForcing':str(original),'originalSha256':original_hash,'originalUnchanged':True,
 'sourceUrl':'https://mesonet.agron.iastate.edu/archive/data/2013/07/16/stage4/ST4.2013071606.06h.grib',
 'sourceFile':str(source),'sourceSha256':hashlib.sha256(source_bytes).hexdigest(),'sourceBytes':len(source_bytes),'metadata':meta,
 'intervalStart':start.isoformat(),'intervalEnd':end.isoformat(),'replacedFrameIndices':replaced,
 'method':'Replace the entire six-hour block with six equal hourly mean rates, each raw six-hour mm total divided by 6 hours. No use of the incomplete hourly sum to infer a missing hour.',
 'sixHourDepthMm':totals,'sixHourMinusKnownFiveHourlyMmRange':[min(differences),max(differences)],
 'interpretation':'The five remaining hourly analyses and six-hour product are not assumed additive or identical; this difference is diagnostic, not the missing-hour rainfall.',
 'limitations':['Six-hour total is an archived analysis; uniform hourly timing is an explicit scenario assumption, not observed hourly rainfall.','This block is several days before the event, which makes coarse timing a practical antecedent scenario; its effects on storage must still be evaluated.','All other 426 frames and the preserved 96-hour event remain exactly unchanged.','No calibration to downstream flow, no automatic rescaling and no missing-to-zero fill.']}
prov_path=ROOT/'stage4-2013-antecedent-six-hour-scenario-provenance.json'
prov_path.write_text(json.dumps(provenance,indent=2,allow_nan=False)+'\n',encoding='utf-8')
result['status']='requires_quality_review';result['missingCellHours']=0
result['sourceQuality']={**result['sourceQuality'],'missingIntervals':[],'forcingReadiness':'explicit_six_hour_uniform_allocation_scenario','temporallyAllocatedHours':6,'nativeBitmapPreserved':'Original hourly bitmap retained in immutable source; six-hour replacement has valid native bitmap'}
result['provenance']={**result['provenance'],'originalManifest':result['provenance']['manifest'],'manifest':str(prov_path),'manifestSha256':hashlib.sha256(prov_path.read_bytes()).hexdigest(),'limitations':result['provenance']['limitations']+provenance['limitations']}
output=ROOT/'sfincs-reach-stage4-2013-july05-23-432h-six-hour-scenario.json'
output.write_text(json.dumps(result,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
assert hashlib.sha256(original.read_bytes()).hexdigest()==original_hash
print(json.dumps({'status':result['status'],'hours':432,'missing':missing,'sixHourRangeMm':[min(map(min,totals)),max(map(max,totals))],'sixHourMinusKnownFiveHourlyMmRange':provenance['sixHourMinusKnownFiveHourlyMmRange'],'replaced':replaced,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
