import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('site/dist');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
const server = createServer(async (req, res) => {
  try {
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/AnyWork(?=\/)/, '');
    let file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep) && file !== root) throw new Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'});
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/AnyWork`;
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {});
await mkdir('artifacts', {recursive:true});
try {
  for (const locale of ['en','zh']) for (const width of [1440,1024,768,390,320]) {
    const page = await browser.newPage({viewport:{width,height:1000}, reducedMotion:'reduce', deviceScaleFactor:1});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const asset = 'anywork-macos-arm64.dmg';
    const release = {tag_name:'v99.0.0',assets:[{name:asset,size:104857600,browser_download_url:`https://github.com/ywateru/AnyWork/releases/download/v99.0.0/${asset}`}]};
    await page.route('https://api.github.com/**', route => route.fulfill({json:release}));
    await page.goto(`${base}/${locale}/`, {waitUntil:'networkidle'});
    assert.equal(await page.locator('html').getAttribute('lang'),locale==='zh'?'zh-CN':'en');
    assert(await page.title());
    assert.equal(await page.locator('h1').count(),1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${locale}/${width}: horizontal overflow`);
    assert((await page.locator(`[data-asset="${asset}"]`).getAttribute('href')).endsWith('/v99.0.0/'+asset));
    assert.equal(await page.locator('.small-cta').getAttribute('href'), '/app/');
    assert.equal(await page.locator('.hero-actions .primary').getAttribute('href'), '/app/?signup=1');
    assert(await page.locator('.device-preview').isVisible());
    assert.equal(await page.locator('.site-device').count(), 2);
    assert.equal(await page.locator('[data-route]').count(), 0);
    const updateNote = await page.locator('.download-update-note').innerText();
    assert(updateNote.includes('0.1.14'));
    assert(updateNote.includes(locale === 'zh' ? '同一账号' : 'same account'));
    assert.equal(await page.locator('.download-update-note a').getAttribute('href'), '/app/');
    assert(!/WireGuard|高级手动连接|advanced manual connections/.test(await page.locator('body').innerText()));
    const background = await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor);
    assert(!['rgb(45, 108, 223)'].includes(background));
    await page.locator('#tab-changes').click();
    assert(await page.locator('#panel-changes').isVisible());
    assert(!(await page.locator('#panel-chat').isVisible()));
    await page.locator('#tab-changes').press('ArrowRight');
    assert(await page.locator('#panel-terminal').isVisible());
    await page.locator('#tab-terminal').press('Home');
    assert(await page.locator('#panel-chat').isVisible());
    await page.locator('#step-devices').click();
    assert(await page.locator('#step-panel-devices').isVisible());
    assert.equal(await page.locator('.network-route-label').textContent(),locale === 'zh' ? '找到电脑' : 'Find your computer');
    await page.locator('#step-devices').press('ArrowRight');
    assert(await page.locator('#step-panel-workspace').isVisible());
    await page.locator('#step-workspace').press('Home');
    await page.locator('.faq summary').first().click();
    assert(await page.locator('.faq details').first().getAttribute('open') !== null);
    await page.locator('#demo-approve').click();
    assert(await page.locator('#demo-approve').isDisabled());
    assert.equal(await page.locator('a.language').getAttribute('href'), `../${locale === 'en' ? 'zh' : 'en'}/`);
    const localAssets = await page.locator('script[src],link[rel="stylesheet"],link[rel="icon"],img').evaluateAll(nodes => nodes.map(node => node.src || node.href));
    for (const url of localAssets) assert.equal((await page.request.get(url)).status(),200,url);
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:`artifacts/anywork-site-${locale}-${width}.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    await page.close();
    console.log(`Passed ${locale} ${width}px: layout, tabs, keys, preview, downloads, local assets`);
  }
  for (const [locale, expected] of [['zh-CN','zh'],['zh-TW','zh'],['en-US','en'],['fr-FR','en']]) {
    const context = await browser.newContext({locale});
    const page = await context.newPage();
    await page.route('https://api.github.com/**', route => route.abort());
    await page.goto(`${base}/?from=test#download`, {waitUntil:'networkidle'});
    assert.equal(new URL(page.url()).pathname, `/AnyWork/${expected}/`);
    assert.equal(new URL(page.url()).search, '?from=test');
    assert.equal(new URL(page.url()).hash, '#download');
    const alternate = expected === 'zh' ? 'en' : 'zh';
    await page.locator('a.language').click();
    assert.equal(new URL(page.url()).pathname, `/AnyWork/${alternate}/`);
    await page.goto(`${base}/`, {waitUntil:'networkidle'});
    assert.equal(new URL(page.url()).pathname, `/AnyWork/${alternate}/`, 'Manual language choice must persist');
    await page.goto(`${base}/${expected}/`, {waitUntil:'networkidle'});
    assert.equal(new URL(page.url()).pathname, `/AnyWork/${expected}/`, 'Explicit language links must stay stable');
    await context.close();
    console.log(`Passed language negotiation: ${locale}, manual choice, explicit URL, query and fragment`);
  }
  const page = await browser.newPage({locale:'en-US',viewport:{width:1200,height:630},reducedMotion:'reduce'});
  await page.route('https://api.github.com/**', route => route.abort());
  await page.goto(`${base}/`,{waitUntil:'networkidle'});
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),(process.env.ANYWORK_SITE_URL || 'https://anywork-tau.vercel.app') + '/en/');
  assert(await page.locator('#release-status').textContent());
  if (process.env.ANYWORK_SITE_SOCIAL === '1') {
    await page.addStyleTag({content:'.header{height:60px}.hero{padding-block:20px;gap:45px}.manager-scene{padding-top:0}.manager-content{padding:17px 18px 12px}.service-summary{margin-top:16px;padding-block:11px}.manager-section-label{margin-top:15px}.manager-route{padding-block:9px}.manager-address{margin-top:12px}.intro{font-size:17px}.hero h1{font-size:56px}.release-line{margin-bottom:18px}.manager-scene .preview-disclaimer{margin-top:9px}'});
    await page.screenshot({path:'site/assets/social.png'});
  }
  await page.close();
  // Whichever response arrives last, older metadata cannot downgrade downloads.
  for (const delayed of ['baseline', 'live']) {
    const page = await browser.newPage();
    const asset = 'anywork-macos-arm64.dmg';
    const fresh = {tag_name:'v99.0.0', assets:[{name:asset,browser_download_url:`https://github.com/ywateru/AnyWork/releases/download/v99.0.0/${asset}`}]};
    const stale = {tag_name:'v1.0.0', assets:[{name:asset,browser_download_url:`https://github.com/ywateru/AnyWork/releases/download/v1.0.0/${asset}`}]};
    await page.route('**/release.json', async route => {
      if (delayed === 'baseline') await new Promise(resolve => setTimeout(resolve, 200));
      await route.fulfill({json:delayed === 'baseline' ? stale : fresh});
    });
    await page.route('https://api.github.com/**', async route => {
      if (delayed === 'live') await new Promise(resolve => setTimeout(resolve, 200));
      await route.fulfill({json:delayed === 'live' ? stale : fresh});
    });
    await page.goto(`${base}/en/`, {waitUntil:'networkidle'});
    assert((await page.locator(`[data-asset="${asset}"]`).getAttribute('href')).endsWith('/v99.0.0/'+asset));
    assert((await page.locator('#release-status').textContent()).includes('v99.0.0'));
    await page.close();
    console.log(`Passed release ordering: late ${delayed} cannot downgrade downloads`);
  }
  for (const useDmg of [false, true]) {
    const page = await browser.newPage();
    const assets = ['anywork-macos-arm64.zip', 'anywork-macos-x86_64.zip',
      ...(useDmg ? ['anywork-macos-arm64.dmg', 'anywork-macos-x86_64.dmg'] : [])];
    const release = {tag_name:'v99.0.0', assets:assets.map(name => ({name, browser_download_url:`https://github.com/ywateru/AnyWork/releases/download/v99.0.0/${name}`}))};
    await page.route('**/release.json', route => route.fulfill({json:release}));
    await page.route('https://api.github.com/**', route => route.fulfill({json:release}));
    await page.goto(`${base}/en/`, {waitUntil:'networkidle'});
    for (const arch of ['arm64', 'x86_64']) {
      const url = await page.locator(`[data-asset="anywork-macos-${arch}.dmg"]`).getAttribute('href');
      assert(url.endsWith(`/anywork-macos-${arch}.${useDmg ? 'dmg' : 'zip'}`));
    }
    await page.close();
    console.log(`Passed macOS download selection: ${useDmg ? 'DMG preferred over ZIP' : 'legacy ZIP fallback'}`);
  }
  const fallback = await browser.newPage({javaScriptEnabled:false});
  await fallback.goto(`${base}/`);
  assert.equal(await fallback.locator('html').getAttribute('lang'), 'en');
  assert.equal(await fallback.locator('h1').count(),1);
  await fallback.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log('Website checks passed. Screenshots: artifacts/anywork-site-*.png');
