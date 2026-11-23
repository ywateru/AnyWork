#!/usr/bin/env python3
"""Offline CyberBus deployment config/CSP checks; no credentials or network."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

DIRECTORY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    'prepare_frontend', DIRECTORY / 'prepare-frontend.py'
)
frontend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontend)


class FrontendDeployment(unittest.TestCase):
    def setUp(self):
        self.values = {
            'VITE_LOGTO_ENDPOINT': 'https://identity.example.invalid',
            'VITE_LOGTO_APP_ID': 'web',
            'VITE_LOGTO_RESOURCE': 'https://bus.example.invalid/api',
            'VITE_CYBERBUS_PRODUCT_ID': 'anywork',
            'VITE_CYBERBUS_BOOTSTRAP_PEERS': 'wss://relay.example.invalid/',
            'VITE_CYBERBUS_EASYTIER_URL': '/easytier-browser.js',
        }
        self.config = json.loads((frontend.ROOT / 'vercel.json').read_text())

    def test_no_external_rewrites_and_no_legacy_cybergrid_routes(self):
        external = [
            rule
            for rule in self.config['rewrites']
            if not rule['destination'].startswith('/')
        ]
        self.assertEqual(external, [])
        self.assertEqual(
            self.config['rewrites'],
            [
                {'source': '/app/callback', 'destination': '/app/index.html'},
                {'source': '/app', 'destination': '/app/index.html'},
                {'source': '/app/', 'destination': '/app/index.html'},
                {'source': '/source', 'destination': '/anywork-source.tar.gz'},
                {
                    'source': '/corresponding-source',
                    'destination': '/corresponding-source.tar.gz',
                },
            ],
        )
        self.assertFalse(self.config.get('redirects'))
        disabled = {'authorization', 'cookie', 'set-cookie', 'access-control-allow-origin'}
        names = {
            header['key'].lower()
            for rule in self.config['headers']
            for header in rule['headers']
        }
        self.assertFalse(names & disabled)

    def test_self_hosted_csp_is_derived_without_legacy_origins(self):
        result = frontend.bind(copy.deepcopy(self.config), self.values)
        self.assertEqual(
            result, frontend.bind(copy.deepcopy(result), self.values, check=True)
        )
        content = next(
            header['value']
            for rule in result['headers']
            if rule['source'] == '/(.*)'
            for header in rule['headers']
            if header['key'] == 'Content-Security-Policy'
        )
        for expected in (
            'https://identity.example.invalid',
            'https://bus.example.invalid',
            'wss://relay.example.invalid',
            "'wasm-unsafe-eval'",
        ):
            self.assertIn(expected, content)
        for legacy in ('logto.app', 'cybergrid', 'trycloudflare', "'unsafe-eval'"):
            self.assertNotIn(legacy, content)
        self.assertIn("object-src 'none'", content)
        self.assertIn("frame-ancestors 'none'", content)
        self.assertEqual(result['rewrites'], self.config['rewrites'])

    def test_stale_and_ambiguous_headers_reject_before_assembly(self):
        with self.assertRaises(frontend.ConfigurationError):
            frontend.bind(copy.deepcopy(self.config), self.values, check=True)
        duplicate = copy.deepcopy(self.config)
        duplicate['headers'].append(copy.deepcopy(duplicate['headers'][0]))
        with self.assertRaises(frontend.ConfigurationError):
            frontend.bind(duplicate, self.values)
        with self.assertRaises(frontend.ConfigurationError):
            frontend.bind({'headers': []}, self.values)

    def test_partial_config_and_injected_values_fail_before_write(self):
        for key in self.values:
            with self.subTest(key=key), self.assertRaises(
                frontend.ConfigurationError
            ):
                frontend.bind(
                    copy.deepcopy(self.config),
                    {k: v for k, v in self.values.items() if k != key},
                )
        for key, bad in (
            ('VITE_LOGTO_ENDPOINT', 'http://identity.invalid'),
            ('VITE_LOGTO_ENDPOINT', 'https://identity.invalid/oidc'),
            ('VITE_LOGTO_ENDPOINT', 'https://identity.invalid;script-src'),
            ('VITE_LOGTO_RESOURCE', 'https://bus.invalid/api?token=secret'),
            ('VITE_CYBERBUS_BOOTSTRAP_PEERS', 'wss://relay.invalid/#fragment'),
            ('VITE_CYBERBUS_BOOTSTRAP_PEERS', 'ws://relay.invalid/'),
            ('VITE_CYBERBUS_EASYTIER_URL', 'https://cdn.invalid/easytier.js'),
            ('VITE_CYBERBUS_EASYTIER_URL', '/../easytier.js'),
            ('VITE_CYBERBUS_PRODUCT_ID', 'bad product'),
        ):
            with self.subTest(bad=bad), self.assertRaises(
                frontend.ConfigurationError
            ):
                frontend.bind(copy.deepcopy(self.config), {**self.values, key: bad})

    def test_cli_failure_does_not_print_submitted_values(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith('VITE_')}
        env['VITE_LOGTO_ENDPOINT'] = 'https://private-submitted-value.invalid'
        result = subprocess.run(
            [sys.executable, str(DIRECTORY / 'prepare-frontend.py'), '--check'],
            capture_output=True,
            env=env,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(env['VITE_LOGTO_ENDPOINT'], result.stdout + result.stderr)
        self.assertNotIn('Traceback', result.stdout + result.stderr)

    def test_real_cli_prepares_checks_and_keeps_rewrites(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            scripts = root / 'scripts/cloud'
            scripts.mkdir(parents=True)
            shutil.copy2(DIRECTORY / 'prepare-frontend.py', scripts)
            target = root / 'vercel.json'
            target.write_text(json.dumps(self.config))
            env = {k: v for k, v in os.environ.items() if not k.startswith('VITE_')}
            env.update(self.values)
            command = [sys.executable, str(scripts / 'prepare-frontend.py')]
            for args in ([], ['--check'], []):
                result = subprocess.run(
                    command + args, capture_output=True, env=env, text=True
                )
                self.assertEqual(result.returncode, 0, result.stderr)
            prepared = target.read_bytes()
            config = json.loads(prepared)
            self.assertEqual(config['rewrites'], self.config['rewrites'])
            self.assertEqual(config['headers'][1:], self.config['headers'][1:])
            env.pop('VITE_CYBERBUS_EASYTIER_URL')
            result = subprocess.run(command, capture_output=True, env=env, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(target.read_bytes(), prepared)

    def test_workflow_and_assembly_use_the_cyberbus_binder(self):
        workflow = (frontend.ROOT / '.github/workflows/vercel.yml').read_text()
        for key in self.values:
            self.assertIn(key, workflow)
        self.assertNotIn('VITE_CYBERGRID', workflow)
        self.assertLess(
            workflow.index('scripts/cloud/prepare-frontend.py'),
            workflow.index('run: vercel build'),
        )
        assembly = (frontend.ROOT / 'scripts/assemble-vercel.py').read_text()
        self.assertIn("'scripts/cloud/prepare-frontend.py', '--check'", assembly)


if __name__ == '__main__':
    unittest.main()
