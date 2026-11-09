#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('materialize', Path(__file__).with_name('materialize-prebuilt.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MaterializeContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@invalid.test')
        self.git('config', 'user.name', 'Fixture')
        (self.source / 'notice.txt').write_text('required license\n')
        self.git('add', 'notice.txt')
        self.git('commit', '-qm', 'fixture')
        self.revision = self.git('rev-parse', 'HEAD').strip()
        self.upload = self.root / 'upload'
        self.function = self.upload / '.vercel/output/functions/index.func'
        self.function.mkdir(parents=True)
        self.config = self.function / '.vc-config.json'
        self.configure({'nested/LICENSE': 'notice.txt'})

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.source), *args], text=True)

    def configure(self, mapping):
        self.config.write_text(json.dumps({'runtime': 'nodejs22.x', 'filePathMap': mapping}))

    def run_materialize(self, forbidden=()):
        return m.materialize(self.upload, self.source, self.revision, forbidden)

    def test_nonidentity_mapping_preserves_bytes_mode_and_receipt(self):
        receipt = self.run_materialize()
        self.assertEqual((self.function / 'nested/LICENSE').read_bytes(), (self.source / 'notice.txt').read_bytes())
        self.assertEqual((self.function / 'nested/LICENSE').stat().st_mode & 0o777, 0o644)
        self.assertNotIn('filePathMap', json.loads(self.config.read_text()))
        self.assertEqual(receipt['functions'][0]['files'][0]['source'], 'notice.txt')
        self.assertEqual(receipt['functions'][0]['files'][0]['target'], 'nested/LICENSE')
        self.assertEqual(self.run_materialize()['functions'], [])

    def test_unsafe_source_and_target_paths_fail_before_writes(self):
        for unsafe in ['../notice.txt', '/notice.txt', 'nested/../notice.txt', 'C:\\notice.txt', 'nested//notice.txt', '.env.local']:
            for mapping in [{unsafe: 'notice.txt'}, {'target': unsafe}]:
                self.configure(mapping)
                with self.assertRaises(m.cloud.ConfigurationError): self.run_materialize()
                self.assertFalse((self.function / 'target').exists())

    def test_untracked_dirty_wrong_revision_and_secret_rejected(self):
        (self.source / 'untracked').write_text('untracked')
        self.configure({'target': 'untracked'})
        with self.assertRaisesRegex(m.cloud.ConfigurationError, 'not tracked'): self.run_materialize()
        self.configure({'target': 'notice.txt'})
        with self.assertRaisesRegex(m.cloud.ConfigurationError, 'credential'): self.run_materialize(['required license'])
        (self.source / 'notice.txt').write_text('dirty')
        with self.assertRaisesRegex(m.cloud.ConfigurationError, 'dirty'): self.run_materialize()
        with self.assertRaisesRegex(m.cloud.ConfigurationError, 'HEAD differs'): m.materialize(self.upload, self.source, 'a' * 40, [])

    def test_conflict_and_symlink_ancestors_rejected(self):
        (self.function / 'nested').symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(m.cloud.ConfigurationError, 'symlink'): self.run_materialize()
        (self.function / 'nested').unlink()
        (self.function / 'nested').write_text('file')
        with self.assertRaisesRegex(m.cloud.ConfigurationError, 'parent'): self.run_materialize()
        (self.function / 'nested').unlink()
        (self.function / 'nested').mkdir()
        (self.function / 'nested/LICENSE').write_text('conflict')
        with self.assertRaisesRegex(m.cloud.ConfigurationError, 'conflicts'): self.run_materialize()

    def test_tracked_symlink_and_file_directory_conflicts_rejected(self):
        (self.source / 'link').symlink_to('notice.txt')
        self.git('add', 'link'); self.git('commit', '-qm', 'link')
        self.revision = self.git('rev-parse', 'HEAD').strip()
        self.configure({'target': 'link'})
        with self.assertRaisesRegex(m.cloud.ConfigurationError, 'regular tracked'): self.run_materialize()
        self.configure({'x': 'notice.txt', 'x/y': 'notice.txt'})
        with self.assertRaisesRegex(m.cloud.ConfigurationError, 'file/directory'): self.run_materialize()
        self.assertFalse((self.function / 'x').exists())


if __name__ == '__main__':
    unittest.main()
