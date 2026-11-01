"""Current forcing adapters; no terrain construction or solver execution.

Registry uses official HydroMT source selection on existing NOAA directed reaches.
Only apply_current_forcing changes an already configured model, after explicit
physical-model/accounting checks. Transport tests may call lower-level adapters.
"""
import argparse
import hashlib
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point, box
from shapely.ops import linemerge
from hydromt_sfincs.workflows import river_source_points


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def utc(value):
    t = pd.Timestamp(value)
    if t.tzinfo is None:
        raise ValueError('Explicit UTC/offset required')
    return t.tz_convert('UTC')


def build_registry(paths, bounds, crs='EPSG:32612'):
    frames = [gpd.read_file(p).to_crs(crs) for p in paths]
    rivers = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=crs)
    if rivers.HydroID.astype(str).duplicated().any():
        raise ValueError('Duplicate HydroID across supplied files')
    rivers['HydroID'] = rivers.HydroID.astype(str)
    rivers['NextDownID'] = rivers.NextDownID.astype(str)
    lookup = rivers.set_index('HydroID')
    direction_checks = 0
    for i, row in rivers.iterrows():
        line = row.geometry
        if line.geom_type == 'MultiLineString':
            line = linemerge(line)
        if line.geom_type != 'LineString':
            raise ValueError('Disconnected river geometry')
        next_id = row.NextDownID
        if next_id in lookup.index:
            downstream = lookup.loc[next_id].geometry
            a = Point(line.coords[0]).distance(downstream)
            b = Point(line.coords[-1]).distance(downstream)
            if min(a, b) > 5 or abs(a - b) < 1:
                raise ValueError(f'Ambiguous downstream connection: {row.HydroID}')
            if a < b:
                from shapely.geometry import LineString
                line = LineString(list(line.coords)[::-1])
            direction_checks += 1
        rivers.at[i, 'geometry'] = line
    region = gpd.GeoDataFrame(geometry=[box(*bounds)], crs=crs)
    points = river_source_points(rivers, region, buffer=200, river_upa=0, river_len=0)
    sources = []
    for index, point in enumerate(points.geometry, 1):
        distances = rivers.distance(point)
        matches = rivers[distances < 0.1]
        if len(matches) != 1:
            raise ValueError('Source cannot be uniquely mapped to a river reach')
        row = matches.iloc[0]
        chain, seen, cursor = [], set(), row.HydroID
        while cursor in lookup.index:
            if cursor in seen:
                raise ValueError('Topology cycle')
            seen.add(cursor)
            item = lookup.loc[cursor]
            chain.append(str(int(item.feature_id)))
            cursor = item.NextDownID
        sources.append({'sourceId': index, 'x': point.x, 'y': point.y,
                        'hydroId': row.HydroID, 'reachId': str(int(row.feature_id)),
                        'downstreamReachIds': list(dict.fromkeys(chain)),
                        'forecastCrosswalk': 'NOAA FIM feature_id; confirm provider network version',
                        'accountingStatus': 'needs_contributing_area_partition'})
    duplicates = len({s['reachId'] for s in sources}) != len(sources)
    return {'schemaVersion': 1, 'kind': 'current_boundary_registry', 'crs': crs,
            'bounds': bounds, 'sources': sources, 'directionChecks': direction_checks,
            'topologyArtifacts': [{'path': str(p), 'sha256': sha(p)} for p in paths],
            'method': 'HydroMT-SFINCS river_source_points; NOAA NextDownID direction checks',
            'networkCoverage': 'supplied NOAA branches only; full domain completeness not established',
            'duplicateReachSources': duplicates, 'physicalRunReady': False,
            'requiredChecks': ['Complete domain inlet coverage', 'Provider reach-version crosswalk',
                               'Disjoint contributing-area/rainfall partition',
                               'Professional model geometry, losses, structures and initial state']}


def discharge_table(registry, series, start, end, as_of):
    """series: normalized [{reachId,status,issuedAt,points:[{time,flowM3s}]}]."""
    start, end, as_of = map(utc, (start, end, as_of))
    if start >= end:
        raise ValueError('Empty run window')
    by_reach = {}
    for item in series:
        key = str(item['reachId'])
        if key in by_reach:
            raise ValueError('Duplicate provider series for a reach')
        by_reach[key] = item
    frames, locations = [], []
    for source in registry['sources']:
        item = by_reach.get(source['reachId'])
        if item is None or item.get('status') != 'ok':
            raise ValueError(f'Missing usable flow at reach {source["reachId"]}')
        if utc(item['issuedAt']) > as_of or utc(item.get('retrievedAt', item['issuedAt'])) > as_of:
            raise ValueError('Provider issue/retrieval after snapshot time')
        times = pd.DatetimeIndex([utc(p['time']) for p in item['points']])
        values = np.array([p['flowM3s'] for p in item['points']], dtype=float)
        if len(times) < 2 or not times.is_monotonic_increasing or times.has_duplicates:
            raise ValueError('Unordered/incomplete discharge series')
        if not np.isfinite(values).all() or (values < 0).any():
            raise ValueError('Missing/negative discharge')
        if np.max(np.diff(times.asi8)) > 3600 * 10**9:
            raise ValueError('Discharge interval exceeds supported hourly cadence')
        # Deliberately no interpolation or held-value extrapolation.
        if start not in times or end not in times:
            raise ValueError('Run endpoints must occur in native flow samples')
        frame = pd.Series(values, index=times, name=int(source['sourceId'])).loc[start:end]
        frames.append(frame)
        locations.append({'index': int(source['sourceId']), 'geometry': Point(source['x'], source['y'])})
    if not frames or any(not frames[0].index.equals(f.index) for f in frames[1:]):
        raise ValueError('Source time grids differ or registry empty')
    table = pd.concat(frames, axis=1)
    table.index = table.index.tz_localize(None)  # native timestamps remain UTC
    return table, gpd.GeoDataFrame(locations, crs=registry['crs']).set_index('index')


def apply_discharge(model, registry, series, start, end, as_of):
    table, locations = discharge_table(registry, series, start, end, as_of)
    model.setup_discharge_forcing(timeseries=table, locations=locations, merge=False)
    actual = model.forcing['dis'].values
    if not np.isfinite(actual).all():
        raise ValueError('HydroMT generated missing discharge')
    return {'sourceCount': len(locations), 'samples': len(table), 'units': 'm3/s',
            'interpolation': 'none; common native timestamps', 'start': str(start), 'end': str(end)}


def apply_precipitation(model, precip, metadata):
    """precip DataArray: regular x/y grid, UTC-naive time = interval START, mm/h.

    metadata includes intervalEndUtc, issuedAt, asOf, units, intervalSeconds,
    status, sourceArtifacts. HRRR decoder/accumulation differencing owned upstream.
    """
    if metadata.get('status') != 'complete' or metadata.get('units') != 'mm/h':
        raise ValueError('Require complete HRRR interval-rate input in mm/h')
    if not metadata.get('sourceArtifacts') or utc(metadata['issuedAt']) > utc(metadata['asOf']):
        raise ValueError('Missing provenance or future issue')
    if precip.name != 'precip' or set(precip.dims) != {'time', 'y', 'x'}:
        raise ValueError('Require precip(time,y,x)')
    if precip.raster.crs is None or not np.isfinite(precip.values).all() or (precip.values < 0).any():
        raise ValueError('Missing CRS or missing/negative precipitation')
    times = pd.DatetimeIndex(precip.time.values)
    seconds = metadata['intervalSeconds']
    if len(times) < 2 or seconds <= 0 or not np.all(np.diff(times.asi8) == seconds * 10**9):
        raise ValueError('Nonuniform precipitation intervals')
    terminal = utc(metadata['intervalEndUtc']).tz_localize(None)
    if terminal != times[-1] + pd.Timedelta(seconds=seconds):
        raise ValueError('Incorrect last precipitation interval')
    start, end = map(pd.Timestamp, model.get_model_time())
    if times[0] > start or terminal < end:
        raise ValueError('Precipitation does not cover run window')
    # Check source footprint before HydroMT's internal fillna(0), never hide a hole.
    footprint = gpd.GeoSeries([box(*precip.raster.bounds)], crs=precip.raster.crs).to_crs(model.crs).iloc[0]
    if not footprint.covers(model.region.geometry.union_all()):
        raise ValueError('HRRR crop does not cover entire model domain')
    preview = precip.raster.reproject(dst_crs=model.crs, method='nearest')
    mask = preview.raster.geometry_mask(model.region, invert=True)
    if not np.isfinite(preview.where(mask).values[:, mask.values]).all():
        raise ValueError('Reprojection leaves an in-domain precipitation hole')
    model.setup_precip_forcing_from_grid(precip, cumulative_input=False,
                                         time_label='left', aggregate=False, method='nearest')
    return {'units': 'mm/h', 'intervalSeconds': seconds, 'intervalLabel': 'start',
            'lastIntervalEndUtc': metadata['intervalEndUtc'], 'sourceArtifacts': metadata['sourceArtifacts']}


def apply_current_forcing(model, registry, snapshot, precip, precipitation_metadata, physical_manifest):
    """Only complete, explicitly accounted physical cases may use this entrypoint."""
    required = ('geometrySupported', 'structuresAccountedFor', 'lossesSpecified',
                'initialStateSpecified', 'inletCoverageComplete', 'contributingAreasDisjoint',
                'rainfallPartitionVerified', 'forecastCrosswalkVerified')
    if any(physical_manifest.get(k) is not True for k in required):
        raise ValueError('Incomplete physical/accounting manifest: ' + ', '.join(
            k for k in required if physical_manifest.get(k) is not True))
    if not physical_manifest.get('evidenceArtifacts') or registry['duplicateReachSources']:
        raise ValueError('Missing physical evidence or duplicate cumulative flows')
    selected = {s['reachId'] for s in registry['sources']}
    if any((set(s['downstreamReachIds']) - {s['reachId']}) & selected for s in registry['sources']):
        raise ValueError('Nested cumulative boundary sources')
    discharge = apply_discharge(model, registry, snapshot['series'], snapshot['start'],
                                snapshot['end'], snapshot['asOf'])
    rainfall = apply_precipitation(model, precip, precipitation_metadata)
    return {'discharge': discharge, 'precipitation': rainfall, 'solverExecuted': False}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--rivers', nargs='+', type=Path, required=True)
    p.add_argument('--bounds', nargs=4, type=float, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if a.output.exists():
        p.error('Preserve existing registry; select a new output')
    registry = build_registry(a.rivers, a.bounds)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(registry, indent=2) + '\n')
    print(json.dumps(registry, indent=2))


if __name__ == '__main__':
    main()
