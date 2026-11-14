import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
execFileSync('python3', ['scripts/build-site-test.py'], {stdio:'inherit'});
const androidAPKs = ['arm64', 'armv7', 'x86', 'x86_64'].map(abi => `anywork-android-${abi}.apk`);
function withAndroid(release) {
  const names = release.tag_name === 'v0.1.34' ? ['anywork-android.apk'] : androidAPKs;
  return {...release, assets:[...release.assets, ...names.map(name => ({name, size:10485760, browser_download_url:`https://github.com/ywateru/AnyWork/releases/download/${release.tag_name}/${name}`}))]};
}
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
    const release = withAndroid({tag_name:'v99.0.0',assets:[{name:asset,size:104857600,browser_download_url:`https://github.com/ywateru/AnyWork/releases/download/v99.0.0/${asset}`}]});
    await page.route('https://api.github.com/**', route => route.fulfill({json:release}));
    await page.goto(`${base}/${locale}/`, {waitUntil:'networkidle'});
    assert.equal(await page.locator('html').getAttribute('lang'),locale==='zh'?'zh-CN':'en');
    assert(await page.title());
    assert.equal(await page.locator('h1').count(),1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${locale}/${width}: horizontal overflow`);
    assert((await page.locator(`[data-asset="${asset}"]`).getAttribute('href')).endsWith('/v99.0.0/'+asset));
    const android = page.locator('a[data-asset^="anywork-android"]');
    assert.deepEqual(await android.evaluateAll(links => links.map(link => link.dataset.asset)), androidAPKs);
    assert((await android.first().innerText()).includes(locale === 'zh' ? '推荐' : 'Recommended'));
    for (const name of androidAPKs) assert((await page.locator(`[data-asset="${name}"]`).getAttribute('href')).endsWith('/v99.0.0/'+name));
    assert.equal(await page.locator('.small-cta').getAttribute('href'), '/app/');
    assert.equal(await page.locator('.hero-actions .primary').getAttribute('href'), '/app/?signup=1');
    assert(await page.locator('.device-preview').isVisible());
    assert.equal(await page.locator('.site-device').count(), 2);
    assert.equal(await page.locator('[data-route]').count(), 0);
    const backends = ['codex', 'claude-code', 'claude-desktop', 'deepseek-harness', 'workbuddy'];
    assert.deepEqual(await page.locator('#agents [data-backend]').evaluateAll(nodes => nodes.map(node => node.dataset.backend)), backends);
    assert.equal(await page.locator('#agents [data-backend] h3').allTextContents().then(names => names.join('|')), 'Codex|Claude Code CLI|Claude Desktop Code|DeepSeek Harness|WorkBuddy');
    assert(await page.locator('[data-backend="claude-desktop"]').innerText().then(text => text.includes(locale === 'zh' ? '本地 Code' : 'Local Code') && text.includes(locale === 'zh' ? '仍待验收' : 'still pending')));
    const desktopScope = await page.locator('[data-backend="claude-desktop"]').innerText();
    assert(desktopScope.includes(locale === 'zh' ? '组织政策允许的有效原生桥' : 'valid native bridge allowed by organization policy'));
    assert(desktopScope.includes(locale === 'zh' ? '不能自行开启受厂商签名限制的 CDP' : 'cannot enable signature-gated CDP'));
    assert(!desktopScope.includes(locale === 'zh' ? '连接引导启动桌面' : 'started through the AnyWork connection launcher'));
    assert(await page.locator('[data-backend="workbuddy"]').innerText().then(text => text.includes(locale === 'zh' ? '实验' : 'experimental')));
    const install = await page.locator('.agents-install').innerText();
    assert(install.includes(locale === 'zh' ? '会话列表独立' : 'its own session list'));
    assert(install.includes('claude --version'));
    assert(install.includes('claude --desktop'));
    assert.equal(await page.locator('.agents-install a').count(), 2);
    const guide = page.locator('#agents > .agents-links a').first();
    const guideFile = locale === 'zh' ? 'getting-started.zh-CN.md' : 'getting-started.md';
    const guideUrl = new URL(await guide.getAttribute('href'));
    assert(guideUrl.pathname.endsWith('/docs/' + guideFile));
    assert.equal(decodeURIComponent(guideUrl.hash), locale === 'zh' ? '#选择后端-agent' : '#choose-a-backend-agent');
    const guideSource = await readFile(path.resolve('docs', guideFile), 'utf8');
    assert(guideSource.includes(locale === 'zh' ? '## 选择后端 Agent' : '## Choose a backend agent'));
    assert((await page.locator('#agents > .agents-links a').last().getAttribute('href')).endsWith('/docs/support-matrix.md'));
    await guide.focus();
    assert.equal(await guide.evaluate(node => node === document.activeElement), true);
    assert(await page.locator('#agents').evaluate(node => {
      const how = document.querySelector('.how-section');
      const workspace = document.querySelector('#workspace');
      return !!(how.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(node.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
    const updateNote = await page.locator('.download-update-note').innerText();
    assert(updateNote.includes(locale === 'zh' ? '最新桌面版' : 'latest desktop version'));
    assert(updateNote.includes(locale === 'zh' ? '登录并准备工作区' : 'sign in and prepare the workspace'));
    assert(updateNote.includes(locale === 'zh' ? '默认开启远程访问' : 'remote access turns on by default'));
    assert(updateNote.includes(locale === 'zh' ? '可随时关闭' : 'can be turned off anytime'));
    assert(updateNote.includes(locale === 'zh' ? '活动加密连接' : 'active encrypted connections'));
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
    await page.evaluate(() => document.activeElement?.blur());
    await page.locator('#agents').screenshot({path:`artifacts/anywork-site-agents-${locale}-${width}.png`});
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
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),(process.env.ANYWORK_SITE_URL || 'https://anywork.aixgg.com') + '/en/');
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
    const fresh = withAndroid({tag_name:'v99.0.0', assets:[{name:asset,browser_download_url:`https://github.com/ywateru/AnyWork/releases/download/v99.0.0/${asset}`}]});
    const stale = withAndroid({tag_name:'v1.0.0', assets:[{name:asset,browser_download_url:`https://github.com/ywateru/AnyWork/releases/download/v1.0.0/${asset}`}]});
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
    const release = withAndroid({tag_name:'v99.0.0', assets:assets.map(name => ({name, browser_download_url:`https://github.com/ywateru/AnyWork/releases/download/v99.0.0/${name}`}))});
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
  // Use actual build-site output as the baseline, including no-JavaScript pages.
  const staticHTML = (release, locale) => execFileSync('python3', ['-c', `
import contextlib, importlib, io, json, pathlib, sys, tempfile
from unittest import mock
sys.path.insert(0, 'scripts')
builder = importlib.import_module('build-site')
data = json.load(sys.stdin)
with tempfile.TemporaryDirectory() as folder:
    dist = pathlib.Path(folder) / 'dist'
    with mock.patch.object(builder, 'DIST', dist), mock.patch.object(builder.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(data['release']).encode())), mock.patch('sys.argv', ['build-site.py', '--fetch-release']), contextlib.redirect_stdout(io.StringIO()):
        builder.main()
    print((dist / data['locale'] / 'index.html').read_text())
`], {input:JSON.stringify({release, locale}), encoding:'utf8'});
  const oldAndroid = withAndroid({tag_name:'v0.1.34', assets:[]});
  const newAndroid = withAndroid({tag_name:'v0.1.35', assets:[]});
  const checkAndroid = async (page, tag, names) => {
    assert.deepEqual(await page.locator('a[data-asset^="anywork-android"]').evaluateAll(links => links.map(link => link.dataset.asset)), names);
    for (const name of names) assert.equal(await page.locator(`[data-asset="${name}"]`).getAttribute('href'), `https://github.com/ywateru/AnyWork/releases/download/${tag}/${name}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Android ABI buttons overflow');
  };
  for (const locale of ['en','zh']) {
    const oldHTML = staticHTML(oldAndroid, locale);
    const newHTML = staticHTML(newAndroid, locale);
    for (const [release, html, names] of [[oldAndroid, oldHTML, ['anywork-android.apk']], [newAndroid, newHTML, androidAPKs]]) {
      const page = await browser.newPage({javaScriptEnabled:false, viewport:{width:320,height:900}});
      await page.route(`**/${locale}/`, route => route.fulfill({body:html, contentType:'text/html'}));
      await page.goto(`${base}/${locale}/`);
      await checkAndroid(page, release.tag_name, names);
      await page.close();
    }
    for (const delayed of ['baseline', 'live']) {
      const page = await browser.newPage({viewport:{width:320,height:900}});
      await page.route(`**/${locale}/`, route => route.fulfill({body:oldHTML, contentType:'text/html'}));
      await page.route('**/release.json', async route => {
        if (delayed === 'baseline') await new Promise(resolve => setTimeout(resolve, 200));
        await route.fulfill({json:delayed === 'baseline' ? oldAndroid : newAndroid});
      });
      await page.route('https://api.github.com/**', async route => {
        if (delayed === 'live') await new Promise(resolve => setTimeout(resolve, 200));
        await route.fulfill({json:delayed === 'live' ? oldAndroid : newAndroid});
      });
      await page.goto(`${base}/${locale}/`, {waitUntil:'networkidle'});
      await checkAndroid(page, 'v0.1.35', androidAPKs);
      assert((await page.locator('#release-status').innerText()).includes('v0.1.35'));
      await page.close();
    }
    for (const damage of ['missing', 'mixed', 'duplicate', 'wrong-url', 'older']) {
      let invalid = withAndroid({tag_name:'v0.1.36', assets:[]});
      if (damage === 'missing') invalid.assets.pop();
      if (damage === 'mixed') invalid.assets.push(oldAndroid.assets[0]);
      if (damage === 'duplicate') invalid.assets[3] = invalid.assets[0];
      if (damage === 'wrong-url') invalid.assets[0].browser_download_url = oldAndroid.assets[0].browser_download_url;
      if (damage === 'older') invalid = oldAndroid;
      const page = await browser.newPage();
      await page.route(`**/${locale}/`, route => route.fulfill({body:newHTML, contentType:'text/html'}));
      await page.route('**/release.json', route => route.fulfill({json:invalid}));
      await page.route('https://api.github.com/**', route => route.fulfill({json:invalid}));
      await page.goto(`${base}/${locale}/`, {waitUntil:'networkidle'});
      await checkAndroid(page, 'v0.1.35', androidAPKs);
      assert((await page.locator('#release-status').innerText()).includes('v0.1.35'));
      await page.close();
    }
    // When only an old release exists, a live refresh must show one universal link.
    const legacy = await browser.newPage();
    await legacy.route('**/release.json', route => route.fulfill({json:oldAndroid}));
    await legacy.route('https://api.github.com/**', route => route.fulfill({json:oldAndroid}));
    await legacy.goto(`${base}/${locale}/`, {waitUntil:'networkidle'});
    await checkAndroid(legacy, 'v0.1.34', ['anywork-android.apk']);
    await legacy.close();
    console.log(`Passed ${locale} Android downloads: static/no-JS, legacy, split, both response orders, malformed and stale metadata`);
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
