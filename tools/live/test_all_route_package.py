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
import unittest
from unittest.mock import patch

import numpy as np

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


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        source = self.source = Path('.github/workflows/live-all-route.yml').read_text()
        self.blocks = []
        for name, end in [('Run the solver', '      - name: Export and publish'),
                          ('Export and publish', '      - uses: actions/upload-artifact@v4')]:
            block = textwrap.dedent(source.split(f'      - name: {name}\n        run: |\n', 1)[1].split(end, 1)[0])
            block = block.replace("${{ inputs.solver_cap_seconds || '5400' }}", '30')
            block = block.replace('${{ matrix.case }}', CASE).replace('${{ needs.check.outputs.cycle }}', CYCLE)
            self.blocks.append(block)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for folder in ['tools/live', 'engine', 'work', 'bin']:
            (self.root / folder).mkdir(parents=True)
        (self.root / 'work/live-case.json').write_text('{}')
        (self.root / 'previous-model').write_text('original')
        self.script('engine/sfincs', 'echo "Simulation finished"\nexit "${SOLVER_EXIT:-0}"')
        self.script('tools/live/publish_live_model.sh', 'echo published > published\necho new > previous-model')
        self.script('bin/git', 'exit 0')
        self.script('bin/python', f'''case "$1" in
tools/live/run_live_all_route.py)
  [ "${{EXPORT_FAIL:-0}}" = 0 ] || exit 7
  mkdir -p out; echo '{{"runId":"fixture","status":"complete","validFrom":"start","validTo":"end"}}' > out/manifest.json
  echo exported > exported;;
tools/live/verify_all_route_package.py) exit "${{VERIFY_FAIL:-0}}";;
*) exec "{sys.executable}" "$@";;
esac''')
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + ':' + os.environ['PATH'],
                        GITHUB_WORKSPACE=str(self.root), GITHUB_ENV=str(self.root / 'env'),
                        PREPARE_SECONDS='1', SOLVER_SECONDS='1', OMP_NUM_THREADS='4', GITHUB_RUN_ID='test')

    def script(self, name, body):
        path = self.root / name
        path.write_text('#!/bin/sh\n' + body + '\n')
        path.chmod(0o755)

    def run_workflow(self, **env):
        for block in self.blocks:
            result = subprocess.run(['bash', '-e', '-c', block], cwd=self.root,
                                    env=self.env | env, text=True, capture_output=True)
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
