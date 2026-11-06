#!/usr/bin/env python3
"""Exercise original-engine messaging/steering/interruption through real HTTP + Unix WS."""
import base64, hashlib, json, os, pathlib, shlex, socket, socketserver, struct, subprocess, tempfile, threading, time, unittest, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
BINARY=os.environ.get('ANYWORK_BINARY',str(ROOT/'target/debug/anywork'))

def read(sock,n):
    data=b''
    while len(data)<n:
        chunk=sock.recv(n-len(data))
        if not chunk: raise EOFError()
        data+=chunk
    return data

def receive(sock):
    a,b=read(sock,2);n=b&127
    if n==126:n=struct.unpack('!H',read(sock,2))[0]
    elif n==127:n=struct.unpack('!Q',read(sock,8))[0]
    mask=read(sock,4) if b&128 else None
    data=read(sock,n)
    if mask:data=bytes(v^mask[i%4] for i,v in enumerate(data))
    if a&15==8:raise EOFError()
    return json.loads(data)

def send(sock,v):
    data=json.dumps(v).encode();n=len(data)
    head=bytes([129,n]) if n<126 else bytes([129,126])+struct.pack('!H',n)
    sock.sendall(head+data)

class Daemon(socketserver.ThreadingUnixStreamServer):
    daemon_threads=True
    allow_reuse_address=True

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            header=b''
            while not header.endswith(b'\r\n\r\n'):header+=read(self.request,1)
            key=next(line.split(b':',1)[1].strip() for line in header.split(b'\r\n') if line.lower().startswith(b'sec-websocket-key:'))
            accept=base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
            self.request.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+b'\r\n\r\n')
            while True:
                req=receive(self.request);method=req.get('method');params=req.get('params',{});rid=req.get('id')
                self.server.requests.append((method,params))
                def event(method,params):send(self.request,{'method':method,'params':{'threadId':'ordinary',**params}})
                if method=='initialized':continue
                if method is None:
                    assert rid==700
                    self.server.pending=False
                    event('serverRequest/resolved',{'requestId':700})
                    self.server.active=False
                    event('turn/completed',{'turn':{'id':'native-turn','status':'completed'}})
                    continue
                if method=='initialize':result=getattr(self.server,'initialize',{})
                elif method=='thread/list':result={'data':[] if params.get('archived') else [self.server.thread()], 'nextCursor':None}
                elif method=='thread/read':result={'thread':self.server.thread()}
                elif method=='thread/resume':
                    assert params=={'threadId':'ordinary','excludeTurns':True},params
                    result={'thread':self.server.thread(), **self.server.settings, 'reasoningEffort':self.server.settings['effort']}
                    # Unrelated thread events must never enter this session.
                    send(self.request,{'method':'item/completed','params':{'threadId':'other','item':{'id':'wrong-thread','type':'agentMessage','text':'wrong thread'}}})
                elif method=='thread/turns/list':result={'data':[{'id':'native-turn','status':'inProgress' if self.server.active else 'completed','items':self.server.rich_items}],'nextCursor':None}
                elif method=='thread/items/list':
                    rows=[{'turnId':'native-turn','item':item} for item in self.server.rich_items]
                    if params.get('sortDirection')=='desc':rows.reverse()
                    result={'data':rows,'nextCursor':None}
                elif method=='thread/goal/get':result={'goal':self.server.goal}
                elif method=='thread/goal/set':
                    assert params['threadId']=='ordinary' and params['origin']=='user'
                    assert set(params).issubset({'threadId','objective','status','origin'})
                    self.server.goal={**(self.server.goal or {}), **{k:v for k,v in params.items() if k in ['objective','status']}}
                    result={'goal':self.server.goal}
                elif method=='thread/goal/clear':
                    assert params=={'threadId':'ordinary','origin':'user'}
                    self.server.goal=None;result={'cleared':True}
                elif method=='model/list':
                    result={'data':[{'id':model,'model':model,'displayName':model,'defaultReasoningEffort':'high','supportedReasoningEfforts':[{'reasoningEffort':v,'description':v} for v in ['medium','high']],'defaultServiceTier':tiers[0],'serviceTiers':[{'id':tier,'name':tier,'description':'Native tier '+tier} for tier in tiers]} for model,tiers in [('native-model',['native-standard','native-priority']),('native-other',['native-other-tier'])]]}
                elif method=='configRequirements/read':result={'requirements':None,'supportsIndependentSpeedModes':True}
                elif method=='thread/settings/update':
                    assert not self.server.active or set(params)=={'threadId','effort'}
                    assert params['threadId']=='ordinary'
                    assert set(params).issubset({'threadId','collaborationMode','model','effort','serviceTier'}),params
                    if 'collaborationMode' in params:
                        mode=params['collaborationMode'];assert mode['settings']=={'model':self.server.settings['model'],'reasoning_effort':self.server.settings['effort'],'developer_instructions':None},params
                        assert mode['mode'] in ['plan','default']
                        self.server.settings['collaborationMode']=mode
                    for key in ['model','effort','serviceTier']:
                        if key in params:self.server.settings[key]=params[key]
                    event('thread/settings/updated',{'threadSettings':self.server.settings})
                    result={}
                elif method=='turn/steer':
                    assert self.server.active and params['expectedTurnId']=='native-turn'
                    assert set(params) in ({'threadId','expectedTurnId','input'}, {'threadId','expectedTurnId','input','clientUserMessageId'})
                    result={'turnId':'native-turn'}
                    if params['input'][0].get('text')=='status only idle':
                        self.server.active=False
                        event('thread/status/changed',{'status':{'type':'idle'}})
                    if params['input'][0].get('text')=='finish current':
                        self.server.active=False
                        event('turn/completed',{'turn':{'id':'native-turn','status':'completed'}})
                elif method=='turn/interrupt':
                    assert params=={'threadId':'ordinary','turnId':'native-turn'}
                    result={}
                    event('turn/completed',{'turn':{'id':'native-turn','status':'interrupted'}})
                    threading.Timer(.15,lambda:setattr(self.server,'active',False)).start()
                elif method=='turn/start':
                    assert not self.server.active
                    assert set(params) in ({'threadId','input'}, {'threadId','input','clientUserMessageId'}),params
                    self.server.active=True;result={'turn':{'id':'native-turn','status':'inProgress'}}
                    event('turn/started',result)
                    if params['input'][0].get('text')=='approval':
                        self.server.pending=True
                        send(self.request,{'id':700,'method':'item/commandExecution/requestApproval','params':{'threadId':'ordinary','turnId':'native-turn','command':'echo fixture'}})
                else:raise AssertionError(method)
                if method in ('turn/start','turn/steer') and params.get('clientUserMessageId'):
                    item={'id':'rich-user-'+str(len(self.server.rich_items)), 'type':'userMessage', 'clientId':params['clientUserMessageId'], 'content':params['input']}
                    self.server.rich_items.append(item)
                    event('item/completed',{'turnId':'native-turn','item':item})
                send(self.request,{'id':rid,'result':result})
        except (EOFError,ConnectionError,OSError):pass

class SharedControl(unittest.TestCase):
    def test_unowned_desktop_routes_to_existing_shared_engine(self):
        import runpy
        fixture = runpy.run_path(str(ROOT / 'scripts/desktop-host-http-test.py'))
        host = fixture['Host'](self.base / 'unowned-desktop.sock', self.workspace)
        host.no_owner = True
        threading.Thread(target=host.serve_forever, daemon=True).start()
        data = self.base / 'desktop-routing-data'
        data.mkdir()
        (data / 'desktop-host.json').write_text(json.dumps({'version': 1, 'socket': str(self.base / 'unowned-desktop.sock')}))
        with socket.socket() as address:
            address.bind(('127.0.0.1', 0)); port = address.getsockname()[1]
        env = {key: value for key, value in os.environ.items() if key != 'ANYWORK_DESKTOP_IPC_SOCKET'}
        env.update(CODEX_BIN=str(self.cli), CODEX_HOME=str(self.home))
        proc = subprocess.Popen([BINARY, '--bind', f'127.0.0.1:{port}', '--workspace', str(self.workspace),
                                 '--data-dir', str(data), '--token', 'routing-test-token'], cwd=ROOT,
                                env=env, stdout=self.log, stderr=self.log)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        def request(path, value=None):
            req = urllib.request.Request(f'http://127.0.0.1:{port}/api' + path,
                data=None if value is None else json.dumps(value).encode(),
                headers={'Authorization': 'Bearer routing-test-token', 'Content-Type': 'application/json'})
            return json.load(opener.open(req, timeout=15))
        try:
            for _ in range(100):
                try: request('/health'); break
                except OSError: time.sleep(.05)
            request('/sessions')
            base = '/sessions/codex-ordinary'
            self.assertTrue(request(base + '/connect', {})['connected'])
            self.assertTrue(request(base + '/composer')['settings_available'])
            self.assertNotEqual(request(base + '/history?paged=true').get('source'), 'desktop')
            self.assertTrue(any(frame.get('method') == 'thread-owner-discovery' for frame in host.frames))
            self.assertEqual(host.mutations(), [])
            self.assertEqual(host.errors, [])
        finally:
            proc.terminate(); proc.wait(timeout=10)
            host.shutdown(); host.server_close()

    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='aw-shared-', dir='/tmp');cls.base=pathlib.Path(cls.temp.name).resolve()
        cls.workspace=cls.base/'workspace';cls.workspace.mkdir()
        home=cls.base/'codex';control=home/'app-server-control';control.mkdir(parents=True)
        cls.daemon=Daemon(str(control/'app-server-control.sock'),Handler)
        cls.daemon.requests=[];cls.daemon.rich_items=[];cls.daemon.active=True;cls.daemon.pending=False;cls.daemon.goal=None
        cls.daemon.settings={'model':'native-model','effort':'high','serviceTier':'native-standard','collaborationMode':{'mode':'default','settings':{'model':'native-model'}}}
        cls.daemon.thread=lambda:{'id':'ordinary','cwd':str(cls.workspace),'name':'普通会话','source':'cli','status':{'type':'active' if cls.daemon.active else 'idle','activeFlags':['waitingOnApproval'] if cls.daemon.pending else []},'createdAt':1,'updatedAt':2}
        threading.Thread(target=cls.daemon.serve_forever,daemon=True).start()
        cls.cli=cls.base/'codex-bin';cls.cli.write_text('#!/bin/sh\nexec python3 '+shlex.quote(str(ROOT/'scripts/fake-agent.py'))+' "$@"\n');cls.cli.chmod(0o700)
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));cls.port=sock.getsockname()[1]
        cls.log=open(cls.base/'server.log','w+');cls.home=home
        cls.start()
    @classmethod
    def start(cls):
        cls.proc=subprocess.Popen([BINARY,'--bind',f'127.0.0.1:{cls.port}','--workspace',str(cls.workspace),'--data-dir',str(cls.base/'data'),'--token','shared-test-token'],cwd=ROOT,env={**os.environ,'CODEX_BIN':str(cls.cli),'CODEX_HOME':str(cls.home)},stdout=cls.log,stderr=cls.log)
        for _ in range(100):
            try:urllib.request.urlopen(f'http://127.0.0.1:{cls.port}/api/health',timeout=1);break
            except OSError:time.sleep(.05)
    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate();cls.proc.wait(timeout=10)
        # Closing the remote client must not stop the original execution engine.
        assert cls.daemon.active
        cls.daemon.shutdown();cls.daemon.server_close();cls.log.close();cls.temp.cleanup()
    def request(self,path,data=None):
        req=urllib.request.Request(f'http://127.0.0.1:{self.port}/api'+path,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer shared-test-token','Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=10) as response:return json.load(response)
    def wait(self,predicate):
        for _ in range(100):
            if predicate():return
            time.sleep(.02)
        self.fail('Timed out waiting for event')
    def test_locked_independent_thread_stays_readable_through_shared_catalog(self):
        import fcntl
        original=self.daemon.thread
        self.daemon.thread=lambda:{**original(),'status':{'type':'notLoaded'}}
        locks=self.home/'thread-writer-locks';locks.mkdir(exist_ok=True)
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        proc=subprocess.Popen([BINARY,'--bind',f'127.0.0.1:{port}','--workspace',str(self.workspace),'--data-dir',str(self.base/'locked-data'),'--token','locked-test-token'],cwd=ROOT,env={**os.environ,'CODEX_BIN':str(self.cli),'CODEX_HOME':str(self.home)},stdout=self.log,stderr=self.log)
        def request(path,data=None):
            req=urllib.request.Request(f'http://127.0.0.1:{port}/api'+path,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer locked-test-token','Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
        try:
            for _ in range(100):
                try:request('/info');break
                except OSError:time.sleep(.05)
            request('/sessions');base='/sessions/codex-ordinary'
            before=len(self.daemon.requests)
            with open(locks/'ordinary.lock','w') as writer:
                fcntl.flock(writer,fcntl.LOCK_EX|fcntl.LOCK_NB)
                self.assertTrue(request(base+'/models')['data'])
                self.assertFalse(request(base+'/composer')['settings_available'])
                self.assertIn('events',request(base+'/history?paged=true'))
                connection=request(base+'/connect',{})
                self.assertFalse(connection['connected']);self.assertIn('独立 Codex',connection['reason'])
                self.assertEqual(connection['code'],'owner_unavailable')
                calls=self.daemon.requests[before:]
                self.assertFalse(any(method in ['thread/resume','thread/start','turn/start','thread/fork'] for method,_ in calls))
            self.assertTrue(request(base+'/connect',{})['connected'])
        finally:
            self.daemon.thread=original
            proc.terminate();proc.wait(timeout=10)

    def registered_owner(self, mismatch=None):
        import fcntl
        original=self.daemon.thread
        self.daemon.thread=lambda:{**original(),'status':{'type':'notLoaded'}}
        endpoint=self.base/('owner-'+str(time.time_ns())+'.sock')
        owner=Daemon(str(endpoint),Handler)
        owner.requests=[];owner.rich_items=[];owner.active=True;owner.pending=False;owner.goal=None
        owner.settings=dict(self.daemon.settings)
        owner.initialize={'codexHome':str(self.home if mismatch!='home' else self.workspace)}
        owner.thread=lambda:{**original(),'cwd':str(self.base if mismatch=='cwd' else self.workspace),'status':{'type':'active','activeFlags':[]}}
        threading.Thread(target=owner.serve_forever,daemon=True).start()
        data=self.base/('registry-'+str(time.time_ns()));data.mkdir()
        (data/'codex-runtimes.json').write_text(json.dumps({'version':1,'runtimes':[{'socket':str(endpoint),'codex_home':str(self.home)}]}))
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        proc=subprocess.Popen([BINARY,'--bind',f'127.0.0.1:{port}','--workspace',str(self.workspace),'--data-dir',str(data),'--token','registered-owner-token'],cwd=ROOT,env={**os.environ,'CODEX_BIN':str(self.cli),'CODEX_HOME':str(self.home)},stdout=self.log,stderr=self.log)
        def request(path,data=None):
            req=urllib.request.Request(f'http://127.0.0.1:{port}/api'+path,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer registered-owner-token','Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
        try:
            for _ in range(100):
                try:request('/info');break
                except OSError:time.sleep(.05)
            request('/sessions');base='/sessions/codex-ordinary'
            locks=self.home/'thread-writer-locks';locks.mkdir(exist_ok=True)
            before=len(self.daemon.requests)
            with open(locks/'ordinary.lock','w') as writer:
                fcntl.flock(writer,fcntl.LOCK_EX|fcntl.LOCK_NB)
                result=request(base+'/connect',{})
                if mismatch:
                    self.assertFalse(result['connected']);self.assertEqual(result['code'],'owner_unavailable')
                    self.assertFalse(any(method=='thread/resume' for method,_ in owner.requests))
                else:
                    self.assertTrue(result['connected'])
                    self.assertTrue(request(base+'/composer')['settings_available'])
                    request(base+'/messages',{'text':'route to actual owner'})
                    self.assertTrue(any(method=='turn/steer' for method,_ in owner.requests))
                    self.assertEqual(request(base)['session']['status'],'running')
                self.assertFalse(any(method in ['thread/resume','turn/start','turn/steer'] for method,_ in self.daemon.requests[before:]))
        finally:
            proc.terminate();proc.wait(timeout=10)
            self.assertTrue(owner.active)
            owner.shutdown();owner.server_close()
            self.daemon.thread=original

    def test_registered_owner_is_used_before_writer_lock_fallback(self):
        self.registered_owner()

    def test_registered_socket_with_wrong_workspace_is_not_resumed(self):
        self.registered_owner('cwd')

    def test_registered_socket_with_wrong_codex_home_is_not_resumed(self):
        self.registered_owner('home')

    def test_native_composer_preserves_original_model_permissions_and_thread(self):
        self.request('/sessions')
        base='/sessions/codex-ordinary'
        self.request(base+'/connect',{})
        current=self.request(base+'/composer');self.assertEqual((current['model'],current['effort']),('native-model','high'))
        self.assertEqual(self.request(base+'/composer',{'action':'settings','effort':'medium'})['effort'],'medium')
        self.assertTrue(self.daemon.active)
        self.daemon.active=False
        self.request(base+'/composer',{'action':'settings','effort':'medium'})
        self.assertEqual(self.request(base+'/composer')['effort'],'medium')
        self.request(base+'/composer',{'action':'plan','enabled':True})
        self.assertTrue(self.request(base+'/composer')['plan'])
        self.request(base+'/composer',{'action':'goal','objective':'native goal'})
        self.assertEqual(self.request(base+'/composer')['goal']['objective'],'native goal')
        self.request(base+'/composer',{'action':'clear_goal'})
        self.assertIsNone(self.request(base+'/composer')['goal'])
        self.request(base+'/composer',{'action':'plan','enabled':False})
        self.assertFalse(self.request(base+'/composer')['plan'])
        self.request(base+'/composer',{'action':'settings','effort':'high'})
        self.daemon.active=True

    def test_native_service_tier_roundtrips_clear_and_reconnect(self):
        self.request('/sessions');base='/sessions/codex-ordinary'
        with self.assertRaises(urllib.error.HTTPError) as e:self.request(base+'/composer',{'action':'settings','service_tier':'native-priority'})
        self.assertEqual(e.exception.code,409)
        self.daemon.active=False
        self.assertEqual(self.request(base+'/composer')['service_tier'],'native-standard')
        selected=self.request(base+'/composer',{'action':'settings','service_tier':'native-priority'})
        self.assertEqual(selected['service_tier'],'native-priority')
        self.request(base+'/composer',{'action':'settings','effort':'medium'})
        self.request(base+'/composer',{'action':'plan','enabled':True})
        self.assertEqual(self.request(base+'/composer')['service_tier'],'native-priority')
        for payload in [{'service_tier':'priority'},{'model':'native-other'}]:
            with self.assertRaises(urllib.error.HTTPError):self.request(base+'/composer',{'action':'settings',**payload})
        self.assertEqual(self.daemon.settings['model'],'native-model')
        self.assertEqual(self.daemon.settings['serviceTier'],'native-priority')
        self.request(base+'/messages',{'text':'inherit service tier'})
        self.assertEqual(self.daemon.settings['serviceTier'],'native-priority')
        self.request(base+'/interrupt',{});self.wait(lambda:not self.daemon.active)
        self.proc.terminate();self.proc.wait(timeout=10);self.__class__.start()
        self.request('/sessions');self.request(base+'/connect',{})
        restored=self.request(base+'/composer')
        self.assertEqual((restored['model'],restored['effort'],restored['service_tier']),('native-model','medium','native-priority'))
        self.assertTrue(restored['plan'])
        cleared=self.request(base+'/composer',{'action':'settings','service_tier':None})
        self.assertIsNone(cleared['service_tier'])
        switched=self.request(base+'/composer',{'action':'settings','model':'native-other','service_tier':'native-other-tier'})
        self.assertEqual((switched['model'],switched['service_tier']),('native-other','native-other-tier'))
        self.request(base+'/composer',{'action':'settings','model':'native-model','effort':'high','service_tier':None})
        self.request(base+'/composer',{'action':'plan','enabled':False})
        self.request(base+'/messages',{'text':'inherit cleared service tier'})
        self.assertIsNone(self.daemon.settings['serviceTier'])
        # The shared engine remains authoritative: a native change is read on reconnect.
        self.daemon.active=False;self.daemon.settings['serviceTier']='native-standard'
        self.proc.terminate();self.proc.wait(timeout=10);self.__class__.start();self.request('/sessions');self.request(base+'/connect',{})
        self.assertEqual(self.request(base+'/composer')['service_tier'],'native-standard')
        self.request(base+'/messages',{'text':'restore original active turn'})
        self.wait(lambda:self.request(base)['session']['status']=='running')

    def test_persisted_threads_are_merged_with_shared_live_threads(self):
        catalog=self.base/'extra-catalog.json'
        catalog.write_text(json.dumps([{'id':'disk-only','cwd':str(self.workspace),'name':'独立进程历史','source':'exec'},{'id':'ordinary','cwd':str(self.workspace),'name':'旧标题','source':'cli','status':{'type':'notLoaded'}}]))
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        proc=subprocess.Popen([BINARY,'--bind',f'127.0.0.1:{port}','--workspace',str(self.workspace),'--data-dir',str(self.base/'union-data'),'--token','union-test-token'],cwd=ROOT,env={**os.environ,'CODEX_BIN':str(self.cli),'CODEX_HOME':str(self.home),'FAKE_CODEX_CATALOG':str(catalog)},stdout=self.log,stderr=self.log)
        try:
            for _ in range(100):
                try:urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1);break
                except OSError:time.sleep(.05)
            req=urllib.request.Request(f'http://127.0.0.1:{port}/api/sessions',headers={'Authorization':'Bearer union-test-token'})
            with urllib.request.urlopen(req,timeout=15) as response:rows=json.load(response)['sessions']
            self.assertEqual({s['thread_id'] for s in rows},{'ordinary','disk-only'})
            original=next(s for s in rows if s['thread_id']=='ordinary')
            self.assertEqual(original['title'],'普通会话');self.assertEqual(original['status'],'running')
            # Failure of the persisted index must not erase independent history.
            catalog.write_text('{broken fixture index')
            time.sleep(2.1)
            with urllib.request.urlopen(req,timeout=15) as response:snapshot=json.load(response)
            self.assertEqual({s['thread_id'] for s in snapshot['sessions']},{'ordinary','disk-only'})
            self.assertTrue(snapshot['discovery_error'])
        finally:
            proc.terminate();proc.wait(timeout=10)

    def test_original_session_steer_stop_chat_approval_and_engine_lifetime(self):
        interrupts_before=sum(method=='turn/interrupt' for method,_ in self.daemon.requests)
        sessions=self.request('/sessions')['sessions'];self.assertEqual(len(sessions),1)
        sid=sessions[0]['id'];self.assertEqual(sessions[0]['thread_id'],'ordinary');self.assertEqual(sessions[0]['status'],'running')
        # Snapshot reads bypass the catalog cache without changing activity time.
        original=sessions[0]['updated_at']
        self.daemon.active=False
        state=self.request(f'/sessions/{sid}')['session'];self.assertEqual(state['status'],'idle');self.assertEqual(state['updated_at'],original)
        self.daemon.active=True;self.daemon.pending=True
        self.assertEqual(self.request(f'/sessions/{sid}')['session']['status'],'waiting')
        self.daemon.pending=False
        self.assertEqual(self.request(f'/sessions/{sid}')['session']['status'],'running')
        self.request(f'/sessions/{sid}/connect',{})
        self.request(f'/sessions/{sid}/messages',{'text':'additional instruction'})
        self.assertTrue(self.daemon.active)
        self.request(f'/sessions/{sid}/interrupt',{})
        self.assertFalse(self.daemon.active)
        self.request(f'/sessions/{sid}/messages',{'text':'approval'})
        self.wait(lambda:any(e['request_id']==700 for e in self.request(f'/sessions/{sid}/events/poll')['events']))
        self.assertTrue(self.daemon.pending)
        events=self.request(f'/sessions/{sid}/events/poll')['events']
        self.assertFalse(any(e['params'].get('item',{}).get('id')=='wrong-thread' for e in events))
        self.request(f'/sessions/{sid}/respond',{'request_id':700,'accept':True})
        self.wait(lambda:not self.daemon.active)
        self.wait(lambda:any(e['method']=='serverRequest/resolved' for e in self.request(f'/sessions/{sid}/events/poll')['events']))
        with self.assertRaises(urllib.error.HTTPError):self.request(f'/sessions/{sid}/respond',{'request_id':700,'accept':True})
        self.request(f'/sessions/{sid}/messages',{'text':'continue in same conversation'})
        self.assertTrue(self.daemon.active)
        self.request(f'/sessions/{sid}/messages',{'text':'queued native instruction','mode':'queue'})
        self.assertEqual(len(self.request(f'/sessions/{sid}/queue')['items']),1)
        self.request(f'/sessions/{sid}/queue',{'action':'pause','paused':False})
        self.request(f'/sessions/{sid}/messages',{'text':'finish current','mode':'steer'})
        self.wait(lambda:not self.request(f'/sessions/{sid}/queue')['items'])
        self.assertTrue(self.daemon.active)
        self.request(f'/sessions/{sid}/messages',{'text':'steered queued native instruction','mode':'queue'})
        queued=self.request(f'/sessions/{sid}/queue')['items'][0]
        self.request(f'/sessions/{sid}/queue',{'action':'steer','id':queued['id']})
        self.assertEqual(self.request(f'/sessions/{sid}/queue')['items'],[])
        latest=self.request(f'/sessions/{sid}')['session'];self.assertEqual(latest['thread_id'],'ordinary');self.assertTrue(latest['external'])
        methods=[m for m,_ in self.daemon.requests];self.assertNotIn('thread/fork',methods);self.assertNotIn('thread/start',methods)
        self.assertEqual(len(self.request('/sessions')['sessions']),1)
        self.assertEqual(methods.count('turn/steer'),3)
        self.assertEqual(methods.count('turn/interrupt')-interrupts_before,1)
        # A thread-status notification can end activity without turn/completed.
        self.request(f'/sessions/{sid}/messages',{'text':'status only idle','mode':'steer'})
        self.wait(lambda:any(e['method']=='thread/status/changed' for e in self.request(f'/sessions/{sid}/events/poll')['events']))
        self.request(f'/sessions/{sid}/messages',{'text':'after idle notification','mode':'queue'})
        self.wait(lambda:not self.request(f'/sessions/{sid}/queue')['items'])
        self.assertTrue(self.daemon.active)

    def test_rich_composer_metadata_binds_native_client_ids_across_restart(self):
        self.request('/sessions');base='/sessions/codex-ordinary'
        self.assertTrue(self.daemon.active)
        literal={"markdown":r"\*\*same\*\*", "document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"**same**"}]}]}}
        formatted={"markdown":"**same**", "document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"same","marks":[{"type":"strong"}]}]}]}}
        for composer in [literal,formatted]:
            self.request(base+'/messages',{'text':'**same**','composer':composer,'mode':'steer'})
        self.wait(lambda:len([e for e in self.request(base+'/events/poll')['events'] if e['params'].get('composer')])>=2)
        events=[e for e in self.request(base+'/events/poll')['events'] if e['params'].get('composer')]
        self.assertEqual([e['params']['composer'] for e in events[-2:]],[literal,formatted])
        self.assertEqual([e['params']['display_text'] for e in events[-2:]],['**same**','**same**'])
        self.assertNotEqual(events[-2]['params']['item']['clientId'],events[-1]['params']['item']['clientId'])
        self.proc.terminate();self.proc.wait(timeout=10);self.__class__.start();self.request('/sessions')
        history=self.request(base+'/history?paged=true')['events']
        users=[e['params'] for e in history if e['method']=='user/message']
        self.assertEqual([p['composer'] for p in users],[literal,formatted])
        self.assertEqual([p['history_item_id'] for p in users],['rich-user-0','rich-user-1'])
        self.assertEqual([p['display_text'] for p in users],['**same**','**same**'])
        self.assertTrue(self.daemon.active)


if __name__=='__main__':unittest.main(verbosity=2)
