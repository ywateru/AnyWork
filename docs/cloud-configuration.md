# AnyWork 云服务配置

2026-11-22 · Logto + CyberBus + Web 静态站点

当前云端只承担账号、公开设备记录、CyberBus 网络凭证签发和加密设备网络中继。AnyWork 不运营业务 API、业务数据库、会话同步库或内容代理；工作区正文、文件、终端内容和端点私钥留在用户设备。

旧 CyberGrid、Upstash、Vercel Function 和 cloudflared 配置已退役。历史证据保留在 Git 与 `docs/plan/`，不得作为当前部署说明。

## 当前公开配置

| 字段 | 当前值 |
| --- | --- |
| 登录 endpoint | `https://auth.x.aixgg.com` |
| issuer | `https://auth.x.aixgg.com/oidc` |
| Logto 管理控制台 | `https://logto.x.aixgg.com` |
| CyberBus resource | `https://cyberbus.x.aixgg.com/api` |
| CyberBus product | `anywork` |
| Native bootstrap peer | `tcp://43.155.169.102:11010` |
| Web bootstrap peer | `wss://cyberbus.x.aixgg.com/` |
| Web EasyTier bundle | `/easytier-browser.js` |
| 正式账号入口 | `https://anywork.aixgg.com/app/` |
| Native callback | `http://127.0.0.1:17897/callback` |

这些是公开部署标识，不是管理秘密。公开配置仍必须完整一致：缺字段、混用环境、使用 HTTP、带凭据 URL 或非法 peer 均拒绝。

## Logto

自部署目录为 SSH 主机 `cath-w` 的 `/home/water/work/codex-work/logto`。`auth.x.aixgg.com` 提供 OIDC discovery、授权、token 和 JWKS；`logto.x.aixgg.com` 是管理控制台入口，不是客户端 issuer。

### 应用与资源

需要以下对象：

- 一个 Native application：授权码 + PKCE，关闭 Device Flow，启用 refresh rotation。
- 一个 SPA application：授权码 + PKCE，登记正式、预览和必要 loopback 回调。
- CyberBus API resource：`https://cyberbus.x.aixgg.com/api`。
- scope：`connect`、`network:join`。
- 默认用户角色：允许正式用户获得两个 scope。
- Account API：允许当前用户读取/更新 `customData`，其余字段按最小权限。

SPA 回调至少覆盖：

```text
https://anywork.aixgg.com/app/callback
https://anywork-tau.vercel.app/app/callback
http://localhost:5173/app/callback
http://127.0.0.1:4173/app/callback
```

生产不使用 wildcard origin。Native 回调固定为 `http://127.0.0.1:17897/callback`，由桌面本地回调页接收，不监听公网。

### CyberBus custom JWT

自部署 Logto 的 custom JWT hook 必须在 `ET_PRODUCTS_JSON` 中保留既有产品，并增加：

```json
{
  "productId": "anywork",
  "nativeClientIds": ["<AnyWork Native public client id>"],
  "browserClientIds": ["<AnyWork SPA public client id>"]
}
```

客户端类型必须与列表一致。SPA 不得放入 Native 列表，Native 不得复用 SPA 登录。hook 保持：

- `ET_RESOURCE=https://cyberbus.x.aixgg.com/api`
- `blockIssuanceOnError=true`
- 固定 credential claim schema
- 部署级 credential epoch

修改前保存 Logto 配置、hook、资源、scope、角色和回调的仓库外备份。修改后真实签发 Native 与 SPA token，确认同一 subject 获得相同 `product_id` 和 claim；refresh 后材料一致；错误 audience、scope、client、过期 token 和普通 M2M token 被拒绝。

2026-11-22 实际部署使用 credential epoch `2`。备份目录位于 `cath-w` 的 `/home/water/work/codex-work/logto/.cyberbus-anywork-20261122T045301434493Z/`，权限 `0700`。该目录和 token 证据不得复制进仓库。

### 数据边界

Logto 可能保存：

- 账号、认证因素、会话、审计和身份资料；
- 用户可见设备名称、平台、公开 Noise 公钥、`keyVersion`；
- CyberBus locator：虚拟 IPv4、端口、产品、版本和有效期；
- 用户偏好。

Logto 不保存：

- 工作区正文、文件、终端历史；
- Noise 私钥、会话密钥；
- CyberBus seed、网络秘密、PSK 或 binding ID；
- 桌面/Android 的 refresh token 明文副本。

`customData` 是用户可编辑配置，不是 owner 授权或撤销名单。locator 只是发现线索；访问由桌面 Gateway 验证 JWT 和本机 owner。

## CyberBus 中继

主机 `cath-w`，目录 `/home/water/work/codex-work/cyberbus/transport-relay`。

当前监听：

```text
tcp://0.0.0.0:11010
udp://0.0.0.0:11010
ws://127.0.0.1:11011
```

公开入口：

```text
https://cyberbus.x.aixgg.com
wss://cyberbus.x.aixgg.com/
```

Caddy 只把公开 HTTPS/WSS 反代到 loopback `11011`。证书由 Let’s Encrypt 签发，当前 CN 为 `cyberbus.x.aixgg.com`，有效期至 2027-02-20。应监控证书续期、TCP/UDP listener、WSS `101` 和连接容量。

中继不执行 AnyWork 授权，只转发 EasyTier 密文和必要网络元数据。浏览器只使用出站 `wss://`，不能监听 overlay 入站；桌面和 Android 可使用固定 TCP peer。

## 前端部署

`.github/workflows/vercel.yml` 从同名 GitHub repository vars 读取六项公开配置：

```text
VITE_LOGTO_ENDPOINT
VITE_LOGTO_APP_ID
VITE_LOGTO_RESOURCE
VITE_CYBERBUS_PRODUCT_ID
VITE_CYBERBUS_BOOTSTRAP_PEERS
VITE_CYBERBUS_EASYTIER_URL
```

可选：

```text
VITE_ACCOUNT_PORTAL_URL
ANYWORK_ACCOUNT_READY
```

要求：

1. 六项全部存在且与当前 Logto/CyberBus 部署一致。
2. `python3 scripts/cloud/prepare-frontend.py` 生成唯一全局 CSP。
3. CSP 包含 `script-src 'self' ... 'wasm-unsafe-eval'`，`connect-src` 精确包含 Logto、CyberBus resource origin 和 WSS peers。
4. `vercel build --prod` 后使用 prebuilt 部署，不从 Git 平台跳过准备步骤。
5. 只有三端验收完成后才设置 `ANYWORK_ACCOUNT_READY=true`；该变量不是“跳过检查”的开关。

不要把 PAT、Logto 管理凭据、M2M secret、token、网络 seed 或私钥放入任何 `VITE_` 字段。

本地检查：

```sh
npm run typecheck -w web
npm run test -w web
npm run build -w web
python3 scripts/cloud/test_frontend.py
```

生产发布后核对：

- `/app/`、回调页、CSP、`/easytier-browser.js` 和 third-party notices 可从同一部署读取；
- `easytier-browser.js` 为固定 5,288,976 bytes，SHA-256 与 provenance 一致；
- 浏览器支持 JSPI 与 `Uint8Array.fromBase64`；
- PWA 缓存不会把旧 bundle 与新 HTML 混合；
- Logto 实际登录、设备记录、WSS 和桌面业务链通过。

## 部署顺序

1. 备份 Logto 当前配置。
2. 配置 CyberBus resource、scope、产品映射和回调。
3. 验证 Native/SPA 真实 PKCE、refresh、拒绝路径和 claim 一致性。
4. 部署或确认 CyberBus TCP/UDP/WSS relay 与证书。
5. 更新前端 repository vars，生成 CSP，prebuilt 部署。
6. 安装桌面候选并登录，确认 locator、`11001` 和 Noise Gateway。
7. 用 Android 与受支持浏览器连接同一桌面，验证业务、续租、关闭和回滚。
8. 达到验收条件后再设置生产启用标记。

## 回滚

- Logto：使用仓库外备份恢复 resource、scope、角色、产品映射、回调、hook 和 epoch；先核对其他产品仍可签发。
- 中继：恢复旧 listener/Caddy 配置，或临时关闭公网 WSS。关闭中继只影响 overlay 可达性，不改变本地工作区。
- 前端：回退到上一不可变 Vercel deployment 和匹配的 repository vars；CSP 必须与 bundle 同时回退。
- 客户端：回退安装包时保留用户数据，但不得重放未知业务写入。旧 CyberGrid 路径不在当前源码中，恢复它需要独立版本和部署。

## 验收边界

截至本文更新，Logto 实签、WSS TLS/Upgrade 和 EasyTier 跨 TCP/WSS 互通已验证；完整桌面、Android、浏览器三端工作区业务链尚未全部完成。生产 Vercel 和 GitHub vars 的最终读回也必须在发布时单独记录。
