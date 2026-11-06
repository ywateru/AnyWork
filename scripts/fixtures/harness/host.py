#!/usr/bin/env python3
"""Launch the actual pinned upstream npm Harness in an isolated profile.

npm install --prefix <runtime> --no-audit --no-fund node@24.9.0 @deepseek-ai/dsh@0.2.2-rc.1 ws
"""
import argparse,json,os,pathlib,re,subprocess,sys
parser=argparse.ArgumentParser();parser.add_argument('--root',type=pathlib.Path,required=True);parser.add_argument('--runtime',type=pathlib.Path,required=True);parser.add_argument('--port',type=int,default=9387);parser.add_argument('--model-port',type=int,default=9386);args=parser.parse_args()
r=args.root.resolve();runtime=args.runtime.resolve();r.mkdir(parents=True,exist_ok=True);(r/'workspace').mkdir(exist_ok=True)
patch=[{'id':'agent-default-model','config':{'provider':'anywork-verifier','model':'verify-model'}},{'id':'llm-pi-ai','config':{'providers':{'anywork-verifier':{'api':'openai-completions','apiKeyEnv':'ANYWORK_VERIFY_MODEL_KEY','baseURL':f'http://127.0.0.1:{args.model_port}/v1','defaultInput':['text','image'],'retryPolicy':{'mode':'normal','maxRetries':0},'models':[{'id':'verify-model','name':'Local deterministic verifier','contextWindow':32768,'maxTokens':2048,'reasoningEfforts':False}]}}}},{'id':'session-title-llm','disabled':True}]
(r/'verify.patch.yml').write_text(json.dumps(patch))
env={k:v for k,v in os.environ.items() if not any(s in k.upper() for s in ['API_KEY','TOKEN','SECRET','PASSWORD','DSH_','OPENAI','DEEPSEEK','ANTHROPIC'])}
env.update(DSH_HOME=str(r/'home'),ANYWORK_VERIFY_MODEL_KEY='local-no-billing-placeholder',PATH=str(runtime/'node_modules/node/bin')+os.pathsep+os.environ['PATH'])
node=runtime/'node_modules/node/bin/node';cli=runtime/'node_modules/@deepseek-ai/dsh/lib/bin.js'
p=subprocess.Popen([str(node),str(cli),'--profile','web','--patch',str(r/'verify.patch.yml'),'--no-open','--host','127.0.0.1','--port',str(args.port)],cwd=r/'workspace',env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
(r/'host.pid').write_text(str(p.pid))
log=open(os.open(r/'host.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w')
try:
 for line in p.stdout:
  log.write(line);log.flush()
  m=re.search(r'dsh web:\s*(https?://\S+)',line)
  if m:
   with open(os.open(r/'host-url',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as f:f.write(m.group(1))
   print(f'HOST_READY http://127.0.0.1:{args.port} (launch credential in private host-url file)',flush=True)
 sys.exit(p.wait())
except KeyboardInterrupt:
 p.terminate();p.wait(timeout=15)
finally:log.close()
