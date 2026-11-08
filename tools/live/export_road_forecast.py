"""Small, provenance-bound road forecasts from native all-route SFINCS output.

Only the pinned route stations are used, not nearest roads or cell ground heights.
Stations must be inside exactly one native polygon. Unknowns stay unknown; a finite
native volume below the dry threshold establishes a dry cell even if zs is absent.
This module is also usable on an already-exported compact package, without a solver.
"""
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np


WET_M = 0.0091
ROADS = Path(__file__).resolve().parent / 'road-stations'
CASE_ROUTES = {
    'northern': ('trico', 'avra', 'silverbell-north', 'silverbell-south'),
    'picture-rocks': ('pr-ina', 'pr-twinpeaks', 'pr-avra'),
    'gates': ('pr-gates',),
    # Owns no rated route (the Sandario Rd route segments inside its domain stay
    # with picture-rocks/gates). Its local roads are exported separately, see
    # LocalRoadForecast and the case's 'localRoads' entry in all-route-cases.json.
    'brawley-avra-west': (),
}
DTYPES = {'d': '<f8', 'f': '<f4', 'I': '<u4', 'u4': '<u4',
          'i4': '<i4', 'u1': 'u1', 'i1': 'i1', 'i2': '<i2'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_columns(path, expected_format, sha256=None):
    encoded = Path(path).read_bytes()
    if sha256 and digest(encoded) != sha256:
        raise ValueError('Checksum mismatch: ' + str(path))
    raw = gzip.decompress(encoded)
    size = int.from_bytes(raw[:4], 'little')
    if size < 2 or size > len(raw) - 4:
        raise ValueError('Invalid binary header')
    header = json.loads(raw[4:4 + size])
    if header.get('format') != expected_format:
        raise ValueError('Unexpected binary format')
    columns = {}
    for name, descriptor in header['columns'].items():
        dtype = np.dtype(DTYPES[descriptor['type']])
        offset, count = descriptor['offset'], descriptor['count']
        if (not isinstance(offset, int) or not isinstance(count, int) or
                min(offset, count) < 0 or 4 + size + offset + count * dtype.itemsize > len(raw)):
            raise ValueError('Invalid column: ' + name)
        columns[name] = np.frombuffer(raw, dtype=dtype, count=count, offset=4 + size + offset)
    return header, columns


def load_roads(case, root=ROADS):
    root = Path(root)
    source = json.loads((root / 'source.json').read_text())
    header, cols = read_columns(root / 'routes.bin.gz', 'floodplain-road-heights-v1', source['sha256'])
    starts = cols['lineStart']
    count = len(cols['flags'])
    if (len(starts) != len(header['lines']['routeId']) + 1 or starts[0] != 0 or
            starts[-1] != count or np.any(starts[1:] < starts[:-1]) or
            any(len(cols[k]) != count for k in ('dLonE6', 'dLatE6', 'dZCm', 'source'))):
        raise ValueError('Invalid road station columns')
    routes = {key: [] for key in CASE_ROUTES[case]}
    for i, route_id in enumerate(header['lines']['routeId']):
        if route_id not in routes or header['lines']['kind'][i] != 'route':
            continue
        a, b = int(starts[i]), int(starts[i + 1])
        lon = np.cumsum(cols['dLonE6'][a:b], dtype=np.int64) / 1e6
        lat = np.cumsum(cols['dLatE6'][a:b], dtype=np.int64) / 1e6
        height = np.cumsum(cols['dZCm'][a:b], dtype=np.int64) / 100.0
        flags = cols['flags'][a:b]
        for k in range(b - a):
            routes[route_id].append({'lon': float(lon[k]), 'lat': float(lat[k]),
                                    'roadM': None if flags[k] & 4 else float(height[k]),
                                    'flags': int(flags[k]), 'source': int(cols['source'][a + k])})
    if any(not stations for stations in routes.values()):
        raise ValueError('Pinned source does not contain every case route')
    return routes, source, header['metadata']


class NativeGeometry:
    """Bounding-box candidates followed by exact polygon containment, never nearest cell."""

    def __init__(self, columns):
        self.area = columns['areaM2']
        self.resolution = columns['resolutionM']
        self.vertices = columns['vertices'].reshape(-1, 2)[:, ::-1]  # stored latitude, longitude
        self.offsets = columns['ringOffsets'].astype(np.int64)
        self.indices = columns['ringIndices'].astype(np.int64)
        count = len(self.area)
        if (len(self.offsets) != count + 1 or self.offsets[0] != 0 or self.offsets[-1] != len(self.indices)
                or np.any(np.diff(self.offsets) < 3) or np.any(self.indices < 0)
                or np.any(self.indices >= len(self.vertices)) or len(self.resolution) != count
                or not np.isfinite(self.vertices).all() or not np.isfinite(self.area).all()
                or np.any(self.area <= 0) or not np.isfinite(self.resolution).all()
                or np.any(self.resolution <= 0)):
            raise ValueError('Invalid native geometry')
        ring = self.vertices[self.indices]
        self.minimum = np.minimum.reduceat(ring, self.offsets[:-1], axis=0)
        self.maximum = np.maximum.reduceat(ring, self.offsets[:-1], axis=0)
        # Sort face centres into uniform geographic buckets. Every face candidate is
        # still checked against its actual polygon, including hanging quadtree nodes.
        self.step = max(float(np.max(self.maximum - self.minimum)), 1e-5)
        centres = (self.maximum + self.minimum) * 0.5
        bins = np.floor(centres / self.step).astype(np.int64)
        self.origin = bins.min(axis=0)
        self.width = int(bins[:, 0].max() - self.origin[0] + 1)
        keys = (bins[:, 1] - self.origin[1]) * self.width + bins[:, 0] - self.origin[0]
        order = np.argsort(keys)
        unique, starts = np.unique(keys[order], return_index=True)
        ends = np.r_[starts[1:], len(order)]
        self.buckets = {int(k): order[a:b] for k, a, b in zip(unique, starts, ends)}
        self.last_bin = bins.max(axis=0)

    @classmethod
    def load(cls, path, sha256):
        header, columns = read_columns(path, 'floodplain-columns-v1', sha256)
        metadata = header['metadata']
        if metadata.get('coordinates') != 'latitude,longitude' or metadata.get('geometryKind') != 'native_quadtree_faces':
            raise ValueError('Unsupported native geometry coordinates')
        return cls(columns)

    @staticmethod
    def contains(polygon, x, y):
        """Closed polygon containment. Shared boundaries become ambiguous, not arbitrary."""
        inside = False
        previous = polygon[-1]
        for current in polygon:
            ax, ay = previous
            bx, by = current
            cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
            # Tight floating tolerance only, not a geographic buffer or road snap.
            tolerance = 1e-12 * max(abs(bx - ax), abs(by - ay), 1e-12)
            if abs(cross) <= tolerance and min(ax, bx) - 1e-12 <= x <= max(ax, bx) + 1e-12 and min(ay, by) - 1e-12 <= y <= max(ay, by) + 1e-12:
                return True
            if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
                inside = not inside
            previous = current
        return inside

    def locate(self, lon, lat):
        if not np.isfinite([lon, lat]).all():
            return -1
        bx, by = np.floor(np.array([lon, lat]) / self.step).astype(np.int64)
        found = -1
        for iy in range(by - 1, by + 2):
            for ix in range(bx - 1, bx + 2):
                if not (self.origin[0] <= ix <= self.last_bin[0] and self.origin[1] <= iy <= self.last_bin[1]):
                    continue
                key = (iy - self.origin[1]) * self.width + ix - self.origin[0]
                candidates = self.buckets.get(int(key))
                if candidates is None:
                    continue
                lo, hi = self.minimum[candidates], self.maximum[candidates]
                keep = (lo[:, 0] - 1e-12 <= lon) & (hi[:, 0] + 1e-12 >= lon) & (lo[:, 1] - 1e-12 <= lat) & (hi[:, 1] + 1e-12 >= lat)
                for face in candidates[keep]:
                    polygon = self.vertices[self.indices[self.offsets[face]:self.offsets[face + 1]]]
                    if self.contains(polygon, lon, lat):
                        if found >= 0:
                            return -2
                        found = int(face)
        return found


def classify(volume, surface, area, faces):
    """Shared wet/dry rule for routes and local roads, at the given native faces.

    Native volume, not surface-bed or a display interpolation, defines dry. A
    finite volume below WET_M is known dry even if zs is missing; a wet cell
    needs a finite, non-fill zs. Anything else (NaN/inf/negative volume, missing
    wet surface) is unknown, never dry. Returns (valid, dry, z).
    """
    depth = np.asarray(volume[faces], dtype=float) / area[faces]
    z = np.asarray(surface[faces], dtype=float)
    dry = np.isfinite(depth) & (depth >= 0) & (depth < WET_M)
    valid = dry | (np.isfinite(depth) & (depth >= WET_M) & np.isfinite(z) & (z != -99999.0))
    return valid, dry, z


class RoadForecast:
    def __init__(self, case, geometry, routes, source, road_metadata):
        self.case, self.geometry, self.source, self.road_metadata = case, geometry, source, road_metadata
        self.times, self.routes, self.samples = [], {}, {}
        for route_id, stations in routes.items():
            faces = np.array([geometry.locate(s['lon'], s['lat']) for s in stations], dtype=np.int64)
            heights = np.array([np.nan if s['roadM'] is None else s['roadM'] for s in stations])
            self.samples[route_id] = (stations, faces, heights)
            self.routes[route_id] = {
                'totalStations': len(stations), 'mappedStations': int(((faces >= 0) & np.isfinite(heights)).sum()),
                'unknownHeightStations': int((~np.isfinite(heights)).sum()),
                'outsideStations': int(((faces < 0) & np.isfinite(heights)).sum()),
                'ambiguousStations': int(((faces == -2) & np.isfinite(heights)).sum()),
                'deckLidarStations': sum(bool(s['flags'] & 1) for s in stations),
                'deckApproachStations': sum(bool(s['flags'] & 2) for s in stations),
                'untaggedStructureStations': sum(bool(s['flags'] & 8) for s in stations),
                'frames': [],
            }

    @classmethod
    def load(cls, case, geometry_path, geometry_sha256, road_root=ROADS):
        routes, source, metadata = load_roads(case, road_root)
        return cls(case, NativeGeometry.load(geometry_path, geometry_sha256), routes, source, metadata)

    def add_frame(self, time, volume, surface):
        if self.times and time <= self.times[-1]:
            raise ValueError('Road forecast frames must have increasing times')
        if len(volume) != len(self.geometry.area) or len(surface) != len(self.geometry.area):
            raise ValueError('Native frame does not match geometry')
        self.times.append(time)
        for route_id, (stations, faces, heights) in self.samples.items():
            mapped = (faces >= 0) & np.isfinite(heights)
            candidates = np.flatnonzero(mapped)
            valid, dry, z = classify(volume, surface, self.geometry.area, faces[candidates])
            road_depth = np.zeros(len(candidates), dtype=float)
            wet = valid & ~dry
            # Preserve the existing high-resolution all-route prediction: native
            # depth establishes dry/wet, but is not a cap on road/deck depth. The
            # average-depth cap belongs only to the separate 100 m coarse model.
            road_depth[wet] = np.maximum(z[wet] - heights[candidates[wet]], 0)
            valid_count = int(valid.sum())
            peak, station = None, None
            if valid_count:
                valid_indices = np.flatnonzero(valid)
                best = valid_indices[np.argmax(road_depth[valid])]
                peak, station = round(float(road_depth[best]), 6), stations[candidates[best]]
            self.routes[route_id]['frames'].append({
                'peakRoadDepthM': peak, 'validStations': valid_count,
                'wetStations': int((valid & (road_depth >= WET_M)).sum()),
                'lat': station['lat'] if station else None, 'lon': station['lon'] if station else None,
                'deck': bool(station['flags'] & 3) if station else None,
                'coverage': 'complete' if valid_count == len(stations) and valid_count else 'partial' if valid_count else 'unavailable',
            })

    def write(self, path, manifest):
        expected_times = [frame['time'] for frame in manifest['frames']]
        if self.times != expected_times:
            raise ValueError('Road forecast times differ from compact frames')
        complete = manifest['status'] == 'complete' and manifest['solverCompletion']['status'] == 'complete'
        result = {
            'schemaVersion': 1, 'kind': 'live_all_route_road_forecast',
            'case': self.case, 'runId': manifest['runId'], 'modelVersion': manifest['modelVersion'],
            'executionMode': manifest['executionMode'], 'status': 'complete' if complete else 'partial',
            'issuedAt': manifest['issuedAt'], 'hrrrCycle': manifest['sourceIssues']['HRRR'],
            'validFrom': self.times[0] if self.times else None, 'validTo': self.times[-1] if self.times else None,
            'times': self.times, 'routes': self.routes, 'dryThresholdM': WET_M,
            'quantity': {'units': 'm', 'definition': 'max(0, waterSurface - roadOrDeckHeight); finite native depth below dryThresholdM is zero; no cell-average-depth cap for the high-resolution all-route model'},
            'provenance': {
                'geometrySha256': manifest['geometry']['sha256'],
                'caseArchiveSha256': manifest['caseArchiveSha256'],
                'roadStations': self.source, 'roadHeightMetadata': self.road_metadata,
                'mapping': 'Exact native polygon containment in compact frame face order; shared-boundary ambiguity and outside stations have no value',
                'solverCompletion': manifest['solverCompletion'], 'flowNotes': manifest.get('flowNotes', []),
            },
            # Per inlet: nwm, or usgs+nwm (observed past hours, NWM forecast and flagged gaps).
            'inflowSource': manifest.get('inflowSource'),
            'uncertainty': manifest['uncertainty'],
            'limits': manifest['limits'] + ' Road heights are lidar-derived estimates, not pavement surveys. Missing stations or frames cannot establish a dry route. Approach-estimated bridge decks retain their provenance.',
        }
        encoded = (json.dumps(result, separators=(',', ':'), allow_nan=False) + '\n').encode()
        Path(path).write_bytes(encoded)
        return {'path': Path(path).name, 'sha256': digest(encoded), 'bytes': len(encoded),
                'kind': result['kind'], 'schemaVersion': 1}


def export_compact(case, directory):
    """Backfill a compact live package without downloading or rerunning the solver."""
    directory = Path(directory)
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest.get('case') != case or manifest.get('executionMode') != 'live_current_forcing':
        raise ValueError('Not the requested live case')
    forecast = RoadForecast.load(case, directory / manifest['geometry']['path'], manifest['geometry']['sha256'])
    for frame in manifest['frames']:
        header, cols = read_columns(directory / frame['path'], 'floodplain-columns-v1', frame['sha256'])
        metadata = header['metadata']
        if metadata.get('runId') != manifest['runId'] or metadata.get('time') != frame['time'] or metadata.get('geometrySha256') != manifest['geometry']['sha256']:
            raise ValueError('Compact frame provenance mismatch')
        forecast.add_frame(frame['time'], cols['nativeVolumeM3'], cols['waterSurfaceM'])
    return forecast.write(directory / 'road-forecast.json', manifest)




# ---------------------------------------------------------------------------------------------
# Local roads (map only, never in route ratings). Contract v2, see the app's
# docs/upgrade/LOCAL-ROAD-FORECAST.md:
#   * a static station file ships with the app once (local_static_bytes), and
#   * the live local-road-forecast.json lists only stations that are not plain dry, as columnar
#     arrays indexed into that static file, pinned to it by stationsSha256.
LOCAL_KIND = 'floodplain-local-road-forecast'
LOCAL_SCHEMA = 2
LOCAL_STATIONS_KIND = 'floodplain-local-road-stations'
LOCAL_STATIC_KIND = 'floodplain-local-road-station-geometry'
# A frozen compact package carries no modelVersion field; its case's version stands in.
MODEL_VERSIONS = {'brawley-avra-west': 'all-routes-brawley-avra-west-v1'}
LOCAL_STATES = ('over', 'below', 'dry', 'no-road-height', 'no-cell', 'unknown')
SUMMARY_KEYS = {'over': 'over', 'below': 'below', 'dry': 'dry', 'no-road-height': 'noRoadHeight',
                'no-cell': 'noCell', 'unknown': 'unknown'}
# Live list state codes (index into this tuple). dry is implied by absence; no-road-height comes
# from the static file (roadZCm null, flag noTerrain).
LIVE_STATES = ('over', 'below', 'unknown', 'no-cell')
LOCAL_FLAGS = {'deckLidar': 1, 'deckApproach': 2, 'noTerrain': 4, 'structureUntagged': 8}


def load_local_stations(path, sha256):
    """Frozen, sha-pinned local station list (tools/live/build_local_road_stations.py)."""
    encoded = Path(path).read_bytes()
    if digest(encoded) != sha256:
        raise ValueError('Checksum mismatch: ' + str(path))
    data = json.loads(gzip.decompress(encoded))
    cols = data.get('columns') or {}
    keys = ('id', 'road', 'lon', 'lat', 'roadZ', 'flags')
    if (data.get('kind') != LOCAL_STATIONS_KIND or data.get('schemaVersion') != 1
            or data.get('roadHeights') != 'floodplain-road-heights-v1'
            or any(not isinstance(cols.get(k), list) for k in keys)
            or len({len(cols[k]) for k in keys}) != 1 or len(set(cols['id'])) != len(cols['id'])):
        raise ValueError('Invalid local road station file')
    stations = []
    for i in range(len(cols['id'])):
        z, flags = cols['roadZ'][i], int(cols['flags'][i])
        # A station without terrain keeps no height, whatever the column holds.
        if flags & 4 or z is None:
            z = None
        stations.append({'id': cols['id'][i], 'road': cols['road'][i], 'lon': float(cols['lon'][i]),
                         'lat': float(cols['lat'][i]), 'roadM': None if z is None else float(z), 'flags': flags,
                         'kind': (cols.get('kind') or [None] * len(cols['id']))[i]})
    return stations, data


def _cm(metres):
    return int(round(round(metres * 100.0, 6)))


def local_static_bytes(stations, data, source_path, source_sha256):
    """The app's static station file, deterministic bytes (its sha256 pins every live file).

    Station order is the source order (the live file indexes into it). Station id is
    '<line>:<stationDm>'; lines are contiguous runs sharing one road name and kind, so per-line
    tables plus per-station deltas keep it small. Decoding (decode_local_static, and the app's
    parseLocalRoadStations): running sums of dDm/dLonE6/dLatE6 over the whole array, restarting
    nothing; dZCm is a running sum over non-null entries, null = no road height.
    """
    line_ids, line_road, line_kind, line_start = [], [], [], []
    roads, road_index, seen = [], {}, set()
    d_dm, d_lon, d_lat, d_z, flag_index, flag_value = [], [], [], [], [], []
    prev_dm = prev_lon = prev_lat = prev_z = 0
    for i, s in enumerate(stations):
        line, sep, dm = s['id'].rpartition(':')
        if not sep or not line or not dm.isdigit() or str(int(dm)) != dm:
            raise ValueError('Station id is not <line>:<stationDm>: ' + s['id'])
        road = s['road'] if isinstance(s['road'], str) else ''
        if not line_ids or line_ids[-1] != line:
            if line in seen:
                raise ValueError('Station lines are not contiguous: ' + line)
            seen.add(line)
            if road not in road_index:
                road_index[road] = len(roads)
                roads.append(road)
            line_ids.append(line); line_road.append(road_index[road]); line_kind.append(s.get('kind'))
            line_start.append(i)
        elif roads[line_road[-1]] != road or line_kind[-1] != s.get('kind'):
            raise ValueError('Road name changes inside a line: ' + s['id'])
        dm, lon, lat = int(dm), int(round(s['lon'] * 1e6)), int(round(s['lat'] * 1e6))
        d_dm.append(dm - prev_dm); d_lon.append(lon - prev_lon); d_lat.append(lat - prev_lat)
        prev_dm, prev_lon, prev_lat = dm, lon, lat
        if s['roadM'] is None:
            d_z.append(None)
        else:
            z = _cm(s['roadM'])
            d_z.append(z - prev_z)
            prev_z = z
        if s['flags']:
            flag_index.append(i); flag_value.append(int(s['flags']))
    kinds = sorted({k for k in line_kind if k is not None})
    result = {
        'schemaVersion': 1, 'kind': LOCAL_STATIC_KIND, 'case': data.get('case'),
        'version': Path(source_path).name.split('.')[0], 'roadHeights': data.get('roadHeights'),
        'datum': 'NAVD88', 'units': {'lonLat': 'microdegrees (6 dp)', 'roadZ': 'cm', 'stationDm': 'dm'},
        'source': {'file': Path(source_path).name, 'sha256': source_sha256,  # name only: same bytes from any cwd
                   'commit': (data.get('source') or {}).get('commit'),
                   'selection': (data.get('selection') or {}).get('rule')},
        'stationCount': len(stations), 'flagBits': LOCAL_FLAGS,
        'elevation': 'Bare-earth lidar road estimate, not a surveyed road or bridge deck.',
        'encoding': ('Station i: id = lines.id[line] + ":" + stationDm. stationDm, lonE6, latE6 are running sums '
                     'of dDm, dLonE6, dLatE6 from 0 over all stations. roadZCm is a running sum of dZCm over '
                     'non-null entries; null = no road height. lines.start[k] is the first station of line k. '
                     'flags are 0 except at flags.index. A line is also its polyline.'),
        'roads': roads, 'kinds': kinds,
        'lines': {'id': line_ids, 'road': line_road, 'kind': [kinds.index(k) if k is not None else None for k in line_kind],
                  'start': line_start},
        'stations': {'dDm': d_dm, 'dLonE6': d_lon, 'dLatE6': d_lat, 'dZCm': d_z},
        'flags': {'index': flag_index, 'value': flag_value},
    }
    return (json.dumps(result, separators=(',', ':'), ensure_ascii=True, allow_nan=False) + '\n').encode()


def decode_local_static(raw):
    """Inverse of local_static_bytes, for tests and verification: list of station dicts."""
    data = json.loads(raw)
    if data.get('kind') != LOCAL_STATIC_KIND or data.get('schemaVersion') != 1:
        raise ValueError('Invalid local static station file')
    lines, cols, n = data['lines'], data['stations'], data['stationCount']
    if any(len(cols[k]) != n for k in ('dDm', 'dLonE6', 'dLatE6', 'dZCm')):
        raise ValueError('Local static station columns differ in length')
    flags = dict(zip(data['flags']['index'], data['flags']['value']))
    starts = lines['start'] + [n]
    out, dm, lon, lat, z = [], 0, 0, 0, 0
    for k in range(len(lines['id'])):
        for i in range(starts[k], starts[k + 1]):
            dm += cols['dDm'][i]; lon += cols['dLonE6'][i]; lat += cols['dLatE6'][i]
            zc = None
            if cols['dZCm'][i] is not None:
                z += cols['dZCm'][i]; zc = z
            out.append({'id': f"{lines['id'][k]}:{dm}", 'road': data['roads'][lines['road'][k]],
                        'lonE6': lon, 'latE6': lat, 'roadZCm': zc, 'flags': flags.get(i, 0)})
    return out, data


def static_for(stations, data, stations_path, stations_sha256):
    raw = local_static_bytes(stations, data, stations_path, stations_sha256)
    return raw, digest(raw), Path(stations_path).name.split('.')[0]


def iso_z(value):
    return value if value is None or value.endswith('Z') else value.replace('+00:00', 'Z')


def _parse_time(value):
    import datetime as dt
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def inflow_summary(manifest):
    """Where the inflows came from, in a few fields (full detail stays in the compact manifest).

    Uses the manifest's per-inlet inflowSource (nwm, or usgs+nwm with observed past hours) when it
    has one, else the NWM flowSources providers. A package that records neither says so.
    """
    per = manifest.get('inflowSource')
    keys = ('reachId', 'source', 'nwmProvider', 'usgsSite', 'usgsStatus', 'provisional')
    if isinstance(per, list) and per:
        inlets = [{k: i.get(k) for k in keys if (i or {}).get(k) is not None} for i in per]
    else:
        inlets = [{'reachId': str(s['reachId']), 'source': 'nwm', 'nwmProvider': s.get('provider')}
                  for s in manifest.get('flowSources') or [] if (s or {}).get('reachId') is not None]
    kinds = sorted({i.get('source') or 'unknown' for i in inlets})
    return {'summary': ', '.join(kinds) if inlets else 'not recorded in this package', 'inlets': inlets,
            'description': (manifest.get('sourceIssues') or {}).get('NWM'),
            'notes': list(manifest.get('flowNotes') or [])}


class LocalRoadForecast:
    """Per-station peak water-surface elevation against road height, for local roads.

    Same native face location (exact polygon containment, shared boundaries are
    ambiguous) and the same wet/dry rule (classify) as the route forecast. The
    comparison is cell water-surface elevation zs (NAVD88 m) against the station's
    road height; average cell depth is never used as road depth. A frame that is
    unknown at a station is counted, never treated as dry.
    """

    def __init__(self, case, geometry, stations, station_source):
        self.case, self.geometry, self.stations, self.station_source = case, geometry, stations, station_source
        self.faces = np.array([geometry.locate(s['lon'], s['lat']) for s in stations], dtype=np.int64)
        self.heights = np.array([np.nan if s['roadM'] is None else s['roadM'] for s in stations], dtype=float)
        n = len(stations)
        self.max_wse = np.full(n, np.nan)
        self.first_over = [None] * n
        self.unknown = np.zeros(n, dtype=np.int64)
        self.times = []
        self.located = np.flatnonzero(self.faces >= 0)

    def add_frame(self, time, volume, surface):
        if self.times and time <= self.times[-1]:
            raise ValueError('Local road forecast frames must have increasing times')
        if len(volume) != len(self.geometry.area) or len(surface) != len(self.geometry.area):
            raise ValueError('Native frame does not match geometry')
        self.times.append(time)
        idx = self.located
        if not len(idx):
            return
        valid, dry, z = classify(volume, surface, self.geometry.area, self.faces[idx])
        wet = valid & ~dry
        self.unknown[idx[~valid]] += 1
        wet_idx = idx[wet]
        self.max_wse[wet_idx] = np.fmax(self.max_wse[wet_idx], z[wet])
        over = wet_idx[z[wet] > self.heights[wet_idx]]  # a NaN height is never over
        for k in over:
            if self.first_over[k] is None:
                self.first_over[k] = time

    def state(self, k):
        face, height, wse = int(self.faces[k]), self.heights[k], self.max_wse[k]
        if not np.isfinite(height):
            return 'no-road-height'
        if face < 0:
            return 'no-cell'
        if np.isfinite(wse) and wse > height:
            return 'over'  # over in a valid frame; unknownFrames (may be >= 1) travels with it
        if not self.times or self.unknown[k]:
            # A frame without a valid reading could have been the one with water over the road:
            # never a firm below, never dry.
            return 'unknown'
        return 'below' if np.isfinite(wse) else 'dry'  # every frame of the window had a valid reading

    def station_rows(self):
        """Per-station rows in metres (diagnostics and tests; the file itself is columnar)."""
        rows, summary = [], dict.fromkeys(SUMMARY_KEYS.values(), 0)
        for k, s in enumerate(self.stations):
            face, height, wse = int(self.faces[k]), self.heights[k], self.max_wse[k]
            state = self.state(k)
            summary[SUMMARY_KEYS[state]] += 1
            wet = face >= 0 and np.isfinite(wse)
            rows.append({
                'id': s['id'], 'road': s['road'], 'lon': s['lon'], 'lat': s['lat'],
                'roadZ': round(float(height), 3) if np.isfinite(height) else None,
                'cellSizeM': round(float(self.geometry.resolution[face]), 4) if face >= 0 else None,
                'maxWse': round(float(wse), 3) if wet else None,
                'maxOver': round(float(wse - height), 3) if wet and np.isfinite(height) else None,
                'firstOverTime': iso_z(self.first_over[k]) if np.isfinite(height) and face >= 0 else None,
                'state': state, 'flags': s['flags'],
                'unknownFrames': int(self.unknown[k]) if face >= 0 else None,
            })
        return rows, {'stations': len(rows), **summary}

    def listed(self):
        """Columnar live list: every station that is not plain dry and has a road height.

        Centimetres. roadZCm = round(roadZ * 100) is the static file's value and c = ceil(maxWse * 100)
        (maxWse * 100 first rounded to 6 dp, so float noise never adds a centimetre). The state is
        authoritative, so c is clamped to agree with it: over -> maxWseCm = max(c, roadZCm + 1);
        below -> maxWseCm = min(c, roadZCm). maxOverCm = maxWseCm - roadZCm exactly, so over >= 1
        and below <= 0. firstOverMin is minutes after forecastStart. unknownFrames is the number of
        frames with no valid reading: >= 1 for unknown, possibly >= 1 for over, always 0 for below.
        """
        cols = {k: [] for k in ('index', 'state', 'maxWseCm', 'maxOverCm', 'firstOverMin', 'cellSizeM', 'unknownFrames')}
        summary = dict.fromkeys(SUMMARY_KEYS.values(), 0)
        start = _parse_time(self.times[0]) if self.times else None
        for k in range(len(self.stations)):
            state = self.state(k)
            summary[SUMMARY_KEYS[state]] += 1
            if state in ('dry', 'no-road-height'):
                continue
            face, height, wse = int(self.faces[k]), self.heights[k], self.max_wse[k]
            wse_cm = over_cm = first = None
            if state in ('over', 'below'):
                z_cm = _cm(float(height))
                wse_cm = int(np.ceil(round(float(wse) * 100.0, 6)))
                if state == 'over':
                    wse_cm = max(wse_cm, z_cm + 1)
                    first = int(round((_parse_time(self.first_over[k]) - start).total_seconds() / 60))
                else:
                    wse_cm = min(wse_cm, z_cm)
                over_cm = wse_cm - z_cm
            cols['index'].append(k)
            cols['state'].append(LIVE_STATES.index(state))
            cols['maxWseCm'].append(wse_cm)
            cols['maxOverCm'].append(over_cm)
            cols['firstOverMin'].append(first)
            cols['cellSizeM'].append(round(float(self.geometry.resolution[face]), 2) if face >= 0 else None)
            cols['unknownFrames'].append(int(self.unknown[k]) if face >= 0 else None)
        return cols, {'stations': len(self.stations), **summary}

    def write(self, path, manifest):
        expected_times = [frame['time'] for frame in manifest['frames']]
        if self.times != expected_times:
            raise ValueError('Local road forecast times differ from compact frames')
        if not self.times:
            raise ValueError('Local road forecast has no frames')
        for key in ('stationsSha256', 'stationsVersion'):
            if not self.station_source.get(key):
                raise ValueError('Local road forecast needs the static station file ' + key)
        solver = (manifest.get('solverCompletion') or {}).get('status')
        complete = manifest.get('status') == 'complete' and solver == 'complete'
        issues = manifest.get('sourceIssues') or {}
        model_version = manifest.get('modelVersion') or MODEL_VERSIONS.get(self.case)
        if not model_version:
            raise ValueError('Package has no modelVersion')
        listed, summary = self.listed()
        result = {
            'schemaVersion': LOCAL_SCHEMA, 'kind': LOCAL_KIND, 'case': self.case, 'modelVersion': model_version,
            'runId': manifest['runId'],
            # A frozen package has no issue time of its own; its HRRR issue stands in.
            'issuedAt': iso_z(manifest.get('issuedAt') or issues.get('HRRR')),
            'forecastStart': iso_z(self.times[0]), 'forecastEnd': iso_z(self.times[-1]),
            'status': 'ok' if complete else 'partial',
            'datum': 'NAVD88 metres', 'roadHeights': 'floodplain-road-heights-v1',
            'stationsSha256': self.station_source['stationsSha256'],
            'stationsVersion': self.station_source['stationsVersion'],
            'stationCount': len(self.stations),
            'inflowSource': inflow_summary(manifest),
            'executionMode': manifest.get('executionMode'), 'hrrrCycle': iso_z(issues.get('HRRR')),
            'frames': len(self.times), 'dryThresholdM': WET_M,
            'summary': summary, 'stateCodes': list(LIVE_STATES), 'listed': listed,
            'definition': ('maxWse = max cell water-surface elevation zs over frames where the native cell is wet '
                           '(native volume/area >= dryThresholdM and finite zs); maxOver = maxWse - roadZ. '
                           'listed = every station that is not plain dry: over, below, unknown, no-cell, indexed '
                           'into the static station file whose sha256 is stationsSha256. A station absent from '
                           'listed with a road height is dry (known dry in every frame); no-road-height comes from '
                           'the static file. unknown = not over in any valid frame, and at least one frame had no '
                           'valid reading (never treated as dry or below). over can also carry unknownFrames >= 1 '
                           '(some frames missing); below always has unknownFrames 0. maxWseCm = ceil(maxWse*100) '
                           'clamped to the state: over max(.., roadZCm+1), below min(.., roadZCm); maxOverCm = '
                           'maxWseCm - roadZCm. firstOverMin = minutes after forecastStart. Bare-earth lidar road '
                           'height, not a surveyed deck; flags: deckLidar=1, deckApproach=2, noTerrain=4, '
                           'structureUntagged=8.'),
            'provenance': {
                'geometrySha256': manifest['geometry']['sha256'],
                'caseArchiveSha256': manifest.get('caseArchiveSha256'),
                'localStations': {k: v for k, v in self.station_source.items() if k not in ('stationsSha256', 'stationsVersion')},
                'mapping': 'Exact native polygon containment in compact frame face order; shared-boundary ambiguity and outside stations are no-cell',
                'solverCompletion': manifest.get('solverCompletion'),
            },
            'limits': ('Model forecast, not observed water. Road heights are lidar-derived bare-earth estimates, '
                       'not pavement or bridge-deck surveys. No bridge or culvert openings. Missing readings never '
                       'establish a dry road.'),
        }
        encoded = (json.dumps(result, separators=(',', ':'), allow_nan=False) + '\n').encode()
        Path(path).write_bytes(encoded)
        return {'path': Path(path).name, 'sha256': digest(encoded), 'bytes': len(encoded),
                'kind': LOCAL_KIND, 'schemaVersion': LOCAL_SCHEMA, 'summary': summary,
                'stationsSha256': self.station_source['stationsSha256']}


def local_entry(case):
    from run_live_all_route import case_entry  # avoids an import cycle at module load
    entry = case_entry(case)
    if not entry.get('localRoads'):
        raise ValueError('Case has no localRoads entry: ' + case)
    return entry['localRoads']


def local_stations_for(case, stations_path=None, stations_sha256=None):
    """Pinned stations plus the static app file they produce: (stations, data, source, static_raw)."""
    if stations_path is None:
        local = local_entry(case)
        stations_path, stations_sha256 = local['path'], local['sha256']
    stations, data = load_local_stations(stations_path, stations_sha256)
    if data.get('case') != case:
        raise ValueError('Local stations belong to another case')
    raw, static_sha, version = static_for(stations, data, stations_path, stations_sha256)
    source = {'path': Path(stations_path).as_posix(), 'sha256': stations_sha256,
              'stationCount': len(stations), 'source': data.get('source'), 'selection': data.get('selection'),
              'stationsSha256': static_sha, 'stationsVersion': version}
    return stations, data, source, raw


def export_static(case, output, stations_path=None, stations_sha256=None):
    """Write the app's static station file (public/data/local-roads/<case>-stations.json)."""
    stations, _, source, raw = local_stations_for(case, stations_path, stations_sha256)
    Path(output).write_bytes(raw)
    return {'path': Path(output).name, 'sha256': source['stationsSha256'], 'bytes': len(raw),
            'version': source['stationsVersion'], 'stationCount': len(stations)}


def export_local(case, directory, output, stations_path=None, stations_sha256=None):
    """Write local-road-forecast.json from any compact package (live or frozen), without a solver."""
    directory = Path(directory)
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest.get('case', case) != case:
        raise ValueError('Not the requested case')
    stations, _, source, _ = local_stations_for(case, stations_path, stations_sha256)
    geometry = NativeGeometry.load(directory / manifest['geometry']['path'], manifest['geometry']['sha256'])
    forecast = LocalRoadForecast(case, geometry, stations, source)
    for frame in manifest['frames']:
        header, cols = read_columns(directory / frame['path'], 'floodplain-columns-v1', frame['sha256'])
        metadata = header['metadata']
        if (metadata.get('runId') != manifest['runId'] or metadata.get('time') != frame['time']
                or metadata.get('geometrySha256') != manifest['geometry']['sha256']):
            raise ValueError('Compact frame provenance mismatch')
        forecast.add_frame(frame['time'], cols['nativeVolumeM3'], cols['waterSurfaceM'])
    return forecast.write(output, manifest)


if __name__ == '__main__':
    import sys
    if sys.argv[1:2] == ['local']:
        # export_road_forecast.py local CASE COMPACT_DIR OUTPUT [STATIONS_PATH STATIONS_SHA256]
        print(json.dumps(export_local(*sys.argv[2:])))
    elif sys.argv[1:2] == ['static']:
        # export_road_forecast.py static CASE OUTPUT [STATIONS_PATH STATIONS_SHA256]
        print(json.dumps(export_static(*sys.argv[2:])))
    else:
        print(json.dumps(export_compact(*sys.argv[1:])))
