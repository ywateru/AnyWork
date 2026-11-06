#!/usr/bin/env node
/** Actual CDP transport test against a private Chromium renderer with a deterministic
 * native preload substitute. This is NOT WorkBuddy runtime acceptance; the latter
 * must separately exercise the unchanged installed app in an isolated profile. */
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import net from 'node:net';
import {chromium} from 'playwright';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const binary=process.env.ANYWORK_BINARY || path.join(repo,'target/debug/anywork');
const root=await mkdtemp(path.join(await import('node:fs/promises').then(m=>m.realpath(tmpdir())),'anywork-workbuddy-carrier-'));
await chmod(root,0o700);
const workspace=path.join(root,'workspace'), configDir=path.join(root,'config'), userData=path.join(root,'chrome');
for(const dir of [workspace,configDir,path.join(root,'home'),path.join(root,'plugins'),path.join(root,'entry')]){await mkdir(dir,{recursive:true,mode:0o700});}
const image=path.join(workspace,'image.png');
await writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
const document=path.join(workspace,'notes.txt');await writeFile(document,'native document fixture');
const html=path.join(root,'app.asar/renderer/index.html');await mkdir(path.dirname(html),{recursive:true});await writeFile(html,'<!doctype html><title>WorkBuddy carrier fixture</title>');
const port=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
let context,server,relay;const sockets=new Set();let log='';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,label){const end=Date.now()+15000;while(Date.now()<end){const v=await test();if(v)return v;await delay(100);}throw Error(`Timed out: ${label}`);}
try{
  context=await chromium.launchPersistentContext(userData,{channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true,args:['--remote-debugging-port=0','--disable-background-networking']});
  await context.route('**/*',route=>route.request().url().startsWith('file:')?route.continue():route.abort());
  await context.addInitScript(({workspace,configDir,image,document})=>{
    const info=id=>({id,title:`Native ${id}`,transport:'local',space:{type:'local',cwd:workspace},state:'idle',lifecycle:'active',createdAt:1700000000000,updatedAt:1700000000001});
    const record=(id,text,state='completed')=>({id,state,timestamp:1700000000000,finishTimestamp:state==='completed'?1700000000001:undefined,userMessage:{content:[{type:'text',text}]},systemMessage:{content:[{type:'text',text:'PRIVATE_SYSTEM_CONTEXT'}]},assistantMessage:{content:[{type:'text',text:'native seed response'},{type:'tool',toolCallId:'same-call',status:'completed',_meta:{'codebuddy.ai/toolName':'read_file'},rawInput:{path:document},rawOutput:'native tool result',content:[{type:'content',content:{type:'resource_link',uri:document,name:'notes.txt'}},{type:'content',content:{type:'image',uri:image}}]}]}});
    const s={infos:{one:info('one'),two:info('two')},records:{one:[record('seed-turn','native seed')],two:[]},pending:{},errors:{},calls:[],sendCount:0,answers:0,ready:0};
    const finish=(id,state='completed')=>{const r=s.records[id].at(-1);r.state=state;r.finishTimestamp=Date.now();r.assistantMessage={content:[{type:'text',text:`native response ${r.id}`}]};s.infos[id].state='idle';delete s.pending[id];};
    window.workbuddyDesktop={appVersion:'5.9.3',configDir};window.__wbEventBridge=()=>()=>{};window.fixture=s;
    window.__wbInvoke=async(channel,_context,...args)=>{
      s.calls.push({channel,args});const id=args[0];
      if(s.errors[channel])return s.errors[channel]==='legacy'?{errorCode:'FORBIDDEN',message:'NATIVE_ERROR_SECRET',source:'PRIVATE_SOURCE_SECRET'}:{__wbError:true,code:'UNKNOWN',message:'NATIVE_ERROR_SECRET token=PRIVATE_TOKEN',source:'PRIVATE_SOURCE_SECRET'};
      switch(channel){
        case 'wb:conversations:list':return{items:Object.values(s.infos),total:Object.keys(s.infos).length,page:{current:1,size:100},partial:false};
        case 'wb:conversations:get':return s.infos[id]?{info:s.infos[id],configManager:{model:s.infos[id].model||'fixture-model',thoughtLevel:s.infos[id].effort||'low',connectors:[{apiKey:'CONNECTOR_SECRET'}]}}:undefined;
        case 'wb:conversations:create':{const id=`created-${Object.keys(s.infos).length}`;s.infos[id]=info(id);s.infos[id].space.cwd=args[0].cwd;s.infos[id].model=args[0].model||'fixture-model';s.records[id]=[];return{info:s.infos[id],configManager:{model:s.infos[id].model,connectors:[{apiKey:'CONNECTOR_SECRET'}]}};}
        case 'wb:conversations:requestEntries':if(s.ready++===0)return{requests:[],entries:[],hasOlder:false,historyReady:false,historyKnownEmpty:false};return{requests:s.records[id]||[],entries:[],hasOlder:false,historyReady:true};
        case 'wb:conversations:getPendingInfo':return s.pending[id];
        case 'wb:conversations:childAgentSnapshots':return id==='one'?[{kind:'subagent',projectionId:'child-projection',conversationid:'native-child',parentRequestId:'seed-turn',state:'completed',requests:[record('child-turn','child task')],hasOlder:false}]:[];
        case 'wb:conversations:loadToolDetail': case 'wb:conversations:childAgentLoadToolDetail':return{toolCallId:args.at(-1),rawInput:{path:document},rawOutput:'hydrated native tool output'};
        case 'wb:conversations:childAgentRequests':return{items:[record('child-turn','child task')],total:1,hasOlder:false};
        case 'wb:models:list':return{items:[{id:'fixture-model',name:'Fixture',supportsImages:true,apiKey:'MODEL_SECRET',url:'https://PRIVATE_PROVIDER',reasoning:{supportedEfforts:['low','high']},isDefault:true}]};
        case 'wb:conversations:configSetModel':s.infos[id].model=args[1];return;
        case 'wb:conversations:configSetThoughtLevel':s.infos[id].effort=args[1];return;
        case 'wb:conversations:sendPrompt':{
          s.sendCount++;const content=args[1],opts=args[2],rid=opts._meta['codebuddy.ai/conversationRequestId'];const text=content.filter(b=>b.type==='text').map(b=>b.text).join('');
          const r=record(rid,text,'streaming');r.userMessage.content=content;r.assistantMessage={content:[{type:'text',text:'started'}]};s.records[id].push(r);s.infos[id].state='working';
          if(text==='approval'){s.pending[id]={id:'same-native-permission',category:'tool',toolName:'bash',options:[{optionId:'allow',kind:'allow_once',name:'Allow once'},{optionId:'reject',kind:'reject_once',name:'Reject'},{optionId:'forever',kind:'allow_always',name:'Always'}]};}
          else if(text==='question'){s.pending[id]={id:'native-question',category:'question',questions:[{id:'q',header:'Choice',question:'Choose',options:[{label:'A'},{label:'B'}]}]};}
          else if(text!=='hold'){setTimeout(()=>finish(id),250);}
          return;
        }
        case 'wb:conversations:cancel':finish(id,'cancelled');return;
        case 'wb:conversations:resolvePending':if(s.pending[id]?.id===args[1]){s.answers++;finish(id);}return;
        default:throw Error(`Fixture forbidden channel ${channel}`);
      }
    };
  },{workspace,configDir,image,document});
  const page=await context.newPage();await page.goto(pathToFileURL(html).href);
  const active=(await readFile(path.join(userData,'DevToolsActivePort'),'utf8')).trim().split('\n');const chromePort=Number(active[0]);const browserId=active[1].split('/').at(-1);
  relay=createServer(async(req,res)=>{try{const r=await fetch(`http://127.0.0.1:${chromePort}${req.url}`);let text=await r.text();if(req.url==='/json/version'||req.url==='/json/list'){const v=JSON.parse(text);const rewrite=o=>{if(o.webSocketDebuggerUrl)o.webSocketDebuggerUrl=o.webSocketDebuggerUrl.replace(`:${chromePort}/`,`:${relay.address().port}/`);};Array.isArray(v)?v.forEach(rewrite):rewrite(v);text=JSON.stringify(v);}res.writeHead(r.status,{'Content-Type':'application/json'});res.end(text);}catch{res.writeHead(502);res.end('{}');}});
  relay.on('upgrade',(req,socket,head)=>{const upstream=net.connect(chromePort,'127.0.0.1',()=>{const headers=Object.entries(req.headers).flatMap(([k,v])=>Array.isArray(v)?v.map(x=>`${k}: ${x}`):[`${k}: ${v}`]).join('\r\n');upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});sockets.add(socket);sockets.add(upstream);for(const s of [socket,upstream]){s.on('error',()=>{});s.on('close',()=>sockets.delete(s));}});
  await new Promise(r=>relay.listen(0,'127.0.0.1',r));
  const descriptor=path.join(root,'entry/host.json');await writeFile(descriptor,JSON.stringify({version:1,agent:'workbuddy',appVersion:'5.9.3',pid:process.pid,url:`http://127.0.0.1:${relay.address().port}/`,browserId,configDir,instanceId:crypto.randomUUID()}),{mode:0o600});
  const servicePort=await port(),base=`http://127.0.0.1:${servicePort}`,token='anywork-fixture-token-0123456789';
  server=spawn(binary,['--bind',`127.0.0.1:${servicePort}`,'--workspace',workspace,'--data-dir',path.join(root,'data'),'--plugins-dir',path.join(root,'plugins'),'--web-dir',path.join(root,'no-web'),'--codex-discovery=false','--workbuddy-discovery-file',descriptor,'--token',token],{cwd:repo,env:{...process.env,HOME:path.join(root,'home'),ANYWORK_HARNESS_DISCOVERY_FILE:undefined,ANYWORK_HARNESS_URL:undefined,ANYWORK_HARNESS_TOKEN_FILE:undefined},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',b=>{log=(log+b).slice(-32000)});server.stderr.on('data',b=>{log=(log+b).slice(-32000)});
  const api=async(route,body,expected=200)=>{const r=await fetch(base+'/api'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();assert.equal(r.status,expected,`${route} ${JSON.stringify(value)}`);return value;};
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok}catch{return false}},'server');
  const listing=await api('/sessions');assert.equal(listing.sessions.filter(s=>s.agent==='workbuddy').length,2);
  const id='workbuddy-one',other='workbuddy-two';
  const history=await api(`/sessions/${id}/history?paged=true&limit=20`);assert(history.events.some(e=>e.params.text==='native seed'));assert(!JSON.stringify(history).includes('PRIVATE_SYSTEM_CONTEXT'));
  assert(history.events.some(e=>e.params.item?.type==='imageView'));assert(history.events.some(e=>e.params.item?.type==='dynamicToolCall'));
  const toolEvent=history.events.find(e=>e.params.item?.type==='dynamicToolCall');const detail=await api(`/sessions/${id}/history/item?seq=${toolEvent.seq}`);assert.equal(detail.item.output,'hydrated native tool output');
  const composer=await api(`/sessions/${id}/composer`);assert.equal(composer.model,'fixture-model');assert.equal(composer.plan_available,false);assert.equal(composer.goal_capabilities.create,false);assert(!JSON.stringify(composer).includes('SECRET'));assert(!JSON.stringify(composer).includes('PRIVATE_PROVIDER'));
  await api(`/sessions/${id}/composer`,{action:'settings',model:'fixture-model',effort:'high'});
  const after=await api(`/sessions/${id}/composer`);assert.equal(after.effort,'high');
  const mutations=()=>page.evaluate(()=>fixture.calls.filter(c=>/:(create|sendPrompt|cancel|resolvePending|configSetModel|configSetThoughtLevel)$/.test(c.channel)).length);
  const beforeChanges=await mutations();await api(`/sessions/${id}/messages`,{text:'must not send',goal:true},400);assert.equal(await page.evaluate(()=>fixture.sendCount),0);
  await api(`/sessions/${id}/composer`,{action:'goal',objective:'must not set goal'},400);assert.equal(await mutations(),beforeChanges);
  const kids=(await api('/sessions')).sessions.filter(s=>s.auxiliary);assert.equal(kids.length,1);assert.equal((await api(`/sessions/${kids[0].id}/composer`)).read_only,true);await api(`/sessions/${kids[0].id}/history?paged=true`);await api(`/sessions/${kids[0].id}/messages`,{text:'forbidden'},400);await api(`/sessions/${kids[0].id}/interrupt`,{},400);
  const created=(await api('/sessions',{agent:'workbuddy',cwd:'.',model:'fixture-model'})).session;assert.equal(created.external,true);assert(created.id.startsWith('workbuddy-created-'));
  const injection='quote ");globalThis.PWNED=true;// ${notCode} ` backtick';await api(`/sessions/${id}/messages`,{text:injection});await until(async()=>(await api(`/sessions/${id}`)).session.status==='idle','send completion');assert.equal(await page.evaluate(()=>window.PWNED),undefined);assert.equal(await page.evaluate(()=>fixture.sendCount),1);
  // Busy queue is server-local until the prior turn finishes; cancel pauses it.
  await api(`/sessions/${id}/messages`,{text:'hold'});const queued=await api(`/sessions/${id}/messages`,{text:'after queue',queue_if_busy:true});assert.equal(queued.queued,true);assert.equal(await page.evaluate(()=>fixture.sendCount),2);await api(`/sessions/${id}/interrupt`,{});const cancelled=await api(`/sessions/${id}/events/poll?after=0`);assert(JSON.stringify(cancelled).includes('interrupted'));await api(`/sessions/${id}/queue`,{action:'pause',paused:false});await until(async()=>await page.evaluate(()=>fixture.sendCount)===3,'queued once');await delay(1200);assert.equal(await page.evaluate(()=>fixture.sendCount),3);
  await until(async()=>(await api(`/sessions/${id}`)).session.status==='idle','queue completion');
  await api(`/sessions/${id}/messages`,{text:'approval'});
  const pending=async(sid)=>{const r=await api(`/sessions/${sid}/events/poll?after=0&controls=true`);const rows=r.events||r;const resolved=new Set(rows.filter(e=>e.method==='serverRequest/resolved').map(e=>JSON.stringify(e.params.requestId)));return rows.filter(e=>e.request_id!=null&&!resolved.has(JSON.stringify(e.request_id))).at(-1);};
  const old=await until(()=>pending(id),'approval');await delay(2100);assert.equal((await api('/sessions')).sessions.find(s=>s.id===id).status,'waiting');
  await api(`/sessions/${other}/respond`,{request_id:old.request_id,accept:true},409);
  // Lose only this fixture's CDP connections; original renderer and pending stay alive.
  for(const socket of [...sockets])socket.destroy();const fresh=await until(async()=>{const p=await pending(id);return p&&p.request_id!==old.request_id?p:false},'new peer approval');
  await api(`/sessions/${id}/respond`,{request_id:old.request_id,accept:true},409);await api(`/sessions/${id}/respond`,{request_id:fresh.request_id,accept:true});assert.equal(await page.evaluate(()=>fixture.answers),1);await api(`/sessions/${id}/respond`,{request_id:fresh.request_id,accept:true},409);
  // The native tool ID can be reused in a later turn on the SAME connection.
  await until(async()=>(await api(`/sessions/${id}`)).session.status==='idle','first permission completed');
  await api(`/sessions/${id}/messages`,{text:'approval'});const repeated=await until(()=>pending(id),'second permission occurrence');assert.notEqual(repeated.request_id,fresh.request_id);
  await api(`/sessions/${id}/respond`,{request_id:fresh.request_id,accept:true},409);assert.equal(await page.evaluate(()=>fixture.answers),1);
  await api(`/sessions/${id}/respond`,{request_id:repeated.request_id,accept:true});assert.equal(await page.evaluate(()=>fixture.answers),2);
  await api(`/sessions/${id}/messages`,{text:'question'});const question=await until(()=>pending(id),'question');await api(`/sessions/${id}/respond`,{request_id:question.request_id,result:{answers:{q:{answers:['A']}}}});assert.equal(await page.evaluate(()=>fixture.answers),3);
  const imageUpload=await fetch(base+`/api/sessions/${id}/uploads`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:(()=>{const f=new FormData();f.append('files',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'test.png');return f;})()});const uploaded=await imageUpload.json();assert(imageUpload.ok,JSON.stringify(uploaded));await api(`/sessions/${id}/messages`,{text:'image roundtrip',attachments:[uploaded.files[0].path]});await until(async()=>(await api(`/sessions/${id}`)).session.status==='idle','image completion');
  const imageHistory=await api(`/sessions/${id}/history?paged=true&limit=20`);assert(imageHistory.events.some(e=>e.params.attachments?.length));
  const imageResponse=await fetch(base+`/api/sessions/${id}/image?path=${encodeURIComponent(image)}`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(imageResponse.status,200);
  // Native errors are resolved values, not thrown exceptions. Every operation
  // must reject before projection/confirmation; the raw message never leaves CDP.
  const fail=async(channel,run,legacy=false)=>{await page.evaluate(({channel,legacy})=>fixture.errors[channel]=legacy?'legacy':true,{channel,legacy});try{await run();}finally{await page.evaluate(channel=>delete fixture.errors[channel],channel);}};
  const rejected=async(route,body,operation)=>{const r=await fetch(base+'/api'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();assert(r.status>=400,`${route} falsely succeeded: ${text}`);assert(text.includes(operation),text);assert(!text.includes('NATIVE_ERROR_SECRET')&&!text.includes('PRIVATE_TOKEN')&&!text.includes('PRIVATE_SOURCE_SECRET'),text);};
  await fail('wb:conversations:list',async()=>{const result=await api('/sessions');assert(result.discovery_error.includes('conversations.list'));assert(result.sessions.some(s=>s.id===id));assert(!JSON.stringify(result).includes('NATIVE_ERROR_SECRET'));});
  await fail('wb:models:list',()=>rejected(`/sessions/${id}/models`,undefined,'models.list'));
  await fail('wb:conversations:create',()=>rejected('/sessions',{agent:'workbuddy',cwd:'.'},'conversations.create'));
  await fail('wb:conversations:get',()=>rejected(`/sessions/${created.id}/composer`,undefined,'conversations.get'));
  const beforeErrorSend=await page.evaluate(()=>fixture.sendCount);const beforeErrorEvents=await api(`/sessions/${id}/events/poll?after=0`);
  await fail('wb:conversations:sendPrompt',()=>rejected(`/sessions/${id}/messages`,{text:'must not submit'},'conversations.sendPrompt'));
  assert.equal(await page.evaluate(()=>fixture.sendCount),beforeErrorSend);await delay(700);
  const afterErrorEvents=await api(`/sessions/${id}/events/poll?after=0`);for(const method of ['turn/started','turn/completed'])assert.equal(afterErrorEvents.events.filter(e=>e.method===method).length,beforeErrorEvents.events.filter(e=>e.method===method).length);
  await fail('wb:conversations:configSetModel',()=>rejected(`/sessions/${id}/composer`,{action:'settings',model:'fixture-model',effort:'low'},'conversations.configSetModel'));
  await fail('wb:conversations:configSetThoughtLevel',()=>rejected(`/sessions/${id}/composer`,{action:'settings',model:'fixture-model',effort:'low'},'conversations.configSetThoughtLevel'),true);
  assert.equal(await page.evaluate(()=>fixture.infos.one.effort),'high');
  await until(async()=>(await api(`/sessions/${id}`)).session.status==='idle','failed send status restored');
  await api(`/sessions/${id}/messages`,{text:'hold'});const heldId=await page.evaluate(()=>fixture.records.one.at(-1).id);
  await fail('wb:conversations:cancel',()=>rejected(`/sessions/${id}/interrupt`,{},'conversations.cancel'));assert.equal(await page.evaluate(()=>fixture.records.one.at(-1).state),'streaming');
  const cancellationEvents=await api(`/sessions/${id}/events/poll?after=0`);assert(!cancellationEvents.events.some(e=>e.method==='turn/completed'&&e.params.turn?.id===heldId));
  await api(`/sessions/${id}/interrupt`,{});await until(async()=>(await api(`/sessions/${id}`)).session.status==='idle','real cancel completion');
  await api(`/sessions/${id}/messages`,{text:'approval'});const failedApproval=await until(()=>pending(id),'native error permission');const answersBefore=await page.evaluate(()=>fixture.answers);
  await fail('wb:conversations:resolvePending',()=>rejected(`/sessions/${id}/respond`,{request_id:failedApproval.request_id,accept:true},'conversations.resolvePending'));assert.equal(await page.evaluate(()=>fixture.answers),answersBefore);assert.equal((await pending(id)).request_id,failedApproval.request_id);
  await api(`/sessions/${id}/respond`,{request_id:failedApproval.request_id,accept:true});assert.equal(await page.evaluate(()=>fixture.answers),answersBefore+1);
  assert(!log.includes('NATIVE_ERROR_SECRET')&&!log.includes('PRIVATE_TOKEN')&&!log.includes('PRIVATE_SOURCE_SECRET'));
  assert(!log.includes('MODEL_SECRET')&&!log.includes('CONNECTOR_SECRET')&&!log.includes('PRIVATE_PROVIDER'));
  assert(!(await page.evaluate(()=>fixture.calls)).some(c=>c.channel.includes('subscription')||c.channel.includes('dispose')||c.channel.includes('configSetPermission')));
  server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));server=undefined;assert.equal(await page.evaluate(()=>typeof __wbInvoke),'function');
  console.log('PASS: actual CDP carrier, private descriptor, shared catalog/history/tools/children/models, fixed evaluation injection resistance, create/send/image, local busy queue/cancel, pending cross-session/generation/cross-turn/exactly-once, native error envelopes rejected before every read/mutation confirmation, failed-send status recovery, and detach ownership. Native preload is a deterministic fixture; real installed WorkBuddy acceptance is separate.');
}finally{
  if(server){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),delay(3000)]);}
  for(const s of sockets)s.destroy();if(relay)await new Promise(r=>relay.close(r));if(context)await context.close();await rm(root,{recursive:true,force:true});
}
