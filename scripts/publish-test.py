#!/usr/bin/env python3
"""Offline publisher acceptance: temporary Git repositories and mocked HTTP only."""
import base64
import contextlib
import io
import os
import hashlib
import importlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest
import urllib.error
from unittest import mock

publish = importlib.import_module('publish')


class Clock:
    def __init__(self): self.value = 0
    def __call__(self): return self.value
    def sleep(self, seconds): self.value += seconds


class FakeGitHub:
    token = 'private-fixture-token-never-printed'
    def __init__(self):
        self.main = None
        self.tags = {}
        self.posts = []
        self.pushed = []
        self.run_responses = {}
        self.run_calls = {}
        self.release = None
        self.payloads = {}
        self.bad_site = False
        self.ambiguous = False
        self.site_heads = 0
        self.public_calls = []

    def json(self, path, method='GET', data=None, **kwargs):
        if method == 'POST':
            self.posts.append((path, data))
            if self.ambiguous: raise publish.Failure('Ambiguous mutation')
            return None
        if path == 'git/ref/heads/main': return {'object': {'sha': self.main, 'type': 'commit'}}
        if path.startswith('git/ref/tags/'): return self.tags.get(path.split('/')[-1])
        if path.startswith('git/tags/'): return {'object': {'sha': self.main, 'type': 'commit'}}
        if path.startswith('actions/workflows/'):
            return {'id': {'ci.yml': 1, 'release.yml': 2, 'pages.yml': 3}[path.split('/')[2]]}
        if path.startswith('releases/tags/'): return self.release
        raise AssertionError('Unexpected mocked API path: ' + path)

    def list(self, path, key=None):
        if path == 'tags': return [{'name': name} for name in self.tags]
        if path == 'releases': return [self.release] if self.release else []
        if path.startswith('actions/workflows/'):
            workflow = path.split('/')[2]
            query = dict(publish.urllib.parse.parse_qsl(path.split('?')[1]))
            call = self.run_calls.get(workflow, 0)
            self.run_calls[workflow] = call + 1
            if workflow in self.run_responses:
                responses = self.run_responses[workflow]
                return responses[min(call, len(responses) - 1)]
            return [self.run(workflow, query['head_sha'], query['branch'])]
        raise AssertionError('Unexpected mocked collection: ' + path)

    @staticmethod
    def run(workflow, sha, branch, status='completed', conclusion='success', attempt=1):
        return {'id': 100 + {'ci.yml': 1, 'release.yml': 2, 'pages.yml': 3}[workflow],
                'workflow_id': {'ci.yml': 1, 'release.yml': 2, 'pages.yml': 3}[workflow],
                'head_sha': sha, 'head_branch': branch, 'status': status,
                'conclusion': conclusion, 'run_attempt': attempt,
                'html_url': publish.WEB + '/actions/runs/100', 'created_at': '2026-11-07T10:01:00Z'}

    def published(self, tag, source):
        base = publish.WEB + '/releases/download/' + tag + '/'
        signature = base64.b64encode(('untrusted comment: fixture\nabc\ntrusted comment: timestamp:1\tversion:' + tag[1:] + '\nabc\n').encode()).decode()
        payloads = {name: ('fixture-' + name).encode() for name in publish.ASSETS}
        for name in publish.TARGETS.values(): payloads[name + '.sig'] = (signature + '\n').encode()
        payloads['latest.json'] = json.dumps({'version': tag[1:], 'platforms': {
            target: {'url': base + name, 'signature': signature} for target, name in publish.TARGETS.items()}}).encode()
        payloads['SHA256SUMS'] = ''.join(hashlib.sha256(payloads[name]).hexdigest() + '  ' + name + '\n'
            for name in sorted(publish.ASSETS - {'SHA256SUMS'})).encode()
        self.payloads = {base + name: body for name, body in payloads.items()}
        self.release = {'id': 55, 'tag_name': tag, 'draft': False, 'prerelease': False,
                        'html_url': publish.WEB + '/releases/tag/' + tag,
                        'published_at': '2026-11-07T10:00:00Z', 'assets': [{
                            'name': name, 'state': 'uploaded', 'size': len(body),
                            'browser_download_url': base + name, 'digest': 'sha256:' + hashlib.sha256(body).hexdigest()
                        } for name, body in payloads.items()]}
        self.tags[tag] = {'object': {'sha': 'annotation-' + source, 'type': 'tag'}}

    def public(self, url, method='GET'):
        self.public_calls.append((url, method))
        path = url.split('?')[0]
        if path.startswith(publish.SITE):
            if path.endswith('/release.json'):
                data = {key: self.release[key] for key in ['tag_name', 'assets']}
                if self.bad_site: data['tag_name'] = 'v0.0.1'
                return json.dumps(data).encode(), {}
            tag = 'v0.0.1' if self.bad_site else self.release['tag_name']
            body = '<body data-release-version="' + tag + '">' + ''.join(
                '<a data-asset="' + item['name'] + '" href="' + item['browser_download_url'] + '">Download</a>'
                for item in self.release['assets']) + '</body>'
            return body.encode(), {}
        body = self.payloads[path]
        if method == 'HEAD': self.site_heads += 1
        return (b'' if method == 'HEAD' else body), {'Content-Length': str(len(body))}


class LocalPublisher(publish.Publisher):
    """Real temp-repo Git plumbing, but no actual network Git commands."""
    def git(self, *args, **kwargs):
        if kwargs.get('network'):
            self.api.pushed.append(args)
            ref = args[-1]
            if ref.endswith(':refs/heads/main'):
                self.api.main = ref.split(':')[0]
            elif ref.startswith('refs/tags/'):
                tag = ref.split('/')[-1]
                self.api.tags[tag] = {'object': {'sha': self.git('rev-parse', ref), 'type': 'tag'}}
                self.api.published(tag, self.api.main)
                # Preserve exact real annotation identity generated by Git.
                self.api.tags[tag]['object']['sha'] = self.git('rev-parse', ref)
            return ''
        return super().git(*args, **kwargs)


class PublisherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        for name in publish.FILES:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(publish.ROOT / name, path)
        self.run_git('init', '-b', 'main')
        self.run_git('config', 'user.name', 'Offline fixture')
        self.run_git('config', 'user.email', 'fixture@example.invalid')
        self.run_git('remote', 'add', 'origin', publish.WEB + '.git')
        self.run_git('add', '.')
        self.run_git('commit', '-m', 'Initial source')
        self.api = FakeGitHub()
        self.api.main = self.run_git('rev-parse', 'HEAD')
        self.clock = Clock()
        self.pub = self.publisher()
        self.pub.private.mkdir()

    def run_git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, check=True, capture_output=True).stdout.decode().strip()

    def publisher(self):
        return LocalPublisher(self.root, self.api, timeout=120, poll=15, sleep=self.clock.sleep, clock=self.clock)

    def test_complete_pipeline_pins_checks_tag_assets_pages_and_is_noop(self):
        original = publish.versions.current_version(self.root)
        state = self.pub.publish()
        self.assertEqual(state['phase'], 'complete')
        self.assertEqual(len(self.api.pushed), 2)
        self.assertEqual(state['source'], self.run_git('rev-parse', 'HEAD'))
        self.assertEqual(self.run_git('rev-list', '-n', '1', state['tag']), state['source'])
        self.assertEqual(publish.guard.check_local(state['tag'], self.root)[0], state['version'])
        self.assertNotEqual(state['version'], original)
        self.assertEqual(len(state['gates']), 3)
        self.assertEqual(self.api.site_heads, len(publish.INSTALLERS))
        self.publisher().publish()
        self.assertEqual(len(self.api.pushed), 2)
        self.assertEqual(publish.versions.current_version(self.root), state['version'])
        with mock.patch.object(publish, 'ROOT', self.root), mock.patch.object(publish, 'GitHub', return_value=self.api), mock.patch.dict(os.environ, {'GH_TOKEN': self.api.token, 'GITHUB_TOKEN': ''}):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                publish.main(['--dry-run'])
            self.assertEqual(json.loads(output.getvalue())['operation'], 'no-op')
        self.assertNotIn(self.api.token, self.pub.path.read_text())
        self.assertEqual(self.pub.path.stat().st_mode & 0o777, 0o600)

    def test_plan_crash_and_partial_checkout_resume_bump_only_once(self):
        self.pub.prepare('patch')
        old = publish.versions.current_version(self.root)
        self.assertEqual(old, publish.versions.current_version(self.root))
        self.pub.finish_prepare()
        state = dict(self.pub.state)
        # Simulate an interruption partway through applying the prepared files.
        new_package = subprocess.run(['git', 'show', state['source'] + ':package.json'], cwd=self.root, check=True, capture_output=True).stdout
        (self.root / 'package.json').write_bytes(new_package)
        resumed = self.publisher().publish()
        self.assertEqual(resumed['source'], state['source'])
        self.assertEqual(resumed['version'], state['version'])
        self.assertEqual(self.run_git('rev-list', '--count', 'HEAD'), '2')

    def test_staged_only_unknown_edit_is_not_discarded(self):
        self.pub.prepare('patch')
        self.pub.finish_prepare()
        path = self.root / 'package.json'
        original = path.read_bytes()
        path.write_bytes(original + b'\n\n')
        self.run_git('add', 'package.json')
        path.write_bytes(original)
        with self.assertRaisesRegex(publish.Failure, 'index were edited'):
            self.pub.install_prepared()
        staged = subprocess.run(['git', 'show', ':package.json'], cwd=self.root, check=True, capture_output=True).stdout
        self.assertEqual(staged, original + b'\n\n')
        self.assertEqual(self.api.pushed, [])

    def test_unknown_tracked_staged_only_edit_is_not_discarded(self):
        path = self.root / 'README.md'
        path.write_text('committed source')
        self.run_git('add', 'README.md')
        self.run_git('commit', '-m', 'Readme fixture')
        self.pub.prepare('patch')
        self.pub.finish_prepare()
        path.write_text('staged source edit')
        self.run_git('add', 'README.md')
        path.write_text('committed source')
        with self.assertRaisesRegex(publish.Failure, 'Unexpected source edits'):
            self.pub.install_prepared()
        self.assertEqual(self.run_git('show', ':README.md'), 'staged source edit')
        self.assertEqual(self.api.pushed, [])

    @unittest.skipIf(os.name == 'nt', 'POSIX executable/symlink modes')
    def test_version_file_symlink_and_mode_changes_are_preserved(self):
        self.pub.prepare('patch')
        self.pub.finish_prepare()
        path = self.root / 'package.json'
        path.chmod(0o755)
        with self.assertRaisesRegex(publish.Failure, 'modes changed'):
            self.pub.install_prepared()
        self.assertEqual(path.stat().st_mode & 0o777, 0o755)
        path.chmod(0o644)
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / 'package.json'
            target.write_bytes(path.read_bytes())
            path.unlink()
            path.symlink_to(target)
            with self.assertRaisesRegex(publish.Failure, 'file type changed'):
                self.pub.install_prepared()
            self.assertTrue(path.is_symlink())

    def test_pushurl_and_effective_rewrite_are_checked_before_any_push(self):
        self.run_git('config', '--add', 'remote.origin.pushurl', publish.WEB + '.git')
        self.run_git('config', '--add', 'remote.origin.pushurl', 'https://elsewhere.invalid/wrong.git')
        with self.assertRaisesRegex(publish.Failure, 'origin must'):
            self.pub.publish()
        self.assertEqual(self.api.pushed, [])
        self.run_git('config', '--unset-all', 'remote.origin.pushurl')
        self.run_git('config', 'url.https://elsewhere.invalid/.insteadOf', publish.WEB)
        with self.assertRaisesRegex(publish.Failure, 'origin must'):
            self.pub.checkout()

    def test_cli_dry_run_and_status_do_not_create_private_state(self):
        shutil.rmtree(self.pub.private)
        before = self.run_git('status', '--porcelain')
        with mock.patch.object(publish, 'ROOT', self.root), mock.patch.object(publish, 'GitHub', return_value=self.api), mock.patch.dict(os.environ, {'GH_TOKEN': self.api.token, 'GITHUB_TOKEN': ''}):
            for args in (['--status'], ['--dry-run']):
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    publish.main(args)
                self.assertIn('not-started' if '--status' in args else 'prepare', output.getvalue())
                self.assertFalse(self.pub.private.exists())
        self.assertEqual(self.run_git('status', '--porcelain'), before)
        self.assertEqual(self.api.posts, [])
        self.assertEqual(self.api.pushed, [])

    def test_lost_push_responses_are_reconciled_without_second_bump(self):
        class LostResponse(LocalPublisher):
            def git(inner, *args, **kwargs):
                result = super(LostResponse, inner).git(*args, **kwargs)
                if kwargs.get('network'):
                    raise publish.Failure('Simulated lost accepted push response')
                return result
        pub = LostResponse(self.root, self.api, sleep=self.clock.sleep, clock=self.clock)
        state = pub.publish()
        self.assertEqual(state['phase'], 'complete')
        self.assertEqual(len(self.api.pushed), 2)
        self.assertEqual(self.run_git('rev-list', '--count', 'HEAD'), '2')

    def test_instant_failed_rerun_is_reported_and_not_reposted_without_explicit_retry(self):
        self.pub.prepare('patch')
        sha = self.api.main
        first = self.api.run('ci.yml', sha, 'main', conclusion='failure')
        second = self.api.run('ci.yml', sha, 'main', conclusion='failure', attempt=2)
        self.api.run_responses['ci.yml'] = [[first], [second]]
        with self.assertRaisesRegex(publish.Failure, 'ended with failure'):
            self.pub.wait_workflow('ci.yml', sha, 'main', retry=True)
        resumed = self.publisher()
        resumed.state = resumed.load()
        with self.assertRaisesRegex(publish.Failure, 'ended with failure'):
            resumed.wait_workflow('ci.yml', sha, 'main')
        self.assertEqual(len(self.api.posts), 1)

    def test_reserved_unpublished_tag_advances_numeric_version(self):
        self.api.tags['v9.2.9'] = {'object': {'sha': 'reserved', 'type': 'commit'}}
        self.assertEqual(self.pub.next_version('patch'), '9.2.10')
        self.assertEqual(self.pub.next_version('minor'), '9.3.0')
        self.assertEqual(self.pub.next_version('major'), '10.0.0')

    def test_wrong_sha_checks_never_authorize_tag(self):
        self.api.run_responses['ci.yml'] = [[self.api.run('ci.yml', 'wrong', 'main')]]
        with self.assertRaisesRegex(publish.Failure, 'timed out'):
            self.pub.publish()
        self.assertEqual(len(self.api.pushed), 1)
        self.assertFalse(self.api.tags)
        self.assertEqual(len(self.api.posts), 1)

    def test_failed_workflow_is_not_success_and_retry_observes_attempt(self):
        self.pub.prepare('patch')
        self.pub.finish_prepare()
        self.pub.install_prepared()
        sha = self.pub.state['source']
        failed = self.api.run('ci.yml', sha, 'main', conclusion='failure')
        self.api.run_responses['ci.yml'] = [[failed]]
        with self.assertRaisesRegex(publish.Failure, 'ended with failure'):
            self.pub.wait_workflow('ci.yml', sha, 'main')
        self.api.run_calls.clear()
        success = self.api.run('ci.yml', sha, 'main', attempt=2)
        self.api.run_responses['ci.yml'] = [[failed], [failed], [success]]
        self.pub.wait_workflow('ci.yml', sha, 'main', retry=True)
        self.assertEqual(len(self.api.posts), 1)
        self.assertIn('rerun-failed-jobs', self.api.posts[0][0])

    def test_ambiguous_dispatch_is_not_resent_on_resume(self):
        self.pub.prepare('patch')
        self.api.ambiguous = True
        with self.assertRaisesRegex(publish.Failure, 'Ambiguous'):
            self.pub.mutation('dispatch:ci.yml', 'actions/workflows/ci.yml/dispatches', {'ref': 'main'})
        resumed = self.publisher()
        resumed.state = resumed.load()
        resumed.mutation('dispatch:ci.yml', 'actions/workflows/ci.yml/dispatches', {'ref': 'main'})
        self.assertEqual(len(self.api.posts), 1)

    def test_conflicting_tag_is_never_moved(self):
        self.pub.prepare('patch')
        self.pub.finish_prepare()
        self.pub.install_prepared()
        self.api.tags[self.pub.state['tag']] = {'object': {'sha': 'somebody-else', 'type': 'commit'}}
        with self.assertRaisesRegex(publish.Failure, 'immutable'):
            self.pub.push_tag()
        self.assertEqual(self.api.pushed, [])

    def test_new_refuses_unresolved_tag_or_active_old_release(self):
        self.pub.prepare('patch')
        self.pub.finish_prepare()
        self.pub.install_prepared()
        self.pub.state['phase'] = 'release'
        with self.assertRaisesRegex(publish.Failure, 'unresolved'):
            self.pub.allow_new()
        self.api.tags[self.pub.state['tag']] = {'object': {'sha': self.pub.state['source'], 'type': 'commit'}}
        self.api.run_responses['release.yml'] = [[self.api.run('release.yml', self.pub.state['source'], self.pub.state['tag'], status='in_progress', conclusion=None)]]
        with self.assertRaisesRegex(publish.Failure, 'still publish'):
            self.pub.allow_new()

    def test_pages_only_keeps_immutable_release_and_never_pushes_or_bumps(self):
        sha = self.api.main
        version = publish.versions.current_version(self.root)
        self.api.published('v' + version, sha)
        self.pub.pages_only('v' + version)
        self.assertEqual(self.api.pushed, [])
        self.assertEqual(publish.versions.current_version(self.root), version)
        self.assertEqual(self.pub.state['phase'], 'complete')

    def test_verification_rejects_digest_signature_site_and_missing_asset(self):
        tag = 'v' + publish.versions.current_version(self.root)
        self.api.published(tag, self.api.main)
        self.pub.verify_release(tag)
        self.api.release['assets'][0]['digest'] = 'sha256:' + '0' * 64
        with self.assertRaises(publish.Failure): self.pub.verify_release(tag)
        self.api.published(tag, self.api.main)
        self.api.bad_site = True
        with self.assertRaisesRegex(publish.Failure, 'another release'): self.pub.verify_site(self.api.release)
        self.api.bad_site = False
        self.api.release['assets'].pop()
        with self.assertRaisesRegex(publish.Failure, '20 assets'): self.pub.verify_release(tag)

    def test_duplicate_website_assets_are_rejected(self):
        tag = 'v' + publish.versions.current_version(self.root)
        self.api.published(tag, self.api.main)
        original = self.api.public
        def duplicate(url, method='GET'):
            raw, headers = original(url, method)
            if '/release.json' in url:
                data = json.loads(raw)
                data['assets'][-1] = data['assets'][0]
                raw = json.dumps(data).encode()
            return raw, headers
        self.api.public = duplicate
        with self.assertRaisesRegex(publish.Failure, 'duplicated'):
            self.pub.verify_site(self.api.release)

    def test_manifest_signature_version_url_and_platform_are_checked_without_installer_get(self):
        tag = 'v' + publish.versions.current_version(self.root)
        for damage in ('version', 'url', 'platform', 'signature'):
            self.api.published(tag, self.api.main)
            base = publish.WEB + '/releases/download/' + tag + '/'
            manifest = json.loads(self.api.payloads[base + 'latest.json'])
            target = next(iter(publish.TARGETS))
            if damage == 'version': manifest['version'] = '0.0.1'
            if damage == 'url': manifest['platforms'][target]['url'] = 'https://elsewhere.invalid/binary'
            if damage == 'platform': manifest['platforms'].pop(target)
            if damage == 'signature':
                wrong = base64.b64encode(b'untrusted comment: fixture\nabc\ntrusted comment: timestamp:1\tversion:0.0.1\nabc\n').decode()
                manifest['platforms'][target]['signature'] = wrong
                self.api.payloads[base + publish.TARGETS[target] + '.sig'] = (wrong + '\n').encode()
            self.api.payloads[base + 'latest.json'] = json.dumps(manifest).encode()
            checks = ''.join(hashlib.sha256(self.api.payloads[base + name]).hexdigest() + '  ' + name + '\n'
                             for name in sorted(publish.ASSETS - {'SHA256SUMS'})).encode()
            self.api.payloads[base + 'SHA256SUMS'] = checks
            for item in self.api.release['assets']:
                body = self.api.payloads[base + item['name']]
                item.update(size=len(body), digest='sha256:' + hashlib.sha256(body).hexdigest())
            with self.assertRaises(publish.Failure): self.pub.verify_release(tag)
        installer_urls = {base + name for name in publish.INSTALLERS}
        self.assertFalse(any(url in installer_urls and method == 'GET' for url, method in self.api.public_calls))

    def test_git_timeout_is_bounded_and_never_echoes_subprocess_output(self):
        process = mock.Mock(pid=123, returncode=-9)
        process.communicate.side_effect = [subprocess.TimeoutExpired('git', 1, output=b'synthetic-sensitive-output'), (b'', b'')]
        with mock.patch.object(publish.subprocess, 'Popen', return_value=process), mock.patch.object(publish.os, 'killpg', create=True):
            with self.assertRaisesRegex(publish.Failure, 'timed out') as error:
                publish.Publisher.git(self.pub, 'status')
        self.assertNotIn('synthetic-sensitive-output', str(error.exception))
        self.assertGreater(process.communicate.call_args_list[0].kwargs['timeout'], 0)
        self.assertLessEqual(process.communicate.call_args_list[0].kwargs['timeout'], 60)

    def test_process_lock_rejects_concurrent_publisher(self):
        with publish.process_lock(self.pub.private):
            with self.assertRaisesRegex(publish.Failure, 'Another publisher'):
                with publish.process_lock(self.pub.private): self.fail('Acquired duplicate lock')

    def test_dirty_checkout_and_credential_origin_are_rejected(self):
        (self.root / 'private-token').write_text('never stage this')
        with self.assertRaisesRegex(publish.Failure, 'never stages'): self.pub.publish()
        (self.root / 'private-token').unlink()
        self.run_git('remote', 'set-url', 'origin', 'https://secret@github.com/ywateru/AnyWork.git')
        with self.assertRaisesRegex(publish.Failure, 'without embedded'): self.pub.publish()


class HTTPTest(unittest.TestCase):
    def test_malformed_env_and_file_credentials_are_never_echoed(self):
        secret = 'SYNTHETIC_INVALID_CREDENTIAL\nHEADER'
        script = pathlib.Path(publish.__file__)
        with tempfile.TemporaryDirectory() as directory:
            token_file = pathlib.Path(directory) / 'token'
            token_file.write_text(secret)
            for from_file in (False, True):
                environment = os.environ.copy()
                environment.pop('GH_TOKEN', None)
                environment.pop('GITHUB_TOKEN', None)
                if not from_file: environment['GH_TOKEN'] = secret
                result = subprocess.run([publish.sys.executable, str(script), '--dry-run', '--token-file', str(token_file)],
                                        cwd=directory, env=environment, capture_output=True, timeout=15)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn(b'SYNTHETIC_INVALID_CREDENTIAL', result.stdout + result.stderr)
                self.assertIn(b'invalid characters', result.stderr)

    def test_api_never_follows_authenticated_redirect_and_public_never_has_token(self):
        api = publish.GitHub('hidden-secret', sleep=lambda _: None)
        calls = []
        class Response:
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, _): return b'{}'
        class Opener:
            def open(self, request, **kwargs): calls.append(request); return Response()
        api.api_opener = Opener()
        api.public_opener = Opener()
        api.json('releases')
        api.public(publish.SITE + '/release.json')
        self.assertEqual(calls[0].get_header('Authorization'), 'Bearer hidden-secret')
        self.assertIsNone(calls[1].get_header('Authorization'))
        self.assertIsNone(publish.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.invalid'))

    def test_transient_get_retries_but_mutation_never_retries(self):
        api = publish.GitHub('secret', sleep=lambda _: None)
        with mock.patch.object(api.api_opener, 'open', side_effect=publish.http.client.IncompleteRead(b'partial')) as request:
            with self.assertRaises(publish.Failure): api.json('releases')
            self.assertEqual(request.call_count, 3)
        with mock.patch.object(api.api_opener, 'open', side_effect=TimeoutError) as request:
            with self.assertRaises(publish.Failure): api.json('actions/workflows/ci.yml/dispatches', method='POST', data={'ref': 'main'})
            self.assertEqual(request.call_count, 1)


if __name__ == '__main__': unittest.main(verbosity=2)
