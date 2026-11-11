#!/usr/bin/env node
// Read-only verification with the exact deployed redis package. No RedisStore.init,
// EVAL, key scans, writes, or raw provider errors are permitted in this command.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

export function validate(value) {
  if (!value || value.schema !== 1 || value.transport !== 'tls-tcp'
      || value.host !== 'redis.x.aixgg.com' || value.port !== 6379
      || value.username !== 'redis_2429e58a' || typeof value.password !== 'string' || !value.password
      || value.namespace !== 'anywork:selfhost:v1') throw Error('INVALID_PRIVATE_REDIS_STATE');
  return value;
}
export function connection(value) {
  const v = validate(value);
  return {url:`rediss://${encodeURIComponent(v.username)}:${encodeURIComponent(v.password)}@${v.host}:${v.port}/0`,
    socket:{connectTimeout:4000,reconnectStrategy:false},disableOfflineQueue:true};
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PROBE_DEADLINE')),5000);})]); }
  finally { clearTimeout(timer); }
}
export async function run(value, redis, negative = false) {
  const v = validate(value), options = connection(v);
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('INSECURE_NODE_TLS_ENVIRONMENT');
  const client = redis.createClient(options);
  client.on('error',()=>{});
  try {
    await bounded(client.connect());
    const commands = client.withCommandOptions({timeout:4500});
    if (await bounded(commands.ping()) !== 'PONG') throw Error('PING_REJECTED');
    const prefix = `{${v.namespace}}`;
    const types = {};
    for (const name of ['meta','initialized','revision','sequence']) {
      const type = await bounded(commands.type(`${prefix}:${name}`));
      const expected = name === 'meta' ? 'hash' : 'string';
      if (type !== 'none' && type !== expected) throw Error('NAMESPACE_TYPE_REJECTED');
      types[name] = type;
    }
    const initialized = await bounded(commands.get(`${prefix}:initialized`));
    if (initialized !== null && initialized !== '1') throw Error('NAMESPACE_MARKER_REJECTED');
    // Check existence only; never retrieve the seed-bearing meta.state value.
    const hasMeta = types.meta === 'hash' ? await bounded(commands.hExists(`${prefix}:meta`,'state')) : false;
    const result = {schema:1,tls:true,hostnameVerified:true,authenticated:true,ping:true,types,
      initialized:initialized === '1',hasMeta};
    if (negative) {
      for (const [name, socket, expected] of [
        ['wrongHostname',{servername:'wrong-hostname.invalid'},'ERR_TLS_CERT_ALTNAME_INVALID'],
        ['untrustedIssuer',{ca:[]},'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'],
      ]) {
        const bad = redis.createClient({...options,socket:{...options.socket,...socket}});
        bad.on('error',()=>{});
        let rejected = false;
        try { await bounded(bad.connect()); }
        catch (error) { if (error?.code !== expected) throw Error('TLS_NEGATIVE_CONTROL_WRONG_FAILURE'); rejected = true; }
        finally { if (bad.isOpen) bad.destroy(); }
        if (!rejected) throw Error('TLS_NEGATIVE_CONTROL_ACCEPTED');
        result[name+'Rejected'] = true;
      }
    }
    return result;
  } finally { if (client.isOpen) client.destroy(); }
}
export function privateInput(path) {
  const st = fs.lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077)) throw Error('PRIVATE_FILE_REQUIRED');
  return validate(JSON.parse(fs.readFileSync(path,'utf8')));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [statePath, modulePath, output] = process.argv.slice(2);
    if (!statePath || !modulePath || !output) throw Error('EXPECTED_PRIVATE_STATE_MODULE_OUTPUT');
    const value = privateInput(statePath);
    const require = createRequire(import.meta.url), redis = require(modulePath);
    const result = await run(value,redis,true);
    fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log('REDIS_TLS_READONLY_PROBE_OK');
  } catch {
    console.error('REDIS_TLS_READONLY_PROBE_FAILED');
    process.exitCode=1;
  }
}
