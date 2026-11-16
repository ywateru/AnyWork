# 工作区 HTML / SW 缓存：作者实现记录

2026-11-16。角色为本项实现者，不作独立接受结论；待另一reviewer验收。工作树 `.worktrees/workspace-static-cache`，分支 `codex/workspace-static-cache`，基线 `94a2076f2948c00752daf452128eb071f8f8d97f`。遵循[恢复任务](../tasks/desktop-mobile-session-recovery.md)；缓存契约补充在[更新与离线shell说明](../../session-sync-research.md)。

## 改动及边界

- Rust静态fallback提取到 `web_assets`，HTML响应和 `sw.js` 均带 `Cache-Control: no-store`，包括不存在旧模块时返回的404 HTML。可识别的文档/worker请求移除旧条件验证头，以当前正文代替304；未知路径的HTML响应也禁用存储。API、WebSocket、source route仍在该层之外；哈希资源维持既有响应头与条件请求处理。
- 生成SW的在线navigation及直接HTML读取显式 `fetch(request, {cache: 'no-store'})`；安装shell的请求同样显式绕过HTTP缓存。网络错误仍读取激活worker自己的版本化index和资源，不往旧shell写入网络新版HTML。注册使用 `updateViaCache: 'none'`，不依赖SW脚本的HTTP缓存判断更新。
- 未修改桌面已接受的fresh-query guard、API数据策略、可选语法资源的按需缓存、用户确认更新流程或既有旧shell清理规则。没有新增自动激活/重载、ticket请求/重放、浏览器缓存清理、账号或草稿迁移。未修改MobileApp、Native、移动端E2E文件或持久登录实现。

## 作者针对性验证

| 验证 | 结果与范围 |
| --- | --- |
| `cargo test --locked --offline -p anywork web_assets::tests -- --nocapture` | 最终2/2通过。真实随机loopback HTTP，覆盖根文档、公开query、index、worker、SPA fallback、缺失旧模块404/HTML和HEAD；文档条件请求仍返回正文/no-store，哈希JS保留304，API/source不带新增缓存策略。最初测试用手写远未来日期导致资产条件请求断言失败，改为读取实际Last-Modified再回传，避免日期解析和时间假设；生产策略未为通过测试而放宽。 |
| `cargo clippy --locked --offline -p anywork --all-targets -- -D warnings` | 通过。共享root target，jobs=2、debug=0、incremental关闭；与其他lane协调占用，没有Native/Android构建。 |
| Web TypeScript检查、Vite生产构建、PWA生成 | 通过。复用root node_modules链接，Vite使用runner配置加载，未安装/复制依赖。 |
| `PLAYWRIGHT_CHANNEL=chrome … playwright test e2e/pwa.spec.ts e2e/pwa-cache.spec.ts` | 桌面与Android网页仿真共4/4通过。原测试仍覆盖非阻塞更新、“稍后”跨刷新保留、同版本不提醒、用户点击才激活；新增断言注册updateViaCache为none。 |
| 新缓存浏览器回归 | 私有HTTP三代资源、显式长max-age HTML、真实隔离Chromium；先缓存v1、移除旧模块得到404/HTML及空root；v2安装后离线完整渲染v2；仍由v2 worker控制时，在线导航取得v3；再次离线仍读取完整v2 shell。草稿标记不变，API两次实际请求、无API CacheStorage条目，HTTP无合成ticket fragment。 |
| 导航旧策略负对照 | 仅在ignored私有生成器把导航fetch改回默认 `fetch(request)`，复用同一新测试。按预期在在线v3断言失败：预期version-3，实际root为空。未修改生产文件作负例，临时负例spec已删除。证明测试能捕获HTTP旧文档复用。 |
| Rustfmt、定向Prettier、diff检查 | 通过。 |

新Rust测试随现有workspace测试执行；新PWA测试由既有 `npm run test:e2e` 自动发现，不新增只在本机执行的门禁。现有CI已安装Playwright Chromium；本机使用已安装Chrome，无下载浏览器。`android-web`仅网页尺寸/触控仿真，不是Android系统或设备验收。

HTTP单元测试直接启动最终静态router；浏览器测试使用最终生成SW和本WT生产Web资产，既有PWA测试的公共E2E宿主使用root保留binary并仅加载隔离临时数据。因此不把浏览器通过称为“新完整server二进制部署通过”。未运行全量check.sh、完整workspace测试、正式构建、生产部署或用户现场修复验收；现场旧缓存具体形成机制仍不是本夹具捕获的304实录。既有长期运行服务可能仍采用旧头部，本项不会自动升级或清空它的客户端缓存，已接受的桌面新query仍负责显式打开时的兼容保护。

## 资源与交付

所有HTTP服务、浏览器上下文及E2E宿主均为任务私有，测试结束已退出。未操作真实服务/浏览器标签、用户账号/凭据、ADB/模拟器或Agent；没有生产网络改动。测试只用合成草稿、ticket字符串及临时目录。自建共享依赖链接和Web dist在收尾移除；不删root依赖、共享target或他人产物。保留ignored小证据 `artifacts/workspace-static-cache/browser-verdict.json` 及负例生成器，未保留真实业务正文。源码提交后交独立reviewer，不由作者自验收。
