# 移动协调gateway上线与wire留证：独立只读审查

2026-11-15。对象为route作者报告 `6545c8478dd59203bec237a7184fc5077f59ddc3` 及主工作区ignored `artifacts/mobile-coordination-gateway-40e0548-prebuild/` 的安全回执、上传manifest和相关脚本。网站精确源码为 `40e0548431bc4467f5046a8334edaee685ce15df`。审查者未参与该route实现或部署；本轮没有重跑产品测试、执行网络请求、操作云/Cargo/ADB，未读取token、pulled env或真实账号数据。仅核对已有源码及安全证据间的一致性。

**接受该上线记录与受控wire证据；无阻断发现。** 这不是本审查者重新执行线上探针或手机验收，也不将route作者HTTP夹具视为运行了实际Android SDK。真实账号/设备/只读工作区与session UI结果仍由独占ADB的verifier提供。

## 精确网站与原后端绑定

- `prebuilt-build.json`、staging/GO、READY和production-readback回执一致指向网站 `40e0548…` / version0.1.41；安装包仍为v0.1.41及原发行源码 `f669ef59bde7cb70bbe98fd59592b6f87e93698b`，没有将新网站或之后的候选APK SHA冒写成公开安装包源码。既有rollback记录另保留。
- 独立重新计算已保留 `upload-manifest.json` 的文件hash，与 `staging-ready.json.uploadManifestSha256` 一致；manifest共447项且路径唯一。八项production readback的hash/字节数分别与manifest对应条目一致：build、release、英中页、app入口、loader、实际JS模块与source归档。不是只依赖 `matchesPrebuilt: true` 文字。
- `prebuild.py` 明确通过Git对象逐一比对源码归档成员：源码revision_files、1056个公共文件、无额外成员、另含SOURCE_MANIFEST；归档记录SHA256与manifest、production-readback一致。原构建输出与归档已经按清理记录删除，本轮未重新构建或下载，不能声称独立重算了已删除归档的全部文件；接受的是该检查实现及相互绑定的留存回执。
- 独立比对 `git show 40e0548:vercel.json` 与 `prebuilt-routes.json`：九条外部destination集合精确相等，均到既有协调alias及原路径，未引入console/admin、宽泛后缀或宿主WS代理。compiled receipt保留四项禁缓存配置与 `methodAclClaimed: false`。其 `runtimeForwardingVerified: false` 属于预构建阶段，后续wire单列，不是把静态检查冒称运行结果。
- `postdeploy.py` 的读回实现分别请求官网和原协调alias的相同Native config query，要求两者200且JSON相等；READY/deployment/project与提交结果对应，build读回核精确SHA。GO检查public配置、既有项目、release不漂移。最终安全回执为no-store、MISS、Age0，配置响应与原入口相等。这支持保留原issuer/resource/client/coordination绑定；没有重新读取私有环境或独立审计云存储，故不扩大为新的私有配置审计结论。

## Synthetic wire及失败分类

审查了request、注册、publication、query、signals与finally清理的脚本断言，未执行脚本或读取其运行时grant。`wire-result.json` 九组完整通过，cleanup须另核，而非只看 `passed`：

- appId query正确200、未知产品404并与原入口错误JSON相等；错误exchange方法405、malformed JSON400。
- 两个新synthetic registration key注册200；publication200；有效session200、缺失/无效401、旧epoch409且原入口错误JSON相等。
- POST signal201；payload、connection与来源device精确回读；after cursor生效，非法after/wait400。
- 空队列 `wait=15` 返回200/空signals，端到端 **19556ms**。脚本计时包含网络开销，不能将其写成服务端固定处理耗时或普遍时延保证。
- 最终两条自有session均DELETE200，随后各读devices401。保留的早期 `wire-directory-fixture-assumption.json` 明确为失败，且该轮两条自有session也有相同成功撤销记录；没有把早期失败擦除或混计为最终通过。

早期DIRECTORY失败是夹具假设versioned directory恒200导致。最终回执对照原/新入口均404且JSON相等，而 `/devices`200，未声明versioned cursor成功。锁定SDK `capabilities.rs::devices` 实际检查缓存auth的endpoint_policy：不存在时直接GET `/devices`，存在时才调用versioned directory。它不是先请求 `/directory`、遇404后再降级。作者报告对NOT_FOUND与后端能力边界的解释与此兼容分支一致；当前后端未宣告admission，challenge/admit仅有静态路由覆盖，没有假称其成功wire分支已测。

## 非阻断证明边界

wire helper使用Playwright APIRequestContext，未设置 `maxRedirects: 0`；匿名读回helper也使用默认urllib处理。因此这些HTTP夹具单独不足以证明实际wire每hop均无3xx。保留的编译规则确为external rewrite，而非redirect；本项不否定当前源码/证据接受，但不能从最终status推出“已独立测得零重定向”。实际APK中锁定SDK的redirect-none路径与AndroidTLS/注册/presence由手机verifier验证，不由本轮报告替代。

内部rewrite开关与CDN专用头未回显不构成失败：其存在于编译配置；客户端实际可观察的是no-store/MISS/Age0。cache helper还检查成功及预期错误响应均无HIT、Age为0；不据有限采样宣称所有未来缓存状态或取消传播都已穷尽验证。没有修改产品或夹具来拓宽这些结论。

本轮只在独立Native WT提交本文；主工作区产品、证据与部署未修改。没有新增运行验收，没有接管ADB或共享target。
