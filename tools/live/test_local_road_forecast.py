"""Offline local-road forecast tests: python -m unittest discover -s tools/live -p 'test_*.py'."""
import gzip
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from build_local_road_stations import decode_tile
from export_road_forecast import (CASE_ROUTES, LOCAL_KIND, LocalRoadForecast, NativeGeometry, WET_M,
                                  digest, export_local, load_local_stations, load_roads)
from test_export_road_forecast import geometry_columns, packed
import validate_highres_run_request as request
import verify_all_route_package as verifier

CASE = 'brawley-avra-west'
T = ['2026-11-01T12:00:00Z', '2026-11-01T12:30:00Z', '2026-11-01T13:00:00Z']
CONTRACT_TOP = {'schemaVersion', 'kind', 'case', 'modelVersion', 'runId', 'issuedAt', 'forecastStart',
                'forecastEnd', 'datum', 'roadHeights', 'stations', 'summary'}
CONTRACT_STATION = {'id', 'road', 'lon', 'lat', 'roadZ', 'cellSizeM', 'maxWse', 'maxOver',
                    'firstOverTime', 'state', 'flags'}


def st(sid, lon=.5, lat=.5, z=10., flags=0, road='West Snyder Hill Road'):
    return {'id': sid, 'road': road, 'lon': lon, 'lat': lat, 'roadM': z, 'flags': flags}


def local(stations):
    return LocalRoadForecast(CASE, NativeGeometry(geometry_columns()), stations, {'sha256': 'stations-hash'})


def manifest(times, status='complete'):
    return {'runId': 'brawley-test', 'case': CASE, 'modelVersion': 'all-routes-brawley-avra-west-v1',
            'executionMode': 'live_current_forcing', 'status': status,
            'solverCompletion': {'status': 'complete' if status == 'complete' else 'not_finished'},
            'issuedAt': '2026-11-01T14:05:00Z', 'sourceIssues': {'HRRR': '2026-11-01T13:00:00Z'},
            'geometry': {'sha256': 'geometry-hash'}, 'caseArchiveSha256': 'archive-hash',
            'frames': [{'time': t} for t in times]}


def by_id(rows):
    return {r['id']: r for r in rows}


class LocalStateTests(unittest.TestCase):
    def test_states_and_water_surface_against_road_height(self):
        # face order: 0 = lon 1..2 (100 m2, 10 m), 1 = lon 0..1 (25 m2, 5 m), 2 = lon 2..3 (100 m2, 10 m)
        f = local([st('over', .5, z=10.), st('below', 1.5, z=30.), st('dry', 2.5, z=1.),
                   st('noz', .5, z=None, flags=4), st('out', 3.5), st('edge', 1., z=0.)])
        frames = [(np.array([0., 0., 0.]), np.array([0., 0., 0.])),                 # all dry
                  (np.array([200., 12.5, 0.]), np.array([22., 10.4, np.nan])),       # face1 depth .5: zs 10.4 over road 10
                  (np.array([300., 25., 0.]), np.array([23., 11.2, np.nan]))]        # deeper
        for t, (v, z) in zip(T, frames):
            f.add_frame(t, v, z)
        rows, summary = f.station_rows()
        r = by_id(rows)
        self.assertEqual(r['over']['state'], 'over')
        self.assertAlmostEqual(r['over']['maxWse'], 11.2, places=5)
        self.assertAlmostEqual(r['over']['maxOver'], 1.2, places=5)  # zs - road, not the 1 m cell depth
        self.assertEqual(r['over']['firstOverTime'], T[1])
        self.assertEqual(r['over']['cellSizeM'], 5.)
        self.assertEqual(r['below']['state'], 'below')
        self.assertAlmostEqual(r['below']['maxOver'], -7., places=5)
        self.assertIsNone(r['below']['firstOverTime'])
        self.assertEqual(r['dry']['state'], 'dry')
        self.assertIsNone(r['dry']['maxWse'])
        self.assertIsNone(r['dry']['maxOver'])
        self.assertEqual(r['noz']['state'], 'no-road-height')
        self.assertIsNone(r['noz']['roadZ'])
        self.assertIsNone(r['noz']['maxOver'])
        self.assertEqual(r['noz']['flags'], 4)
        self.assertEqual(r['out']['state'], 'no-cell')
        self.assertIsNone(r['out']['cellSizeM'])
        self.assertEqual(r['edge']['state'], 'no-cell')  # shared boundary is ambiguous, never picked
        self.assertEqual(summary, {'stations': 6, 'over': 1, 'below': 1, 'dry': 1, 'noRoadHeight': 1,
                                   'noCell': 2, 'unknown': 0})

    def test_missing_readings_are_never_dry(self):
        for volume, surface in [(np.nan, 0.), (1., np.nan), (-1., 0.), (1., -99999.)]:
            f = local([st('a', .5, z=10.)])
            f.add_frame(T[0], np.zeros(3), np.zeros(3))
            f.add_frame(T[1], np.array([0., volume, 0.]), np.array([0., surface, 0.]))
            row = f.station_rows()[0][0]
            self.assertEqual(row['state'], 'unknown', (volume, surface))
            self.assertEqual(row['unknownFrames'], 1)
            self.assertIsNone(row['maxWse'])

    def test_no_frames_is_unknown_not_dry(self):
        self.assertEqual(local([st('a')]).station_rows()[0][0]['state'], 'unknown')

    def test_wet_threshold_and_dry_cell_with_missing_surface(self):
        f = local([st('a', .5, z=0.)])
        f.add_frame(T[0], np.array([0., (WET_M - 1e-6) * 25, 0.]), np.array([0., np.nan, 0.]))  # known dry
        self.assertEqual(f.station_rows()[0][0]['state'], 'dry')
        f.add_frame(T[1], np.array([0., WET_M * 25, 0.]), np.array([0., 5., 0.]))
        row = f.station_rows()[0][0]
        self.assertEqual(row['state'], 'over')
        self.assertEqual(row['maxOver'], 5.)

    def test_water_exactly_at_road_is_below_and_deck_flags_pass_through(self):
        f = local([st('deck', .5, z=10.5, flags=1)])
        f.add_frame(T[0], np.array([0., 12.5, 0.]), np.array([0., 10.5, 0.]))
        row = f.station_rows()[0][0]
        self.assertEqual((row['state'], row['maxOver'], row['flags']), ('below', 0., 1))

    def test_frame_order_and_length_rejected(self):
        f = local([st('a')])
        with self.assertRaises(ValueError):
            f.add_frame(T[0], np.zeros(2), np.zeros(3))
        f.add_frame(T[0], np.zeros(3), np.zeros(3))
        with self.assertRaises(ValueError):
            f.add_frame(T[0], np.zeros(3), np.zeros(3))


class ContractTests(unittest.TestCase):
    def test_written_file_follows_the_shared_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'local-road-forecast.json'
            f = local([st('over', .5), st('noz', .5, z=None, flags=4)])
            for t in T:
                f.add_frame(t, np.array([0., 25., 0.]), np.array([0., 11., 0.]))
            descriptor = f.write(path, manifest(T))
            data = json.loads(path.read_text())
            self.assertTrue(CONTRACT_TOP <= set(data))
            self.assertEqual((data['schemaVersion'], data['kind'], data['case'], data['modelVersion']),
                             (1, LOCAL_KIND, CASE, 'all-routes-brawley-avra-west-v1'))
            self.assertEqual((data['forecastStart'], data['forecastEnd'], data['issuedAt']), (T[0], T[-1], '2026-11-01T14:05:00Z'))
            self.assertEqual((data['datum'], data['roadHeights']), ('NAVD88 metres', 'floodplain-road-heights-v1'))
            for row in data['stations']:
                self.assertTrue(CONTRACT_STATION <= set(row))
            self.assertTrue({'stations', 'over', 'below', 'dry', 'noRoadHeight', 'noCell'} <= set(data['summary']))
            self.assertEqual(data['summary']['over'], 1)
            self.assertEqual(data['status'], 'complete')
            self.assertEqual(descriptor['sha256'], digest(path.read_bytes()))
            self.assertNotIn('NaN', path.read_text())
            f.write(path, manifest(T, 'partial'))
            self.assertEqual(json.loads(path.read_text())['status'], 'partial')
            with self.assertRaises(ValueError):
                f.write(path, manifest(T[:2]))

    def test_frozen_package_uses_its_hrrr_issue(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'x.json'
            f = local([st('a')]); f.add_frame(T[0], np.zeros(3), np.zeros(3))
            m = manifest(T[:1]); del m['issuedAt']
            f.write(path, m)
            self.assertEqual(json.loads(path.read_text())['issuedAt'], '2026-11-01T13:00:00Z')


def station_file(path, ids, z=(10.,), flags=(0,), case=CASE):
    data = {'schemaVersion': 1, 'kind': 'floodplain-local-road-stations', 'case': case,
            'roadHeights': 'floodplain-road-heights-v1', 'source': {'commit': 'abc'}, 'selection': {'rule': 'test'},
            'columns': {'id': list(ids), 'road': ['Rd'] * len(ids), 'lon': [.5] * len(ids), 'lat': [.5] * len(ids),
                        'roadZ': list(z), 'flags': list(flags)}}
    encoded = gzip.compress(json.dumps(data).encode(), mtime=0)
    path.write_bytes(encoded)
    return digest(encoded)


class StationFileTests(unittest.TestCase):
    def test_pinned_station_file_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 's.json.gz'
            sha = station_file(path, ['a', 'b'], z=(10., 12.), flags=(0, 4))
            stations, _ = load_local_stations(path, sha)
            self.assertEqual([s['roadM'] for s in stations], [10., None])  # noTerrain never keeps a height
            with self.assertRaises(ValueError):
                load_local_stations(path, '0' * 64)
            sha = station_file(path, ['a', 'a'], z=(1., 2.), flags=(0, 0))
            with self.assertRaises(ValueError):
                load_local_stations(path, sha)

    def test_export_local_from_compact_package_and_verify(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cols = geometry_columns()
            geo_hash = packed(root / 'geometry.bin.gz', 'floodplain-columns-v1',
                              {k: ('I' if k in ('ringOffsets', 'ringIndices') else 'd', v) for k, v in cols.items()},
                              metadata={'coordinates': 'latitude,longitude', 'geometryKind': 'native_quadtree_faces'})
            frames = []
            for i, t in enumerate(T):
                frame_hash = packed(root / f'frame-{i}.bin.gz', 'floodplain-columns-v1',
                                    {'nativeVolumeM3': ('f', [0., 25. * i, 0.]), 'waterSurfaceM': ('f', [0., 9. + i, 0.])},
                                    metadata={'runId': 'brawley-test', 'time': t, 'geometrySha256': geo_hash})
                frames.append({'time': t, 'path': f'frame-{i}.bin.gz', 'sha256': frame_hash})
            m = manifest(T) | {'geometry': {'path': 'geometry.bin.gz', 'sha256': geo_hash}, 'frames': frames}
            (root / 'manifest.json').write_text(json.dumps(m))
            spath = root / 'stations.json.gz'
            ssha = station_file(spath, ['area_m1113_322:4:120'], z=(10.5,))
            out = root / 'local-road-forecast.json'
            export_local(CASE, root, out, spath, ssha)
            data = json.loads(out.read_text())
            row = data['stations'][0]
            self.assertEqual((row['state'], row['maxWse'], row['maxOver'], row['firstOverTime']), ('over', 11., .5, T[2]))
            expected = [verifier.parse(t) for t in T]
            entry = {'localRoads': {'sha256': ssha}}
            verifier.verify_local(out, CASE, m, entry, expected)
            with self.assertRaises(ValueError):
                verifier.verify_local(out, CASE, m, {'localRoads': {'sha256': '0' * 64}}, expected)
            with self.assertRaises(ValueError):
                verifier.verify_local(out, CASE, m | {'runId': 'other'}, entry, expected)
            data['summary']['over'] = 0
            out.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                verifier.verify_local(out, CASE, m, entry, expected)
            with self.assertRaises(ValueError):
                export_local('gates', root, out, spath, ssha)
            other = root / 'other.json.gz'
            osha = station_file(other, ['x'], case='gates')
            with self.assertRaises(ValueError):
                export_local(CASE, root, out, other, osha)


def encode_tile(lines):
    """Minimal floodplain-road-heights-v1 encoder (per-line deltas), as tools/road_heights/encoding.py."""
    starts = np.r_[0, np.cumsum([len(l['lonE6']) for l in lines])].astype('<u4')
    def delta(values):
        out = []
        for l in lines:
            v = np.asarray(l[values], dtype='i8')
            out.append(np.diff(v, prepend=0))
        return np.concatenate(out).astype('<i4')
    columns = [('lineStart', '<u4', starts), ('dLonE6', '<i4', delta('lonE6')), ('dLatE6', '<i4', delta('latE6')),
               ('dZCm', '<i4', delta('zCm')), ('dStationDm', '<i4', delta('sDm')),
               ('lateralDm', 'u1', np.full(int(starts[-1]), 255)), ('flags', 'u1', np.concatenate([l['flags'] for l in lines])),
               ('source', 'i1', np.zeros(int(starts[-1])))]
    table, blobs, offset = {}, [], 0
    for name, dtype, values in columns:
        blob = np.asarray(values).astype(dtype).tobytes()
        table[name] = {'type': dtype.lstrip('<'), 'count': len(values), 'offset': offset}
        offset += len(blob); blobs.append(blob)
    head = json.dumps({'format': 'floodplain-road-heights-v1', 'columns': table, 'metadata': {},
                       'lines': {'name': [l['name'] for l in lines], 'kind': ['residential'] * len(lines),
                                 'routeId': [None] * len(lines)}}).encode()
    return gzip.compress(len(head).to_bytes(4, 'little') + head + b''.join(blobs), mtime=0)


class BuilderAndRegistrationTests(unittest.TestCase):
    def test_tile_decoding_per_line_deltas_and_no_terrain(self):
        raw = encode_tile([
            {'name': 'A', 'lonE6': [-111300000, -111299900], 'latE6': [32300000, 32300050], 'zCm': [70012, 70020],
             'sDm': [0, 100], 'flags': np.array([0, 4], 'u1')},
            {'name': None, 'lonE6': [-111250000], 'latE6': [32250000], 'zCm': [69000], 'sDm': [0],
             'flags': np.array([1], 'u1')}])
        _, lines = decode_tile(raw)
        self.assertEqual(list(lines[0]['lon']), [-111.3, -111.2999])
        self.assertEqual(list(lines[0]['stationDm']), [0, 100])
        self.assertEqual(lines[0]['z'][0], 700.12)
        self.assertTrue(np.isnan(lines[0]['z'][1]))
        self.assertEqual((lines[1]['lon'][0], lines[1]['z'][0], int(lines[1]['flags'][0])), (-111.25, 690., 1))

    def test_new_case_owns_no_route(self):
        self.assertEqual(CASE_ROUTES[CASE], ())
        routes, _, _ = load_roads(CASE)
        self.assertEqual(routes, {})

    def test_request_validator_knows_new_case_but_requires_registration(self):
        self.assertIn(CASE, request.KNOWN_CASES)
        self.assertTrue(set(request.CASES) <= set(request.KNOWN_CASES))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'cases.json'
            path.write_text(json.dumps({'cases': [{'case': CASE}, {'case': 'northern'}]}))
            self.assertEqual(request.registered_cases(path), ['northern', CASE])
            path.write_text(json.dumps({'cases': [{'case': 'unknown'}]}))
            with self.assertRaises(ValueError):
                request.registered_cases(path)


if __name__ == '__main__':
    unittest.main()
