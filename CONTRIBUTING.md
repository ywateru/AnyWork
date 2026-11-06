# Contributing / 参与贡献

Thank you for helping make local agents easier to reach. Start with a reproducible issue or a focused pull request. UI changes should include screenshots made with isolated, fictional fixtures. Never attach access keys, Codex credentials, real chat histories or private workspace paths.

欢迎通过可复现的问题或聚焦的 PR 改进项目。UI 变更请提供使用虚构测试数据制作的截图。不要上传访问密钥、Codex 凭据、真实会话或私有工作目录。

## Development / 开发

Use Node.js 22+, Rust stable, and the Tauri system dependencies. Run `npm ci`, `npm run build:desktop-ui`, and the checks relevant to your change. `./scripts/check.sh` runs the broader isolated integration/browser suite. Android needs JDK 17 and SDK 36. Website changes use `python3 scripts/build-site.py` and `node scripts/site-test.mjs`.

使用 Node.js 22+、Rust stable 与 Tauri 系统依赖。运行 `npm ci`、`npm run build:desktop-ui` 和变更相关检查。完整隔离集成/浏览器检查为 `./scripts/check.sh`。Android 使用 JDK 17、SDK 36。官网使用 `python3 scripts/build-site.py` 和 `node scripts/site-test.mjs` 验证。

Keep English and Chinese user-facing documentation in sync. Describe platform support based on actual tests. Preserve licenses and corresponding-source packaging. Contributions are distributed under this repository's AGPL-3.0-only license.

同步维护中英文用户文档，以实际测试说明平台能力，保留许可证与对应源码打包。贡献内容遵循仓库的 AGPL-3.0-only 许可证。
