#!/usr/bin/env python3
"""Offline regression tests for the release authorization boundary."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_gate', ROOT / 'scripts/check-release-ci.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = 'a' * 40
REPO = 'owner/project'


def run(**changes):
    value = dict(id=10, workflow_id=7, head_sha=SHA, head_branch='main', event='push',
                 repository={'full_name': REPO}, head_repository={'full_name': REPO},
                 path='.github/workflows/ci.yml', status='completed', conclusion='success')
    value.update(changes)
    return value


class Clock:
    value = 0
    def now(self): return self.value
    def sleep(self, seconds): self.value += seconds


class API:
    def __init__(self, batches, workflow=None):
        self.batches, self.calls = batches, []
        self.workflow = workflow or dict(id=7, path=gate.WORKFLOW, state='active')
    def get(self, path, deadline):
        self.calls.append(path)
        if path == 'actions/workflows/ci.yml': return self.workflow
        return {'workflow_runs': copy.deepcopy(self.batches.pop(0) if len(self.batches) > 1 else self.batches[0])}


class ReleaseGate(unittest.TestCase):
    def check(self, batches, workflow=None):
        clock = Clock()
        api = API(batches, workflow)
        with contextlib.redirect_stdout(io.StringIO()):
            result = gate.check(REPO, SHA, api, 3, 1, clock.now, clock.sleep)
        return result, api

    def test_trusted_push_dispatch_and_success_reuse(self):
        for event in ('push', 'workflow_dispatch'):
            result, _ = self.check([[run(event=event), run(id=11, conclusion='failure')]])
            self.assertEqual(result['run_id'], 10)

    def test_eventual_success(self):
        result, api = self.check([[], [run(status='in_progress', conclusion=None)], [run()]])
        self.assertEqual(result['sha'], SHA)
        self.assertEqual(len(api.calls), 4)

    def test_missing_or_untrusted_runs_time_out(self):
        changes = [dict(head_sha='b'*40), dict(event='pull_request'), dict(event='pull_request_target'),
                   dict(head_branch='feature'), dict(workflow_id=8), dict(path='.github/workflows/other.yml'),
                   dict(repository={'full_name':'fork/project'}), dict(head_repository={'full_name':'fork/project'}),
                   dict(repository=None), dict(head_repository=[]), dict(id='secret'), dict(id=True)]
        for change in changes:
            with self.subTest(change=change), self.assertRaisesRegex(gate.GateError, 'Timed out.*https://github.com/'):
                self.check([[run(**change)]])
        with self.assertRaisesRegex(gate.GateError, 'Timed out'): self.check([[]])

    def test_failure_cancellation_and_non_success_fail_closed(self):
        for conclusion in ('failure', 'cancelled', 'timed_out', 'neutral', 'skipped', 'action_required', None):
            with self.subTest(conclusion=conclusion), self.assertRaisesRegex(gate.GateError, 'no release is authorized.*actions/runs/10'):
                self.check([[run(conclusion=conclusion)]])

    def test_workflow_identity_is_required(self):
        for change in (dict(id=True), dict(id=0), dict(path='other'), dict(state='disabled_manually')):
            workflow = dict(id=7, path=gate.WORKFLOW, state='active', **{})
            workflow.update(change)
            with self.assertRaisesRegex(gate.GateError, 'workflow identity'): self.check([[run()]], workflow)

    def test_pagination_and_malformed_results(self):
        result, api = self.check([[run(event='pull_request')]*100, [run()]])
        self.assertEqual(result['run_id'], 10)
        self.assertIn('page=2', api.calls[-1])
        with self.assertRaises(gate.GateError): self.check([[run(event='pull_request')]*100])

    def test_readonly_transport_retries_and_redacts(self):
        clock = Clock()
        client = gate.GitHub(REPO, 'synthetic-secret', clock.now, clock.sleep)
        class Opener:
            requests = []
            def open(self, request, timeout):
                self.requests.append(request)
                raise urllib.error.HTTPError(request.full_url, 503, 'synthetic-secret', {}, None)
        client.opener = Opener()
        with self.assertRaises(gate.GateError) as caught: client.get('actions/workflows/ci.yml', 20)
        self.assertNotIn('synthetic-secret', str(caught.exception))
        self.assertEqual(len(client.opener.requests), 3)
        self.assertTrue(all(request.get_method() == 'GET' for request in client.opener.requests))
        self.assertIsNone(gate.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.invalid/'))
        for token in ('', 'token\nsecret', 'é'):
            with self.assertRaisesRegex(gate.GateError, '^A valid GitHub token is required$'): gate.GitHub(REPO, token)

    def test_workflow_entrypoints_cannot_bypass(self):
        release = (ROOT / '.github/workflows/release.yml').read_text()
        self.assertEqual(release.count('python3 scripts/check-release-ci.py'), 2)
        self.assertLess(release.index('check-release-ci.py --sha "$RELEASE_COMMIT"'), release.index('gh release create'))
        legacy = (ROOT / '.github/workflows/prepare-release.yml').read_text()
        self.assertIn('permissions: {}', legacy)
        for mutation in ('git push', 'gh workflow run', 'bump-version.py', 'actions/checkout'):
            self.assertNotIn(mutation, legacy)
        ci = (ROOT / '.github/workflows/ci.yml').read_text()
        self.assertNotIn('paths-ignore:', ci)
        self.assertIn('container-smoke-test.py --build', ci)
        docker = (ROOT / 'Dockerfile').read_text()
        self.assertIn('cargo build --locked --release -p anywork', docker)
        self.assertIn('ARG CODEX_VERSION=0.164.0', docker)


if __name__ == '__main__': unittest.main()
