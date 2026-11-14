"""Run existing design storms on pinned wider domains, never on live-data refs."""
import argparse
import datetime as dt
import hashlib
import gzip
import io
import json
import math
import os
from pathlib import Path
import sys
import tarfile

import h5py
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'live'))
import run_live_all_route as live
from export_road_forecast import read_columns, RoadForecast, WET_M
from verify_all_route_package import verify_native_data, NEGATIVE_RESIDUAL_DEPTH_M

SCENARIOS = {
    'stress': ('stress-storm-v1', '700b8de5b82101affbbe8bdbdbd941fc1e83adfedc63c9ae00a7ee354e029fa0', 100),
    'extreme': ('extreme-storm-v1', '3e69143a474cbe022158f404d98b938a41eac1e67ba30a2f9c3f23902fd92ca0', 1000),
}
START_OFFSET = 49 * 3600
END_OFFSET = 63 * 3600
FRAME_SECONDS = 900
SANTA_CRUZ_REACH = '15902363'
SOURCE_COMMIT = 'f3647fc0289bb15cb2512d60686cef74cb853c78'
ENGINE_SHA256 = 'c4917bc54158b0943d6d128b45c4346a33d059fb5d93808d05520c975e38f090'
sha = lambda b: hashlib.sha256(b).hexdigest()


def config(text):
    return {line.split('=', 1)[0].strip(): line.split('=', 1)[1].strip()
            for line in text.splitlines() if '=' in line}


def model_time(value):
    return dt.datetime.strptime(value, '%Y%m%d %H%M%S')


def offsets(dataset, reference):
    units = dataset.attrs['units']
    if isinstance(units, bytes): units = units.decode()
    unit, origin = units.split(' since ', 1)
    factors = {'seconds': 1, 'minutes': 60, 'hours': 3600}
    base = dt.datetime.fromisoformat(origin.strip().replace(' ', 'T'))
    return np.asarray(dataset[:], dtype=float) * factors[unit] + (base - reference).total_seconds()


def scenario_inputs(scenario, root):
    folder, expected, years = SCENARIOS[scenario]
    path = root / 'tools/sfincs/data' / folder / 'case.tar.gz'
    raw = path.read_bytes()
    if sha(raw) != expected: raise ValueError('Design-storm archive checksum mismatch')
    names = ('sfincs.inp', 'sfincs.dis', 'sfincs.src', 'precip_2d.nc', 'current-case.json')
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        data = {name: archive.extractfile(name).read() for name in names}
    cfg = config(data['sfincs.inp'].decode())
    start = model_time(cfg['tref'])
    if model_time(cfg['tstart']) != start or (model_time(cfg['tstop']) - start).total_seconds() != END_OFFSET:
        raise ValueError('Unexpected original storm time window')
    boundary = np.loadtxt(io.BytesIO(data['sfincs.dis']))
    source_locations = np.atleast_2d(np.loadtxt(io.BytesIO(data['sfincs.src'])))
    if boundary.shape[1] != len(source_locations) + 1 or len(source_locations) != 2:
        raise ValueError('Original scenario source count differs from actual native files')
    with h5py.File(io.BytesIO(data['precip_2d.nc'])) as f:
        times = offsets(f['time'], start)
        rain = np.asarray(f['Precipitation'][:])
    selected = times >= START_OFFSET
    values = []
    for frame in rain[selected]:
        first = float(frame.flat[0])
        if not np.isfinite(frame).all() or not np.all(frame == first):
            raise ValueError('Original design rainfall is not spatially uniform')
        values.append(first)
    return {'reference': start, 'rainTimes': times[selected], 'rainValues': np.array(values),
            'boundary': boundary, 'sourceArchive': str(path.relative_to(root)), 'archiveSha256': expected,
            'sourceFileSha256': {name: sha(value) for name, value in data.items()}, 'returnPeriodYears': years,
            'originalMetadata': json.loads(data['current-case.json'])}


def replace_rain(rain, native_times, original_times, values):
    selected = native_times >= START_OFFSET
    if not np.array_equal(native_times[selected], original_times):
        raise ValueError('Scenario precipitation intervals do not exactly match by elapsed time')
    if np.any(values < 0) or not np.isfinite(values).all(): raise ValueError('Invalid scenario rainfall')
    result = np.array(rain, copy=True)
    result[selected] = values.reshape((-1,) + (1,) * (result.ndim - 1))
    return result


def replace_boundary(boundary, source_boundary, inlets):
    result = boundary.copy()
    if not np.array_equal(boundary[:, 0], source_boundary[:, 0]):
        raise ValueError('Scenario boundary timestamps differ; no extrapolation is allowed')
    targets = [i for i, inlet in enumerate(inlets) if inlet['reachId'] == SANTA_CRUZ_REACH]
    if len(targets) > 1: raise ValueError('Ambiguous Santa Cruz target inlet')
    if targets:
        selected = boundary[:, 0] >= START_OFFSET
        result[selected, targets[0] + 1] = source_boundary[selected, 1]
    return result, targets[0] if targets else None


def refine_numerics(text, case, scenario, profile='baseline'):
    """Explicit, isolated timestep refinement; never changes physics or output data."""
    if profile == 'baseline':
        return text, None
    if profile != 'gates-stress-alpha025' or (case, scenario) != ('gates', 'stress'):
        raise ValueError('Numerical refinement is restricted to Gates stress alpha025')
    lines = text.splitlines(keepends=True)
    indices = [i for i, line in enumerate(lines) if '=' in line and line.split('=', 1)[0].strip() == 'alpha']
    if len(indices) != 1 or float(config(text).get('alpha', 'nan')) != 0.5:
        raise ValueError('Expected exactly one pinned alpha = 0.5 setting')
    i = indices[0]
    newline = '\r\n' if lines[i].endswith('\r\n') else '\n' if lines[i].endswith('\n') else ''
    lines[i] = 'alpha = 0.25' + newline
    changed = ''.join(lines)
    before, after = config(text), config(changed)
    if {k: v for k, v in before.items() if k != 'alpha'} != {k: v for k, v in after.items() if k != 'alpha'}:
        raise ValueError('A setting other than alpha changed')
    return changed, {'profile': profile, 'parameter': 'alpha', 'originalValue': 0.5, 'value': 0.25,
        'purpose': 'Reduce the native CFL timestep after the original Gates stress run exceeded the unchanged 1 mm signed-volume gate.',
        'source': 'https://github.com/Deltares/SFINCS/blob/' + SOURCE_COMMIT + '/source/src/sfincs_lib.f90#L334-L338',
        'caveat': 'Numerical refinement only. Passing the existing publication gate is not proof of temporal convergence or a full water-budget audit.'}


def prepare(case, scenario, work, root, numerical_profile='baseline'):
    work = Path(work).resolve(); root = Path(root).resolve()
    if work.exists(): raise ValueError('Scenario work directory must be new; no existing data is removed')
    entry = live.case_entry(case)
    original = scenario_inputs(scenario, root)
    work.mkdir(parents=True)
    previous_cwd = Path.cwd()
    try:
        os.chdir(root)
        live.unpack(entry, work)
    finally:
        os.chdir(previous_cwd)
    before = {p.name: sha(p.read_bytes()) for p in work.iterdir() if p.is_file()}
    text = (work / 'sfincs.inp').read_text()
    text, refinement = refine_numerics(text, case, scenario, numerical_profile)
    cfg = config(text)
    reference = model_time(cfg['tref'])
    if model_time(cfg['tstart']) != reference or (model_time(cfg['tstop']) - reference).total_seconds() != END_OFFSET:
        raise ValueError('Wider case does not have the exact 63-hour baseline')
    with h5py.File(work / 'precip_2d.nc', 'r+') as f:
        times = offsets(f['time'], reference)
        rain_before = f['Precipitation'][:]
        rain_after = replace_rain(rain_before, times, original['rainTimes'], original['rainValues'])
        f['Precipitation'][:] = rain_after
        if not np.array_equal(f['Precipitation'][:][times < START_OFFSET], rain_before[times < START_OFFSET]):
            raise ValueError('Antecedent rainfall changed')
        f['Precipitation'].attrs['scenario_role'] = np.bytes_('original_design_storm_elapsed_time_transplant')
    src = np.atleast_2d(np.loadtxt(work / 'sfincs.src'))
    if len(src) != len(entry['inlets']): raise ValueError('Native inlet count differs from registry')
    expected_xy = np.array([[r['x'], r['y']] for r in entry['inlets']])
    if not np.allclose(src[:, :2], expected_xy, rtol=0, atol=0.1): raise ValueError('Native inlet ordering differs from registry')
    raw_lines = (work / 'sfincs.dis').read_text().splitlines(keepends=True)
    boundary = np.loadtxt(work / 'sfincs.dis')
    changed, target = replace_boundary(boundary, original['boundary'], entry['inlets'])
    if boundary.shape[1] != len(entry['inlets']) + 1: raise ValueError('Native discharge column count mismatch')
    if target is not None:
        for i in np.flatnonzero(boundary[:, 0] >= START_OFFSET):
            tokens = raw_lines[i].split(); tokens[target + 1] = format(changed[i, target + 1], '.12g')
            raw_lines[i] = ' '.join(tokens) + '\n'
        (work / 'sfincs.dis').write_text(''.join(raw_lines))
    np.testing.assert_array_equal(np.loadtxt(work / 'sfincs.dis'), changed)
    output_keys = {'t0out': str(START_OFFSET), 'dtout': str(FRAME_SECONDS), 'dtrstout': '0', 'storezvolume': '1', 'storemeteo': '1'}
    lines = []
    for line in text.splitlines():
        key = line.split('=', 1)[0].strip()
        lines.append(f'{key} = {output_keys.pop(key)}' if key in output_keys else line)
    lines.extend(f'{key} = {value}' for key, value in output_keys.items())
    (work / 'sfincs.inp').write_text('\n'.join(lines) + '\n')
    untouched = {name: value for name, value in before.items() if name not in ('precip_2d.nc', 'sfincs.dis', 'sfincs.inp')}
    if any(sha((work / name).read_bytes()) != value for name, value in untouched.items()):
        raise ValueError('A non-forcing physical input changed')
    meta = {'schemaVersion': 1, 'kind': 'expanded_design_storm_case', 'executionMode': 'synthetic_design_storm',
            'scenario': scenario, 'returnPeriodYears': original['returnPeriodYears'], 'case': case,
            'modelVersion': entry['modelVersion'], 'caseArchiveSha256': entry['archiveSha256'],
            'sourceArchive': original['sourceArchive'], 'sourceArchiveSha256': original['archiveSha256'],
            'sourceFileSha256': original['sourceFileSha256'], 'physicalInputSha256': untouched,
            'modifiedInputSha256': {n: sha((work / n).read_bytes()) for n in ('precip_2d.nc', 'sfincs.dis', 'sfincs.inp')},
            'sourceReference': live.ISO(original['reference']), 'reference': live.ISO(reference),
            'absoluteTimeShiftSeconds': int((reference - original['reference']).total_seconds()),
            'validFrom': live.ISO(reference + dt.timedelta(seconds=START_OFFSET)),
            'validTo': live.ISO(reference + dt.timedelta(seconds=END_OFFSET)), 'frameSeconds': FRAME_SECONDS,
            'rain': [{'elapsedSeconds': int(t), 'mmPerHour': float(v)} for t, v in zip(original['rainTimes'], original['rainValues'])],
            'river': {'targetReachId': SANTA_CRUZ_REACH if target is not None else None,
                      'targetColumn': target + 1 if target is not None else None,
                      'designPeakM3s': float(original['boundary'][:, 1].max()) if target is not None else None,
                      'sourceColumn': 1, 'otherInletsUnchanged': True,
                      'sourceLabelCorrection': 'Old source metadata called 15902351 Santa Cruz. Registry/network identify 15902363 as Santa Cruz at the same native location. The exact designed hydrograph replaces 15902363; it is not added on top of its normal flow.'},
            'limitations': 'Synthetic design storm, not current conditions. Exact original design rainfall and record-river curve transplanted by elapsed simulation time onto each wider case; its original antecedent and other inlet flows remain unchanged. The absolute scenario clock shifts by five hours. Return period describes the imposed rainfall, not a calibrated joint flood probability. No river hydrograph is invented for model areas without the Santa Cruz inlet.'}
    if refinement is not None:
        meta['numericalRefinement'] = refinement
        meta['limitations'] += ' Gates uses an explicitly recorded alpha 0.25 timestep refinement; its native signed values and acceptance gate are unchanged.'
    (work / 'scenario-case.json').write_text(json.dumps(meta, indent=2) + '\n')
    print(json.dumps({k: meta[k] for k in ('scenario', 'case', 'validFrom', 'validTo', 'absoluteTimeShiftSeconds', 'river')}))


def _json_write(path, value):
    raw = (json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n').encode()
    Path(path).write_bytes(raw)
    return {'path': Path(path).name, 'sha256': sha(raw), 'bytes': len(raw)}


def audit_native_frame(volume, surface, area, label, samples=None):
    """Describe raw native data without changing it or weakening its existing gate.

    A negative-volume deficit is the magnitude of negative cell volumes in this
    snapshot. It is not a solver mass-balance error and is not summed over time.
    """
    volume, surface, area = (np.asarray(x) for x in (volume, surface, area))
    failures = []
    try:
        verify_native_data(volume, surface, area, label)
    except ValueError as exc:
        failures.append(str(exc))
    usable = (volume.ndim == surface.ndim == area.ndim == 1
              and len(volume) == len(surface) == len(area) and len(area) > 0
              and np.isfinite(area).all() and (area > 0).all())
    if not usable:
        return {'qualityFailures': failures or ['Invalid native arrays'], 'statisticsAvailable': False}, {}
    v = volume.astype(np.float64); a = area.astype(np.float64)
    finite = np.isfinite(v); negative = finite & (v < 0); positive = finite & (v > 0)
    nonfinite_volume = ~finite; nonfinite_surface = ~np.isfinite(surface)
    depth = v / a
    limit = NEGATIVE_RESIDUAL_DEPTH_M * (1 + np.finfo(np.float32).eps)
    exceeds = negative & (depth < -limit)
    indices = {name: np.flatnonzero(mask).tolist() for name, mask in (
        ('negativeVolume', negative), ('beyondResidualLimit', exceeds),
        ('nonfiniteVolume', nonfinite_volume), ('nonfiniteSurface', nonfinite_surface))}
    def extent(mask):
        return {'count': int(mask.sum()), 'areaM2': float(a[mask].sum())}
    def nonfinite_stats(values, mask):
        return dict(**extent(mask), nanCount=int(np.isnan(values).sum()),
                    positiveInfinityCount=int(np.isposinf(values).sum()), negativeInfinityCount=int(np.isneginf(values).sum()))
    minimum = int(np.flatnonzero(negative)[np.argmin(depth[negative])]) if negative.any() else None
    stats = {'statisticsAvailable': True, 'nativeCells': len(a), 'nativeAreaM2': float(a.sum()),
        'negativeVolume': dict(**extent(negative), deficitM3=float(-v[negative].sum()),
            minimumEquivalentDepthM=float(depth[minimum]) if minimum is not None else 0.0,
            minimumCell=None if minimum is None else {'index': minimum, 'volumeM3': float(v[minimum]),
                                                     'areaM2': float(a[minimum]), 'equivalentDepthM': float(depth[minimum])}),
        'beyondResidualLimit': extent(exceeds),
        'nonfiniteVolume': nonfinite_stats(v, nonfinite_volume),
        'nonfiniteSurface': nonfinite_stats(surface, nonfinite_surface),
        'zeroVolume': extent(finite & (v == 0)),
        'positiveVolume': dict(**extent(positive), totalM3=float(v[positive].sum()),
            maximumM3=float(v[positive].max()) if positive.any() else None,
            maximumEquivalentDepthM=float(depth[positive].max()) if positive.any() else None,
            areaWeightedMeanDepthM=float(v[positive].sum() / a[positive].sum()) if positive.any() else None),
        'unknownVolume': extent(negative | nonfinite_volume), 'qualityFailures': failures, 'routeCoverage': {}}
    route_indices = {}
    for route_id, (stations, faces, heights) in (samples or {}).items():
        mapped = (faces >= 0) & np.isfinite(heights); candidates = np.flatnonzero(mapped); face = faces[candidates]
        d, z = depth[face], surface[face]
        dry = np.isfinite(d) & (d >= 0) & (d < WET_M)
        valid = dry | (np.isfinite(d) & (d >= WET_M) & np.isfinite(z) & (z != -99999.0))
        over = np.zeros(len(candidates)); wet_native = valid & ~dry
        over[wet_native] = np.maximum(z[wet_native] - heights[candidates[wet_native]], 0)
        affected = {name: candidates[mask[face]].tolist() for name, mask in (
            ('negativeVolume', negative), ('beyondResidualLimit', exceeds),
            ('nonfiniteVolume', nonfinite_volume), ('nonfiniteSurface', nonfinite_surface))}
        affected['unknownResult'] = sorted(set(np.flatnonzero(~mapped).tolist() + candidates[~valid].tolist()))
        route_indices[route_id] = affected
        stats['routeCoverage'][route_id] = {'totalStations': len(stations), 'mappedStations': int(mapped.sum()),
            'validStations': int(valid.sum()), 'unknownStations': len(stations) - int(valid.sum()),
            'wetStations': int((valid & (over >= WET_M)).sum()),
            'negativeVolumeStations': len(affected['negativeVolume']),
            'beyondResidualLimitStations': len(affected['beyondResidualLimit']),
            'nonfiniteVolumeStations': len(affected['nonfiniteVolume']),
            'nonfiniteSurfaceStations': len(affected['nonfiniteSurface'])}
    indices['routeStationIndices'] = route_indices
    return stats, indices


def audit_compact(case, manifest, road, out, expected, run_id):
    """Audit every available frame, including frames after the first gate failure."""
    out = Path(out)
    report = {'schemaVersion': 1, 'kind': 'design_storm_numerical_audit',
        'executionMode': 'synthetic_design_storm_diagnostic', 'case': case, 'runId': run_id,
        'expectedFrameCount': len(expected), 'providedFrameCount': len(manifest.get('frames', [])),
        'materialityLimitM': NEGATIVE_RESIDUAL_DEPTH_M,
        'negativeVolumeDeficitMeaning': 'Magnitude of negative native cell volumes in one saved snapshot; not a solver mass-balance error. No sum across times is interpreted as a physical volume.',
        'missingSurfaceMeaning': 'Nonfinite dry-sentinel surfaces are reported separately; finite nonnegative dry native volume can still establish a valid dry station.',
        'solverCompletion': manifest.get('solverCompletion'), 'qualityFailures': [], 'frames': []}
    if (manifest.get('status') != 'complete' or manifest.get('solverCompletion', {}).get('status') != 'complete'
            or manifest.get('solverCompletion', {}).get('nativeStatus') != [0]):
        report['qualityFailures'].append('Native solver did not finish cleanly')
    if ([f.get('time') for f in manifest.get('frames', [])] != expected
            or manifest.get('validFrom') != expected[0] or manifest.get('validTo') != expected[-1]):
        report['qualityFailures'].append('Native frames do not cover all 57 ordered quarter-hour timestamps')
    geometry = manifest['geometry']
    _, geom = read_columns(out / geometry['path'], 'floodplain-columns-v1', geometry['sha256'])
    mapped = RoadForecast.load(case, out / geometry['path'], geometry['sha256'])
    for index, frame in enumerate(manifest.get('frames', [])):
        detail = {'index': index, 'time': frame.get('time'), 'sourceFrame': frame, 'qualityFailures': []}
        try:
            path = out / frame['path']
            if path.stat().st_size != frame['bytes']:
                raise ValueError('Native frame byte count differs')
            header, columns = read_columns(path, 'floodplain-columns-v1', frame['sha256'])
            metadata = header.get('metadata', {})
            if (metadata.get('runId') != run_id or metadata.get('time') != frame['time']
                    or metadata.get('geometrySha256') != geometry['sha256']):
                detail['qualityFailures'].append('Scenario frame identity differs')
            stats, affected = audit_native_frame(columns['nativeVolumeM3'], columns['waterSurfaceM'], geom['areaM2'], frame['path'], mapped.samples)
            detail['qualityFailures'].extend(stats.pop('qualityFailures')); detail.update(stats)
            for route_id, coverage in stats.get('routeCoverage', {}).items():
                native_frames = road.get('routes', {}).get(route_id, {}).get('frames', [])
                if index >= len(native_frames) or any(native_frames[index].get(k) != coverage[k] for k in ('validStations', 'wetStations')):
                    detail['qualityFailures'].append('Exported road coverage differs: ' + route_id)
            payload = (json.dumps({'nativeFaceOrder': 'Compact geometry face indices, not source-mesh order',
                'routeStationOrder': 'Pinned road-stations route order', **affected}, separators=(',', ':'), allow_nan=False) + '\n').encode()
            compressed = gzip.compress(payload, compresslevel=6, mtime=0)
            name = f'audit-indices-{index}.json.gz'; (out / name).write_bytes(compressed)
            detail['affectedIndices'] = {'path': name, 'bytes': len(compressed), 'sha256': sha(compressed)}
        except Exception as exc:
            detail['qualityFailures'].append(type(exc).__name__ + ': ' + str(exc))
        report['frames'].append(detail)
    available = [f for f in report['frames'] if f.get('statisticsAvailable')]
    report.update(negativeNativeSamplesRetained=sum(f['negativeVolume']['count'] for f in available),
        minimumEquivalentDepthM=min([0.0] + [f['negativeVolume']['minimumEquivalentDepthM'] for f in available]),
        maximumFrameNegativeVolumeDeficitM3=max([0.0] + [f['negativeVolume']['deficitM3'] for f in available]),
        framesAudited=len(report['frames']), framesWithStatistics=len(available),
        failedFrames=[f['index'] for f in report['frames'] if f['qualityFailures']])
    report['qualityStatus'] = 'rejected' if report['qualityFailures'] or report['failedFrames'] else 'passed_existing_gate'
    return report


def _tag_diagnostic(item, meta, road=False, quality='pending_audit'):
    item.update(kind='diagnostic_all_route_road_forecast' if road else 'diagnostic_quadtree_output_package',
        executionMode='synthetic_design_storm_diagnostic', status='diagnostic_only', diagnosticOnly=True,
        acceptedForDisplay=False, scenario=meta['scenario'], scenarioInputs=meta, limits=meta['limitations'],
        qualityStatus=quality)
    item['sourceIssues'] = {'mode': 'synthetic_design_storm_diagnostic', 'sourceArchiveSha256': meta['sourceArchiveSha256']}
    item.pop('hrrrCycle', None)


def _save_exports(out, manifest, road):
    descriptor = _json_write(out / 'road-forecast.json', road)
    manifest.setdefault('roadForecast', {}).update(descriptor)
    _json_write(out / 'manifest.json', manifest)


def _strict_json(raw):
    def invalid(value):
        raise ValueError('Nonfinite JSON token in exported metadata: ' + value)
    return json.loads(raw, parse_constant=invalid)


def _safe_metadata(value):
    """JSON-safe fallback only; source metadata bytes are preserved separately."""
    if isinstance(value, dict):
        return {key: _safe_metadata(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_safe_metadata(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _diagnostic_fallback(out, meta, case, run_id, error):
    """Replace unsafe/incomplete export labels, even when either JSON is broken.

    Raw source metadata is kept in explicitly unvalidated compressed evidence,
    while the only manifest/road JSON identities remain diagnostic-only.
    """
    items = {}
    for name, is_road in (('manifest.json', False), ('road-forecast.json', True)):
        path = out / name; item = {}; evidence = None
        if path.exists():
            raw = path.read_bytes()
            evidence_name = 'unvalidated-export-' + name + '.raw.gz'
            evidence_path = out / evidence_name
            if not evidence_path.exists():
                evidence_path.write_bytes(gzip.compress(raw, compresslevel=6, mtime=0))
            encoded = evidence_path.read_bytes()
            evidence = {'path': evidence_name, 'bytes': len(encoded), 'sha256': sha(encoded),
                'meaning': 'Unvalidated source metadata bytes, retained as evidence only. Not a display package or accepted live result.'}
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict): item = _safe_metadata(parsed)
            except (ValueError, UnicodeError):
                pass
        item.setdefault('case', case); item.setdefault('runId', run_id)
        _tag_diagnostic(item, _safe_metadata(meta), is_road, 'rejected_export_metadata')
        item['diagnosticFailure'] = {'reason': type(error).__name__ + ': ' + str(error),
            'nonfiniteMetadata': 'Nonfinite source metadata is null here; original bytes are retained in unvalidated evidence.'}
        if evidence is not None: item['unvalidatedMetadataEvidence'] = evidence
        items[name] = item
    _save_exports(out, items['manifest.json'], items['road-forecast.json'])


def export(case, scenario, work, out, diagnostic_only=False):
    work, out = Path(work), Path(out)
    meta = _strict_json((work / 'scenario-case.json').read_bytes())
    if meta['case'] != case or meta['scenario'] != scenario: raise ValueError('Wrong scenario input identity')
    engine = work.parent / 'engine'
    if (engine / 'SOURCE_COMMIT').read_text().strip() != SOURCE_COMMIT or sha((engine / 'sfincs').read_bytes()) != ENGINE_SHA256:
        raise ValueError('Pinned engine identity mismatch')
    role = 'diagnostic' if diagnostic_only else 'preview'
    run_id = f"{meta['modelVersion']}-{scenario}-{role}-{os.environ.get('GITHUB_RUN_ID', 'local')}"
    out.mkdir(parents=True, exist_ok=True)
    _json_write(out / 'scenario-case.json', meta)
    try:
        live.export(case, work, out, run_id)
        manifest = _strict_json((out / 'manifest.json').read_bytes())
        road = _strict_json((out / 'road-forecast.json').read_bytes())
        # Persist diagnostic identity BEFORE auditing. Completion remains an
        # explicit native fact, not permission to publish a failed result.
        original_manifest = json.loads(json.dumps(manifest, allow_nan=False))
        _tag_diagnostic(manifest, meta); _tag_diagnostic(road, meta, True)
        _save_exports(out, manifest, road)
        start = dt.datetime.fromisoformat(meta['validFrom'].rstrip('Z'))
        expected = [live.ISO(start + dt.timedelta(seconds=i * FRAME_SECONDS)) for i in range(57)]
        try:
            audit = audit_compact(case, original_manifest, road, out, expected, run_id)
        except Exception as exc:
            audit = {'schemaVersion': 1, 'kind': 'design_storm_numerical_audit', 'executionMode': 'synthetic_design_storm_diagnostic',
                'qualityStatus': 'rejected', 'qualityFailures': [str(exc)], 'frames': [], 'framesAudited': 0,
                'solverCompletion': manifest.get('solverCompletion'), 'materialityLimitM': NEGATIVE_RESIDUAL_DEPTH_M}
        manifest['numericalAudit'] = {k: audit[k] for k in ('negativeNativeSamplesRetained', 'minimumEquivalentDepthM',
            'materialityLimitM', 'maximumFrameNegativeVolumeDeficitM3') if k in audit}
        manifest['numericalAudit']['report'] = _json_write(out / 'numerical-audit.json', audit)
        quality = audit['qualityStatus']; manifest['qualityStatus'] = quality; road['qualityStatus'] = quality
        accepted = quality == 'passed_existing_gate' and not diagnostic_only
        if accepted:
            for item in (manifest, road):
                item.update(executionMode='synthetic_design_storm', status='complete', diagnosticOnly=False, acceptedForDisplay=True)
                item['sourceIssues'] = {'mode': 'synthetic_design_storm', 'sourceArchiveSha256': meta['sourceArchiveSha256']}
            manifest['kind'] = 'quadtree_output_package'; road['kind'] = 'saved_all_route_road_forecast'
        _save_exports(out, manifest, road)
        print(json.dumps({'scenario': scenario, 'case': case, 'framesAudited': audit['framesAudited'],
            'qualityStatus': quality, 'acceptedForDisplay': accepted, 'diagnosticOnly': not accepted,
            'audit': manifest['numericalAudit']}, allow_nan=False))
    except Exception as exc:
        # The entire export + parse + tag + serialize path is guarded. A malformed
        # road JSON or nonfinite manifest metadata cannot leave live/complete labels.
        _diagnostic_fallback(out, meta, case, run_id, exc)
        raise
    if quality != 'passed_existing_gate':
        raise ValueError('Native design-storm quality rejected; full diagnostic-only compact output retained at ' + str(out))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['prepare', 'export', 'diagnostic-export']); parser.add_argument('case', choices=['northern', 'picture-rocks', 'gates']); parser.add_argument('scenario', choices=list(SCENARIOS)); parser.add_argument('work'); parser.add_argument('out_or_root', nargs='?', default='.')
    parser.add_argument('--numerical-profile', choices=['baseline', 'gates-stress-alpha025'], default='baseline')
    args = parser.parse_args()
    if args.action == 'prepare': prepare(args.case, args.scenario, args.work, args.out_or_root, args.numerical_profile)
    else: export(args.case, args.scenario, args.work, args.out_or_root, diagnostic_only=args.action == 'diagnostic-export')
