"""Archived National Water Model reach flows for the saved forecast runs.

For one NWM short-range cycle (default Nov 1 2026, 13Z and 19Z), download the 18 hourly
channel_rt files from NOAA's public archive (noaa-nwm-pds), keep only the reaches HAND uses, and
write public/inundation/data/run-flows/<runId>.json:

  {schemaVersion:1, runId, source, cycle, units:'m3/s',
   reaches:{"<featureId>":[{time:ISO, flowM3s:number}]}}

Reaches: every distinct reach.featureId across the supported HAND junction files, plus the reach
records in public/inundation/data/nwm/ (24 reaches).

Each download goes into its own new empty folder under %TEMP% and is deleted once read.
Run with: python -I tools/hand/run_flows.py [--date 20261101] [--hours 13 19]
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.request

import h5py
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA = os.path.join(ROOT, 'public', 'inundation', 'data')
URL = 'https://noaa-nwm-pds.s3.amazonaws.com/nwm.{date}/short_range/nwm.t{hh:02d}z.short_range.channel_rt.f{f:03d}.conus.nc'


def hand_reaches():
    cov = json.load(open(os.path.join(DATA, 'coverage.json'), encoding='utf-8'))
    files = sorted({p['file'] for p in cov['points'] if p.get('status') == 'supported' and p.get('file')})
    ids = set()
    for f in files:
        j = json.load(open(os.path.join(DATA, f), encoding='utf-8'))
        rid = (j.get('reach') or {}).get('featureId') or (j.get('forecast') or {}).get('reachId')
        if rid:
            ids.add(str(rid))
    nwm = os.path.join(DATA, 'nwm')
    if os.path.isdir(nwm):
        ids |= {n[:-5] for n in os.listdir(nwm) if n.endswith('.json') and n[:-5].isdigit()}
    return sorted(ids, key=int)


def _attr_str(v):
    if isinstance(v, bytes):
        return v.decode()
    if isinstance(v, np.ndarray):
        v = v.ravel()[0]
        return v.decode() if isinstance(v, bytes) else str(v)
    return str(v)


def read_file(path, wanted):
    """Return (valid time UTC datetime, {reachId: m3/s or None})."""
    with h5py.File(path, 'r') as h:
        valid = None
        if 'model_output_valid_time' in h.attrs:
            valid = dt.datetime.strptime(_attr_str(h.attrs['model_output_valid_time']), '%Y-%m-%d_%H:%M:%S')
        else:
            tv = h['time']
            units = _attr_str(tv.attrs.get('units', b'minutes since 1970-01-01 00:00:00 UTC'))
            n = float(tv[()].ravel()[0])
            step = {'minutes': 60, 'seconds': 1, 'hours': 3600}[units.split()[0]]
            valid = dt.datetime(1970, 1, 1) + dt.timedelta(seconds=n * step)
        fid = h['feature_id'][()].astype(np.int64)
        sv = h['streamflow']
        raw = sv[()]
        fill = sv.attrs.get('_FillValue')
        scale = float(np.ravel(sv.attrs.get('scale_factor', 1.0))[0])
        offset = float(np.ravel(sv.attrs.get('add_offset', 0.0))[0])
        units = _attr_str(sv.attrs.get('units', b''))
        if units and units.replace(' ', '') not in ('m3s-1', 'm3/s'):
            raise SystemExit(f'unexpected streamflow units {units!r}')
        idx = {int(r): i for i, r in enumerate(fid)} if len(wanted) > 50 else None
        out = {}
        for r in wanted:
            hit = np.nonzero(fid == int(r))[0] if idx is None else ([idx[int(r)]] if int(r) in idx else [])
            if len(hit) == 0:
                out[r] = None
                continue
            v = raw[hit[0]]
            if fill is not None and v == np.ravel(fill)[0]:
                out[r] = None
            else:
                out[r] = float(v) * scale + offset
    return valid.replace(tzinfo=dt.timezone.utc), out


def fetch(url, tries=4):
    d = tempfile.mkdtemp(prefix='nwm-', dir=os.environ.get('TEMP') or tempfile.gettempdir())
    path = os.path.join(d, url.rsplit('/', 1)[1])
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r, open(path, 'wb') as f:
                shutil.copyfileobj(r, f, 1 << 20)
            return d, path
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                shutil.rmtree(d, ignore_errors=True)
                raise RuntimeError(f'{url}: {e}') from e
            time.sleep(2 * (k + 1))


def one(url, wanted):
    d, path = fetch(url)
    try:
        return read_file(path, wanted)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def build(date, hh, wanted, out_dir, steps=18, extra=()):
    urls = [URL.format(date=date, hh=hh, f=f) for f in range(1, steps + 1)]
    with cf.ThreadPoolExecutor(4) as ex:
        results = list(ex.map(lambda u: one(u, list(wanted) + list(extra)), urls))
    results.sort(key=lambda r: r[0])
    cycle = dt.datetime.strptime(date, '%Y%m%d').replace(hour=hh, tzinfo=dt.timezone.utc)
    iso = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')
    reaches, missing = {}, []
    for r in wanted:
        pts = [{'time': iso(t), 'flowM3s': round(v[r], 3)} for t, v in results if v[r] is not None]
        if pts:
            reaches[r] = pts
        else:
            missing.append(r)
    run_id = f'{hh:02d}z'
    doc = {
        'schemaVersion': 1,
        'runId': run_id,
        'source': f'NOAA National Water Model short-range forecast, {cycle.strftime("%b")} {cycle.day} {cycle.year} '
                  f'{hh:02d}Z cycle (channel_rt), from the noaa-nwm-pds archive',
        'cycle': iso(cycle),
        'units': 'm3/s',
        'reaches': reaches,
    }
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f'{run_id}.json')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, separators=(',', ':'))
        f.write('\n')
    for r in extra:  # read for comparison only, not stored
        print(f'  extra {r} ({hh:02d}Z): ' + ', '.join(f'{iso(t)[11:16]} {v[r]}' for t, v in results), file=sys.stderr)
    return path, doc, missing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default='20261101')
    ap.add_argument('--hours', type=int, nargs='+', default=[13, 19])
    ap.add_argument('--extra', nargs='*', default=['15902351', '15902361'], help='reaches printed for comparison, not stored')
    ap.add_argument('--out', default=os.path.join(DATA, 'run-flows'))
    a = ap.parse_args()
    wanted = hand_reaches()
    print(f'{len(wanted)} reaches', file=sys.stderr)
    for hh in a.hours:
        path, doc, missing = build(a.date, hh, wanted, a.out, extra=[r for r in a.extra if r not in wanted])
        print(f'{path}: {len(doc["reaches"])} reaches, {os.path.getsize(path)} bytes'
              + (f', missing {missing}' if missing else ''))
        for r, pts in doc['reaches'].items():
            pk = max(pts, key=lambda p: p['flowM3s'])
            print(f'  {r}: peak {pk["flowM3s"] / 0.028316846592:.1f} ft3/s at {pk["time"]}')


if __name__ == '__main__':
    main()
