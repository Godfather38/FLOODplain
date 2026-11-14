"""Build saved design-storm display packages from complete native all-route output.

Input: SOURCE/{stress,extreme}/{northern,picture-rocks,gates}/compact/.
Output: OUT/all-route-{stress,extreme}/ in openAllRoute's FPQW format.
No solver is run, no live output is accepted, and no missing case/frame is invented.
See DISPLAY-PACKAGES.md for provenance, unknown-value and forcing contracts.
"""
import argparse
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import io
import json
from pathlib import Path
import struct
import sys

import numpy as np

CASE_ORDER = ['northern', 'picture-rocks', 'gates']
SCENARIOS = {
    'stress': (100, '700b8de5b82101affbbe8bdbdbd941fc1e83adfedc63c9ae00a7ee354e029fa0'),
    'extreme': (1000, '3e69143a474cbe022158f404d98b938a41eac1e67ba30a2f9c3f23902fd92ca0'),
}
UNIT, BLOCK_M, WET_M, WET_SUMMARY_M = 6.25, 50, 0.005, 0.0091
START = datetime(2026, 11, 1, 17, tzinfo=timezone.utc)
TIMES = [(START + timedelta(seconds=900 * i)).strftime('%Y-%m-%dT%H:%M:%SZ') for i in range(57)]
MODE = 'synthetic_design_storm'
ENGINE_COMMIT = 'f3647fc0289bb15cb2512d60686cef74cb853c78'
REGISTRY = Path(__file__).resolve().parents[1] / 'live/all-route-cases.json'
DTYPES = {'d': '<f8', 'f': '<f4', 'I': '<u4', 'u4': '<u4', 'i4': '<i4', 'u1': 'u1', 'i1': 'i1', 'i2': '<i2'}


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def json_load(raw):
    def invalid(value):
        raise ValueError('Non-finite JSON number: ' + value)
    return json.loads(raw, parse_constant=invalid)


def json_bytes(value):
    return (json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n').encode()


def parse(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None, 'Timestamp must include a timezone')
    return result.astimezone(timezone.utc)


def iso(value):
    return value.strftime('%Y-%m-%dT%H:%M:%SZ')


def file_bytes(folder, descriptor, field='path'):
    name = descriptor.get(field)
    require(isinstance(name, str) and name and Path(name).name == name and '/' not in name and '\\' not in name,
            'Unsafe or absent package file name')
    raw = (folder / name).read_bytes()
    require(descriptor.get('bytes') == len(raw) and descriptor.get('sha256') == sha(raw),
            'File checksum or byte count differs: ' + name)
    return raw


def read_columns(blob):
    raw = gzip.decompress(blob)
    require(len(raw) >= 4, 'Truncated native header')
    size = struct.unpack('<I', raw[:4])[0]
    require(2 <= size <= len(raw) - 4, 'Invalid native header size')
    header = json_load(raw[4:4 + size])
    require(header.get('format') == 'floodplain-columns-v1', 'Unexpected native binary format')
    columns = {}
    for name, col in header['columns'].items():
        dtype = np.dtype(DTYPES[col['type']])
        offset, count = col['offset'], col['count']
        require(isinstance(offset, int) and isinstance(count, int) and min(offset, count) >= 0
                and 4 + size + offset + count * dtype.itemsize <= len(raw), 'Invalid column: ' + name)
        columns[name] = np.frombuffer(raw, dtype=dtype, count=count, offset=4 + size + offset)
    return header.get('metadata', {}), columns


def read_cells(raw):
    raw = gzip.decompress(raw)
    require(raw[:4] == b'FPQW', 'Unexpected display geometry format')
    size = struct.unpack('<I', raw[4:8])[0]
    require(2 <= size <= len(raw) - 8, 'Invalid display geometry header')
    header = json_load(raw[8:8 + size]); body = raw[8 + size:]
    count, routes = header['count'], header['routeCells']
    require(header['format'] == 'floodplain-quad-cells-v1' and count > 0 and routes >= 0
            and len(body) == 6 * count + (-2 * count) % 4 + 4 * routes, 'Invalid display geometry body')
    ix = np.frombuffer(body, '<u2', count, 0).astype(np.int64)
    iy = np.frombuffer(body, '<u2', count, 2 * count).astype(np.int64)
    level = np.frombuffer(body, 'u1', count, 4 * count).astype(np.int64)
    flags = np.frombuffer(body, 'u1', count, 5 * count)
    route = np.frombuffer(body, '<u4', routes, 6 * count + (-2 * count) % 4).astype(np.int64)
    require(np.all(route < count) and np.all(np.diff(route) > 0) and np.all(level <= 4),
            'Invalid route indices or native cell levels')
    return header, ix, iy, level, flags, route


def web_mapping(full, web):
    """Recover the original saved builder's keep/join mapping, without resampling."""
    _, fx, fy, fl, ff, fr = full; _, wx, wy, wl, wf, wr = web
    key = lambda x, y, level: (y * 65536 + x) * 16 + level
    native = key(fx, fy, fl); order = np.argsort(native); sorted_native = native[order]
    require(np.all(np.diff(sorted_native) > 0), 'Duplicate native display cells')
    wkey = key(wx, wy, wl); pos = np.searchsorted(sorted_native, wkey)
    clipped = np.minimum(pos, len(order) - 1)
    is_native = (pos < len(order)) & (sorted_native[clipped] == wkey)
    n_keep = int(is_native.sum())
    require(is_native[:n_keep].all() and not is_native[n_keep:].any(), 'Web cells must be native cells then blocks')
    keep = order[clipped[:n_keep]]
    require(np.all(np.diff(keep) > 0), 'Kept web cells must retain native face order')
    join = np.ones(len(fx), bool); join[keep] = False
    per = int(BLOCK_M / UNIT); block_level = int(np.log2(per))
    require((wl[n_keep:] == block_level).all() and (fl[join] < block_level).all(), 'Unexpected web block sizes')
    bkey = lambda x, y: (y // per) * 100000 + x // per
    blocks = bkey(wx[n_keep:], wy[n_keep:]); joined = bkey(fx[join], fy[join])
    require(np.all(np.diff(blocks) > 0), 'Web blocks must be unique and sorted')
    inverse = np.searchsorted(blocks, joined)
    require(not len(joined) or (len(blocks) and np.all(inverse < len(blocks))
            and np.array_equal(blocks[inverse], joined)), 'A joined cell has no web block')
    area = (UNIT * 2.0 ** fl) ** 2
    require(np.array_equal(np.bincount(inverse, weights=area[join], minlength=len(blocks)),
                           np.full(len(blocks), BLOCK_M ** 2)), 'Web blocks must contain complete native area')
    expected_flags = np.zeros(len(blocks), np.uint8)
    np.bitwise_or.at(expected_flags, inverse, ff[join])
    require(np.array_equal(ff[keep], wf[:n_keep]) and np.array_equal(expected_flags, wf[n_keep:]),
            'Saved overlap flags differ from their native members')
    require(np.all(wr < n_keep) and np.array_equal(keep[wr], fr), 'Web route cells must retain exact native identity')
    return keep, join, inverse, len(blocks)


def to_utm(lon, lat):
    """Same UTM 12N series used by the existing all-route saved builder."""
    a, f, k0 = 6378137, 1 / 298.257223563, .9996
    e2 = f * (2 - f); ep2 = e2 / (1 - e2)
    p = np.radians(lat); l = np.radians(np.asarray(lon, float) + 111)
    s, c, t = np.sin(p), np.cos(p), np.tan(p)
    mer = a * ((1-e2/4-3*e2*e2/64-5*e2**3/256)*p
        - (3*e2/8+3*e2*e2/32+45*e2**3/1024)*np.sin(2*p)
        + (15*e2*e2/256+45*e2**3/1024)*np.sin(4*p)-(35*e2**3/3072)*np.sin(6*p))
    n = a / np.sqrt(1-e2*s*s); tt = t*t; cc = ep2*c*c; aa = c*l
    east = 500000+k0*n*(aa+(1-tt+cc)*aa**3/6+(5-18*tt+tt*tt+72*cc-58*ep2)*aa**5/120)
    north = k0*(mer+n*t*(aa*aa/2+(5-tt+9*cc+4*cc*cc)*aa**4/24+(61-58*tt+tt*tt+600*cc-330*ep2)*aa**6/720))
    return east, north


def validate_geometry(metadata, geometry, full, info):
    header, ix, iy, level, _, _ = full
    count = info['nativeCells']; ids = metadata.get('nativeFaceIds', [])
    require(count == len(ix) == len(ids) and all(value == str(i) for i, value in enumerate(ids)),
            'Native face count/order differs from saved geometry')
    require(header['case'] == info['key'] and header['e0'] == info['e0']
            and header['n0'] == info['n0'] and header['unitM'] == UNIT, 'Saved geometry identity differs')
    for name in ('lon', 'lat', 'resolutionM', 'areaM2'):
        require(len(geometry[name]) == count and np.isfinite(geometry[name]).all(), 'Invalid native geometry column: ' + name)
    resolution = UNIT * 2.0 ** level
    require(np.array_equal(geometry['resolutionM'], resolution) and np.allclose(geometry['areaM2'], resolution ** 2, rtol=0, atol=1e-6),
            'Native resolutions/areas differ from saved geometry')
    east, north = to_utm(geometry['lon'], geometry['lat'])
    require(np.max(np.abs(east - (info['e0'] + ix * UNIT + resolution / 2))) < .01
            and np.max(np.abs(north - (info['n0'] + iy * UNIT + resolution / 2))) < .01,
            'Native faces do not occupy the saved geometry positions in the same order')


def validate_manifest(man, meta, road, scenario, case, entry):
    years, archive = SCENARIOS[scenario]
    require(man.get('kind') == 'quadtree_output_package' and man.get('status') == 'complete'
            and man.get('solverCompletion', {}).get('status') == 'complete'
            and man.get('solverCompletion', {}).get('nativeStatus') == [0], 'Native solver did not finish cleanly')
    require(man.get('executionMode') == MODE and man.get('scenario') == scenario and man.get('case') == case
            and bool(man.get('runId')), 'Native scenario identity differs')
    require(man.get('modelVersion') == entry['modelVersion'] and man.get('caseArchiveSha256') == entry['archiveSha256']
            and man.get('geometry', {}).get('sha256') == entry['geometry']['sha256'], 'Native case differs from pinned registry')
    require(meta.get('kind') == 'expanded_design_storm_case' and meta.get('executionMode') == MODE
            and meta.get('scenario') == scenario and meta.get('case') == case and meta.get('returnPeriodYears') == years
            and meta.get('sourceArchiveSha256') == archive and man.get('scenarioInputs') == meta,
            'Scenario input identity/provenance differs')
    require(meta.get('modelVersion') == entry['modelVersion'] and meta.get('caseArchiveSha256') == entry['archiveSha256']
            and meta.get('physicalInputSha256', {}).get('sfincs.nc') == entry['meshSha256'], 'Scenario physical mesh differs')
    require([frame.get('time') for frame in man.get('frames', [])] == TIMES
            and man.get('validFrom') == TIMES[0] and man.get('validTo') == TIMES[-1]
            and meta.get('validFrom') == TIMES[0] and meta.get('validTo') == TIMES[-1]
            and meta.get('frameSeconds') == 900, 'Scenario must contain all 57 ordered quarter-hour frames')
    require(road.get('kind') == 'saved_all_route_road_forecast' and road.get('status') == 'complete'
            and road.get('executionMode') == MODE and road.get('scenario') == scenario and road.get('case') == case
            and road.get('runId') == man['runId'] and road.get('times') == TIMES
            and road.get('validFrom') == TIMES[0] and road.get('validTo') == TIMES[-1]
            and road.get('provenance', {}).get('geometrySha256') == entry['geometry']['sha256']
            and road.get('scenarioInputs') == meta, 'Road forecast differs from completed native scenario')


def forcing(cases):
    """Publish source samples; frame interpolation is labelled as chart-only."""
    metas = [case['meta'] for case in cases]
    meta = metas[0]; reference = parse(meta['reference'])
    require(all(m['rain'] == meta['rain'] and m['reference'] == meta['reference'] for m in metas),
            'Scenario cases do not share an identical design rainfall clock/curve')
    rain = meta['rain']; rt = np.asarray([p['elapsedSeconds'] for p in rain], dtype=float)
    rv = np.asarray([p['mmPerHour'] for p in rain], dtype=float)
    require(len(rt) >= 2 and np.isfinite(rt).all() and np.isfinite(rv).all()
            and (rv >= 0).all() and np.all(np.diff(rt) > 0), 'Invalid design rainfall series')
    elapsed = np.asarray([(parse(t) - reference).total_seconds() for t in TIMES])
    require(rt[0] == elapsed[0] and rt[-1] <= elapsed[-1], 'Rainfall samples use a different clock')
    samples = [dict(time=iso(reference + timedelta(seconds=float(t))), elapsedSeconds=float(t), mmPerHour=float(v)) for t, v in zip(rt, rv)]
    # Do not infer a value beyond the final supplied sample. Exact source samples
    # remain intact; intermediate frame numbers are an explicitly labelled chart interpolation.
    rain_frames = np.interp(elapsed, rt, rv, left=np.nan, right=np.nan)
    river_by_case = {}
    for case in cases:
        m = case['meta']; r = dict(m['river']); points = r.get('series')
        if case.get('boundary') is not None and r.get('targetReachId'):
            boundary = case['boundary']; column = r['targetColumn']
            selected = (boundary[:, 0] >= elapsed[0]) & (boundary[:, 0] <= elapsed[-1])
            points = [dict(elapsedSeconds=float(row[0]), flowM3s=float(row[column])) for row in boundary[selected]]
            r.update(seriesSource='sfincs.dis', seriesSourceSha256=sha(case['boundaryRaw']))
        target = r.get('targetReachId')
        inlets = []
        for column, inlet in enumerate(case['entry']['inlets'], 1):
            require(np.isfinite([inlet['x'], inlet['y']]).all(), 'Invalid pinned inlet coordinate')
            design = target == inlet['reachId'] and r.get('targetColumn') == column
            detail = dict(reachId=inlet['reachId'], column=column, eastingM=inlet['x'], northingM=inlet['y'],
                crs='EPSG:32612', role='design_santa_cruz' if design else 'unchanged_baseline',
                label='Santa Cruz design inlet' if design else 'NWM reach ' + inlet['reachId'],
                samples=[], available=case.get('boundary') is not None)
            if detail['available']:
                boundary = case['boundary']
                selected = (boundary[:, 0] >= elapsed[0]) & (boundary[:, 0] <= elapsed[-1])
                values = boundary[selected]
                require(len(values) >= 2 and values[0, 0] == elapsed[0] and values[-1, 0] == elapsed[-1]
                        and (values[:, column] >= 0).all(), 'Incomplete or invalid native inlet series')
                detail.update(sourceSha256=sha(case['boundaryRaw']), samples=[
                    dict(time=iso(reference + timedelta(seconds=float(row[0]))), elapsedSeconds=float(row[0]), flowM3s=float(row[column]))
                    for row in values])
            else:
                detail['unavailableReason'] = 'No hash-verified native sfincs.dis supplied; inlet location is known but its flow is unavailable.'
            inlets.append(detail)
        curve = dict(targetReachId=target, designPeakM3s=r.get('designPeakM3s'), samples=[], available=False, inlets=inlets)
        if points:
            require(target and r.get('seriesSource') == 'sfincs.dis'
                    and r.get('seriesSourceSha256') == m['modifiedInputSha256']['sfincs.dis'], 'Unverified design inflow curve')
            it = np.asarray([p['elapsedSeconds'] for p in points], dtype=float)
            iv = np.asarray([p['flowM3s'] for p in points], dtype=float)
            require(len(it) >= 2 and np.isfinite(it).all() and np.isfinite(iv).all()
                    and (iv >= 0).all() and (np.diff(it) > 0).all()
                    and it[0] <= elapsed[0] and it[-1] >= elapsed[-1], 'Incomplete or invalid design inflow curve')
            curve.update(available=True, sourceSha256=r['seriesSourceSha256'], samples=[
                dict(time=iso(reference + timedelta(seconds=float(t))), elapsedSeconds=float(t), flowM3s=float(v)) for t, v in zip(it, iv)])
        else:
            curve['unavailableReason'] = ('This model area has no Santa Cruz design-storm inlet; its other inlet flows remain unchanged.'
                if not target else 'The completed native export provides the imposed peak but not the discharge time series; the peak is not a per-frame flow.')
        river_by_case[case['key']] = curve
    # The shared display value names one physical inlet, never sums overlapping model areas.
    available = [v for v in river_by_case.values() if v['available']]
    inflow_frames = np.full(len(TIMES), np.nan)
    if available:
        first = available[0]
        require(all(v['targetReachId'] == first['targetReachId'] and v['samples'] == first['samples'] for v in available),
                'Overlapping cases disagree about the design inflow curve')
        inflow_frames = np.interp(elapsed, [p['elapsedSeconds'] for p in first['samples']], [p['flowM3s'] for p in first['samples']])
    clean = lambda v: float(v) if np.isfinite(v) else None
    return dict(schema='floodplain-design-forcing/v1', reference=meta['reference'],
        meaning='Prescribed synthetic scenario inputs, not observed or current conditions. Frame values interpolate supplied samples for display only; null means unavailable, never zero.',
        rain=dict(units='mm/h', samples=samples,
                  byCase={c['key']: dict(bounds=c['info']['bounds'], spatialMeaning='Uniform prescribed rainfall over this native model domain. Bounds enclose the domain and are not a separate measured rainfall footprint.') for c in cases},
                  frameInterpolation='linear_between_supplied_samples_no_extrapolation',
                  sourceFileSha256={c['key']: c['meta']['modifiedInputSha256']['precip_2d.nc'] for c in cases},
                  interpolationSource=f'https://github.com/Deltares/SFINCS/blob/{ENGINE_COMMIT}/source/src/sfincs_meteo.f90'),
        inflow=dict(units='m3/s', meaning='Santa Cruz design inlet only, not the sum of all inlets or overlapping model areas.',
                    frameInterpolation='linear_between_supplied_samples', available=bool(available), byCase=river_by_case,
                    interpolationSource=f'https://github.com/Deltares/SFINCS/blob/{ENGINE_COMMIT}/source/src/sfincs_discharges.f90',
                    unavailableReason=None if available else 'No completed native case exported a verified discharge time series.'),
        frames=[dict(time=t, rainMmH=clean(r), inflowM3s=clean(q)) for t, r, q in zip(TIMES, rain_frames, inflow_frames)])


def load_case(source, scenario, info, entry, saved, forcing_root=None):
    key = info['key']; folder = source / scenario / key / 'compact'
    mraw = (folder / 'manifest.json').read_bytes(); man = json_load(mraw)
    sraw = (folder / 'scenario-case.json').read_bytes(); meta = json_load(sraw)
    rraw = file_bytes(folder, man.get('roadForecast', {})); road = json_load(rraw)
    validate_manifest(man, meta, road, scenario, key, entry)
    graw = file_bytes(folder, man['geometry']); gm, geometry = read_columns(graw)
    cellraw = {v: file_bytes(saved / key, info['variants'][v]['geometry'], 'file') for v in ('web', 'full')}
    cells = {v: read_cells(cellraw[v]) for v in cellraw}
    validate_geometry(gm, geometry, cells['full'], info)
    mapping = web_mapping(cells['full'], cells['web'])
    route = cells['full'][-1]; slots = {int(v): i for i, v in enumerate(route)}
    require(len({p['id'] for p in info['routePoints']}) == len(info['routePoints'])
            and all(slots.get(p['nativeCell']) == p['slot'] for p in info['routePoints']), 'Saved route point slots differ')
    for v in cells:
        require(cells[v][0]['case'] == key and cells[v][0]['count'] == info['variants'][v]['cells'], 'Saved variant identity differs')
    boundary, boundary_raw = None, None
    if forcing_root is not None:
        boundary_raw = (Path(forcing_root) / scenario / key / 'sfincs.dis').read_bytes()
        require(sha(boundary_raw) == meta['modifiedInputSha256']['sfincs.dis'], 'Forcing file differs from completed native input')
        boundary = np.loadtxt(io.BytesIO(boundary_raw), ndmin=2)
        require(boundary.shape[1] == len(entry['inlets']) + 1 and len(boundary) >= 2
                and np.isfinite(boundary).all() and np.all(np.diff(boundary[:, 0]) > 0), 'Invalid native discharge table')
        target = meta['river'].get('targetReachId'); column = meta['river'].get('targetColumn')
        if target is not None:
            require(isinstance(column, int) and 1 <= column <= len(entry['inlets'])
                    and entry['inlets'][column - 1]['reachId'] == target, 'Design discharge column does not match pinned inlet')
    return dict(key=key, entry=entry, folder=folder, man=man, meta=meta, road=road, mraw=mraw, sraw=sraw, rraw=rraw,
                boundary=boundary, boundaryRaw=boundary_raw,
                info=info, cellraw=cellraw, cells=cells, mapping=mapping, area=geometry['areaM2'].astype(np.float64))


def native_frame(case, descriptor):
    metadata, columns = read_columns(file_bytes(case['folder'], descriptor))
    man = case['man']; area = case['area']
    require(metadata.get('time') == descriptor['time'] and metadata.get('runId') == man['runId']
            and metadata.get('geometrySha256') == man['geometry']['sha256'], 'Native frame identity differs')
    vol, zs = columns['nativeVolumeM3'], columns['waterSurfaceM']
    require(vol.dtype == np.dtype('<f4') and zs.dtype == np.dtype('<f4')
            and len(vol) == len(zs) == len(area) and not np.isinf(vol).any() and not np.isinf(zs).any(), 'Invalid native frame values/counts')
    valid = np.isfinite(vol) & (vol >= 0)
    require(valid.any(), 'Native frame has no valid volume samples')
    negative = np.isfinite(vol) & (vol < 0)
    require(not negative.any() or np.min(vol[negative].astype(float) / area[negative]) >= -.001 * (1 + np.finfo(np.float32).eps),
            'Native negative residual exceeds the existing publication limit')
    return vol, zs, valid, negative


def pack(path, header, arrays):
    head = json.dumps(header, separators=(',', ':'), allow_nan=False).encode()
    head += b' ' * (-(8 + len(head)) % 8)
    raw = b'FPQW' + struct.pack('<I', len(head)) + head + b''.join(np.ascontiguousarray(a).tobytes() for a in arrays)
    encoded = gzip.compress(raw, compresslevel=9, mtime=0)
    path.write_bytes(encoded)
    return dict(file=path.name, bytes=len(encoded), sha256=sha(encoded))


def f32_json(value):
    return float(str(np.float32(value))) if np.isfinite(value) else None


def write_case(case, out):
    key, info0, man = case['key'], case['info'], case['man']
    area = case['area']; full = case['cells']['full']; flags, routes = full[4], full[5]
    directory = out / key; directory.mkdir()
    info = {k: info0[k] for k in ('key', 'label', 'e0', 'n0', 'nativeCells', 'routes', 'routePoints', 'outline', 'labelAt', 'bounds')}
    info.update(runId=man['runId'], status='complete', executionMode=MODE, scenario=man['scenario'],
        issuedAt=man['issuedAt'], validFrom=TIMES[0], validTo=TIMES[-1],
        source=f"{man['scenario']}/{key}/compact/manifest.json", sourceManifestSha256=sha(case['mraw']),
        nativeGeometry=man['geometry'], numericalAudit=man.get('numericalAudit'), variants={}, frames=[], provenance={})
    provenance_files = [('native-manifest.json', case['mraw']), ('scenario-case.json', case['sraw']), ('road-forecast.json', case['rraw'])]
    if case.get('boundaryRaw') is not None:
        provenance_files.append(('sfincs.dis', case['boundaryRaw']))
    for name, raw in provenance_files:
        (directory / name).write_bytes(raw)
        info['provenance'][name] = dict(file=name, bytes=len(raw), sha256=sha(raw))
    for variant, raw in case['cellraw'].items():
        descriptor = info0['variants'][variant]['geometry']
        (directory / descriptor['file']).write_bytes(raw)
        info['variants'][variant] = dict(cells=info0['variants'][variant]['cells'], geometry=descriptor, frameBytes=0)
    point_values = {p['id']: dict(slot=p['slot'], zs=[], depth=[], nativeVolumeM3=[], nativeDepthM=[], nativeWaterSurfaceM=[]) for p in info['routePoints']}
    checked = 0
    for fi, descriptor in enumerate(man['frames']):
        vol, zs, valid, negative = native_frame(case, descriptor)
        raw_depth = vol.astype(np.float64) / area
        depth = np.where(valid, raw_depth, np.nan)
        route_depth = raw_depth[routes].astype('<f4'); route_zs = zs[routes].astype('<f4')
        # FPQW uses IEEE NaN for genuinely unknown route values, as native compact
        # frames do. JSON never contains NaN/Infinity and includes the raw values.
        display_route_depth = np.where(valid[routes], route_depth, np.nan).astype('<f4')
        display_route_zs = np.where(valid[routes], route_zs, np.nan).astype('<f4')
        wet = valid & (depth >= WET_SUMMARY_M)
        by_flags = {}
        for flag in np.unique(flags):
            select = (flags == flag) & wet
            by_flags[int(flag)] = [round(float(area[select].sum()) / 1e6, 5), round(float(depth[select].max()) if select.any() else 0.0, 4)]
        frame = dict(time=descriptor['time'], wetKm2=round(float(area[wet].sum()) / 1e6, 4),
            deepM=round(float(depth[valid].max()), 4), byFlags=by_flags,
            unknownNativeCells=int((~valid).sum()), negativeNativeCells=int(negative.sum()),
            sourceFrame=dict(path=descriptor['path'], bytes=descriptor['bytes'], sha256=descriptor['sha256']))
        for variant in ('web', 'full'):
            if variant == 'full':
                d = depth
            else:
                keep, join, inverse, count = case['mapping']
                bvol = np.bincount(inverse, weights=np.where(valid[join], vol[join], 0).astype(float), minlength=count)
                bad = np.bincount(inverse, weights=(~valid[join]).astype(int), minlength=count) > 0
                block_depth = bvol / (BLOCK_M ** 2); block_depth[bad] = np.nan
                d = np.concatenate([depth[keep], block_depth])
            listed = np.flatnonzero(d >= WET_M)
            delta = np.diff(listed, prepend=0).astype('<u4')
            mm = np.minimum(65535, np.rint(d[listed] * 1000)).astype('<u2')
            unknown = np.flatnonzero(~np.isfinite(d)).astype('<u4')
            header = dict(format='floodplain-quad-frame-v1', case=key, time=descriptor['time'], listed=len(listed),
                routeCells=len(routes), unknownCells=len(unknown), depthUnit='mm', geometrySha256=info['variants'][variant]['geometry']['sha256'])
            result = pack(directory / f'{variant}-{fi}.bin.gz', header,
                [delta, mm, np.zeros((-2 * len(listed)) % 4, 'u1'), display_route_depth, display_route_zs, unknown])
            frame[variant] = dict(**result, listed=len(listed), unknownCells=int((~np.isfinite(d)).sum()))
            info['variants'][variant]['frameBytes'] += result['bytes']
        for point in info['routePoints']:
            cell, slot = point['nativeCell'], point['slot']; values = point_values[point['id']]
            values['depth'].append(f32_json(display_route_depth[slot])); values['zs'].append(f32_json(display_route_zs[slot]))
            values['nativeVolumeM3'].append(f32_json(vol[cell])); values['nativeDepthM'].append(f32_json(route_depth[slot]))
            values['nativeWaterSurfaceM'].append(f32_json(route_zs[slot])); checked += 1
        info['frames'].append(frame)
    info['routeValuesChecked'] = checked
    return info, dict(times=TIMES, points=point_values)


def build(source, saved, out, registry, scenarios=('stress', 'extreme'), built_at=None, forcing_root=None):
    source, saved, out = Path(source), Path(saved), Path(out)
    base_raw = (saved / 'package.json').read_bytes(); base = json_load(base_raw)
    require(base.get('schema') == 'floodplain-all-route-web/v1' and base.get('unitM') == UNIT
            and base.get('web', {}).get('blockM') == BLOCK_M and base.get('caseOrder') == CASE_ORDER
            and [c['key'] for c in base['cases']] == CASE_ORDER, 'Saved geometry package contract differs')
    entries = {entry['case']: entry for entry in registry['cases']}
    require(scenarios and len(set(scenarios)) == len(scenarios) and all(s in SCENARIOS for s in scenarios), 'Invalid scenario selection')
    # Validate every input identity and all native frames before writing any output.
    prepared = {}
    for scenario in scenarios:
        require(not (out / ('all-route-' + scenario)).exists(), 'Output already exists; choose a new output root')
        cases = [load_case(source, scenario, info, entries[info['key']], saved, forcing_root) for info in base['cases']]
        f = forcing(cases)
        for case in cases:
            for descriptor in case['man']['frames']:
                native_frame(case, descriptor)
        prepared[scenario] = (cases, f)
    run_ids = [c['man']['runId'].split('-preview-') for cases, _ in prepared.values() for c in cases]
    require(all(len(parts) == 2 and parts[1] for parts in run_ids) and len({parts[1] for parts in run_ids}) == 1,
            'Native cases must come from one matching preview workflow run')
    stamp = built_at or iso(datetime.now(timezone.utc)); parse(stamp)
    outputs = []
    for scenario, (cases, f) in prepared.items():
        directory = out / ('all-route-' + scenario); directory.mkdir(parents=True)
        summary = dict(schema='floodplain-all-route-web/v1', kind='saved_all_route_design_storm',
            status='complete', live=False, executionMode=MODE, scenario=scenario,
            returnPeriodYears=SCENARIOS[scenario][0], builtAt=stamp, validFrom=TIMES[0], validTo=TIMES[-1],
            frameSeconds=900, unitM=UNIT, wetListedFromM=WET_M, web=base['web'], caseOrder=CASE_ORDER,
            geometrySource=dict(packageSha256=sha(base_raw), sourceCommit=base.get('sourceCommit'),
                meaning='Exact saved geometry/overlap flags reused after pinned native geometry and face-order validation; no saved water values reused.'),
            mixedTerrain=base.get('mixedTerrain'), openItems=base.get('openItems', []),
            limits=cases[0]['meta']['limitations'], forcing=f,
            unknownValues='JSON null and FPQW route NaN mean unavailable. Negative native residuals remain raw in route-points.json and native source; they are unknown for display. Unknown cells, and web blocks containing them, are omitted from water painting and encoded separately; consumers must return null, not dry, for those indices.',
            displayDepth='Finite nonnegative native volume / full native area; web blocks preserve total volume over complete 50 m squares. Sparse display lists depths >= 0.005 m in rounded mm; route values retain float32 precision. Depths above 65.535 m are capped only in the sparse mm display.',
            cases=[], unavailable=[])
        points = {}
        for case in cases:
            info, points[case['key']] = write_case(case, directory)
            summary['cases'].append(info)
            print(scenario, case['key'], len(info['frames']), 'frames', flush=True)
        pbytes = json_bytes(dict(meaning='Exact native float32 route values; zs/depth are null for invalid native volumes. nativeVolumeM3/nativeDepthM/nativeWaterSurfaceM preserve signed residuals and raw values (nonfinite source -> null). Depth is volume / full native cell area, not road depth.', cases=points))
        (directory / 'route-points.json').write_bytes(pbytes)
        summary['routePoints'] = dict(file='route-points.json', bytes=len(pbytes), sha256=sha(pbytes))
        # Completeness marker is written last, after every referenced output exists.
        (directory / 'package.json').write_bytes(json_bytes(summary))
        outputs.append(directory)
        print('Complete:', directory, flush=True)
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='ROOT/{scenario}/{case}/compact native results')
    parser.add_argument('--saved', required=True, help='Existing all-route-13z geometry package')
    parser.add_argument('--out', required=True, help='New output parent; scenario folders must not exist')
    parser.add_argument('--registry', default=str(REGISTRY))
    parser.add_argument('--scenarios', default='stress,extreme')
    parser.add_argument('--built-at', default=None)
    parser.add_argument('--forcing-root', help='Optional ROOT/{scenario}/{case}/sfincs.dis; each file must match the completed native input hash')
    args = parser.parse_args()
    build(args.source, args.saved, args.out, json_load(Path(args.registry).read_bytes()),
          tuple(args.scenarios.split(',')), args.built_at, args.forcing_root)


if __name__ == '__main__':
    main()
