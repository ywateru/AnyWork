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
    const asset = 'anywork-macos-arm64.zip';
    const release = {tag_name:'v0.1.0',assets:[{name:asset,size:104857600,browser_download_url:`https://github.com/ywateru/AnyWork/releases/download/v0.1.0/${asset}`}]};
    await page.route('https://api.github.com/**', route => route.fulfill({json:release}));
    await page.goto(`${base}/${locale}/`, {waitUntil:'networkidle'});
    assert.equal(await page.locator('html').getAttribute('lang'),locale==='zh'?'zh-CN':'en');
    assert(await page.title());
    assert.equal(await page.locator('h1').count(),1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${locale}/${width}: horizontal overflow`);
    assert((await page.locator(`[data-asset="${asset}"]`).getAttribute('href')).endsWith('/v0.1.0/'+asset));
    // Both connection switches are independent, work from the keyboard, and
    // only change the explicitly labelled product illustration.
    const quick = page.locator('[data-demo-switch="quick"]');
    const vpn = page.locator('[data-demo-switch="vpn"]');
    await quick.click();
    assert.equal(await quick.getAttribute('aria-checked'), 'false');
    assert.equal(await vpn.getAttribute('aria-checked'), 'false');
    await vpn.focus();
    await vpn.press('Space');
    assert.equal(await vpn.getAttribute('aria-checked'), 'true');
    assert.equal(await quick.getAttribute('aria-checked'), 'false');
    await quick.press('Enter');
    assert.equal(await quick.getAttribute('aria-checked'), 'true');
    assert.equal(await vpn.getAttribute('aria-checked'), 'true');
    await vpn.click();
    await page.locator('#tab-changes').click();
    assert(await page.locator('#panel-changes').isVisible());
    assert(!(await page.locator('#panel-chat').isVisible()));
    await page.locator('#tab-changes').press('ArrowRight');
    assert(await page.locator('#panel-terminal').isVisible());
    await page.locator('#tab-terminal').press('Home');
    assert(await page.locator('#panel-chat').isVisible());
    await page.locator('#route-tunnel').click();
    assert(await page.locator('#route-panel-tunnel').isVisible());
    assert.equal(await page.locator('.network-route-label').textContent(),'HTTPS');
    await page.locator('#route-tunnel').press('ArrowRight');
    assert(await page.locator('#route-panel-vpn').isVisible());
    await page.locator('#route-vpn').press('Home');
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
  const page = await browser.newPage({viewport:{width:1200,height:630},reducedMotion:'reduce'});
  await page.route('https://api.github.com/**', route => route.abort());
  await page.goto(`${base}/`,{waitUntil:'networkidle'});
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://ywateru.github.io/AnyWork/');
  assert(await page.locator('#release-status').textContent());
  if (process.env.ANYWORK_SITE_SOCIAL === '1') await page.screenshot({path:'site/assets/social.png'});
  await page.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log('Website checks passed. Screenshots: artifacts/anywork-site-*.png');
