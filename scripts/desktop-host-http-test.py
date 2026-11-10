#!/usr/bin/env python3
"""Test the real AnyWork HTTP adapter against an isolated framed desktop host.

No original application, account, private conversation or real Codex engine is
used. The explicit IPC socket, home, catalog and workspace are temporary. These
tests establish adapter behavior against a fixture, not desktop compatibility.
Build the debug server before running this script; ANYWORK_BINARY can override it.
"""
import copy
import concurrent.futures
import fcntl
import json
import os
import pathlib
import shlex
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
BINARY = os.environ.get('ANYWORK_BINARY', str(ROOT / 'target/debug/anywork'))
TOKEN = 'isolated-desktop-http-fixture-token'
LOCAL_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
THREAD = 'desktop-http-fixture'
OWNER = 'original-fixture-owner'
BASE = '/sessions/codex-' + THREAD


def read_exact(stream, count):
    value = b''
    while len(value) < count:
        part = stream.recv(count - len(value))
        if not part:
            raise EOFError()
        value += part
    return value


def receive(stream):
    length = struct.unpack('<I', read_exact(stream, 4))[0]
    if not 0 < length <= 0x10000000:
        raise ValueError('Invalid fixture frame length')
    value = json.loads(read_exact(stream, length))
    if not isinstance(value, dict):
        raise ValueError('Invalid fixture envelope')
    return value


class Connection:
    def __init__(self, stream, client):
        self.stream, self.client = stream, client
        self.lock = threading.Lock()

    def send(self, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        frame = struct.pack('<I', len(body)) + body
        with self.lock:
            # Exercise exact reads across a fragmented header and UTF-8 body.
            for start, end in [(0, 1), (1, 3), (3, 7), (7, len(frame))]:
                self.stream.sendall(frame[start:end])


class Host(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True

    def __init__(self, path, workspace):
        self.lock = threading.RLock()
        self.frames, self.errors, self.connections = [], [], []
        self.followers = {}
        self.extra_states = {}
        self.revision = 10
        self.hold_snapshots = False
        self.resnapshot_requested = threading.Event()
        self.wrong_owner = False
        self.no_owner = False
        self.defer_approval_resolution = False
        self.goal_pause_error = None
        self.state = {
            'id': THREAD, 'cwd': str(workspace), 'title': '隔离桌面原会话',
            'turns': [{'turnId': 'original-turn', 'status': 'inProgress',
                       'params': {'input': [{'type': 'text', 'text': '原始输入'}]},
                       'items': [{'id': 'original-output', 'type': 'agentMessage',
                                  'text': '原进程仍在执行'}]}],
            'requests': [], 'threadRuntimeStatus': {'type': 'active', 'activeFlags': []},
            'latestModel': 'fixture', 'latestReasoningEffort': 'medium',
            'latestThreadSettings': {'model': 'fixture', 'reasoningEffort': 'medium'},
            'latestCollaborationMode': {'mode': 'default', 'settings': {
                'model': 'fixture', 'reasoning_effort': 'medium', 'developer_instructions': None}},
            'unknownFutureField': {'保留': ['完整', '状态']},
        }
        super().__init__(str(path), Handler)
        pathlib.Path(path).chmod(0o600)

    def snapshot(self, connection, owner=OWNER, thread=THREAD):
        with self.lock:
            if self.hold_snapshots:
                self.resnapshot_requested.set()
                return
            state, revision = copy.deepcopy(self.extra_states.get(thread, self.state)), self.revision
        connection.send({'type': 'broadcast', 'method': 'thread-stream-state-changed',
                         'version': 11, 'sourceClientId': owner,
                         'targetClientIds': [connection.client], 'params': {
                             'conversationId': thread, 'hostId': 'local',
                             'change': {'type': 'snapshot', 'revision': revision,
                                        'conversationState': state}}})

    def publish(self, change=None):
        with self.lock:
            followers = list(self.followers.values())
        for connection in followers:
            try:
                if change is None:
                    self.snapshot(connection)
                else:
                    connection.send({'type': 'broadcast',
                                     'method': 'thread-stream-state-changed', 'version': 11,
                                     'sourceClientId': OWNER,
                                     'targetClientIds': [connection.client], 'params': {
                                         'conversationId': THREAD, 'hostId': 'local',
                                         'change': change}})
            except OSError:
                pass

    def update(self, mutate):
        with self.lock:
            mutate(self.state)
            self.revision += 1
        self.publish()

    def finish(self):
        def mutate(state):
            state['turns'][-1]['status'] = 'completed'
            state['threadRuntimeStatus'] = {'type': 'idle'}
        self.update(mutate)

    def pending(self, requests):
        def mutate(state):
            state['requests'] = requests
            state['threadRuntimeStatus']['activeFlags'] = ['waitingOnApproval'] if requests else []
        self.update(mutate)

    def mutations(self, method=None):
        with self.lock:
            return [copy.deepcopy(frame) for frame in self.frames
                    if frame.get('type') == 'request'
                    and frame.get('method', '').startswith('thread-follower-')
                    and frame.get('method') != 'thread-follower-read-model-settings'
                    and (method is None or frame['method'] == method)]

    def disconnect_owner(self):
        with self.lock:
            connections = list(self.followers.values())
        for connection in connections:
            try:
                connection.send({'type': 'broadcast', 'method': 'client-status-changed',
                                 'params': {'clientId': OWNER, 'status': 'disconnected'}})
                connection.stream.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        host = self.server
        with host.lock:
            connection = Connection(self.request, 'follower-' + str(len(host.connections) + 1))
            host.connections.append(connection)
        try:
            while True:
                frame = receive(self.request)
                with host.lock:
                    host.frames.append(frame)
                if frame['type'] == 'broadcast':
                    if frame['method'] == 'thread-stream-following-changed':
                        assert frame['targetClientIds'] == [OWNER], frame
                        thread = frame['params']['conversationId']
                        assert thread == THREAD or thread in host.extra_states, frame
                        key = connection.client if thread == THREAD else (connection.client, thread)
                        if frame['params']['following']:
                            with host.lock:
                                host.followers[key] = connection
                            host.snapshot(connection, owner='unrelated-owner')
                            host.snapshot(connection, thread='unrelated-thread')
                            host.snapshot(connection, thread=thread)
                        else:
                            with host.lock:
                                host.followers.pop(key, None)
                    continue
                assert frame['type'] == 'request', frame
                method, params = frame['method'], frame.get('params', {})
                handled = OWNER
                if method == 'initialize':
                    assert frame['version'] == 0
                    result, handled = {'clientId': connection.client}, connection.client
                elif method == 'thread-owner-discovery':
                    if host.no_owner:
                        connection.send({'type': 'response', 'requestId': frame['requestId'],
                                         'resultType': 'error', 'method': method, 'error': 'no-client-found'})
                        continue
                    assert params['hostId'] == 'local', frame
                    if params['conversationId'] != THREAD and params['conversationId'] not in host.extra_states:
                        connection.send({'type': 'response', 'requestId': frame['requestId'],
                                         'resultType': 'error', 'method': method, 'error': 'no-client-found'})
                        continue
                    result = {'supportsUntrustedAppInput': True}
                else:
                    assert frame['targetClientId'] == OWNER, frame
                    assert frame['sourceClientId'] == connection.client, frame
                    assert 'hostId' not in frame and params['conversationId'] == THREAD, frame
                    if method == 'thread-follower-steer-turn':
                        assert frame['version'] == 1
                        assert params['restoreMessage']['cwd'] == host.state['cwd']
                        assert params['restoreMessage']['context']['workspaceRoots'] == [host.state['cwd']]
                        assert params['input'][0]['text']
                        result = {'result': {'turnId': host.state['turns'][-1]['turnId']}}
                    elif method == 'thread-follower-start-turn':
                        assert frame['version'] == 2
                        request = params['turnStart']['request']
                        assert request['threadId'] == THREAD
                        assert set(request) == {'threadId', 'input', 'clientUserMessageId'}, request
                        def start(state):
                            state['turns'].append({'turnId': 'web-started-turn', 'status': 'inProgress',
                                                   'params': request, 'items': []})
                            state['threadRuntimeStatus'] = {'type': 'active', 'activeFlags': []}
                        host.update(start)
                        result = {'result': {'turn': {'id': 'web-started-turn', 'status': 'inProgress'}}}
                    elif method == 'thread-follower-update-thread-settings':
                        assert frame['version'] == 2
                        settings = params['threadSettings']
                        def update(state):
                            state['latestThreadSettings'].update(settings)
                            if 'effort' in settings:
                                state['latestReasoningEffort'] = settings['effort']
                            if 'model' in settings:
                                state['latestModel'] = settings['model']
                            if 'collaborationMode' in settings:
                                state['latestCollaborationMode'] = settings['collaborationMode']
                        host.update(update)
                        result = {'applied': True}
                    elif method in ('thread-follower-command-approval-decision',
                                    'thread-follower-file-approval-decision'):
                        assert frame['version'] == 1 and params['decision'] == 'decline', frame
                        # Numeric 17 and string "17" are separate native requests.
                        request_id = params['requestId']
                        with host.lock:
                            matched = [request for request in host.state['requests']
                                       if type(request['id']) is type(request_id) and request['id'] == request_id]
                        assert len(matched) == 1, frame
                        if not host.defer_approval_resolution:
                            host.pending([request for request in host.state['requests']
                                          if not (type(request['id']) is type(request_id) and request['id'] == request_id)])
                        result = {'ok': True}
                    elif method == 'thread-follower-interrupt-turn':
                        assert frame['version'] in {3, 4}, frame
                        assert params['mode'] == 'user-stop', frame
                        if frame['version'] == 4:
                            assert params['expectedTurnId'] == host.state['turns'][-1]['turnId'], frame
                        else:
                            assert 'expectedTurnId' not in params, frame
                        def interrupt(state):
                            if frame['version'] == 3 and state.get('threadGoal') and not host.goal_pause_error:
                                state['threadGoal']['status'] = 'paused'
                            state['turns'][-1]['status'] = 'interrupted'
                            state['threadRuntimeStatus'] = {'type': 'idle'}
                        host.update(interrupt)
                        result = {'ok': True, 'goalPauseError': host.goal_pause_error}
                    else:
                        raise AssertionError('Unexpected host method: ' + method)
                    if host.wrong_owner:
                        handled = 'different-owner'
                connection.send({'type': 'response', 'requestId': frame['requestId'],
                                 'resultType': 'success', 'method': method,
                                 'handledByClientId': handled, 'result': result})
        except (EOFError, OSError):
            pass
        except Exception as error:
            with host.lock:
                host.errors.append(repr(error))
        finally:
            with host.lock:
                for key in [key for key, value in host.followers.items() if value is connection]:
                    host.followers.pop(key, None)


class DesktopHostHTTP(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aw-dhttp-', dir='/tmp')
        self.base = pathlib.Path(self.temp.name).resolve()
        self.workspace, self.home = self.base / 'workspace', self.base / 'codex-home'
        self.workspace.mkdir()
        self.home.mkdir()
        self.host = Host(self.base / 'host.sock', self.workspace)
        self.host_thread = threading.Thread(target=self.host.serve_forever, daemon=True)
        self.host_thread.start()
        self.process = None
        self.log = (self.base / 'server.log').open('w+')
        self.calls = self.base / 'catalog-calls.jsonl'
        catalog = self.catalog = self.base / 'catalog.json'
        catalog.write_text(json.dumps([{'id': THREAD, 'cwd': str(self.workspace),
                                        'name': '隔离桌面原会话', 'source': 'vscode',
                                        'createdAt': 1, 'updatedAt': 2}]))
        cli = self.base / 'codex-fixture'
        cli.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' ' +
                       shlex.quote(str(ROOT / 'scripts/fake-agent.py')) + ' "$@"\n')
        cli.chmod(0o700)
        locks = self.home / 'thread-writer-locks'
        locks.mkdir()
        self.writer = (locks / (THREAD + '.lock')).open('w')
        fcntl.flock(self.writer, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with socket.socket() as address:
            address.bind(('127.0.0.1', 0))
            self.port = address.getsockname()[1]
        env = {key: value for key, value in os.environ.items()
               if key in {'PATH', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL'}}
        data = self.base / 'data'
        data.mkdir()
        (data / 'desktop-host.json').write_text(json.dumps({'version': 1, 'socket': str(self.base / 'host.sock')}))
        env.update(ANYWORK_CODEX_DATA_DIR=str(self.home), CODEX_BIN=str(cli),
                   FAKE_AGENT_STATE_DIR=str(self.base / 'fake-agent-state'),
                   FAKE_AGENT_MODEL_GATE=str(self.base / 'model-gate'),
                   FAKE_CODEX_CATALOG=str(catalog), FAKE_AGENT_CALLS=str(self.calls))
        self.process = subprocess.Popen([
            BINARY, '--bind', f'127.0.0.1:{self.port}', '--workspace', str(self.workspace),
            '--data-dir', str(self.base / 'data'), '--plugins-dir', str(self.base / 'plugins'),
            '--token', TOKEN], cwd=ROOT, env=env, stdout=self.log, stderr=self.log)
        try:
            self.wait(lambda: self.healthy(), 'AnyWork startup')
            sessions = self.request('/sessions')['sessions']
            self.assertIn('codex-' + THREAD, [session['id'] for session in sessions])
            if not self._testMethodName.startswith('test_sidebar_'):
                self.assertTrue(self.request(BASE + '/connect', {})['connected'])
                self.wait(lambda: self.request(BASE)['session']['status'] == 'running', 'initial desktop state')
        except Exception:
            self.cleanup()
            self.log.seek(0)
            print(self.log.read(), file=sys.stderr)
            self.log.close()
            self.temp.cleanup()
            raise

    def healthy(self):
        if self.process.poll() is not None:
            return False
        try:
            self.request('/health')
            return True
        except OSError:
            return False

    def cleanup(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=10)
        self.host.disconnect_owner()
        self.host.shutdown()
        self.host.server_close()
        self.writer.close()

    def tearDown(self):
        try:
            self.cleanup()
            self.assertEqual(self.host.errors, [])
            calls = [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []
            forbidden = {'thread/resume', 'thread/start', 'thread/fork', 'turn/start',
                         'turn/steer', 'turn/interrupt', 'thread/settings/update'}
            self.assertEqual([call for call in calls if call.get('method') in forbidden], [],
                             'Catalog must never resume a second engine or receive mutations')
            for frame in self.host.mutations():
                self.assertEqual(frame['targetClientId'], OWNER)
                self.assertEqual(frame['params']['conversationId'], THREAD)
        finally:
            self.log.close()
            self.temp.cleanup()

    def request(self, path, data=None):
        request = urllib.request.Request(
            f'http://127.0.0.1:{self.port}/api' + path,
            data=None if data is None else json.dumps(data).encode(),
            headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
        with LOCAL_HTTP.open(request, timeout=15) as response:
            return json.load(response)

    def wait(self, condition, description='fixture update', timeout=6):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = condition()
            if result:
                return result
            time.sleep(.02)
        self.fail('Timed out waiting for ' + description)

    def events(self):
        return self.request(BASE + '/export')['events']

    def sidebar_status(self, thread=THREAD):
        sessions = self.request('/sessions')['sessions']
        return next((s['status'] for s in sessions if s['thread_id'] == thread), None)

    def test_sidebar_observes_multiple_unopened_threads_without_creating_control_runtimes(self):
        self.wait(lambda: self.sidebar_status() == 'running', 'unopened running thread')
        second = 'another-desktop-thread'
        with self.host.lock:
            self.host.extra_states[second] = {**copy.deepcopy(self.host.state), 'id': second,
                                              'threadRuntimeStatus': {'type': 'idle'}}
        rows = json.loads(self.catalog.read_text())
        rows.append({**rows[0], 'id': second, 'name': '未打开的另一会话', 'updatedAt': 1})
        self.catalog.write_text(json.dumps(rows))
        self.wait(lambda: self.sidebar_status(second) == 'idle', 'second unopened idle thread')
        with self.host.lock:
            self.host.extra_states[second]['threadRuntimeStatus'] = {'type': 'active', 'activeFlags': []}
            self.host.revision += 1
        self.wait(lambda: self.sidebar_status(second) == 'running', 'second thread starts on desktop')
        self.assertEqual(self.sidebar_status(), 'running')
        self.assertEqual(self.events(), [], 'Sidebar observations must not create a control runtime')
        self.assertEqual(self.host.mutations(), [])
        methods = {frame.get('method') for frame in self.host.frames}
        self.assertLessEqual(methods, {'initialize', 'thread-owner-discovery', 'thread-stream-following-changed'})

    def test_sidebar_updates_running_waiting_idle_and_restarted_turn_without_selection(self):
        self.wait(lambda: self.sidebar_status() == 'running')
        self.host.pending([{'id': 71, 'method': 'item/commandExecution/requestApproval', 'params': {}}])
        self.wait(lambda: self.sidebar_status() == 'waiting', 'unopened approval wait')
        self.host.pending([])
        self.wait(lambda: self.sidebar_status() == 'running', 'approval resolved elsewhere')
        self.host.finish()
        self.wait(lambda: self.sidebar_status() == 'idle', 'unopened completion')
        def restart(state):
            state['threadRuntimeStatus'] = {'type': 'active', 'activeFlags': []}
            state['turns'].append({'turnId': 'next-desktop-turn', 'status': 'inProgress', 'items': []})
        self.host.update(restart)
        self.wait(lambda: self.sidebar_status() == 'running', 'new desktop turn')
        original = self.request(BASE)['session']
        self.assertEqual(original['status'], 'running', 'Single-session read must share observed status')
        self.assertEqual(original['updated_at'], 2000, 'Status observations must not reorder history')
        self.assertEqual(self.events(), [])
        self.assertEqual(self.host.mutations(), [])

    def test_sidebar_rejects_wrong_owner_and_gap_then_resynchronizes(self):
        self.wait(lambda: self.sidebar_status() == 'running')
        self.host.hold_snapshots = True
        self.host.finish()
        with self.host.lock:
            connections = list(self.host.followers.values())
            self.host.hold_snapshots = False
            for connection in connections:
                self.host.snapshot(connection, owner='wrong-owner')
            self.host.hold_snapshots = True
        self.assertEqual(self.sidebar_status(), 'running', 'Wrong owner cannot report idle')
        self.host.publish({'type': 'patches', 'baseRevision': 999, 'revision': 1000, 'patches': []})
        self.wait(lambda: self.sidebar_status() == 'external', 'revision gap invalidates status')
        self.host.hold_snapshots = False
        self.wait(lambda: self.sidebar_status() == 'idle', 'snapshot repair restores current status')
        self.assertEqual(self.host.mutations(), [])

    def test_sidebar_clears_disconnected_owner_and_reconnects_without_selection(self):
        self.wait(lambda: self.sidebar_status() == 'running')
        self.host.no_owner = True
        self.host.disconnect_owner()
        self.wait(lambda: self.sidebar_status() == 'external', 'owner disconnect clears running')
        self.host.no_owner = False
        self.wait(lambda: self.sidebar_status() == 'running', 'sidebar reconnect', timeout=16)
        self.assertEqual(self.events(), [])
        self.assertEqual(self.host.mutations(), [])

    def test_sidebar_expires_silent_owner_without_sticky_running_indicator(self):
        self.wait(lambda: self.sidebar_status() == 'running')
        self.host.hold_snapshots = True
        self.wait(lambda: self.sidebar_status() == 'external', 'silent owner expires', timeout=16)
        self.host.finish()
        self.host.hold_snapshots = False
        self.wait(lambda: self.sidebar_status() == 'idle', 'owner responds again', timeout=16)
        self.assertEqual(self.host.mutations(), [])

    def test_slow_snapshots_keep_at_most_one_request_in_flight_per_connection(self):
        self.host.hold_snapshots = True
        self.host.resnapshot_requested.clear()
        self.assertTrue(self.host.resnapshot_requested.wait(3), 'Active adapter requests a snapshot')
        with self.host.lock:
            before = len(self.host.frames)
        time.sleep(3.2)
        with self.host.lock:
            following = [frame for frame in self.host.frames[before:]
                         if frame.get('method') == 'thread-stream-following-changed'
                         and frame['params']['following']]
        by_client = {}
        for frame in following:
            client = frame['sourceClientId']
            by_client[client] = by_client.get(client, 0) + 1
        self.assertTrue(all(count <= 1 for count in by_client.values()), by_client)
        self.host.hold_snapshots = False
        self.host.publish()
        self.wait(lambda: self.request(BASE)['session']['status'] == 'running', 'delayed snapshot recovers')
        self.host.finish()
        self.wait(lambda: self.request(BASE)['session']['status'] == 'idle', 'completion after slow snapshot')

    def approval_events(self, after=0):
        return [event for event in self.events() if event['seq'] > after
                and event['method'].endswith('/requestApproval') and event.get('request_id')]

    def add_approvals(self, ids=(17, '17')):
        requests = [{'id': value, 'method': 'item/commandExecution/requestApproval',
                     'params': {'threadId': THREAD, 'turnId': 'original-turn',
                                'command': 'echo fixture', 'cwd': str(self.workspace)}} for value in ids]
        before = max([event['seq'] for event in self.events()] or [0])
        self.host.pending(requests)
        return self.wait(lambda: self.approval_events(before) if len(self.approval_events(before)) == len(ids) else None)

    def test_connect_steer_start_and_settings_keep_original_owner(self):
        self.assertTrue(self.request(BASE + '/composer')['settings_available'])
        image = self.workspace / '图片 one.png'
        image.write_bytes(b'fixture image')
        result = self.request(BASE + '/messages', {'text': '在原执行中引导', 'attachments': [str(image)]})
        self.assertEqual(result['turnId'], 'original-turn')
        self.assertEqual(len(self.host.mutations('thread-follower-steer-turn')), 1)
        self.assertEqual(len(self.host.mutations('thread-follower-start-turn')), 0)
        steer = self.host.mutations('thread-follower-steer-turn')[0]['params']
        self.assert_image_restore(steer['input'], steer['restoreMessage'], steer['attachments'], image)
        selected = self.request(BASE + '/composer', {'action': 'settings', 'effort': 'high'})
        self.assertEqual(selected['effort'], 'high')
        self.wait(lambda: self.request(BASE + '/composer')['effort'] == 'high')
        self.host.finish()
        self.wait(lambda: self.request(BASE)['session']['status'] == 'idle')
        result = self.request(BASE + '/messages', {'text': '沿用原会话开始下一次', 'attachments': [str(image)]})
        self.assertEqual(result['turn']['id'], 'web-started-turn')
        self.assertEqual(len(self.host.mutations('thread-follower-start-turn')), 1)
        start = self.host.mutations('thread-follower-start-turn')[0]['params']['turnStart']
        self.assert_image_restore(start['request']['input'], start['context']['restoreMessage'], start['context']['attachments'], image)
        self.assertEqual(self.request(BASE)['session']['thread_id'], THREAD)

    def test_goal_capabilities_and_rejection_before_delivery_or_queueing(self):
        controls = self.request(BASE + '/composer')
        self.assertEqual(controls['goal_capabilities']['pause'], True)
        for operation in ['create', 'edit', 'resume', 'clear']:
            self.assertEqual(controls['goal_capabilities'][operation], False)
        original = copy.deepcopy(self.host.state)
        before = len(self.host.frames)
        for mode in ['steer', 'queue']:
            with self.assertRaises(urllib.error.HTTPError) as raised:
                self.request(BASE + '/messages', {'text': 'must stay in draft', 'goal': True, 'mode': mode})
            self.assertIn('未发送消息', raised.exception.read().decode())
        for data in [{'action': 'goal', 'objective': 'not applied'}, {'action': 'goal_status', 'status': 'active'}, {'action': 'clear_goal'}]:
            with self.assertRaises(urllib.error.HTTPError):
                self.request(BASE + '/composer', data)
        self.assertEqual(self.request(BASE + '/queue')['items'], [])
        self.assertEqual(self.host.state, original)
        self.assertFalse(any('thread-follower-' in f.get('method', '') and f.get('method') not in ['thread-follower-read-model-settings', 'thread-follower-load-complete-history'] for f in self.host.frames[before:] if f.get('type') == 'request'))

    def test_pause_goal_uses_original_owner_and_confirms_desktop_state(self):
        self.host.update(lambda state: state.update(threadGoal={
            'id': 'original-goal', 'objective': 'Original desktop objective', 'status': 'active'}))
        self.wait(lambda: (self.request(BASE + '/composer').get('goal') or {}).get('status') == 'active')
        result = self.request(BASE + '/composer', {'action': 'goal_status', 'status': 'paused'})
        self.assertEqual(result['goal']['status'], 'paused')
        self.assertEqual(result['goal']['objective'], 'Original desktop objective')
        mutations = self.host.mutations('thread-follower-interrupt-turn')
        self.assertEqual(len(mutations), 1)
        self.assertEqual(mutations[0]['version'], 3)
        self.assertNotIn('expectedTurnId', mutations[0]['params'])
        self.assertEqual(mutations[0]['targetClientId'], OWNER)
        self.assertEqual(len(self.host.mutations('thread-follower-start-turn')), 0)
        self.request(BASE + '/composer', {'action': 'goal_status', 'status': 'paused'})
        self.assertEqual(len(self.host.mutations('thread-follower-interrupt-turn')), 1)
        self.assertTrue(any(event['method'] == 'thread/goal/updated' for event in self.events()))

    def test_pause_goal_failure_is_reported_without_faking_state_or_replaying(self):
        self.host.goal_pause_error = 'fixture rejected goal mutation'
        self.host.update(lambda state: state.update(threadGoal={
            'id': 'original-goal', 'objective': 'Original objective', 'status': 'active'}))
        self.wait(lambda: (self.request(BASE + '/composer').get('goal') or {}).get('status') == 'active')
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.request(BASE + '/composer', {'action': 'goal_status', 'status': 'paused'})
        self.assertIn('fixture rejected goal mutation', raised.exception.read().decode())
        self.assertEqual(len(self.host.mutations('thread-follower-interrupt-turn')), 1)
        self.assertEqual(self.request(BASE + '/composer')['goal']['status'], 'active')

    def test_shared_events_poll_watermark_replay_and_authentication(self):
        initial = self.request('/events/poll')
        self.assertEqual(set(initial), {'events', 'cursor', 'has_more'})
        self.assertEqual(initial['events'], [])
        self.assertIs(initial['has_more'], False)
        after = initial['cursor']
        self.host.update(lambda state: state.update(fixtureRevision='new body'))
        page = self.wait(lambda: (page if (page := self.request('/events/poll?after=' + str(after)))['events'] else None))
        self.assertTrue(all(event['seq'] > after and event['session_id'] == 'codex-' + THREAD for event in page['events']))
        self.assertEqual(set(page), {'events', 'cursor', 'has_more'})
        self.assertEqual(page['cursor'], page['events'][-1]['seq'])
        self.assertIs(page['has_more'], False)
        replay = self.request('/events/poll?after=' + str(after))
        self.assertEqual(set(replay), {'events', 'cursor', 'has_more'})
        self.assertEqual(replay['events'][:len(page['events'])], page['events'])
        self.assertEqual(replay['cursor'], replay['events'][-1]['seq'])
        self.assertIs(replay['has_more'], False)
        future = self.request('/events/poll')['cursor'] + 1000
        self.assertEqual(self.request('/events/poll?after=' + str(future)), {'events': [], 'cursor': future, 'has_more': False})
        for endpoint in ['/events', '/events/poll']:
            with self.assertRaises(urllib.error.HTTPError) as raised:
                LOCAL_HTTP.open('http://127.0.0.1:' + str(self.port) + '/api' + endpoint, timeout=3)
            self.assertEqual(raised.exception.code, 401)

    def test_shared_sse_replays_from_cursor_and_streams_desktop_history_changes(self):
        after = self.request('/events/poll')['cursor']
        request = urllib.request.Request(f'http://127.0.0.1:{self.port}/api/events?after={after}', headers={'Authorization': 'Bearer ' + TOKEN})
        with LOCAL_HTTP.open(request, timeout=5) as response:
            self.assertIn('text/event-stream', response.headers['Content-Type'])
            self.host.update(lambda state: state.update(fixtureRevision='stream changed'))
            while True:
                line = response.readline().decode().strip()
                if line.startswith('data:'):
                    event = json.loads(line[5:])
                    self.assertGreater(event['seq'], after)
                    self.assertEqual(event['session_id'], 'codex-' + THREAD)
                    break
        with LOCAL_HTTP.open(request, timeout=5) as response:
            while True:
                line = response.readline().decode().strip()
                if line.startswith('data:'):
                    self.assertEqual(json.loads(line[5:]), event)
                    break

    def assert_image_restore(self, native_input, restore, attachments, image):
        self.assertEqual(native_input[1], {'type': 'localImage', 'path': str(image)})
        self.assertEqual(restore['context']['imageAttachments'], [{
            'id': restore['id'] + ':1', 'src': str(image), 'localPath': str(image)}])
        self.assertEqual(attachments, [{'label': image.name, 'path': str(image),
                                       'fsPath': str(image), 'isImageAttachment': True}])

    def test_approval_native_numeric_and_string_ids_are_distinct(self):
        approvals = self.add_approvals()
        controls = self.request(BASE + "/events/poll?controls=true")["events"]
        self.assertTrue(all(event["method"] in {"serverRequest/resolved", "turn/started", "turn/completed", "thread/status/changed", "plugin/exited"} or event.get("request_id") is not None for event in controls))
        self.assertEqual({event["request_id"] for event in controls if event.get("request_id")}, {event["request_id"] for event in approvals})
        self.assertEqual(len({event['request_id'] for event in approvals}), 2)
        self.assertTrue(all(event['request_id'].startswith('desktop:') for event in approvals))
        for event in approvals:
            self.request(BASE + '/respond', {'request_id': event['request_id'], 'result': {'decision': 'decline'}})
        responses = self.host.mutations('thread-follower-command-approval-decision')
        self.assertEqual([type(frame['params']['requestId']) for frame in responses], [int, str])
        self.assertEqual([frame['params']['requestId'] for frame in responses], [17, '17'])
        before = len(responses)
        with self.assertRaises(urllib.error.HTTPError):
            self.request(BASE + '/respond', {'request_id': approvals[0]['request_id'], 'result': {'decision': 'decline'}})
        self.assertEqual(len(self.host.mutations('thread-follower-command-approval-decision')), before)

    def test_pending_approval_gets_new_epoch_after_owner_disconnect(self):
        first = self.add_approvals(ids=(17,))[0]
        self.host.disconnect_owner()
        # Session GET may refresh uncertain catalog status. The persisted exit
        # event is the unambiguous observation that this adapter epoch ended.
        self.wait(lambda: any(event['seq'] > first['seq'] and event['method'] == 'plugin/exited'
                              for event in self.events()), 'original IPC owner disconnect')
        self.assertEqual(len(self.host.mutations()), 0)
        before = max(event['seq'] for event in self.events())
        self.assertTrue(self.request(BASE + '/connect', {})['connected'])
        second = self.wait(lambda: (self.approval_events(before) or [None])[0])
        self.assertNotEqual(first['request_id'], second['request_id'])
        self.assertNotEqual(first['request_id'].split(':')[1], second['request_id'].split(':')[1])
        with self.assertRaises(urllib.error.HTTPError):
            self.request(BASE + '/respond', {'request_id': first['request_id'], 'result': {'decision': 'decline'}})
        self.assertEqual(len(self.host.mutations()), 0)
        self.request(BASE + '/respond', {'request_id': second['request_id'], 'result': {'decision': 'decline'}})
        self.assertEqual(self.host.mutations()[0]['params']['requestId'], 17)
        self.assertGreaterEqual(len(self.host.connections), 2)

    def test_approval_ack_waits_for_original_owner_snapshot_to_resolve(self):
        approval = self.add_approvals(ids=(17,))[0]
        self.host.defer_approval_resolution = True
        payload = {'request_id': approval['request_id'], 'result': {'decision': 'decline'}}
        self.request(BASE + '/respond', payload)
        self.assertFalse(any(event['method'] == 'serverRequest/resolved'
                             and event['params'].get('requestId') == approval['request_id']
                             for event in self.events()))
        with self.assertRaises(urllib.error.HTTPError):
            self.request(BASE + '/respond', payload)
        self.assertEqual(len(self.host.mutations('thread-follower-command-approval-decision')), 1)
        self.host.pending([])
        self.wait(lambda: any(event['method'] == 'serverRequest/resolved'
                              and event['params'].get('requestId') == approval['request_id']
                              for event in self.events()), 'authoritative approval removal snapshot')

    def test_interrupt_uses_original_turn_and_version_four(self):
        self.request(BASE + '/interrupt', {})
        self.wait(lambda: self.request(BASE)['session']['status'] == 'idle')
        interrupts = self.host.mutations('thread-follower-interrupt-turn')
        self.assertEqual(len(interrupts), 1)
        self.assertEqual(interrupts[0]['version'], 4)
        self.assertEqual(interrupts[0]['params'], {
            'conversationId': THREAD, 'mode': 'user-stop', 'expectedTurnId': 'original-turn'})

    def test_revision_gap_blocks_writes_until_snapshot_resynchronizes(self):
        with self.host.lock:
            base_revision = self.host.revision
            self.host.state['latestReasoningEffort'] = 'high'
            self.host.revision += 1
            revision = self.host.revision
        self.host.publish({'type': 'patches', 'baseRevision': base_revision,
                           'revision': revision,
                           'patches': [{'op': 'replace', 'path': ['latestReasoningEffort'], 'value': 'high'}]})
        self.wait(lambda: self.request(BASE + '/composer')['effort'] == 'high', 'valid incremental patch')
        self.host.hold_snapshots = True
        self.host.resnapshot_requested.clear()
        self.host.publish({'type': 'patches', 'baseRevision': 1,
                           'revision': self.host.revision + 1,
                           'patches': [{'op': 'replace', 'path': ['latestReasoningEffort'], 'value': 'low'}]})
        self.assertTrue(self.host.resnapshot_requested.wait(timeout=3))
        before = len(self.host.mutations())
        with self.assertRaises(urllib.error.HTTPError):
            self.request(BASE + '/composer', {'action': 'settings', 'effort': 'high'})
        self.assertEqual(len(self.host.mutations()), before)
        self.host.hold_snapshots = False
        self.host.update(lambda state: state.update(latestReasoningEffort='low'))
        self.wait(lambda: self.request(BASE + '/composer')['effort'] == 'low')
        self.assertEqual(self.request(BASE + '/composer', {'action': 'settings', 'effort': 'high'})['effort'], 'high')
        self.assertEqual(len(self.host.mutations()), before + 1)

    def test_slow_model_reads_do_not_block_native_message_submission(self):
        gate = self.base / 'model-gate'
        # Both settings and the model picker can be open while a message is sent.
        for endpoint in ('/composer', '/models'):
            gate.write_text('hold catalog metadata')
            calls_before = len(self.calls.read_text().splitlines()) if self.calls.exists() else 0
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                metadata = executor.submit(self.request, BASE + endpoint)
                try:
                    self.wait(lambda: self.calls.exists() and any(
                        json.loads(line).get('method') == 'model/list'
                        for line in self.calls.read_text().splitlines()[calls_before:]), 'blocked model read')
                    self.assertFalse(metadata.done())
                    result = executor.submit(self.request, BASE + '/messages', {'text': 'send while model catalog waits'}).result(timeout=2)
                    self.assertEqual(result['turnId'], 'original-turn')
                    self.assertFalse(metadata.done())
                finally:
                    gate.unlink(missing_ok=True)
                metadata.result(timeout=8)

    def test_wrong_owner_ack_is_rejected_without_automatic_replay(self):
        self.host.wrong_owner = True
        with self.assertRaises(urllib.error.HTTPError):
            self.request(BASE + '/messages', {'text': '错误 owner 的确认不可成功'})
        mutations = self.host.mutations()
        self.assertEqual(len(mutations), 1)
        self.assertEqual(mutations[0]['method'], 'thread-follower-steer-turn')
        self.assertEqual(mutations[0]['targetClientId'], OWNER)

    def test_history_merges_saved_and_live_canonical_input_with_stable_ids(self):
        image = self.base / 'canonical-only.png'
        image.write_bytes(bytes.fromhex('89504e470d0a1a0a') + b'canonical-only-fixture')
        tool_output = '尚未写入磁盘的工具输出\n' + ('x' * 9000)

        def canonical(state):
            original = copy.deepcopy(state['turns'][0])
            original['params']['clientUserMessageId'] = 'canonical-opening-message'
            original['params']['input'].append({'type': 'localImage', 'path': str(image)})
            original['items'].append({'id': 'live-tool', 'type': 'commandExecution',
                                      'command': 'fixture command', 'status': 'completed',
                                      'aggregatedOutput': tool_output})
            saved_overlay = {'turnId': 'old-turn-1', 'status': 'completed',
                             'params': {'input': [{'type': 'text', 'text': '历史问题 1'}]},
                             'items': [{'id': 'old-answer-1', 'type': 'agentMessage',
                                        'text': '桌面最新文本覆盖磁盘早期内容'}]}
            state['turnHistory'] = {'kind': 'canonical', 'history': {
                'isComplete': True, 'islands': [{'newerBoundary': {'status': 'exhausted'},
                                                'entries': [{'value': 'saved'}, {'value': 'current'}]}],
                'entitiesByKey': {'saved': saved_overlay, 'current': original}}}
            # The live legacy tail must not erase the canonical opening image.
            state['turns'][0]['params']['input'] = []

        self.host.update(canonical)

        def projected():
            page = self.request(BASE + '/history?paged=true&limit=20')
            return page if page.get('source') == 'desktop' and any(
                str(image) in event['params'].get('attachments', []) for event in page['events']) else None

        first = self.wait(projected, 'canonical desktop HTTP history')
        text = json.dumps(first, ensure_ascii=False)
        self.assertIn('历史问题 0', text)
        self.assertIn('历史回答 0', text)
        self.assertIn('桌面最新文本覆盖磁盘早期内容', text)
        self.assertNotIn('历史回答 1', text)
        self.assertIn('原进程仍在执行', text)
        identifiers = [event['params']['history_id'] for event in first['events']]
        self.assertEqual(len(set(identifiers)), len(identifiers))
        self.assertEqual(identifiers, [event['params']['history_id'] for event in
                                     self.request(BASE + '/history?paged=true&limit=20')['events']])
        tool = next(event['params']['item'] for event in first['events']
                    if event['params'].get('item', {}).get('id') == 'live-tool')
        self.assertEqual(tool['history_detail'], {'turn_id': 'original-turn', 'item_id': 'live-tool'})
        detail = self.request(BASE + '/history/item?' + urllib.parse.urlencode(tool['history_detail']))
        self.assertEqual(detail['item']['aggregatedOutput'], tool_output)
        latest = self.request(BASE + '/history?paged=true&limit=1')
        self.assertEqual(latest['replace_turn_ids'], ['original-turn'])
        earlier = self.request(BASE + '/history?paged=true&limit=1&cursor=' +
                               urllib.parse.quote(latest['next_cursor'], safe=''))
        self.assertEqual(earlier['replace_turn_ids'], ['old-turn-1'])
        url = f'http://127.0.0.1:{self.port}/api' + BASE + '/image?' + urllib.parse.urlencode({'path': str(image)})
        with LOCAL_HTTP.open(urllib.request.Request(url, headers={
                'Authorization': 'Bearer ' + TOKEN}), timeout=5) as response:
            self.assertEqual(response.read(), image.read_bytes())
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            futures = [executor.submit(self.request, BASE + '/history?paged=true&limit=20'),
                       executor.submit(self.request, BASE + '/composer'),
                       executor.submit(self.request, BASE + '/composer', {'action': 'settings', 'effort': 'high'})]
            results = [future.result(timeout=8) for future in futures]
        self.assertEqual(results[-1]['effort'], 'high')


if __name__ == '__main__':
    unittest.main(verbosity=2)
