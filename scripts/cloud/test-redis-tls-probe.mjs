import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connection,run,validate} from './redis-tls-probe.mjs';
const value={schema:1,transport:'tls-tcp',host:'redis.x.aixgg.com',port:6379,username:'redis_2429e58a',password:'synthetic!@:/#%',namespace:'anywork:selfhost:v1'};
function fake(negativeCodes=['ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'],types={}) {
  const calls=[],clients=[];
  return {calls,clients,createClient(options){
    const i=clients.length;
    const client={isOpen:false,on(){},destroy(){calls.push(['destroy',i]);this.isOpen=false;},
      async connect(){calls.push(['connect',i]);this.isOpen=true;if(i>0){const code=negativeCodes[i-1];if(code)throw Object.assign(Error(),{code});}},
      withCommandOptions(options){assert.equal(options.timeout,4500);return this;},
      async ping(){calls.push(['PING']);return 'PONG';},
      async type(key){calls.push(['TYPE',key]);return types[key]??'none';},
      async get(key){calls.push(['GET',key]);return null;},
      async hExists(){throw Error('Not expected for empty namespace');}};
    clients.push(client);return client;
  }};
}
test('fixed TLS domain/namespace and encoded credentials',()=>{
  assert.equal(new URL(connection(value).url).protocol,'rediss:');
  assert.ok(connection(value).url.includes('synthetic!%40%3A%2F%23%25@redis.x.aixgg.com:6379'));
  for(const [key,bad] of [['host','1.2.3.4'],['port',6380],['transport','tcp'],['namespace','unrelated'],['username','other'],['password','']]) {
    assert.throws(()=>validate({...value,[key]:bad}));
  }
});
test('read-only command allowlist and exact TLS failure controls',async()=>{
  const redis=fake(),result=await run(value,redis,true);
  assert.equal(result.wrongHostnameRejected,true);assert.equal(result.untrustedIssuerRejected,true);
  assert.deepEqual(redis.calls.filter(x=>['TYPE','GET'].includes(x[0])).map(x=>x[1]),
    ['meta','initialized','revision','sequence','initialized'].map(x=>`{${value.namespace}}:${x}`));
  assert.ok(redis.calls.every(x=>['connect','destroy','PING','TYPE','GET'].includes(x[0])));
  assert.ok(redis.clients.every(x=>!x.isOpen));
});
test('transient network failure cannot pass as certificate rejection',async()=>{
  const redis=fake(['ECONNRESET']);await assert.rejects(run(value,redis,true),/TLS_NEGATIVE_CONTROL_WRONG_FAILURE/);
  assert.ok(redis.clients.every(x=>!x.isOpen));
});
test('wrong-hostname control cannot pass if connection accepted',async()=>{
  const redis=fake([null]);await assert.rejects(run(value,redis,true),/TLS_NEGATIVE_CONTROL_ACCEPTED/);
});
test('namespace corruption fails closed with fixed error and cleanup',async()=>{
  const redis=fake([],{[`{${value.namespace}}:meta`]:'string'});
  await assert.rejects(run(value,redis),/NAMESPACE_TYPE_REJECTED/);assert.ok(redis.clients.every(x=>!x.isOpen));
});
