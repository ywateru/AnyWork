#!/usr/bin/env python3
"""Deterministic local OpenAI provider for isolated REAL Harness tests; no billing."""
import json,time,threading,argparse,os
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--port',type=int,default=9386);args=parser.parse_args();ROOT=args.root.resolve();ROOT.mkdir(parents=True,exist_ok=True)
class Model(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  data={'object':'list','data':[{'id':'verify-model','object':'model','owned_by':'local'}]}
  b=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
  record=ROOT/'model-requests.jsonl'
  with open(os.open(record,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600),'a') as f:f.write(json.dumps({'path':self.path,'body':body})+'\n')
  if self.path!='/v1/chat/completions':self.send_error(404);return
  messages=body.get('messages',[])
  text=next((str(m.get('content','')) for m in reversed(messages) if m.get('role')=='user' and 'verify-' in str(m.get('content',''))),'verify-response')
  last=messages[-1] if messages else {}
  prompt_index=max((i for i,m in enumerate(messages) if m.get('role')=='user' and any(k in str(m.get('content','')) for k in ['verify-history','verify-remote','verify-local','verify-tools','verify-approval','verify-reconnect','verify-slow','verify-tool-image','verify-image'])),default=-1)
  tool_returned=any(m.get('role')=='tool' for m in messages[prompt_index+1:])
  if 'verify-slow' in text and not tool_returned:time.sleep(15)
  marker=next((m for m in ['verify-history','verify-remote','verify-local','verify-tools','verify-approval','verify-reconnect','verify-slow'] if m in text),'verify-response')
  tools=body.get('tools',[])
  call=None
  if ('verify-tools' in text or 'verify-approval' in text) and not tool_returned:
   tool=next((x for x in tools if x.get('function',{}).get('name')=='bash'),None)
   if tool:call={'index':0,'id':'call_verify_tool','type':'function','function':{'name':'bash','arguments':json.dumps({'description':'Print isolated verification marker','command':'printf ANYWORK_HARNESS_TOOL_OK',**({'sandbox_permissions':'danger-full-access','justification':'Verify one-time approval for an isolated marker command'} if 'verify-approval' in text else {})})}}
  if 'verify-tool-image' in text and not tool_returned:
   call={'index':0,'id':'call_verify_image','type':'function','function':{'name':'read_image','arguments':json.dumps({'file_path':str(ROOT/'workspace/image.png')})}}
  if not body.get('stream'):
   b=json.dumps({'id':'local-verify','object':'chat.completion','choices':[{'index':0,'message':{'role':'assistant','content':marker+' complete'},'finish_reason':'stop'}],'usage':{'prompt_tokens':5,'completion_tokens':4,'total_tokens':9}}).encode()
   self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-cache');self.end_headers()
  def emit(delta,finish=None):
   d={'id':'local-verify','object':'chat.completion.chunk','created':int(time.time()),'model':'verify-model','choices':[{'index':0,'delta':delta,'finish_reason':finish}]}
   self.wfile.write(('data: '+json.dumps(d)+'\n\n').encode());self.wfile.flush()
  try:
   emit({'role':'assistant'})
   if call:emit({'tool_calls':[call]});emit({},'tool_calls')
   else:
    for s in [marker,' deterministic',' complete']:emit({'content':s});time.sleep(.08)
    emit({},'stop')
   self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
  except (BrokenPipeError,ConnectionResetError):pass
ThreadingHTTPServer(('127.0.0.1',args.port),Model).serve_forever()
