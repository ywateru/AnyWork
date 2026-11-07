#!/usr/bin/env python3
"""Passive native-history HTTP acceptance; all databases, profiles and servers isolated."""
import json, os, pathlib, socket, sqlite3, subprocess, tempfile, time, urllib.request, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
TOKEN = 'isolated-history-token'
class History(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='anywork-history-http-');self.base=pathlib.Path(self.temp.name).resolve()
  self.workspace=self.base/'workspace';self.workspace.mkdir();self.wb=self.base/'workbuddy';self.wb.mkdir();self.dsh=self.base/'dsh';self.dsh.mkdir();(self.base/'plugins').mkdir()
  self.cwd=self.base/'removed-project'
  db=sqlite3.connect(self.wb/'workbuddy.db');db.execute('CREATE TABLE sessions(id TEXT,cwd TEXT,user_id TEXT,title TEXT,custom_title TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,last_activity_at INTEGER,model TEXT,transport TEXT,deleted_at INTEGER,session_settings TEXT)')
  for id,transport,settings in [('native-wb','local','{}'),('cloud','remote','{}'),('hidden','local','{"conversationTags":{"wbQuickAsk":"1"}}')]:
   db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(id,str(self.cwd),'prior-account',id,None,'completed',1000,3000,3000,None,transport,None,settings))
  db.commit();db.close();self.db_before=(self.wb/'workbuddy.db').read_bytes()
  project=self.wb/'projects'/str(self.cwd).replace('/','-').strip('-');project.mkdir(parents=True);self.log=project/'native-wb.jsonl'
  self.rows=[{'id':'request-wb','type':'message','role':'user','content':'WorkBuddy persisted user'},{'id':'tool','type':'function_call','callId':'native-tool','name':'Read','arguments':'{"path":"README.md"}'},{'id':'result','type':'function_call_result','callId':'native-tool','output':{'result':'persisted tool details'}},{'id':'answer','type':'message','role':'assistant','content':'WorkBuddy persisted answer'}];self.write_wb()
  d=self.dsh/'sessions'/'project'/'native-dsh';d.mkdir(parents=True)
  rows=[{'type':'session','version':4,'id':'native-dsh','createdAt':1000,'cwd':str(self.cwd),'isSeeded':False,'delegationDepth':0},{'seq':0,'type':'turn/start','time':2000,'data':{'turn':1}},{'seq':1,'type':'user/message','time':2100,'data':{'id':'native-user','source':{'kind':'user'},'content':[{'type':'text','text':'Harness persisted user'}]}},{'seq':2,'type':'assistant/message','time':2400,'data':{'turn':1,'step':1,'message':{'content':[{'type':'text','text':'Harness persisted answer'}]}}},{'seq':3,'type':'turn/end','time':2500,'data':{'turn':1,'reason':{'kind':'completed'}}}]
  (d/'session.v4.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows));self.start(['--agent-scope','all'])
 def write_wb(self):self.log.write_text(''.join(json.dumps(r)+'\n' for r in self.rows))
 def start(self,scope):
  with socket.socket() as s:s.bind(('127.0.0.1',0));self.port=s.getsockname()[1]
  self.output=open(self.base/'server.log','a+')
  env={k:v for k,v in os.environ.items() if not k.startswith(('ANYWORK_HARNESS_','ANYWORK_WORKBUDDY_','DSH_HOME'))};env.update(HOME=str(self.base/'home'),USERPROFILE=str(self.base/'home'),ANYWORK_WORKBUDDY_HOME=str(self.wb))
  self.process=subprocess.Popen([os.environ.get('ANYWORK_BINARY',str(ROOT/'target/debug/anywork')),'--codex-discovery','false','--workspace',str(self.workspace),'--data-dir',str(self.base/'data'),'--plugins-dir',str(self.base/'plugins'),'--bind',f'127.0.0.1:{self.port}','--token',TOKEN,'--harness-history-root',str(self.dsh),*scope],env=env,stdout=self.output,stderr=self.output)
  for _ in range(150):
   try:self.req('/health');return
   except OSError:time.sleep(.03)
  self.output.seek(0);raise RuntimeError(self.output.read())
 def stop(self):self.process.terminate();self.process.wait(timeout=10);self.output.close()
 def tearDown(self):self.stop();self.temp.cleanup()
 def req(self,path,data=None):
  req=urllib.request.Request(f'http://127.0.0.1:{self.port}/api'+path,headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},data=None if data is None else json.dumps(data).encode())
  with urllib.request.urlopen(req,timeout=3) as response:return json.load(response)
 def test_offline_bodies_controls_idempotence_and_scope(self):
  started=time.monotonic();sessions=self.req('/sessions')['sessions'];self.assertLess(time.monotonic()-started,2)
  self.assertEqual({s['agent'] for s in sessions},{'deepseek-harness','workbuddy'});self.assertEqual(len(sessions),2)
  for s in sessions:
   sid=s['id'];page=self.req(f'/sessions/{sid}/history?paged=true&limit=20');body=json.dumps(page)
   self.assertIn('persisted user',body);self.assertIn('persisted answer',body)
   before=self.req(f'/sessions/{sid}/export')['events'];self.req(f'/sessions/{sid}/history?paged=true&limit=20');self.assertEqual(before,self.req(f'/sessions/{sid}/export')['events'])
   self.assertFalse(self.req(f'/sessions/{sid}/composer')['settings_available']);self.assertEqual(self.req(f'/sessions/{sid}/models')['data'],[])
   self.assertNotIn(s['status'],['running','waiting'])
   if s['agent']=='workbuddy':
    tool=next(e for e in before if e['params'].get('item',{}).get('nativeCallId')=='native-tool')
    detail=self.req(f'/sessions/{sid}/history/item?seq={tool["seq"]}');self.assertIn('persisted tool details',json.dumps(detail))
    self.log.write_text(self.log.read_text()+'{"id":');partial=self.req(f'/sessions/{sid}/history?paged=true&limit=20');self.assertTrue(partial['history_notice']);self.assertIn('persisted answer',json.dumps(partial))
    self.log.write_text('{broken}\n');retained=self.req(f'/sessions/{sid}/history?paged=true&limit=20');self.assertTrue(retained['history_notice']);self.assertIn('persisted answer',json.dumps(retained));self.write_wb()
  self.assertEqual((self.wb/'workbuddy.db').read_bytes(),self.db_before)
  self.stop();self.start(['--codex-scope','all']);self.assertEqual(self.req('/sessions')['sessions'],[])
  self.stop();self.start(['--agent-scope','all']);self.assertEqual(len(self.req('/sessions')['sessions']),2)
if __name__=='__main__':unittest.main()
