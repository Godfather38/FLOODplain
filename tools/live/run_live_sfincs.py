"""One current SFINCS run of the original 29,685-cell model, from the newest public forcing.

Each run stands alone: a cold start 45 hours before the newest HRRR cycle, warmed up on the
HRRR first-hour rain of each of those 45 cycles and the NWM analysis flows, then the newest
HRRR 18-hour rain forecast and the NWM short-range flow forecast. Geometry, subgrid, roughness,
infiltration, mask and solver settings are the stress case's, unchanged (the 19Z case's).

  python run_live_sfincs.py prepare CASE_TAR WORK      # fetch forcing, write the case
  (run the pinned SFINCS engine in WORK)
  python run_live_sfincs.py export WORK OUT            # water, rain and inflow for the app
"""
import datetime as dt, gzip, hashlib, json, shutil, sys, tarfile, time, urllib.request
from pathlib import Path
import h5py, numpy as np

HRRR = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.{d}/conus/hrrr.t{h:02d}z.wrfsfcf{f:02d}.grib2'
NWM = 'https://api.water.noaa.gov/nwps/v1/reaches/{r}/streamflow?series={s}'
REACHES = [('15902351', 'Santa Cruz River'), ('15902361', 'NWM reach 15902361')]  # sfincs.src order
SPIN, AHEAD, SHOW_BACK = 45, 18, 6
FT3 = 0.0283168466
ISO = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')


def get(url, headers=None, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=60) as r:
                return r.read()
        except Exception as e:
            if k == tries - 1: raise RuntimeError(f'{url}: {e}')
            time.sleep(5 * (k + 1))


def newest_cycle(now):
    # The newest cycle whose 18-hour file is out; HRRR runs every hour, a little over an hour late.
    for back in range(1, 6):
        c = (now - dt.timedelta(hours=back)).replace(minute=0, second=0, microsecond=0)
        try:
            get(HRRR.format(d=c.strftime('%Y%m%d'), h=c.hour, f=AHEAD) + '.idx'); return c
        except RuntimeError: continue
    raise RuntimeError('No HRRR cycle with an 18-hour forecast in the last 5 hours')


def apcp_hour(cycle, f):
    """mm in hour f-1..f of this cycle, as (values, lat, lon) on the HRRR grid."""
    import eccodes
    url = HRRR.format(d=cycle.strftime('%Y%m%d'), h=cycle.hour, f=f)
    lines = get(url + '.idx').decode().splitlines()
    want = f':APCP:surface:{f-1}-{f} hour acc'
    k = next(i for i, l in enumerate(lines) if want in l)
    a = int(lines[k].split(':')[1]); b = int(lines[k + 1].split(':')[1]) - 1 if k + 1 < len(lines) else ''
    raw = get(url, {'Range': f'bytes={a}-{b}'})
    h = eccodes.codes_new_from_message(raw)
    try:
        return (eccodes.codes_get_values(h), eccodes.codes_get_array(h, 'latitudes'), eccodes.codes_get_array(h, 'longitudes') - 360)
    finally:
        eccodes.codes_release(h)


def regrid(values, lat, lon, tlat, tlon):
    """Inverse-distance from the four nearest HRRR points (3 km) to each model rain point (1 km)."""
    box = (lat > tlat.min() - .1) & (lat < tlat.max() + .1) & (lon > tlon.min() - .1) & (lon < tlon.max() + .1)
    sv, sl, so = values[box], lat[box], lon[box]
    out = np.empty(tlat.shape)
    for i in np.ndindex(tlat.shape):
        d = np.hypot((so - tlon[i]) * 94.0, (sl - tlat[i]) * 111.0)
        n = np.argsort(d)[:4]; w = 1 / np.maximum(d[n], .05)
        out[i] = float((sv[n] * w).sum() / w.sum())
    return np.maximum(out, 0)


def utm_to_lonlat(e, n):
    # Inverse UTM zone 12N (WGS84), the same series as public/preview/geo3d/src/utm.js.
    a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
    es = f * (2 - f); ep = es / (1 - es); x = e - 500000.0; m = n / k0
    mu = m / (a * (1 - es / 4 - 3 * es ** 2 / 64 - 5 * es ** 3 / 256))
    e1 = (1 - np.sqrt(1 - es)) / (1 + np.sqrt(1 - es))
    p = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * np.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * np.sin(4 * mu) + 151 * e1 ** 3 / 96 * np.sin(6 * mu)
    c = ep * np.cos(p) ** 2; t = np.tan(p) ** 2; nn = a / np.sqrt(1 - es * np.sin(p) ** 2); r = a * (1 - es) / (1 - es * np.sin(p) ** 2) ** 1.5; d = x / (nn * k0)
    lat = p - nn * np.tan(p) / r * (d ** 2 / 2 - (5 + 3 * t + 10 * c - 4 * c ** 2 - 9 * ep) * d ** 4 / 24 + (61 + 90 * t + 298 * c + 45 * t ** 2 - 252 * ep - 3 * c ** 2) * d ** 6 / 720)
    lon = (d - (1 + 2 * t + c) * d ** 3 / 6 + (5 - 2 * c + 28 * t - 3 * c ** 2 + 8 * ep + 24 * t ** 2) * d ** 5 / 120) / np.cos(p)
    return np.degrees(lon) - 111.0, np.degrees(lat)


def nwm_hourly(reach, start, hours):
    """m3/s at start, start+1h, ... from NWM analysis (past) then short range (ahead)."""
    flows = {}
    for series, key in (('analysis_assimilation', 'analysisAssimilation'), ('short_range', 'shortRange')):
        d = json.loads(get(NWM.format(r=reach, s=series)))[key]['series']
        unit = FT3 if 'ft' in (d.get('units') or 'ft') else 1.0
        for p in d['data']:
            if p['flow'] is not None and p['flow'] >= 0: flows[p['validTime'][:13]] = p['flow'] * unit
    out, missing = [], 0
    for k in range(hours + 1):
        t = (start + dt.timedelta(hours=k)).strftime('%Y-%m-%dT%H')
        if t in flows: out.append(flows[t])
        else: out.append(out[-1] if out else 0.0); missing += 1
    return out, missing


def prepare(case_tar, work):
    work = Path(work); shutil.rmtree(work, ignore_errors=True); work.mkdir(parents=True)
    with tarfile.open(case_tar) as tf: tf.extractall(work, filter='data')
    cycle = newest_cycle(dt.datetime.now(dt.timezone.utc).replace(tzinfo=None))
    start = cycle - dt.timedelta(hours=SPIN); hours = SPIN + AHEAD
    with h5py.File(work / 'precip_2d.nc', 'r+') as f:
        assert f['time'].shape[0] == hours
        x, y = f['x'][:], f['y'][:]; ee, nn = np.meshgrid(x, y); tlon, tlat = utm_to_lonlat(ee, nn)
        units = f['time'].attrs['units'].decode() if isinstance(f['time'].attrs['units'], bytes) else str(f['time'].attrs['units'])
        new = 'minutes since ' + start.strftime('%Y-%m-%dT%H:%M:%S')
        assert len(new) == len(units), (units, new)
        f['time'].attrs['units'] = np.bytes_(new)
        f['time'][:] = np.arange(hours) * 60.0
        P = f['Precipitation']; sources = []
        for k in range(hours):
            t = start + dt.timedelta(hours=k)
            # Past hours: that hour's own cycle, first hour. Ahead: the newest cycle's forecast.
            c, fh = (t, 1) if t < cycle else (cycle, int((t - cycle).total_seconds() // 3600) + 1)
            if t < cycle: c = t
            v, la, lo = apcp_hour(c, fh)
            P[k, :, :] = regrid(v, la, lo, tlat, tlon)
            sources.append({'start': ISO(t), 'cycle': ISO(c), 'forecastHour': fh})
        f['Precipitation'].attrs['data_role'] = np.bytes_('hrrr_first_hour_then_forecast')
    dis, notes = [], []
    for reach, name in REACHES:
        q, missing = nwm_hourly(reach, start, hours); dis.append(q)
        if missing: notes.append(f'{name}: {missing} of {hours + 1} hours carried from the nearest earlier hour')
    with open(work / 'sfincs.dis', 'w') as o:
        for k in range(hours + 1): o.write(f'{k * 3600.0:10.1f} ' + ' '.join(f'{d[k]:9.3f}' for d in dis) + '\n')
    inp = (work / 'sfincs.inp').read_text().splitlines()
    stamp = lambda t: t.strftime('%Y%m%d %H%M%S')
    keys = {'tref': stamp(start), 'tstart': stamp(start), 'tstop': stamp(start + dt.timedelta(hours=hours)), 'dtrstout': '0.0'}
    inp = [f'{l.split("=")[0].strip():<20} = {keys[l.split("=")[0].strip()]}' if '=' in l and l.split('=')[0].strip() in keys else l for l in inp]
    (work / 'sfincs.inp').write_text('\n'.join(inp) + '\n')
    meta = {'schemaVersion': 1, 'kind': 'live_sfincs_case', 'hrrrCycle': ISO(cycle), 'start': ISO(start), 'end': ISO(start + dt.timedelta(hours=hours)),
            'preparedAt': ISO(dt.datetime.now(dt.timezone.utc)), 'rainSources': sources, 'flowNotes': notes,
            'method': f'Cold start {SPIN} h before the HRRR cycle; HRRR first-hour rain of each past cycle, then the cycle\'s {AHEAD} h forecast; NWM analysis then short-range flow at the two model inlets.'}
    (work / 'live-case.json').write_text(json.dumps(meta, indent=1))
    print(json.dumps({k: meta[k] for k in ('hrrrCycle', 'start', 'end', 'flowNotes')}))


def export(work, out):
    work, out = Path(work), Path(out); out.mkdir(parents=True, exist_ok=True)
    meta = json.loads((work / 'live-case.json').read_text()); cycle = dt.datetime.fromisoformat(meta['hrrrCycle'][:-1])
    mask = np.load(work / 'active-mask.npy').astype(bool)
    with h5py.File(work / 'sfincs_map.nc', 'r') as f:
        units = f['time'].attrs['units']; units = units.decode() if isinstance(units, bytes) else str(units)
        base = dt.datetime.fromisoformat(units.split('since ')[1].strip().replace(' ', 'T'))
        times = [base + dt.timedelta(seconds=float(s)) for s in f['time'][:]]
        frames = []
        for i, t in enumerate(times):
            if cycle - dt.timedelta(hours=SHOW_BACK) <= t <= cycle + dt.timedelta(hours=AHEAD):
                z = f['zs'][i][mask]
                frames.append({'time': ISO(t), 'surfaceM': [round(float(v), 3) if np.isfinite(v) else None for v in z]})
    run_id = 'live-' + cycle.strftime('%Y%m%d-%H') + 'z'
    water = {'schemaVersion': 1, 'runId': run_id, 'cellOrder': 'active-mask row-major, the order of frozen-terrain-display.json.gz vertices', 'frames': frames}
    (out / 'water.json.gz').write_bytes(gzip.compress(json.dumps(water, separators=(',', ':'), allow_nan=False).encode(), mtime=0))
    with h5py.File(work / 'precip_2d.nc', 'r') as f:
        x, y, P = f['x'][:], f['y'][:], f['Precipitation'][:]
    start = dt.datetime.fromisoformat(meta['start'][:-1]); rframes = []
    for k in range(P.shape[0]):
        t = start + dt.timedelta(hours=k)
        if cycle - dt.timedelta(hours=SHOW_BACK) <= t < cycle + dt.timedelta(hours=AHEAD):
            rframes.append({'start': ISO(t), 'end': ISO(t + dt.timedelta(hours=1)), 'precipMmH': [[round(float(v), 2) for v in row] for row in P[k]]})
    (out / 'rainfall.json').write_text(json.dumps({'schemaVersion': 1, 'runId': run_id, 'units': 'mm/h', 'crs': 'EPSG:32612', 'intervalLabel': 'start', 'x': [round(float(v), 2) for v in x], 'y': [round(float(v), 2) for v in y], 'frames': rframes}, separators=(',', ':')))
    src = [list(map(float, l.split())) for l in (work / 'sfincs.src').read_text().split('\n') if l.strip()]
    dis = [list(map(float, l.split())) for l in (work / 'sfincs.dis').read_text().split('\n') if l.strip()]
    series = []
    for k, ((e, n), (reach, name)) in enumerate(zip(src, REACHES)):
        lon, lat = utm_to_lonlat(np.array(e), np.array(n))
        series.append({'reachId': reach, 'name': name, 'lon': round(float(lon), 6), 'lat': round(float(lat), 6),
                       'points': [{'time': ISO(start + dt.timedelta(seconds=r[0])), 'flowM3s': r[k + 1]} for r in dis if cycle - dt.timedelta(hours=SHOW_BACK) <= start + dt.timedelta(seconds=r[0]) <= cycle + dt.timedelta(hours=AHEAD)]})
    (out / 'inflow.json').write_text(json.dumps({'schemaVersion': 1, 'runId': run_id, 'units': 'm3/s', 'series': series}))
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    log = (work / 'solver.log').read_text(errors='replace') if (work / 'solver.log').exists() else ''
    manifest = {'schemaVersion': 1, 'kind': 'live_sfincs_run', 'runId': run_id, 'hrrrCycle': meta['hrrrCycle'], 'issuedAt': ISO(dt.datetime.now(dt.timezone.utc)),
                'firstFrame': frames[0]['time'], 'lastFrame': frames[-1]['time'], 'frameCount': len(frames), 'finished': 'Simulation finished' in log,
                'method': meta['method'], 'flowNotes': meta['flowNotes'],
                'limits': 'Model forecast from public forcing, not observed water. Cold start: soil and channel state come only from the 45 h warm-up. No bridge or culvert openings. 100 m cells.',
                'files': {p.name: {'sha256': sha(p), 'bytes': p.stat().st_size} for p in out.iterdir() if p.name != 'manifest.json'}}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=1))
    print(json.dumps({k: manifest[k] for k in ('runId', 'firstFrame', 'lastFrame', 'frameCount', 'finished')}))


if __name__ == '__main__':
    {'prepare': prepare, 'export': export}[sys.argv[1]](*sys.argv[2:])
