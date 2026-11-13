#!/usr/bin/env python3
"""Synthetic native-carrier HTTP API tests. Never connects to real Desktop."""
import copy
import http.server
import importlib.util
import json
import os
import pathlib
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cli_test', ROOT / 'scripts/claude-integration-test.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class Broker:
    def __init__(self, workspace):
        self.workspace = workspace
        self.rows = {}
        self.transcripts = {}
        self.consumers = {}
        self.calls = []
        self.gap = False
        self.lock = threading.Lock()
        self.token = secrets.token_urlsafe(32)

    def emit(self, sid, message, channel='event'):
        if channel == 'event':
            message['session_id'] = self.rows[sid]['cliSessionId']
        event = {'type': 'message', 'sessionId': sid, 'message': message} if channel == 'event' else message
        for consumer in self.consumers.values():
            consumer.append({'sequence': len(consumer) + 1, 'channel': channel, 'event': copy.deepcopy(event)})

    def row(self, sid):
        row = {'sessionId': sid, 'cliSessionId': str(uuid.uuid4()), 'cwd': str(self.workspace), 'title': 'Synthetic Code', 'model': 'fixture-sonnet', 'permissionMode': 'auto', 'pendingToolPermissions': [], 'isRunning': False, 'turnRunning': False}
        self.rows[sid] = row
        self.transcripts[sid] = []
        return row

    def finish(self, sid, failed=False):
        mid = str(uuid.uuid4())
        for event in [{'type': 'message_start', 'message': {'id': mid}}, {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}}, {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': 'native fixture answer'}}]:
            self.emit(sid, {'type': 'stream_event', 'event': event})
        message = {'type': 'assistant', 'uuid': str(uuid.uuid4()), 'session_id': self.rows[sid]['cliSessionId'], 'message': {'id': mid, 'content': [{'type': 'text', 'text': 'native fixture answer'}]}}
        self.transcripts[sid].append(message)
        self.emit(sid, message)
        self.emit(sid, {'type': 'system', 'subtype': 'session_state_changed', 'state': 'idle'})
        self.emit(sid, {'type': 'result', 'is_error': failed, 'subtype': 'error_during_execution' if failed else 'success'})
        self.rows[sid].update(isRunning=False, turnRunning=False, pendingToolPermissions=[])

    def command(self, command):
        self.calls.append(copy.deepcopy(command))
        op, consumer = command['op'], command['id']
        if op == 'open':
            self.consumers[consumer] = []
            return {}
        if op == 'close':
            self.consumers.pop(consumer, None)
            return None
        if op == 'poll':
            events = self.consumers[consumer]
            return {'events': events[command['cursor']:], 'cursor': len(events), 'gap': self.gap, 'generation': consumer}
        method, args = command['method'], command['args']
        if method == 'getSessionList':
            return {'sessions': list(self.rows.values())}
        if method == 'getSession':
            return self.rows.get(args[0])
        if method == 'models':
            return {'data': [{'id': x, 'model': x, 'displayName': x, 'supportedReasoningEfforts': [], 'serviceTiers': []} for x in ['fixture-sonnet', 'fixture-opus']], 'catalogComplete': False}
        if method == 'start':
            info = args[0]
            assert info['withoutFirstMessage'] is True and info['message'] == ''
            assert info['permissionMode'] == 'default'
            self.row(info['sessionId'])['permissionMode'] = info['permissionMode']
            return {'sessionId': info['sessionId']}
        sid = args[0].get('sessionId') if method == 'send' else args[0]
        row = self.rows[sid]
        if method == 'getTranscriptTail':
            return {'messages': self.transcripts[sid][-args[1]:], 'hasMore': False}
        if method == 'setModel':
            row['model'] = args[1]
            return None
        if method == 'interrupt':
            self.finish(sid)
            return None
        if method == 'respondToToolPermission':
            # Permission calls carry request ID as first argument, not session ID.
            raise AssertionError('handled below')
        if method == 'send':
            p = args[0]
            assert not row['isRunning']
            row.update(isRunning=True, turnRunning=True)
            user = {'type': 'user', 'uuid': p['messageUuid'], 'session_id': self.rows[sid]['cliSessionId'], 'message': {'role': 'user', 'content': p['message']}}
            self.transcripts[sid].append(user)
            self.emit(sid, user)
            text = p['message']
            if text in ('approval', 'question'):
                tool = 'AskUserQuestion' if text == 'question' else 'Bash'
                tool_input = {'questions': [{'question': 'Choose?', 'header': 'Choice', 'multiSelect': False, 'options': [{'label': 'A', 'description': 'A'}]}]} if text == 'question' else {'command': 'pwd'}
                request = {'requestId': 'permission-' + str(uuid.uuid4()), 'sessionId': sid, 'toolName': tool, 'input': tool_input, 'cliToolUseId': 'native-tool'}
                row['pendingToolPermissions'] = [request]
                self.emit(sid, request, 'permission')
            elif text == 'gap':
                self.gap = True
            elif text == 'wait':
                self.emit(sid, {'type': 'system', 'subtype': 'session_state_changed', 'state': 'running'})
            elif text == 'fail-result-only':
                self.emit(sid, {'type': 'result', 'is_error': True, 'subtype': 'error_during_execution'})
                row.update(isRunning=False, turnRunning=False)
            elif text == 'tool-cycle':
                tool_id = 'fixture-tool-' + str(uuid.uuid4())
                messages = [
                    {'type': 'assistant', 'uuid': str(uuid.uuid4()), 'message': {'id': str(uuid.uuid4()), 'content': [{'type': 'tool_use', 'id': tool_id, 'name': 'Bash', 'input': {'command': 'pwd'}}]}},
                    {'type': 'user', 'uuid': str(uuid.uuid4()), 'message': {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': tool_id, 'content': 'synthetic output'}]}},
                ]
                for message in messages:
                    message['session_id'] = row['cliSessionId']
                    self.transcripts[sid].append(message)
                    self.emit(sid, message)
                self.finish(sid)
            elif text not in ('wait', 'accepted-only'):
                self.finish(sid, text == 'fail')
            return None
        raise AssertionError(method)

    def respond(self, command):
        if command.get('method') == 'respondToToolPermission':
            self.calls.append(copy.deepcopy(command))
            key, decision, *updated = command['args']
            row = next(r for r in self.rows.values() if any(p['requestId'] == key for p in r['pendingToolPermissions']))
            request = row['pendingToolPermissions'][0]
            assert decision in ('once', 'deny')
            if request['toolName'] == 'AskUserQuestion':
                assert updated == [{'answers': {'Choose?': 'free answer'}}]
            else:
                assert not updated
            self.finish(row['sessionId'])
            return None
        return self.command(command)


class DesktopAdapter(unittest.TestCase):
    api = base.ClaudeIntegration.api
    wait = base.ClaudeIntegration.wait
    events = base.ClaudeIntegration.events
    pending = base.ClaudeIntegration.pending

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='anywork-desktop-adapter-')
        cls.base = pathlib.Path(cls.temp.name).resolve()
        cls.workspace = cls.base / 'workspace'
        cls.workspace.mkdir()
        cls.broker = Broker(cls.workspace)
        broker = cls.broker

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                assert self.path == '/rpc'
                assert self.headers['Authorization'] == 'Bearer ' + broker.token
                command = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                with broker.lock:
                    body = json.dumps({'ok': True, 'value': broker.respond(command)}).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except BrokenPipeError:
                    pass  # A server restart may close an in-flight read.

        cls.http = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()
        cls.private = cls.base / 'private'
        cls.private.mkdir(mode=0o700)
        cls.descriptor = cls.private / 'host.json'
        cls.descriptor.write_text(json.dumps({'version': 1, 'agent': 'claude-desktop', 'transport': 'devtools-loopback', 'appVersion': '5.11492.2', 'asarSha256': 'a' * 64, 'appPath': str(cls.base / 'fixture.app'), 'launcherPid': os.getpid(), 'url': f'http://127.0.0.1:{cls.http.server_port}/', 'token': broker.token, 'instanceId': str(uuid.uuid4())}))
        cls.descriptor.chmod(0o600)
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            cls.port = s.getsockname()[1]
        cls.log = open(cls.base / 'server.log', 'w+')
        cls.env = {**os.environ, 'ANYWORK_CLAUDE_BIN': str(cls.base / 'no-cli'), 'ANYWORK_CLAUDE_HISTORY_ROOT': str(cls.base / 'no-history'), 'ANYWORK_CLAUDE_DESKTOP_HISTORY_ROOT': str(cls.base / 'no-desktop-history'), 'ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR': str(cls.descriptor)}
        cls.start()

    @classmethod
    def start(cls):
        binary = os.environ.get('ANYWORK_BINARY', str(ROOT / 'target/debug/anywork'))
        cls.process = subprocess.Popen([binary, '--codex-discovery', 'false', '--bind', f'127.0.0.1:{cls.port}', '--workspace', str(cls.workspace), '--data-dir', str(cls.base / 'data'), '--plugins-dir', str(cls.base / 'plugins'), '--token', base.TOKEN], env=cls.env, stdout=cls.log, stderr=cls.log)
        for _ in range(100):
            try:
                cls().api('/health')
                return
            except OSError:
                time.sleep(.05)
        raise RuntimeError('fixture API failed to start')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.http.shutdown()
        cls.http.server_close()
        cls.log.close()
        cls.temp.cleanup()

    def create(self):
        return self.api('/sessions', {'agent': 'claude-desktop', 'cwd': str(self.workspace)})['session']['id']

    def test_01_create_no_prompt_native_id_and_model_catalog(self):
        sid = self.create()
        self.assertTrue(sid.startswith('claude-desktop-local_'))
        self.assertFalse(any(e['method'] == 'user/message' for e in self.events(sid)))
        composer = self.api(f'/sessions/{sid}/composer')
        self.assertFalse(composer['model_catalog_complete'])
        self.assertTrue(composer['settings_notice'])
        self.api(f'/sessions/{sid}', {'model': 'fixture-opus'}, 'PATCH')
        self.assertEqual(self.api(f'/sessions/{sid}/composer')['model'], 'fixture-opus')

    def test_02_text_final_id_and_native_failure(self):
        for text, status in [('hello', 'idle'), ('fail', 'error'), ('fail-result-only', 'error')]:
            sid = self.create()
            self.api(f'/sessions/{sid}/messages', {'text': text})
            self.wait(sid, status)
            events = self.events(sid)
            self.assertEqual(sum(e['method'] == 'user/message' for e in events), 1)
            ids = {e['params']['item']['id'] for e in events if e['method'] == 'item/completed'}
            self.assertTrue(all(e['params']['itemId'] in ids for e in events if e['method'] == 'item/agentMessage/delta'))
            completion = next(e for e in events if e['method'] == 'turn/completed')
            self.assertEqual(completion['params']['turn']['status'], 'completed' if text == 'hello' else 'failed')

    def test_03_native_permissions_and_question_answers(self):
        for text in ('approval', 'question'):
            sid = self.create()
            self.api(f'/sessions/{sid}/messages', {'text': text})
            pending = self.pending(sid)
            result = {'decision': 'accept'} if text == 'approval' else {'answers': {'0': {'answers': ['free answer']}}}
            self.api(f'/sessions/{sid}/respond', {'request_id': pending['request_id'], 'result': result})
            self.wait(sid, 'idle')
            self.assertEqual(sum(e['method'] == 'user/message' for e in self.events(sid)), 1)

    def test_04_cancel_busy_and_explicit_steer_rejection(self):
        sid = self.create()
        self.api(f'/sessions/{sid}/messages', {'text': 'wait'})
        self.wait(sid, 'running')
        for _ in range(100):
            if any(e['method'] == 'turn/started' for e in self.events(sid)):
                break
            time.sleep(.025)
        with self.assertRaises(urllib.error.HTTPError):
            self.api(f'/sessions/{sid}/messages', {'text': 'no steer', 'mode': 'steer'})
        self.api(f'/sessions/{sid}/interrupt', {})
        self.wait(sid, 'idle')
        event = next(e for e in self.events(sid) if e['method'] == 'turn/completed')
        self.assertEqual(event['params']['turn']['status'], 'interrupted')

    def test_05_bounded_attachments_use_native_send_contract(self):
        sid = self.create()
        path = self.workspace / 'attachment.txt'
        path.write_text('fixture attachment')
        self.api(f'/sessions/{sid}/messages', {'text': 'attach', 'attachments': [str(path)]})
        self.wait(sid, 'idle')
        calls = [c for c in self.broker.calls if c.get('method') == 'send' and c['args'][0]['sessionId'] == sid.removeprefix('claude-desktop-')]
        self.assertEqual(calls[-1]['args'][0]['attachments'][0]['name'], 'attachment.txt')

    def test_06_gap_disconnect_invalidates_pending_without_resend(self):
        sid = self.create()
        self.api(f'/sessions/{sid}/messages', {'text': 'approval'})
        pending = self.pending(sid)
        self.broker.gap = True
        self.wait(sid, 'disconnected')
        self.broker.gap = False
        with self.assertRaises(urllib.error.HTTPError):
            self.api(f'/sessions/{sid}/respond', {'request_id': pending['request_id'], 'result': {'decision': 'accept'}})
        self.assertFalse(any(c.get('method') == 'respondToToolPermission' and c['args'][0] == pending['request_id'] for c in self.broker.calls))

    def test_07_reconnect_same_native_history_without_cli(self):
        sid = self.create()
        self.api(f'/sessions/{sid}/messages', {'text': 'tool-cycle'})
        self.wait(sid, 'idle')
        native = self.api(f'/sessions/{sid}')['session']['thread_id']
        original_cli = self.broker.rows[native]['cliSessionId']
        # Desktop can move to a new CLI lineage while old messages retain the
        # CLI UUID in their own SDK envelope. Current snapshot is not history.
        self.broker.rows[native]['cliSessionId'] = str(uuid.uuid4())
        self.__class__.process.terminate()
        self.__class__.process.wait(timeout=10)
        self.__class__.start()
        history = self.api(f'/sessions/{sid}/history?limit=20')
        self.assertTrue(history['events'])
        self.api(f'/sessions/{sid}/connect', {})
        self.assertEqual(self.api(f'/sessions/{sid}')['session']['thread_id'], native)
        events = self.events(sid)
        self.assertEqual(sum(e['method'] == 'user/message' for e in events), 1)
        self.assertEqual(sum(e['method'] == 'item/completed' and e['params']['item']['type'] == 'agentMessage' for e in events), 1)
        tool_starts = [e for e in events if e['method'] == 'item/started' and e['params']['item']['type'] == 'commandExecution']
        tool_finals = [e for e in events if e['method'] == 'item/completed' and e['params']['item']['type'] == 'commandExecution']
        self.assertEqual(len(tool_starts), 1)
        self.assertEqual(len(tool_finals), 1)
        self.assertEqual(tool_starts[0]['params']['item']['id'], tool_finals[0]['params']['item']['id'])
        self.assertEqual(tool_finals[0]['params']['item']['command'], 'pwd')
        self.assertEqual(tool_finals[0]['params']['item']['aggregatedOutput'], 'synthetic output')
        projected = [e for e in events if e['method'] in ('user/message', 'item/started', 'item/completed') and e['params'].get('sourceEventKey')]
        self.assertTrue(all(e['params']['claudeCliSessionId'] == original_cli for e in projected))

    def test_08_plugin_features_survive_connector_arriving_after_startup(self):
        hidden = self.private / 'host-hidden.json'
        self.descriptor.rename(hidden)
        try:
            plugin = next(p for p in self.api('/plugins')['plugins'] if p['id'] == 'claude-desktop')
            self.assertFalse(plugin['available'])
            self.assertIn('chat', plugin['capabilities'])
            self.assertIn('models', plugin['capabilities'])
        finally:
            hidden.rename(self.descriptor)
        plugin = next(p for p in self.api('/plugins')['plugins'] if p['id'] == 'claude-desktop')
        self.assertTrue(plugin['available'])
        self.assertIn('chat', plugin['capabilities'])

    def test_09_void_send_and_user_echo_are_submission_evidence_only(self):
        sid = self.create()
        result = self.api(f'/sessions/{sid}/messages', {'text': 'accepted-only'})
        self.assertIsNone(result['turn'])
        self.assertEqual(result['submission']['status'], 'submitted')
        self.assertEqual(result['submission']['deliveryState'], 'unknown')
        time.sleep(.15)
        events = self.events(sid)
        self.assertTrue(any(e['method'] == 'user/message' for e in events))
        self.assertFalse(any(e['method'] in ('turn/started', 'turn/completed') for e in events))
        with self.assertRaises(urllib.error.HTTPError):
            self.api(f'/sessions/{sid}/messages', {'text': 'must not retry unconfirmed submission'})

    def test_10_new_default_mode_does_not_overwrite_existing_native_auto(self):
        sid = self.create()
        self.assertEqual(self.broker.rows[sid.removeprefix('claude-desktop-')]['permissionMode'], 'default')
        native = 'local_' + str(uuid.uuid4())
        with self.broker.lock:
            self.broker.row(native)
        sid = 'claude-desktop-' + native
        self.assertTrue(any(s['id'] == sid for s in self.api('/sessions')['sessions']))
        self.api(f'/sessions/{sid}/connect', {})
        self.assertEqual(self.broker.rows[native]['permissionMode'], 'auto')
        self.assertFalse(any(c.get('method') == 'setPermissionMode' for c in self.broker.calls))


class DefaultProfiles(unittest.TestCase):
    api = base.ClaudeIntegration.api

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='anywork-claude-profiles-')
        cls.base = pathlib.Path(cls.temp.name).resolve()
        cls.workspace = cls.base / 'workspace'
        cls.workspace.mkdir()
        cls.oshome = cls.base / 'home'
        cls.oshome.mkdir()
        parent = cls.oshome / ('Library/Application Support' if sys.platform == 'darwin' else 'appdata' if os.name == 'nt' else '.config')
        cls.roots = [parent / profile / 'claude-code-sessions' for profile in ('Claude', 'Claude-3p')]
        cls.native = ['local_' + str(uuid.uuid4()) for _ in cls.roots]
        cls.paths = []
        config = cls.oshome / '.claude'
        transcript = config / 'projects/fixture'
        transcript.mkdir(parents=True)
        for root, native in zip(cls.roots, cls.native):
            cli = str(uuid.uuid4())
            org = root / 'synthetic-account/synthetic-org'
            org.mkdir(parents=True)
            path = org / (native + '.json')
            cls.paths.append(path)
            path.write_text(json.dumps({'sessionId': native, 'cliSessionId': cli, 'cwd': str(cls.workspace), 'cloudSessionId': 'remote-control-is-still-local', 'title': 'Synthetic profile history'}))
            (transcript / (cli + '.jsonl')).write_text(json.dumps({'uuid': 'synthetic-' + cli, 'type': 'user', 'sessionId': cli, 'cwd': str(cls.workspace), 'message': {'content': 'synthetic profile prompt'}}) + '\n')
        cls.env = {**os.environ, 'HOME': str(cls.oshome), 'APPDATA': str(cls.oshome / 'appdata'), 'XDG_CONFIG_HOME': str(cls.oshome / '.config'), 'ANYWORK_CLAUDE_HISTORY_ROOT': str(config), 'ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR': str(cls.base / 'missing-descriptor'), 'ANYWORK_CLAUDE_BIN': str(cls.base / 'missing-cli')}
        cls.env.pop('ANYWORK_CLAUDE_DESKTOP_HISTORY_ROOT', None)
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            cls.port = s.getsockname()[1]
        cls.log = open(cls.base / 'server.log', 'w+')
        DesktopAdapter.start.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.log.close()
        cls.temp.cleanup()

    def test_01_discovers_both_default_roots_preserves_profile_and_rc_identity(self):
        sessions = self.api('/sessions')['sessions']
        for native, root in zip(self.native, self.roots):
            sid = 'claude-desktop-' + native
            self.assertTrue(any(s['id'] == sid for s in sessions))
            history = self.api(f'/sessions/{sid}/history?limit=20')
            self.assertTrue(history['events'])
            self.assertEqual(history['events'][0]['params']['claudeDesktopProfileRoot'], str(root))

    def test_02_ambiguous_cross_profile_id_preserves_cache_and_reports_notice(self):
        sid = 'claude-desktop-' + self.native[0]
        before = self.api(f'/sessions/{sid}/history?limit=20')['events']
        duplicate = self.paths[1].parent / self.paths[0].name
        duplicate.write_text(self.paths[0].read_text())
        after = self.api(f'/sessions/{sid}/history?limit=20')
        self.assertEqual(before, after['events'])
        self.assertIn('Ambiguous', after['history_notice'])


if __name__ == '__main__':
    unittest.main()
