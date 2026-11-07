#!/usr/bin/env python3
"""Pure capability reads against private SQLite + the real Rust HTTP service.

No account/native process is inspected. All descriptors, ports and fake plugins
are owned by this test. Catalog/session reads must not contact their fake host.
"""
import http.server
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TOKEN = 'capability-projection-isolated-fixture-token'
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Capabilities(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='anywork-capability-')
        self.base = Path(self.temporary.name).resolve()
        self.process = None
        self.log = None
        self.host = None
        self.addCleanup(self.cleanup)
        for name in ('workspace', 'outside', 'plugins', 'home', 'config'):
            (self.base/name).mkdir(mode=0o700)
        self.probes = []
        probes = self.probes

        class ForbiddenProbe(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                probes.append(self.path)
                self.send_response(503)
                self.end_headers()
            def log_message(self, *_):
                pass

        self.host = http.server.ThreadingHTTPServer(('127.0.0.1', 0), ForbiddenProbe)
        self.host_thread = threading.Thread(target=self.host.serve_forever, daemon=True)
        self.host_thread.start()
        self.host_url = f'http://127.0.0.1:{self.host.server_port}'
        self.descriptor = self.base/'home/.anywork/workbuddy/host.json'
        self.descriptor.parent.mkdir(parents=True, mode=0o700)
        self.descriptor.parent.parent.chmod(0o700)
        self.write_descriptor()
        wrapper = self.base/'fake-wrapper.py'
        wrapper.write_text(f"#!{sys.executable}\nimport os, pathlib, runpy\n"
                           "p=pathlib.Path(os.environ['FAKE_SPAWN_LOG'])\n"
                           "with p.open('a') as f: f.write('spawn\\n')\n"
                           f"runpy.run_path({str(ROOT/'scripts/fake-agent.py')!r}, run_name='__main__')\n")
        wrapper.chmod(0o700)
        manifest = dict(id='custom', name='Declared fixture', protocol_version=1,
                        command=sys.executable, args=[str(wrapper)],
                        capabilities=['chat', 'models', 'message-edit', 'approvals'])
        (self.base/'plugins/custom.json').write_text(json.dumps(manifest))
        self.process = None
        self.log = None
        self.start()
        self.stop()
        self.seed()
        self.start()

    def cleanup(self):
        self.stop()
        if self.host:
            self.host.shutdown()
            self.host.server_close()
            self.host_thread.join(timeout=3)
            self.host = None
        self.temporary.cleanup()

    def write_descriptor(self, version='5.9.3', instance='26fc89c8-e027-48d0-a413-3192910adf23'):
        self.descriptor.write_text(json.dumps(dict(version=1, agent='workbuddy', appVersion=version,
            pid=os.getpid(), url=self.host_url, browserId='fixture-browser',
            configDir=str(self.base/'config'), instanceId=instance)))
        self.descriptor.chmod(0o600)

    def start(self, scope='workspace', fake_codex=False):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(('ANYWORK_', 'REMOTE_AGENT_', 'DSH_', 'CODEX_', 'FAKE_AGENT_'))}
        env.update(HOME=str(self.base/'home'), USERPROFILE=str(self.base/'home'),
                   CODEX_BIN=str(self.base/('fake-wrapper.py' if fake_codex else 'definitely-not-installed-codex')),
                   FAKE_AGENT_CALLS=str(self.base/'calls.jsonl'),
                   FAKE_AGENT_STATE_DIR=str(self.base/'fake-state'),
                   FAKE_SPAWN_LOG=str(self.base/'spawns'))
        self.log = open(self.base/'service.log', 'a+')
        self.process = subprocess.Popen([
            os.environ.get('ANYWORK_BINARY', str(ROOT/'target/debug/anywork')),
            '--workspace', str(self.base/'workspace'), '--data-dir', str(self.base/'data'),
            '--plugins-dir', str(self.base/'plugins'), '--web-dir', str(self.base/'empty-web'),
            '--bind', f'127.0.0.1:{self.port}', '--token', TOKEN,
            '--codex-discovery', 'false', '--agent-scope', scope,
        ], env=env, stdout=self.log, stderr=self.log,
           **({'start_new_session': True} if os.name == 'posix' else {}))
        for _ in range(160):
            try:
                self.request('/info')
                return
            except OSError:
                if self.process.poll() is not None:
                    break
                time.sleep(.025)
        raise RuntimeError('Private capability fixture did not start; runtime logs withheld')

    def stop(self):
        if self.process:
            if self.process.poll() is None:
                self.process.terminate()
                self.process.wait(timeout=10)
            self.process = None
            self.log.close()
            self.log = None

    def request(self, path, body=None, token=TOKEN):
        headers = {'Authorization': 'Bearer '+token}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(f'http://127.0.0.1:{self.port}/api'+path,
            data=None if body is None else json.dumps(body).encode(), headers=headers)
        with HTTP.open(request, timeout=5) as response:
            return json.load(response)

    def seed(self):
        with sqlite3.connect(self.base/'data/remote-agent.sqlite') as db:
            for name, agent, external, auxiliary, archived in [
                ('codex', 'codex', True, False, False),
                ('managed', 'codex', False, False, False),
                ('harness', 'deepseek-harness', True, False, False),
                ('workbuddy', 'workbuddy', True, False, False),
                ('child', 'workbuddy', True, True, False),
                ('archived', 'workbuddy', True, False, True),
                ('custom', 'custom', False, False, False),
                ('missing', 'unregistered-fixture', True, False, False),
                ('outside', 'workbuddy', True, False, False),
                ('outside-codex', 'codex', True, False, False),
                ('outside-harness', 'deepseek-harness', True, False, False),
            ]:
                cwd = self.base/('outside' if name.startswith('outside') else 'workspace')
                session = dict(id=name, thread_id='thread-'+name, title='private cached title', cwd=str(cwd),
                    agent=agent, model=None, policy='manual', status='running' if external else 'idle',
                    archived=archived, external=external, auxiliary=auxiliary, created_at=1, updated_at=1)
                db.execute('INSERT INTO sessions VALUES(?,?)', (name, json.dumps(session)))
                event = dict(seq=0, session_id=name, method='user/message', params={'text':'PRIVATE_CACHED_BODY'}, request_id=None, created_at=1)
                db.execute('INSERT INTO events(session_id,data) VALUES(?,?)', (name, json.dumps(event)))
                # Persisted requests alone must not authorize an approval on a new generation.
                event.update(method='item/commandExecution/requestApproval', request_id=77)
                db.execute('INSERT INTO events(session_id,data) VALUES(?,?)', (name, json.dumps(event)))
                db.execute('INSERT INTO message_queue(session_id,data) VALUES(?,?)',
                           (name, json.dumps(dict(text='PRIVATE_QUEUE_BODY', attachments=[], status='pending'))))

    def database_snapshot(self):
        with sqlite3.connect(self.base/'data/remote-agent.sqlite') as db:
            return '\n'.join(db.iterdump())

    def calls(self):
        path = self.base/'calls.jsonl'
        return path.read_bytes() if path.exists() else b''

    def assert_native_unknown(self, result):
        readiness = result['readiness']
        self.assertIsNone(readiness['transport_reachable'])
        self.assertIsNone(readiness['identity_verified'])
        self.assertIsNone(result['binding']['native_instance'])
        self.assertIsNone(result['binding']['generation'])
        self.assertEqual(result['observation']['native_state'], 'unknown')
        for action in result['actions'].values():
            if action['owner'] != 'anywork':
                self.assertFalse(action['allowed_now'])

    def test_catalog_and_sessions_are_pure_reads_and_do_not_probe_or_spawn(self):
        before = self.database_snapshot()
        self.assertTrue(self.request('/info')['capability_projection_v1'])
        for _ in range(6):
            entries = {p['id']: p for p in self.request('/plugins')['plugins']}
            self.assertTrue(entries['codex']['available'])  # unchanged compatibility metadata
            self.assertTrue(entries['workbuddy']['available'])  # descriptor is valid, host returns 503
            self.assertFalse(entries['deepseek-harness']['available'])
            for plugin in entries.values():
                projection = plugin['capability_projection']
                self.assertEqual(projection['version'], 1)
                self.assertIsNone(projection['installed'])
                self.assertIsNone(projection['transport_reachable'])
                self.assertIsNone(projection['identity_verified'])
            self.assertEqual(entries['workbuddy']['capability_projection']['support_evidence']['execution'], 'experimental')
            for name in ('codex', 'managed', 'harness', 'workbuddy', 'child', 'archived', 'custom', 'missing'):
                result = self.request('/sessions/'+name+'/capabilities')
                self.assert_native_unknown(result)
                self.assertTrue(result['readiness']['readable'])
                self.assertTrue(result['actions']['history.read']['allowed_now'])
                self.assertTrue(result['actions']['local_queue.pause']['allowed_now'])
                self.assertTrue(result['actions']['local_queue.delete']['allowed_now'])
                self.assertFalse(result['actions']['approvals.respond']['allowed_now'])
                self.assertFalse(result['actions']['questions.respond']['allowed_now'])
                raw = json.dumps(result)
                for secret in (str(self.base), self.host_url, TOKEN, 'PRIVATE_', 'fixture-browser', '26fc89c8'):
                    self.assertNotIn(secret, raw)
        self.assertEqual(before, self.database_snapshot())
        self.assertEqual(self.probes, [])
        self.assertFalse((self.base/'spawns').exists())
        self.assertEqual(self.calls(), b'')

    def test_scope_and_auth_precede_projection_sources(self):
        # Deliberately corrupt this disposable fixture after schema validation;
        # scope must deny before the endpoint attempts its queue JSON read.
        with sqlite3.connect(self.base/'data/remote-agent.sqlite') as db:
            db.execute("UPDATE message_queue SET data='not-json' WHERE session_id LIKE 'outside%'")
        for path, token, status in [('/sessions/outside/capabilities', TOKEN, 403),
                                    ('/sessions/outside-codex/capabilities', TOKEN, 403),
                                    ('/sessions/outside-harness/capabilities', TOKEN, 403),
                                    ('/sessions/workbuddy/capabilities', 'wrong-fixture-token', 401)]:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.request(path, token=token)
            self.assertEqual(caught.exception.code, status)
            body = json.load(caught.exception)
            self.assertIn('error', body)
            self.assertNotIn('actions', body)
        self.assertEqual(self.probes, [])
        self.assertFalse((self.base/'spawns').exists())

    def test_policy_and_offline_queue_are_separate_from_native_readiness(self):
        external = self.request('/sessions/codex/capabilities')
        self.assertEqual(external['binding']['topology'], 'codex_external_unknown')
        for action in ('goal.pause', 'goal.resume', 'message.start'):
            self.assertEqual(external['actions'][action]['supported'], 'unknown')
        harness = self.request('/sessions/harness/capabilities')
        self.assertFalse(harness['readiness']['configured'])
        self.assertEqual(harness['actions']['goal.create']['supported'], 'no')
        self.assertTrue(harness['actions']['local_queue.edit']['allowed_now'])
        wb = self.request('/sessions/workbuddy/capabilities')
        self.assertEqual(wb['actions']['model.set']['supported'], 'yes')
        self.assertEqual(wb['actions']['model.set']['reason_code'], 'stored_busy')
        self.assertEqual(wb['actions']['effort.set']['reason_code'], 'native_observation_missing')
        child = self.request('/sessions/child/capabilities')
        self.assertEqual(child['actions']['message.start']['reason_code'], 'read_only_child')
        self.assertFalse(child['actions']['local_queue.edit']['allowed_now'])
        archived = self.request('/sessions/archived/capabilities')
        self.assertEqual(archived['actions']['message.start']['reason_code'], 'archived')
        self.assertFalse(archived['actions']['local_queue.edit']['allowed_now'])
        self.assertIn('does not cancel', wb['actions']['local_queue.delete']['limitations'][1])
        custom = self.request('/sessions/custom/capabilities')
        self.assertEqual(custom['actions']['model.set']['supported'], 'unknown')
        self.assertEqual(custom['support_evidence']['execution'], 'unverified')

    def test_descriptor_changes_never_manufacture_fresh_native_identity(self):
        first = self.request('/sessions/workbuddy/capabilities')
        repeat = self.request('/sessions/workbuddy/capabilities')
        self.assertEqual(first['revision'], repeat['revision'])
        observation = repeat['observation']
        self.assertEqual(observation['expires_at']-observation['observed_at'], 5000)
        self.write_descriptor(instance='f1d0bcd4-5830-4362-b1ce-9cd43633207e')
        self.assert_native_unknown(self.request('/sessions/workbuddy/capabilities'))
        self.write_descriptor(version='99.0.0')
        invalid = self.request('/sessions/workbuddy/capabilities')
        self.assertFalse(invalid['readiness']['configured'])
        self.assertNotEqual(first['revision'], invalid['revision'])
        self.assert_native_unknown(invalid)
        self.descriptor.unlink()
        self.assertFalse(self.request('/sessions/workbuddy/capabilities')['readiness']['configured'])
        self.assertEqual(self.probes, [])

    def test_explicit_all_scope_authorizes_cached_reads_for_all_three_agents(self):
        self.stop()
        self.start(scope='all')
        before = self.database_snapshot()
        for name in ('outside', 'outside-codex', 'outside-harness'):
            result = self.request('/sessions/'+name+'/capabilities')
            self.assertTrue(result['actions']['history.read']['allowed_now'])
            self.assert_native_unknown(result)
        self.assertEqual(before, self.database_snapshot())
        self.assertEqual(self.probes, [])
        self.assertFalse((self.base/'spawns').exists())

    def test_existing_fake_runtime_does_not_become_live_observation(self):
        self.stop()
        self.start(fake_codex=True)
        session = self.request('/sessions', dict(agent='codex', cwd=str(self.base/'workspace')))['session']
        before_calls = self.calls()
        before_spawns = (self.base/'spawns').read_bytes()
        self.assertEqual(before_spawns, b'spawn\n')
        for _ in range(10):
            result = self.request('/sessions/'+session['id']+'/capabilities')
            self.assert_native_unknown(result)
            self.assertEqual(result['binding']['topology'], 'codex_managed')
            self.assertEqual(result['actions']['model.set']['supported'], 'yes')
            self.assertIsNone(result['readiness']['writable'])
            self.request('/plugins')
        self.assertEqual(self.calls(), before_calls)
        self.assertEqual((self.base/'spawns').read_bytes(), before_spawns)
        self.assertEqual(self.probes, [])


if __name__ == '__main__':
    unittest.main()
