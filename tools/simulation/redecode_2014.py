"""Reinterpret preserved bytes using audited historical encoding; never fit a scale."""
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
from PIL import Image
from iem_profiles import PROFILE,SOURCES,WARNING,legacy2014_mm

OLD=Path('public/simulation/data/storm-2014');OUT=Path('public/simulation/data/storm-2014-legacy');CACHE=Path('../rainfall-cache')
OUT.mkdir(exist_ok=True)
def save(p,v):p.write_text(json.dumps(v,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
original=json.loads((OLD/'manifest.json').read_text(encoding='utf-8'));m=copy.deepcopy(original);g=m['grid']
g.update(west=round(g['west']+.005,3),north=round(g['north']-.005,3),georeferenceProfile='native-centers-explicit-half-cell-correction',originalWorldFileCenters=[-130,55],nativeFirstPixelCenters=[-129.995,54.995],geometrySource=SOURCES['gridFix'])
arrays=[];valid_count=0
for entry in m['hours']:
    raw=entry['sources'][0];p=CACHE/raw['url'].split('/')[-1]
    if hashlib.sha256(p.read_bytes()).hexdigest()!=raw['sha256']:raise ValueError('Original PNG changed')
    with Image.open(p) as image:
        if image.mode!='P':raise ValueError('Not an indexed PNG')
        indices=list(image.crop((g['sourceCol'],g['sourceRow'],g['sourceCol']+g['cols'],g['sourceRow']+g['rows'])).get_flattened_data())
    values=[legacy2014_mm(i) for i in indices];arrays.append(values);valid=[v for v in values if v is not None];valid_count+=len(valid)
    save(OUT/entry['file'],{'schemaVersion':1,'start':entry['start'],'end':entry['end'],'units':'mm','profile':PROFILE,'depthMm':values})
    entry.update(status='partial' if len(valid)<len(values) else 'complete',sha256=hashlib.sha256((OUT/entry['file']).read_bytes()).hexdigest(),validCells=len(valid),missingCells=len(values)-len(valid),minimumMm=min(valid) if valid else None,maximumMm=max(valid) if valid else None)
for check in m['dailyCrossChecks']:
    (OUT/check['file']).write_bytes((OLD/check['file']).read_bytes())
    check['status']='not_a_complete_hourly_sum';check['priorDocumentedPaletteComparison']=copy.deepcopy(next(c for c in original['dailyCrossChecks'] if c['end']==check['end']))
    for k in ['meanHourlyMinusDailyMm','maxAbsoluteDifferenceMm','comparedCells','excludedCells']:check.pop(k,None)
    check['interpretation']='Hourly zero/missing ambiguity prevents a complete pixel-total comparison. Positive-sample sums are lower-bound reconstructions, not complete rainfall totals. See rainfall-source-audit.json.'
m.update(createdAt=dt.datetime.now(dt.timezone.utc).isoformat(),originalDerivationCreatedAt=original['createdAt'],profile=PROFILE,profileSources=SOURCES,title='September 2014 source-corrected legacy rainfall (incomplete)',method='Nonzero PNG byte interpreted as integer mm per historical writer; zero/255 -> null. No fitted multiplier. Native centers explicitly shifted +0.005 longitude and -0.005 latitude; original world files and obsolete decode retained.',domain='Native-center regional crop: -111.695 to -110.495 longitude, 32.795 to 31.695 latitude. Not a delineated basin.',limitations=[WARNING,'Historical half-cell correction is explicit; old geometry remains available for sensitivity comparisons.','No user-owned sensors required: independent existing public data can supply validation.'])
m['quality']={'requestedHours':72,'availableHours':72,'completeHours':sum(e['missingCells']==0 for e in m['hours']),'presentCellHours':72*g['rows']*g['cols'],'usableNonzeroCellHours':valid_count,'unknownZeroOrMissingCellHours':72*g['rows']*g['cols']-valid_count,'forcingReadiness':'incomplete_legacy_missing_mask','missingHours':[],'reviewNote':'All files present, but missing coverage cannot be recovered from zeros. Previous claim of 967032 valid cell-hours is retracted.'}
m['solverDomain']={'geographicBounds':[-111.34,32.40,-111.27,32.49],'projectedCRS':'EPSG:32612','projectedBounds':[468000,3584800,474700,3594900],'shape':[101,67],'cellSizeM':100,'source':'SFINCS worker handoff, commit 3061607e5a24389fbefcc15aef95e6db57f2b5af','terrainVerticalDatum':'USGS catalog NAVD88; rainfall has no elevation datum'}
save(OUT/'manifest.json',m)
original['quality'].update(obsoleteInterpretation=True,forcingReadiness='obsolete_wrong_historical_palette',completeHours=0,reviewNote='Obsolete modern-palette interpretation of 2014 hourly bytes; do not use as rainfall forcing. Zero/missing ambiguity invalidates prior complete-valid-coverage claim. Use ../storm-2014-legacy/manifest.json for the versioned incomplete reconstruction.')
save(OLD/'manifest.json',original)
print(json.dumps(m['quality']))
