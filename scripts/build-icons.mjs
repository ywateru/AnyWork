// web/public/icon.svg is the single source for every platform's product mark.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const svg = await readFile('web/public/icon.svg','utf8');
function escapeXML(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
}
function androidColor(color, opacity = 1) {
  if (color === 'none') return '#00000000';
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Unsupported SVG color: ${color}`);
  return `#${Math.round(Number(opacity) * 255).toString(16).padStart(2,'0')}${color.slice(1)}`;
}
function androidGradient(gradient, paint) {
  if (gradient.units !== 'userSpaceOnUse') throw new Error('Use explicit coordinates for cross-platform gradients');
  const coordinates = gradient.type === 'linearGradient'
    ? `android:type="linear" android:startX="${gradient.x1}" android:startY="${gradient.y1}" android:endX="${gradient.x2}" android:endY="${gradient.y2}"`
    : `android:type="radial" android:centerX="${gradient.cx}" android:centerY="${gradient.cy}" android:gradientRadius="${gradient.r}"`;
  return `    <aapt:attr name="android:${paint}Color">\n      <gradient ${coordinates}>\n${gradient.stops.map(stop => `        <item android:offset="${stop.offset}" android:color="${androidColor(stop.color, stop.opacity)}"/>`).join('\n')}\n      </gradient>\n    </aapt:attr>`;
}
function androidVector(source) {
  const paths = source.shapes.map(shape => {
    const attrs = [`android:pathData="${escapeXML(shape.d)}"`];
    const children = [];
    for (const paint of ['fill','stroke']) {
      const value = shape[paint] || 'none';
      const gradient = /^url\(#(.+)\)$/.exec(value);
      if (gradient) children.push(androidGradient(source.gradients[gradient[1]], paint));
      else attrs.push(`android:${paint}Color="${androidColor(value)}"`);
      if (shape[`${paint}-opacity`]) attrs.push(`android:${paint}Alpha="${shape[`${paint}-opacity`]}"`);
    }
    for (const [svgName, androidName] of [['stroke-width','strokeWidth'],['stroke-linejoin','strokeLineJoin']]) {
      if (shape[svgName]) attrs.push(`android:${androidName}="${shape[svgName]}"`);
    }
    return children.length ? `  <path ${attrs.join(' ')}>\n${children.join('\n')}\n  </path>` : `  <path ${attrs.join(' ')}/>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated from web/public/icon.svg by scripts/build-icons.mjs. -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" android:width="108dp" android:height="108dp" android:viewportWidth="${source.width}" android:viewportHeight="${source.height}">\n${paths.join('\n')}\n</vector>\n`;
}
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {});
try {
  const images = new Map();
  let vector;
  for (const size of [16,24,32,48,64,128,192,256,512,1024]) {
    const page = await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    if (!vector) vector = await page.evaluate(() => {
      const root = document.querySelector('svg');
      const gradients = Object.fromEntries([...root.querySelectorAll('linearGradient,radialGradient')].map(node => [node.id, {
        type:node.localName, units:node.getAttribute('gradientUnits'),
        ...Object.fromEntries(['x1','y1','x2','y2','cx','cy','r'].map(name=>[name,node.getAttribute(name)])),
        stops:[...node.querySelectorAll('stop')].map(stop=>({offset:stop.getAttribute('offset')||'0',color:stop.getAttribute('stop-color'),opacity:stop.getAttribute('stop-opacity')||1}))
      }]));
      const shapes = [...root.children].filter(node=>['path','circle'].includes(node.localName)).map(node=>{
        let d = node.getAttribute('d');
        if (node.localName === 'circle') {
          const [cx,cy,r] = ['cx','cy','r'].map(name=>Number(node.getAttribute(name)));
          d = `M${cx-r},${cy}a${r},${r} 0,1 0 ${2*r},0a${r},${r} 0,1 0 ${-2*r},0`;
        }
        return {d,...Object.fromEntries(['fill','stroke','fill-opacity','stroke-opacity','stroke-width','stroke-linejoin'].map(name=>[name,node.getAttribute(name)]))};
      });
      return {width:root.viewBox.baseVal.width,height:root.viewBox.baseVal.height,gradients,shapes};
    });
    images.set(size,await page.screenshot({omitBackground:true}));
    await page.close();
  }
  await writeFile('web/public/icon-192.png',images.get(192));
  await writeFile('web/public/icon-512.png',images.get(512));
  await writeFile('desktop/icon.png',images.get(1024));
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
  await writeFile('android/app/src/main/res/drawable/ic_launcher.xml',androidVector(vector));
} finally {await browser.close();}
console.log('Generated Web, macOS, Windows, Android and website icons from web/public/icon.svg');
