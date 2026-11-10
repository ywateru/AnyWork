#!/usr/bin/env python3
"""Offline deployment config/CSP checks; no credentials or network calls."""
import copy
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

DIRECTORY = Path(__file__).resolve().parent
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location('prepare_frontend', DIRECTORY / 'prepare-frontend.py')
frontend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontend)


class FrontendDeployment(unittest.TestCase):
    def setUp(self):
        self.values = {'VITE_LOGTO_ENDPOINT': 'https://identity.example.invalid', 'VITE_LOGTO_APP_ID': 'web',
                       'VITE_LOGTO_RESOURCE': 'https://grid.example.invalid/api',
                       'VITE_CYBERGRID_URL': 'https://grid.example.invalid', 'VITE_CYBERGRID_NATIVE_APP_ID': 'native'}
        self.config = json.loads((frontend.ROOT / 'vercel.json').read_text())

    def test_self_hosted_csp_is_derived_without_broadening_or_retaining_cloud_origins(self):
        result = frontend.bind(copy.deepcopy(self.config), self.values)
        self.assertEqual(result, frontend.bind(copy.deepcopy(result), self.values, check=True))
        content = json.dumps(result)
        self.assertIn('https://identity.example.invalid', content)
        self.assertIn('https://grid.example.invalid', content)
        self.assertNotIn('logto.app', content)
        self.assertNotIn('anywork-cybergrid', content)
        self.assertNotIn("connect-src https:", content)
        self.assertIn("object-src 'none'", content)
        self.assertIn("frame-ancestors 'none'", content)
        self.assertEqual(result['rewrites'], self.config['rewrites'])
        self.assertEqual(result['buildCommand'], self.config['buildCommand'])

    def test_stale_and_ambiguous_headers_reject_before_assembly(self):
        with self.assertRaises(frontend.ConfigurationError):
            frontend.bind(copy.deepcopy(self.config), self.values, check=True)
        duplicate = copy.deepcopy(self.config)
        duplicate['headers'].append(copy.deepcopy(duplicate['headers'][0]))
        with self.assertRaises(frontend.ConfigurationError):
            frontend.bind(duplicate, self.values)
        with self.assertRaises(frontend.ConfigurationError):
            frontend.bind({'headers': []}, self.values)

    def test_partial_config_and_injected_origin_fail_before_config_write(self):
        for key in self.values:
            with self.subTest(key=key), self.assertRaises(frontend.ConfigurationError):
                frontend.bind(copy.deepcopy(self.config), {k: v for k, v in self.values.items() if k != key})
        for value in ['https://name:secret@identity.invalid', 'https://identity.invalid/;x',
                      'https://identity.invalid;script-src', 'https://identity.invalid\n', 'http://identity.invalid']:
            with self.subTest(value=value), self.assertRaises(frontend.ConfigurationError):
                frontend.bind(copy.deepcopy(self.config), {**self.values, 'VITE_LOGTO_ENDPOINT': value})

    def test_cli_failure_does_not_print_submitted_values(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith('VITE_')}
        env['VITE_LOGTO_ENDPOINT'] = 'https://private-submitted-value.invalid'
        result = subprocess.run([sys.executable, str(DIRECTORY / 'prepare-frontend.py'), '--check'],
                                capture_output=True, env=env, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(env['VITE_LOGTO_ENDPOINT'], result.stdout + result.stderr)
        self.assertNotIn('Traceback', result.stdout + result.stderr)

    def test_real_cli_prepares_checks_and_does_not_write_on_incomplete_config(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            scripts = root / 'scripts/cloud'
            scripts.mkdir(parents=True)
            for name in ('prepare-frontend.py', 'configure.py'):
                shutil.copy2(DIRECTORY / name, scripts / name)
            target = root / 'vercel.json'
            target.write_text(json.dumps(self.config))
            env = {k: v for k, v in os.environ.items() if not k.startswith('VITE_')}
            env.update(self.values)
            command = [sys.executable, str(scripts / 'prepare-frontend.py')]
            for args in ([], ['--check'], []):
                result = subprocess.run(command + args, capture_output=True, env=env, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            prepared = target.read_bytes()
            env.pop('VITE_CYBERGRID_NATIVE_APP_ID')
            result = subprocess.run(command, capture_output=True, env=env, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(target.read_bytes(), prepared)

    def test_prepare_and_assembly_offer_immutable_head_source_with_generated_csp(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('scripts/cloud/prepare-frontend.py', 'scripts/cloud/configure.py',
                         'scripts/assemble-vercel.py', 'scripts/source-archive.py', 'vercel.json'):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(frontend.ROOT / name, path)
            (root / 'package.json').write_text('{"version":"0.0.0"}')
            (root / '.env').write_text('private fixture')
            (root / 'public-script.sh').write_text('echo committed')
            (root / 'public-script.sh').chmod(0o755)
            def git(*args):
                return subprocess.check_output(['git', '-C', str(root), *args])
            git('init', '-q')
            git('add', '.')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'source')
            revision = git('rev-parse', 'HEAD').decode().strip()
            for name in ('site/dist/en/index.html', 'web/dist/index.html'):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('<html>fixture</html>')
            images = {}
            for name in ('codex-light.png', 'codex-dark.png', 'deepseek-harness-light.svg',
                         'deepseek-harness-dark.svg', 'workbuddy.svg'):
                image = root / 'web/dist/agents' / name
                image.parent.mkdir(parents=True, exist_ok=True)
                images[name] = (frontend.ROOT / 'web/public/agents' / name).read_bytes()
                image.write_bytes(images[name])
            (root / 'site/dist/agents').mkdir(parents=True)
            (root / 'site/dist/agents/stale.png').write_bytes(b'stale previous deployment')
            env = {k: v for k, v in os.environ.items() if not k.startswith('VITE_')}
            env.update(self.values)
            env['SOURCE_COMMIT'] = revision
            env.pop('VERCEL_GIT_COMMIT_SHA', None)
            for script in ('scripts/cloud/prepare-frontend.py', 'scripts/assemble-vercel.py'):
                result = subprocess.run([sys.executable, str(root / script)], cwd=root, env=env,
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotEqual((root / 'vercel.json').read_bytes(), git('show', revision + ':vercel.json'))
            self.assertIn(self.values['VITE_LOGTO_ENDPOINT'], (root / 'vercel.json').read_text())
            identity = json.loads((root / 'site/dist/build.json').read_text())
            self.assertEqual(identity['source'], revision)
            self.assertFalse((root / 'site/dist/agents/stale.png').exists())
            for name, expected in images.items():
                for prefix in ('agents', 'app/agents'):
                    self.assertEqual((root / 'site/dist' / prefix / name).read_bytes(), expected)
            with tarfile.open(root / 'site/dist/anywork-source.tar.gz') as archive:
                self.assertNotIn('anywork/.env', archive.getnames())
                for member in archive:
                    if member.name == 'anywork/SOURCE_MANIFEST.json':
                        continue
                    relative = member.name.removeprefix('anywork/')
                    self.assertEqual(archive.extractfile(member).read(), git('show', revision + ':' + relative))
                self.assertEqual(archive.getmember('anywork/public-script.sh').mode, 0o755)

    def test_workflow_uses_explicit_config_and_development_compatible_acceptance(self):
        workflow = (frontend.ROOT / '.github/workflows/vercel.yml').read_text()
        self.assertIn('vars.ANYWORK_ACCOUNT_READY', workflow)
        self.assertNotIn('ANYWORK_PRODUCTION_READY', workflow)
        self.assertIn("VITE_ACCOUNT_PORTAL_URL: ${{ vars.VITE_ACCOUNT_PORTAL_URL || 'https://anywork-tau.vercel.app/app/' }}", workflow)
        for key in self.values:
            self.assertIn(key + ': ${{ vars.' + key + ' }}', workflow)
        self.assertLess(workflow.index('scripts/cloud/prepare-frontend.py'), workflow.index('run: vercel build'))
        assembly = (frontend.ROOT / 'scripts/assemble-vercel.py').read_text()
        self.assertIn("'scripts/cloud/prepare-frontend.py', '--check'", assembly)


if __name__ == '__main__':
    unittest.main()
