#!/usr/bin/env python3
"""Real stdio engine -> cooperative framed host -> real AnyWork HTTP probe.

Uses only a separately installed CLI, a temporary home/workspace, a local fake
model and a fixture parent that already owns stdio. Never connects to the desktop
app. Passing proves this cooperative-parent route, not unmodified-app takeover.
"""
import argparse
import copy
import importlib.util
import json
import os
import pathlib
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


stdio = module('stdio_probe_fixture', 'stdio-hot-attach-probe.py')
http = module('desktop_http_fixture', 'desktop-host-http-test.py')
OWNER = http.OWNER


class RealHost(http.Host):
    def __init__(self, path, workspace, parent, thread, settings):
        self.parent = parent
        self.thread = thread
        self.settings = copy.deepcopy(settings)
        self.engine_lock = threading.RLock()
        self.engine_calls = []
        self.original_answers = []
        self.seen_events = 0
        self.pending_native = {}
        super().__init__(path, workspace)
        self.RequestHandlerClass = RealHandler
        self.refresh()

    def snapshot(self, connection, owner=OWNER, thread=None):
        super().snapshot(connection, owner=owner, thread=thread or self.thread)

    def refresh(self):
        with self.engine_lock:
            native = self.parent.call('thread/read', {
                'threadId': self.thread, 'includeTurns': True})['thread']
            assert native['id'] == self.thread
            for event in self.parent.events[self.seen_events:]:
                if event.get('id') is not None and event.get('method', '').endswith('/requestApproval'):
                    key = json.dumps(event['id'])
                    self.pending_native[key] = copy.deepcopy(event)
                elif event.get('method') == 'serverRequest/resolved':
                    self.pending_native.pop(json.dumps(event['params']['requestId']), None)
                elif event.get('method') == 'thread/settings/updated':
                    self.settings.update(event['params']['threadSettings'])
            self.seen_events = len(self.parent.events)
            turns = copy.deepcopy(native.get('turns', []))
            for turn in turns:
                turn['turnId'] = turn['id']
                opening = next((item for item in turn.get('items', []) if item.get('type') == 'userMessage'), {})
                turn.setdefault('params', {'input': opening.get('content', []),
                                           'clientUserMessageId': opening.get('clientId')})
            state = {'id': self.thread, 'cwd': native['cwd'], 'title': 'Real isolated stdio engine',
                     'turns': turns, 'requests': list(self.pending_native.values()),
                     'threadRuntimeStatus': native['status'],
                     'latestThreadSettings': copy.deepcopy(self.settings),
                     'latestModel': self.settings.get('model'),
                     'latestReasoningEffort': self.settings.get('reasoningEffort', self.settings.get('effort')),
                     'latestCollaborationMode': self.settings.get('collaborationMode')}
            with self.lock:
                changed = state != self.state
                self.state = state
                if changed:
                    self.revision += 1
        if changed:
            self.publish()

    def engine_call(self, method, params):
        with self.engine_lock:
            self.engine_calls.append({'method': method, 'params': copy.deepcopy(params)})
            result = self.parent.call(method, params)
            self.refresh()
            return result

    def answer(self, request_id, decision):
        assert decision in {'decline', 'cancel'}, 'The fixture command must never execute'
        with self.engine_lock:
            pending = self.pending_native.get(json.dumps(request_id))
            assert pending is not None and type(pending['id']) is type(request_id)
            self.original_answers.append({'id': copy.deepcopy(request_id), 'decision': decision})
            self.parent.send({'id': request_id, 'result': {'decision': decision}})
            self.refresh()

    def active(self):
        with self.lock:
            return next((turn['turnId'] for turn in reversed(self.state['turns'])
                         if turn['status'] == 'inProgress'), None)

    def turn_status(self, turn):
        with self.lock:
            return next((item['status'] for item in self.state['turns'] if item['turnId'] == turn), None)

    def observed_completion(self, turn):
        with self.engine_lock:
            return any(event.get('method') == 'turn/completed'
                       and event['params']['turn']['id'] == turn for event in self.parent.events)


class RealHandler(http.socketserver.BaseRequestHandler):
    def handle(self):
        host = self.server
        with host.lock:
            connection = http.Connection(self.request, 'real-follower-' + str(len(host.connections) + 1))
            host.connections.append(connection)
        try:
            while True:
                frame = http.receive(self.request)
                with host.lock:
                    host.frames.append(frame)
                if frame['type'] == 'broadcast':
                    assert frame['method'] == 'thread-stream-following-changed'
                    assert frame['targetClientIds'] == [OWNER]
                    assert frame['params']['conversationId'] == host.thread
                    if frame['params']['following']:
                        with host.lock:
                            host.followers[connection.client] = connection
                        host.snapshot(connection)
                    else:
                        with host.lock:
                            host.followers.pop(connection.client, None)
                    continue
                method, params = frame['method'], frame.get('params', {})
                handled = OWNER
                if method == 'initialize':
                    result, handled = {'clientId': connection.client}, connection.client
                elif method == 'thread-owner-discovery':
                    assert params == {'hostId': 'local', 'conversationId': host.thread}
                    result = {'supportsUntrustedAppInput': True}
                else:
                    assert frame['targetClientId'] == OWNER
                    assert frame['sourceClientId'] == connection.client
                    assert params['conversationId'] == host.thread
                    if method == 'thread-follower-update-thread-settings':
                        host.engine_call('thread/settings/update', {
                            'threadId': host.thread, **params['threadSettings']})
                        result = {'applied': True}
                    elif method == 'thread-follower-steer-turn':
                        result = {'result': host.engine_call('turn/steer', {
                            'threadId': host.thread, 'expectedTurnId': host.active(),
                            'input': params['input'], 'clientUserMessageId': params['clientUserMessageId']})}
                    elif method == 'thread-follower-start-turn':
                        result = {'result': host.engine_call('turn/start', params['turnStart']['request'])}
                    elif method == 'thread-follower-command-approval-decision':
                        host.answer(params['requestId'], params['decision'])
                        result = {'ok': True}
                    elif method == 'thread-follower-interrupt-turn':
                        assert frame['version'] == 4 and params['mode'] == 'user-stop'
                        result = host.engine_call('turn/interrupt', {
                            'threadId': host.thread, 'turnId': params['expectedTurnId']})
                    else:
                        raise AssertionError('Unexpected owner method ' + method)
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
                host.followers.pop(connection.client, None)


def wait(condition, description, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = condition()
        if result:
            return result
        time.sleep(.025)
    raise TimeoutError('Timed out waiting for ' + description)


def run(cli, binary):
    cli = pathlib.Path(cli).expanduser().resolve()
    if '.app/Contents/' in str(cli):
        raise ValueError('Use a standalone CLI; desktop-bundled executables are refused')
    if not cli.is_file() or not os.access(cli, os.X_OK):
        raise ValueError('Select an executable standalone CLI')
    binary = pathlib.Path(binary).resolve()
    output = {'desktop_app_used': False, 'real_account_used': False,
              'unmodified_desktop_hot_takeover_verified': False,
              'engine_restart_count': 0, 'checks': []}
    with tempfile.TemporaryDirectory(prefix='aw-realipc-', dir='/tmp') as temporary:
        root = pathlib.Path(temporary).resolve()
        home, workspace = root / 'home', root / 'workspace'
        home.mkdir()
        workspace.mkdir()
        fixture = {'lock': threading.Lock(), 'requests': [], 'plans': ['approval'],
                   'holding': threading.Event(), 'release': threading.Event()}
        model = stdio.fixture_module.http.server.ThreadingHTTPServer(
            ('127.0.0.1', 0), stdio.fixture_module.Model)
        model.daemon_threads = True
        model.fixture = fixture
        threading.Thread(target=model.serve_forever, daemon=True).start()
        (home / 'config.toml').write_text(
            'model="fixture"\nmodel_provider="local_probe"\n'
            '[model_providers.local_probe]\nname="Local deterministic fixture"\n'
            f'base_url="http://127.0.0.1:{model.server_port}/v1"\n'
            'wire_api="responses"\nrequires_openai_auth=false\n')
        env = {key: value for key, value in os.environ.items()
               if key in {'PATH', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL'}}
        env.update(HOME=str(root), CODEX_HOME=str(home), RUST_LOG='error', DO_NOT_TRACK='1')
        output['cli_version'] = subprocess.check_output(
            [str(cli), '--version'], env=env, text=True, stderr=subprocess.DEVNULL).strip()
        engine = web = host = poller = None
        stopping = threading.Event()
        with (root / 'engine.log').open('w+') as engine_log, (root / 'anywork.log').open('w+') as web_log:
            try:
                engine = subprocess.Popen([str(cli), 'app-server', '--listen', 'stdio://'],
                                          env=env, cwd=workspace, stdin=subprocess.PIPE,
                                          stdout=subprocess.PIPE, stderr=engine_log, text=True, bufsize=1)
                parent = stdio.StdioClient(engine)
                engine_pid = parent.call('server/diagnostics', {})['process']['id']
                started = parent.call('thread/start', {
                    'cwd': str(workspace), 'model': 'fixture', 'modelProvider': 'local_probe',
                    'approvalPolicy': 'on-request', 'approvalsReviewer': 'user', 'sandbox': 'workspace-write'})
                thread = started['thread']['id']
                first = parent.call('turn/start', {'threadId': thread, 'input': [
                    {'type': 'text', 'text': 'Ask for fixture approval, then finish.'}]})['turn']['id']
                original = parent.wait('item/commandExecution/requestApproval')
                assert not list(home.rglob('*.sock'))
                output['checks'].append('stdio_engine_started_original_turn_before_host_listener_existed')
                endpoint = root / 'host.sock'
                settings = {key: started[key] for key in ('model', 'reasoningEffort', 'collaborationMode', 'serviceTier')
                            if key in started}
                host = RealHost(endpoint, workspace, parent, thread, settings)
                threading.Thread(target=host.serve_forever, daemon=True).start()

                def poll():
                    while not stopping.wait(.05):
                        try:
                            host.refresh()
                        except Exception as error:
                            if not stopping.is_set():
                                with host.lock:
                                    host.errors.append(repr(error))
                            return

                poller = threading.Thread(target=poll, daemon=True)
                poller.start()
                catalog = root / 'catalog.json'
                catalog.write_text(json.dumps([{'id': thread, 'cwd': str(workspace),
                                                'name': 'Real isolated original turn', 'source': 'vscode',
                                                'createdAt': 1, 'updatedAt': 2}]))
                catalog_calls = root / 'catalog-calls.jsonl'
                fake_cli = root / 'catalog-fixture'
                fake_cli.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' ' +
                                    shlex.quote(str(ROOT / 'scripts/fake-agent.py')) + ' "$@"\n')
                fake_cli.chmod(0o700)
                with socket.socket() as address:
                    address.bind(('127.0.0.1', 0))
                    port = address.getsockname()[1]
                web_env = {**env, 'CODEX_BIN': str(fake_cli),
                           'ANYWORK_DESKTOP_IPC_SOCKET': str(endpoint),
                           'FAKE_CODEX_CATALOG': str(catalog), 'FAKE_AGENT_CALLS': str(catalog_calls)}
                web = subprocess.Popen([str(binary), '--bind', f'127.0.0.1:{port}',
                                        '--workspace', str(workspace), '--data-dir', str(root / 'data'),
                                        '--plugins-dir', str(root / 'plugins'), '--token', http.TOKEN],
                                       cwd=ROOT, env=web_env, stdout=web_log, stderr=web_log)

                def request(path, data=None):
                    request = urllib.request.Request(
                        f'http://127.0.0.1:{port}/api' + path,
                        data=None if data is None else json.dumps(data).encode(), headers={
                            'Authorization': 'Bearer ' + http.TOKEN, 'Content-Type': 'application/json'})
                    try:
                        with http.LOCAL_HTTP.open(request, timeout=15) as response:
                            return json.load(response)
                    except urllib.error.HTTPError as error:
                        raise RuntimeError(f'HTTP {error.code} {path}: {error.read().decode()}') from error

                def healthy():
                    try:
                        return request('/health')
                    except OSError:
                        return None

                wait(healthy, 'AnyWork HTTP startup')
                request('/sessions')
                base = '/sessions/codex-' + thread
                assert request(base + '/connect', {})['connected']
                approvals = lambda: [event for event in request(base + '/export')['events']
                                     if event['method'] == 'item/commandExecution/requestApproval']
                approval = wait(lambda: (approvals() or [None])[0], 'original real approval via HTTP')
                assert approval['request_id'].startswith('desktop:')
                assert original['id'] == host.pending_native[json.dumps(original['id'])]['id']
                output['checks'].append('real_anywork_http_connects_to_late_cooperative_host_and_original_approval')
                assert request(base + '/composer', {'action': 'settings', 'effort': 'high'})['effort'] == 'high'
                result = request(base + '/messages', {'text': 'Continue the same original turn after Web guidance.'})
                assert result['turnId'] == first
                output['checks'].append('http_updates_real_engine_effort_and_steers_original_turn')
                # Respect native advertised choices. On-request escalation can
                # offer cancel instead of decline; neither executes the command.
                choices = original['params'].get('availableDecisions', [])
                decision = 'decline' if 'decline' in choices else 'cancel'
                assert decision in choices
                final_status = 'interrupted' if decision == 'cancel' else 'completed'
                request(base + '/respond', {'request_id': approval['request_id'], 'result': {'decision': decision}})
                wait(lambda: host.turn_status(first) == final_status and host.observed_completion(first),
                     'original real turn completion after HTTP approval')
                assert host.original_answers == [{'id': original['id'], 'decision': decision}]
                assert host.engine_call('server/diagnostics', {})['process']['id'] == engine_pid
                output['checks'].append('http_denies_original_pending_id_and_parent_observes_same_turn_terminal_event')
                # Web starts another turn on the same engine and thread.
                next_turn = request(base + '/messages', {'text': 'Start the next turn through the Web.'})['turn']['id']
                wait(lambda: host.turn_status(next_turn) == 'completed' and host.observed_completion(next_turn),
                     'Web-started turn completion')
                output['checks'].append('http_starts_next_turn_on_same_original_engine_and_thread')
                host.disconnect_owner()
                wait(lambda: any(event['method'] == 'plugin/exited' for event in
                                 request(base + '/export')['events']), 'Web owner disconnect')
                assert engine.poll() is None
                with fixture['lock']:
                    fixture['plans'].append('hold')
                held = host.engine_call('turn/start', {'threadId': thread, 'input': [
                    {'type': 'text', 'text': 'Parent starts a held response while Web is disconnected.'}]})['turn']['id']
                assert fixture['holding'].wait(timeout=10)
                assert request(base + '/connect', {})['connected']
                request(base + '/interrupt', {})
                wait(lambda: host.turn_status(held) == 'interrupted' and host.observed_completion(held),
                     'reconnected Web interrupts exact parent-started turn')
                fixture['release'].set()
                output['checks'].append('web_reconnects_and_interrupts_exact_parent_started_turn_without_restart')
                web.terminate()
                web.wait(timeout=10)
                final = host.engine_call('turn/start', {'threadId': thread, 'input': [
                    {'type': 'text', 'text': 'Original parent still owns working stdio after AnyWork exits.'}]})['turn']['id']
                wait(lambda: host.turn_status(final) == 'completed' and host.observed_completion(final),
                     'parent continues after AnyWork process exits')
                assert host.engine_call('server/diagnostics', {})['process']['id'] == engine_pid
                assert host.errors == [], host.errors
                calls = [json.loads(line) for line in catalog_calls.read_text().splitlines()]
                forbidden = {'thread/resume', 'thread/start', 'thread/fork', 'turn/start',
                             'turn/steer', 'turn/interrupt', 'thread/settings/update'}
                assert not any(call.get('method') in forbidden for call in calls)
                assert not any(call['method'] in {'thread/resume', 'thread/start', 'thread/fork'} for call in host.engine_calls)
                assert all(frame['targetClientId'] == OWNER for frame in host.mutations())
                output['checks'].append('parent_stdio_survives_anywork_exit_and_no_second_engine_is_resumed')
                output.update(engine_pid=engine_pid, thread_id=thread, original_turn_id=first,
                              original_approval_id=original['id'], web_started_turn_id=next_turn,
                              original_approval_decision=decision, original_turn_final_status=final_status,
                              parent_started_interrupted_turn_id=held, parent_final_turn_id=final,
                              local_model_requests=len(fixture['requests']))
            except Exception:
                for name, log in [('engine', engine_log), ('AnyWork', web_log)]:
                    log.flush()
                    log.seek(0)
                    print(name + ' fixture log:\n' + log.read()[-5000:], file=sys.stderr)
                if host:
                    print('Host errors: ' + repr(host.errors), file=sys.stderr)
                    print('Engine calls: ' + repr(host.engine_calls), file=sys.stderr)
                    print('Pending native: ' + repr(host.pending_native), file=sys.stderr)
                    print('Recent native methods: ' + repr([
                        {'method': event.get('method'), 'id': event.get('id'),
                         'requestId': event.get('params', {}).get('requestId')}
                        for event in parent.events[-35:]]), file=sys.stderr)
                raise
            finally:
                fixture['release'].set()
                if web is not None and web.poll() is None:
                    web.terminate()
                    web.wait(timeout=10)
                stopping.set()
                if poller is not None:
                    poller.join(timeout=3)
                if host is not None:
                    host.disconnect_owner()
                    host.shutdown()
                    host.server_close()
                if engine is not None:
                    engine.stdin.close()
                    try:
                        engine.wait(timeout=10)
                        output['cleanup_required_termination'] = False
                    except subprocess.TimeoutExpired:
                        engine.terminate()
                        engine.wait(timeout=5)
                        output['cleanup_required_termination'] = True
                    output['launcher_exit_code'] = engine.returncode
                model.shutdown()
    output['checks_passed'] = len(output['checks'])
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', default=shutil.which('codex'))
    parser.add_argument('--binary', default=os.environ.get('ANYWORK_BINARY', str(ROOT / 'target/debug/anywork')))
    arguments = parser.parse_args()
    if not arguments.cli:
        parser.error('Install an independent CLI or pass --cli')
    print(json.dumps(run(arguments.cli, arguments.binary), indent=2))
