#!/usr/bin/env node
// Opt-in real Logto verification using a dedicated seeded account; credentials
// and token artifacts stay in a mode0600 directory outside the repository.
// --spa or --native selects a lane. Requires @playwright/test and local Chrome.
const {chromium}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http');
const credentials=process.argv.includes('--credentials')?process.argv[process.argv.indexOf('--credentials')+1]:path.join(os.homedir(),'.config/anywork-cloud/test-user.json');
const dir=path.dirname(path.resolve(credentials));
const repoRoot=path.resolve(__dirname,'../..');if(dir===repoRoot||dir.startsWith(repoRoot+path.sep))throw new Error('Verification credentials and tokens must remain outside the repository');
if(fs.lstatSync(credentials).isSymbolicLink()||(fs.statSync(credentials).mode&0o077)!==0)throw new Error('Credentials must be mode0600');
const c=JSON.parse(fs.readFileSync(credentials,'utf8'));
let activeServer;
function check(v,m){if(!v)throw new Error(m)}
function save(name,data){const target=path.join(dir,name);if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw new Error('Token artifact cannot be a symlink');const fd=fs.openSync(target,'w',0o600);try{fs.fchmodSync(fd,0o600);fs.writeFileSync(fd,JSON.stringify(data));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}
(async()=>{
 const b=await chromium.launch({headless:true,channel:'chrome'});
 try {
  for(const kind of (process.argv.includes('--spa')?['spa']:process.argv.includes('--native')?['native']:['spa','native'])){
   const clientId=kind==='spa'?c.spaClientId:c.nativeClientId;
   const redirect=kind==='spa'?'http://127.0.0.1:4173/app/callback':'http://127.0.0.1:17897/callback';
   const v=crypto.randomBytes(32).toString('base64url'),state=crypto.randomBytes(24).toString('base64url');
   const params=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:'openid profile email offline_access custom_data connect',resource:c.resource,code_challenge:crypto.createHash('sha256').update(v).digest('base64url'),code_challenge_method:'S256',state,prompt:'login consent'});
   const context=await b.newContext();const p=await context.newPage();let callback;
   const server=activeServer=http.createServer((req,res)=>{callback=new URL(req.url,redirect);res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('AnyWork isolated verification callback received')});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(new URL(redirect).port,'127.0.0.1',resolve)});
   await p.goto(c.tenantEndpoint+'/oidc/auth?'+params);
   await p.locator('input[name=identifier]').fill(c.username);await p.locator('button[type=submit]').click();
   await p.locator('input[name=password]').fill(c.password);await p.locator('button[type=submit]').click();
   await p.waitForURL(u=>u.href.startsWith(redirect)||u.pathname.includes('consent'),{timeout:30000});if(!p.url().startsWith(redirect)){console.log(kind,'consent buttons',await p.locator('button').allTextContents());await p.getByRole('button',{name:/Authorize|授权|同意|Allow|Continue|继续/}).last().click();await p.waitForURL(redirect+'**',{timeout:30000})};check(callback?.searchParams.get('state')===state,'OAuth state mismatch');check(callback.searchParams.get('code'),'No auth code');
   const tr=await context.request.post(c.tenantEndpoint+'/oidc/token',{form:{grant_type:'authorization_code',client_id:clientId,redirect_uri:redirect,code:callback.searchParams.get('code'),code_verifier:v}});check(tr.ok(),kind+' code exchange HTTP'+tr.status());let tokens=await tr.json();
   console.log(kind,'initial exchange scope',tokens.scope,'refresh present',Boolean(tokens.refresh_token));const initialAccount=tokens.access_token;check(initialAccount?.split('.').length!==3,'Initial noresource token must be opaque'); const gr=await context.request.post(c.tenantEndpoint+'/oidc/token',{form:{grant_type:'refresh_token',client_id:clientId,refresh_token:tokens.refresh_token,resource:c.resource,scope:'connect'}});if(!gr.ok()){const er=await gr.json();throw new Error(kind+' Grid refresh HTTP'+gr.status()+' '+er.error+' '+String(er.error_description).replaceAll(tokens.refresh_token,'[REDACTED]'))};const grid=await gr.json();tokens={...tokens,...grid,refresh_token:grid.refresh_token||tokens.refresh_token};const jwt=grid.access_token;check(jwt?.split('.').length===3,'Grid access token must be JWT');
   const [hs,ps,ss]=jwt.split('.'),header=JSON.parse(Buffer.from(hs,'base64url')),claims=JSON.parse(Buffer.from(ps,'base64url'));
   const jwks=await (await context.request.get(c.tenantEndpoint+'/oidc/jwks')).json();const jwk=jwks.keys.find(x=>x.kid===header.kid);check(header.alg==='ES384','Unexpected JWT alg');check(crypto.verify('sha384',Buffer.from(hs+'.'+ps),{key:crypto.createPublicKey({key:jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(ss,'base64url')),'JWT signature invalid');check(claims.iss===c.tenantEndpoint+'/oidc','JWT issuer mismatch');check(claims.aud===c.resource,'JWT aud mismatch');check(claims.client_id===clientId,'JWT client mismatch');check(claims.sub===c.id,'JWT user mismatch');check(claims.scope.split(' ').includes('connect'),'JWT connect missing');
   const ar=await context.request.post(c.tenantEndpoint+'/oidc/token',{form:{grant_type:'refresh_token',client_id:clientId,refresh_token:tokens.refresh_token}});if(!ar.ok()){const er=await ar.json();throw new Error(kind+' Account token refresh HTTP'+ar.status()+' '+er.error+' '+String(er.error_description).replaceAll(tokens.refresh_token,'[REDACTED]'))};const account=await ar.json();check(account.access_token?.split('.').length!==3,'Account token must be opaque');tokens={...tokens,refresh_token:account.refresh_token||tokens.refresh_token,account_access_token:account.access_token};
   save('oauth-'+kind+'.json',{...tokens,resource:c.resource,clientId,tenantEndpoint:c.tenantEndpoint,subject:c.id,createdAt:new Date().toISOString()});
   const headers={Authorization:'Bearer '+account.access_token};const profile=await context.request.get(c.tenantEndpoint+'/api/my-account',{headers});check(profile.ok(),'Account API read HTTP'+profile.status());const before=await profile.json();
   if(kind==='spa'){
    const original=before.customData||{};check(original.verificationFixture?.preserve===true,'Use only a dedicated seeded verification account');
    const patch={...original,anywork:{schemaVersion:1,preferences:{locale:'zh-CN',appearance:'system'},devices:{}}};
    let r=await context.request.patch(c.tenantEndpoint+'/api/my-account',{headers,data:{customData:patch}});check(r.ok(),'Account API patch failed');
    let after=await (await context.request.get(c.tenantEndpoint+'/api/my-account',{headers})).json();check(after.customData.verificationFixture?.preserve===true,'Other namespace lost in merge');
    r=await context.request.patch(c.tenantEndpoint+'/api/my-account',{headers,data:{customData:{anywork:patch.anywork}}});check(r.ok(),'Replace behavior patch failed');
    after=await (await context.request.get(c.tenantEndpoint+'/api/my-account',{headers})).json();check(after.customData.verificationFixture===undefined,'Expected full-object replacement');
    r=await context.request.patch(c.tenantEndpoint+'/api/my-account',{headers,data:{customData:patch}});check(r.ok(),'Restore fixture failed');
    const wrong=await context.request.get(c.tenantEndpoint+'/api/my-account',{headers:{Authorization:'Bearer '+jwt}});check(wrong.status()===401,'Resource JWT improperly accepted by AccountAPI');
    console.log('spa Account API read/write, other namespace merge, replacement semantics, wrong token rejection passed');
   }
   console.log(kind,'real hosted auth-code+PKCE + ES384 cryptographic verify + fixed iss/aud/client/scope + separate opaque AccountAPI token passed',{ttl:claims.exp-claims.iat});
   await context.close();await new Promise(resolve=>server.close(resolve));
  }
 }finally{await b.close();if(activeServer?.listening)await new Promise(resolve=>activeServer.close(resolve))}
})().catch(e=>{console.error('OAuth verification failed:',String(e.message).includes('http')?'BROWSER_OR_NETWORK_ERROR (sensitive URL omitted)':e.message);process.exit(1)});
