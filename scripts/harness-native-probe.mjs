#!/usr/bin/env node
// Native upstream Typert probe; Node >=24.9, no npm runtime dependencies.
// Used only with an explicitly supplied isolated Harness host and local model.
import {readFile} from 'node:fs/promises';
const opts=Object.fromEntries(process.argv.slice(2).reduce((pairs,v,i,all)=>i%2?pairs:[...pairs,[v.slice(2),all[i+1]]],[]));
const launch=new URL((await readFile(opts['host-url-file'],'utf8')).trim());
if(!['127.0.0.1','localhost','[::1]'].includes(launch.hostname))throw new Error('Probe requires an isolated loopback host');
const connect=new URL('/connect',launch);connect.searchParams.set('token',launch.searchParams.get('token'));connect.searchParams.set('interactions','answer');
const auth=await fetch(connect,{redirect:'manual'});if(auth.status!==302)throw new Error('Native Harness authentication failed');
const cookie=auth.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
// Built-in WebSocket cannot supply Cookie headers. Harness's documented /connect
// redirect uses Node ws for authenticated native peers; resolve it from the caller's
// isolated Harness installation, never the product node_modules.
const {createRequire}=await import('node:module');
const require=createRequire(opts['runtime-package']);const WebSocket=require('ws');
const target=new URL('/api/remote.mux',launch);target.protocol='ws:';
const socket=new WebSocket(target,{headers:{Cookie:cookie}});
const frames=[];socket.on('message',buffer=>frames.push(JSON.parse(buffer.toString())));
await new Promise((yes,no)=>{socket.once('open',yes);socket.once('error',no)});
const timeout=AbortSignal.timeout(30000);
async function wait(test){while(!test()){timeout.throwIfAborted();await new Promise(r=>setTimeout(r,25))}}
async function rpc(method,args){const response=await fetch(new URL('/api/'+method,launch),{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}}),signal:timeout});if(!response.ok)throw new Error('Native Harness HTTP '+response.status);const result=await response.json();if(!result.result?.ok)throw new Error(JSON.stringify(result.result?.error));return result.result.value}
try{
 let sessionId=opts.session;
 if(!sessionId){const workspace=await rpc('workspace/create',{request:{path:opts.workspace}});sessionId=(await rpc('session/create',{request:{workspaceId:workspace.workspace.workspaceId}})).sessionId}
 socket.send(JSON.stringify({type:'open',streamId:'session',endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId},maxMessages:100,assistantStream:true}}}}));
 await wait(()=>frames.some(f=>f.value?.type==='snapshot'));
 if(opts.prompt){await rpc('session/prompt',{request:{requestId:crypto.randomUUID(),sessionId,mode:'queue',content:[{type:'text',text:opts.prompt}]}});await wait(()=>frames.some(f=>f.value?.event?.type==='turn/end'))}
 const rows=await rpc('session/list',{_request:{}});
 console.log(JSON.stringify({sessionId,sessions:rows.items.map(r=>r.sessionId),frames}));
}finally{socket.close()}
