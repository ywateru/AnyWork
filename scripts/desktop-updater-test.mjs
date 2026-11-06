// Isolated UI verification: fake Tauri IPC only; never downloads or installs a real update.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve('desktop/ui/dist');
const server = http.createServer(async (request, response) => {
  const file = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const target = (await fs.stat(file)).isDirectory() ? path.join(file,'index.html') : file;
    const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.otf':'font/otf' };
    response.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
    response.end(await fs.readFile(target));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, args:['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport:{width:960,height:720} });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.updateCalls = [];
    window.updateFixture = {currentVersion:'0.1.1',version:'',notes:'',phase:'idle',downloaded:0,total:null,lastChecked:null,error:'',enabled:true,showNotice:false,supported:true};
    window.__TAURI__ = { core:{ invoke:async (command,args) => {
      if (!['desktop_snapshot','desktop_update_snapshot'].includes(command)) window.updateCalls.push({command,args});
      const s = window.updateFixture;
      if (command === 'desktop_update_snapshot') return {...s};
      if (command === 'desktop_update_preferences') { s.enabled = args.enabled; return {...s}; }
      if (command === 'desktop_update_defer') { s.showNotice = false; return {...s}; }
      if (command === 'desktop_update_check') { s.lastChecked = Math.floor(Date.now()/1000); return {...s}; }
      if (command === 'desktop_update_install') { if (args.version !== s.version) throw new Error('Version changed'); s.phase='installing'; s.showNotice=false; return null; }
      if (command === 'desktop_snapshot') return {
        config:{workspace:'/fixture',dataDirectory:'/fixture/data',port:3210,allowLAN:false,serverBinary:'',cloudflaredBinary:'',tunwgBinary:'',publicURL:'',relayDomain:'',forceRelay:false,welcomed:true},
        token:'isolated-desktop-test-token',secrets:['','',''],secrets_loaded:true,service:'off',owned:false,external:false,authorized:false,clients:[],routes:[0,1,2].map(()=>({phase:'off',url:'',error:''})),error:'',notice:''};
      if (command === 'desktop_preview') return null;
      return null;
    } } };
  });
  const { expect } = await import('@playwright/test');
  await page.goto(origin + '/');
  await expect(page.locator('.network-map')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => Object.assign(window.updateFixture,{phase:'downloading',version:'0.1.2',downloaded:1048576,total:2097152}));
  await expect(page.locator('.update-notice')).toHaveCount(0);
  await page.getByLabel('软件更新',{exact:true}).click();
  await expect(page.getByText('正在后台下载 0.1.2',{exact:true})).toBeVisible();
  await expect(page.getByLabel('更新下载进度')).toHaveAttribute('value','1048576');
  await page.evaluate(() => Object.assign(window.updateFixture,{phase:'error',error:'Offline fixture'}));
  await expect(page.getByRole('alert')).toHaveText('Offline fixture');
  await page.getByRole('button',{name:'总览',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => Object.assign(window.updateFixture,{phase:'ready',error:'',version:'0.1.2',notes:'Fixture release notes',showNotice:true}));
  await expect(page.locator('.update-notice')).toContainText('新版本 0.1.2 已准备好');
  await page.getByRole('button',{name:'稍后提醒',exact:true}).click();
  await expect(page.locator('.update-notice')).toHaveCount(0);
  await page.getByLabel('软件更新',{exact:true}).click();
  await expect(page.getByRole('button',{name:'更新并重启',exact:true})).toBeVisible();
  await page.getByRole('switch',{name:'自动检查并后台下载'}).click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked','false');
  await page.getByRole('button',{name:'更新并重启',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'更新到 0.1.2？'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'稍后',exact:true})).toBeFocused();
  assert.equal(await page.evaluate(() => window.updateCalls.filter(c=>c.command==='desktop_update_install').length),0);
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button',{name:'更新并重启',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'更新并重启',exact:true}).click();
  await page.evaluate(() => Object.assign(window.updateFixture,{version:'0.1.3'}));
  await expect(dialog.getByRole('button',{name:'确认更新',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'稍后',exact:true}).click();
  await page.getByRole('button',{name:'更新并重启',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'更新到 0.1.3？'})).toBeVisible();
  await page.getByRole('button',{name:'确认更新',exact:true}).click();
  await expect(page.getByText('正在更新 AnyWork',{exact:true})).toBeVisible();
  const installs = await page.evaluate(() => window.updateCalls.filter(c=>c.command==='desktop_update_install'));
  assert.deepEqual(installs,[{command:'desktop_update_install',args:{version:'0.1.3'}}]);
  assert.deepEqual(errors,[]);
  await page.evaluate(() => Object.assign(window.updateFixture,{phase:'ready',version:'0.1.3',showNotice:true}));
  await expect(page.getByRole('button',{name:'确认更新',exact:true})).toBeEnabled();
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await fs.mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/desktop-update-ready.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('Desktop updater UI passed: quiet download/failure, deferral, preferences, confirmation, stale-version rejection, and explicit install.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
