# 统一账号体验：独立设计与合并基线复核

日期：2026-11-10。基线 `4d4e354`；设计补充 `94bc583` 只修改契约文档，不改变以下受检运行代码。复核在隔离工作树执行，没有读取真实用户授权、设备目录或业务内容，没有修改已安装客户端、运行服务或云配置。

## 设计结论

接受 `docs/account-unified-experience.md` 的实施契约，无设计阻断项。独立复核提出并已在补充中明确：Cookie 名称包含端口仅避免名称冲突、不构成浏览器端口隔离；HTTP无Origin仅允许 `Sec-Fetch-Site: same-origin`，PTY必须精确Origin，代理头/Host/直接socket peer均验证；非法Authorization不得降级为Cookie；服务控制只接受真实bearer；退出、闲置和绝对到期必须中止已建立PTY；ticket原子单用且存储有界。

本机上下文表示“由某账号在本机打开”的来源快照，不等于浏览器独立Logto登录或持续有效的远程授权。Native切号/退出不改变已授予的本机权限，不得靠旧上下文恢复远程连接。新版本必须从启动、恢复、IPC和依赖路径退役旧独立隧道，而非仅隐藏UI。以上结论仍需要最终实现与真实组合调用验证。

## 合并基线检查

| 检查 | 独立结果 |
| --- | --- |
| `npm test` | 35个文件、340项Web单元测试通过；8项私有浏览器状态检查通过 |
| `npm run build` | TypeScript与Web生产构建通过；PWA产物生成成功，API不缓存 |
| `npm run build:desktop-ui` | TypeScript与Native UI生产构建通过 |
| `cargo test -p anywork -p anywork-desktop -p anywork-remote` | 服务185通过/5既有忽略；桌面51通过/4既有忽略；远程3项协议及7项网关通过 |

第一次Rust命令误用不存在的服务包名，未执行测试；使用实际包名 `anywork` 后完整命令通过。没有将忽略的真实用户历史、网络、安装或本机服务检查记为通过。

该记录闭合既有可靠性修订在合并基线的完整Web检查及受影响Rust检查，不能替代统一入口代码审查、真实ticket/Cookie/PTY浏览器组合、正式origin与390/1440布局、合成账号Native/Web链路、Android构建/实机、精确发布产物及活动用户环境交接验收。
