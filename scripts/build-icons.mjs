// Regenerate checked-in platform icons from the original AnyWork SVG.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const svg = await readFile('web/public/icon.svg','utf8');
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {});
try {
  const images = new Map();
  for (const size of [16,24,32,48,64,128,192,256,512]) {
    const page = await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    images.set(size,await page.screenshot({omitBackground:true}));
    await page.close();
  }
  await writeFile('web/public/icon-192.png',images.get(192));
  await writeFile('web/public/icon-512.png',images.get(512));
  await writeFile('desktop/icon.png',images.get(512));
  const sizes = [16,24,32,48,64,128,256];
  const header = Buffer.alloc(6+16*sizes.length);
  header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
  let offset=header.length;
  for(const [index,size] of sizes.entries()) {
    const start=6+16*index, png=images.get(size);
    header[start]=header[start+1]=size===256?0:size;
    header.writeUInt16LE(1,start+4);header.writeUInt16LE(32,start+6);
    header.writeUInt32LE(png.length,start+8);header.writeUInt32LE(offset,start+12);
    offset+=png.length;
  }
  await writeFile('desktop/icon.ico',Buffer.concat([header,...sizes.map(size=>images.get(size))]));
  await writeFile('site/assets/mark.svg',svg);
} finally {await browser.close();}
console.log('Generated Web, desktop and Windows icons from web/public/icon.svg');
