#!/usr/bin/env python3
"""Offline lifecycle tests; these do not substitute for actual Docker acceptance."""
import importlib.util
import json
import hashlib
import io
import contextlib
import subprocess
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

    def identity_fixture(self):
        html = b'<meta name="app-version" content="anywork-0123456789abcdef"><script src="/assets/current.js"></script>'
        assets = {'/index.html':html, '/assets/current.js':b'current build'}
        manifest = {'schema':1,'appVersion':'1.2.3','sourceSha256':'a'*64,
                    'appFingerprint':'anywork-0123456789abcdef',
                    'files':{name:hashlib.sha256(data).hexdigest() for name,data in assets.items()}}
        def request(path):
            return json.dumps(manifest).encode() if path == '/build-identity.json' else assets['/index.html' if path=='/' else path]
        return assets, manifest, request

    def test_web_identity_requires_version_source_and_every_served_file(self):
        assets, manifest, request = self.identity_fixture()
        smoke.verify_web_identity(request, '1.2.3', 'a'*64)
        for key, value in [('appVersion','0.0.1'),('sourceSha256','b'*64),('appFingerprint','anywork-ffffffffffffffff')]:
            before = manifest[key]; manifest[key] = value
            with self.assertRaises(RuntimeError): smoke.verify_web_identity(request, '1.2.3', 'a'*64)
            manifest[key] = before
        assets['/assets/current.js'] = b'arbitrary stale JavaScript'
        with self.assertRaisesRegex(RuntimeError, 'file differs'): smoke.verify_web_identity(request, '1.2.3', 'a'*64)

    def test_missing_identity_or_pwa_metadata_and_stale_index_are_rejected(self):
        assets, manifest, request = self.identity_fixture()
        with self.assertRaises((ValueError, RuntimeError)):
            smoke.verify_web_identity(lambda path:b'<script src="/assets/stale.js"></script>', '1.2.3', 'a'*64)
        for html in (b'<script src="/assets/current.js"></script>',
                     b'<meta name="app-version" content="anywork-ffffffffffffffff"><script src="/assets/current.js"></script>'):
            assets['/index.html'] = html
            manifest['files']['/index.html'] = hashlib.sha256(html).hexdigest()
            with self.assertRaisesRegex(RuntimeError, 'entrypoint'): smoke.verify_web_identity(request, '1.2.3', 'a'*64)

    def test_web_identity_generation_binds_source_and_hashes_files(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); dist = base/'dist'; (dist/'assets').mkdir(parents=True)
            (dist/'index.html').write_text('<meta name="app-version" content="anywork-0123456789abcdef"><script src="/assets/current.js"></script>')
            (dist/'assets/current.js').write_text('current')
            archive = base/'source.tar.gz'; archive.write_bytes(b'reviewed source')
            result = subprocess.run(['node',str(ROOT/'scripts/container-web-identity.mjs'),str(dist),str(archive)],capture_output=True,timeout=10)
            self.assertEqual(result.returncode, 0)
            manifest = json.loads((dist/'build-identity.json').read_text())
            version = json.loads((ROOT/'package.json').read_text())['version']
            self.assertEqual(manifest['appVersion'], version)
            self.assertEqual(manifest['sourceSha256'], hashlib.sha256(archive.read_bytes()).hexdigest())
            smoke.verify_web_identity(lambda path:(dist/('index.html' if path=='/' else path[1:])).read_bytes(),version,manifest['sourceSha256'])

    def test_partial_volume_failure_still_cleans_owned_resources(self):
        calls=[]
        def docker(*args, **kwargs):
            calls.append(args)
            if args == ('volume','create','unique-workspace'): raise RuntimeError('partial setup failure')
            return ''
        with patch.object(smoke,'docker',docker), patch.object(smoke,'cleanup_docker') as cleanup:
            with self.assertRaisesRegex(RuntimeError,'partial setup'):
                smoke.acceptance('image','unique',Path('/fixture'),'1.2.3','a'*64)
            self.assertEqual(cleanup.call_args_list[-2].args, ('volume','rm','unique-data'))
            self.assertEqual(cleanup.call_args_list[-1].args, ('volume','rm','unique-workspace'))
            self.assertNotIn(('volume','create','unique-codex'),calls)

    def test_build_failure_keeps_bounded_scrubbed_diagnostics_only(self):
        with tempfile.TemporaryDirectory() as directory:
            def failed_run(command, **kwargs):
                kwargs['stdout'].write(b'x'*100000 + b'\nerror: expected build failure\nAuthorization: Bearer fixture-private\nhttps://example.invalid/?token=fixture-private\n')
                return subprocess.CompletedProcess(command,1)
            with patch.object(smoke,'ROOT',Path(directory)), patch.object(smoke.subprocess,'run',failed_run), contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaisesRegex(RuntimeError,'diagnostics'): smoke.docker('build','--no-cache','.')
            evidence = (Path(directory)/'artifacts/container-build-diagnostics.log').read_text()
            self.assertLessEqual(len(evidence),8192)
            self.assertIn('expected build failure', evidence)
            self.assertNotIn('fixture-private', evidence)
            self.assertNotIn('fixture-private', output.getvalue())

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
