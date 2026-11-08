"""Offline local-road forecast tests: python -m unittest discover -s tools/live -p 'test_*.py'."""
import gzip
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from build_local_road_stations import decode_tile
from export_road_forecast import (CASE_ROUTES, LIVE_STATES, LOCAL_KIND, LocalRoadForecast, NativeGeometry,
                                  decode_local_static, digest, export_local, export_static, inflow_summary,
                                  load_local_stations, load_roads, local_static_bytes)
from export_road_forecast import WET_M
from test_export_road_forecast import geometry_columns, packed
import validate_highres_run_request as request
import verify_all_route_package as verifier

CASE = 'brawley-avra-west'
T = ['2026-11-01T12:00:00Z', '2026-11-01T12:30:00Z', '2026-11-01T13:00:00Z']
CONTRACT_TOP = {'schemaVersion', 'kind', 'case', 'modelVersion', 'runId', 'issuedAt', 'forecastStart',
                'forecastEnd', 'status', 'datum', 'roadHeights', 'stationsSha256', 'stationsVersion', 'stationCount',
                'inflowSource', 'summary', 'stateCodes', 'listed'}
CONTRACT_LISTED = {'index', 'state', 'maxWseCm', 'maxOverCm', 'firstOverMin', 'cellSizeM', 'unknownFrames'}
SOURCE = {'sha256': 'stations-hash', 'stationsSha256': 'static-hash', 'stationsVersion': 'test-local-v1'}


def st(sid, lon=.5, lat=.5, z=10., flags=0, road='West Snyder Hill Road'):
    return {'id': sid, 'road': road, 'lon': lon, 'lat': lat, 'roadM': z, 'flags': flags}


def local(stations):
    return LocalRoadForecast(CASE, NativeGeometry(geometry_columns()), stations, dict(SOURCE))


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


def listed_by_index(data):
    cols = data['listed']
    return {i: {k: cols[k][n] for k in cols} | {'stateName': data['stateCodes'][cols['state'][n]]}
            for n, i in enumerate(cols['index'])}


class ContractTests(unittest.TestCase):
    def write(self, f, m):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'local-road-forecast.json'
            descriptor = f.write(path, m)
            raw = path.read_bytes()
            self.assertEqual(descriptor['sha256'], digest(raw))
            self.assertNotIn(b'NaN', raw)
            return json.loads(raw), descriptor

    def test_written_file_follows_contract_v2_and_lists_only_non_dry(self):
        # 0 over, 1 below, 2 dry, 3 no road height, 4 no cell, 5 unknown (face 2 never wet, missing zs while wet)
        f = local([st('a:0', .5, z=10.), st('a:100', 1.5, z=30.), st('a:200', 2.5, z=1.),
                   st('b:0', .5, z=None, flags=4), st('b:100', 3.5), st('c:0', 2.5, z=40.)])
        f.add_frame(T[0], np.array([0., 0., 0.]), np.array([0., 0., 0.]))
        f.add_frame(T[1], np.array([200., 12.5, 0.]), np.array([22., 10.4, 0.]))
        f.add_frame(T[2], np.array([200., 25., 0.]), np.array([23., 11.2, 0.]))
        data, descriptor = self.write(f, manifest(T))
        self.assertTrue(CONTRACT_TOP <= set(data))
        self.assertNotIn('stations', data)
        self.assertEqual((data['schemaVersion'], data['kind'], data['case'], data['modelVersion'], data['status']),
                         (2, LOCAL_KIND, CASE, 'all-routes-brawley-avra-west-v1', 'ok'))
        self.assertEqual((data['forecastStart'], data['forecastEnd'], data['issuedAt']), (T[0], T[-1], '2026-11-01T14:05:00Z'))
        self.assertEqual((data['stationsSha256'], data['stationsVersion'], data['stationCount']), ('static-hash', 'test-local-v1', 6))
        self.assertEqual(data['stateCodes'], list(LIVE_STATES))
        self.assertEqual(set(data['listed']), CONTRACT_LISTED)
        r = listed_by_index(data)
        self.assertEqual(sorted(r), [0, 1, 4])  # dry (2, 5) and no-road-height (3) are not listed
        self.assertEqual((r[0]['stateName'], r[0]['maxWseCm'], r[0]['maxOverCm'], r[0]['firstOverMin'], r[0]['cellSizeM']),
                         ('over', 1120, 120, 30, 5.))
        self.assertEqual((r[1]['stateName'], r[1]['maxWseCm'], r[1]['maxOverCm'], r[1]['firstOverMin']),
                         ('below', 2300, -700, None))
        self.assertEqual((r[4]['stateName'], r[4]['maxWseCm'], r[4]['cellSizeM'], r[4]['unknownFrames']),
                         ('no-cell', None, None, None))
        self.assertEqual(data['summary'], {'stations': 6, 'over': 1, 'below': 1, 'dry': 2, 'noRoadHeight': 1,
                                           'noCell': 1, 'unknown': 0})
        self.assertEqual(descriptor['stationsSha256'], 'static-hash')
        partial, _ = self.write(f, manifest(T, 'partial'))
        self.assertEqual(partial['status'], 'partial')
        with self.assertRaises(ValueError):
            f.write(Path(tempfile.gettempdir()) / 'never.json', manifest(T[:2]))

    def test_unknown_station_is_listed_never_dry(self):
        f = local([st('a:0', .5, z=10.)])
        f.add_frame(T[0], np.zeros(3), np.zeros(3))
        f.add_frame(T[1], np.array([0., np.nan, 0.]), np.zeros(3))
        data, _ = self.write(f, manifest(T[:2]))
        r = listed_by_index(data)
        self.assertEqual((r[0]['stateName'], r[0]['maxWseCm'], r[0]['maxOverCm'], r[0]['cellSizeM'], r[0]['unknownFrames']),
                         ('unknown', None, None, 5., 1))
        self.assertEqual((data['summary']['unknown'], data['summary']['dry']), (1, 0))

    def test_over_is_never_rounded_to_zero_and_below_never_rounds_above(self):
        # zs 0.2 mm above the road: still over, maxOverCm 1; zs 0.2 mm below: below, maxOverCm 0.
        f = local([st('a:0', .5, z=10.25), st('a:100', 1.5, z=12.31)])
        f.add_frame(T[0], np.array([200., 25., 0.]), np.array([12.3098, 10.2502, 0.]))
        data, _ = self.write(f, manifest(T[:1]))
        r = listed_by_index(data)
        self.assertEqual((r[0]['stateName'], r[0]['maxWseCm'], r[0]['maxOverCm'], r[0]['firstOverMin']), ('over', 1026, 1, 0))
        self.assertEqual((r[1]['stateName'], r[1]['maxWseCm'], r[1]['maxOverCm']), ('below', 1231, 0))
        for i in r:
            self.assertEqual(r[i]['maxOverCm'], r[i]['maxWseCm'] - round(f.stations[i]['roadM'] * 100))

    def test_all_dry_run_lists_nothing(self):
        f = local([st('a:0', .5), st('a:100', 2.5), st('b:0', .5, z=None, flags=4)])
        for t in T:
            f.add_frame(t, np.zeros(3), np.zeros(3))
        data, _ = self.write(f, manifest(T))
        self.assertEqual(data['listed']['index'], [])
        self.assertEqual((data['summary']['dry'], data['summary']['noRoadHeight']), (2, 1))

    def test_static_file_is_required(self):
        f = LocalRoadForecast(CASE, NativeGeometry(geometry_columns()), [st('a:0')], {'sha256': 'x'})
        f.add_frame(T[0], np.zeros(3), np.zeros(3))
        with self.assertRaises(ValueError):
            f.write(Path(tempfile.gettempdir()) / 'never.json', manifest(T[:1]))

    def test_frozen_package_uses_its_hrrr_issue(self):
        f = local([st('a:0')]); f.add_frame(T[0], np.zeros(3), np.zeros(3))
        m = manifest(T[:1]); del m['issuedAt']
        data, _ = self.write(f, m)
        self.assertEqual(data['issuedAt'], '2026-11-01T13:00:00Z')
        self.assertEqual(data['inflowSource']['summary'], 'not recorded in this package')

    def test_inflow_summary(self):
        m = {'inflowSource': [{'reachId': '15876941', 'source': 'usgs+nwm', 'nwmProvider': 'NWPS', 'usgsSite': '09487000',
                               'usgsStatus': 'ok', 'provisional': True, 'note': 'long text', 'usgsHours': 40}],
             'flowNotes': ['n'], 'sourceIssues': {'NWM': 'desc'}}
        self.assertEqual(inflow_summary(m), {'summary': 'usgs+nwm', 'description': 'desc', 'notes': ['n'],
                                             'inlets': [{'reachId': '15876941', 'source': 'usgs+nwm', 'nwmProvider': 'NWPS',
                                                         'usgsSite': '09487000', 'usgsStatus': 'ok', 'provisional': True}]})
        old = inflow_summary({'flowSources': [{'provider': 'NOAA NODD', 'reachId': 1}]})
        self.assertEqual((old['summary'], old['inlets']), ('nwm', [{'reachId': '1', 'source': 'nwm', 'nwmProvider': 'NOAA NODD'}]))


class StaticFileTests(unittest.TestCase):
    def test_static_file_round_trips_and_is_deterministic(self):
        stations = [{'id': 'area_m1113_322:4:0', 'road': 'West Snyder Hill Road', 'kind': 'residential',
                     'lon': -111.298976, 'lat': 32.18953, 'roadM': 805.09, 'flags': 0},
                    {'id': 'area_m1113_322:4:100', 'road': 'West Snyder Hill Road', 'kind': 'residential',
                     'lon': -111.298915, 'lat': 32.189604, 'roadM': None, 'flags': 4},
                    {'id': 'area_m1113_322:4:200', 'road': 'West Snyder Hill Road', 'kind': 'residential',
                     'lon': -111.298854, 'lat': 32.189678, 'roadM': 804.9, 'flags': 1},
                    {'id': 'area_m1113_323:0:0', 'road': 'North Sandario Road', 'kind': 'secondary',
                     'lon': -111.2, 'lat': 32.3, 'roadM': 700.12, 'flags': 0}]
        data = {'case': CASE, 'roadHeights': 'floodplain-road-heights-v1', 'source': {'commit': 'abc'}, 'selection': {'rule': 'r'}}
        raw = local_static_bytes(stations, data, 'tools/live/road-stations/x-local-v1.json.gz', 'f' * 64)
        self.assertEqual(raw, local_static_bytes(stations, data, 'elsewhere/x-local-v1.json.gz', 'f' * 64))  # cwd-independent
        self.assertTrue(raw.endswith(b'\n') and b'\r' not in raw)
        out, meta = decode_local_static(raw)
        self.assertEqual((meta['version'], meta['stationCount'], meta['source']['sha256']), ('x-local-v1', 4, 'f' * 64))
        self.assertEqual([o['id'] for o in out], [s['id'] for s in stations])
        self.assertEqual([o['road'] for o in out], [s['road'] for s in stations])
        self.assertEqual([o['lonE6'] for o in out], [round(s['lon'] * 1e6) for s in stations])
        self.assertEqual([o['latE6'] for o in out], [round(s['lat'] * 1e6) for s in stations])
        self.assertEqual([o['roadZCm'] for o in out], [80509, None, 80490, 70012])
        self.assertEqual([o['flags'] for o in out], [0, 4, 1, 0])
        with self.assertRaises(ValueError):  # ids must be <line>:<stationDm>
            local_static_bytes([dict(stations[0], id='nodm')], data, 'x.json.gz', 'f' * 64)
        with self.assertRaises(ValueError):  # a line must be one contiguous run
            local_static_bytes([stations[0], stations[3], stations[1]], data, 'x.json.gz', 'f' * 64)

    def test_committed_station_file_static_size(self):
        # The app ships the static file made from the newest list (v2 when built, else v1).
        root = Path(__file__).resolve().parent / 'road-stations'
        found = [root / n for n in ('brawley-avra-west-local-v2.json.gz', 'brawley-avra-west-local.json.gz')
                 if (root / n).exists()]
        if not found:
            self.skipTest('station file not built')
        source = found[0]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 's.json'
            d = export_static(CASE, out, source, digest(source.read_bytes()))
            self.assertLess(d['bytes'], 1_500_000)
            self.assertEqual(d['sha256'], digest(out.read_bytes()))
            decoded, _ = decode_local_static(out.read_bytes())
            stations, _ = load_local_stations(source, digest(source.read_bytes()))
            self.assertEqual([o['id'] for o in decoded], [s['id'] for s in stations])
            self.assertEqual(sum(o['roadZCm'] is None for o in decoded), sum(s['roadM'] is None for s in stations))


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
            static = root / 'static.json'
            sd = export_static(CASE, static, spath, ssha)
            self.assertEqual(data['stationsSha256'], sd['sha256'])
            self.assertEqual(data['stationsVersion'], 'stations')
            row = listed_by_index(data)[0]
            self.assertEqual((row['stateName'], row['maxWseCm'], row['maxOverCm'], row['firstOverMin']), ('over', 1100, 50, 60))
            expected = [verifier.parse(t) for t in T]
            entry = {'localRoads': {'sha256': ssha, 'path': str(spath)}}
            verifier.verify_local(out, CASE, m, entry, expected)
            with self.assertRaises(ValueError):
                verifier.verify_local(out, CASE, m, {'localRoads': {'sha256': '0' * 64, 'path': str(spath)}}, expected)
            with self.assertRaises(ValueError):
                verifier.verify_local(out, CASE, m | {'runId': 'other'}, entry, expected)
            for change in (lambda d: d['summary'].update(over=0), lambda d: d.update(stationsSha256='0' * 64),
                           lambda d: d['listed']['maxOverCm'].__setitem__(0, 0), lambda d: d.update(status='partial'),
                           lambda d: d['listed']['index'].__setitem__(0, 5)):
                bad = json.loads(json.dumps(data)); change(bad)
                out.write_text(json.dumps(bad))
                with self.assertRaises(ValueError):
                    verifier.verify_local(out, CASE, m, entry, expected)
            with self.assertRaises(ValueError):
                export_local('gates', root, out, spath, ssha)
            other = root / 'other.json.gz'
            osha = station_file(other, ['x'], case='gates')
            with self.assertRaises(ValueError):
                export_local(CASE, root, out, other, osha)


FIXTURES = Path(__file__).resolve().parent / 'fixtures' / 'local-roads'
# Pinned in both repos (the app's test/local-road-forecast.test.js pins the same values): a change
# to one copy fails here until the other copy and both pins are updated together.
SHARED_SHA256 = {
    'local-road-contract-cases.json': '7a09c726f1f5b9335a0b477a71008e85d4de93391236b50f0831c30ffad5d9ef',
    'local-road-forecast-sample.json': '5d8063712eba660ff2100c77d26097b11588a1ae47ecb595c2afa6f3982268e5',
    'local-road-stations-sample.json': '0df117b6978b7cced69d7f1f3b053cd197e0406170df6c7cb4a8758799f17d53',
}
COLUMNS = ('index', 'state', 'maxWseCm', 'maxOverCm', 'firstOverMin', 'cellSizeM', 'unknownFrames')


def apply_ops(f, ops):
    """Same op set as the app test's applyOps."""
    def at(path):
        o = f
        for p in path[:-1]:
            o = o[p]
        return o, path[-1]
    for op in ops:
        kind = op['op']
        if kind == 'set':
            o, k = at(op['path']); o[k] = op['value']
        elif kind == 'add':
            o, k = at(op['path']); o[k] += op['value']
        elif kind == 'delete':
            o, k = at(op['path']); del o[k]
        elif kind == 'pop':
            o, k = at(op['path']); o[k].pop()
        elif kind == 'dropEntry':
            for c in COLUMNS:
                del f['listed'][c][op['at']]
        elif kind == 'swapEntries':
            a, b = op['at']
            for c in COLUMNS:
                col = f['listed'][c]; col[a], col[b] = col[b], col[a]
        elif kind == 'insertEntry':
            for c in COLUMNS:
                f['listed'][c].insert(op['at'], op['entry'][c])
        else:
            raise AssertionError('unknown op ' + kind)
    return f


class SharedContractCaseTests(unittest.TestCase):
    """The publish verifier against the app's own fixture cases (same files in the app's test/fixtures)."""

    def test_shared_fixture_copies_are_pinned(self):
        for name, sha in SHARED_SHA256.items():
            self.assertEqual(digest((FIXTURES / name).read_bytes()), sha, name)

    def test_verifier_accepts_exactly_what_the_app_shows_in_full(self):
        static = (FIXTURES / 'local-road-stations-sample.json').read_bytes()
        sample = (FIXTURES / 'local-road-forecast-sample.json').read_text()
        cases = json.loads((FIXTURES / 'local-road-contract-cases.json').read_text())['cases']
        self.assertGreaterEqual(len(cases), 40)
        self.assertEqual({c['expect'] for c in cases}, {'ok', 'unreadable', 'reject'})
        for case in cases:
            local = apply_ops(json.loads(sample), case['ops'])
            if case['expect'] == 'ok':
                n, listed, counts = verifier.verify_local_contract(local, static)
                self.assertEqual((n, counts['dry']), (20, 3), case['name'])
            else:  # the app drops an unreadable station (and says so); publication rejects the file
                with self.assertRaises(ValueError, msg=case['name']):
                    verifier.verify_local_contract(local, static)


class MissingFrameStateTests(unittest.TestCase):
    """A frame without a valid reading at a station's cell never leaves a firm 'below'."""

    def run_frames(self, last_surface):
        f = local([st('a:0', .5, z=10.), st('a:100', .5, z=30.)])  # same cell (face 1): over and below
        f.add_frame(T[0], np.array([0., 25., 0.]), np.array([0., 10.6, 0.]))
        f.add_frame(T[1], np.array([0., 25., 0.]), np.array([0., last_surface, 0.]))
        return f

    def test_below_with_a_missing_frame_is_unknown_and_over_keeps_its_missing_count(self):
        f = self.run_frames(np.nan)
        r = by_id(f.station_rows()[0])
        self.assertEqual((r['a:0']['state'], r['a:0']['unknownFrames']), ('over', 1))
        self.assertEqual((r['a:100']['state'], r['a:100']['unknownFrames']), ('unknown', 1))
        listed, summary = f.listed()
        self.assertEqual(listed['state'], [LIVE_STATES.index('over'), LIVE_STATES.index('unknown')])
        self.assertEqual(listed['unknownFrames'], [1, 1])
        self.assertEqual(listed['maxWseCm'], [1060, None])
        self.assertEqual(listed['maxOverCm'], [60, None])
        self.assertEqual((summary['over'], summary['below'], summary['unknown']), (1, 0, 1))
        complete = by_id(self.run_frames(10.7).station_rows()[0])
        self.assertEqual((complete['a:100']['state'], complete['a:100']['unknownFrames']), ('below', 0))

    def test_written_file_passes_the_shared_contract_check(self):
        stations = [dict(st('area_m1113_322:4:0', .5, z=10.), kind='residential'),
                    dict(st('area_m1113_322:4:100', .5, z=30.), kind='residential'),
                    dict(st('area_m1113_322:4:200', 2.5, z=None, flags=4), kind='residential'),
                    dict(st('area_m1113_322:4:300', 3.5, z=5.), kind='residential')]
        data = {'case': CASE, 'roadHeights': 'floodplain-road-heights-v1', 'source': {'commit': 'abc'},
                'selection': {'rule': 'r'}}
        static = local_static_bytes(stations, data, 'x-local-v1.json.gz', 'f' * 64)
        f = LocalRoadForecast(CASE, NativeGeometry(geometry_columns()), stations,
                              {'sha256': 'f' * 64, 'stationsSha256': digest(static), 'stationsVersion': 'x-local-v1'})
        f.add_frame(T[0], np.array([0., 25., 0.]), np.array([0., 10.6, 0.]))
        f.add_frame(T[1], np.array([0., 25., 0.]), np.array([0., np.nan, 0.]))
        f.add_frame(T[2], np.array([0., 25., 0.]), np.array([0., 10.8, 0.]))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'l.json'
            f.write(path, manifest(T))
            out = json.loads(path.read_bytes())
        n, listed, counts = verifier.verify_local_contract(out, static)
        self.assertEqual((n, listed), (4, 3))
        self.assertEqual(counts, {'over': 1, 'below': 0, 'dry': 0, 'noRoadHeight': 1, 'noCell': 1, 'unknown': 1})
        bad = json.loads(json.dumps(out))
        bad['listed']['state'][1] = LIVE_STATES.index('below')  # what the old exporter wrote
        bad['listed']['maxWseCm'][1], bad['listed']['maxOverCm'][1] = 1080, -1920
        bad['summary'].update(below=1, unknown=0)
        with self.assertRaisesRegex(ValueError, 'unknownFrames 0'):
            verifier.verify_local_contract(bad, static)


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
