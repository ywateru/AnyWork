// Bind the served Web file set to the exact corresponding-source archive.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const [distArg, sourceArg] = process.argv.slice(2);
if (!distArg || !sourceArg) throw new Error('Usage: container-web-identity.mjs DIST SOURCE_ARCHIVE');
const dist = resolve(distArg);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
const fingerprint = html.match(/<meta name="app-version" content="(anywork-[a-f0-9]{16})">/)?.[1];
if (!fingerprint) throw new Error('Missing PWA build fingerprint');
const files = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && entry.name !== 'build-identity.json')
      files['/' + relative(dist, path).replaceAll('\\', '/')] = digest(await readFile(path));
    else if (!entry.isFile()) throw new Error('Unsupported Web build file type');
  }
}
await walk(dist);
await writeFile(resolve(dist, 'build-identity.json'), JSON.stringify({schema:1, appVersion:version,
  sourceSha256:digest(await readFile(resolve(sourceArg))), appFingerprint:fingerprint, files}));
console.log('Bound Web build identity to application version and corresponding source');
