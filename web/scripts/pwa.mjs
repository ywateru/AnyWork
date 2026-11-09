import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
const base = process.env.ANYWORK_WEB_BASE || "/";
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))
  throw new Error("Invalid public application base");
const dist = resolve(process.argv[2] ?? "dist"),
  paths = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) await walk(path);
    else if (
      /\.(?:html|js|css|svg|png|webmanifest)$/.test(path) &&
      item.name !== "sw.js"
    )
      paths.push("/" + relative(dist, path).replaceAll("\\", "/"));
  }
}
await walk(dist);
paths.sort();
// Grammars and optional third-party themes are loaded on demand. Use the build
// graph so shared grammar chunks are deferred too, while shared runtime imports
// and all first-party views remain available in the installed shell.
let manifest;
try {
  manifest = JSON.parse(
    await readFile(resolve(dist, ".vite/manifest.json"), "utf8"),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const deferred = new Set();
if (manifest) {
  const optional = new Set(),
    required = new Set();
  function visit(key, selected) {
    if (selected.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing build chunk: ${key}`);
    selected.add(key);
    for (const dependency of chunk.imports ?? []) visit(dependency, selected);
  }
  const grammarOrTheme =
    /node_modules\/(?:@shikijs\/(?:langs|themes)\/|@pierre\/highlights\/dist\/themes\/(?!loader\.)|@pierre\/theme\/dist\/pierre-)/;
  for (const key of Object.keys(manifest))
    if (grammarOrTheme.test(key)) visit(key, optional);
  for (const [key, chunk] of Object.entries(manifest))
    if ((chunk.isEntry || chunk.isDynamicEntry) && !optional.has(key))
      visit(key, required);
  for (const key of optional)
    if (!required.has(key)) deferred.add("/" + manifest[key].file);
}
const precache = paths.filter((path) => !deferred.has(path));
const manifestPath = resolve(dist, "manifest.webmanifest");
const appManifest = JSON.parse(await readFile(manifestPath, "utf8"));
appManifest.start_url = base;
appManifest.scope = base;
for (const icon of appManifest.icons)
  icon.src = base + icon.src.split("/").at(-1);
await writeFile(manifestPath, JSON.stringify(appManifest));
const hash = createHash("sha256");
hash.update(await readFile(new URL(import.meta.url)));
for (const path of paths) {
  hash.update(path);
  const content = await readFile(resolve(dist, "." + path));
  hash.update(
    path === "/index.html"
      ? content
          .toString()
          .replace(/<meta name="app-version" content="[^"]*">/g, "")
      : content,
  );
}
const version = "anywork-" + hash.digest("hex").slice(0, 16);
const publicPath = (path) => base.slice(0, -1) + path;
const script = `const CACHE=${JSON.stringify(version)},ASSETS=${JSON.stringify(paths.map(publicPath))},PRECACHE=${JSON.stringify(precache.map(publicPath))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE))));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE_UPDATE')self.skipWaiting();if(event.data==='GET_VERSION')event.ports[0]?.postMessage({version:CACHE})});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('remote-agent-')||key.startsWith('anywork-'))&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const data=event.notification.data;
 if(!data||typeof data.sessionId!=='string')return;
 event.waitUntil((async()=>{
   const url=new URL(${JSON.stringify(base)}+'#'+encodeURIComponent(data.sessionId),self.location.origin);
   const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
   const client=clients.find(client=>new URL(client.url).origin===url.origin);
   if(client){await client.focus();client.postMessage({type:'ANYWORK_NOTIFICATION_CLICK',...data});}
   else await self.clients.openWindow(url.href);
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/ws/')||url.pathname==='/source'||url.pathname.endsWith('/callback')||url.searchParams.has('code')||url.searchParams.has('state'))return;
 if(request.mode==='navigate'){event.respondWith(fetch(request).catch(()=>caches.match(${JSON.stringify(base + "index.html")})));return;}
 if(ASSETS.includes(url.pathname))event.respondWith((async()=>{
   const cache=await caches.open(CACHE),cached=await cache.match(request);
   if(cached)return cached;
   const response=await fetch(request);
   if(response.ok)await cache.put(request,response.clone()).catch(()=>{});
   return response;
 })());
});`;
await writeFile(resolve(dist, "sw.js"), script);
const indexPath = resolve(dist, "index.html");
const html = (await readFile(indexPath, "utf8")).replace(
  /<meta name="app-version" content="[^"]*">/g,
  "",
);
await writeFile(
  indexPath,
  html.replace(
    "</head>",
    `<meta name="app-version" content="${version}"></head>`,
  ),
);
console.log(
  `PWA: ${precache.length} shell assets, ${paths.length - precache.length} on-demand assets, ${version}; API data is never cached.`,
);
