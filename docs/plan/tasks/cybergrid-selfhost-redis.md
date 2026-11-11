---
id: cybergrid-selfhost-redis
scope: CyberGrid runtime coordination storage, strict TLS and deployment recovery
status: in-progress
depends-on: []
---

## objective

按2026-11-11使用者最新指令，将正式CyberGrid的Redis从Upstash切到指定自部署服务。域名redis.x.aixgg.com、6379、用户名redis_2429e58a；密码只通过会话占位符或私有状态输入，绝不入源码/日志。必须TLS且证书域名校验（Let's Encrypt）；不得用公网IP替代域名、禁用校验或回退明文。

此指令取代此前等待Upstash付费决策的恢复方向。不升级付费套餐、不清空/迁移旧Upstash，不接触业务数据。允许新服务器上的专用协调namespace初始化和新的epoch，已有协调session可能需SDK重新注册/用户显式重试；Logto账号/设备目录与客户端秘密策略不变。仅核查专用namespace元数据，不枚举其他键。账号和工作内容不迁入Redis。

## context

- ../../cloud-configuration.md
- ../../account-remote-protocol.md
- ../reviews/account-selfhost-grid-live.md
- ../tasks/desktop-default-remote.md

## path

作者：scripts/cloud中必要的TLS Redis配置/部署辅助与相关测试、本文和reviews/cybergrid-selfhost-redis-author.md。先TLS只读探测和准备具体可审查的配置/部署操作；根代理经独立审查后执行外部变更。私有候选状态/完整URL/凭据/环境快照仅仓库外0600文件，不入发布产物。

独立审查：单独review工作树，只写reviews/cybergrid-selfhost-redis-independent.md；核验严格TLS/主机名、配置与部署恢复、服务端官方pinned Redis传输兼容，先审查变更候选后再独立只读验收。

根代理：管理部署、保留旧不可变deployment及环境回退证据、最终上线核验。AnyWork v0.1.25发布正在进行，不能改main HEAD/打断publisher；Redis部署是独立operation，使用同一受检CyberGrid source/artifact的新环境发布，不移动旧deployment或已发布tag。

## verification

先验证DNS+TLS证书主机名+AUTH/PING和专用namespace类型；再用部署中同版本Node redis客户端验证rediss传输，确认拒绝不可信证书/错误主机名。操作代码不打印完整URL或原始异常，固定安全分类。用可恢复operation记录artifact/config/source身份，删除/替换旧运行时Upstash凭据有明确清单及回退；无Management M2M引入。

部署后核对新READY身份/alias及公开Native/SPA配置绑定、健康、CORS和实际TLS Redis namespace元数据。真实账号业务链需单独隔离合成验收，不借管理token冒充用户。现有用户Native/本地服务继续保留，不自动登录或启用其远程。
