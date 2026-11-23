# EasyTier browser runtime notice

`easytier-browser.js` is generated from EasyTier `v2.7.1`, commit
`0d9c52b169dc2112687ddefcf571cd01d383193c`.

- Upstream: <https://github.com/EasyTier/EasyTier>
- JavaScript packages: `@easytier/browser` 0.1.0 and `@easytier/runtime`
  0.1.0, published by the project under Apache-2.0 terms.
- EasyTier core: the embedded `easytier_core.wasm` is built from the EasyTier
  Rust core and is distributed under LGPL-3.0. The corresponding source is the
  pinned upstream commit above. Rebuilding instructions are in
  `scripts/build-easytier-browser.sh`.
- Build transform: upstream `dist/index.js` is bundled with
  `@easytier/runtime` by esbuild 0.28.2, minified, with the WASM artifact kept
  embedded. No EasyTier source is modified.

The complete license texts are shipped in `licenses/easytier-LGPL-3.0.txt` and
`licenses/easytier-js-Apache-2.0.txt` and in the Web third-party notices.
The exact EasyTier source is included in
`artifacts/corresponding-source.tar.gz`; the public site exposes it at
`/corresponding-source`.
