#!/usr/bin/env python3
"""Offline lifecycle tests; these do not substitute for actual Docker acceptance."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('container_smoke', ROOT/'scripts/container-smoke-test.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class ContainerScript(unittest.TestCase):
    def test_build_is_clean_and_only_owned_image_is_removed(self):
        self.exercise(True)

    def test_supplied_image_is_never_removed(self):
        self.exercise(False)

    def exercise(self, build):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root/'artifacts').mkdir()
            (root/'artifacts/anywork-source.tar.gz').write_bytes(b'fixture corresponding source')
            (root/'package.json').write_text(json.dumps({'version':'1.2.3'}))
            calls = []
            def docker(*args, **kwargs):
                calls.append(args)
                return 'anywork 1.2.3' if args[0] == 'run' else '27'
            def acceptance(image, prefix, fixture, version, digest):
                self.assertEqual(version, '1.2.3')
                self.assertTrue(prefix.startswith('anywork-smoke-'))
                self.assertEqual(fixture.stat().st_mode & 0o777, 0o755)
                manifest = json.loads((fixture/'fixture.json').read_text())
                self.assertEqual(manifest['command'], 'node')
                self.assertEqual(manifest['id'], 'container-fixture')
                self.assertNotIn('turn/start', (fixture/'agent.cjs').read_text())
                raise RuntimeError('simulate acceptance failure')
            argv = ['script', '--build'] if build else ['script', '--image', 'existing-image']
            with patch.object(smoke, 'ROOT', root), patch.object(smoke, 'docker', docker), patch.object(smoke, 'acceptance', acceptance), patch.object(smoke.subprocess, 'run') as cleanup, patch('sys.argv', argv):
                with self.assertRaisesRegex(RuntimeError, 'simulate acceptance failure'): smoke.main()
                if build:
                    self.assertIn('--no-cache', calls[1])
                    command = cleanup.call_args.args[0]
                    self.assertEqual(command[:4], ['docker', 'image', 'rm', '-f'])
                    self.assertTrue(command[4].startswith('anywork-smoke-'))
                else: cleanup.assert_not_called()


if __name__ == '__main__': unittest.main()
