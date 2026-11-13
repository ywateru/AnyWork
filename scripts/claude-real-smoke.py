#!/usr/bin/env python3
"""Explicit real-CLI validation, separate from CI fixtures.

Default: native initialization only, no inference. --api-message starts a local
AnyWork server and sends one small prompt in a NEW isolated workspace/session.
Uses the existing local Claude login; never prints account fields or transcripts.
"""
import argparse
import json
import os
import pathlib
import selectors
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-message', action='store_true', help='Send one real model prompt through the service API')
    parser.add_argument('--api-controls', action='store_true', help='Also verify a narrowly approved isolated tool, question response and owned cancellation')
    parser.add_argument('--binary', default=os.environ.get('ANYWORK_BINARY', str(ROOT / 'target/debug/anywork')))
    opts = parser.parse_args()
    binary = os.environ.get('ANYWORK_CLAUDE_BIN') or shutil.which('claude')
    if not binary:
        raise RuntimeError('Set ANYWORK_CLAUDE_BIN to an installed Claude executable')
    with tempfile.TemporaryDirectory(prefix='anywork-claude-real-smoke-') as tmp:
        cwd = pathlib.Path(tmp)
        if not opts.api_message and not opts.api_controls:
            sid = str(uuid.uuid4())
            proc = subprocess.Popen([binary, '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', 'manual', '--session-id=' + sid], cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            try:
                proc.stdin.write(json.dumps({'type': 'control_request', 'request_id': 'anywork-init', 'request': {'subtype': 'initialize', 'hooks': None}}) + '\n')
                proc.stdin.flush()
                sel = selectors.DefaultSelector()
                sel.register(proc.stdout, selectors.EVENT_READ)
                deadline = time.monotonic() + 65
                while time.monotonic() < deadline:
                    if not sel.select(1):
                        if proc.poll() is not None:
                            raise RuntimeError('Claude exited during initialization')
                        continue
                    line = proc.stdout.readline()
                    if not line:
                        raise RuntimeError('Claude initialization EOF')
                    msg = json.loads(line)
                    if msg.get('type') != 'control_response':
                        continue
                    response = msg['response']
                    assert response['subtype'] == 'success', 'Claude rejected initialization'
                    data = response['response']
                    print(json.dumps({'real_cli_initialize': True, 'model_count': len(data.get('models', [])), 'permission_mode': data.get('current_permission_mode'), 'inference_sent': False}))
                    return
                raise TimeoutError('Claude initialization timeout')
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        workspace = cwd / 'workspace'
        workspace.mkdir()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        token = str(uuid.uuid4()) + str(uuid.uuid4())
        smoke_env = {**os.environ, 'ANYWORK_CLAUDE_BIN': binary, 'ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR': str(cwd / 'no-desktop-bridge.json'), 'ANYWORK_CLAUDE_DESKTOP_HISTORY_ROOT': str(cwd / 'no-desktop-history')}
        proc = subprocess.Popen([opts.binary, '--codex-discovery', 'false', '--bind', f'127.0.0.1:{port}', '--workspace', str(workspace), '--data-dir', str(cwd / 'data'), '--plugins-dir', str(cwd / 'plugins'), '--token', token], env=smoke_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        def request(path, data=None):
            req = urllib.request.Request(f'http://127.0.0.1:{port}/api' + path, data=json.dumps(data).encode() if data is not None else None, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)

        try:
            for _ in range(100):
                try:
                    request('/health')
                    break
                except OSError:
                    time.sleep(.1)
            session = request('/sessions', {'agent': 'claude-code', 'cwd': str(workspace)})['session']
            assert session['status'] == 'idle', 'Real CLI runtime was not ready'
            sid = session['id']
            request(f'/sessions/{sid}/messages', {'text': 'Respond exactly ANYWORK_CLAUDE_SMOKE_OK. Do not call tools.'})
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                status = request(f'/sessions/{sid}')['session']['status']
                if status in ('idle', 'error', 'disconnected', 'waiting'):
                    break
                time.sleep(.25)
            events = request(f'/sessions/{sid}/export')['events']
            answer = '\n'.join(e['params']['item'].get('text', '') for e in events if e['method'] == 'item/completed' and e['params'].get('item', {}).get('type') == 'agentMessage')
            methods = {e['method'] for e in events}
            success = status == 'idle' and 'ANYWORK_CLAUDE_SMOKE_OK' in answer
            print(json.dumps({'real_api_message': success, 'status': status, 'native_id_preserved': bool(session['thread_id']), 'text_stream_observed': 'item/agentMessage/delta' in methods, 'turn_completed': 'turn/completed' in methods, 'isolated_new_session': True}))
            if not success:
                raise RuntimeError('Real model smoke did not complete successfully; account/model access may require local setup')
            if opts.api_controls:
                def perform(prompt, responder):
                    old_events = request(f'/sessions/{sid}/export')['events']
                    watermark = max((e['seq'] for e in old_events), default=0)
                    request(f'/sessions/{sid}/messages', {'text': prompt})
                    handled = set()
                    end = time.monotonic() + 120
                    while time.monotonic() < end:
                        current = request(f'/sessions/{sid}')['session']['status']
                        events = [e for e in request(f'/sessions/{sid}/export')['events'] if e['seq'] > watermark]
                        if current == 'waiting':
                            for e in events:
                                if e.get('request_id') and e['request_id'] not in handled:
                                    result = responder(e)
                                    request(f'/sessions/{sid}/respond', {'request_id': e['request_id'], 'result': result})
                                    handled.add(e['request_id'])
                        if current in ('idle', 'error', 'disconnected'):
                            return current, events, handled
                        time.sleep(.2)
                    raise TimeoutError('Real Claude control turn did not finish')

                command = 'printf ANYWORK_TOOL_OK > smoke-proof.txt'

                def tool_approval(event):
                    assert event['method'].endswith('/requestApproval'), 'Unexpected real request; no permission granted'
                    assert event['params'].get('tool') == 'Bash' and event['params'].get('input', {}).get('command', '').strip() == command, 'Command differed from the isolated smoke command; no permission granted'
                    return {'decision': 'accept'}

                state, events, handled = perform('Use Bash with exactly this command: ' + command + '. Do not read or modify any other file. Then reply ANYWORK_TOOL_DONE.', tool_approval)
                tool_ok = state == 'idle' and (workspace / 'smoke-proof.txt').read_text() == 'ANYWORK_TOOL_OK' and any(e['method'] == 'item/completed' and e['params'].get('item', {}).get('type') == 'commandExecution' for e in events)
                print(json.dumps({'real_api_tool': tool_ok, 'real_approval_once': bool(handled)}))
                assert tool_ok, 'Native isolated tool smoke failed'

                def question_answer(event):
                    assert event['method'] == 'item/tool/requestUserInput', 'Unexpected request; no permission granted'
                    return {'answers': {q['id']: {'answers': ['AnyWork free text smoke answer']} for q in event['params']['questions']}}

                state, events, handled = perform('Use AskUserQuestion now to ask me which of two smoke-test colors I prefer, with two color options. Wait for the tool answer, then reply ANYWORK_QUESTION_DONE. Do not run other tools.', question_answer)
                question_ok = state == 'idle' and bool(handled)
                print(json.dumps({'real_api_question': question_ok}))
                assert question_ok, 'Native question smoke was not observed'
                watermark = max(e['seq'] for e in request(f'/sessions/{sid}/export')['events'])
                request(f'/sessions/{sid}/messages', {'text': 'Think about a long detailed explanation of sorting algorithms; do not run tools.'})
                request(f'/sessions/{sid}/interrupt', {})
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    if request(f'/sessions/{sid}')['session']['status'] == 'idle':
                        break
                    time.sleep(.1)
                events = [e for e in request(f'/sessions/{sid}/export')['events'] if e['seq'] > watermark]
                cancel_ok = any(e['method'] == 'turn/completed' and e['params']['turn']['status'] == 'interrupted' for e in events)
                print(json.dumps({'real_api_owned_interrupt': cancel_ok}))
                assert cancel_ok, 'Native cancellation did not settle'
                controls = request(f'/sessions/{sid}/composer')
                catalog = request(f'/sessions/{sid}/models')['data']
                selected = next((m['model'] for m in catalog if m['model'] == controls['model']), catalog[0]['model'])
                request(f'/sessions/{sid}/composer', {'action': 'settings', 'model': selected})
                model_ok = request(f'/sessions/{sid}/composer')['model'] == selected
                print(json.dumps({'real_api_set_model': model_ok}))
                assert model_ok, 'Native model control did not acknowledge the selected model'
                proc.terminate()
                proc.wait(timeout=10)
                proc = subprocess.Popen([opts.binary, '--codex-discovery', 'false', '--bind', f'127.0.0.1:{port}', '--workspace', str(workspace), '--data-dir', str(cwd / 'data'), '--plugins-dir', str(cwd / 'plugins'), '--token', token], env=smoke_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                for _ in range(100):
                    try:
                        request('/health')
                        break
                    except OSError:
                        time.sleep(.1)
                history_ok = bool(request(f'/sessions/{sid}/history?limit=20')['events'])
                request(f'/sessions/{sid}/connect', {})
                id_ok = request(f'/sessions/{sid}')['session']['thread_id'] == session['thread_id']
                state, events, _ = perform('Without using tools, reply with the exact contents you wrote to the smoke file earlier.', lambda _: (_ for _ in ()).throw(AssertionError('Unexpected permission after native resume')))
                answer = '\n'.join(e['params']['item'].get('text', '') for e in events if e['method'] == 'item/completed' and e['params'].get('item', {}).get('type') == 'agentMessage')
                resumed = state == 'idle' and id_ok and history_ok and 'ANYWORK_TOOL_OK' in answer
                print(json.dumps({'real_api_restart_resume': resumed, 'native_id_preserved': id_ok, 'persisted_history_read': history_ok}))
                assert resumed, 'Native session resume did not preserve prior conversation context'
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


if __name__ == '__main__':
    main()
