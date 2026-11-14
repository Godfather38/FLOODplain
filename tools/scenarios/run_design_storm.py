"""Run existing design storms on pinned wider domains, never on live-data refs."""
import argparse
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile

import h5py
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'live'))
import run_live_all_route as live
from export_road_forecast import read_columns
from verify_all_route_package import verify_native_data

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


def prepare(case, scenario, work, root):
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
    text = (work / 'sfincs.inp').read_text(); cfg = config(text)
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
    (work / 'scenario-case.json').write_text(json.dumps(meta, indent=2) + '\n')
    print(json.dumps({k: meta[k] for k in ('scenario', 'case', 'validFrom', 'validTo', 'absoluteTimeShiftSeconds', 'river')}))


def export(case, scenario, work, out):
    work, out = Path(work), Path(out)
    meta = json.loads((work / 'scenario-case.json').read_text())
    if meta['case'] != case or meta['scenario'] != scenario: raise ValueError('Wrong scenario input identity')
    engine = work.parent / 'engine'
    if (engine / 'SOURCE_COMMIT').read_text().strip() != SOURCE_COMMIT or sha((engine / 'sfincs').read_bytes()) != ENGINE_SHA256:
        raise ValueError('Pinned engine identity mismatch')
    run_id = f"{meta['modelVersion']}-{scenario}-preview-{os.environ.get('GITHUB_RUN_ID', 'local')}"
    live.export(case, work, out, run_id)
    manifest = json.loads((out / 'manifest.json').read_text())
    road = json.loads((out / 'road-forecast.json').read_text())
    start = dt.datetime.fromisoformat(meta['validFrom'].rstrip('Z'))
    expected = [live.ISO(start + dt.timedelta(seconds=i * FRAME_SECONDS)) for i in range(57)]
    if manifest['status'] != 'complete' or manifest['solverCompletion']['nativeStatus'] != [0] or [f['time'] for f in manifest['frames']] != expected:
        raise ValueError('Native design-storm run incomplete; no preview output accepted')
    _, geom = read_columns(out / manifest['geometry']['path'], 'floodplain-columns-v1', manifest['geometry']['sha256'])
    negative_samples, minimum = 0, 0.0
    for frame in manifest['frames']:
        header, columns = read_columns(out / frame['path'], 'floodplain-columns-v1', frame['sha256'])
        if header['metadata']['runId'] != run_id or header['metadata']['time'] != frame['time']:
            raise ValueError('Scenario frame identity mismatch')
        count, depth = verify_native_data(columns['nativeVolumeM3'], columns['waterSurfaceM'], geom['areaM2'], frame['path'])
        negative_samples += count; minimum = min(minimum, depth)
    for item in (manifest, road):
        item['executionMode'] = 'synthetic_design_storm'; item['scenario'] = scenario
        item['limits'] = meta['limitations']; item['scenarioInputs'] = meta
    manifest['sourceIssues'] = {'mode': 'synthetic_design_storm', 'sourceArchiveSha256': meta['sourceArchiveSha256']}
    manifest['numericalAudit'] = {'negativeNativeSamplesRetained': negative_samples, 'minimumEquivalentDepthM': minimum, 'materialityLimitM': 0.001}
    road['kind'] = 'saved_all_route_road_forecast'; road.pop('hrrrCycle', None)
    raw = (json.dumps(road, separators=(',', ':'), allow_nan=False) + '\n').encode()
    (out / 'road-forecast.json').write_bytes(raw)
    manifest['roadForecast'].update(sha256=sha(raw), bytes=len(raw))
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    (out / 'scenario-case.json').write_text(json.dumps(meta, indent=2) + '\n')
    print(json.dumps({'scenario': scenario, 'case': case, 'frames': len(expected), 'audit': manifest['numericalAudit'], 'routes': {k: {'total': r['totalStations'], 'minimumValid': min(f['validStations'] for f in r['frames'])} for k, r in road['routes'].items()}}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['prepare', 'export']); parser.add_argument('case', choices=['northern', 'picture-rocks', 'gates']); parser.add_argument('scenario', choices=list(SCENARIOS)); parser.add_argument('work'); parser.add_argument('out_or_root', nargs='?', default='.')
    args = parser.parse_args()
    if args.action == 'prepare': prepare(args.case, args.scenario, args.work, args.out_or_root)
    else: export(args.case, args.scenario, args.work, args.out_or_root)
