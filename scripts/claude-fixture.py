#!/usr/bin/env python3
"""Deterministic stream-json peer. No Anthropic SDK, credentials or model calls."""
import datetime
import json
import os
import pathlib
import sys
import uuid

args = sys.argv[1:]
assert '--permission-mode' in args and args[args.index('--permission-mode') + 1] == 'manual'
assert '--permission-prompt-tool' in args and 'stdio' in args
assert not any('bypass' in a or 'skip-permissions' in a for a in args)
sid = next(a.split('=', 1)[1] for a in args if a.startswith(('--resume=', '--session-id=')))
root = pathlib.Path(os.environ['CLAUDE_CONFIG_DIR'])
project = root / 'projects' / 'fixture'
project.mkdir(parents=True, exist_ok=True)
log = project / (sid + '.jsonl')
calls = root / 'calls.jsonl'
with calls.open('a') as f:
    f.write(json.dumps({'argv': args, 'sid': sid}) + '\n')
if any(a.startswith('--resume=') for a in args) and not log.exists():
    sys.exit(2)
parent = None
if log.exists():
    rows = [json.loads(line) for line in log.read_text().splitlines()]
    parent = rows[-1].get('uuid') if rows else None
pending = {}
turn = None
model = args[args.index('--model') + 1] if '--model' in args else 'fixture-sonnet'


def emit(value):
    print(json.dumps(value), flush=True)


def append(row):
    global parent
    row.update(sessionId=sid, parentUuid=parent, cwd=os.getcwd(), timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat())
    with log.open('a') as f:
        f.write(json.dumps(row) + '\n')
    parent = row['uuid']
    return row


def state(value):
    emit({'type': 'system', 'subtype': 'session_state_changed', 'state': value, 'session_id': sid})


def finish(text='fixture answer', interrupted=False):
    global turn
    mid = 'message-' + str(uuid.uuid4())
    emit({'type': 'stream_event', 'session_id': sid, 'event': {'type': 'message_start', 'message': {'id': mid}}})
    for n, (kind, value) in enumerate([('thinking', 'fixture reasoning'), ('text', text)]):
        emit({'type': 'stream_event', 'session_id': sid, 'event': {'type': 'content_block_start', 'index': n, 'content_block': {'type': kind, kind: ''}}})
        emit({'type': 'stream_event', 'session_id': sid, 'event': {'type': 'content_block_delta', 'index': n, 'delta': {'type': 'thinking_delta' if kind == 'thinking' else 'text_delta', kind: value}}})
    row = append({'type': 'assistant', 'uuid': str(uuid.uuid4()), 'message': {'id': mid, 'model': model, 'content': [{'type': 'thinking', 'thinking': 'fixture reasoning'}, {'type': 'text', 'text': text}]}})
    emit(row)
    emit({'type': 'result', 'session_id': sid, 'subtype': 'success', 'is_error': False})
    state('idle')
    turn = None


for line in sys.stdin:
    v = json.loads(line)
    if v['type'] == 'control_request':
        req = v['request']
        kind = req['subtype']
        response = {}
        if kind == 'initialize':
            response = {'models': [{'value': 'fixture-sonnet', 'displayName': 'Fixture Sonnet'}, {'value': 'fixture-opus', 'displayName': 'Fixture Opus'}], 'model': model, 'session_id': sid, 'hooks_applied': True}
        elif kind == 'set_model':
            model = req['model']
        elif kind == 'interrupt':
            if text == 'reject-interrupt':
                emit({'type': 'control_response', 'response': {'subtype': 'error', 'request_id': v['request_id'], 'error': 'fixture rejected interrupt'}})
                finish('natural completion after rejected interrupt')
                continue
            for request_id in pending:
                emit({'type': 'control_cancel_request', 'request_id': request_id})
            pending.clear()
        emit({'type': 'control_response', 'response': {'subtype': 'success', 'request_id': v['request_id'], 'response': response}})
        if kind == 'interrupt':
            finish('interrupted', True)
    elif v['type'] == 'control_response':
        r = v['response']
        original = pending.pop(r['request_id'])
        result = r['response']
        if result['behavior'] == 'allow':
            assert result['updatedInput'].get('command') == original['input'].get('command')
        tr = append({'type': 'user', 'uuid': str(uuid.uuid4()), 'message': {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': original['tool_use_id'], 'content': json.dumps(result)}]}})
        emit(tr)
        finish(json.dumps(result))
    elif v['type'] == 'user':
        assert turn is None
        turn = v['uuid']
        append({'type': 'user', 'uuid': turn, 'message': v['message']})
        state('running')
        emit({'type': 'system', 'subtype': 'init', 'model': model, 'session_id': sid})
        content = v['message']['content']
        text = '\n'.join(b.get('text', '') for b in content)
        if text == 'subagent':
            for kind, content in [('assistant', [{'type': 'text', 'text': 'CHILD_ONLY'}]), ('user', [{'type': 'tool_result', 'tool_use_id': 'child-tool', 'content': 'CHILD_RESULT'}])]:
                emit({'type': kind, 'uuid': str(uuid.uuid4()), 'session_id': sid, 'parent_tool_use_id': 'agent-parent', 'message': {'id': 'child-message', 'content': content}})
            finish('PARENT_ONLY')
            continue
        if text == 'background':
            finish('INITIAL_RESULT')
            state('running')
            emit({'type': 'stream_event', 'session_id': sid, 'event': {'type': 'message_start', 'message': {'id': 'followup-message'}}})
            emit({'type': 'stream_event', 'session_id': sid, 'event': {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}}})
            emit({'type': 'stream_event', 'session_id': sid, 'event': {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': 'FOLLOWUP_RUNNING'}}})
            turn = 'background-native-turn'
            continue
        if text == 'crash':
            print('{broken', flush=True)
            sys.exit(1)
        if text == 'fail':
            emit({'type': 'result', 'session_id': sid, 'subtype': 'error_during_execution', 'is_error': True})
            state('idle')
            turn = None
            continue
        if text in ('idle-error', 'idle-eof'):
            state('idle')
            if text == 'idle-eof':
                sys.exit(0)
            emit({'type': 'result', 'session_id': sid, 'subtype': 'error_during_execution', 'is_error': True})
            turn = None
            continue
        if text in ('approval', 'question'):
            tool = 'AskUserQuestion' if text == 'question' else 'Bash'
            tool_input = {'questions': [{'header': 'Choose', 'question': 'Choose an option?', 'options': [{'label': 'A', 'description': 'Option A'}, {'label': 'B', 'description': 'Option B'}], 'multiSelect': False}]} if tool == 'AskUserQuestion' else {'command': 'pwd'}
            tool_id = str(uuid.uuid4())
            row = append({'type': 'assistant', 'uuid': str(uuid.uuid4()), 'message': {'id': str(uuid.uuid4()), 'content': [{'type': 'tool_use', 'id': tool_id, 'name': tool, 'input': tool_input}]}})
            emit(row)
            request_id = 'permission-' + str(uuid.uuid4())
            request = {'subtype': 'can_use_tool', 'tool_name': tool, 'input': tool_input, 'tool_use_id': tool_id}
            pending[request_id] = request
            emit({'type': 'control_request', 'request_id': request_id, 'request': request})
        elif text in ('wait', 'reject-interrupt'):
            pass
        else:
            finish('attachment types: ' + ','.join(b['type'] for b in content) if len(content) > 1 else 'fixture answer')
