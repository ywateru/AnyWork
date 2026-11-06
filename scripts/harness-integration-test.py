#!/usr/bin/env python3
"""Exercise a REAL, explicitly isolated upstream Harness host (never a fake carrier).

Prepare pinned npm Harness + deterministic local provider as documented in
 docs/harness-setup.md. No production account/key or default host is used.
"""
import argparse
import base64
import json
import os
import pathlib
import socket
import struct
import zlib
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host-url-file', type=pathlib.Path, required=True)
parser.add_argument('--workspace', type=pathlib.Path, required=True)
parser.add_argument('--runtime-package', type=pathlib.Path, required=True, help='isolated npm package.json with Harness/ws installed')
parser.add_argument('--node', default='node')
parser.add_argument('--binary', type=pathlib.Path, default=ROOT/'target/debug/anywork')
args = parser.parse_args()
launch = args.host_url_file.read_text().strip()
parsed = urllib.parse.urlsplit(launch)
assert parsed.hostname in {'localhost', '127.0.0.1', '::1'}, 'Only isolated loopback hosts are accepted'
workspace = args.workspace.resolve(strict=True)

def native(session=None, prompt=None):
    command=[args.node,str(ROOT/'scripts/harness-native-probe.mjs'),'--host-url-file',str(args.host_url_file),'--workspace',str(workspace),'--runtime-package',str(args.runtime_package.resolve())]
    if session: command += ['--session',session]
    if prompt: command += ['--prompt',prompt]
    result=subprocess.run(command,capture_output=True,text=True,timeout=40)
    assert result.returncode == 0, result.stderr.replace(launch,'[Harness credential]')
    return json.loads(result.stdout)

def _ready(base,token):
    try:
        urllib.request.urlopen(urllib.request.Request(base+'info',headers={'Authorization':'Bearer '+token}),timeout=1).close();return True
    except (urllib.error.URLError,ConnectionError):return False

def completed(events,count):
    return events if len([e for e in events if e['method']=='turn/completed'])>=count else None

preexisting=native(prompt='verify-history')['sessionId']
with tempfile.TemporaryDirectory(prefix='anywork-harness-integration-') as temporary:
    root=pathlib.Path(temporary)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
    token='isolated-harness-'+os.urandom(16).hex()
    env=os.environ.copy();env['ANYWORK_HARNESS_URL']=launch;env['ANYWORK_TOKEN']=token
    log=(root/'server.log').open('w+')
    server=subprocess.Popen([str(args.binary.resolve()),'--bind',f'127.0.0.1:{port}','--workspace',str(workspace),'--data-dir',str(root/'data'),'--web-dir',str(root/'web'),'--plugins-dir',str(root/'plugins'),'--codex-discovery','false'],env=env,stdout=log,stderr=log)
    base=f'http://127.0.0.1:{port}/api/'
    def api(path,data=None):
        request=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        try: return json.load(urllib.request.urlopen(request,timeout=25))
        except urllib.error.HTTPError as error: raise AssertionError(error.read().decode()) from error
    def wait(check):
        limit=time.monotonic()+25
        while time.monotonic()<limit:
            value=check()
            if value:return value
            time.sleep(.05)
        raise AssertionError('Harness integration condition timed out')
    try:
        wait(lambda: server.poll() is None and _ready(base,token))
        rows=api('sessions');assert not rows.get('discovery_error'),rows
        sid='harness-'+preexisting
        assert any(row['id']==sid and row['external'] for row in rows['sessions']),rows
        history=api('sessions/'+sid+'/history')['events']
        assert any(event['method']=='user/message' and event['params']['text']=='verify-history' for event in history),history
        before=len(history);api('sessions/'+sid+'/connect',{})
        assert len(api('sessions/'+sid+'/history')['events'])==before,'Replayed history duplicated'
        # The original native client sends to the SAME session after AnyWork attaches.
        native(session=preexisting,prompt='verify-history')
        wait(lambda: len([e for e in api('sessions/'+sid+'/events/poll')['events'] if e['method']=='user/message'])==2)
        created=api('sessions',{'agent':'deepseek-harness','cwd':'.'})['session'];sid=created['id'];assert created['external']
        assert created['thread_id'] in native()['sessions'],'AnyWork created an alternate local session'
        api('sessions/'+sid+'/messages',{'text':'verify-tools'})
        events=wait(lambda: completed(api('sessions/'+sid+'/events/poll')['events'],1))
        assert len([e for e in events if e['method']=='user/message'])==1,'Injected contexts leaked as users'
        assert any(e['params'].get('item',{}).get('tool')=='bash' for e in events),events
        assert any('ANYWORK_HARNESS_TOOL_OK' in str(e['params'].get('item',{}).get('output','')) for e in events),events
        api('sessions/'+sid+'/messages',{'text':'verify-approval'})
        request=wait(lambda: next((e for e in api('sessions/'+sid+'/events/poll')['events'] if e['method'].endswith('/requestApproval')),None))
        assert request['params']['availableDecisions']==['accept','decline']
        api('sessions/'+sid+'/respond',{'request_id':request['request_id'],'accept':True})
        events=wait(lambda: completed(api('sessions/'+sid+'/events/poll')['events'],2))
        assert any(e['method']=='serverRequest/resolved' for e in events)
        # Upload real PNG bytes through AnyWork, then hydrate the native durable
        # reference and verify the existing authenticated preview endpoint.
        def png_chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
        png=b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR',struct.pack('>IIBBBBB',32,24,8,2,0,0,0))+png_chunk(b'IDAT',zlib.compress((b'\0'+b'\x40\x80\xc0'*32)*24))+png_chunk(b'IEND',b'')
        (workspace/'image.png').write_bytes(png)
        boundary='anywork-harness-fixture'
        body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+png+f'\r\n--{boundary}--\r\n'.encode())
        request=urllib.request.Request(base+'sessions/'+sid+'/uploads',data=body,headers={'Authorization':'Bearer '+token,'Content-Type':'multipart/form-data; boundary='+boundary})
        uploaded=json.load(urllib.request.urlopen(request))['files'][0]['path']
        api('sessions/'+sid+'/messages',{'text':'verify-image','attachments':[uploaded]})
        events=wait(lambda: completed(api('sessions/'+sid+'/events/poll')['events'],3))
        preview=next(path for event in events if event['method']=='user/message' for path in event['params'].get('attachments',[]))
        request=urllib.request.Request(base+'sessions/'+sid+'/image?'+urllib.parse.urlencode({'path':preview}),headers={'Authorization':'Bearer '+token})
        assert urllib.request.urlopen(request).read().startswith(b'\x89PNG')
        api('sessions/'+sid+'/messages',{'text':'verify-tool-image'})
        events=wait(lambda: completed(api('sessions/'+sid+'/events/poll')['events'],4))
        assert any(block.get('type')=='localImage' for event in events for block in event['params'].get('item',{}).get('content',[])),events
        assert api('sessions/'+sid+'/composer')['plan_available'] is False
        print('PASS: actual Harness discovery, native shared-session traffic, fixed-cut history/replay, host creation, tools, one-time approval, prompt images, tool images, capability boundaries')
    finally:
        server.terminate()
        try: server.wait(timeout=10)
        except subprocess.TimeoutExpired: server.kill();server.wait(timeout=5)
        log.close()
# Closing AnyWork releases only its API peers. The external host is still usable.
assert preexisting in native()['sessions']
print('PASS: disconnect preserves external Harness host and sessions')
