#!/usr/bin/env python3
"""Deployment recovery acceptance: actual CLI main, private temp state, fake Vercel.

No real provider mutations, deploys, credentials, paid actions or OAuth refreshes.
"""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.parse
import uuid
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy_grid', Path(__file__).with_name('deploy-cybergrid.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state_file = self.root / 'state.json'
        self.redis_file = self.root / 'redis.json'
        self.auth_file = self.root / 'auth.json'
        self.initial = {
            'vercelGridProject': 'prj_fixture',
            'gridResource': {'indicator': 'https://grid.example/api'}, 'userRole': {'id': 'role'},
            'logtoTenant': {'tag': 'development', 'defaultApplication': {'id': 'm2m', 'secret': 'private-m2m-fixture'}},
            'tenantEndpoint': 'https://tenant.example', 'spaApplication': {'id': 'spa'},
        }
        deploy.cloud.save_private(self.state_file, self.initial)
        deploy.cloud.save_private(self.redis_file, {'upstashDatabase': {
            'tls': True, 'eviction': False, 'endpoint': 'redis.example', 'rest_token': 'private-redis-fixture'}})
        deploy.cloud.save_private(self.auth_file, {'token': 'private-vercel-fixture'})
        self.argv = ['deploy', '--state', str(self.state_file), '--redis-state', str(self.redis_file),
                     '--vercel-auth', str(self.auth_file), '--project', 'anywork-fixture',
                     '--prefix', 'anywork:acceptance', '--grid-origin', 'https://grid.example',
                     '--frontend-origin', 'https://site.example']
        self.requests, self.deployments = [], []
        self.lose_response = False

    def read(self):
        return json.loads(self.state_file.read_text())

    def provider(self, url, method='GET', data=None, authorization=None, form=False):
        path = urllib.parse.urlsplit(url).path
        self.requests.append((method, path, copy.deepcopy(data)))
        if method == 'GET' and path == '/v9/projects/prj_fixture':
            return {'id': 'prj_fixture', 'name': 'anywork-fixture'}
        if method == 'POST' and path.endswith('/env'):
            # Durability is checked against the disk, not the in-memory intent.
            self.assertEqual(self.read()['gridDeploymentIntent']['phase'], 'prepared')
            return {'envs': []}
        if method == 'POST' and path == '/v13/deployments':
            intent = self.read()['gridDeploymentIntent']
            self.assertEqual(intent['phase'], 'submitting')
            self.assertEqual(data['meta']['anyworkOperation'], intent['operationId'])
            self.assertNotIn('private-', json.dumps(intent))
            self.assertNotIn('private-', json.dumps(data['meta']))
            row = {'id': 'dpl_' + str(len(self.deployments) + 1), 'uid': 'dpl_' + str(len(self.deployments) + 1),
                   'projectId': data['project'], 'gitSource': data['gitSource'], 'meta': data['meta'],
                   'readyState': 'READY', 'url': 'fixture.vercel.app'}
            self.deployments.append(copy.deepcopy(row))
            if self.lose_response:
                self.lose_response = False
                raise deploy.cloud.ConfigurationError('Unknown mutation outcome')
            return row
        if method == 'GET' and path == '/v6/deployments':
            return {'deployments': copy.deepcopy(self.deployments), 'pagination': {'next': None}}
        if method == 'GET' and path.startswith('/v13/deployments/'):
            row = next(x for x in self.deployments if x['id'] == path.split('/')[-1])
            return copy.deepcopy(row)
        raise AssertionError('Unexpected provider call: ' + method + ' ' + path)

    def run_cli(self, extra=None, save=None):
        with patch.object(sys, 'argv', self.argv + (extra or [])), patch.object(deploy.cloud, 'request', self.provider), contextlib.redirect_stdout(io.StringIO()):
            if save:
                with patch.object(deploy.cloud, 'save_private', save):
                    deploy.main()
            else:
                deploy.main()

    def counts(self):
        return (sum(m == 'POST' and p == '/v13/deployments' for m, p, _ in self.requests),
                sum(m == 'POST' and p.endswith('/env') for m, p, _ in self.requests))

    def test_completed_and_inprogress_replay_reuses_id_without_mutations(self):
        self.run_cli()
        self.run_cli()
        self.assertEqual(self.counts(), (1, 1))
        self.deployments[0]['readyState'] = 'BUILDING'
        self.run_cli()
        self.assertEqual(self.counts(), (1, 1))
        self.assertEqual(self.read()['gridDeployment']['readyState'], 'BUILDING')

    def test_lost_post_response_reconciles_matching_inventory(self):
        self.lose_response = True
        with self.assertRaises(deploy.cloud.ConfigurationError):
            self.run_cli()
        self.assertEqual(self.read()['gridDeploymentIntent']['phase'], 'submitting')
        self.run_cli()
        self.run_cli()
        self.assertEqual(self.counts(), (1, 1))
        self.assertEqual(self.read()['gridDeployment']['id'], 'dpl_1')

    def test_crash_during_response_state_save_reconciles_without_second_post(self):
        real_save = deploy.cloud.save_private
        def fail_after_post(path, state):
            if self.deployments and state['gridDeploymentIntent']['phase'] == 'observed':
                raise OSError('simulated crash before atomic replace')
            real_save(path, state)
        with self.assertRaises(OSError):
            self.run_cli(save=fail_after_post)
        self.assertEqual(self.read()['gridDeploymentIntent']['phase'], 'submitting')
        self.run_cli()
        self.assertEqual(self.counts(), (1, 1))

    def test_failed_intent_save_prevents_any_environment_or_deployment_mutation(self):
        with self.assertRaises(OSError):
            self.run_cli(save=lambda *_: (_ for _ in ()).throw(OSError('disk full')))
        self.assertEqual(self.counts(), (0, 0))

    def test_crash_before_post_with_submitting_intent_stops_instead_of_guessing(self):
        real_save = deploy.cloud.save_private
        def crash_before_post(path, state):
            real_save(path, state)
            if state['gridDeploymentIntent']['phase'] == 'submitting':
                raise OSError('crash before HTTP submission')
        with self.assertRaises(OSError):
            self.run_cli(save=crash_before_post)
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'unresolved or ambiguous'):
            self.run_cli()
        self.assertEqual(self.counts(), (0, 1))

    def test_changed_configuration_and_credential_rotation_fail_without_mutation(self):
        self.run_cli()
        for value in ('new:namespace',):
            argv = list(self.argv)
            self.argv[self.argv.index('--prefix') + 1] = value
            with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'configuration changed'):
                self.run_cli()
            self.argv = argv
        db = json.loads(self.redis_file.read_text())
        db['upstashDatabase']['rest_token'] = 'different-private-credential'
        deploy.cloud.save_private(self.redis_file, db)
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'configuration changed'):
            self.run_cli()
        self.assertEqual(self.counts(), (1, 1))

    def test_ambiguous_inventory_never_submits_again_even_with_new_redeploy_id(self):
        self.lose_response = True
        with self.assertRaises(deploy.cloud.ConfigurationError):
            self.run_cli()
        duplicate = copy.deepcopy(self.deployments[0])
        duplicate.update(id='dpl_duplicate', uid='dpl_duplicate')
        self.deployments.append(duplicate)
        for extra in ([], ['--redeploy', str(uuid.uuid4())]):
            with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'unresolved or ambiguous'):
                self.run_cli(extra)
        self.assertEqual(self.counts(), (1, 1))

    def test_wrong_provider_identity_and_project_are_rejected(self):
        self.run_cli()
        for field, value in [('projectId', 'other'), ('gitSource', {'ref': '0' * 40}), ('meta', {})]:
            original = copy.deepcopy(self.deployments[0])
            self.deployments[0][field] = value
            with self.assertRaises(deploy.cloud.ConfigurationError):
                self.run_cli()
            self.deployments[0] = original
        self.assertEqual(self.counts(), (1, 1))

    def test_deliberate_redeploy_uses_stable_uuid_and_replays_only_once(self):
        self.run_cli()
        operation = str(uuid.uuid4())
        extra = ['--redeploy', operation]
        self.run_cli(extra)
        self.run_cli(extra)
        self.run_cli()
        self.assertEqual(self.counts(), (2, 2))
        self.assertEqual(self.read()['gridDeploymentIntent']['operationId'], operation)
        self.assertEqual(len(self.read()['gridDeploymentHistory']), 1)

    def test_changed_configuration_can_only_start_as_explicit_new_operation(self):
        self.run_cli()
        old_hash = self.read()['gridDeploymentIntent']['identity']['configHash']
        self.argv[self.argv.index('--prefix') + 1] = 'anywork:changed'
        operation = str(uuid.uuid4())
        self.run_cli(['--redeploy', operation])
        self.run_cli(['--redeploy', operation])
        self.assertEqual(self.counts(), (2, 2))
        current = self.read()
        self.assertNotEqual(current['gridDeploymentIntent']['identity']['configHash'], old_hash)
        self.assertEqual(current['gridEnvironment']['CYBERGRID_REDIS_PREFIX'], 'anywork:changed')

    def test_unknown_outcome_finds_a_match_on_later_inventory_page(self):
        self.lose_response = True
        with self.assertRaises(deploy.cloud.ConfigurationError):
            self.run_cli()
        original = self.provider
        def paginated(url, *args, **kwargs):
            parsed = urllib.parse.urlsplit(url)
            if parsed.path == '/v6/deployments' and 'until=' not in parsed.query:
                return {'deployments': [], 'pagination': {'next': 123}}
            return original(url, *args, **kwargs)
        self.provider = paginated
        self.run_cli()
        self.assertEqual(self.counts(), (1, 1))

    def test_unknown_outcome_conflicting_operation_metadata_fails_without_post(self):
        self.lose_response = True
        with self.assertRaises(deploy.cloud.ConfigurationError):
            self.run_cli()
        self.deployments[0]['meta']['anyworkConfiguration'] = 'different'
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'conflicting'):
            self.run_cli()
        self.assertEqual(self.counts(), (1, 1))

    def test_explicit_redeploy_cannot_bypass_previous_inprogress_operation(self):
        self.run_cli()
        self.deployments[0]['readyState'] = 'BUILDING'
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'still in progress'):
            self.run_cli(['--redeploy', str(uuid.uuid4())])
        self.assertEqual(self.counts(), (1, 1))

    def test_failed_deployment_requires_explicit_new_operation(self):
        self.run_cli()
        self.deployments[0]['readyState'] = 'ERROR'
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'unsuccessfully'):
            self.run_cli()
        self.assertEqual(self.counts(), (1, 1))
        self.run_cli(['--redeploy', str(uuid.uuid4())])
        self.assertEqual(self.counts(), (2, 2))

    def test_legacy_saved_identity_is_adopted_but_missing_provenance_fails(self):
        self.run_cli()
        state = self.read()
        state.pop('gridDeploymentIntent')
        deploy.cloud.save_private(self.state_file, state)
        self.run_cli()
        self.assertEqual(self.counts(), (1, 1))
        state = self.read()
        state.pop('gridDeploymentIntent')
        state.pop('gridSource')
        deploy.cloud.save_private(self.state_file, state)
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, 'Legacy deployment'):
            self.run_cli()
        self.assertEqual(self.counts(), (1, 1))

    def test_prefix_80_accepted_81_rejected_before_any_provider_access(self):
        self.argv[self.argv.index('--prefix') + 1] = 'a' * 80
        self.run_cli()
        self.assertEqual(self.counts(), (1, 1))
        self.requests.clear()
        self.argv[self.argv.index('--prefix') + 1] = 'a' * 81
        with self.assertRaisesRegex(deploy.cloud.ConfigurationError, '1–80'):
            self.run_cli()
        self.assertEqual(self.requests, [])

    def test_invalid_redeploy_uuid_is_rejected_before_provider_access(self):
        with self.assertRaises(deploy.cloud.ConfigurationError):
            self.run_cli(['--redeploy', 'invalid'])
        self.assertEqual(self.requests, [])


class ReleaseCallChain(unittest.TestCase):
    def test_normal_release_dispatches_vercel_and_pages_is_manual_only(self):
        root = Path(__file__).resolve().parents[2]
        release = (root / '.github/workflows/release.yml').read_text()
        self.assertIn('gh workflow run vercel.yml --ref main', release)
        self.assertNotIn('gh workflow run pages.yml', release)
        pages = (root / '.github/workflows/pages.yml').read_text()
        triggers = pages.split('on:', 1)[1].split('permissions:', 1)[0]
        self.assertIn('workflow_dispatch:', triggers)
        self.assertNotIn('push:', triggers)
        self.assertNotIn('release:', triggers)


if __name__ == '__main__':
    unittest.main(verbosity=2)
