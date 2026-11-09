#!/usr/bin/env python3
"""Offline pinned-directory/prebuilt source, privacy, and recovery contracts."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy-cybergrid.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class PrebuiltContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.upload = self.root / 'upload'
        self.output = self.upload / '.vercel/output'
        (self.output / 'functions/index.func').mkdir(parents=True)
        (self.output / 'config.json').write_text(json.dumps({'version': 3}))
        (self.output / 'functions/index.func/index.js').write_text('module.exports = () => null;')
        (self.output / 'builds.json').write_text(json.dumps({'target': 'production'}))
        (self.upload / '.vercel/project.json').write_text(json.dumps({'projectId': 'project', 'orgId': deploy.TEAM}))
        patch_file = self.root / 'pinned-directory.patch'
        patch_file.write_text('reviewed fixture patch\n')
        self.provenance = self.root / 'provenance.json'
        self.provenance.write_text(json.dumps({'upstreamRepository': 'https://github.com/ywateru/CyberGrid',
                                               'upstreamCommit': deploy.PIN, 'adaptedCommit': 'a' * 40,
                                               'patch': patch_file.name,
                                               'patchSha256': hashlib.sha256(patch_file.read_bytes()).hexdigest()}))

    def identity(self, forbidden=()):
        return deploy.prebuilt_identity(self.upload, self.provenance, 'a' * 40, 'project', forbidden)

    def test_source_patch_artifact_and_project_are_bound(self):
        first = self.identity()
        self.assertEqual(first['sourceKind'], 'prebuilt')
        self.assertEqual(first['upstreamSource'], deploy.PIN)
        (self.output / 'functions/index.func/index.js').write_text('different content')
        self.assertNotEqual(first['outputHash'], self.identity()['outputHash'])
        (self.root / 'pinned-directory.patch').write_text('unreviewed change')
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'patch digest'):
            self.identity()

    def test_wrong_source_and_binding_are_rejected(self):
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'provenance'):
            deploy.prebuilt_identity(self.upload, self.provenance, 'b' * 40, 'project', [])
        (self.upload / '.vercel/project.json').write_text(json.dumps({'projectId': 'another', 'orgId': deploy.TEAM}))
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'binding'):
            self.identity()

    def test_private_material_extra_files_symlinks_and_diagnostics_are_rejected(self):
        private = 'fixture-' + 'credential-value'
        code = self.output / 'functions/index.func/index.js'
        original = code.read_text()
        code.write_text(original + private)
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'credential'):
            self.identity([private])
        code.write_text(original)
        extra = self.upload / 'repository.txt'
        extra.write_text('not an upload artifact')
        with self.assertRaises(deploy.cloud.ConfigurationError):
            self.identity()
        extra.unlink()
        env_file = self.output / 'functions/index.func/.env.production.local'
        env_file.write_text('private')
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'Private build material'):
            self.identity()
        env_file.unlink()
        link = self.output / 'functions/index.func/link'
        link.symlink_to(code)
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'symlinks'):
            self.identity()

    def test_unsanitized_build_metadata_is_rejected(self):
        (self.output / 'builds.json').write_text(json.dumps({'target': 'production', 'argv': ['private']}))
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'sanitized'):
            self.identity()

    def test_cli_pin_and_metadata_are_explicit_without_credentials_in_argv(self):
        cli = self.root / 'vc.js'
        cli.write_text('fixture')
        intent = {'operationId': 'operation', 'identity': {'source': 'a' * 40, 'configHash': 'hash', **self.identity()}}
        with patch.object(deploy.subprocess, 'run', side_effect=[
            type('Result', (), {'returncode': 0, 'stdout': '50.28.0\n'})(),
            type('Result', (), {'returncode': 0})(),
        ]) as run:
            deploy.submit_prebuilt(self.upload, cli, intent)
        argv = run.call_args.args[0]
        self.assertIn('--prebuilt', argv)
        self.assertIn('--prod', argv)
        self.assertIn('anyworkSourceKind=prebuilt', argv)
        self.assertIn('anyworkUpstream=' + deploy.PIN, argv)
        self.assertFalse(any('--token' in arg for arg in argv))
        with patch.object(deploy.subprocess, 'run', return_value=type('Result', (), {'returncode': 0, 'stdout': '99.0.0'})()) as run:
            with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'version differs'):
                deploy.submit_prebuilt(self.upload, cli, intent)
            self.assertEqual(run.call_count, 1)

    def test_unknown_cli_outcome_reconciles_without_another_upload(self):
        state, stored, rows = {}, {}, []
        desired = {'source': 'a' * 40, 'projectId': 'project', 'projectName': 'fixture', 'target': 'production',
                   'namespace': 'new:selfhost', 'configHash': 'config', **self.identity()}
        def save():
            stored.clear()
            stored.update(copy.deepcopy(state))
        def provider(route, method='GET', data=None):
            if method == 'POST' and route.endswith('/env?upsert=true'):
                self.assertEqual(stored['gridDeploymentIntent']['phase'], 'prepared')
                return {}
            if route.startswith('/v6/deployments?'):
                return {'deployments': copy.deepcopy(rows), 'pagination': {'next': None}}
            if route == '/v13/deployments/deployment':
                return copy.deepcopy(rows[0])
            raise AssertionError('Unexpected provider request')
        def upload(intent):
            self.assertEqual(stored['gridDeploymentIntent']['phase'], 'submitting')
            rows.append({'id': 'deployment', 'projectId': 'project', 'target': 'production', 'readyState': 'READY',
                         'meta': deploy.metadata(intent)})
            raise deploy.cloud.ConfigurationError('Unknown CLI response')
        with self.assertRaises(deploy.cloud.ConfigurationError):
            deploy.deploy(provider, state, save, desired, {}, submit=upload)
        state = copy.deepcopy(stored)
        with patch('builtins.print'):
            result = deploy.deploy(provider, state, save, desired, {}, submit=lambda _: self.fail('Blind duplicate upload'))
        self.assertEqual(result['id'], 'deployment')
        for field, value in [('target', 'preview'), ('projectId', 'other'), ('meta', {})]:
            original = copy.deepcopy(rows[0])
            rows[0][field] = value
            with self.assertRaises(deploy.cloud.ConfigurationError):
                deploy.deploy(provider, state, save, desired, {}, submit=lambda _: self.fail('Unexpected upload'))
            rows[0] = original


if __name__ == '__main__':
    unittest.main()
