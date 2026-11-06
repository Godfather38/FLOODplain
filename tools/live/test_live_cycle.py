"""Offline no-publication regression for solver/export/package failures."""
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest

import verify_live_package as validator

HERE=Path(__file__).parent
CYCLE='2026-11-06T06:00:00Z'


def package(path):
    path.mkdir(exist_ok=True)
    cycle=dt.datetime.fromisoformat(CYCLE.replace('Z','+00:00'))
    times=[(cycle+dt.timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M:%SZ') for h in range(-6,19)]
    body={'runId':'live-test','frames':[{'time':t,'surfaceM':[1.,None,2.]} for t in times]}
    water=gzip.compress(json.dumps(body).encode());(path/'water.json.gz').write_bytes(water)
    m={'kind':'live_sfincs_run','runId':'live-test','finished':True,'hrrrCycle':CYCLE,
       'frameCount':25,'firstFrame':times[0],'lastFrame':times[-1],
       'files':{'water.json.gz':{'bytes':len(water),'sha256':hashlib.sha256(water).hexdigest()}}}
    (path/'manifest.json').write_text(json.dumps(m))
    return m,body


class CycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        (self.root/'tools/live').mkdir(parents=True);(self.root/'engine').mkdir();(self.root/'work').mkdir();(self.root/'bin').mkdir()
        for name in ['run_live_cycle.sh','verify_live_package.py']:
            shutil.copyfile(HERE/name,self.root/'tools/live'/name)
        self.script(self.root/'tools/live/publish_live_model.sh','echo published > published\necho new > previous-model')
        self.script(self.root/'engine/sfincs','echo "Simulation finished"\nexit "${SOLVER_EXIT:-0}"')
        self.script(self.root/'bin/python',f'''if [ "$1" = tools/live/run_live_sfincs.py ]; then
  [ "${{EXPORT_FAIL:-0}}" = 0 ] || exit 7
  mkdir -p "$4"; cp fixture/* "$4/"
else exec "{sys.executable}" "$@"; fi''')
        self.manifest,self.body=package(self.root/'fixture')
        (self.root/'work/live-case.json').write_text('{}');(self.root/'previous-model').write_text('original')
        self.env=dict(os.environ,PATH=str(self.root/'bin')+':'+os.environ['PATH'],GITHUB_WORKSPACE=str(self.root))

    def script(self,path,body):path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o755)
    def run_cycle(self,**env):
        return subprocess.run(['bash','tools/live/run_live_cycle.sh','work','out',CYCLE],cwd=self.root,env=self.env|env,text=True,capture_output=True)
    def retained(self,result):
        self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertFalse((self.root/'published').exists());self.assertEqual((self.root/'previous-model').read_text(),'original')
    def test_complete_run_publishes(self):
        r=self.run_cycle();self.assertEqual(r.returncode,0,r.stderr);self.assertTrue((self.root/'published').exists())
    def test_solver_nonzero_and_timeout_preserve_previous_data(self):
        for code in ['1','124']:
            with self.subTest(code=code):self.retained(self.run_cycle(SOLVER_EXIT=code))
    def test_export_failure_preserves_previous_data(self):self.retained(self.run_cycle(EXPORT_FAIL='1'))
    def test_incomplete_manifest_and_wrong_cycle_preserve_data(self):
        for edit in [{'finished':False},{'frameCount':24},{'hrrrCycle':'2026-11-06T05:00:00Z'},{'lastFrame':'2026-11-06T23:00:00Z'}]:
            with self.subTest(edit=edit):
                (self.root/'fixture/manifest.json').write_text(json.dumps(self.manifest|edit));self.retained(self.run_cycle())
    def test_bad_checksum_preserves_data(self):
        (self.root/'fixture/water.json.gz').write_bytes(b'bad');self.retained(self.run_cycle())
    def test_missing_actual_frame_even_with_correct_manifest_preserves_data(self):
        self.body['frames'].pop(3);raw=gzip.compress(json.dumps(self.body).encode());(self.root/'fixture/water.json.gz').write_bytes(raw)
        self.manifest['files']['water.json.gz']={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
        (self.root/'fixture/manifest.json').write_text(json.dumps(self.manifest));self.retained(self.run_cycle())
    def test_publisher_error_remains_failure(self):
        self.script(self.root/'tools/live/publish_live_model.sh','exit 9');self.retained(self.run_cycle())


class WorkflowTests(unittest.TestCase):
    def test_failed_cycles_continue_then_fail_and_successor_stays_enabled(self):
        s=Path('.github/workflows/live-sfincs.yml').read_text()
        block=textwrap.dedent(s.split('      - name: Run every hour and publish\n        run: |\n',1)[1].split('      # Not after a cancel',1)[0]).replace('${{ inputs.hours || 5 }}','2')
        with tempfile.TemporaryDirectory() as t:
            for name,body in {'git':'exit 0','python':'case "$*" in *"run_live_all_route.py check"*) exit 1;; *"run_live_sfincs.py prepare"*) echo "mock unavailable"; exit 1;; *) exit 2;; esac','sleep':'exit 0'}.items():
                p=Path(t)/name;p.write_text('#!/bin/sh\n'+body+'\n');p.chmod(0o755)
            r=subprocess.run(['bash','-e','-c',block],cwd=t,env=dict(os.environ,PATH=t+':'+os.environ['PATH']),text=True,capture_output=True)
            self.assertEqual(r.returncode,1,r.stdout+r.stderr);self.assertEqual(r.stdout.count('Current model preparation failed'),2)
        self.assertIn('if: success() || failure()',s)


if __name__=='__main__':unittest.main()
