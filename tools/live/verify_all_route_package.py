"""Reject incomplete all-route output before replacing a published model.

This verifies package identity and the entire requested half-hour window. Missing
cell values remain unknown; the validator never pads a frame or substitutes zero.
"""
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

from export_road_forecast import read_columns
from run_live_all_route import AHEAD, DTOUT, SHOW_BACK, SPIN, case_entry


def parse(value):
    if not isinstance(value, str):
        raise ValueError('Missing timestamp')
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timestamp has no timezone')
    return result.astimezone(dt.timezone.utc)


def verified_file(folder, descriptor):
    name = descriptor.get('path')
    if not isinstance(name, str) or not name or Path(name).name != name:
        raise ValueError('Invalid package file path')
    path = folder / name
    raw = path.read_bytes()
    if descriptor.get('bytes') != len(raw) or descriptor.get('sha256') != hashlib.sha256(raw).hexdigest():
        raise ValueError('Package file size or checksum mismatch: ' + name)
    return path


def verify(folder, case, cycle_iso):
    folder = Path(folder)
    cycle = parse(cycle_iso)
    entry = case_entry(case)
    manifest = json.loads((folder / 'manifest.json').read_text())
    if (manifest.get('kind') != 'quadtree_output_package' or manifest.get('status') != 'complete'
            or (manifest.get('solverCompletion') or {}).get('status') != 'complete'):
        raise ValueError('All-route SFINCS did not finish')
    if (manifest.get('case') != case or manifest.get('modelVersion') != entry['modelVersion']
            or manifest.get('caseArchiveSha256') != entry['archiveSha256']
            or manifest.get('executionMode') != 'live_current_forcing' or not manifest.get('runId')
            or parse((manifest.get('sourceIssues') or {}).get('HRRR')) != cycle):
        raise ValueError('All-route package identity or forcing cycle differs from the requested case')
    prepared = json.loads((folder / 'live-case.json').read_text())
    if (prepared.get('case') != case or parse(prepared.get('hrrrCycle')) != cycle
            or parse(prepared.get('start')) != cycle - dt.timedelta(hours=SPIN)
            or parse(prepared.get('end')) != cycle + dt.timedelta(hours=AHEAD)):
        raise ValueError('Prepared forcing does not match the requested forecast window')
    expected = [cycle - dt.timedelta(hours=SHOW_BACK) + dt.timedelta(seconds=k * DTOUT)
                for k in range((SHOW_BACK + AHEAD) * 3600 // DTOUT + 1)]
    frames = manifest.get('frames')
    if (not isinstance(frames, list) or len(frames) != len(expected)
            or [parse(frame.get('time')) for frame in frames] != expected
            or parse(manifest.get('validFrom')) != expected[0]
            or parse(manifest.get('validTo')) != expected[-1]):
        raise ValueError('All-route frames do not cover the full ordered half-hour forecast window')
    geometry = manifest.get('geometry') or {}
    if geometry.get('sha256') != entry['geometry']['sha256']:
        raise ValueError('All-route geometry differs from the pinned case')
    geometry_path = verified_file(folder, geometry)
    _, geometry_columns = read_columns(geometry_path, 'floodplain-columns-v1', geometry['sha256'])
    count = len(geometry_columns['areaM2'])
    if not count:
        raise ValueError('All-route geometry contains no cells')
    for frame in frames:
        path = verified_file(folder, frame)
        header, columns = read_columns(path, 'floodplain-columns-v1', frame['sha256'])
        metadata = header.get('metadata') or {}
        if (metadata.get('runId') != manifest['runId'] or metadata.get('time') != frame['time']
                or metadata.get('geometrySha256') != geometry['sha256']):
            raise ValueError('All-route frame identity differs from its manifest')
        volume, surface = columns['nativeVolumeM3'], columns['waterSurfaceM']
        if (len(volume) != count or len(surface) != count or not np.isfinite(volume).any()
                or np.isinf(volume).any() or np.isinf(surface).any()
                or np.any(volume[np.isfinite(volume)] < 0)):
            raise ValueError('All-route frame has missing or invalid native cell data')
    road = json.loads(verified_file(folder, manifest.get('roadForecast') or {}).read_text())
    if (road.get('kind') != 'live_all_route_road_forecast' or road.get('status') != 'complete'
            or road.get('case') != case or road.get('runId') != manifest['runId']
            or parse(road.get('hrrrCycle')) != cycle
            or [parse(t) for t in road.get('times', [])] != expected
            or parse(road.get('validFrom')) != expected[0] or parse(road.get('validTo')) != expected[-1]
            or (road.get('provenance') or {}).get('geometrySha256') != geometry['sha256']):
        raise ValueError('Road forecast does not match the completed all-route package')
    print(f'Verified completed all-route {case}: {len(frames)} half-hour frames, {count} cells')


if __name__ == '__main__':
    verify(*sys.argv[1:])
