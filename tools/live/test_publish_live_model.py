"""Run offline regression tests for concurrent live-model publication."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(os.environ.get('PUBLISH_SCRIPT', 'tools/live/publish_live_model.sh')).resolve()

class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.remote = self.root / 'remote.git'
        self.real_git = shutil.which('git')
        self.env = dict(os.environ, GH_TOKEN='test', GITHUB_REPOSITORY='test/repo',
                        RUNNER_TEMP=str(self.root / 'runner'),
                        GIT_CONFIG_GLOBAL=str(self.root / 'gitconfig'),
                        GIT_AUTHOR_NAME='Test', GIT_AUTHOR_EMAIL='test@example.test',
                        GIT_COMMITTER_NAME='Test', GIT_COMMITTER_EMAIL='test@example.test')
        self.git('init', '--bare', '-q', str(self.remote))
        self.git('config', '--global', f'url.{self.remote.as_uri()}.insteadOf',
                 'https://x-access-token:test@github.com/test/repo.git')
    def tearDown(self): self.tmp.cleanup()
    def git(self, *args):
        return subprocess.run([self.real_git, *args], env=self.env, check=True,
                              text=True, capture_output=True).stdout.strip()
    def publish(self, folder, value):
        src = self.root / ('source-' + folder.replace('/', '-'))
        src.mkdir(exist_ok=True)
        (src / 'manifest.json').write_text(value)
        return subprocess.run(['bash', str(SCRIPT), str(src), folder, 'Test update'],
                              env=self.env, check=True, text=True, capture_output=True)
    def read(self, folder):
        return self.git('--git-dir', str(self.remote), 'show', f'live-model:{folder}/manifest.json')
    def test_preserves_sibling_models(self):
        for folder in ['live', 'all-route/northern/compact', 'all-route/picture-rocks/compact', 'all-route/gates/compact']:
            self.publish(folder, folder)
        self.publish('all-route/gates/compact', 'new-gates')
        for folder in ['live', 'all-route/northern/compact', 'all-route/picture-rocks/compact']:
            self.assertEqual(self.read(folder), folder)
        self.assertEqual(self.read('all-route/gates/compact'), 'new-gates')
    def test_retries_after_another_publisher_moves_branch(self):
        self.publish('live', 'coarse')
        race = self.root / 'race'
        self.git('clone', '-q', '--branch', 'live-model', str(self.remote), str(race))
        (race / 'all-route/northern/compact').mkdir(parents=True)
        (race / 'all-route/northern/compact/manifest.json').write_text('parallel-northern')
        self.git('-C', str(race), 'add', '.')
        self.git('-C', str(race), 'commit', '-qm', 'Concurrent northern publish')
        shimdir = self.root / 'bin'; shimdir.mkdir()
        marker = self.root / 'raced'
        wrapper = shimdir / 'git'
        wrapper.write_text(f'''#!/usr/bin/env bash
if [ "$1" = push ] && [ ! -e "{marker}" ]; then
 touch "{marker}"
 "{self.real_git}" -C "{race}" push -q origin HEAD:live-model
fi
exec "{self.real_git}" "$@"
''')
        wrapper.chmod(0o755)
        self.env['PATH'] = str(shimdir) + os.pathsep + self.env['PATH']
        result = self.publish('all-route/gates/compact', 'gates')
        self.assertIn('retry 1', result.stdout)
        self.assertEqual(self.read('live'), 'coarse')
        self.assertEqual(self.read('all-route/northern/compact'), 'parallel-northern')
        self.assertEqual(self.read('all-route/gates/compact'), 'gates')

if __name__ == '__main__': unittest.main()
