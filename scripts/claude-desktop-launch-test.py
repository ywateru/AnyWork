#!/usr/bin/env python3
"""Fixture and local transport tests; these do NOT validate native Claude."""
import base64
import contextlib
import hashlib
import http.client
import importlib.util
import io
import json
import os
import pathlib
import socket
import stat
import struct
import subprocess
import tempfile
import threading
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('desktop_launch', HERE / 'claude-desktop-launch.py')
launch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)


def masked(value):
    data = json.dumps(value).encode()
    key = b'abcd'
    size = len(data)
    header = b'\x81' + (bytes([0x80 | size]) if size < 126 else b'\xfe' + struct.pack('!H', size) if size < 65536 else b'\xff' + struct.pack('!Q', size))
    return header + key + bytes(v ^ key[i % 4] for i, v in enumerate(data))


def server_frame(stream):
    a, b = launch.read_exact(stream, 2)
    size = b & 127
    if size == 126:
        size = struct.unpack('!H', launch.read_exact(stream, 2))[0]
    elif size == 127:
        size = struct.unpack('!Q', launch.read_exact(stream, 8))[0]
    return json.loads(launch.read_exact(stream, size))


class LauncherTests(unittest.TestCase):
    def test_private_atomic_publication_and_owner_cleanup(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp).resolve() / 'private'
            path = root / 'host.json'
            identity = launch.publish(path, {'instanceId': 'fixture'})
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with self.assertRaises(launch.SetupError):
                launch.publish(path, {})
            launch.cleanup(path, (0, 0))
            self.assertTrue(path.exists())
            launch.cleanup(path, identity)
            self.assertFalse(path.exists())
            link = root / 'link'
            link.symlink_to('/tmp')
            with self.assertRaises(launch.SetupError):
                launch.publish(link / 'host.json', {})

    def test_no_native_startup_or_debug_switch_in_snippet(self):
        token = 'x' * 43
        script = launch.snippet(12345, token, (HERE / 'claude-desktop-carrier.js').read_text())
        self.assertIn("new WebSocket('ws://127.0.0.1:12345/native')", script)
        self.assertIn('JSON.stringify({token:', script)
        self.assertNotIn('native?token', script)
        self.assertNotIn('CLAUDE_CDP_AUTH', script)
        self.assertNotIn('eval(', script)
        result = subprocess.run(['node', '--check'], input=script, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_frame_validation_and_large_payload(self):
        for size in [1, 200, 70000]:
            value = {'payload': 'x' * size}
            opcode, raw = launch.receive_frame(io.BytesIO(masked(value)))
            self.assertEqual(opcode, 1)
            self.assertEqual(json.loads(raw), value)
        for frame in [b'\x81\x01x', b'\x01\x80abcd', b'\xc1\x80abcd']:
            with self.assertRaises((launch.SetupError, ConnectionError)):
                launch.receive_frame(io.BytesIO(frame))

    def test_fragmented_message_and_interleaved_ping(self):
        def frame(op, data, final):
            key = b'abcd'
            return bytes([(0x80 if final else 0) | op, 0x80 | len(data)]) + key + bytes(v ^ key[i % 4] for i, v in enumerate(data))
        stream = io.BytesIO(frame(1, b'{"ok":', False) + frame(9, b'ping', True) + frame(0, b'true}', True))
        pongs = []
        opcode, raw = launch.receive_message(stream, pongs.append)
        self.assertEqual((opcode, json.loads(raw), pongs), (1, {'ok': True}, [b'ping']))
        with self.assertRaises(launch.SetupError):
            launch.receive_message(io.BytesIO(frame(0, b'x', True)), pongs.append)

    def test_real_http_and_websocket_transport_with_fake_preload_peer(self):
        server = launch.Server(('127.0.0.1', 0), launch.Handler)
        server.broker = launch.Broker()
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        port = server.server_port
        peer = None
        try:
            client = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
            client.request('POST', '/rpc', b'{}', {'Authorization': 'Bearer wrong'})
            response = client.getresponse()
            self.assertEqual(response.status, 403)
            response.read(); client.close()
            peer = socket.create_connection(('127.0.0.1', port), timeout=3)
            stream = peer.makefile('rb')
            key = base64.b64encode(os.urandom(16)).decode()
            peer.sendall((f'GET /native HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: app://localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n').encode())
            self.assertIn(b'101', stream.readline())
            while stream.readline() != b'\r\n':
                pass
            peer.sendall(masked({'token': server.broker.native_token, 'protocol': 1}))
            self.assertTrue(server.broker.ready.wait(3))
            self.assertTrue(server.broker.claimed)
            self.assertEqual(server.broker.native_token, '')
            def respond():
                req = server_frame(stream)
                peer.sendall(masked({'requestId': req['requestId'], 'result': {'ok': True, 'value': {'fixture': req['command']}}}))
            native = threading.Thread(target=respond)
            native.start()
            client = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
            command = {'op': 'poll', 'id': 'fixture', 'cursor': 0}
            client.request('POST', '/rpc', json.dumps(command), {'Authorization': 'Bearer ' + server.broker.client_token, 'Content-Type': 'application/json'})
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())['value']['fixture'], command)
            client.close(); native.join(3)
            # Shutdown wakes pending callers, without an app/process lifecycle API.
            server.broker.detach(server.broker.peer)
            self.assertFalse(server.broker.rpc(command)['ok'])
        finally:
            if peer:
                peer.close()
            server.shutdown(); server.server_close(); worker.join(3)

    def test_carrier_fake_native_contract(self):
        script = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[1], 'utf8');
const sid = 'local_00000000-0000-4000-8000-000000000001';
const row = {sessionId:sid,cliSessionId:'cli-fixture',cwd:'/fixture',model:'native-fixture-model',pendingToolPermissions:[],cloudSessionId:'rc-fixture'};
const events = new Set(), permissions = new Set(), calls = [];
let startInfo, leak = false;
const api = {
 getSessionList:async()=>{if(leak)throw Error('Invalid ACCOUNT_SECRET');return {sessions:[row,{sessionId:'cloud-fixture'}],loadGeneration:4};},
 getSession:async id=>id===sid?row:null,
 start:async info=>{startInfo=info;return {sessionId:sid};},
 sendMessage:async(...args)=>{calls.push(['send',args]);},
 interrupt:async id=>{calls.push(['interrupt',id]);}, stop:async id=>calls.push(['stop',id]),
 setModel:async(...args)=>calls.push(['model',args]), setEffort:async()=>{},setPermissionMode:async()=>{},
 getDefaultEffort:async()=> 'high',getAdvisorSetting:async()=>null,
 getTranscript:async()=>[{type:'assistant',uuid:'fixture'}],
 getTranscriptTail:async()=>({messages:[{type:'assistant',uuid:'fixture'}],hasMore:false}),
 getTranscriptPage:async()=>({messages:[],hasMore:false,found:true}),
 respondToToolPermission:async(...args)=>{calls.push(['permission',args]);row.pendingToolPermissions=[];},
 onOnEvent:f=>{events.add(f);return()=>events.delete(f);},
 onOnToolPermissionRequest:f=>{permissions.add(f);return()=>permissions.delete(f);}
};
const dispatch = vm.runInNewContext(source,{'claude.web':{LocalSessions:api}});
const cmd = async (op,extra={})=>JSON.parse(JSON.stringify(await dispatch({id:'fixture',op,...extra})));
const invoke = (method,args=[])=>cmd('invoke',{method,args});
(async()=>{
 assert.equal((await cmd('open')).ok,true); assert.equal(events.size,1);
 let list=await invoke('getSessionList');assert.equal(list.value.sessions.length,1);assert.equal(list.value.sessions[0].cliSessionId,'cli-fixture');
 assert.equal((await invoke('getSession',[sid])).value.sessionId,sid);
 assert.equal((await invoke('getTranscriptTail',[sid,50])).value.messages[0].uuid,'fixture');
 assert.equal((await invoke('getTranscriptPage',[sid,'before-fixture',50])).value.found,true);
 assert.equal((await invoke('models')).value.catalogComplete,false);
 assert.equal((await invoke('start',[{cwd:'/fixture',message:'',withoutFirstMessage:true}])).ok,true);assert.equal(startInfo.withoutFirstMessage,true);
 const attack="'); globalThis.PWNED=true; //";
 assert.equal((await invoke('send',[{sessionId:sid,message:attack}])).ok,true);assert.equal(calls.at(-1)[1][1],attack);
 assert.equal((await invoke('setModel',[sid,'chosen-native-model'])).ok,true);
 assert.equal((await invoke('interrupt',[sid])).ok,true);
 assert.equal((await invoke('evaluate',['process.env'])).ok,false);
 assert.equal((await invoke('start',[{cwd:'/fixture',message:'',systemPrompt:'synthetic'}])).ok,false);
 assert.equal((await invoke('sendMessage',[sid,'x',null,{synthetic:true}])).ok,false);
 const req={sessionId:sid,requestId:'permission-fixture',toolName:'AskUserQuestion',input:{questions:[{question:'Fixture question?'}]}};
 row.pendingToolPermissions=[req];for(const f of permissions)f(req);
 assert.equal((await invoke('respondToToolPermission',['permission-fixture','once',{answers:{'Fixture question?':'fixture answer'}}])).ok,true);
 assert.equal(calls.at(-1)[1][2].answers['Fixture question?'],'fixture answer');
 assert.equal((await invoke('respondToToolPermission',['permission-fixture','once'])).ok,false);
 for(let i=0;i<1100;i++)for(const f of events)f({type:'message',sessionId:sid,message:{type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:String(i)}}}});
 const poll=await cmd('poll',{cursor:0});assert.equal(poll.value.gap,true);assert.equal(poll.value.events.length,128);assert.equal(poll.value.events[0].event.message.type,'stream_event');
 leak=true;assert.equal((await invoke('getSessionList')).error.includes('ACCOUNT_SECRET'),false);leak=false;
 assert.equal((await cmd('close')).ok,true);assert.equal(events.size,0);assert.equal(permissions.size,0);assert.equal(calls.some(c=>c[0]==='stop'),false);
 console.log('Carrier fixture contract passed (not native acceptance)');
})().catch(e=>{console.error(e);process.exit(1);});
"""
        result = subprocess.run(['node', '-e', script, str(HERE / 'claude-desktop-carrier.js')], text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('not native acceptance', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
