"""Validation only: NWM analysis_assim tm00 streamflow (and nudge) for the crosswalk reaches over an arbitrary hourly span.
Adapted from tools/sfincs/fetch_frozen_nwm.py (same HTTP range reads, same ordering and validity checks).

  python tools/sfincs/brawley/fetch_nwm_validation_aa.py --crosswalk <crosswalk.json> --output <dir> --start 2026-11-01T15 --hours 17
"""
import argparse, json
from pathlib import Path
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
import requests, fsspec, xarray as xr, numpy as np

def main():
    p = argparse.ArgumentParser(); p.add_argument('--output', type=Path, required=True); p.add_argument('--crosswalk', type=Path, required=True)
    p.add_argument('--start', required=True); p.add_argument('--hours', type=int, required=True); a = p.parse_args(); a.output.mkdir(parents=True, exist_ok=True)
    cross = json.loads(a.crosswalk.read_text()); ids = list(cross['indices']); indices = [cross['indices'][k] for k in ids]
    t0 = datetime.strptime(a.start, '%Y-%m-%dT%H').replace(tzinfo=timezone.utc)
    times = [t0 + timedelta(hours=i) for i in range(a.hours)]
    def read(t):
        url = f'https://noaa-nwm-pds.s3.amazonaws.com/nwm.{t:%Y%m%d}/analysis_assim/nwm.t{t:%H}z.analysis_assim.channel_rt.tm00.conus.nc'
        path = a.output / f'aa-{t:%Y%m%dT%H}.json'
        if path.exists(): return json.loads(path.read_text())
        head = requests.head(url, timeout=30); head.raise_for_status()
        with fsspec.open(url, mode='rb', block_size=262144).open() as f:
            with xr.open_dataset(f, engine='h5netcdf', decode_times=False) as ds:
                if not np.array_equal(ds.feature_id.isel(feature_id=indices).values, np.array(ids, dtype='int64')): raise ValueError('Archive feature ordering changed')
                q = ds.streamflow.isel(feature_id=indices).values
                nudge = ds.nudge.isel(feature_id=indices).values if 'nudge' in ds else None
                if ds.streamflow.attrs.get('units') != 'm3 s-1' or not np.isfinite(q).all() or (q < 0).any(): raise ValueError('Missing/invalid native flow')
                valid = ds.attrs['model_output_valid_time']; issue = ds.attrs['model_initialization_time']
        r = {'url': url, 'etag': head.headers.get('ETag'), 'contentLength': head.headers.get('Content-Length'), 'issuedAt': issue.replace('_', 'T') + 'Z', 'time': valid.replace('_', 'T') + 'Z',
             'units': 'm3/s', 'values': {k: float(v) for k, v in zip(ids, q)}, 'nudge': None if nudge is None else {k: float(v) for k, v in zip(ids, nudge)}}
        path.write_text(json.dumps(r, indent=2) + '\n', encoding='utf-8'); print(r['time'], flush=True); return r
    with ThreadPoolExecutor(max_workers=3) as pool: frames = list(pool.map(read, times))
    out = {'schemaVersion': 1, 'kind': 'validation_analysis', 'note': 'Validation only; not case forcing.', 'series': [{'reachId': k, 'units': 'm3/s', 'points': [{'time': f['time'], 'flowM3s': f['values'][k], 'nudgeM3s': (f['nudge'] or {}).get(k)} for f in frames]} for k in ids], 'sourceFrames': frames}
    (a.output / 'series.json').write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8'); print(len(frames), frames[0]['time'], frames[-1]['time'])

if __name__ == '__main__': main()
