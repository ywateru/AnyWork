# AnyWork logo / 产品标志

The canonical logo is [`web/public/icon.svg`](../web/public/icon.svg): a dark rounded hexagon with two white ring eyes, redrawn as vector paths and gradients. Its 1024 × 1024 viewBox has a transparent background. It contains no embedded bitmap or external assets.

主图标为 [`web/public/icon.svg`](../web/public/icon.svg)，以矢量路径和渐变绘制深色圆角六边形与双圆环眼睛。画布为 1024 × 1024，背景透明，不包含嵌入位图或外部资源。

Regenerate all platform assets from the repository root / 在仓库根目录重新生成各端资源：

```sh
npm ci
npx playwright install chromium
node scripts/build-icons.mjs
```

To use an installed Chrome instead / 使用已安装的 Chrome：

```sh
PLAYWRIGHT_CHANNEL=chrome node scripts/build-icons.mjs
```

The generator writes Web/PWA PNGs, the 1024px desktop PNG, multi-resolution macOS ICNS and Windows ICO, website SVG and Android VectorDrawable. The Web client and desktop manager use the canonical SVG directly. Both macOS packaging paths use the generated ICNS directly. Keep edits in the canonical SVG and regenerate derived files together.

生成器同步输出 Web/PWA PNG、1024px 桌面 PNG、多尺寸 macOS ICNS 和 Windows ICO、官网 SVG 和 Android 矢量图标。Web 界面与桌面管理器直接使用主 SVG，两种 macOS 打包方式直接使用生成的 ICNS。修改时只编辑主 SVG，再一起生成派生资源。

The website social image is refreshed with / 官网分享图片通过以下命令更新：

```sh
python3 scripts/build-site.py
PLAYWRIGHT_CHANNEL=chrome ANYWORK_SITE_SOCIAL=1 node scripts/site-test.mjs
```
