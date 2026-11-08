"""Offline package and workflow checks: failures must not replace live data."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

from export_road_forecast import RoadForecast
from run_live_all_route import pack
import verify_all_route_package as validator


CYCLE = '2026-11-06T06:00:00Z'
CASE = 'gates'


def stamp(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def write_json(path, body):
    raw = json.dumps(body).encode()
    path.write_bytes(raw)
    return {'path': path.name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


def package(folder):
    folder.mkdir(exist_ok=True)
    cycle = validator.parse(CYCLE)
    times = [stamp(cycle + dt.timedelta(minutes=m)) for m in range(-180, 1081, 30)]
    geometry = pack(folder / 'geometry.bin.gz', {'geometryKind': 'native_quadtree_faces'},
                    {'areaM2': np.array([25., 100., 25.])})
    entry = {'modelVersion': 'fixture-v1', 'archiveSha256': 'archive-hash', 'geometry': geometry}
    frames = []
    for i, time in enumerate(times):
        descriptor = pack(folder / f'frame-{i}.bin.gz',
                          {'runId': 'fixture-live', 'time': time, 'geometrySha256': geometry['sha256']},
                          {'nativeVolumeM3': np.array([0., 1., np.nan]),
                           'waterSurfaceM': np.array([np.nan, 20., np.nan])})
        frames.append({'time': time, **descriptor})
    road = {'kind': 'live_all_route_road_forecast', 'status': 'complete', 'case': CASE,
            'runId': 'fixture-live', 'hrrrCycle': CYCLE, 'times': times,
            'validFrom': times[0], 'validTo': times[-1],
            'provenance': {'geometrySha256': geometry['sha256']}}
    manifest = {'kind': 'quadtree_output_package', 'status': 'complete', 'case': CASE,
                'modelVersion': entry['modelVersion'], 'caseArchiveSha256': entry['archiveSha256'],
                'runId': 'fixture-live', 'executionMode': 'live_current_forcing',
                'solverCompletion': {'status': 'complete'}, 'sourceIssues': {'HRRR': CYCLE},
                'validFrom': times[0], 'validTo': times[-1], 'frames': frames, 'geometry': geometry,
                'roadForecast': write_json(folder / 'road-forecast.json', road)}
    write_json(folder / 'manifest.json', manifest)
    write_json(folder / 'live-case.json', {'case': CASE, 'hrrrCycle': CYCLE,
               'start': stamp(cycle - dt.timedelta(hours=45)), 'end': times[-1]})
    return entry, manifest, road


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.entry, self.manifest, self.road = package(self.folder)
        self.lookup = patch.object(validator, 'case_entry', return_value=self.entry).start()
        self.addCleanup(patch.stopall)

    def verify(self):
        validator.verify(self.folder, CASE, CYCLE)

    def test_complete_43_half_hour_frames_preserve_unknown_cells(self):
        self.verify()
        self.assertEqual(len(self.manifest['frames']), 43)

    def test_partial_wrong_case_cycle_or_archive_rejected(self):
        for edit in [{'status': 'partial'}, {'solverCompletion': {'status': 'not_finished'}},
                     {'case': 'northern'}, {'sourceIssues': {'HRRR': '2026-11-06T05:00:00Z'}},
                     {'caseArchiveSha256': 'different'}]:
            with self.subTest(edit=edit):
                write_json(self.folder / 'manifest.json', self.manifest | edit)
                with self.assertRaises(ValueError):
                    self.verify()

    def test_missing_duplicate_reordered_or_short_window_rejected(self):
        original = self.manifest['frames']
        variants = [original[:-1], original[:3] + original[4:],
                    original[:3] + [original[2]] + original[4:], list(reversed(original))]
        for frames in variants:
            with self.subTest(times=[f['time'] for f in frames][:4]):
                write_json(self.folder / 'manifest.json', self.manifest | {'frames': frames})
                with self.assertRaises(ValueError):
                    self.verify()

    def test_frame_corruption_and_wrong_frame_identity_rejected(self):
        path = self.folder / self.manifest['frames'][0]['path']
        path.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.verify()
        descriptor = pack(path, {'runId': 'other', 'time': self.manifest['frames'][0]['time'],
                               'geometrySha256': self.entry['geometry']['sha256']},
                          {'nativeVolumeM3': np.zeros(3), 'waterSurfaceM': np.zeros(3)})
        self.manifest['frames'][0].update(descriptor)
        write_json(self.folder / 'manifest.json', self.manifest)
        with self.assertRaisesRegex(ValueError, 'frame identity'):
            self.verify()

    def test_missing_frame_and_missing_road_file_rejected(self):
        for name in [self.manifest['frames'][0]['path'], 'road-forecast.json']:
            with self.subTest(name=name):
                path = self.folder / name
                saved = path.read_bytes()
                path.unlink()
                with self.assertRaises(FileNotFoundError):
                    self.verify()
                path.write_bytes(saved)

    def test_invalid_native_values_or_cell_counts_rejected(self):
        frame = self.manifest['frames'][0]
        for volume, surface in [(np.zeros(2), np.zeros(2)), (np.full(3, np.nan), np.zeros(3)),
                                (np.array([0., -1., 0.]), np.zeros(3)),
                                (np.array([0., np.inf, 0.]), np.zeros(3)),
                                (np.zeros(3), np.array([0., np.inf, 0.]))]:
            with self.subTest(volume=volume, surface=surface):
                descriptor = pack(self.folder / frame['path'],
                                  {'runId': self.manifest['runId'], 'time': frame['time'],
                                   'geometrySha256': self.entry['geometry']['sha256']},
                                  {'nativeVolumeM3': volume, 'waterSurfaceM': surface})
                frame.update(descriptor)
                write_json(self.folder / 'manifest.json', self.manifest)
                with self.assertRaisesRegex(ValueError, 'native cell data'):
                    self.verify()

    def test_small_negative_residual_keeps_package_bytes_unchanged(self):
        frame = self.manifest['frames'][0]
        path = self.folder / frame['path']
        frame.update(pack(path, {'runId': self.manifest['runId'], 'time': frame['time'],
                                'geometrySha256': self.entry['geometry']['sha256']},
                          {'nativeVolumeM3': np.array([-.003643210045993328, 1., np.nan]),
                           'waterSurfaceM': np.array([np.nan, 20., np.nan])}))
        write_json(self.folder / 'manifest.json', self.manifest)
        before = {p.name: p.read_bytes() for p in self.folder.iterdir()}
        self.verify()
        self.assertEqual({p.name: p.read_bytes() for p in self.folder.iterdir()}, before)

    def test_incomplete_road_forecast_and_prepared_window_rejected(self):
        for edit in [{'status': 'partial'}, {'times': self.road['times'][:-1]}, {'runId': 'other'}]:
            with self.subTest(edit=edit):
                self.manifest['roadForecast'] = write_json(self.folder / 'road-forecast.json', self.road | edit)
                write_json(self.folder / 'manifest.json', self.manifest)
                with self.assertRaisesRegex(ValueError, 'Road forecast'):
                    self.verify()
        self.manifest['roadForecast'] = write_json(self.folder / 'road-forecast.json', self.road)
        write_json(self.folder / 'manifest.json', self.manifest)
        write_json(self.folder / 'live-case.json', {'case': CASE, 'hrrrCycle': CYCLE,
                   'start': CYCLE, 'end': self.road['validTo']})
        with self.assertRaisesRegex(ValueError, 'Prepared forcing'):
            self.verify()


class NativeResidualTests(unittest.TestCase):
    def test_verified_prior_picture_rocks_residuals_preserved(self):
        # From published 00Z frame-0, SHA256 5a0d901757add37e8a73c78a57901ade5
        # ec074567a48a2327e7bd85c1b58e589. Pinned geometry SHA256 63e8ff89a772fb9f
        # 1a3775bbc0f2d54a9b188efd03b2614c75d2769593ef7fca; native indices 270538,
        # 271974 each have area 156.25 m2. These are NOT the unavailable 07Z frames.
        volume = np.array([-.002965580904856324, -.003643210045993328, 0.], dtype='float32')
        surface = np.array([np.nan, np.nan, np.nan], dtype='float32')
        area = np.array([156.25, 156.25, 156.25])
        original = volume.tobytes(), surface.tobytes(), area.tobytes()
        count, minimum = validator.verify_native_data(volume, surface, area, 'prior-frame-0')
        self.assertEqual(count, 2)
        self.assertAlmostEqual(minimum, -2.3316544294357298e-05)
        self.assertEqual((volume.tobytes(), surface.tobytes(), area.tobytes()), original)

    def test_residual_bound_scales_with_area_and_handles_float32_boundary(self):
        area = np.array([39.0625, 156.25, 10000., 25.])
        volume = np.array([-validator.NEGATIVE_RESIDUAL_DEPTH_M * a for a in area], dtype='float32')
        volume[-1] = 0
        self.assertEqual(validator.verify_native_data(volume, np.full(4, np.nan), area, 'boundary')[0], 3)
        for index in range(3):
            invalid = volume.copy()
            invalid[index] = -area[index] * (validator.NEGATIVE_RESIDUAL_DEPTH_M + 1e-6)
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, 'minimumDepthM=.*negative residual limit'):
                validator.verify_native_data(invalid, np.full(4, np.nan), area, 'too-negative')

    def test_invalid_geometry_and_no_usable_native_samples_rejected(self):
        for area in [np.array([0., 25.]), np.array([-1., 25.]), np.array([np.nan, 25.]), np.array([np.inf, 25.])]:
            with self.subTest(area=area), self.assertRaisesRegex(ValueError, 'invalid native cell areas'):
                validator.verify_native_data(np.zeros(2), np.zeros(2), area, 'bad-geometry')
        for volume in [np.full(2, np.nan), np.full(2, -.001)]:
            with self.subTest(volume=volume), self.assertRaisesRegex(ValueError, 'nonnegativeVolumes=0'):
                validator.verify_native_data(volume, np.full(2, np.nan), np.full(2, 25.), 'unusable')

    def test_accepted_residual_road_station_remains_unknown_not_dry(self):
        area = np.array([156.25, 156.25])
        volume, surface = np.array([-.003643210045993328, 0.]), np.array([np.nan, np.nan])
        validator.verify_native_data(volume, surface, area, 'unknown-station')
        geometry = SimpleNamespace(area=area, locate=lambda lon, lat: 0)
        station = {'lon': 0., 'lat': 0., 'roadM': 20., 'flags': 0}
        road = RoadForecast(CASE, geometry, {'route': [station]}, {}, {})
        road.add_frame(CYCLE, volume, surface)
        frame = road.routes['route']['frames'][0]
        self.assertEqual(frame['coverage'], 'unavailable')
        self.assertEqual(frame['validStations'], 0)
        self.assertIsNone(frame['peakRoadDepthM'])


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        source = self.source = Path('.github/workflows/live-all-route.yml').read_text()
        self.blocks = []
        for name, end in [('Run the solver', '      - name: Export and verify'),
                          ('Export and verify', '      # PUBLISH GATE'),
                          ('Publish to live-model', '      - name: Keep the unpublished result')]:
            step = source.split(f'      - name: {name}\n', 1)[1]
            block = textwrap.dedent(step.split('        run: |\n', 1)[1].split(end, 1)[0])
            block = block.replace("${{ inputs.solver_cap_seconds || '5400' }}", '30')
            block = block.replace('${{ matrix.case }}', CASE).replace('${{ needs.check.outputs.cycle }}', CYCLE)
            self.blocks.append(block)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for folder in ['tools/live', 'engine', 'work', 'bin']:
            (self.root / folder).mkdir(parents=True)
        (self.root / 'work/live-case.json').write_text('{}')
        self.registry()
        (self.root / 'previous-model').write_text('original')
        self.script('engine/sfincs', 'echo "Simulation finished"\nexit "${SOLVER_EXIT:-0}"')
        self.script('tools/live/publish_live_model.sh', 'echo "$@" > published\necho new > previous-model')
        self.script('bin/git', 'exit 0')
        self.script('bin/python', f'''case "$1" in
tools/live/run_live_all_route.py)
  [ "${{EXPORT_FAIL:-0}}" = 0 ] || exit 7
  mkdir -p out; echo '{{"runId":"fixture","status":"complete","validFrom":"start","validTo":"end"}}' > out/manifest.json
  echo exported > exported;;
tools/live/verify_all_route_package.py) shift; echo "$@" >> verified; exit "${{VERIFY_FAIL:-0}}";;
tools/live/export_road_forecast.py)
  [ "${{LOCAL_FAIL:-0}}" = 0 ] || exit 8
  [ "$2" = local ] && [ "$3" = "{CASE}" ] && [ "$4" = out ] || exit 6
  echo '{{"kind":"floodplain-local-road-forecast"}}' > "$5";;
*) exec "{sys.executable}" "$@";;
esac''')
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + ':' + os.environ['PATH'],
                        GITHUB_WORKSPACE=str(self.root), GITHUB_ENV=str(self.root / 'env'),
                        PREPARE_SECONDS='1', SOLVER_SECONDS='1', OMP_NUM_THREADS='4', GITHUB_RUN_ID='test',
                        GITHUB_REF_NAME='experiment/all-route-models')

    def registry(self, local=False):
        entry = {'case': CASE}
        if local:
            entry['localRoads'] = {'path': 'tools/live/road-stations/x.json.gz', 'sha256': '0' * 64}
        (self.root / 'tools/live/all-route-cases.json').write_text(json.dumps({'schemaVersion': 1, 'cases': [entry]}))

    def script(self, name, body):
        path = self.root / name
        path.write_text('#!/bin/sh\n' + body + '\n')
        path.chmod(0o755)

    def run_workflow(self, **env):
        for block in self.blocks:
            env_file = self.root / 'env'
            exported = dict(line.split('=', 1) for line in env_file.read_text().splitlines() if '=' in line) if env_file.exists() else {}
            result = subprocess.run(['bash', '-e', '-c', block], cwd=self.root,
                                    env=self.env | exported | env, text=True, capture_output=True)
            if result.returncode:
                return result
        return result

    def retained(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.root / 'published').exists())
        self.assertEqual((self.root / 'previous-model').read_text(), 'original')

    def test_check_checkout_includes_workflow_harness_inputs(self):
        check = self.source.split('\n  check:\n', 1)[1].split('\n  run:\n', 1)[0]
        checkout = check.split('      - uses: actions/checkout@v4\n', 1)[1].split('      - uses:', 1)[0]
        lines = checkout.splitlines()
        self.assertIn('          sparse-checkout: |', lines)
        self.assertIn('            tools/live', lines)
        self.assertIn('            .github/workflows', lines)

    def test_complete_validated_workflow_publishes(self):
        result = self.run_workflow()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.root / 'published').exists())
        # A case without localRoads publishes exactly as before.
        self.assertTrue((self.root / 'published').read_text().startswith(f'out all-route/{CASE}/compact '))
        self.assertEqual((self.root / 'verified').read_text().split(), ['out', CASE, CYCLE])

    def test_local_roads_case_exports_verifies_and_publishes_beside_compact(self):
        self.registry(local=True)
        result = self.run_workflow()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.root / 'verified').read_text().split(), ['out', CASE, CYCLE, 'local/local-road-forecast.json'])
        self.assertTrue((self.root / 'published').read_text().startswith(f'publish all-route/{CASE} '))
        self.assertTrue((self.root / 'publish/compact/manifest.json').exists())
        self.assertTrue((self.root / 'publish/local-road-forecast.json').exists())

    def test_local_export_failure_preserves_previous_dataset(self):
        self.registry(local=True)
        self.retained(self.run_workflow(LOCAL_FAIL='1'))

    def test_publish_gate_never_publishes_from_another_ref(self):
        # The step's own condition, plus a shell assertion if the condition were bypassed.
        step = self.source.split('      - name: Publish to live-model\n', 1)[1].split('        run: |', 1)[0]
        self.assertEqual(step.strip(), "if: github.ref_name == 'experiment/all-route-models'")
        keep = self.source.split('      - name: Keep the unpublished result (not the live model branch)\n', 1)[1].split('        uses:', 1)[0]
        self.assertEqual(keep.strip(), "if: github.ref_name != 'experiment/all-route-models'")
        for ref in ['experimental/brawley-avra-west-20261108', 'main', 'live-model', '']:
            with self.subTest(ref=ref):
                self.retained(self.run_workflow(GITHUB_REF_NAME=ref))
                (self.root / 'env').unlink(missing_ok=True)

    def test_publisher_is_called_only_by_the_gated_step(self):
        steps = self.source.split('\n      - ')
        callers = [step for step in steps if 'publish_live_model.sh' in step]
        self.assertEqual(len(callers), 1)
        self.assertTrue(callers[0].startswith('name: Publish to live-model\n        if: github.ref_name == \'experiment/all-route-models\''))
        self.assertNotIn('git push', self.source)

    def test_solver_failure_and_timeout_do_not_export_or_publish(self):
        for status in ['1', '124']:
            with self.subTest(status=status):
                self.retained(self.run_workflow(SOLVER_EXIT=status))
                self.assertFalse((self.root / 'exported').exists())

    def test_export_or_validation_failure_preserves_previous_dataset(self):
        for env in [{'EXPORT_FAIL': '1'}, {'VERIFY_FAIL': '2'}]:
            with self.subTest(env=env):
                self.retained(self.run_workflow(**env))

    def test_publisher_failure_stays_failed(self):
        self.script('tools/live/publish_live_model.sh', 'exit 9')
        self.retained(self.run_workflow())


if __name__ == '__main__':
    unittest.main()
