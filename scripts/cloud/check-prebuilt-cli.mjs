#!/usr/bin/env node
// Execute the pinned CLI's real buildFileTree/hash code, stopping at its first
// hashes-calculated yield. Synthetic token and blocked transports prevent writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const [cliPackage, staging, expectation = 'success'] = process.argv.slice(2);
if (!cliPackage || !staging || !['success', 'missing'].includes(expectation)) throw Error('Expected CLI package, absolute staging, [success|missing]');
if (!path.isAbsolute(cliPackage) || !path.isAbsolute(staging)) throw Error('Absolute paths required');
if (JSON.parse(await fs.readFile(path.join(cliPackage, 'package.json'), 'utf8')).version !== '50.28.0') throw Error('CLI pin differs');
let networkCalls = 0;
const deny = () => { networkCalls++; throw Error('OFFLINE_NETWORK_BLOCKED'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = tls.connect = deny;
syncBuiltinESMExports();
const chunks = path.join(cliPackage, 'dist/chunks');
const candidates = [];
for (const name of await fs.readdir(chunks)) {
  if (!name.endsWith('.js')) continue;
  const text = await fs.readFile(path.join(chunks, name), 'utf8');
  if (text.includes('var createDeployment = (0, import_create_deployment.default)();') && text.includes('require_dist2 as require_dist')) candidates.push(name);
}
if (candidates.length !== 1) throw Error('Pinned client export differs');
const client = (await import(pathToFileURL(path.join(chunks, candidates[0])).href)).require_dist();
const iterator = client.createDeployment({ path: staging, prebuilt: true, vercelOutputDir: path.join(staging, '.vercel/output'), token: 'offline-synthetic-token' });
try {
  const result = await iterator.next();
  if (expectation !== 'success' || result.done || result.value?.type !== 'hashes-calculated') throw Error('Unexpected offline client outcome');
  const files = Object.values(result.value.payload).flatMap(entry => entry.names);
  if (!files.length || files.some(file => !path.resolve(file).startsWith(path.join(staging, '.vercel') + path.sep))) throw Error('Client referenced files outside checked output');
  await iterator.return(); // Never resume into upload.
  if (networkCalls !== 0) throw Error('Unexpected network attempt');
  console.log(JSON.stringify({ mode: 'offline-real-cli', result: 'hashes-calculated', files: files.length, networkCalls, cli: '50.28.0' }));
} catch (error) {
  await iterator.return();
  if (expectation !== 'missing' || networkCalls || !String(error.message).startsWith('File does not exist:')) throw Error('Offline CLI check failed');
  console.log(JSON.stringify({ mode: 'offline-real-cli', result: 'missing-reference-before-upload', networkCalls, cli: '50.28.0' }));
}
