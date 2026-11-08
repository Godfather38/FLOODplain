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

from export_road_forecast import LOCAL_KIND, SUMMARY_KEYS, read_columns
from run_live_all_route import AHEAD, DTOUT, SHOW_BACK, SPIN, case_entry


# Publication materiality limit, NOT a solver accuracy or positivity guarantee.
# The pinned SFINCS f3647fc source permits negative z_volume after a flux update
# (sfincs_continuity.f90:666,686-690) and stops its further outflow
# (sfincs_momentum.f90:735-745). Its subgrid table/interpolation vertical floor is
# 0.001 m (sfincs_subgrid.F90:954-959,1018). Limit accepted residuals to that scale,
# below the road export's 0.0091 m wet threshold. huthresh is not an error bound
# and the NetCDF subgrid reader resets it to zero, so do not derive this from it.
# https://github.com/Deltares/SFINCS/tree/f3647fc0289bb15cb2512d60686cef74cb853c78/source/src
# Every negative sample remains raw and UNKNOWN in RoadForecast.add_frame.
NEGATIVE_RESIDUAL_DEPTH_M = 0.001


def verify_native_data(volume, surface, area, label):
    """Check area-equivalent residuals without modifying any native array."""
    volume, surface, area = (np.asarray(v) for v in (volume, surface, area))
    if (volume.ndim != 1 or surface.ndim != 1 or area.ndim != 1
            or len(volume) != len(area) or len(surface) != len(area)):
        raise ValueError(f'{label}: invalid native cell data counts/shapes: '
                         f'volume={volume.shape}, surface={surface.shape}, area={area.shape}')
    if not len(area) or not np.isfinite(area).all() or np.any(area <= 0):
        raise ValueError(f'{label}: invalid native cell areas')
    finite = np.isfinite(volume)
    if not (finite & (volume >= 0)).any() or np.isinf(volume).any() or np.isinf(surface).any():
        raise ValueError(f'{label}: invalid native cell data: finiteVolumes={int(finite.sum())}, '
                         f'nonnegativeVolumes={int((finite & (volume >= 0)).sum())}, '
                         f'infiniteVolumes={int(np.isinf(volume).sum())}, '
                         f'infiniteSurfaces={int(np.isinf(surface).sum())}')
    negative = np.flatnonzero(finite & (volume < 0))
    if not len(negative):
        return 0, 0.0
    depth = volume[negative].astype('float64') / area[negative].astype('float64')
    lowest = int(np.argmin(depth))
    index, minimum = int(negative[lowest]), float(depth[lowest])
    # Compact native volumes are float32. Allow only their single-precision
    # rounding at the limit, not an additional physical tolerance.
    limit = NEGATIVE_RESIDUAL_DEPTH_M * (1 + np.finfo(np.float32).eps)
    if minimum < -limit:
        raise ValueError(f'{label}: invalid native cell data: {len(negative)} negative volumes; '
                         f'cell={index}, volumeM3={float(volume[index]):.12g}, '
                         f'areaM2={float(area[index]):.12g}, minimumDepthM={minimum:.12g}; '
                         f'negative residual limit={NEGATIVE_RESIDUAL_DEPTH_M} m')
    return len(negative), minimum


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


def verify_local(path, case, manifest, entry, expected):
    """local-road-forecast.json must describe exactly this completed package."""
    raw = Path(path).read_bytes()
    local = json.loads(raw)
    stations = local.get('stations')
    summary = local.get('summary') or {}
    pinned = ((local.get('provenance') or {}).get('localStations') or {}).get('sha256')
    if (local.get('schemaVersion') != 1 or local.get('kind') != LOCAL_KIND or local.get('case') != case
            or local.get('modelVersion') != manifest['modelVersion'] or local.get('runId') != manifest['runId']
            or local.get('status') != 'complete' or local.get('datum') != 'NAVD88 metres'
            or local.get('roadHeights') != 'floodplain-road-heights-v1'
            or parse(local.get('forecastStart')) != expected[0] or parse(local.get('forecastEnd')) != expected[-1]
            or local.get('frames') != len(expected) or pinned != entry['localRoads']['sha256']
            or (local.get('provenance') or {}).get('geometrySha256') != manifest['geometry']['sha256']
            or not isinstance(stations, list) or summary.get('stations') != len(stations)):
        raise ValueError('Local road forecast does not match the completed all-route package')
    counts = dict.fromkeys(SUMMARY_KEYS.values(), 0)
    for row in stations:
        counts[SUMMARY_KEYS[row['state']]] += 1
    if any(summary.get(k) != v for k, v in counts.items()):
        raise ValueError('Local road forecast summary does not match its stations')
    print(f'Verified local road forecast {case}: {len(stations)} stations, {counts}')


def verify(folder, case, cycle_iso, local_path=None):
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
    area = geometry_columns['areaM2']
    count = len(area)
    negative_count, minimum_depth = 0, 0.0
    for frame in frames:
        path = verified_file(folder, frame)
        header, columns = read_columns(path, 'floodplain-columns-v1', frame['sha256'])
        metadata = header.get('metadata') or {}
        if (metadata.get('runId') != manifest['runId'] or metadata.get('time') != frame['time']
                or metadata.get('geometrySha256') != geometry['sha256']):
            raise ValueError('All-route frame identity differs from its manifest')
        volume, surface = columns['nativeVolumeM3'], columns['waterSurfaceM']
        negatives, minimum = verify_native_data(volume, surface, area, frame['path'])
        negative_count += negatives
        minimum_depth = min(minimum_depth, minimum)
    road = json.loads(verified_file(folder, manifest.get('roadForecast') or {}).read_text())
    if (road.get('kind') != 'live_all_route_road_forecast' or road.get('status') != 'complete'
            or road.get('case') != case or road.get('runId') != manifest['runId']
            or parse(road.get('hrrrCycle')) != cycle
            or [parse(t) for t in road.get('times', [])] != expected
            or parse(road.get('validFrom')) != expected[0] or parse(road.get('validTo')) != expected[-1]
            or (road.get('provenance') or {}).get('geometrySha256') != geometry['sha256']):
        raise ValueError('Road forecast does not match the completed all-route package')
    if entry.get('localRoads') or local_path:
        if not local_path or not entry.get('localRoads'):
            raise ValueError('A case with localRoads needs its local road forecast (and only such a case)')
        verify_local(local_path, case, manifest, entry, expected)
    print(f'Verified completed all-route {case}: {len(frames)} half-hour frames, {count} cells; '
          f'{negative_count} negative native samples retained unchanged/unknown, '
          f'minimum area-equivalent depth={minimum_depth:.12g} m '
          f'(residual limit {NEGATIVE_RESIDUAL_DEPTH_M} m)')


if __name__ == '__main__':
    verify(*sys.argv[1:])
