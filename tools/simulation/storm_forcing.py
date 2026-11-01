"""Solver-neutral georeferenced forcing adapter; no SFINCS execution or missing fill."""
import argparse
import hashlib
import json
import math
from pathlib import Path

def load_forcing(manifest_path,bbox=None,require_complete=True):
    path=Path(manifest_path);manifest=json.loads(path.read_text(encoding='utf-8'));g=manifest['grid']
    if manifest.get('quality',{}).get('obsoleteInterpretation'):raise ValueError('Obsolete historical palette interpretation; use storm-2014-legacy')
    if manifest['kind']!='radar_rainfall_forcing' or not g or g['crs']!='EPSG:4326' or g['pixelReference']!='center':raise ValueError('Unsupported grid/forcing')
    lon=[g['west']+i*g['dx'] for i in range(g['cols'])];lat=[g['north']+i*g['dy'] for i in range(g['rows'])]
    if bbox:
        west,south,east,north=bbox
        if west>=east or south>=north or west<min(lon)-1e-8 or east>max(lon)+1e-8 or south<min(lat)-1e-8 or north>max(lat)+1e-8:raise ValueError('Requested domain outside regional center coverage')
    else:west,south,east,north=min(lon),min(lat),max(lon),max(lat)
    cols=[i for i,x in enumerate(lon) if west-1e-8<=x<=east+1e-8];rows=[i for i,y in enumerate(lat) if south-1e-8<=y<=north+1e-8]
    if not rows or not cols:raise ValueError('No source cell centers in requested domain')
    frames=[];last_end=None;missing=0
    for entry in manifest['hours']:
        if last_end is not None and entry['start']!=last_end:raise ValueError('Noncontiguous hourly intervals')
        last_end=entry['end']
        if entry['durationMinutes']!=60:raise ValueError('Only nonoverlapping one-hour forcing supported')
        if entry['status']=='unavailable':values=[None]*(g['rows']*g['cols'])
        else:
            source=(path.parent/entry['file']).read_bytes()
            if hashlib.sha256(source).hexdigest()!=entry['sha256']:raise ValueError('Forcing frame hash mismatch')
            frame=json.loads(source);values=frame['depthMm']
            if frame['start']!=entry['start'] or frame['end']!=entry['end'] or frame['units']!='mm' or len(values)!=g['rows']*g['cols']:raise ValueError('Frame shape/interval/unit mismatch')
            if any(v is not None and (not isinstance(v,(int,float)) or not math.isfinite(v) or v<0) for v in values):raise ValueError('Invalid rainfall')
        cropped=[[values[r*g['cols']+c] for c in cols] for r in rows]
        missing+=sum(v is None for row in cropped for v in row)
        frames.append({'start':entry['start'],'end':entry['end'],'precipMmH':cropped})
    if missing and require_complete:raise ValueError(f'{missing} missing cell-hours in requested domain; forcing is incomplete, no zero fill')
    return {'schemaVersion':1,'kind':'spatial_hourly_rainfall_forcing','status':'requires_quality_review' if missing==0 and manifest.get('quality',{}).get('forcingReadiness')=='unverified_cross_product_difference' else ('complete' if missing==0 else 'insufficient_data'),'crs':'EPSG:4326','lon':[lon[c] for c in cols],'lat':[lat[r] for r in rows],'dimensions':['time','lat','lon'],'units':'mm/h','timeConvention':'Frame start inclusive, end exclusive; constant mean rate for exactly one hour','missingCellHours':missing,'sourceQuality':manifest.get('quality',{}),'frames':frames,'provenance':{'manifest':str(path),'manifestSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'source':'IEM MRMS radar estimates','spatialMethod':'Source cell centers selected inside requested bbox; no interpolation/reprojection','limitations':manifest['limitations']}}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--manifest',default='public/simulation/data/storm-2014-legacy/manifest.json');p.add_argument('--bbox',nargs=4,type=float);p.add_argument('--allow-missing',action='store_true');p.add_argument('--output',required=True);a=p.parse_args()
    result=load_forcing(a.manifest,a.bbox,not a.allow_missing)
    Path(a.output).write_text(json.dumps(result,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
    print(result['status'],len(result['frames']),'hours',len(result['lat']),'rows',len(result['lon']),'cols',result['missingCellHours'],'missing cell-hours')
