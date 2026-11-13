#!/usr/bin/env python3
"""Fixture-only HTTP integration. Real CLI validation is claude-real-smoke.py."""
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
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOKEN = 'claude-fixture-integration-token'


class ClaudeIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='anywork-claude-fixture-')
        cls.base = pathlib.Path(cls.temp.name)
        cls.workspace = cls.base / 'workspace'
        cls.workspace.mkdir()
        cls.home = cls.base / 'claude'
        cls.home.mkdir()
        # Isolated inherited history, without invoking any process.
        cls.native = str(uuid.uuid4())
        cls.native_user = str(uuid.uuid4())
        p = cls.home / 'projects' / 'fixture'
        p.mkdir(parents=True)
        rows = [{'uuid': cls.native_user, 'type': 'user', 'parentUuid': None, 'message': {'content': 'passive history'}}, {'uuid': str(uuid.uuid4()), 'type': 'assistant', 'parentUuid': cls.native_user, 'message': {'id': 'old', 'model': 'fixture-sonnet', 'content': [{'type': 'text', 'text': 'old answer'}]}}]
        for row in rows:
            row.update(sessionId=cls.native, cwd=str(cls.workspace), timestamp='2026-11-13T00:00:00Z')
        (p / (cls.native + '.jsonl')).write_text(''.join(json.dumps(r) + '\n' for r in rows))
        cls.desktop_home = cls.base / 'desktop-history'
        org = cls.desktop_home / 'account' / 'org'
        org.mkdir(parents=True)
        cls.desktop_id = 'local_' + str(uuid.uuid4())
        (org / (cls.desktop_id + '.json')).write_text(json.dumps({'sessionId': cls.desktop_id, 'cliSessionId': cls.native, 'cwd': str(cls.workspace), 'createdAt': 1, 'lastActivityAt': 2, 'title': 'Artificial Desktop Code fixture', 'isRunning': True}))
        (org / ('local_' + str(uuid.uuid4()) + '.json')).write_text(json.dumps({'cwd': str(cls.workspace), 'movedToCloud': True, 'title': 'must be excluded'}))
        (org / ('local_' + str(uuid.uuid4()) + '.json')).write_text(json.dumps({'cwd': str(cls.workspace), 'movedToCloud': {'cloudSessionId': 'migrated-cloud-id'}, 'title': 'migrated must be excluded'}))
        cls.fixture = ROOT / 'scripts/claude-fixture.py'
        cls.fixture.chmod(0o755)
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            cls.port = s.getsockname()[1]
        cls.log = open(cls.base / 'server.log', 'w+')
        cls.start()

    @classmethod
    def start(cls):
        binary = os.environ.get('ANYWORK_BINARY', str(ROOT / 'target/debug/anywork'))
        cls.process = subprocess.Popen([binary, '--codex-discovery', 'false', '--bind', f'127.0.0.1:{cls.port}', '--workspace', str(cls.workspace), '--data-dir', str(cls.base / 'data'), '--plugins-dir', str(cls.base / 'plugins'), '--token', TOKEN], env={**os.environ, 'ANYWORK_CLAUDE_BIN': str(cls.fixture), 'ANYWORK_CLAUDE_HISTORY_ROOT': str(cls.home), 'ANYWORK_CLAUDE_DESKTOP_HISTORY_ROOT': str(cls.desktop_home), 'ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR': str(cls.base / 'no-desktop-bridge.json')}, stdout=cls.log, stderr=cls.log)
        for _ in range(200):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{cls.port}/api/health', timeout=1)
                return
            except OSError:
                time.sleep(.05)
        raise RuntimeError('Claude fixture server failed to start')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.log.close()
        cls.temp.cleanup()

    def api(self, path, data=None, method=None):
        req = urllib.request.Request(f'http://127.0.0.1:{self.port}/api' + path, data=json.dumps(data).encode() if data is not None else None, method=method, headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)

    def create(self):
        return self.api('/sessions', {'cwd': str(self.workspace), 'agent': 'claude-code'})['session']

    def wait(self, sid, status):
        for _ in range(200):
            row = self.api('/sessions/' + sid)['session']
            if row['status'] == status:
                return row
            time.sleep(.025)
        self.fail(f'Expected {status}, got {row["status"]}')

    def events(self, sid):
        return self.api(f'/sessions/{sid}/export')['events']

    def pending(self, sid):
        self.wait(sid, 'waiting')
        return next(e for e in reversed(self.events(sid)) if e.get('request_id'))

    def test_01_passive_history_does_not_start_cli_and_resume_keeps_id(self):
        rows = self.api('/sessions')['sessions']
        row = next(r for r in rows if r['thread_id'] == self.native)
        self.assertEqual(row['agent'], 'claude-code')
        self.assertEqual(row['status'], 'external')
        self.assertFalse((self.home / 'calls.jsonl').exists())
        history = self.api(f'/sessions/{row["id"]}/history?paged=true&limit=1')
        self.assertTrue(history['events'])
        self.assertFalse((self.home / 'calls.jsonl').exists())
        self.api(f'/sessions/{row["id"]}/connect', {})
        self.api(f'/sessions/{row["id"]}/messages', {'text': 'hello'})
        self.wait(row['id'], 'idle')
        calls = [json.loads(l) for l in (self.home / 'calls.jsonl').read_text().splitlines()]
        self.assertEqual(calls[0]['sid'], self.native)
        self.assertIn('--resume=' + self.native, calls[0]['argv'])

    def test_02_stream_and_model_settings(self):
        s = self.create()
        sid = s['id']
        self.api(f'/sessions/{sid}/messages', {'text': 'hello'})
        self.wait(sid, 'idle')
        methods = [e['method'] for e in self.events(sid)]
        self.assertIn('item/agentMessage/delta', methods)
        self.assertIn('item/reasoning/textDelta', methods)
        self.assertIn('turn/completed', methods)
        self.assertEqual(sum(m == 'user/message' for m in methods), 1)
        events = self.events(sid)
        completed_ids = {e['params']['item']['id'] for e in events if e['method'] == 'item/completed'}
        for e in events:
            if e['method'] in ('item/agentMessage/delta', 'item/reasoning/textDelta'):
                self.assertIn(e['params']['itemId'], completed_ids)
        control = self.api(f'/sessions/{sid}/composer')
        self.assertFalse(control['plan_available'])
        self.assertFalse(control['service_tier_available'])
        self.api(f'/sessions/{sid}/composer', {'action': 'settings', 'model': 'fixture-opus'})
        self.assertEqual(self.api(f'/sessions/{sid}/composer')['model'], 'fixture-opus')
        caps = self.api(f'/sessions/{sid}/capabilities')
        self.assertEqual(caps['actions']['message.edit']['supported'], 'no')
        self.assertEqual(caps['actions']['goal.create']['supported'], 'no')

    def test_03_approval_and_free_form_questions(self):
        for text in ('approval', 'question'):
            sid = self.create()['id']
            self.api(f'/sessions/{sid}/messages', {'text': text})
            e = self.pending(sid)
            if text == 'approval':
                with self.assertRaises(urllib.error.HTTPError):
                    self.api(f'/sessions/{sid}/respond', {'request_id': e['request_id'], 'result': {'decision': 'acceptForSession'}})
                result = {'decision': 'accept'}
            else:
                result = {'answers': {'0': {'answers': ['free form answer']}}}
            self.api(f'/sessions/{sid}/respond', {'request_id': e['request_id'], 'result': result})
            self.wait(sid, 'idle')
            with self.assertRaises(urllib.error.HTTPError):
                self.api(f'/sessions/{sid}/respond', {'request_id': e['request_id'], 'result': result})

    def test_04_interrupt_only_owned_turn(self):
        sid = self.create()['id']
        self.api(f'/sessions/{sid}/messages', {'text': 'wait'})
        self.wait(sid, 'running')
        self.api(f'/sessions/{sid}/interrupt', {})
        self.wait(sid, 'idle')
        last = [e for e in self.events(sid) if e['method'] == 'turn/completed'][-1]
        self.assertEqual(last['params']['turn']['status'], 'interrupted')

    def test_05_attachment_scope_and_native_images(self):
        sid = self.create()['id']
        image = self.workspace / 'fixture.png'
        image.write_bytes(b'fixture image')
        note = self.workspace / 'note.txt'
        note.write_text('local text')
        self.api(f'/sessions/{sid}/messages', {'text': 'attachments', 'attachments': [str(image), str(note)]})
        self.wait(sid, 'idle')
        answer = next(e['params']['item']['text'] for e in reversed(self.events(sid)) if e['method'] == 'item/completed' and e['params']['item']['type'] == 'agentMessage')
        self.assertIn('image', answer)
        outside = self.base / 'outside.txt'
        outside.write_text('must not read')
        with self.assertRaises(urllib.error.HTTPError):
            self.api(f'/sessions/{sid}/messages', {'text': 'no', 'attachments': [str(outside)]})

    def test_06_fault_reconnect_does_not_replay(self):
        s = self.create()
        sid = s['id']
        self.api(f'/sessions/{sid}/messages', {'text': 'crash'})
        self.wait(sid, 'disconnected')
        self.api(f'/sessions/{sid}/connect', {})
        self.api(f'/sessions/{sid}/messages', {'text': 'explicit next message'})
        self.wait(sid, 'idle')
        self.assertEqual(sum(e['method'] == 'user/message' and e['params']['text'] == 'crash' for e in self.events(sid)), 1)
        calls = [json.loads(l) for l in (self.home / 'calls.jsonl').read_text().splitlines()]
        self.assertEqual(sum(c['sid'] == s['thread_id'] for c in calls), 2)

    def test_07_native_writer_blocks_resume_without_process_launch(self):
        root = self.home / 'sessions'
        root.mkdir(exist_ok=True)
        active = str(uuid.uuid4())
        path = self.home / 'projects' / 'fixture' / (active + '.jsonl')
        path.write_text(json.dumps({'type': 'user', 'uuid': 'user', 'sessionId': active, 'parentUuid': None, 'cwd': str(self.workspace), 'message': {'content': 'fixture only'}}) + '\n')
        registry = root / (str(os.getpid()) + '.json')
        registry.write_text(json.dumps({'pid': os.getpid(), 'sessionId': active}))
        self.api('/sessions')
        before = (self.home / 'calls.jsonl').read_text()
        result = self.api(f'/sessions/claude-code-{active}/connect', {})
        self.assertFalse(result['connected'])
        self.assertIn('live native process', result['reason'])
        self.assertEqual((self.home / 'calls.jsonl').read_text(), before)
        registry.unlink()

    def test_08_desktop_never_uses_cli_fallback(self):
        before = (self.home / 'calls.jsonl').read_text()
        with self.assertRaises(urllib.error.HTTPError):
            self.api('/sessions', {'cwd': str(self.workspace), 'agent': 'claude-desktop'})
        self.assertEqual((self.home / 'calls.jsonl').read_text(), before)
        rows = self.api('/sessions')['sessions']
        desktop = next(s for s in rows if s['thread_id'] == self.desktop_id)
        self.assertEqual(desktop['agent'], 'claude-desktop')
        self.assertEqual(desktop['status'], 'external')
        self.assertFalse(any(s['title'] == 'must be excluded' for s in rows))
        self.assertFalse(any(s['title'] == 'migrated must be excluded' for s in rows))
        history = self.api(f'/sessions/{desktop["id"]}/history?limit=20')
        self.assertTrue(any(e['params'].get('claudeCliSessionId') == self.native for e in history['events']))
        self.assertFalse(self.api(f'/sessions/{desktop["id"]}/connect', {})['connected'])
        self.assertEqual((self.home / 'calls.jsonl').read_text(), before)

    def test_09_native_failed_result_remains_failed(self):
        sid = self.create()['id']
        self.api(f'/sessions/{sid}/messages', {'text': 'fail'})
        self.wait(sid, 'error')
        event = next(e for e in reversed(self.events(sid)) if e['method'] == 'turn/completed')
        self.assertEqual(event['params']['turn']['status'], 'failed')
        self.assertTrue(event['params']['turn']['error']['message'])

    def test_10_service_restart_preserves_native_id_history_and_model(self):
        s = self.create()
        sid = s['id']
        self.api(f'/sessions/{sid}/composer', {'action': 'settings', 'model': 'fixture-opus'})
        self.api(f'/sessions/{sid}/messages', {'text': 'before restart'})
        self.wait(sid, 'idle')
        self.__class__.process.terminate()
        self.__class__.process.wait(timeout=10)
        self.__class__.start()
        before = (self.home / 'calls.jsonl').read_text()
        history = self.api(f'/sessions/{sid}/history?paged=true&limit=20')
        self.assertTrue(history['events'])
        self.assertEqual(before, (self.home / 'calls.jsonl').read_text())
        self.api(f'/sessions/{sid}/connect', {})
        self.assertEqual(self.api(f'/sessions/{sid}')['session']['thread_id'], s['thread_id'])
        self.assertEqual(self.api(f'/sessions/{sid}/composer')['model'], 'fixture-opus')
        self.api(f'/sessions/{sid}/messages', {'text': 'after restart'})
        self.wait(sid, 'idle')
        prompts = [e['params']['text'] for e in self.events(sid) if e['method'] == 'user/message']
        self.assertEqual(prompts, ['before restart', 'after restart'])

    def test_11_auto_policy_is_rejected_at_create_and_update(self):
        before = (self.home / 'calls.jsonl').read_text()
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.api('/sessions', {'agent': 'claude-code', 'cwd': str(self.workspace), 'policy': 'auto'})
        self.assertIn('manual approvals only', json.load(error.exception)['error'])
        self.assertEqual(before, (self.home / 'calls.jsonl').read_text())
        sid = self.create()['id']
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.api(f'/sessions/{sid}', {'policy': 'auto'}, 'PATCH')
        self.assertIn('manual approvals only', json.load(error.exception)['error'])
        self.assertEqual(self.api(f'/sessions/{sid}')['session']['policy'], 'manual')
        with sqlite3.connect(self.base / 'data/remote-agent.sqlite') as db:
            db.execute("UPDATE sessions SET data=json_set(data,'$.policy','auto') WHERE id=?", (sid,))
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.api(f'/sessions/{sid}/messages', {'text': 'legacy auto must not send'})
        self.assertIn('manual approvals only', json.load(error.exception)['error'])
        self.api(f'/sessions/{sid}', {'policy': 'manual'}, 'PATCH')
        self.assertEqual(self.api(f'/sessions/{sid}')['session']['policy'], 'manual')
        plugins = self.api('/plugins')['plugins']
        for row in plugins:
            if row['id'] in ('claude-code', 'claude-desktop'):
                self.assertIn('manual-approvals-only', row['capabilities'])

    def test_12_direct_steer_is_rejected_and_model_patch_reaches_native(self):
        sid = self.create()['id']
        self.api(f'/sessions/{sid}', {'model': 'fixture-opus'}, 'PATCH')
        self.assertEqual(self.api(f'/sessions/{sid}/composer')['model'], 'fixture-opus')
        self.api(f'/sessions/{sid}/messages', {'text': 'wait'})
        self.wait(sid, 'running')
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.api(f'/sessions/{sid}/messages', {'text': 'do not send', 'mode': 'steer'})
        self.assertIn('steering is not supported', json.load(error.exception)['error'])
        self.assertFalse(any(e['method'] == 'user/message' and e['params']['text'] == 'do not send' for e in self.events(sid)))
        self.api(f'/sessions/{sid}/interrupt', {})
        self.wait(sid, 'idle')

    def test_13_unknown_and_conflicting_history_preserve_cached_messages(self):
        native = str(uuid.uuid4())
        path = self.home / 'projects/fixture' / (native + '.jsonl')
        row = {'type': 'user', 'uuid': 'keep', 'cwd': str(self.workspace), 'sessionId': native, 'message': {'content': 'KEEP'}}
        original = json.dumps(row) + '\n'
        path.write_text(original)
        self.api('/sessions')
        sid = 'claude-code-' + native
        before = self.api(f'/sessions/{sid}/history?limit=20')['events']
        for replacement in (json.dumps({'type': 'future-transcript-record', 'uuid': 'unknown'}) + '\n', original + json.dumps({**row, 'message': {'content': 'CONFLICT'}}) + '\n'):
            path.write_text(replacement)
            after = self.api(f'/sessions/{sid}/history?limit=20')
            self.assertEqual(before, after['events'])
            self.assertTrue(after['history_notice'])

    def test_14_subagent_final_frames_are_not_main_thread_items(self):
        sid = self.create()['id']
        self.api(f'/sessions/{sid}/messages', {'text': 'subagent'})
        self.wait(sid, 'idle')
        events = self.events(sid)
        self.assertNotIn('CHILD_ONLY', json.dumps(events))
        self.assertNotIn('CHILD_RESULT', json.dumps(events))
        self.assertIn('PARENT_ONLY', json.dumps(events))

    def test_15_native_background_wake_has_turn_and_rejects_concurrent_input(self):
        sid = self.create()['id']
        self.api(f'/sessions/{sid}/messages', {'text': 'background'})
        for _ in range(100):
            events = self.events(sid)
            followup = [e for e in events if e['method'] == 'item/agentMessage/delta' and e['params']['delta'] == 'FOLLOWUP_RUNNING']
            if followup:
                break
            time.sleep(.025)
        self.assertTrue(followup)
        self.assertTrue(followup[0]['params']['turnId'])
        self.wait(sid, 'running')
        with self.assertRaises(urllib.error.HTTPError):
            self.api(f'/sessions/{sid}/messages', {'text': 'must not replace background run'})
        self.api(f'/sessions/{sid}/interrupt', {})
        self.wait(sid, 'idle')
        self.assertFalse(any(e['method'] == 'user/message' and e['params']['text'] == 'must not replace background run' for e in self.events(sid)))

    def test_16_rejected_interrupt_does_not_label_natural_completion_interrupted(self):
        sid = self.create()['id']
        self.api(f'/sessions/{sid}/messages', {'text': 'reject-interrupt'})
        self.wait(sid, 'running')
        with self.assertRaises(urllib.error.HTTPError):
            self.api(f'/sessions/{sid}/interrupt', {})
        self.wait(sid, 'idle')
        event = next(e for e in reversed(self.events(sid)) if e['method'] == 'turn/completed')
        self.assertEqual(event['params']['turn']['status'], 'completed')

    def test_17_idle_before_result_does_not_fabricate_success(self):
        for text, status in [('idle-error', 'error'), ('idle-eof', 'disconnected')]:
            sid = self.create()['id']
            self.api(f'/sessions/{sid}/messages', {'text': text})
            self.wait(sid, status)
            completions = [e['params']['turn'] for e in self.events(sid) if e['method'] == 'turn/completed']
            if text == 'idle-error':
                self.assertEqual(len(completions), 1)
                self.assertEqual(completions[0]['status'], 'failed')
                self.assertTrue(completions[0]['error'])
            else:
                self.assertEqual(completions, [])


if __name__ == '__main__':
    unittest.main()
