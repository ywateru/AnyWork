#!/usr/bin/env python3
"""Probe a real standalone Codex engine with two clients and a local fake model.

No desktop app, account, native chat, or real model is used. Requires the separately
installed Codex CLI; intentionally refuses binaries inside the desktop app bundle.
"""
import argparse
import base64
import hashlib
import http.server
import json
import os
import pathlib
import queue
import shutil
import socket
import struct
import subprocess
import tempfile
import threading
import time


class Client:
    def __init__(self, endpoint, name):
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.settimeout(20)
        self.socket.connect(str(endpoint))
        self.lock = threading.Lock()
        self.messages = queue.Queue()
        self.events = []
        self.next_id = 0
        key = base64.b64encode(os.urandom(16)).decode()
        self.socket.sendall((
            'GET /rpc HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n'
            'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n'
            f'Sec-WebSocket-Key: {key}\r\n\r\n').encode())
        header = b''
        while not header.endswith(b'\r\n\r\n'):
            header += self.read(1)
            if len(header) > 16384:
                raise RuntimeError('Oversized WebSocket handshake')
        expected = base64.b64encode(hashlib.sha1(
            (key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        assert b'101 Switching Protocols' in header
        assert expected.lower() in header.lower()
        self.reader = threading.Thread(target=self.receive, daemon=True)
        self.reader.start()
        self.call('initialize', {
            'clientInfo': {'name': name, 'version': '0.1.0'},
            'capabilities': {'experimentalApi': True},
        })
        self.send({'method': 'initialized', 'params': {}})

    def read(self, count):
        result = b''
        while len(result) < count:
            chunk = self.socket.recv(count - len(result))
            if not chunk:
                raise EOFError('Engine connection closed')
            result += chunk
        return result

    def frame(self, data, opcode=1):
        mask = os.urandom(4)
        length = len(data)
        if length < 126:
            header = bytes([128 | opcode, 128 | length])
        elif length < 65536:
            header = bytes([128 | opcode, 254]) + struct.pack('!H', length)
        else:
            header = bytes([128 | opcode, 255]) + struct.pack('!Q', length)
        with self.lock:
            self.socket.sendall(header + mask + bytes(
                value ^ mask[index % 4] for index, value in enumerate(data)))

    def receive(self):
        fragments = b''
        try:
            while True:
                first, second = self.read(2)
                length = second & 127
                if length == 126:
                    length = struct.unpack('!H', self.read(2))[0]
                elif length == 127:
                    length = struct.unpack('!Q', self.read(8))[0]
                if length > 16 * 1024 * 1024:
                    raise RuntimeError('Oversized engine frame')
                assert not second & 128, 'Server must not mask frames'
                data = self.read(length)
                opcode = first & 15
                if opcode == 8:
                    return
                if opcode == 9:
                    self.frame(data, 10)
                elif opcode in (0, 1):
                    fragments += data
                    if first & 128:
                        self.messages.put(json.loads(fragments))
                        fragments = b''
        except Exception as error:
            self.messages.put(error)

    def send(self, value):
        self.frame(json.dumps(value).encode())

    def next(self, deadline):
        try:
            value = self.messages.get(timeout=max(.001, deadline - time.monotonic()))
        except queue.Empty as error:
            raise TimeoutError('Timed out waiting for engine message') from error
        if isinstance(value, Exception):
            raise value
        return value

    def call(self, method, params):
        self.next_id += 1
        request_id = self.next_id
        self.send({'id': request_id, 'method': method, 'params': params})
        deadline = time.monotonic() + 20
        while True:
            value = self.next(deadline)
            if value.get('id') == request_id and 'method' not in value:
                if 'error' in value:
                    raise RuntimeError(f'{method}: {value["error"]}')
                return value.get('result')
            self.events.append(value)

    def wait(self, method, predicate=lambda value: True):
        deadline = time.monotonic() + 20
        while True:
            for value in self.events:
                if value.get('method') == method and predicate(value):
                    return value
            self.events.append(self.next(deadline))

    def close(self):
        try:
            self.socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.socket.close()
        self.reader.join(timeout=1)


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        fixture = self.server.fixture
        with fixture['lock']:
            fixture['requests'].append(body)
            sequence = len(fixture['requests'])
            kind = fixture['plans'].pop(0) if fixture['plans'] else 'message'
        if kind == 'tool':
            item = {'type': 'function_call', 'id': f'fc_{sequence}',
                    'call_id': f'call_{sequence}', 'name': 'desktop_probe',
                    'arguments': '{"text":"same engine"}'}
        elif kind == 'approval':
            assert any(tool.get('name') == 'exec_command' for tool in body['tools'])
            item = {'type': 'function_call', 'id': f'fc_{sequence}',
                    'call_id': f'call_{sequence}', 'name': 'exec_command',
                    'arguments': json.dumps({
                        'cmd': 'printf isolated-shared-engine-probe',
                        'sandbox_permissions': 'require_escalated',
                        'justification': 'Isolated fixture: this request must be denied.'})}
        else:
            item = {'type': 'message', 'id': f'msg_{sequence}', 'role': 'assistant',
                    'status': 'completed', 'content': [
                        {'type': 'output_text', 'text': 'Shared engine complete.',
                         'annotations': []}]}
        response = {'id': f'resp_{sequence}', 'object': 'response',
                    'status': 'completed', 'output': [item],
                    'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2}}
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            self.emit('response.created', {'response': {
                **response, 'status': 'in_progress', 'output': []}})
            if kind == 'hold':
                fixture['holding'].set()
                fixture['release'].wait(timeout=20)
            self.emit('response.output_item.added', {'output_index': 0, 'item': item})
            self.emit('response.output_item.done', {'output_index': 0, 'item': item})
            self.emit('response.completed', {'response': response})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def emit(self, kind, params):
        self.wfile.write((f'event: {kind}\ndata: ' + json.dumps(
            {'type': kind, **params}) + '\n\n').encode())
        self.wfile.flush()


def run(cli):
    checks = []
    with tempfile.TemporaryDirectory(prefix='anywork-shared-engine-') as temporary:
        root = pathlib.Path(temporary).resolve()
        home, workspace = root / 'home', root / 'workspace'
        home.mkdir()
        workspace.mkdir()
        endpoint = root / 'engine.sock'
        fixture = {'lock': threading.Lock(), 'requests': [], 'plans': ['tool'],
                   'holding': threading.Event(), 'release': threading.Event()}
        model = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Model)
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
        version = subprocess.check_output([cli, '--version'], env=env,
                                          text=True, stderr=subprocess.DEVNULL).strip()
        clients = []
        engine = None
        with (root / 'engine.log').open('w+') as log:
            try:
                engine = subprocess.Popen([cli, 'app-server', '--listen', 'unix://' + str(endpoint)],
                                          env=env, cwd=workspace, stdout=log, stderr=log)
                deadline = time.monotonic() + 15
                while not endpoint.exists():
                    if engine.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('Isolated engine did not start')
                    time.sleep(.02)
                a = Client(endpoint, 'desktop_transport_fixture')
                b = Client(endpoint, 'anywork_transport_fixture')
                clients.extend([a, b])
                thread = a.call('thread/start', {
                    'cwd': str(workspace), 'model': 'shared-probe',
                    'modelProvider': 'local_probe', 'approvalPolicy': 'on-request',
                    'approvalsReviewer': 'user', 'sandbox': 'workspace-write',
                    'dynamicTools': [{'name': 'desktop_probe', 'description': 'Fixture only',
                                      'inputSchema': {'type': 'object', 'properties': {
                                          'text': {'type': 'string'}}, 'required': ['text'],
                                          'additionalProperties': False}}],
                })['thread']['id']
                first = a.call('turn/start', {'threadId': thread, 'input': [
                    {'type': 'text', 'text': 'Call the fixture tool then finish.'}]})['turn']['id']
                request_a = a.wait('item/tool/call')
                resumed = b.call('thread/resume', {'threadId': thread, 'excludeTurns': True})
                assert resumed['thread']['id'] == thread
                request_b = b.wait('item/tool/call')
                assert request_a == request_b
                b.call('thread/settings/update', {'threadId': thread, 'effort': 'high'})
                for client in (a, b):
                    updated = client.wait('thread/settings/updated', lambda value:
                                          value['params']['threadId'] == thread)
                    assert updated['params']['threadSettings']['effort'] == 'high'
                assert a.call('thread/read', {'threadId': thread})['thread']['status']['type'] == 'active'
                checks.append('effort_update_is_shared_while_original_turn_waits_for_tool')
                b.send({'id': request_b['id'], 'result': {
                    'contentItems': [{'type': 'inputText', 'text': 'Handled by Web fixture'}],
                    'success': True}})
                for client in (a, b):
                    event = client.wait('turn/completed', lambda value:
                                        value['params']['turn']['id'] == first)
                    assert event['params']['turn']['status'] == 'completed'
                checks.append('second_client_joins_active_thread_and_answers_pending_dynamic_tool')

                a.call('thread/goal/set', {'threadId': thread,
                                         'objective': 'Shared fixture objective', 'status': 'paused'})
                for client in (a, b):
                    client.wait('thread/goal/updated', lambda value:
                                value['params']['goal']['objective'] == 'Shared fixture objective')
                checks.append('goal_state_broadcasts_to_both_clients')

                with fixture['lock']:
                    fixture['plans'].append('approval')
                second = b.call('turn/start', {'threadId': thread, 'input': [
                    {'type': 'text', 'text': 'Ask for the fixture approval.'}]})['turn']['id']
                approve_a = a.wait('item/commandExecution/requestApproval')
                approve_b = b.wait('item/commandExecution/requestApproval')
                assert approve_a == approve_b
                # Deny: the requested command must never run.
                a.send({'id': approve_a['id'], 'result': {'decision': 'decline'}})
                for client in (a, b):
                    event = client.wait('turn/completed', lambda value:
                                        value['params']['turn']['id'] == second)
                    assert event['params']['turn']['status'] == 'completed'
                    client.wait('serverRequest/resolved', lambda value:
                                value['params']['requestId'] == approve_a['id'])
                checks.append('web_starts_turn_desktop_denies_same_pending_approval_and_both_resolve')

                b.close()
                clients.remove(b)
                b = Client(endpoint, 'anywork_reconnected_fixture')
                clients.append(b)
                resumed = b.call('thread/resume', {'threadId': thread, 'excludeTurns': True})
                assert resumed['thread']['id'] == thread
                assert b.call('thread/goal/get', {'threadId': thread})['goal']['objective'] == 'Shared fixture objective'
                checks.append('reconnected_client_restores_original_thread_and_goal')

                with fixture['lock']:
                    fixture['plans'].append('hold')
                third = b.call('turn/start', {'threadId': thread, 'input': [
                    {'type': 'text', 'text': 'Hold the local response until interrupted.'}]})['turn']['id']
                assert fixture['holding'].wait(timeout=10)
                steered = a.call('turn/steer', {'threadId': thread, 'expectedTurnId': third,
                                              'input': [{'type': 'text', 'text': 'Same-turn guidance.'}]})
                assert steered['turnId'] == third
                a.call('turn/interrupt', {'threadId': thread, 'turnId': third})
                for client in (a, b):
                    event = client.wait('turn/completed', lambda value:
                                        value['params']['turn']['id'] == third)
                    assert event['params']['turn']['status'] == 'interrupted'
                checks.append('other_client_steers_and_interrupts_original_turn')
                fixture['release'].set()
                queued = a.call('thread/queue/add', {
                    'threadId': thread, 'clientUserMessageId': 'shared-probe-queued-message',
                    'input': [{'type': 'text', 'text': 'Shared queue entry.'}],
                })['queuedSubmission']
                for client in (a, b):
                    client.wait('thread/queue/changed', lambda value:
                                value['params']['threadId'] == thread)
                assert b.call('thread/queue/list', {'threadId': thread})['data'] == [queued]
                updated = b.call('thread/queue/update', {
                    'threadId': thread, 'queuedSubmissionId': queued['id'],
                    'input': [{'type': 'text', 'text': 'Edited in the other client.'}],
                })['queuedSubmission']
                assert a.call('thread/queue/list', {'threadId': thread})['data'] == [updated]
                checks.append('native_queue_add_and_edit_are_shared_by_both_clients')
                from concurrent.futures import ThreadPoolExecutor
                with ThreadPoolExecutor(max_workers=2) as pool:
                    futures = [pool.submit(client.call, 'thread/queue/start', {
                        'threadId': thread, 'queuedSubmissionId': queued['id'],
                    }) for client in (a, b)]
                    accepted, rejected = [], []
                    for future in futures:
                        try:
                            accepted.append(future.result())
                        except RuntimeError as error:
                            rejected.append(str(error))
                assert len(accepted) == len(rejected) == 1, (accepted, rejected)
                queued_turn = accepted[0]['turn']['id']
                for client in (a, b):
                    event = client.wait('turn/completed', lambda value:
                                        value['params']['turn']['id'] == queued_turn)
                    assert event['params']['turn']['status'] == 'completed'
                assert a.call('thread/queue/list', {'threadId': thread})['data'] == []
                checks.append('concurrent_native_queue_start_accepts_exactly_one_sender')
                for client in clients:
                    client.close()
                clients.clear()
                assert engine.poll() is None
                c = Client(endpoint, 'new_client_after_disconnect_fixture')
                clients.append(c)
                assert c.call('thread/read', {'threadId': thread})['thread']['id'] == thread
                assert engine.poll() is None
                checks.append('engine_survives_all_clients_disconnecting_and_accepts_new_client')
                # Use a normal installed ws client, never execute extracted app code.
                # localhost also passes the desktop's static loopback/proxy branch.
                node = shutil.which('node')
                bundle = pathlib.Path(__file__).resolve().parents[1] / 'node_modules/playwright-core/lib/utilsBundle.js'
                if not node or not bundle.is_file():
                    raise RuntimeError('Run npm ci and make Node.js available for the Unix URL probe')
                uri = 'ws+unix://localhost' + str(endpoint) + ':/rpc'
                javascript = r'''
const {ws: WebSocket}=require(process.argv[1]);
const url=new URL(process.argv[2]);
if(url.hostname!=='localhost') throw Error('Expected the local proxy bypass branch');
const socket=new WebSocket(url,{perMessageDeflate:false});
const timer=setTimeout(()=>{socket.terminate();process.exitCode=1;},10000);
socket.on('open',()=>socket.send(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'unix_url_fixture',version:'0.1.0'},capabilities:{experimentalApi:true}}})));
socket.on('message',data=>{
 const value=JSON.parse(String(data));
 if(value.error){console.error(value.error);socket.close();process.exitCode=1;}
 if(value.id===1&&value.result){
  socket.send(JSON.stringify({method:'initialized',params:{}}));
  socket.send(JSON.stringify({id:2,method:'thread/read',params:{threadId:process.argv[3]}}));
 }
 if(value.id===2&&value.result){
  if(value.result.thread.id!==process.argv[3])process.exitCode=1;
  socket.close();
 }
});
socket.on('error',error=>{console.error(error.message);process.exitCode=1;});
socket.on('close',()=>clearTimeout(timer));
'''
                subprocess.run([node, '-e', javascript, str(bundle), uri, thread],
                               env=env, check=True, timeout=15, capture_output=True)
                checks.append('standard_ws_client_connects_directly_over_localhost_unix_url')
                return {'cli_version': version, 'checks_passed': len(checks), 'checks': checks,
                        'local_model_requests': len(fixture['requests']),
                        'desktop_app_used': False, 'real_account_used': False}
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read()[-6000:], file=__import__('sys').stderr)
                raise
            finally:
                fixture['release'].set()
                for client in clients:
                    client.close()
                if engine is not None:
                    engine.terminate()
                    try:
                        engine.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        engine.kill()
                        engine.wait(timeout=5)
                model.shutdown()
                model.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex-bin', default=shutil.which('codex'))
    args = parser.parse_args()
    if not args.codex_bin:
        parser.error('Install a standalone Codex CLI or supply --codex-bin')
    binary = pathlib.Path(args.codex_bin).resolve()
    if '.app/Contents/' in str(binary):
        parser.error('Use the standalone CLI, not a desktop app bundle executable')
    print(json.dumps(run(str(binary)), ensure_ascii=False, indent=2))
