#!/usr/bin/env python3
"""Global event scope/cursor acceptance against an isolated real Rust HTTP server."""
import http.client
import json
import os
import pathlib
import socket
import sqlite3
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOKEN = 'isolated-event-scope-token'
AGENTS = ('codex', 'deepseek-harness', 'workbuddy')


class EventScope(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='anywork-event-scope-')
        self.base = pathlib.Path(self.temp.name).resolve()
        self.workspace = self.base / 'workspace'
        self.outside = self.base / 'outside'
        for path in (self.workspace, self.outside, self.base / 'home', self.base / 'plugins'):
            path.mkdir()
        self.process = None
        self.start('all')
        self.stop()
        self.seed()
        self.start('all')

    def tearDown(self):
        self.stop()
        self.temp.cleanup()

    def start(self, agent_scope='workspace', codex_scope='workspace'):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        env = {k: v for k, v in os.environ.items() if not k.startswith(('ANYWORK_', 'REMOTE_AGENT_', 'DSH_', 'CODEX_'))}
        env.update(HOME=str(self.base / 'home'), USERPROFILE=str(self.base / 'home'))
        self.log = open(self.base / 'server.log', 'a+')
        self.process = subprocess.Popen([
            os.environ.get('ANYWORK_BINARY', str(ROOT / 'target/debug/anywork')),
            '--codex-discovery', 'false', '--bind', f'127.0.0.1:{self.port}',
            '--workspace', str(self.workspace), '--data-dir', str(self.base / 'data'),
            '--plugins-dir', str(self.base / 'plugins'), '--web-dir', str(self.base / 'empty-web'),
            '--token', TOKEN, '--agent-scope', agent_scope, '--codex-scope', codex_scope,
        ], env=env, stdout=self.log, stderr=self.log)
        for _ in range(150):
            try:
                self.request('/health')
                return
            except OSError:
                if self.process.poll() is not None:
                    break
                time.sleep(.03)
        self.log.seek(0)
        raise RuntimeError(self.log.read())

    def stop(self):
        if self.process is not None:
            self.process.terminate()
            self.process.wait(timeout=10)
            self.process = None
            self.log.close()

    def seed(self):
        self.sessions = {}
        with sqlite3.connect(self.base / 'data/remote-agent.sqlite') as db:
            for place, cwd in [('inside', str(self.workspace)), ('outside', str(self.outside))]:
                for agent in AGENTS:
                    self.sessions[f'{place}-{agent}'] = self.session(f'{place}-{agent}', agent, cwd)
            for sid, agent, cwd, external, archived in [
                ('inside-owned', 'fixture', str(self.workspace), False, False),
                ('inside-archived', 'codex', str(self.workspace), True, True),
                ('outside-owned', 'codex', str(self.outside), False, False),
                ('outside-unknown-agent', 'unknown', str(self.outside), True, False),
                ('relative', 'codex', 'relative-cwd', True, False),
            ]:
                self.sessions[sid] = self.session(sid, agent, cwd, external, archived)
            for sid, session in self.sessions.items():
                db.execute('INSERT INTO sessions(id,data) VALUES(?,?)', (sid, json.dumps(session)))
            seq = 0
            def event(sid):
                nonlocal seq
                seq += 1
                value = {'seq': seq, 'session_id': sid, 'method': 'test/event', 'params': {'text': f'payload-{sid}'}, 'request_id': None, 'created_at': seq}
                db.execute('INSERT INTO events(seq,session_id,data) VALUES(?,?,?)', (seq, sid, json.dumps(value)))
            for _ in range(501):
                event('outside-workbuddy')
            for sid in self.sessions:
                event(sid)
            event('deleted-session')  # Deliberately orphaned fixture; unknown sessions fail closed.
            self.watermark = seq

    @staticmethod
    def session(sid, agent, cwd, external=True, archived=False):
        return {'id': sid, 'thread_id': sid, 'title': sid, 'cwd': cwd, 'agent': agent, 'model': None,
                'policy': 'manual', 'status': 'idle', 'archived': archived, 'created_at': 1, 'updated_at': 1,
                'external': external, 'auxiliary': False}

    def request(self, path, token=TOKEN):
        request = urllib.request.Request(f'http://127.0.0.1:{self.port}/api{path}', headers={'Authorization': 'Bearer ' + token})
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    def drain(self):
        cursor = 0
        seen = []
        for _ in range(10):
            page = self.request('/events/poll?after=' + str(cursor))
            self.assertGreaterEqual(page['cursor'], cursor)
            self.assertTrue(all(cursor < event['seq'] <= page['cursor'] for event in page['events']))
            seen.extend(page['events'])
            if not page['has_more']:
                self.assertEqual(page['cursor'], self.watermark)
                return seen
            self.assertGreater(page['cursor'], cursor)
            cursor = page['cursor']
        self.fail('Global scan did not drain within bounded pages')

    def assert_visible(self, allowed):
        listed = {session['id'] for session in self.request('/sessions')['sessions']}
        self.assertEqual(listed, allowed)
        for sid in self.sessions:
            if sid in allowed:
                self.assertEqual(self.request('/sessions/' + sid)['session']['id'], sid)
            else:
                with self.assertRaises(urllib.error.HTTPError):
                    self.request('/sessions/' + sid)
        events = self.drain()
        self.assertEqual({event['session_id'] for event in events}, allowed)
        self.assertEqual(len({event['seq'] for event in events}), len(events))
        return events

    def test_all_then_workspace_restart_filters_all_agents_and_keeps_scan_progress(self):
        inside = {sid for sid in self.sessions if sid.startswith('inside-')}
        all_visible = inside | {f'outside-{agent}' for agent in AGENTS}
        self.assert_visible(all_visible)
        self.stop()
        self.start()
        first = self.request('/events/poll?after=0')
        self.assertEqual(first, {'events': [], 'cursor': 500, 'has_more': True})
        events = self.assert_visible(inside)
        wire = json.dumps(events)
        self.assertNotIn('outside-', wire)
        self.assertNotIn('deleted-session', wire)
        self.assertTrue(any(event['session_id'] == 'inside-archived' for event in events))
        watermark = self.request('/events/poll')
        self.assertEqual(watermark, {'events': [], 'cursor': self.watermark, 'has_more': False})
        self.assertEqual(self.request('/events/poll?after=' + str(self.watermark)), watermark)

    def test_legacy_codex_all_does_not_widen_other_agents_or_owned_sessions(self):
        self.stop()
        self.start(codex_scope='all')
        allowed = {sid for sid in self.sessions if sid.startswith('inside-')} | {'outside-codex'}
        self.assert_visible(allowed)

    def test_sse_has_only_visible_payloads_and_data_free_checkpoints(self):
        self.stop()
        self.start()
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        try:
            connection.request('GET', '/api/events?after=0', headers={'Authorization': 'Bearer ' + TOKEN})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            frames, frame = [], []
            for _ in range(200):
                line = response.readline().decode().strip()
                if line:
                    frame.append(line)
                elif frame:
                    frames.append(frame)
                    if frame == ['event: cursor', f'id: {self.watermark}'] or set(frame) == {'event: cursor', f'id: {self.watermark}'}:
                        break
                    frame = []
            else:
                self.fail('No final scanned-cursor checkpoint')
            encoded = json.dumps(frames)
            self.assertNotIn('outside-', encoded)
            self.assertNotIn('deleted-session', encoded)
            checkpoints = [frame for frame in frames if 'event: cursor' in frame]
            self.assertGreaterEqual(len(checkpoints), 2)
            self.assertTrue(all(not any(line.startswith('data:') for line in frame) for frame in checkpoints))
            # Mirrors legacy fetch parsers: only frames with data become messages.
            data = [json.loads(line[5:].strip()) for frame in frames for line in frame if line.startswith('data:')]
            self.assertEqual({event['session_id'] for event in data}, {sid for sid in self.sessions if sid.startswith('inside-')})
        finally:
            connection.close()

    def test_invalid_cursor_and_auth_fail_without_exposing_data(self):
        for path in ['/events/poll?after=-1', '/events?after=-1', '/events/poll?after=not-a-number']:
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(path)
            self.assertEqual(error.exception.code, 400)
            self.assertNotIn('payload-', error.exception.read().decode())
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/events/poll?after=0', token='wrong')
        self.assertEqual(error.exception.code, 401)


if __name__ == '__main__':
    unittest.main(verbosity=2)
