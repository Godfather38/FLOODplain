"""Offline tests: python -m unittest discover -s tools/live -p 'test_*.py'."""
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import h5py
import numpy as np

from export_road_forecast import (CASE_ROUTES, NativeGeometry, RoadForecast, WET_M,
                                  digest, export_compact, load_roads, read_columns)
import run_live_all_route as live


def packed(path, fmt, columns, **header):
    blocks, descriptors, offset = [], {}, 0
    for name, (dtype, values) in columns.items():
        types = {'d': '<f8', 'f': '<f4', 'I': '<u4', 'u4': '<u4', 'i4': '<i4', 'u1': 'u1', 'i1': 'i1'}
        data = np.array(values, dtype=types[dtype]).tobytes()
        descriptors[name] = {'type': dtype, 'offset': offset, 'count': len(values)}
        offset += len(data)
        blocks.append(data)
    encoded = json.dumps(dict(format=fmt, columns=descriptors, **header)).encode()
    raw = len(encoded).to_bytes(4, 'little') + encoded + b''.join(blocks)
    compressed = gzip.compress(raw, mtime=0)
    path.write_bytes(compressed)
    return digest(compressed)


def geometry_columns():
    # Three adjoining cells in deliberately non-spatial face order. Coordinates
    # are the format's actual [latitude, longitude], not the common inverse.
    rings = [[[0, 1], [0, 2], [1, 2], [1, 1]],
             [[0, 0], [0, 1], [1, 1], [1, 0]],
             [[0, 2], [0, 3], [1, 3], [1, 2]]]
    return {'areaM2': np.array([100., 25., 100.]), 'resolutionM': np.array([10., 5., 10.]),
            'vertices': np.array(rings).ravel(), 'ringOffsets': np.array([0, 4, 8, 12]),
            'ringIndices': np.arange(12)}


def station(lon=.5, lat=.5, height=10., flags=0):
    return {'lon': lon, 'lat': lat, 'roadM': height, 'flags': flags, 'source': 0}


def forecast(stations=None):
    return RoadForecast('northern', NativeGeometry(geometry_columns()),
                        {'trico': stations if stations is not None else [station()]},
                        {'sha256': 'road-hash'}, {'elevation': 'metres NAVD88'})


def manifest(times, status='complete'):
    return {'runId': 'live-test', 'case': 'northern', 'modelVersion': 'test-v1',
            'executionMode': 'live_current_forcing', 'status': status,
            'solverCompletion': {'status': 'complete' if status == 'complete' else 'not_finished'},
            'issuedAt': '2026-11-06T12:00:00Z', 'sourceIssues': {'HRRR': '2026-11-06T11:00:00Z'},
            'geometry': {'sha256': 'geometry-hash'}, 'caseArchiveSha256': 'archive-hash',
            'uncertainty': {'status': 'not_quantified'}, 'limits': 'Not observed water.',
            'frames': [{'time': time} for time in times]}


class GeometryTests(unittest.TestCase):
    def test_actual_polygon_and_non_spatial_face_order(self):
        geom = NativeGeometry(geometry_columns())
        self.assertEqual(geom.locate(.5, .5), 1)
        self.assertEqual(geom.locate(1.5, .5), 0)
        self.assertEqual(geom.locate(2.5, .5), 2)
        self.assertEqual(geom.locate(3.01, .5), -1)
        self.assertEqual(geom.locate(1, .5), -2)
        self.assertEqual(geom.locate(float('nan'), .5), -1)

    def test_polygon_not_bounding_box_or_nearest_cell(self):
        cols = {'areaM2': np.array([100.]), 'resolutionM': np.array([10.]),
                'vertices': np.array([0, 0, 0, 1, 1, 0]),
                'ringOffsets': np.array([0, 3]), 'ringIndices': np.array([0, 1, 2])}
        geom = NativeGeometry(cols)
        self.assertEqual(geom.locate(.1, .1), 0)
        self.assertEqual(geom.locate(.9, .9), -1)

    def test_invalid_geometry_rejected(self):
        for key, value in [('areaM2', np.array([0., 25., 100.])),
                           ('ringOffsets', np.array([0, 4, 8, 13])),
                           ('ringIndices', np.array([100] * 12))]:
            cols = geometry_columns()
            cols[key] = value
            with self.assertRaises(ValueError):
                NativeGeometry(cols)


class ForecastTests(unittest.TestCase):
    def test_wet_depth_capped_at_native_volume_and_deck_height(self):
        f = forecast([station(height=9.5, flags=2), station(lon=1.5, height=20)])
        f.add_frame('2026-11-06T12:00:00Z', np.array([100., 5., 0.]), np.array([21., 10., 0.]))
        frame = f.routes['trico']['frames'][0]
        self.assertEqual(frame['peakRoadDepthM'], 1.)
        self.assertEqual(frame['wetStations'], 2)
        self.assertEqual(frame['lon'], 1.5)
        self.assertFalse(frame['deck'])
        # Test an approach-estimated bridge deck as peak, not ground beneath it.
        f = forecast([station(height=9.5, flags=2)])
        f.add_frame('2026-11-06T12:00:00Z', np.array([0., 5., 0.]), np.array([0., 10., 0.]))
        self.assertEqual(f.routes['trico']['frames'][0]['peakRoadDepthM'], .2)
        self.assertTrue(f.routes['trico']['frames'][0]['deck'])

    def test_finite_dry_volume_with_missing_surface_is_known_dry(self):
        for value in [0., (WET_M - .00001) * 25]:
            f = forecast()
            f.add_frame('2026-11-06T12:00:00Z', np.array([0., value, 0.]), np.array([0., np.nan, 0.]))
            self.assertEqual(f.routes['trico']['frames'][0],
                             {'peakRoadDepthM': 0., 'validStations': 1, 'wetStations': 0,
                              'lat': .5, 'lon': .5, 'deck': False, 'coverage': 'complete'})

    def test_missing_wet_surface_missing_volume_and_negative_volume_unknown(self):
        for volume, surface in [(1., np.nan), (np.nan, 20.), (-1., 20.), (np.inf, 20.), (1., -99999.)]:
            f = forecast()
            f.add_frame('2026-11-06T12:00:00Z', np.array([0., volume, 0.]), np.array([0., surface, 0.]))
            frame = f.routes['trico']['frames'][0]
            self.assertIsNone(frame['peakRoadDepthM'])
            self.assertEqual(frame['coverage'], 'unavailable')
            self.assertEqual(frame['validStations'], 0)
            self.assertIsNone(frame['lon'])

    def test_unknown_height_stays_unknown_even_with_dry_cell(self):
        f = forecast([station(height=None, flags=4)])
        f.add_frame('2026-11-06T12:00:00Z', np.zeros(3), np.zeros(3))
        self.assertIsNone(f.routes['trico']['frames'][0]['peakRoadDepthM'])
        self.assertEqual(f.routes['trico']['unknownHeightStations'], 1)
        self.assertEqual(f.routes['trico']['mappedStations'], 0)

    def test_disjoint_static_counts_and_partial_frame(self):
        f = forecast([station(), station(4.), station(5., height=None), station(1.)])
        route = f.routes['trico']
        self.assertEqual([route[k] for k in ['totalStations', 'mappedStations', 'unknownHeightStations', 'outsideStations', 'ambiguousStations']], [4, 1, 1, 2, 1])
        f.add_frame('2026-11-06T12:00:00Z', np.zeros(3), np.zeros(3))
        self.assertEqual(route['frames'][0]['coverage'], 'partial')
        self.assertEqual(route['frames'][0]['validStations'], 1)
        self.assertEqual(route['frames'][0]['peakRoadDepthM'], 0.)

    def test_water_below_deck_is_zero_not_cell_depth(self):
        f = forecast([station(height=11., flags=1)])
        f.add_frame('2026-11-06T12:00:00Z', np.array([0., 50., 0.]), np.array([0., 10., 0.]))
        self.assertEqual(f.routes['trico']['frames'][0]['peakRoadDepthM'], 0.)

    def test_native_dry_threshold_boundary(self):
        f = forecast([station(height=0.)])
        f.add_frame('2026-11-06T12:00:00Z', np.array([0., WET_M * 25, 0.]), np.array([0., 10., 0.]))
        self.assertEqual(f.routes['trico']['frames'][0]['peakRoadDepthM'], WET_M)
        self.assertEqual(f.routes['trico']['frames'][0]['wetStations'], 1)

    def test_invalid_frame_order_and_length_rejected(self):
        f = forecast()
        with self.assertRaises(ValueError):
            f.add_frame('2026-11-06T12:00:00Z', np.zeros(2), np.zeros(3))
        f.add_frame('2026-11-06T12:00:00Z', np.zeros(3), np.zeros(3))
        with self.assertRaises(ValueError):
            f.add_frame('2026-11-06T12:00:00Z', np.zeros(3), np.zeros(3))

    def test_complete_partial_empty_and_provenance_serialization(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'road-forecast.json'
            f = forecast()
            f.add_frame('2026-11-06T12:00:00Z', np.full(3, np.nan), np.full(3, np.nan))
            descriptor = f.write(path, manifest(f.times))
            data = json.loads(path.read_text())
            self.assertEqual(data['kind'], 'live_all_route_road_forecast')
            self.assertEqual(data['status'], 'complete')
            self.assertEqual(data['validFrom'], f.times[0])
            self.assertEqual(data['validTo'], f.times[-1])
            self.assertEqual(data['provenance']['roadStations']['sha256'], 'road-hash')
            self.assertEqual(descriptor['sha256'], digest(path.read_bytes()))
            self.assertNotIn('NaN', path.read_text())
            f.write(path, manifest(f.times, 'partial'))
            self.assertEqual(json.loads(path.read_text())['status'], 'partial')
            with self.assertRaises(ValueError):
                f.write(path, manifest([]))
            empty = forecast([])
            empty.write(path, manifest([]))
            self.assertIsNone(json.loads(path.read_text())['validTo'])


class SourceAndIntegrationTests(unittest.TestCase):
    def test_real_pinned_route_source_contains_eight_routes_and_unknowns_retained(self):
        ids = set()
        for case in CASE_ROUTES:
            routes, source, metadata = load_roads(case)
            ids.update(routes)
            self.assertEqual(source['sha256'], '94a2693e697bf4ded78f3853d920aad6d2fbee16db584194ad2f5bb1fc34ee97')
            self.assertIn('NAVD88', metadata['elevation'])
        self.assertEqual(len(ids), 8)

    def test_checksum_and_format_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bad.bin.gz'
            packed(path, 'wrong-format', {'x': ('f', [1])})
            with self.assertRaises(ValueError):
                read_columns(path, 'floodplain-columns-v1')
            with self.assertRaises(ValueError):
                read_columns(path, 'wrong-format', 'incorrect-hash')

    def test_live_export_and_backfill_match_with_nontrivial_native_face_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); work = root / 'work'; out = root / 'out'
            work.mkdir()
            cols = geometry_columns()
            geo = root / 'geometry.bin.gz'
            geo_hash = packed(geo, 'floodplain-columns-v1',
                              {k: ('I' if k in ('ringOffsets', 'ringIndices') else 'd', v) for k, v in cols.items()},
                              metadata={'coordinates': 'latitude,longitude', 'geometryKind': 'native_quadtree_faces'})
            face = root / 'face.npy'
            np.save(face, np.array([2, 0, 1]))  # output positions -> original geometry IDs
            case = {'modelVersion': 'fixture-v1', 'archiveSha256': 'archive-hash',
                    'faceMapping': {'path': str(face), 'sha256': digest(face.read_bytes())},
                    'geometry': {'path': str(geo), 'sha256': geo_hash}}
            (work / 'live-case.json').write_text(json.dumps({'hrrrCycle': '2026-11-06T12:00:00Z'}))
            (work / 'solver.log').write_text('Simulation finished')
            with h5py.File(work / 'sfincs_map.nc', 'w') as f:
                t = f.create_dataset('time', data=[0., 1800.]); t.attrs['units'] = 'seconds since 2026-11-06 12:00:00'
                f.create_dataset('subgrid_volume', data=[[0., 0., 5.], [0., 0., 0.]])
                f.create_dataset('zs', data=[[0., 0., 10.5], [0., 0., -99999.]])
            def loader(*args):
                return forecast([station()])
            with patch.object(live, 'case_entry', return_value=case), patch.object(RoadForecast, 'load', side_effect=loader):
                live.export('northern', work, out, 'fixture-live')
                result = json.loads((out / 'road-forecast.json').read_text())
                self.assertEqual(result['routes']['trico']['frames'][0]['peakRoadDepthM'], .2)
                self.assertEqual(result['routes']['trico']['frames'][1]['peakRoadDepthM'], 0.)
                published = json.loads((out / 'manifest.json').read_text())
                self.assertEqual(published['roadForecast']['sha256'], digest((out / 'road-forecast.json').read_bytes()))
                original = (out / 'road-forecast.json').read_bytes()
                export_compact('northern', out)
                self.assertEqual((out / 'road-forecast.json').read_bytes(), original)
                # A genuine partial solver result cannot become complete in the road product.
                (work / 'solver.log').write_text('timeout')
                live.export('northern', work, out, 'fixture-live')
                self.assertEqual(json.loads((out / 'road-forecast.json').read_text())['status'], 'partial')
                with self.assertRaises(ValueError):
                    export_compact('gates', out)
                published = json.loads((out / 'manifest.json').read_text())
                frame_path = out / published['frames'][0]['path']
                frame_path.write_bytes(frame_path.read_bytes() + b'corrupt')
                with self.assertRaises(ValueError):
                    export_compact('northern', out)


if __name__ == '__main__':
    unittest.main()
