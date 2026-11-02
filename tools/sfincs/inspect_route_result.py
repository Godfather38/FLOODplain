"""Read actual native output for any prepared all-route case; prove cell correspondence.

Generic replacement for the per-case readers: the native-reading and exact
input/output face-correspondence logic of inspect_silverbell_result.py with the
Silverbell registry dependency removed. Inventory records are filtered by the
case metadata routeIds and then located independently in this run's own native
geometry, so no other case's native face IDs are trusted.

Usage:

    python tools/sfincs/inspect_route_result.py <native-run-directory> \
        --run-id 41370039087 \
        --inventory tools/sfincs/data/all-routes-extension-v1/inventory/coverage-ledger.json \
        [--case-metadata <path to current-case.json>] \
        --output tools/sfincs/data/<case>-result-<run-id>

The native run directory is only read, never written. --case-metadata defaults
to current-case.json inside the native run directory. --output must not already
exist; all four products are written there:

    result-summary.json          native status, recorded time coverage, correspondence proof
    output-to-source-face-id.npy source native face ID for each output face, in output order
    route-point-summary.json     one record per retained inventory point
    route-point-series.csv       per-frame native values for located inventory points

This reader reports native quantities only. The volume/full-cell-area ratio is a
cell-average storage quantity, not a validated road depth; nothing here infers
passability, bridge clearance, velocity, flow sections or uncertainty margins.
"""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
import numpy as np
import xarray as xr
from pyproj import CRS, Transformer

# All prepared all-route cases are built on the same projected metre grid.
SOURCE_EPSG = 32612
LOG_NAMES = ['solver.log', 'sfincs.log']
HASHED_NAMES = ['sfincs.nc', 'sfincs_map.nc'] + LOG_NAMES
INVENTORY_ARRAYS = ['entries', 'officialRoadJunctions', 'terrainMinimumCandidates']
PRECIPITATION_NAMES = ['precipitation_rate', 'precipitation', 'cumulative_precipitation']
NATIVE_SCALARS = ['status', 'total_runtime', 'average_dt']
RATIO_DEFINITION = ('Native subgrid_volume divided by the full computational-cell area. '
                    'Cell-average storage only; NOT validated road depth or passability.')
RESTART_LIMITATION = ('Type1 restores water/momentum but not cumulative cna '
                      'precipitation/infiltration state; not an identical continuation')


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def topology(ds):
    """Resolve the UGRID face connectivity and node coordinate variables."""
    for name, var in ds.variables.items():
        if var.attrs.get('cf_role') == 'mesh_topology' and var.attrs.get('topology_dimension') == 2:
            xy = var.attrs['node_coordinates'].split()
            if len(xy) != 2: raise ValueError('Two node coordinate variables required')
            return ds[var.attrs['face_node_connectivity']], xy[0], xy[1]
    if 'mesh2d_face_nodes' in ds:
        return ds['mesh2d_face_nodes'], 'mesh2d_node_x', 'mesh2d_node_y'
    raise ValueError('No UGRID two-dimensional mesh topology in native file')


def face_bounds(ds):
    """Exact axis-aligned bounds of every native face, from actual connectivity."""
    conn, xname, yname = topology(ds)
    raw = np.asarray(conn.values, dtype='float64')
    if raw.ndim != 2: raise ValueError('Two-dimensional face/node connectivity required')
    good = np.isfinite(raw)
    fill = conn.attrs.get('_FillValue', conn.encoding.get('_FillValue'))
    if fill is not None: good &= raw != fill
    start = int(conn.attrs.get('start_index', 0))
    good &= raw >= start
    if not good.any(axis=1).all(): raise ValueError('Native face with no valid nodes')
    index = np.where(good, raw - start, 0).astype('int64')
    x, y = ds[xname].values, ds[yname].values
    if index.max() >= min(len(x), len(y)): raise ValueError('Connectivity references missing nodes')
    px = np.where(good, x[index], np.nan)
    py = np.where(good, y[index], np.nan)
    return np.column_stack([np.nanmin(px, 1), np.nanmin(py, 1), np.nanmax(px, 1), np.nanmax(py, 1)])


def native_face_ids(ds, face_dim):
    """Exact source native face IDs, in native file order."""
    name = 'mesh2d_nFaces' if 'mesh2d_nFaces' in ds else face_dim
    if name not in ds: raise ValueError('No native face ID variable in native file')
    values = np.asarray(ds[name].values)
    if values.ndim != 1 or not np.issubdtype(values.dtype, np.integer):
        raise ValueError('Explicit one-dimensional integer native face IDs required')
    if len(set(values.tolist())) != len(values): raise ValueError('Duplicate native face IDs')
    return values


def correspondence(map_ds, mesh_ds):
    """Match every output face to its input face by exact native rectangle bounds."""
    out_b, in_b = face_bounds(map_ds), face_bounds(mesh_ds)
    if len(np.unique(in_b, axis=0)) != len(in_b): raise ValueError('Nonunique input cell bounds')
    lookup = {tuple(row.tolist()): i for i, row in enumerate(in_b)}
    missing = [i for i, row in enumerate(out_b) if tuple(row.tolist()) not in lookup]
    if missing: raise ValueError(f'{len(missing)} output faces absent from native input bounds')
    index = np.array([lookup[tuple(row.tolist())] for row in out_b], dtype='int64')
    if len(set(index.tolist())) != len(index): raise ValueError('Output faces share one input face')
    proof = {'method': 'Exact unique rectangle bounds independently matched between native '
                       'input/output connectivity',
             'outputFaces': len(out_b), 'inputFaces': len(in_b), 'matchedFaces': len(index),
             'identityOrder': bool(np.array_equal(index, np.arange(len(index)))),
             'maxBoundsDifferenceM': float(np.max(np.abs(out_b - in_b[index]))),
             'inputFacesNotInOutput': int(len(in_b) - len(index))}
    return index, out_b, in_b, proof


def finite_range(values):
    finite = np.isfinite(values)
    if not finite.any(): return [None, None]
    return [float(values[finite].min()), float(values[finite].max())]


def number(value):
    """Keep missing native values missing instead of substituting a number."""
    return float(value) if np.isfinite(value) else None


def declared_epsg(ds):
    """EPSG code the native file itself records, if it records one."""
    for name, var in ds.variables.items():
        for key in ['epsg', 'EPSG', 'epsg_code']:
            if key in var.attrs:
                try: return int(str(var.attrs[key]).split(':')[-1])
                except ValueError: pass
        if 'crs_wkt' in var.attrs or 'spatial_ref' in var.attrs:
            text = var.attrs.get('crs_wkt') or var.attrs.get('spatial_ref')
            try:
                code = CRS.from_user_input(text).to_epsg()
            except Exception:
                code = None
            if code: return int(code)
    return None


def retained_records(inventory, case_route_ids):
    """Inventory records whose route memberships intersect this case, with provenance kept."""
    retained = []
    counts = {}
    for array in INVENTORY_ARRAYS:
        records = inventory.get(array)
        if records is None: raise ValueError(f'Inventory is missing the {array} array')
        kept = 0
        for record in records:
            route_ids = list(record.get('routeIds') or [])
            matched = [r for r in route_ids if r in case_route_ids]
            if not matched: continue
            kept += 1
            coordinates = record.get('coordinates')
            if not (isinstance(coordinates, list) and len(coordinates) == 2):
                raise ValueError(f"Record {record.get('canonicalId')} has no [longitude,latitude]")
            retained.append({'canonicalId': record['canonicalId'], 'inventoryArray': array,
                             'name': record.get('name'), 'kind': record.get('kind'),
                             'coordinates': [float(coordinates[0]), float(coordinates[1])],
                             'routeIds': route_ids, 'matchedCaseRouteIds': matched,
                             'inventoryModelStatusFromOtherRuns': (record.get('model') or {}).get('status'),
                             'routeMembershipIsNotModeledCoverage': True})
        counts[array] = {'sourceRecords': len(records), 'retainedByRouteIds': kept,
                         'notInThisCase': len(records) - kept}
    ids = [r['canonicalId'] for r in retained]
    if len(set(ids)) != len(ids): raise ValueError('Duplicate canonicalId among retained records')
    return retained, counts


def locate(points, in_b, source_ids):
    """Locate each projected point in this run's own native rectangles."""
    domain = [float(in_b[:, 0].min()), float(in_b[:, 1].min()),
              float(in_b[:, 2].max()), float(in_b[:, 3].max())]
    for record, (x, y) in zip(points, points_xy(points)):
        candidate = np.flatnonzero((x >= in_b[:, 0]) & (x <= in_b[:, 2]))
        candidate = candidate[(y >= in_b[candidate, 1]) & (y <= in_b[candidate, 3])]
        record['projected'] = {'epsg': SOURCE_EPSG, 'eastingM': float(x), 'northingM': float(y)}
        if len(candidate) == 0:
            record['location'] = {
                'status': 'outside_current_native_domain',
                'sourceNativeFaceId': None, 'inputFaceIndex': None,
                'distanceToDomainBoundingBoxM': float(np.hypot(
                    max(domain[0] - x, 0, x - domain[2]), max(domain[1] - y, 0, y - domain[3]))),
                'retainedReason': 'Explicitly retained outside-domain route membership; '
                                  'route membership is not modeled coverage'}
            continue
        order = candidate[np.argsort(source_ids[candidate])]
        chosen = int(order[0])
        record['location'] = {
            'status': 'located_in_current_native_domain',
            'sourceNativeFaceId': int(source_ids[chosen]), 'inputFaceIndex': chosen,
            'method': 'point_in_exact_native_cell_bounds_from_current_input_connectivity',
            'boundaryAmbiguous': len(order) > 1,
            'candidateSourceNativeFaceIds': [int(source_ids[i]) for i in order],
            'ambiguityNote': ('Point lies on a shared native cell boundary; lowest source '
                              'native face ID selected') if len(order) > 1 else None}
    return domain


def points_xy(points):
    transformer = Transformer.from_crs(4326, SOURCE_EPSG, always_xy=True)
    return [transformer.transform(*record['coordinates']) for record in points]


def read_logs(run):
    """Read whichever solver logs actually exist; record which were found."""
    found, text = [], []
    for name in LOG_NAMES:
        path = run / name
        if path.is_file():
            found.append(name)
            text.append(path.read_text(errors='replace'))
    return found, '\n'.join(text)


def time_coverage(map_ds, requested_end):
    """Actual recorded times; never a manufactured forecast frame count."""
    decoded = xr.coding.times.decode_cf_datetime(map_ds.time.values, map_ds.time.attrs['units'])
    stamps = np.asarray(decoded, dtype='datetime64[s]')
    if len(stamps) == 0: raise ValueError('Native output records no time steps')
    if np.isnat(stamps).any(): raise ValueError('Invalid native time axis')
    steps = np.diff(stamps).astype('int64')
    if len(steps) and (steps <= 0).any(): raise ValueError('Native time axis is not increasing')
    times = [str(v) + 'Z' for v in stamps]
    coverage = {'framesRecorded': len(times), 'recordedValidFrom': times[0],
                'recordedValidTo': times[-1],
                'distinctIntervalSeconds': sorted({int(v) for v in steps}),
                'requestedEndUtc': requested_end,
                'note': 'Frames, interval and endpoints are read from the native output. The '
                        'normal forecast product is 57 quarter-hour frames from 2026-11-01T17Z '
                        'through 2026-11-02T07Z, but that count is not assumed here.'}
    if requested_end:
        end = np.datetime64(str(requested_end).removesuffix('Z'), 's')
        coverage['reachesRequestedEnd'] = bool(stamps[-1] >= end)
        coverage['shortfallSecondsFromRequestedEnd'] = int(max((end - stamps[-1]).astype('int64'), 0))
    else:
        coverage['reachesRequestedEnd'] = None
        coverage['shortfallSecondsFromRequestedEnd'] = None
        coverage['requestedEndUnavailable'] = 'Case metadata records no end; coverage not checked'
    return times, coverage


def inspect(run, run_id, inventory_path, case_path, destination):
    run, destination = Path(run), Path(destination)
    if destination.exists(): raise ValueError('New output directory required; native run is read-only')
    if destination.resolve() == run.resolve() or run.resolve() in destination.resolve().parents:
        raise ValueError('Output directory must be outside the native run directory')
    case = json.loads(Path(case_path).read_text(encoding='utf-8-sig'))
    inventory = json.loads(Path(inventory_path).read_text(encoding='utf-8-sig'))
    case_route_ids = case.get('routeIds')
    if not case_route_ids:
        raise ValueError('Case metadata records no routeIds; inventory filtering is not possible')
    retained, record_counts = retained_records(inventory, set(case_route_ids))

    with xr.open_dataset(run / 'sfincs_map.nc', decode_times=False) as map_ds, \
         xr.open_dataset(run / 'sfincs.nc', decode_times=False) as mesh_ds:
        index, out_b, in_b, proof = correspondence(map_ds, mesh_ds)
        conn, _, _ = topology(mesh_ds)
        source_ids = native_face_ids(mesh_ds, conn.dims[0])
        if len(source_ids) != len(in_b): raise ValueError('Native face IDs do not index mesh faces')
        output_source_ids = source_ids[index]

        for name in ['subgrid_volume', 'zs']:
            if name not in map_ds: raise ValueError(f'Native output has no {name} variable')
        area = (out_b[:, 2] - out_b[:, 0]) * (out_b[:, 3] - out_b[:, 1])
        if not (np.isfinite(area) & (area > 0)).all(): raise ValueError('Degenerate native cell area')
        volume = map_ds.subgrid_volume.values.astype('float64')
        surface = map_ds.zs.values.astype('float64')
        if volume.shape[1:] != area.shape or surface.shape[1:] != area.shape:
            raise ValueError('Native variables do not span the output faces')
        ratio = volume / area[None, :]
        times, coverage = time_coverage(map_ds, case.get('end'))
        if len(times) != len(volume): raise ValueError('Native time axis does not span the volumes')

        logs, log_text = read_logs(run)
        file_epsg = declared_epsg(mesh_ds)
        if file_epsg is not None and file_epsg != SOURCE_EPSG:
            raise ValueError(f'Native input records EPSG:{file_epsg}, not EPSG:{SOURCE_EPSG}')
        domain = locate(retained, in_b, source_ids)

        marker = bool(re.search(r'simulation\s+finished', log_text, re.I))
        summary = {
            'runId': run_id,
            'caseId': case.get('caseId'),
            'modelVersion': case.get('modelVersion'),
            'caseRouteIds': list(case_route_ids),
            'nativeRunDirectory': str(run),
            'nativeDirectoryModified': False,
            'completion': {
                'logsRead': logs,
                'logsMissing': [n for n in LOG_NAMES if n not in logs],
                'completionMarkerPresent': marker,
                'approvedExecutionCapSeconds': case.get('approvedExecutionCapSeconds'),
                'assessment': ('complete_to_requested_end'
                               if marker and coverage['reachesRequestedEnd'] else
                               'partial_or_incomplete_native_output'),
                'assessmentBasis': 'Actual solver logs, native status variables and recorded '
                                   'times versus the case end; not a GitHub run conclusion and '
                                   'not an expected frame count.'},
            'timeCoverage': coverage,
            'faces': len(area),
            'faceCorrespondence': proof,
            'sourceFaceIdentity': 'Exact source native face IDs preserved from this run sfincs.nc',
            'volumeUnits': map_ds.subgrid_volume.attrs.get('units'),
            'volumeUnitsAreM3': map_ds.subgrid_volume.attrs.get('units') in ('m3', 'm^3'),
            'allVolumeFinite': bool(np.isfinite(volume).all()),
            'missingVolumeValues': int((~np.isfinite(volume)).sum()),
            'negativeVolumeValues': int((volume < 0).sum()),
            'negativeValuesPreserved': 'Small negative native values remain signed; not clamped',
            'rawVolumeRangeM3': finite_range(volume),
            'cellAreaRangeM2': [float(area.min()), float(area.max())],
            'volumePerFullCellArea': {'quantity': 'volumePerFullCellAreaM',
                                      'definition': RATIO_DEFINITION,
                                      'rangeM': finite_range(ratio)},
            'firstLastTotalStoredVolumeM3': [number(np.nansum(volume[0])), number(np.nansum(volume[-1]))],
            'surfaceElevationRangeM': finite_range(surface),
            'surfaceElevationUnits': map_ds.zs.attrs.get('units'),
            'surfaceElevationDatum': 'NAVD88, not depth',
            'missingSurfaceValues': int((~np.isfinite(surface)).sum()),
            'notInferred': ['passability', 'bridge clearance', 'velocity', 'flow sections',
                            'uncertainty margins', 'validated road depth'],
            'riverSectionFlow': 'Not read; this reader does not derive flow sections',
            'restartFiles': [f.name for f in sorted(run.glob('*.rst'))],
            'restartLimitation': RESTART_LIMITATION,
            'nativeGeometry': {'sourceEpsg': SOURCE_EPSG,
                               'epsgDeclaredInNativeFile': file_epsg,
                               'domainBoundingBox': domain,
                               'reusedPreviousOutputGeometry': False},
            'hashes': {n: sha(run / n) for n in HASHED_NAMES if (run / n).is_file()},
            'caseNativeMeshSha256': case.get('nativeMeshSha256'),
        }
        mesh_hash = summary['hashes'].get('sfincs.nc')
        declared = case.get('nativeMeshSha256')
        if declared and mesh_hash and declared != mesh_hash:
            raise ValueError('Case metadata nativeMeshSha256 does not match this native input')
        summary['caseMeshHashChecked'] = bool(declared and mesh_hash)
        for name in NATIVE_SCALARS:
            if name in map_ds: summary[name] = np.asarray(map_ds[name].values).tolist()
        precipitation = {}
        for name in PRECIPITATION_NAMES:
            if name in map_ds:
                values = np.asarray(map_ds[name].values, dtype='float64')
                precipitation[name] = {'units': map_ds[name].attrs.get('units'),
                                       'recordedRange': finite_range(values),
                                       'missingValues': int((~np.isfinite(values)).sum())}
        if precipitation:
            summary['nativePrecipitation'] = {'quantities': precipitation,
                                              'units': 'As recorded in the native file'}
        for key in ['scope', 'fullGatesCoverage', 'trackedGatesMemberships',
                    'preparedGatesMemberships', 'blockedGatesMemberships']:
            if key in case:
                summary.setdefault('caseScopeFromMetadata', {})[key] = case[key]

        inverse = {int(v): i for i, v in enumerate(output_source_ids)}
        located = [r for r in retained if r['location']['sourceNativeFaceId'] is not None]
        ambiguous = [r['canonicalId'] for r in located if r['location']['boundaryAmbiguous']]
        not_in_output = []
        destination.mkdir(parents=True)
        np.save(destination / 'output-to-source-face-id.npy', output_source_ids)

        with (destination / 'route-point-series.csv').open('w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['canonical_id', 'inventory_array', 'route_ids',
                             'matched_case_route_ids', 'longitude', 'latitude', 'easting_m',
                             'northing_m', 'source_native_face_id', 'output_face_index',
                             'time_utc', 'subgrid_volume_m3', 'full_cell_area_m2',
                             'volume_per_full_cell_area_m', 'water_surface_navd88_m'])
            for record in retained:
                location = record['location']
                source_id = location['sourceNativeFaceId']
                if source_id is None: continue
                if source_id not in inverse:
                    location['status'] = 'located_in_input_but_absent_from_output'
                    not_in_output.append(record['canonicalId'])
                    continue
                j = inverse[source_id]
                location['outputFaceIndex'] = j
                cell_volume, cell_ratio, cell_surface = volume[:, j], ratio[:, j], surface[:, j]
                finite_surface = np.isfinite(cell_surface)
                peak = int(np.argmax(np.where(finite_surface, cell_surface, -np.inf))) \
                    if finite_surface.any() else None
                record['native'] = {
                    'fullCellAreaM2': float(area[j]),
                    'maxVolumePerFullCellAreaM': number(np.nanmax(cell_ratio))
                    if np.isfinite(cell_ratio).any() else None,
                    'minVolumeM3': number(np.nanmin(cell_volume))
                    if np.isfinite(cell_volume).any() else None,
                    'maxVolumeM3': number(np.nanmax(cell_volume))
                    if np.isfinite(cell_volume).any() else None,
                    'maxWaterSurfaceNAVD88M': number(cell_surface[peak]) if peak is not None else None,
                    'maxWaterSurfaceTime': times[peak] if peak is not None else None,
                    'missingVolumeFrames': int((~np.isfinite(cell_volume)).sum()),
                    'missingSurfaceFrames': int((~finite_surface).sum()),
                    'quantityMeaning': RATIO_DEFINITION}
                routes, matched = ';'.join(record['routeIds']), ';'.join(record['matchedCaseRouteIds'])
                for k, stamp in enumerate(times):
                    writer.writerow([record['canonicalId'], record['inventoryArray'], routes,
                                     matched, record['coordinates'][0], record['coordinates'][1],
                                     record['projected']['eastingM'], record['projected']['northingM'],
                                     source_id, j, stamp, number(cell_volume[k]), float(area[j]),
                                     number(cell_ratio[k]), number(cell_surface[k])])

        outside = [r['canonicalId'] for r in retained
                   if r['location']['status'] == 'outside_current_native_domain']
        points = {
            'runId': run_id,
            'caseId': case.get('caseId'),
            'caseRouteIds': list(case_route_ids),
            'inventory': {'path': str(inventory_path), 'sha256': sha(inventory_path),
                          'schema': inventory.get('schema'), 'arrays': INVENTORY_ARRAYS,
                          'recordCounts': record_counts},
            'caseMetadata': {'path': str(case_path), 'sha256': sha(case_path)},
            'locationMethod': 'Inventory longitude/latitude transformed EPSG:4326 to '
                              f'EPSG:{SOURCE_EPSG} and located in this run exact native cell '
                              'bounds; no other case native face IDs reused',
            'coverageRule': 'Route membership is recorded provenance, not modeled coverage. '
                            'Only an exact native cell containment in this run geometry counts '
                            'as located, and locating a point does not validate road depth.',
            'counts': {'retained': len(retained),
                       'located': sum(1 for r in retained
                                      if r['location']['status'] == 'located_in_current_native_domain'),
                       'outsideCurrentNativeDomain': len(outside),
                       'locatedInInputButAbsentFromOutput': len(not_in_output),
                       'boundaryAmbiguous': len(ambiguous)},
            'boundaryAmbiguity': {'count': len(ambiguous), 'canonicalIds': ambiguous,
                                  'meaning': 'Point falls exactly on a shared native cell '
                                             'boundary; lowest source native face ID selected'},
            'outsideDomainCanonicalIds': outside,
            'locatedInInputButAbsentFromOutputCanonicalIds': not_in_output,
            'timeCoverage': coverage,
            'restartLimitation': RESTART_LIMITATION,
            'points': retained}
        summary['inventoryPointCounts'] = points['counts']
        (destination / 'result-summary.json').write_text(
            json.dumps(summary, indent=2) + '\n', encoding='utf-8')
        (destination / 'route-point-summary.json').write_text(
            json.dumps(points, indent=2) + '\n', encoding='utf-8')
        return summary, points


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('directory', type=Path, help='native run directory, read only')
    p.add_argument('--run-id', required=True)
    p.add_argument('--inventory', type=Path, required=True, help='all-route coverage-ledger.json')
    p.add_argument('--case-metadata', type=Path, help='defaults to current-case.json in directory')
    p.add_argument('--output', type=Path, required=True, help='new output directory')
    a = p.parse_args()
    summary, points = inspect(a.directory, a.run_id, a.inventory,
                              a.case_metadata or a.directory / 'current-case.json', a.output)
    print(json.dumps({'runId': summary['runId'], 'caseId': summary['caseId'],
                      'completion': summary['completion']['assessment'],
                      'framesRecorded': summary['timeCoverage']['framesRecorded'],
                      'recordedValidFrom': summary['timeCoverage']['recordedValidFrom'],
                      'recordedValidTo': summary['timeCoverage']['recordedValidTo'],
                      'reachesRequestedEnd': summary['timeCoverage']['reachesRequestedEnd'],
                      'faces': summary['faces'], 'points': points['counts'],
                      'output': str(a.output)}, indent=2))
