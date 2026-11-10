# Android账号入口

Android8+保持既有applicationId `dev.remoteagent.app`与签名兼容。主Activity仅打开`https://anywork-tau.vercel.app/app/`，注册按钮只附加`?signup=1`。Custom Tab保留系统浏览器的TLS、Cookie和Logto跳转；返回App后可重新打开。App不接收OAuth回调，浏览器在HTTPS `/app/callback`处理，工作区继续在同一移动Web内使用。

无Custom Tabs provider时打开相同固定HTTPS地址到系统浏览器；无浏览器显示明确安装提示，不回退WebView或手动配置。任意传入Intent不控制目标。仅声明启动Intent，不接收旧配对deep link、分享或地址令牌参数。

旧ConnectionActivity、WireGuard与连接凭据存储代码和依赖从构建移除。新版本不读取、迁移或删除旧加密文件及KeyStore；现有文件自然保留，应用卸载的系统行为除外。无JavaScript接口、原生文件桥、内置Web资产或明文流量权限。业务文件交互由浏览器功能负责。

`./scripts/build-android.sh`执行assembleDebug、lintDebug和testDebugUnitTest，不触碰运行服务的Web目录。单元测试确认固定HTTPS目标及注册参数；编译和静态检查不能证明实体手机的浏览器安装、Custom Tab切回、网络或Logto完整跳转，实机缺失时必须明确记录。无新iOS原生应用声明。
