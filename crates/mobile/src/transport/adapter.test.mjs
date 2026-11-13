import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const repository=fileURLToPath(new URL('../../../../',import.meta.url));
const require=createRequire(path.join(repository,'package.json'));
const ts=require('typescript');
const root=path.join(repository,'web/src/mobile/');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'anywork-mobile-adapter-'));
try {
for(const name of ['transportTypes','NativeTransport']){
 let js=ts.transpileModule(fs.readFileSync(root+name+'.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 js=js.replace('"./transportTypes"','"./transportTypes.mjs"');
 fs.writeFileSync(path.join(temporary,name+'.mjs'),js);
}
const {NativeTransport}=await import(pathToFileURL(path.join(temporary,'NativeTransport.mjs')).href);
const tick=()=>new Promise(r=>setImmediate(r));
function bridge(){
 const calls=[],operations=new Map();let handler,headHold,channel,early=false;
 const info={connectionId:'fixture',generation:1,scopeId:'fixture-scope'};
 const api={core:{Channel:class{onmessage=()=>{}},async invoke(name,args){
  assert.deepEqual(Object.keys(args),['request']);const r=args.request;calls.push([name,r]);
  switch(name){
   case 'mobile_transport_connect': if(early)handler({payload:{connection:info,code:'CONNECTION_CLOSED'}});return info;
   case 'mobile_transport_http_begin':operations.set(r.operationId,{...r,chunks:[],offset:0});return;
   case 'mobile_transport_http_write':{
    const op=operations.get(r.operationId);assert.equal(r.offset,op.offset);
    const b=Buffer.from(r.base64,'base64');assert.ok(b.length<=32768);op.chunks.push(b);op.offset+=b.length;
    return {received:op.offset};}
   case 'mobile_transport_http_finish':{
    const op=operations.get(r.operationId);assert.equal(op.size,op.offset);
    op.response=Buffer.from(JSON.stringify({error:'fixture conflict'}));op.read=0;
    if(headHold)return await headHold;
    return {status:409,contentType:'application/json',size:op.response.length};}
   case 'mobile_transport_http_read':{
    const op=operations.get(r.operationId);let end=Math.min(op.read+32768,op.response.length);
    const result={base64:op.response.subarray(op.read,end).toString('base64'),done:end===op.response.length};op.read=end;return result;}
   case 'mobile_transport_pty':
    if(r.type==='open'){channel=r.onEvent;queueMicrotask(()=>channel.onmessage({...r,sequence:1,type:'ready'}));}return;
   case 'mobile_transport_cancel':return;
   case 'mobile_transport_close':return {cleanupPending:false};
   default:throw new Error(name);
  }
 }},event:{async listen(name,h){assert.equal(name,'mobile-transport-closed');handler=h;return ()=>{};}}};
 globalThis.window={__TAURI__:api};
 return {calls,operations,info,setHeadHold:p=>headHold=p,setEarly:()=>early=true,get channel(){return channel;}};
}
const connect=()=>NativeTransport.connect({deviceRef:'fixture',expectedEpoch:1,expectedRevision:1});
{
 const b=bridge(),t=await connect();
 const form=new FormData();form.append('files',new Blob(['中文'+ 'x'.repeat(70000)],{type:'text/plain'}),'测试.txt');
 const response=await t.request('/api/sessions/test/uploads',{method:'POST',body:form});
 assert.equal(response.status,409);assert.equal((await response.json()).error,'fixture conflict');
 const op=[...b.operations.values()][0];
 assert.match(op.contentType,/multipart\/form-data; boundary=/);
 const parsed=await new Request('https://fixture.invalid/',{method:'POST',headers:{'content-type':op.contentType},body:Buffer.concat(op.chunks)}).formData();
 assert.equal(parsed.get('files').name,'测试.txt');assert.equal(await parsed.get('files').text(),'中文'+'x'.repeat(70000));
 t.close();console.log('PASS multipart/binary chunking and HTTP error preservation');
}
{
 const b=bridge(),t=await connect(),c=new AbortController();c.abort();
 await assert.rejects(t.request('/api/info',{signal:c.signal}),{name:'AbortError'});
 assert.equal(b.calls.filter(([n])=>n==='mobile_transport_http_begin').length,0);
 assert.ok(b.calls.some(([n])=>n==='mobile_transport_cancel'));t.close();console.log('PASS aborted-before-begin tombstone');
}
{
 const b=bridge(),t=await connect(),c=new AbortController();let release;
 b.setHeadHold(new Promise(r=>release=r));
 const work=t.request('/api/sessions/test/messages',{method:'POST',body:'{}',signal:c.signal});
 while(!b.calls.some(([n])=>n==='mobile_transport_http_finish'))await tick();
 c.abort();await Promise.race([assert.rejects(work,{name:'AbortError'}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('abort hung')),100))]);
 release({status:200,size:0});await tick();
 assert.equal(b.calls.filter(([n])=>n==='mobile_transport_http_read').length,0);t.close();console.log('PASS in-flight abort immediately settles and ignores late result');
}
{
 const b=bridge(),t=await connect();let ready=0,closed=0;
 const p=t.terminal('test',{ready(){ready++;},data(){},closed(){closed++;}});await tick();
 assert.equal(ready,1);p.input('中'.repeat(5000));await tick();await tick();
 const chunks=b.calls.filter(([n,r])=>n==='mobile_transport_pty'&&r.type==='input').map(([,r])=>r.data);
 assert.equal(chunks.join(''),'中'.repeat(5000));assert.ok(chunks.every(c=>Buffer.byteLength(c)<=8192));
 p.close();p.close();assert.equal(closed,1);t.close();console.log('PASS PTY early ready, ACK, UTF8 input chunks and idempotent close');
}
{
 const b=bridge();b.setEarly();await assert.rejects(connect(),{code:'CONNECTION_CLOSED'});
 console.log('PASS connection end arriving before connect reply');
}
console.log('5 adapter checks passed');

} finally { fs.rmSync(temporary,{recursive:true,force:true}); }
