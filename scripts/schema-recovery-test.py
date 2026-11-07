#!/usr/bin/env python3
"""Production Store opening/restart via isolated HTTP and deterministic fake Agent."""
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TOKEN = 'schema-restart-fixture-token'
LOCAL_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class SchemaRecovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='anywork-schema-http-')
        self.base = Path(self.temp.name).resolve()
        for name in ('workspace', 'plugins', 'home'): (self.base/name).mkdir()
        manifest = {'id':'fixture','name':'Schema fixture','protocol_version':1,'command':sys.executable,
                    'args':[str(ROOT/'scripts/fake-agent.py')],'capabilities':['chat','resume']}
        (self.base/'plugins/fixture.json').write_text(json.dumps(manifest))
        self.process = None
        self.log = None
        self.start()

    def tearDown(self):
        self.stop()
        self.temp.cleanup()

    def spawn(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
        env = {key:value for key,value in os.environ.items() if not key.startswith(('ANYWORK_', 'REMOTE_AGENT_', 'DSH_', 'CODEX_', 'FAKE_AGENT_'))}
        env.update(HOME=str(self.base/'home'),USERPROFILE=str(self.base/'home'),
                   FAKE_AGENT_CALLS=str(self.base/'calls.jsonl'),FAKE_AGENT_STATE_DIR=str(self.base/'fixture-state'))
        log = open(self.base/'server.log','a+')
        process = subprocess.Popen([os.environ.get('ANYWORK_BINARY', str(ROOT/'target/debug/anywork')),
            '--bind',f'127.0.0.1:{port}','--workspace',str(self.base/'workspace'),
            '--data-dir',str(self.base/'data'),'--plugins-dir',str(self.base/'plugins'),
            '--web-dir',str(self.base/'empty-web'),'--codex-discovery','false','--token',TOKEN],
            env=env,stdout=log,stderr=log,**({'start_new_session':True} if os.name=='posix' else {}))
        return process, port, log

    def start(self):
        self.process,self.port,self.log = self.spawn()
        for _ in range(150):
            try: self.request('/health'); return
            except OSError:
                if self.process.poll() is not None: break
                time.sleep(.03)
        raise RuntimeError('Isolated schema service did not start; no runtime logs printed')

    def stop(self, crash=False):
        if self.process is not None:
            if self.process.poll() is None:
                if crash and os.name=='posix': os.killpg(self.process.pid,signal.SIGKILL)
                elif crash: self.process.kill()
                else: self.process.terminate()
                self.process.wait(timeout=10)
            self.process=None;self.log.close();self.log=None

    def request(self,path,body=None,method=None):
        headers={'Authorization':'Bearer '+TOKEN}
        if body is not None:headers['Content-Type']='application/json'
        request=urllib.request.Request(f'http://127.0.0.1:{self.port}/api'+path,
            data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
        with LOCAL_HTTP.open(request,timeout=5) as response:return json.load(response)

    def calls(self):
        path=self.base/'calls.jsonl'
        return path.read_bytes() if path.exists() else b''

    def wait_status(self,sid,status):
        for _ in range(150):
            if self.request('/sessions/'+sid)['session']['status']==status:return
            time.sleep(.02)
        self.fail('Fixture did not reach expected status '+status)

    def test_owner_refusal_crash_restart_preserves_state_and_never_replays(self):
        sid=self.request('/sessions',{'agent':'fixture','cwd':str(self.base/'workspace')})['session']['id']
        prefix='/sessions/'+sid
        self.request(prefix+'/messages',{'text':'schema original fixture message'})
        self.wait_status(sid,'idle')
        feedback=self.request(prefix+'/feedback/review-message',{'rating':'good'},'PUT')['feedback']
        self.request(prefix+'/messages',{'text':'slow schema fixture'})
        self.wait_status(sid,'running')
        queued=self.request(prefix+'/messages',{'text':'never replay queued fixture','queue_if_busy':True,'mode':'queue'})
        self.assertTrue(queued['queued'])
        previous=self.request(prefix+'/export')['events']
        calls=self.calls()
        loser,_,log=self.spawn()
        try:
            self.assertNotEqual(loser.wait(timeout=10),0)
            self.assertEqual(self.request(prefix)['session']['status'],'running')
            self.assertEqual(self.request(prefix+'/export')['events'],previous)
            self.assertEqual(self.calls(),calls)
        finally:
            if loser.poll() is None:loser.kill();loser.wait(timeout=5)
            log.close()
        self.stop(crash=True)
        with sqlite3.connect(self.base/'data/remote-agent.sqlite') as db:
            # Capture the persisted send/edit-in-flight boundary without asking
            # any Agent to execute it. Recovery must make it uncertain, paused.
            db.execute("UPDATE message_queue SET data=json_set(data,'$.status','sending') WHERE session_id=?",(sid,))
            db.execute('INSERT INTO message_edits VALUES(?,?,?)',('schema-operation',sid,json.dumps({'id':'schema-operation','phase':'starting'})))
        self.start()
        self.assertEqual(self.request(prefix)['session']['status'],'disconnected')
        restored=self.request(prefix+'/export')
        self.assertEqual(restored['events'][:len(previous)],previous)
        self.assertEqual(restored['events'][-1]['method'],'connection/interrupted')
        self.assertEqual(restored['feedback'],[feedback])
        queue=self.request(prefix+'/queue')
        self.assertTrue(queue['paused']);self.assertEqual(queue['items'][0]['status'],'uncertain')
        self.assertEqual(queue['items'][0]['text'],'never replay queued fixture')
        with sqlite3.connect(self.base/'data/remote-agent.sqlite') as db:
            edit=json.loads(db.execute('SELECT data FROM message_edits WHERE operation_id=?',('schema-operation',)).fetchone()[0])
        self.assertEqual(edit['phase'],'uncertain')
        time.sleep(1.2)  # Several queue-worker cycles, not just immediate boot.
        self.assertEqual(self.calls(),calls)
        self.stop();self.start()
        self.assertEqual(self.request(prefix+'/export')['events'],restored['events'])
        self.assertEqual(self.calls(),calls)

    def test_future_version_exit_keeps_logical_database_and_journal_unchanged(self):
        self.stop()
        path=self.base/'data/remote-agent.sqlite'
        with sqlite3.connect(path) as db:
            db.execute('PRAGMA journal_mode=DELETE')
            db.execute('PRAGMA user_version=99')
            before='\n'.join(db.iterdump())
        process,_,log=self.spawn()
        try:self.assertNotEqual(process.wait(timeout=10),0)
        finally:
            if process.poll() is None:process.kill();process.wait(timeout=5)
            log.close()
        with sqlite3.connect(path) as db:
            self.assertEqual('\n'.join(db.iterdump()),before)
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],99)
            self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0],'delete')
        self.assertEqual(self.calls(),b'')
        # SQLite may perform its own open/recovery housekeeping; byte-for-byte
        # database/sidecar equality is deliberately not the contract.

    def test_executable_schema_token_lookalikes_refuse_without_startup_mutation(self):
        self.stop()
        path=self.base/'data/remote-agent.sqlite'
        ddl=(ROOT/'crates/server/src/store/fixtures/schema-v1-current.sql').read_text()
        variants=[('data TEXT NOT NULL','data TEXTNOTNULL'),
                  ('seq INTEGER PRIMARY KEY AUTOINCREMENT','seq INTEGERPRIMARYKEYAUTOINCREMENT'),
                  ('data TEXT NOT NULL','data TEXT\u00a0NOT\u00a0NULL'),
                  ('seq INTEGER PRIMARY KEY AUTOINCREMENT','seq INTEGER\u2003PRIMARY\u2003KEY\u2003AUTOINCREMENT'),
                  ('data TEXT NOT NULL','data "TEXT NOT NULL"'),
                  ('seq INTEGER PRIMARY KEY AUTOINCREMENT','seq "INTEGER PRIMARY KEY AUTOINCREMENT"')]
        for original,replacement in variants:
            for version in (0,1):
                with self.subTest(replacement=replacement,version=version):
                    # Replace only a stopped disposable fixture, never a live
                    # database. Each declaration must be executable SQLite DDL.
                    path.unlink()
                    session={'id':'schema-negative','thread_id':None,'title':'keep','cwd':str(self.base/'workspace'),
                             'agent':'fixture','model':None,'policy':'manual','status':'running',
                             'archived':False,'created_at':1,'updated_at':1,'external':False}
                    event={'seq':0,'session_id':'schema-negative','method':'user/message',
                           'params':{'text':'keep 雪 \'source\'','sourceEventKey':'ExactMixedCase'},'created_at':1}
                    with sqlite3.connect(path) as db:
                        db.executescript(ddl.replace(original,replacement))
                        db.execute('PRAGMA user_version='+str(version))
                        db.execute('INSERT INTO sessions VALUES(?,?)',('schema-negative',json.dumps(session)))
                        db.execute('INSERT INTO events(seq,session_id,data) VALUES(41,?,?)',('schema-negative',json.dumps(event)))
                        db.execute('INSERT INTO message_queue(seq,session_id,data) VALUES(51,?,?)',('schema-negative',json.dumps({'status':'sending','text':'never replay'})))
                        db.execute('INSERT INTO queue_settings VALUES(?,0)',('schema-negative',))
                        db.execute('INSERT INTO message_edits VALUES(?,?,?)',('pending-edit','schema-negative',json.dumps({'id':'pending-edit','phase':'starting'})))
                    with sqlite3.connect(path) as db:
                        before='\n'.join(db.iterdump())
                        self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0],'delete')
                    process,_,log=self.spawn()
                    try:self.assertNotEqual(process.wait(timeout=10),0)
                    finally:
                        if process.poll() is None:process.kill();process.wait(timeout=5)
                        log.close()
                    with sqlite3.connect(path) as db:
                        self.assertEqual('\n'.join(db.iterdump()),before)
                        self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],version)
                        self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0],'delete')
                        self.assertEqual(db.execute('SELECT seq FROM events').fetchall(),[(41,)])
                        self.assertEqual(json.loads(db.execute('SELECT data FROM sessions').fetchone()[0])['status'],'running')
                        self.assertEqual(json.loads(db.execute('SELECT data FROM message_queue').fetchone()[0])['status'],'sending')
                        self.assertEqual(json.loads(db.execute('SELECT data FROM message_edits').fetchone()[0])['phase'],'starting')
                    self.assertEqual(self.calls(),b'')


if __name__=='__main__':unittest.main(verbosity=2)
