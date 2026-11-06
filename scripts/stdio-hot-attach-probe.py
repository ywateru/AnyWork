#!/usr/bin/env python3
"""Hot-add a cooperative parent bridge to a real stdio-only Codex engine.

Uses a temporary CODEX_HOME/workspace and deterministic local model. Never uses
the desktop app, an account, or a real chat. This proves cooperative-parent
bridging, not attachment to an arbitrary unmodified desktop process.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import queue
import shutil
import socket
import subprocess
import tempfile
import threading


def load_fixture():
    path = pathlib.Path(__file__).with_name('shared-engine-probe.py')
    spec = importlib.util.spec_from_file_location('shared_engine_fixture', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixture_module = load_fixture()


class StdioClient(fixture_module.Client):
    """One connection owned by the original parent, with one stdout reader.

    The bounded probe dispatches RPCs serially. A production broker also needs
    concurrent request routing, notification fan-out and server-request ownership.
    """

    def __init__(self, process):
        self.process = process
        self.lock = threading.Lock()
        self.messages = queue.Queue()
        self.events = []
        self.next_id = 0
        self.reader = threading.Thread(target=self.receive, daemon=True)
        self.reader.start()
        self.call('initialize', {
            'clientInfo': {'name': 'isolated_stdio_parent', 'version': '0.1.0'},
            'capabilities': {'experimentalApi': True},
        })
        self.send({'method': 'initialized', 'params': {}})

    def receive(self):
        try:
            for line in self.process.stdout:
                self.messages.put(json.loads(line))
            self.messages.put(EOFError('Original engine stdout closed'))
        except Exception as error:
            self.messages.put(error)

    def send(self, value):
        with self.lock:
            self.process.stdin.write(json.dumps(value) + '\n')
            self.process.stdin.flush()


def unix_fd_inventory(pid):
    executable = shutil.which('lsof')
    if not executable:
        return {'available': False}
    result = subprocess.run(
        [executable, '-nP', '-a', '-p', str(pid), '-U'],
        text=True, capture_output=True, timeout=5)
    # Report descriptors only: omit host usernames and unrelated files.
    rows = [line.split() for line in result.stdout.splitlines()[1:]]
    return {'available': True, 'returncode': result.returncode,
            'descriptors': [{'fd': row[3], 'type': row[4],
                             'name': row[-1]}
                            for row in rows if len(row) >= 8]}


def run(cli):
    selected = pathlib.Path(cli).expanduser().resolve()
    if '.app/Contents/' in str(selected):
        raise ValueError('Use a separately installed CLI, never an app-bundled executable')
    if not selected.is_file() or not os.access(selected, os.X_OK):
        raise ValueError('Select an executable standalone Codex CLI')
    output = {'checks': [], 'desktop_app_used': False, 'real_account_used': False,
              'engine_restart_count': 0, 'signals_used_during_turn': False}
    with tempfile.TemporaryDirectory(prefix='anywork-stdio-hot-') as temporary:
        root = pathlib.Path(temporary).resolve()
        home, workspace = root / 'home', root / 'workspace'
        home.mkdir()
        workspace.mkdir()
        fixture = {'lock': threading.Lock(), 'requests': [], 'plans': ['tool'],
                   'holding': threading.Event(), 'release': threading.Event()}
        model = fixture_module.http.server.ThreadingHTTPServer(
            ('127.0.0.1', 0), fixture_module.Model)
        model.daemon_threads = True
        model.fixture = fixture
        threading.Thread(target=model.serve_forever, daemon=True).start()
        (home / 'config.toml').write_text(
            'model="shared-probe"\nmodel_provider="local_probe"\n'
            '[model_providers.local_probe]\nname="Local deterministic fixture"\n'
            f'base_url="http://127.0.0.1:{model.server_port}/v1"\n'
            'wire_api="responses"\nrequires_openai_auth=false\n')
        env = {key: value for key, value in os.environ.items()
               if key in {'PATH', 'HOME', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL'}}
        env.update(CODEX_HOME=str(home), RUST_LOG='error', DO_NOT_TRACK='1')
        output['cli_version'] = subprocess.check_output(
            [str(selected), '--version'], env=env, text=True,
            stderr=subprocess.DEVNULL).strip()
        output['selected_executable_sha256'] = hashlib.sha256(selected.read_bytes()).hexdigest()
        listener = None
        worker = None
        engine = None
        with (root / 'engine.log').open('w+') as log:
            try:
                engine = subprocess.Popen(
                    [str(selected), 'app-server', '--listen', 'stdio://'],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                    text=True, bufsize=1, env=env, cwd=workspace)
                parent = StdioClient(engine)
                # Node CLI launchers may wrap the real engine. Identify that
                # engine using its own protocol rather than assuming Popen.pid.
                engine_pid = parent.call('server/diagnostics', {})['process']['id']
                output['engine_pid'] = engine_pid
                thread = parent.call('thread/start', {
                    'cwd': str(workspace), 'model': 'shared-probe',
                    'modelProvider': 'local_probe', 'approvalPolicy': 'never',
                    'sandbox': 'workspace-write',
                    'dynamicTools': [{'name': 'desktop_probe', 'description': 'Fixture only',
                                      'inputSchema': {'type': 'object', 'properties': {
                                          'text': {'type': 'string'}}, 'required': ['text'],
                                          'additionalProperties': False}}],
                })['thread']['id']
                turn = parent.call('turn/start', {'threadId': thread, 'input': [
                    {'type': 'text', 'text': 'Call fixture tool and finish.'}]})['turn']['id']
                pending = parent.wait('item/tool/call')
                sockets = [str(path.relative_to(home)) for path in home.rglob('*')
                           if path.is_socket()]
                assert not sockets, f'Unexpected fixture home sockets: {sockets}'
                output['home_control_socket_present'] = False
                output['stdio_engine_unix_fds'] = unix_fd_inventory(engine_pid)
                status = parent.call('remoteControl/status/read', None)
                output['remote_control_status'] = status['status']
                assert status['status'] == 'disabled'
                output['checks'].append('stdio_engine_stays_active_without_home_control_socket')

                # Only now does the cooperative parent publish a listener. It
                # retains its sole reader and existing initialized connection.
                endpoint = root / 'parent-bridge.sock'
                listener = socket.socket(socket.AF_UNIX)
                listener.settimeout(25)
                listener.bind(str(endpoint))
                listener.listen(1)
                bridge_result = {}

                def serve_bridge():
                    try:
                        connection, _ = listener.accept()
                        with connection, connection.makefile('rw') as stream:
                            assert json.loads(stream.readline()) == {'attachThreadId': thread}
                            assert parent.call('server/diagnostics', {})['process']['id'] == engine_pid
                            current = parent.call('thread/read', {
                                'threadId': thread, 'includeTurns': True})['thread']
                            assert current['id'] == thread
                            assert current['status']['type'] == 'active'
                            assert any(item['id'] == turn for item in current['turns'])
                            parent.call('thread/settings/update', {
                                'threadId': thread, 'effort': 'high'})
                            updated = parent.wait('thread/settings/updated', lambda value:
                                                  value['params']['threadId'] == thread)
                            assert updated['params']['threadSettings']['effort'] == 'high'
                            steered = parent.call('turn/steer', {
                                'threadId': thread, 'expectedTurnId': turn,
                                'input': [{'type': 'text', 'text': 'Guidance through parent bridge.'}]})
                            assert steered['turnId'] == turn
                            parent.send({'id': pending['id'], 'result': {
                                'contentItems': [{'type': 'inputText',
                                                  'text': 'Handled through parent bridge.'}],
                                'success': True}})
                            bridge_result.update(enginePid=engine_pid, threadId=thread,
                                                 turnId=turn, effort='high',
                                                 pendingRequestId=pending['id'])
                            stream.write(json.dumps(bridge_result) + '\n')
                            stream.flush()
                    except Exception as error:
                        bridge_result['error'] = repr(error)

                worker = threading.Thread(target=serve_bridge, daemon=True)
                worker.start()
                web = socket.socket(socket.AF_UNIX)
                web.settimeout(25)
                web.connect(str(endpoint))
                with web, web.makefile('rw') as stream:
                    stream.write(json.dumps({'attachThreadId': thread}) + '\n')
                    stream.flush()
                    raw = stream.readline()
                    if not raw:
                        raise RuntimeError(f'Parent bridge failed: {bridge_result}')
                    output['cooperative_parent_bridge'] = json.loads(raw)
                worker.join(timeout=1)
                assert not worker.is_alive()
                assert 'error' not in bridge_result, bridge_result
                completed = parent.wait('turn/completed', lambda value:
                                        value['params']['turn']['id'] == turn)
                assert completed['params']['turn']['status'] == 'completed'
                output['checks'].extend([
                    'parent_exposes_listener_after_turn_started_without_engine_restart',
                    'web_bridge_controls_same_pid_thread_and_turn',
                    'bridge_updates_effort_and_steers_same_turn',
                    'bridge_resolves_original_pending_tool_and_same_turn_completes',
                ])
                second = parent.call('turn/start', {'threadId': thread, 'input': [
                    {'type': 'text', 'text': 'Original parent continues after bridge disconnects.'}]})['turn']['id']
                completed = parent.wait('turn/completed', lambda value:
                                        value['params']['turn']['id'] == second)
                assert completed['params']['turn']['status'] == 'completed'
                assert parent.call('server/diagnostics', {})['process']['id'] == engine_pid
                output['checks'].append('original_parent_retains_stdio_and_starts_next_turn')
                output['local_model_requests'] = len(fixture['requests'])
                output['unmodified_desktop_hot_takeover_verified'] = False
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read()[-3000:], file=__import__('sys').stderr)
                raise
            finally:
                fixture['release'].set()
                if listener is not None:
                    listener.close()
                if worker is not None:
                    worker.join(timeout=1)
                if engine is not None:
                    engine.stdin.close()
                    try:
                        engine.wait(timeout=10)
                        output['cleanup_required_termination'] = False
                    except subprocess.TimeoutExpired:
                        # Only our own isolated fixture, after the checks finish.
                        engine.terminate()
                        engine.wait(timeout=5)
                        output['cleanup_required_termination'] = True
                    output['launcher_exit_code'] = engine.returncode
                model.shutdown()
    output['checks_passed'] = len(output['checks'])
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', default=shutil.which('codex'),
                        help='Separately installed Codex CLI; defaults to codex on PATH')
    arguments = parser.parse_args()
    if not arguments.cli:
        parser.error('Install a standalone Codex CLI or pass --cli')
    print(json.dumps(run(arguments.cli), indent=2))
