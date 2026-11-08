"""Reject incomplete all-route output before replacing a published model.

This verifies package identity and the entire requested half-hour window. Missing
cell values remain unknown; the validator never pads a frame or substitutes zero.
"""
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np

from export_road_forecast import (LIVE_STATES, LOCAL_KIND, LOCAL_SCHEMA, SUMMARY_KEYS, decode_local_static,
                                  local_stations_for, read_columns)
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


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def local_entry_problem(state, z_cm, wse, over, first, cell, unknown, window_min, frames):
    """The rule each listed station must meet: the same rules as the app's readEntry
    (public/simulation/local-road-forecast.js). The app drops a station that fails as unreadable
    and counts it; publication rejects the whole file. Returns a reason, or None."""
    cell_ok = _is_num(cell) and cell > 0
    if state in ('over', 'below'):
        if not (_is_int(wse) and _is_int(over) and over == wse - z_cm):
            return 'maxOverCm must equal maxWseCm - roadZCm'
        if not cell_ok:
            return 'cellSizeM must be > 0'
        if state == 'over':
            if over < 1:
                return 'an over station needs maxOverCm >= 1'
            if not (_is_int(first) and 0 <= first <= window_min):
                return 'firstOverMin must be within the forecast window'
            if not (_is_int(unknown) and 0 <= unknown < frames):
                return 'an over station needs 0 <= unknownFrames < frames'
            return None
        if over > 0:
            return 'a below station needs maxOverCm <= 0'
        if first is not None:
            return 'a below station has no firstOverMin'
        if not (_is_int(unknown) and unknown == 0):
            return 'a below station needs unknownFrames 0 (a missing frame makes it unknown)'
        return None
    if state == 'unknown':
        if wse is not None or over is not None or first is not None:
            return 'an unknown station has null water values'
        if not cell_ok:
            return 'cellSizeM must be > 0'
        if not (_is_int(unknown) and 1 <= unknown <= frames):
            return 'an unknown station needs 1 <= unknownFrames <= frames'
        return None
    if any(v is not None for v in (wse, over, first, cell, unknown)):
        return 'a no-cell station has only null values'
    return None


def verify_local_contract(local, static_raw):
    """Every rule the app enforces on local-road-forecast.json against its static station file.

    Raises ValueError on the first problem; returns (station count, listed count, summary counts).
    The app (parseLocalRoadForecast) and this function are tested against the same fixture set
    (fixtures/local-roads/local-road-contract-cases.json here, test/fixtures in the app).
    """
    if not isinstance(local, dict):
        raise ValueError('Local road forecast is not an object')
    stations, _ = decode_local_static(static_raw)
    n = len(stations)
    if (local.get('schemaVersion') != LOCAL_SCHEMA or local.get('kind') != LOCAL_KIND
            or local.get('status') not in ('ok', 'partial') or local.get('datum') != 'NAVD88 metres'
            or local.get('roadHeights') != 'floodplain-road-heights-v1'
            or not isinstance(local.get('runId'), str) or not local.get('runId')
            or local.get('stateCodes') != list(LIVE_STATES)):
        raise ValueError('Local road forecast header is not contract v2')
    if local.get('stationsSha256') != hashlib.sha256(static_raw).hexdigest() or local.get('stationCount') != n:
        raise ValueError('Local road forecast was computed for another station list')
    for key in ('issuedAt', 'forecastStart', 'forecastEnd'):
        if not (isinstance(local.get(key), str) and local[key].endswith('Z')):
            raise ValueError('Local road forecast times must be ISO UTC with Z')
        parse(local[key])
    start, end = parse(local['forecastStart']), parse(local['forecastEnd'])
    frames = local.get('frames')
    if end <= start or not _is_int(frames) or frames < 1:
        raise ValueError('Local road forecast window or frame count is invalid')
    window_min = round((end - start).total_seconds() / 60)
    listed = local.get('listed')
    keys = ('index', 'state', 'maxWseCm', 'maxOverCm', 'firstOverMin', 'cellSizeM', 'unknownFrames')
    if (not isinstance(listed, dict) or any(not isinstance(listed.get(k), list) for k in keys)
            or len({len(listed[k]) for k in keys}) != 1):
        raise ValueError('Local road forecast list is not columnar')
    counts = dict.fromkeys(SUMMARY_KEYS.values(), 0)
    counts['noRoadHeight'] = sum(s['roadZCm'] is None for s in stations)
    prev = -1
    for k, (i, code) in enumerate(zip(listed['index'], listed['state'])):
        if not _is_int(i) or i <= prev or i >= n:
            raise ValueError('Local road forecast list index is unsorted, repeated or out of range')
        if not _is_int(code) or not 0 <= code < len(LIVE_STATES):
            raise ValueError('Local road forecast list has an unknown state code')
        if stations[i]['roadZCm'] is None:
            raise ValueError('A station without road height is listed')
        prev, state = i, LIVE_STATES[code]
        problem = local_entry_problem(state, stations[i]['roadZCm'], listed['maxWseCm'][k], listed['maxOverCm'][k],
                                      listed['firstOverMin'][k], listed['cellSizeM'][k], listed['unknownFrames'][k],
                                      window_min, frames)
        if problem:
            raise ValueError(f'Local road station {i} ({state}) is unreadable: {problem}')
        counts[SUMMARY_KEYS[state]] += 1
    counts['dry'] = n - sum(v for key, v in counts.items() if key != 'dry')
    summary = local.get('summary')
    if (not isinstance(summary, dict) or summary.get('stations') != n
            or any(summary.get(key) != v for key, v in counts.items())):
        raise ValueError('Local road forecast summary does not match its stations')
    return n, len(listed['index']), counts


def verify_local(path, case, manifest, entry, expected, stations_path=None):
    """local-road-forecast.json (contract v2) must describe exactly this completed package.

    It must be pinned to the static app station file regenerated from the registry's frozen
    station list (stationsSha256), meet every rule the app enforces (verify_local_contract), and
    have status ok.
    """
    local = json.loads(Path(path).read_bytes())
    _, _, _, static_raw = local_stations_for(case, stations_path or entry['localRoads'].get('path'),
                                             entry['localRoads']['sha256'])
    n, listed, counts = verify_local_contract(local, static_raw)
    pinned = ((local.get('provenance') or {}).get('localStations') or {}).get('sha256')
    if (local.get('case') != case or local.get('modelVersion') != manifest['modelVersion']
            or local.get('runId') != manifest['runId'] or local.get('status') != 'ok'
            or parse(local.get('forecastStart')) != expected[0] or parse(local.get('forecastEnd')) != expected[-1]
            or local.get('frames') != len(expected) or pinned != entry['localRoads']['sha256']
            or (local.get('provenance') or {}).get('geometrySha256') != manifest['geometry']['sha256']):
        raise ValueError('Local road forecast does not match the completed all-route package')
    print(f'Verified local road forecast {case}: {n} stations, {listed} listed, {counts}')


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
