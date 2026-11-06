#!/usr/bin/env python3
"""Verify catalog pagination, path scope, history, write guards and explicit forks."""
import json, os, pathlib, shlex, socket, subprocess, tempfile, time, unittest, urllib.error, urllib.request

ROOT=pathlib.Path(__file__).resolve().parents[1]
class Discovery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix="remote-agent-catalog-");cls.base=pathlib.Path(cls.temp.name).resolve()
        cls.workspace=cls.base/"workspace";cls.workspace.mkdir();(cls.workspace/"empty-project").mkdir();(cls.workspace/"nested"/"used").mkdir(parents=True)
        rows=[{"id":f"desktop-{i}","cwd":str(cls.workspace),"name":f"桌面会话 {i}","source":"vscode","createdAt":1,"updatedAt":i+1} for i in range(5)]
        rows += [{"id":"nested-1","cwd":str(cls.workspace/"nested"/"used"),"name":"嵌套会话一"}, {"id":"nested-2","cwd":str(cls.workspace/"nested"/"used"),"name":"嵌套会话二"}, {"id":"helper","cwd":str(cls.workspace),"name":"辅助任务","source":{"subAgent":{"other":"test"}}}, {"id":"internal","cwd":str(cls.workspace),"source":{"subAgent":{"other":"guardian"}}}, {"id":"outside","cwd":str(cls.base),"name":"outside"}, {"id":"archive","cwd":str(cls.workspace),"name":"归档会话","archived":True}]
        cls.native_image=cls.base/"native.png";cls.native_image.write_bytes(bytes.fromhex("89504e470d0a1a0a")+b"native-image-fixture")
        cls.native_document=cls.base/"native-report.pdf";cls.native_document.write_bytes(b"%PDF-1.7\nnative document fixture\n%%EOF\n")
        cls.calls=cls.base/'calls.jsonl'
        cls.catalog=cls.base/"catalog.json";cls.catalog.write_text(json.dumps(rows))
        cli=cls.base/"codex";cli.write_text('#!/bin/sh\nexec python3 '+shlex.quote(str(ROOT/'scripts/fake-agent.py'))+' "$@"\n');cli.chmod(0o700)
        with socket.socket() as s:s.bind(('127.0.0.1',0));cls.port=s.getsockname()[1]
        cls.log=open(cls.base/'server.log','w+')
        cls.proc=subprocess.Popen([os.environ.get('ANYWORK_BINARY',os.environ.get('REMOTE_AGENT_BINARY',str(ROOT/'target/debug/anywork'))),'--bind',f'127.0.0.1:{cls.port}','--workspace',str(cls.workspace),'--data-dir',str(cls.base/'data'),'--token','test-catalog-access-token'],cwd=ROOT,env={**os.environ,'CODEX_BIN':str(cli),'CODEX_HOME':str(cls.base/'codex-home'),'FAKE_CODEX_CATALOG':str(cls.catalog),'FAKE_AGENT_CALLS':str(cls.calls),'FAKE_NATIVE_IMAGE':str(cls.native_image),'FAKE_NATIVE_DOCUMENT':str(cls.native_document)},stdout=cls.log,stderr=cls.log)
        for _ in range(100):
            try:urllib.request.urlopen(f'http://127.0.0.1:{cls.port}/api/health',timeout=1);break
            except OSError:time.sleep(.05)
    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate();cls.proc.wait(timeout=10);cls.log.close();cls.temp.cleanup()
    def request(self,path,data=None,method=None):
        req=urllib.request.Request(f'http://127.0.0.1:{self.port}/api'+path,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer test-catalog-access-token','Content-Type':'application/json'},method=method)
        with urllib.request.urlopen(req,timeout=15) as r:return json.load(r)
    def test_native_history_preserves_images_and_allows_only_referenced_external_paths(self):
        import urllib.parse
        self.request('/sessions')
        rows=self.request('/sessions/codex-desktop-0/history')['events']
        self.assertTrue(any(str(self.native_image) in e['params'].get('attachments',[]) for e in rows))
        def read(path):
            url=f'http://127.0.0.1:{self.port}/api/sessions/codex-desktop-0/image?'+urllib.parse.urlencode({'path':str(path)})
            return urllib.request.urlopen(urllib.request.Request(url,headers={'Authorization':'Bearer test-catalog-access-token'}),timeout=10)
        with read(self.native_image) as response:self.assertEqual(response.read(),self.native_image.read_bytes())
        unreferenced=self.base/'unreferenced.png';unreferenced.write_bytes(self.native_image.read_bytes())
        with self.assertRaises(urllib.error.HTTPError):read(unreferenced)

    def test_native_document_links_authorize_only_exact_historical_files(self):
        import urllib.parse
        self.request('/sessions')
        def read(path):
            url=f'http://127.0.0.1:{self.port}/api/sessions/codex-desktop-0/document?'+urllib.parse.urlencode({'path':str(path)})
            return urllib.request.urlopen(urllib.request.Request(url,headers={'Authorization':'Bearer test-catalog-access-token'}),timeout=10)
        with read(self.native_document) as response:
            self.assertEqual(response.read(),self.native_document.read_bytes())
            self.assertEqual(response.headers['Content-Type'],'application/pdf')
        other=self.base/'unreferenced-native.pdf';other.write_bytes(self.native_document.read_bytes())
        with self.assertRaises(urllib.error.HTTPError):read(other)

    def test_catalog_pagination_scope_and_session_derived_directories(self):
        workspaces=self.request('/workspaces')['workspaces']
        sessions=self.request('/sessions')['sessions'];ids={s['id'] for s in sessions}
        self.assertTrue({f'codex-desktop-{i}' for i in range(5)}<=ids)
        self.assertNotIn('codex-outside',ids)
        self.assertNotIn('codex-internal',ids)
        self.assertTrue(next(s for s in sessions if s['id']=='codex-helper')['auxiliary'])
        self.assertTrue(next(s for s in sessions if s['id']=='codex-archive')['archived'])
        self.assertEqual({w['path'] for w in workspaces},{str(self.workspace),str(self.workspace/'nested'/'used')})
        nested=next(w for w in workspaces if w['name']=='used')
        self.assertEqual(nested['sessions'],2)
        self.assertEqual(sum(s['cwd']==nested['path'] for s in sessions),2)
    def test_history_is_paginated_and_control_fails_without_original_engine(self):
        self.request('/sessions')
        events=self.request('/sessions/codex-desktop-0/history')['events']
        self.assertEqual([e['seq'] for e in events],[1,2,3,4])
        self.assertEqual(events[-1]['params']['item']['text'],'历史回答 1\n[原生报告]('+str(self.native_document)+')')
        for suffix,data,method in [('',{'title':'changed'},'PATCH'),('',None,'DELETE'),('/messages',{'text':'requires original engine'},'POST'),('/interrupt',{},'POST')]:
            with self.assertRaises(urllib.error.HTTPError):self.request('/sessions/codex-desktop-0'+suffix,data,method)
        self.assertTrue(self.request('/sessions/codex-desktop-0')['session']['external'])
    def test_metadata_reads_do_not_require_control_or_resume_a_locked_thread(self):
        import fcntl
        self.request('/sessions')
        locks=self.base/'codex-home'/'thread-writer-locks';locks.mkdir(parents=True,exist_ok=True)
        with open(locks/'desktop-0.lock','w') as writer:
            fcntl.flock(writer,fcntl.LOCK_EX|fcntl.LOCK_NB)
            before=len(self.calls.read_text().splitlines())
            self.assertTrue(self.request('/sessions/codex-desktop-0/models')['data'])
            composer=self.request('/sessions/codex-desktop-0/composer')
            self.assertFalse(composer['settings_available'])
            self.assertTrue(self.request('/sessions/codex-desktop-0/history')['events'])
            connection=self.request('/sessions/codex-desktop-0/connect',{},'POST')
            self.assertFalse(connection['connected']);self.assertEqual(connection['mode'],'history')
            calls=[json.loads(line) for line in self.calls.read_text().splitlines()[before:]]
            self.assertFalse(any(c.get('method') in ['thread/resume','thread/start','turn/start','thread/fork'] for c in calls))
        archived=self.request('/sessions/codex-archive/composer')
        self.assertFalse(archived['settings_available'])

    def test_all_project_scope_loads_outside_and_removed_worktree_history(self):
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        catalog=self.base/'all-catalog.json'
        rows=json.loads(self.catalog.read_text())
        external=self.base/'external-project';external.mkdir()
        subprocess.run(['git','init',str(external)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (external/'change.txt').write_text('original\n')
        subprocess.run(['git','-C',str(external),'add','.'],check=True)
        subprocess.run(['git','-C',str(external),'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture'],check=True,stdout=subprocess.DEVNULL)
        (external/'change.txt').write_text('external review marker\n')
        rows.append({'id':'external-review','cwd':str(external),'name':'其他项目差异','source':'exec'})
        rows.append({'id':'removed-worktree','cwd':str(self.base/'removed-worktree'),'name':'已删除工作树的历史','source':'cli'})
        catalog.write_text(json.dumps(rows))
        def request(path):
            req=urllib.request.Request(f'http://127.0.0.1:{port}/api'+path,headers={'Authorization':'Bearer test-all-access-token'})
            with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
        proc=subprocess.Popen([os.environ.get('ANYWORK_BINARY',str(ROOT/'target/debug/anywork')),'--bind',f'127.0.0.1:{port}','--workspace',str(self.workspace),'--codex-scope','all','--data-dir',str(self.base/'all-data'),'--token','test-all-access-token'],cwd=ROOT,env={**os.environ,'CODEX_BIN':str(self.base/'codex'),'CODEX_HOME':str(self.base/'all-codex-home'),'FAKE_CODEX_CATALOG':str(catalog)},stdout=self.log,stderr=self.log)
        try:
            for _ in range(100):
                try:request('/info');break
                except OSError:time.sleep(.05)
            sessions=request('/sessions')['sessions'];ids={s['id'] for s in sessions}
            self.assertIn('codex-outside',ids);self.assertIn('codex-removed-worktree',ids)
            self.assertIn('codex-archive',ids);self.assertNotIn('codex-internal',ids)
            self.assertEqual(request('/sessions/codex-removed-worktree')['session']['thread_id'],'removed-worktree')
            self.assertTrue(request('/sessions/codex-removed-worktree/history')['events'])
            self.assertEqual(request('/info')['codex_scope'],'all')
            review=request('/sessions/codex-external-review/review?source=uncommitted')
            self.assertEqual(review['type'],'success');self.assertIn('+external review marker',review['diff'])
            self.assertEqual(review['root'],str(external))
            self.assertTrue(any(w['path']==str(self.base) for w in request('/workspaces')['workspaces']))
            # Every imported project retains its own file boundary.
            with self.assertRaises(urllib.error.HTTPError):request('/sessions/codex-desktop-0/files?path=..')
        finally:
            proc.terminate();proc.wait(timeout=10)

    def test_recent_history_pages_items_and_turn_fallback(self):
        self.request('/sessions')
        page=self.request('/sessions/codex-desktop-0/history?paged=true&limit=1')
        self.assertEqual(page['events'][0]['params']['text'],'历史问题 1')
        self.assertEqual(page['next_cursor'],'turns:1')
        self.assertEqual(page['events'][0]['params']['history_turn_status'],'completed')
        self.assertEqual(page['events'][0]['params']['history_work_started_at'],110000)
        self.assertEqual(page['events'][0]['params']['history_work_completed_at'],115000)
        older=self.request('/sessions/codex-desktop-0/history?paged=true&limit=1&cursor=turns:1')
        self.assertEqual(older['events'][0]['params']['text'],'历史问题 0')
        self.assertIsNone(older['next_cursor'])
        self.assertNotEqual(older['events'][0]['params']['history_id'],page['events'][0]['params']['history_id'])
        page=self.request('/sessions/codex-desktop-2/history?paged=true&limit=1')
        self.assertEqual(len(page['events']),8)
        self.assertEqual(page['events'][-1]['params']['item']['text'],'条目回答 24')
        self.assertEqual(page['events'][-1]['params']['history_item_started_at_ms'],124000)
        self.assertEqual(page['events'][-1]['params']['history_item_completed_at_ms'],124500)
        self.assertTrue(page['next_cursor'].startswith('items:'))
        events=page['events'];cursor=page['next_cursor']
        while cursor:
            page=self.request('/sessions/codex-desktop-2/history?paged=true&limit=1&cursor='+cursor)
            events=page['events']+events;cursor=page['next_cursor']
        self.assertEqual([e['params']['item']['text'] for e in events],[f'条目回答 {i}' for i in range(25)])
        self.assertEqual(len({e['params']['history_id'] for e in events}),25)

    def test_history_message_times_require_native_item_timestamps(self):
        self.request('/sessions')
        page=self.request('/sessions/codex-desktop-3/history?paged=true&limit=1')
        self.assertIsNone(page['next_cursor'])
        self.assertEqual([e['params']['text'] for e in page['events']],[f'时间问题 {i}' for i in range(6)])
        known=page['events'][0]
        self.assertEqual(known['method'],'user/message')
        self.assertEqual(known['params']['history_item_started_at_ms'],1700000000123)
        self.assertEqual(known['params']['history_item_completed_at_ms'],1700000000456)
        self.assertNotEqual(known['created_at'],known['params']['history_item_started_at_ms'])
        for event in page['events'][1:]:
            self.assertNotIn('history_item_started_at_ms',event['params'])
            self.assertNotIn('history_item_completed_at_ms',event['params'])

        for suffix in ['/history','/history?paged=true&limit=1']:
            events=self.request('/sessions/codex-desktop-0'+suffix)['events']
            for event in events:
                self.assertIn('history_work_started_at',event['params'])
                self.assertNotIn('history_item_started_at_ms',event['params'])
        for suffix in ['/history','/history?paged=true&limit=1']:
            events=self.request('/sessions/codex-desktop-4'+suffix)['events']
            self.assertEqual(events[0]['params']['text'],'旧版无条目时间')
            self.assertEqual(events[0]['params']['history_work_started_at'],1700000000000)
            self.assertNotIn('history_item_started_at_ms',events[0]['params'])

    def test_explicit_fork_preserves_history_and_can_receive_new_messages(self):
        self.request('/sessions')
        fork=self.request('/sessions/codex-desktop-1/fork',{},'POST')['session']
        self.assertFalse(fork['external']);self.assertNotEqual(fork['thread_id'],'desktop-1')
        imported=self.request('/sessions/'+fork['id']+'/export')['events']
        self.assertEqual(len(imported),4)
        for event in imported:
            self.assertIn('history_turn_id',event['params'])
            self.assertIn('history_work_started_at',event['params'])
            self.assertNotIn('history_item_started_at_ms',event['params'])
        self.request('/sessions/'+fork['id']+'/messages',{'text':'hello'},'POST')
        for _ in range(50):
            if self.request('/sessions/'+fork['id'])['session']['status']=='idle':break
            time.sleep(.05)
        self.assertTrue(any(e['method']=='turn/completed' for e in self.request('/sessions/'+fork['id']+'/export')['events']))
        self.assertTrue(self.request('/sessions/codex-desktop-1')['session']['external'])

if __name__=='__main__':unittest.main(verbosity=2)
