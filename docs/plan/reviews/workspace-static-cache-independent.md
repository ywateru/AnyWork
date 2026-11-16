# 工作区 HTML / SW 缓存独立审查

2026-11-16。结论：**PASS，源码可合并；无 P1/P2 阻断，保留一项非阻断 P3**。本审查者未参与 static-cache 实现。审查精确候选 `e420d1a0d90ffe3aa56cdae437d19f769b2359c8`，基线 `94a2076f2948c00752daf452128eb071f8f8d97f`，候选 tree `47bf687f6d5a1a0c4bf60eb943ac87a5cc83e0f0`。现有 reviewer worktree 切到独立分支 `codex/workspace-static-cache-review`；未合入未提交实现，未修改产品源码。

## 结论与调用边界

- `main.rs` 仅替换静态 fallback；已注册的 API、WebSocket、`/source` 不经过新增 middleware。正常 HTML 导航、根路径、公开 query、index 和 worker 去除旧文档 validators，返回当前字节及 `Cache-Control: no-store`。普通哈希资源保留原条件请求与 304。这里没有新增服务认证、账号持久化或重新消费 ticket 的路径。
- 生成 SW 的安装请求及在线 navigation/direct HTML 均显式 `cache: no-store`。在线新 HTML 不写回旧版本离线 shell；网络失败仅查询激活 worker 自身的 CACHE。真实浏览器验证了旧 HTTP 文档引用已删除 chunk 导致空 root 的负例，以及修正后的在线/离线行为。
- `updateViaCache: none` 使注册更新检查绕过 HTTP 缓存；既有版本比对、稍后跨刷新保留、用户点击 Reload 才激活的门槛保持有效，没有新增自动重载、清空全部缓存或 local-ticket 重放。
- 这是精确源码与隔离夹具验收。没有操作用户浏览器、真实服务、账号、设备或生产环境，也不把现场历史白屏的具体缓存形成机制称为已捕获实录。长期运行旧服务仍须由独立的 fresh-query/正常升级路径处理。

## 独立执行与证据

复用 root node_modules，未安装依赖；Web 构建写入私有目录，不使用共享 dist。Rust 测试直接从该提交的 `web_assets.rs` 编译独立 harness，使用已有 dependency rlib，产出私有 binary 后执行；没有依赖可能被其他 lane 覆盖的共享 server binary 验收缓存 middleware。

| 检查                                                                                                                   | 独立结果                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node node_modules/typescript/bin/tsc --noEmit -p web/tsconfig.json`                                                   | PASS                                                                                                                                                                                                                 |
| 在 web 下 `vite build --configLoader runner --outDir <private>/dist`，再执行 `node web/scripts/pwa.mjs <private>/dist` | PASS；真实生产 Web 与生成 SW，28 shell / 392 on-demand assets                                                                                                                                                        |
| 直接编译精确 `web_assets.rs`，执行 `web_assets::tests`                                                                 | **2/2 PASS**；随机 loopback 实际 HTTP，根文档/query/index/worker/HEAD/SPA fallback、旧模块 404 HTML、哈希 304/API/source 边界                                                                                        |
| 私有 HTTP probe                                                                                                        | 18 组真实请求；两种 Accept、旧 Last-Modified 与 If-None-Match，核对当前正文/头部/状态，补查编码路径、子目录 index 和缺失资源。结果见下方 P3                                                                          |
| `pwa.spec.ts`、`pwa-cache.spec.ts`、workspace 的 offline shell 用例、account-unified 的单次 ticket 用例                | 桌面与 android-web 共 **8/8 PASS**；通过同一私有配置选择精确现有用例，未改断言                                                                                                                                       |
| 私有补充 cache 用例                                                                                                    | 桌面与 android-web 共 **2/2 PASS**；安装前在另一个不被清理的 CacheStorage 放入同 URL 的毒化 HTML，离线仍读取当前版本 shell；在线直接 `fetch('/index.html')` 绕过仍 fresh 的旧 HTTP HTML 得到 v3；再次离线仍为完整 v2 |
| 私有补充真实 App ticket 用例                                                                                           | 桌面与 android-web 共 **2/2 PASS**；合成本机 ticket 成功消费后 fragment 清除，激活 SW、刷新、离线刷新、恢复在线再刷新，浏览器 `/api/local/session` POST 总数始终为 1；合成草稿标记保留，旧 ticket 显式请求仍 401     |
| `git diff --check`、报告定向格式检查                                                                                   | PASS                                                                                                                                                                                                                 |

浏览器均使用已安装 Chrome 的全新隔离上下文；android-web 是网页仿真，不是 Android 系统验收。现有与补充 ticket/offline App 测试的 API 宿主为预先复制到私有路径的 root fixture server，SHA256 `4a3f725939bae2bed338ade1e83e59306d3a2602232a157d49e05ef8a38dfe7a`，仅用于临时合成 workspace/API；不声称它是该候选的完整 server 构建。候选静态 router 已通过独立精确源码 HTTP harness 验证。没有重复完整 Rust/clippy/全站门禁；作者记录的 strict clippy 不列为本审查者执行。

私有证据位于 root `artifacts/workspace-static-cache-independent/`：`binding.json`、`exact-http-tests.log`、`http-probe.json`、`browser-results.json`、`independent-browser-results.json`，以及补充测试与配置。构建绑定：

| 对象                                     | SHA256                                                             |
| ---------------------------------------- | ------------------------------------------------------------------ |
| 精确源码 HTTP test binary                | `dfca0c1820f4b691348e6a73eb5adf08abf7b04a3815bc619ec3b404ff649280` |
| 独立 HTTP probe binary                   | `3e3d3a13b726588da7d3921fa7a41da27110dee5c58a682b58254be93da244e6` |
| 生产 index.html                          | `601070bc374830e49df53608e995448a539ac0d8d7f359024c167ba9d3b41d9c` |
| 生成 sw.js（`anywork-1a294cf85de0b2cf`） | `740af1b929383a8b9d0b39f477a42e9e9c9bcc0622cbd0bd07cd207ace4dc035` |
| index-M41SIiqE.js                        | `9813be3f0071378d29c8cd82441131cdfd465033765dfc118323a6fc7e3f9710` |
| index-Blds00Ca.css                       | `9b59bdc76401b2978f21e9bca110bfbc67fded44c1a36b6793c350ab034462ca` |

## 非阻断发现

**P3 / non-blocking：非标准 HTML 别名的非导航条件请求仍可返回无 no-store 的 304。** 位置：`crates/server/src/web_assets.rs:24` 的路径识别及 43 行的响应 Content-Type 兜底。

复现：隔离目录放入 `index.html` 及 `nested/index.html`；先 GET `/index%2ehtml` 或 `/nested/`，保存 Last-Modified，再以 `Accept: */*` 和该 If-Modified-Since GET 同一地址。两者实际返回 304，未附 Cache-Control；304 无 Content-Type，响应兜底无法识别 HTML。改为正常浏览器导航的 `Accept: text/html,application/xhtml+xml`，两者均返回当前正文且 no-store。

当前产品使用根/index 固定入口，真实导航带 HTML Accept；SW 已识别 navigation 并强制 no-store，当前资源树也没有 nested index。因此未发现该边界影响已接受桌面入口，不阻断本次冻结。后续若支持 HTML URL 别名或子目录文档供非导航读取，应在静态路由识别中统一覆盖解码后的 HTML 路径和目录 index，并加入对应条件请求回归，保持哈希资源 304 不变。不能把本候选表述为“所有任意 HTML 别名的条件请求都必定 200”。

## 收尾与范围

只提交本报告。测试服务/浏览器进程已结束，私有测试端口 3434 无监听；自建依赖链接和私有 dist/binary 已移除，保留小型合成证据与 hash 绑定。不修改主线、Native、MobileApp、部署、用户缓存或 publisher 状态。移动 UI 与登录持久化的独立接受结论由各自报告负责。
