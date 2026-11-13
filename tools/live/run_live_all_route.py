"""Storm-triggered current runs of the three all-route SFINCS cases (6.25 m road cells).

Each case is the committed, hash-checked prepared case with only its forcing replaced, the same
way run_live_sfincs.py treats the coarse case: a cold start 45 hours before the newest HRRR
cycle, HRRR first-hour rain of each of those cycles, then the cycle's 18-hour forecast, and NWM
analysis then short-range flow at the case's own registry inlets. Mesh, subgrid, roughness,
infiltration, mask and solver settings are unchanged.

  python run_live_all_route.py check OUT.json [THRESHOLD_MM]   # newest cycle; which cases get rain
  python run_live_all_route.py prepare CASE WORK CYCLE           # case + current forcing in WORK
  (run the pinned SFINCS engine in WORK)
  python run_live_all_route.py export CASE WORK OUT              # compact frames for the map
"""
import datetime as dt, gzip, hashlib, io, json, shutil, sys, tarfile
from pathlib import Path
import h5py, numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_live_sfincs import ISO, SPIN, AHEAD, apcp_hour, newest_cycle, nwm_hourly, regrid, utm_to_lonlat
from export_road_forecast import RoadForecast
from native_dry_residuals import load_evidence, verified_engine_source

CASES = Path(__file__).resolve().parent / 'all-route-cases.json'
SHOW_BACK, DTOUT, MARGIN_DEG = 3, 1800, 0.05
sha = lambda b: hashlib.sha256(b).hexdigest()


def case_entry(name):
    for c in json.loads(CASES.read_text())['cases']:
        if c['case'] == name: return c
    raise KeyError(name)


def bbox_lonlat(c):
    x0, y0, x1, y1 = c['bounds32612']
    lon, lat = utm_to_lonlat(np.array([x0, x1, x0, x1]), np.array([y0, y0, y1, y1]))
    return lon.min() - MARGIN_DEG, lat.min() - MARGIN_DEG, lon.max() + MARGIN_DEG, lat.max() + MARGIN_DEG


def check(out, threshold='1.0'):
    """Largest HRRR one-hour rain over each case domain in the newest cycle's 18 hours."""
    cases = json.loads(CASES.read_text())['cases']; threshold = float(threshold)
    cycle = newest_cycle(dt.datetime.now(dt.timezone.utc).replace(tzinfo=None))
    peak = {c['case']: (0.0, None) for c in cases}
    for f in range(1, AHEAD + 1):
        v, la, lo = apcp_hour(cycle, f)
        for c in cases:
            w, s, e, n = bbox_lonlat(c); box = (lo >= w) & (lo <= e) & (la >= s) & (la <= n)
            m = float(v[box].max()) if box.any() else 0.0
            if m > peak[c['case']][0]: peak[c['case']] = (m, f)
    result = {'hrrrCycle': ISO(cycle), 'checkedAt': ISO(dt.datetime.now(dt.timezone.utc)), 'thresholdMmPerHour': threshold,
              'cases': {k: {'maxMmPerHour': round(m, 2), 'forecastHour': f} for k, (m, f) in peak.items()},
              'run': [k for k, (m, _) in peak.items() if m >= threshold]}
    Path(out).write_text(json.dumps(result, indent=1)); print(json.dumps(result))


def unpack(c, work):
    manifest = Path(c['caseManifest']); m = json.loads(manifest.read_text())
    data = b''
    for p in m['parts']:
        part = (manifest.parent / p['path']).read_bytes()
        if len(part) != p['bytes'] or sha(part) != p['sha256']: raise ValueError('Archive part hash mismatch')
        data += part
    if sha(data) != m['archiveSha256'] or m['archiveSha256'] != c['archiveSha256']: raise ValueError('Reassembled case hash mismatch')
    with tarfile.open(fileobj=io.BytesIO(data)) as tf: tf.extractall(work, filter='data')
    if sha((work / 'sfincs.nc').read_bytes()) != c['meshSha256']: raise ValueError('Mesh differs from the pinned case')


def prepare(name, work, cycle_iso):
    c = case_entry(name); work = Path(work); shutil.rmtree(work, ignore_errors=True); work.mkdir(parents=True)
    unpack(c, work)
    cycle = dt.datetime.fromisoformat(cycle_iso.rstrip('Z')); start = cycle - dt.timedelta(hours=SPIN); hours = SPIN + AHEAD
    with h5py.File(work / 'precip_2d.nc', 'r+') as f:
        assert f['time'].shape[0] == hours, f['time'].shape
        x, y = f['x'][:], f['y'][:]; ee, nn = np.meshgrid(x, y); tlon, tlat = utm_to_lonlat(ee, nn)
        native_ok = ('status' in f and np.all(f['status'][()] == 0) and (work / 'solver.log').exists() and 'Simulation finished' in (work / 'solver.log').read_text(errors='replace'))
        road_forecast.native_dry_evidence = load_evidence(work, order, name, native_ok, verified_engine_source(work))
        units = f['time'].attrs['units']; units = units.decode() if isinstance(units, bytes) else str(units)
        new = 'minutes since ' + start.strftime('%Y-%m-%dT%H:%M:%S'); assert len(new) == len(units), (units, new)
        f['time'].attrs['units'] = np.bytes_(new); f['time'][:] = np.arange(hours) * 60.0
        P = f['Precipitation']; sources = []
        for k in range(hours):
            t = start + dt.timedelta(hours=k)
            # Past hours: that hour's own cycle, first hour. Ahead: the newest cycle's forecast.
            src, fh = (t, 1) if t < cycle else (cycle, int((t - cycle).total_seconds() // 3600) + 1)
            v, la, lo = apcp_hour(src, fh); P[k, :, :] = regrid(v, la, lo, tlat, tlon)
            sources.append({'start': ISO(t), 'cycle': ISO(src), 'forecastHour': fh})
        P.attrs['data_role'] = np.bytes_('hrrr_first_hour_then_forecast')
    dis, notes, flow_sources = [], [], []
    for inlet in c['inlets']:
        q, missing = nwm_hourly(inlet['reachId'], start, hours, flow_sources, [i['reachId'] for i in c['inlets']]); dis.append(q)
        if flow_sources[-1]['provider'] == 'NOAA NODD': notes.append(f"NWM reach {inlet['reachId']}: verified NOAA NODD hourly files used because NWPS is unavailable or incomplete")
    with open(work / 'sfincs.dis', 'w') as o:
        for k in range(hours + 1): o.write(f'{k * 3600.0:10.1f} ' + ' '.join(f'{d[k]:12.6f}' for d in dis) + '\n')
    stamp = lambda t: t.strftime('%Y%m%d %H%M%S')
    keys = {'tref': stamp(start), 'tstart': stamp(start), 'tstop': stamp(start + dt.timedelta(hours=hours)),
            't0out': str((SPIN - SHOW_BACK) * 3600), 'dtout': str(DTOUT), 'dtrstout': '0.0'}
    inp = [l for l in (work / 'sfincs.inp').read_text().splitlines()]
    inp = [f'{l.split("=")[0].strip():<20} = {keys[l.split("=")[0].strip()]}' if '=' in l and l.split('=')[0].strip() in keys else l for l in inp]
    (work / 'sfincs.inp').write_text('\n'.join(inp) + '\n')
    meta = {'schemaVersion': 1, 'kind': 'live_all_route_case', 'case': name, 'modelVersion': c['modelVersion'], 'caseArchiveSha256': c['archiveSha256'],
            'hrrrCycle': ISO(cycle), 'start': ISO(start), 'end': ISO(start + dt.timedelta(hours=hours)), 'preparedAt': ISO(dt.datetime.now(dt.timezone.utc)),
            'rainSources': sources, 'flowNotes': notes, 'flowSources': flow_sources, 'inlets': [i['reachId'] for i in c['inlets']],
            'method': f'Prepared all-route case with forcing replaced: cold start {SPIN} h before the HRRR cycle; HRRR first-hour rain of each past cycle, then the cycle\'s {AHEAD} h forecast; NWM analysis then short-range flow at the case\'s registry inlets.'}
    (work / 'live-case.json').write_text(json.dumps(meta, indent=1))
    print(json.dumps({k: meta[k] for k in ('case', 'hrrrCycle', 'start', 'end', 'flowNotes')}))


def pack(path, metadata, columns):
    """Same floodplain-columns-v1 layout as compact_quadtree.pack."""
    blocks, descriptors, offset = [], {}, 0
    for key, values in columns.items():
        data = np.ascontiguousarray(values, dtype='<f4').tobytes()
        descriptors[key] = dict(type='f', offset=offset, count=len(values)); blocks.append(data); offset += len(data)
    header = json.dumps(dict(format='floodplain-columns-v1', metadata=metadata, columns=descriptors), separators=(',', ':')).encode()
    header += b' ' * (-(4 + len(header)) % 8)
    raw = len(header).to_bytes(4, 'little') + header + b''.join(blocks)
    compressed = gzip.compress(raw, compresslevel=6, mtime=0); path.write_bytes(compressed)
    return dict(path=path.name, sha256=sha(compressed), bytes=len(compressed), decodedBytes=len(raw))


def export(name, work, out, run_id=None):
    """Native volume and water surface per frame, in the frozen result's mesh face order."""
    c = case_entry(name); work, out = Path(work), Path(out); out.mkdir(parents=True, exist_ok=True)
    meta = json.loads((work / 'live-case.json').read_text()) if (work / 'live-case.json').exists() else {}
    face = Path(c['faceMapping']['path']); geom = Path(c['geometry']['path'])
    if sha(face.read_bytes()) != c['faceMapping']['sha256'] or sha(geom.read_bytes()) != c['geometry']['sha256']: raise ValueError('Pinned face mapping or geometry changed')
    ids = np.load(face); order = np.argsort(ids)
    if not np.array_equal(ids[order], np.arange(len(ids))): raise ValueError('Face mapping is not a permutation of mesh faces')
    shutil.copyfile(geom, out / 'geometry.bin.gz')
    road_forecast = RoadForecast.load(name, geom, c['geometry']['sha256'])
    run_id = run_id or f"{c['modelVersion']}-live-{meta['hrrrCycle'][:13].replace('-', '').replace('T', '-')}z"
    frames = []
    with h5py.File(work / 'sfincs_map.nc', 'r') as f:
        native_ok = ('status' in f and np.all(f['status'][()] == 0) and (work / 'solver.log').exists() and 'Simulation finished' in (work / 'solver.log').read_text(errors='replace'))
        road_forecast.native_dry_evidence = load_evidence(work, order, name, native_ok, verified_engine_source(work))
        units = f['time'].attrs['units']; units = units.decode() if isinstance(units, bytes) else str(units)
        base = dt.datetime.fromisoformat(units.split('since ')[1].strip().replace(' ', 'T'))
        for i, s in enumerate(f['time'][:]):
            t = ISO(base + dt.timedelta(seconds=float(s))); cols = {}
            for key, var in (('nativeVolumeM3', 'subgrid_volume'), ('waterSurfaceM', 'zs')):
                v = f[var][i].astype('float32'); v[v == np.float32(-99999.0)] = np.nan; cols[key] = v[order]
            frames.append(dict(time=t, **pack(out / f'frame-{i}.bin.gz', {'schemaVersion': 1, 'runId': run_id, 'geometrySha256': c['geometry']['sha256'], 'time': t}, cols)))
            road_forecast.add_frame(t, cols['nativeVolumeM3'], cols['waterSurfaceM'])
        status = [int(v) for v in f['status'][()].ravel()] if 'status' in f else None
        runtime = float(np.ravel(f['total_runtime'][()])[0]) if 'total_runtime' in f else None
    log = (work / 'solver.log').read_text(errors='replace') if (work / 'solver.log').exists() else ''
    finished = 'Simulation finished' in log
    manifest = {'schemaVersion': 1, 'kind': 'quadtree_output_package', 'status': 'complete' if finished else 'partial',
                'runId': run_id, 'case': name, 'modelVersion': c['modelVersion'], 'executionMode': 'live_current_forcing',
                'validFrom': frames[0]['time'] if frames else None, 'validTo': frames[-1]['time'] if frames else None,
                'geometry': {'path': 'geometry.bin.gz', 'sha256': c['geometry']['sha256'], 'bytes': geom.stat().st_size, 'sameAs': c['geometry']['path']},
                'frames': frames, 'quantity': {'name': 'cell_average_depth', 'units': 'm', 'definition': 'Native volume divided by each full native polygon area'},
                'sourceIssues': {'HRRR': meta.get('hrrrCycle'), 'NWM': 'NWPS or verified NOAA NODD analysis then short-range flow; see flowSources', 'mode': 'live'},
                'solverCompletion': {'status': 'complete' if finished else 'not_finished', 'nativeStatus': status, 'nativeRuntimeSeconds': runtime},
                'flowNotes': meta.get('flowNotes', []), 'flowSources': meta.get('flowSources', []), 'caseArchiveSha256': c['archiveSha256'], 'issuedAt': ISO(dt.datetime.now(dt.timezone.utc)),
                'uncertainty': {'status': 'not_quantified', 'plusMinus': None},
                'limits': 'Model forecast from public forcing, not observed water. Cold start: soil and channel state come only from the 45 h warm-up. No bridge or culvert openings. 6.25 m road cells are not validated road depth.'}
    manifest['roadForecast'] = road_forecast.write(out / 'road-forecast.json', manifest)
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    print(json.dumps({k: manifest[k] for k in ('runId', 'status', 'validFrom', 'validTo')} | {'frames': len(frames)}))


if __name__ == '__main__':
    {'check': check, 'prepare': prepare, 'export': export}[sys.argv[1]](*sys.argv[2:])
