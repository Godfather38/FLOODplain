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
            native_faces = faces[candidates]
            # Native volume, not surface-bed or a display interpolation, defines dry.
            depth = np.asarray(volume[native_faces], dtype=float) / self.geometry.area[native_faces]
            z = np.asarray(surface[native_faces], dtype=float)
            dry = np.isfinite(depth) & (depth >= 0) & (depth < WET_M)
            valid = dry | (np.isfinite(depth) & (depth >= WET_M) & np.isfinite(z) & (z != -99999.0))
            road_depth = np.zeros(len(candidates), dtype=float)
            wet = valid & ~dry
            road_depth[wet] = np.minimum(np.maximum(z[wet] - heights[candidates[wet]], 0), depth[wet])
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
            'quantity': {'units': 'm', 'definition': 'max(0, min(waterSurface - roadOrDeckHeight, nativeVolume / nativePolygonArea)); finite native depth below dryThresholdM is zero'},
            'provenance': {
                'geometrySha256': manifest['geometry']['sha256'],
                'caseArchiveSha256': manifest['caseArchiveSha256'],
                'roadStations': self.source, 'roadHeightMetadata': self.road_metadata,
                'mapping': 'Exact native polygon containment in compact frame face order; shared-boundary ambiguity and outside stations have no value',
                'solverCompletion': manifest['solverCompletion'], 'flowNotes': manifest.get('flowNotes', []),
            },
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


if __name__ == '__main__':
    import sys
    print(json.dumps(export_compact(*sys.argv[1:])))
