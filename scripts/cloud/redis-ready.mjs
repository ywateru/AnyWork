#!/usr/bin/env node
// MUTATING: invoked only by the locked, exact-GO cutover after review. Runs the
// deployed RedisStore.ready() against its dedicated namespace, before Vercel writes.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {privateInput,connection} from './redis-tls-probe.mjs';
try {
  const [input,modulePath,output] = process.argv.slice(2);
  if (!input || !modulePath || !output || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error();
  const config = privateInput(input);
  const {RedisStore,redisTransport} = await import(pathToFileURL(modulePath));
  const store = new RedisStore(redisTransport({CYBERGRID_REDIS_TRANSPORT:'tcp',REDIS_URL:connection(config).url}),config.namespace);
  let timer;
  try {
    await Promise.race([store.ready(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),10000);})]);
    const result = {schema:1,ready:true,namespace:config.namespace,epoch:store.epoch,limits:store.limits};
    if (!/^[a-f0-9-]{36}$/.test(result.epoch)) throw Error();
    fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
  } finally {clearTimeout(timer);store.close();}
  console.log('DEDICATED_NAMESPACE_READY');
} catch {
  console.error('DEDICATED_NAMESPACE_READY_FAILED');
  process.exitCode=1;
}
