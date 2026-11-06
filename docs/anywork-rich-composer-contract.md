# AnyWork 主会话富文本输入器行为契约

本契约根据 ChatGPT.app 26.1027.51404 的静态 JavaScript / CSS 编写，目标是主 local Codex composer。它记录原版证据及实现边界，不表示 AnyWork 已通过全部一致性验收。原应用未运行，原安装目录未修改；抽取代码只作文本与 AST 阅读，从未求值。

原包：`/Applications/ChatGPT.app/Contents/Resources/app.asar`，SHA-256 `52e0a65f9fea51f4287bbd98c63343761f9424517bb793652bb554764bc0bcc8`。下文 initial 指 `webview/assets/app-initial-61c1d0e6137e.js`，shared 指 `webview/assets/app-shared-e711d01481fb.js`。两成员全文件 SHA 分别为 `7a8d8b711bf2eb1adbfab04818a63bf6517935d11bb4d0d4c9d6602d1e3fe6f2` 与 `b57a5332480b033f54945bfa155cf5b152e0b8486a812192b0913f1d0753a580`。

REA 已有 evidence `ev_29bda24a0045f98971a718cbd2a4c279f667e99d8eb155c369f47585b4a36759`，summary `ev_973bf86cfc5031816d0ebbe7b1d3f7edf430398bbe2a8681daf9557162224fe1`。其 source_paths 仅 user-message/user-message-markdown：读取 28,185 bytes、2 个 JS、parse 失败 0；17,532 文件未选择，semantic unknown 达 100k cap，coverage=partial。它不能代表本契约大编辑器模块的语义图覆盖。本契约补充结论由后附原成员 UTF-8 字节范围与 AST 直接支持。7 个 unpacked native 声明 hash mismatch 已 record-and-continue，未执行；原 ASAR identity 未变。

## 1. 模式与调用边界

主 local adapter → Okc → Gac 默认 `enableRichText=true`、`enableCodeBlocks=true`、`enableSelectedTextLinks=true`，设置 `composerPlainTextMode=false`、`composerEnterBehavior='enter'`。Tac 裸默认 rich=false，普通 local 历史编辑默认 PZ；不能把两者当成主会话输入器。

主 rich builder 为 initial `iga` → shared `zkn` → `RAn`。zkn 默认 task 支持 true、rich table cell false、tablePipeAlign true。iga 选择 `collapseNestedSeparatorParagraphs=true`，替换 code block 为 wga、inline code 为 bga、link 为 Tga/ula，追加 Cga、xga、literalPaste 和全部 PZ inline mention。初始 document 若 schema 相同直接复用；prompt 文本走 aga；plain 且被识别出 Markdown formatting 才走 rich parser。普通按键使用 ProseMirror transaction，不对每次编辑重新解析全文。

`setText`、`restoreText`、`parsePromptText`、send/getText、getPlainText 与 persistedText 各有不同入口，详见 [总契约“主输入器与历史输入器的模式契约”](anywork-reference-contract.md)。替代实现必须保留这些入口差异。

## 2. Schema

所有非 text node（包括 doc、mention）由 oAn 追加 `start=undefined`、`end=undefined`。text 位置通过 `startend` mark 存储。下表 attrs 不重复 start/end。

| 节点 | content / group | 属性与关键约束 |
|---|---|---|
| doc | block+ | 文档必须有 block |
| paragraph | inline* / block | paragraphGap=false；Cga 仅真正空且 gap=true 时输出 AST `data.composerParagraphGap=true`；DOM p[data-composer-paragraph-gap] |
| text | inline | text.value 含软 LF 时原样保留 |
| blockquote | block+ / block | DOM blockquote |
| hard_break | inline / inline | selectable=false；只允许 startend mark；DOM br |
| code_block | text* / block | code=true、defining=true；只允许 startend mark；lang=null、isDarkMode=null，加 PZ autoDetectLanguage=true、language=null |
| heading | text* / block | defining=true；level=1，必须整数 1..6；没有 inline*，因而 mention atom 不属于允许内容 |
| horizontal_rule | block | selectable=false；DOM div > hr |
| regular_list_item | paragraph block* / list_item | defining=true |
| task_list_item | paragraph block* / list_item | defining=true；checked=false；checkbox span 非 editable，内容在 div.task-list-item-content |
| list | list_item+ / block | spread=false；DOM ul[data-spread] |
| ordered_list | list_item+ / block | spread=false、startingNumber=1；DOM ol[start][data-spread]；NodeView 计算最大编号位数写 `--rich-text-list-marker-width: Nch` |
| table | table_row+ / block | isolating=true、tableRole=table；DOM table > tbody |
| table_row | table_cell+ | tableRole=row |
| table_cell | inline* | isolating=true、tableRole=cell；rowIndex=null、columnIndex=null、colspan=1、rowspan=1、align=null；无 width/header attr |
| 16 个 PZ mention | inline / inline | 原名、required attrs 与 leafText 见总契约，不应改成 text 或增设未证 image node |

表格默认不是 block cell。richContent=true 的扩展分支允许 `(paragraph | list | ordered_list | code_block)+`，主默认没有启用。DOM td/th parse 以 TH→rowIndex0、TD→1，正数 span 校验，textAlign 规范化；serialize rowIndex null 或 >0 产 td，否则 th。Markdown 表格 cell 固定 colspan/rowspan=1，rowIndex 由 AST data.header 决定；align 取 data.align。table AST align 从首行 cell.data.align 生成。

代码块 wga 合并 rich/PZ attrs，DOM 采用 PZ 的 `pre[data-composer-code-block][dir=ltr] > code.hljs[spellcheck=false][data-language?]`；HTML parse 要求 pre 的直接 code 子元素。不能把 lang 和 language 合并为一个字段而丢失原始状态。

| mark | 属性 / 序列化 |
|---|---|
| strong | 无自定义 attrs；DOM strong |
| em | 无自定义 attrs；DOM em |
| strikethrough | 无自定义 attrs；DOM s；解析 s/del 和 line-through styles |
| code | inclusive=false；DOM code[dir=ltr] |
| link | inclusive=false；href=null、title=null、disabled=false、isAutolink=false、isGeneratedAutolink=false、literalMarkdownOccurrenceId=null、literalMarkdownSource=null、sourceAppId=null；后两 literal attrs 不复制到剪贴板；普通 HTML URL 需 BX 校验 |
| startend | start/end required，无 default；DOM span；Markdown AST passthrough |
| literalPaste | inclusive=false、excludes=''；DOM span[data-prompt-literal-paste]；普通 unist parse 不创建此 mark；serialize 标记后代 text.data.literalPaste=true，但 iga 正常 serialize 前先删除此 mark |

link 的普通编辑 DOM/NodeView 与 HTML clipboard serializer 不同。clipboard 使用 a[href][title]，除 href=null 或 isAutolink=true 交原 mark serializer，详见总契约 PZ NodeView 小节。

## 3. Markdown → ProseMirror

RAn.parse(source) 按完整 source 缓存；parseUnist 是 unified.parse 后 runSync，可用 jAn 优化超过 66 条且每条符合最多三空格后 `|` 的大表文本（无 bare CR）。它不是按行 split 的通用 paragraph parser。RAn 捕获异常后原版返回 `schema.text(' ')`，这是异常兜底，不应冒充正常 doc 结果。

FAn 转换顺序：依 syntaxExtensions 试 `unistToProseMirrorTest`，第一个匹配者递归 children，然后调其转换函数。节点属性位置如下（offset 是 JavaScript 源字符串 offset，非 UTF-8 byte）：

```text
start = node.position.start.offset ?? runningEnd
end = node.position.end.offset
      ?? (typeof node.value == 'string' ? start + node.value.length : start)
runningEnd = end
```

v8 使用目标 type.createAndFill(attrs,children)；返回 null 就过滤掉，没有自动退回纯文本。未知 mdast type 无匹配只警告并返回 `[]`，其 children 也不会递归。因此不能给 image/html/footnote 等随意加一个“安全保留文本”规则并声称与原版一致。先前 unified hook 已转换的例外要分开处理，例如 tableCell 内精确 `<br/>` 被 dOn 转换为 break；普通 linkReference 被 lkn 转 link。heading 的 text* 如因 mention children 无法填充也会丢弃该节点，没有 fallback。

V8/z8 对非空 value 创建 schema.text(value)，附带 startend mark；软 LF 原样留在文本里。code 的 source position 优先 `mdast.data.tableCellTextPosition`；否则内容 start=`node.start + 4 + (lang??'').length`，end=`node.end - 4`。

Tga 对无效 BX URL、以及显示文本就是 URL 的裸 mailto 特例，返回 convertedChildren 而不加 link。Ega 从 link 识别 PZ mentions：url 必须字符串，label 不能为空；richLink 不接受 title，不把源跨度等于裸 label 长度的 autolink 当成 richLink。richLink 额外记 markdownSourceStart/End；mention conversion 使用 PZ parse 后要求节点名与本扩展一致。

lkn 只取每个 identifier 的第一个 definition，将找到定义的 linkReference 变普通 link，删除实际用到的 definition。未解决的 reference/剩余 definition 不因此获得新 schema 节点。Ikn 将 listItem 的唯一 paragraph/text 恰为三字符 `[x]`/`[X]`/`[ ]`（且 source position 跨度3）转换为 checked 空项，补足一般 GFM 的空任务项处理。

## 4. 空行与换行

普通软 LF 留在 text.value；hard_break 才成为独立节点。dOn 安装自定义 backslashEscape token，行尾/结尾反斜线可产生 break；普通 Markdown hardbreak 也由底层 parser 识别。gOn serialize 在 tableCell 内输出 `<br>`；literalPaste break 输出真实 LF；其余用 Markdown 默认 break serializer。

DOn 给 fromMarkdown enter/exit lineEndingBlank 安装 hook，生成临时 `lineEndingBlank` AST 节点，再按父节点和连续 run 删除部分；剩余由 kOn 变空 paragraph。令 `a=endIndex-startIndex`，OOn 返回删除个数：

```text
if depth > 0 and parent.type != 'list': a
else if isLastChild or startIndex == 0: a - floor((a + 1)/2)
else: a - floor((a - 1)/2)
```

run 是底层 lineEndingBlank 事件计数。不能直接把源码若干 LF 等同于该 a，或未经事件映射就给 `A\n\nB` 断言空 paragraph 数。特别是嵌套 list 与普通容器的处理不同。

aga 在 rich prompt parse 完后，仅当最终 block 是 paragraph，且最后 child 不是 hard_break 时，补回源尾部 `[ \t]+`。空格保留不应全局改写成 hard_break。

## 5. ProseMirror → Markdown 与发送边界

kAn 将节点递归转 AST，并合并相邻相同 wrapper 的 mark；startend passthrough，code/hard_break 的 marks 限制会过滤不被允许的 mark。Vkn 安装 GFM，`singleTilde=false`、`tablePipeAlign=true`；Ckn 强制如下 stringify 选项：

```text
fences=true, bullet='-', bulletOther='*', listItemIndent='one',
resourceLink=true, tightDefinitions=true, rule='-'
```

这些不是任意 GFM 默认。主 iga 的 xga 递归移除 unsafe 表中的 `@` 项。其余关键自定义 serializer：

- gkn：非 label context 去掉 `\[` 的转义；任何 context 去掉 `\&`；字母/数字之间的转义下划线去掉反斜线。
- _kn：tableCell 的第一个 text 开头和最后一个 text 结尾的空格/tab 编码为 `&#x20;` / `&#x9;`，不粗暴 trim。
- i5/ykn：emphasis 若左右相邻节点有 strong，使用 `_`；否则取配置或 `*`。Tkn/vkn 保留默认 emphasis/strong handler，并修正 Unicode 补充平面码点紧邻 underscore emphasis 时的实体/反斜线边界；Ekn 同时考虑邻接 strong/emphasis、文本尾反斜线奇偶和 supplementary code points。直接调用包默认 handler 会遗漏这些规则。
- wkn：literalPaste text 在非 tableCell/label/strong/emphasis/strikethrough 栈中可直接输出；孤立 `[x]` 样 text 在 listItem 内仍用 safe escape。
- Okn：只有 parent=listItem、左 paragraph、右 list 时参与 join；右为非1起始 ordered，或右首 item 是普通项且其首 child 为空 paragraph/null 时 return1；其余交默认 join。
- Lkn：任务项在默认 list marker 后插入 `[x]` / `[ ]`；不得用普通 bullet text 替代 checked 属性。
- pkn/mkn：在列表/blockquote 中删除夹在 substantive children 间的空 separator paragraph；若 list 有删改则将 list 及所有 item spread=true 后交默认 list serializer。
- Dkn 有 inlineMath serializer `\(value\)`，但主 schema 没有已证 math node，不能由此声称数学编辑支持。

iga.serialize 在全 paragraph 文档、且没有 preserveParagraphSpacing=true 时：每个 paragraph 单独序列化（按 node WeakMap 缓存），再用一个 LF join。其他文档按整个 doc 序列化。两者 helper 均先删 literalPaste mark、经 hga 规范化 autolink，再去掉结果末尾一个 LF。不能把所有 paragraph 一律双 LF 分隔。

Ega serialize mention：Ila 返回值存在时输出 literalPaste text；否则调用 KX 得 prompt 文本，用 lr 找引用，找不到则 text，找到则 link(url=va(path), label=Tr(label))。不是把 mention display label 单独发送，也不是所有 mention 一律 sourceUrl。

oga 发送时先判断 serializer 是否存在和 sga 是否有实际 rich formatting/mention/link；否则用 KX。serializer 结果去数字实体再 trim 若为空也回 KX；原末 text 有 space 时把最后 `&#x20;` 恢复真实空格。persistedText 则在 rich 非 plain 模式始终走 rich serializer。这与 clipboardTextSerializer 主要走 KX 是不同边界。

## 6. 输入规则

Ykn 收集 syntaxExtensions inputRules，将 M8 mark rules 按 code priority1 提前；不 editable 或当前 code mark ZDn 时拒绝输入规则。M8 保留原 marks、移除 stored mark、插回 trailing char，并避免覆盖 code/backtick 区域。表格不是通用 inputRule 创建，typedTable 是独立 plugin。

| 类型 | 源规则 / 条件 |
|---|---|
| heading | `/^\s{0,3}(#{1,6})\s$/`，level=捕获长度 |
| unordered | `/^\s{0,3}([-+*])\s$/` |
| ordered | `/^\s{0,3}(\d+)\.\s$/`，startingNumber=数字；只与 childCount+startingNumber==新输入数字的现有列表 join |
| task | `/^\s{0,3}(?:[-+*]\s)?\[([ xX]?)\]\s$/`，允许无 bullet/空 bracket，x/X checked |
| blockquote | `/^\s{0,3}>\s$/` |
| code block | 继承规则为 `/^\s{0,3}` + 三反引号 + `$/`；wga 额外匹配末尾三反引号，仅空 selection、depth1 顶层 paragraph、cursor 在末尾，删三个 ticks 并插随后空 code block |
| strong star | `/\*\*([^\s](?:.*[^\s])?)\*\*([\s\S])$/`，需要后续字符才触发 |
| strong underscore | `/(^|[^\w_])__([^\s_](?:.*[^\s_])?)__([^\w_])$/`，offset group1，text2，trail3 |
| emphasis star | `/(^|[^*])\*([^\s*](?:.*[^\s*])?)\*([^*])$/`，offset1/text2/trail3 |
| emphasis underscore | `/(^|[^\w_]|(?:^|[^\w_])__[^_\s]*)_([^\s_](?:.*[^\s_])?)_([^\w_])$/`，offset1/text2/trail3 |
| strike | `/~([^\s~](?:[^~\r\n]*[^\s~])?)~([^~])$/` 或 `/~~([^\s](?:.*[^\s])?)~~([\s\S])$/`；键入单 tilde 可触发，与 GFM parse 的 singleTilde=false 区分 |
| horizontal rule | `/^ {0,3}(?:\*\*\*|---|___)\n$/`；空selection、整 paragraph 精确长度、非code mark；替换为 rule+paragraph，另有 append transaction 处理换段 |

bga **替换**普通 inline code rules。prefix字符类 p2t=`/[\s\p{Ps}\p{Pi}"']/u`；prefix表达式 m2t=`(?:^|${p2t.source})(?:\*+|_+|~~)?`（这里 `\*+` 是 RegExp 表达式中的 literal star repetition）。最终捕获为 `(prefix) + backtick + ([^space/backtick] ... no LF/CR ... [^space/backtick]) + backtick + optional non-backtick trail`，offset1/text2/trail3。native micromark hook 也拒绝无合法 boundary 的 backtick：仅 previous=null/<0、p2t.test(previousChar)、或最后 event token._open 时交原 tokenizer，否则把 backtick 消费为普通 data。不能只修 inputRule 而让 parse 仍把 `a` 紧跟 backtick 的组合转 code。

主 listInput Ujn 早于普通 inputRules：不 composing、不 currentCodeMark、不 code parent，取当前 paragraph 光标前最多500字+新输入，匹配上表 ordered/unordered regex，wrap list、与兼容相邻列表 join、转 regular item。它不是对整文档重解析。

## 7. 键盘处理次序

Tac 自定义 keymap 先拒 isComposing/view.composing/keyCode229。只列 rich 相关相对顺序：

```text
listInput → codeBlockFenceExit → inputRules → inputRulesHistoryIsolation
→ suggestion plugins
→ typedTable → blockquoteBackspace → backspace → tabIndent → codeBlockDeletion
→ Tac custom keymap
→ codeBlockArrowExit → extensionKeymap
```

因此 table/list plugin 可先消费事件；hard_break 扩展的 Shift/ModEnter 不会自动覆盖 Tac 的行为。

| 按键 | Tac 精确行为 |
|---|---|
| Enter | suggestion active 消费；默认 enter 提交，包括 code_block。newline/cmdAlways 换行；cmdIfMultiline 在 Rla(doc) 或 code 中换行。override=false 或 Eac 强制换行；regular list 用 chain(splitListItem, JX)，task 此分支用 chain(jOn, JX) |
| ShiftEnter | code 内先 newlineInCode。list item 是 task、或 enterBehavior=enter、或 cmdIfMultiline 且 !Rla(doc)、或 list第一项开头时，chain(splitListItem,JX)；否则 JX |
| AltEnter | code 内先 newlineInCode，再 regular-list splitListItem，最后 JX；task 不走此 regular 分支 |
| ModEnter | override=false 时 chain(newlineInCode,JX)；否则默认 enter 且 code 同 parent selection 时移到下一个 paragraph，不存在则创建；其他提交 |
| ModA | code同parent内首次选完整code内容；已完整选code时fallthrough全文selectAll |
| Tab/ShiftTab | 先前 tabIndent 若列表上下文已消费则结束；否则 Tac code行缩进；之后 extensionKeymap 的 heading等规则 |

JX=`chain(createParagraphNear,liftEmptyBlock,splitBlock)`；Gle=FEn=`newlineInCode`，只要求 anchor/head sameParent 且 parent.code=true，然后 insert真实LF。que=$6 沿 ancestor 寻 listitem，但遇 tableRole=cell 返回null。nhe=LTn 是 splitListItem；ot=jOn 是 task增强 split，保留marks、新建checked task重设为false，空末项支持 lift/nested split。Shift/Alt 的列表 split 使用 LTn，只有 Enter 对 task 的非submit分支用 jOn。

code 缩进 Irc：仅 $from.parent===code_block 且与 $to sameParent；列出选区涉及行首，非空 selection 若 $to 前为LF则排除末行。Urc 逆序每行插真实 tab；Wrc 逆序每行删1tab或1..4空格。只要识别code selection就返回true，outdent无改动也消费事件。

**列表 Tab 优先级：** nMn 在 Tac 之前。Tab 无 meta/ctrl/alt，且 que(state)找到listitem，或每个selection range均sameParent且nodeAfter为listitem，则preventDefault，调用shift?w8:C8，始终返回true。C8=cDn(uDn)缩进，w8=cDn(dDn)取消缩进；支持多range并恢复bookmark、storedmarks，包含列表合并/嵌套处理。因此嵌套于 listitem 的 code_block 也先走列表缩进；“code优先”只适用于未被更早列表插件捕获的 code。

| extension 快捷键 | 行为 |
|---|---|
| ModB / ModI | strong / em |
| ModShiftX（大小写 X 均注册） | strikethrough |
| Ctrl` | inline code |
| ShiftMod7、AltMod4 | ordered list |
| ShiftMod8、AltMod5 | unordered list |
| AltMod0 | paragraph |
| AltMod1..3 | heading style command；ShiftMod1..6 最终直接 setBlockType(level) |
| heading Tab/ShiftTab | 仅当前heading，level±1，0转paragraph，>6拒绝 |
| Mod> | wrap blockquote |

## 8. Rich paste 与 HTML 边界

paste 首先走 clipboard/file/image事件；5000字以上可发 pasted-text 附件事件；超过100000字HTML拒重型HTML路径。CRLF/CR在paste转LF。plainTextMode/强制literal路径使用 literal文档，不触发rich parse。

iga.pastePreferredHtml：null/blank HTML、code context拒绝；lga sanitize 记录 didNormalizeMedia，pga parse。若 plain 非空，且 cleanHTML空或没有media且不符合hMn结构化HTML：对 plain lexInline，escape取raw.slice(1)、text实体解码、其余保留raw；只有得到的text与slice.textBetween('\n','\n')完全相同才literal paste。其余走dga(slice,plain,true)。literal paste 是 xo→SCe，不是全文Markdown parse。

Tac.transformPastedHTML sanitize，若没有合法 data-pm-slice，rich模式在非 li/td/th 的相邻非空 p+p 间插 `p[data-composer-paragraph-gap=true]`。先行 Cxe rich candidate只在plain长度≥5000且HTML含a/ol/ul；较短正常HTML仍可在后续S.pastePreferredHtml处理，不可据此禁用短HTML。

完整 `_Mn`/hMn/mte 元数据阈值、media gates、selected URL paste、PZ HTML whitelist 及clipboard nodeviews继续以总契约对应小节为准；本契约没有证明通用HTML、所有math/image均属于rich schema。

### 2026-11-05 实现补充

本轮沿用前述 REA 静态证据与原成员身份，复核现有临时副本的 AST 和原始字节。没有重新运行原应用，没有扩大既有 REA 语义图覆盖声明；ASAR SHA-256 再次保持不变。实现位于 `richPaste.ts` 与 `PromptEditor.tsx`，原始模块不随产品发布。

- `xo=shared Qjn` 创建一个 paragraph，LF 变 hard_break，文字带 literalPaste；`SCe=shared $jn` 将 storedMarks 或 selection marksAcross 应用到整个 slice，再替换选区。主 rich 的强制纯文本、普通纯文本和被拒 HTML 均走此流程；历史 PZ 继续按 Bla 逐行创建 paragraph，仅首行保留 marks。
- rich preferredHTML 与 PZ 候选门禁分开。无媒体且未识别结构化内容时，比较 inline 解码的 plain 与 Slice 可见文本是否完全相同；匹配才粘贴解码后的字面文本，不匹配回退原剪贴板正文。结构化内容通过 dga 和隐藏链接材料限制后保留格式，不套用 PZ 的空白压缩比较。
- AnyWork 解码器使用既有 CommonMark/GFM parser、禁用 block constructs，仅替换顶层 inline text token；代码、链接和格式化 token 保留原 source。常见转义/实体边界已验证，尚未证明与原 `xpe.lexInline/Hpe` 在所有异常语法上等价。
- `Afe/m5` 覆盖同 parent 的 code block、code stored mark 光标及全部带 inline-code mark 的选区；混合和跨 parent 选区不被视为同一代码上下文。原有 uic 代码块插入仍先行，保留去除尾部 LF 的规则。
- `lga` 清理隐藏元素与 script/style 等，去掉 library 引用的 style.fontWeight；MathML 的 TeX annotation/alttext/text 转 code 或 language-math pre。媒体保留显示标签和来源；图片嵌在另一来源链接时额外保留媒体链接，data: 来源链接解包。`JAn` 清除字体、字号、颜色、行高、文字装饰/阴影及 heading 的 fontWeight，解包无属性 span/font。
- 无合法 `data-pm-slice` 时，相邻非空 p+p 且不在 li/td/th 内的段落间插入 paragraphGap=true 空段落；合法 marker 保留原 spacing。PZ 的 li 加字面列表标记，主 rich 保留列表节点。普通 HTML 文本 CR/LF 转空格，pre、合法 slice marker 和保留空白样式祖先除外。
- `pga` 移除已识别引用外层的 link mark；无合法 marker 时按 `SMn(preserveBlankLines=true)` 归一。全空白 slice 保持原样；非末尾 paragraph 的多个尾部 hard_break 转空 paragraph；真正空 paragraph 的 gap 属性保留。
- `dga` 在末尾 table 且当前不在 table 内时，关闭 slice 尾开口，按替换映射在表格后复用/新建 paragraph 并放置光标。`zla(includeLinks=false)` 的 URL 格式判断依据实际 rich schema 节点/marks，替代 HTML 标签名猜测。

目标保存持久化 Markdown：字面多行粘贴的 hard_break 保存为反斜线加 LF；主消息投递使用独立 actual text。测试分别验证目标 API 的 Markdown 与重开后的可见 LF。

超出100000 UTF-16单元的 HTML 保守回退字面正文，不继续把正文 URL 转 richLink。原版 pasted-text 事件、超大 HTML trim 后重试、Google Docs 专用 FDn/UAn/HAn/YAn/QAn、全部媒体扩展和原生 clipboard 来源组合尚未完整接入。浏览器专项覆盖不等于 Safari 或实体手机验收；最终执行结果见 `validation.md`。

## 9. 原版主输入器样式

主输入器选择器来自 `webview/assets/b74e19ff7ff4.css`，整文件SHA-256 `add22f5a6ff93862827b6bba51ed6e4356708d8f99c2a6bdaca51993bc0df3ed`。三个 class 为 `._RichTextInput_1ev2o_1`、`._composer_ilwj8_1`、`._composerTables_ilwj8_49`；`4dc32da811e5.css` 的 writing-block editor 是另一surface，不能替代。

- RichTextInput定义quote rule宽=`codex-chat-font-size/4`、色border；p margin0；ul/ol通常缩进spacing*6，在[data-chatgpt-composer]内为spacing*5。ul层级disc/circle/square；ol padding=max(base,markerWidth+.75em)。
- heading semibold；h1/h2/h3分别heading-lg/md/sm；rich-layout内h1..h6 margin-block0。h4..h6没有该局部font-size覆盖，继承其余原样式。
- blockquote padding-inline-start=spacing*3；composer wrapper用透明4px inline-start border，加绝对定位伪元素显示rule，margin-block0；hr color=border。
- inline code radius-sm、surface-secondary、padding spacing/2 spacing、text-sm。较后全局 `[data-chatgpt-composer] .ProseMirror code:not(pre code)` 会覆盖为radius-xs、background-secondary-soft-alpha、text-base；还原时须保留cascade。
- pre/code block radius-xl、surface-secondary；pre padding spacing*2、mono、codex-chat-code-font-size、line-height spacing*5、tab-size4、white-space:pre、margin0、overflow-x:auto；直接code min-width:max-content、display:block。相邻非空p/code margin-start=spacing*2，code/code为spacing。
- task li display:flex、align-start、gap spacing*1.5、list-style:none；checkbox/content DOM见schema。不要直接套 writing-block checkbox样式。
- table的space=chatFontSize/4；font=max(codeFontSize,chatFontSize*.875)、line-height=chatFontSize*leading-relaxed、font-content。border-collapse:separate、spacing0、layout:auto、width:fit-content、margin0；cell vertical-align:top、white-space:normal、inline-end padding=space*6。th bottom border-strong1px、block padding=space*2、semibold、line-height=space*4；td block padding=space*2.5；非末行td border-subtle1px；末th inline-end=space*10、末td inline-end0、末行td block-end=space*6。
- multiline editor height:auto；single-line editor white-space:pre，p text-overflow:ellipsis/overflow:hidden。expanded composer scroll容器overscroll-behavior:contain，scroll-padding-block=spacing*4。

局部48条原规则（包含原byte范围与逐条SHA）保存在只读分析工作区 `rich-composer-css-evidence.json`，可用于逐条核对。页面最终font tokens、布局宽度等仍须和实际composer wrapper及总契约合并，不能仅用本局部CSS判定像素一致。

## 10. 实现验收与尚未证明的部分

实现应覆盖：schema JSON往返、softLF/blank事件、任务checked/new item、ordered起始数、表格alignment/edge whitespace、inline code boundary、mark相邻与Unicode、mention和source位置、paragraph-only单LF持久化、发送与clipboard差异，以及上述键盘优先级。测试须在AnyWork实现中运行，不加载或求值原app代码。

本研究没有运行原应用，因而不提供原版动态屏幕像素或IME实机结果。源码行为与AnyWork视觉/交互验收是不同证据；移动Web键盘、Safari内容编辑、完整扩展plugin内部各特化分支仍需要AnyWork实际场景验证。下附证据范围仅证明这里读取过的函数/样式，不构成全app或所有caller覆盖。

## 11. 原始范围与校验

下表为原成员UTF-8 `[start,end)`，SHA计算于对应原字节。Babel UTF-16 AST索引已转换为UTF-8 byte并逐条回读复验。名称大小写敏感；为避免大小写不敏感文件系统覆盖，结构化索引用 `file:name` 作键。

| 成员 / 名称 | 原始 byte 范围 | SHA-256 |
|---|---|---|
| initial / iga | [6390126,6391458) | `370f7a845a4e8ce8ec976898a68efca4a621ae1cfaafe954dd139af2a3e7e7cc` |
| initial / aga | [6391458,6391745) | `9c28524ad3a3ba11d9f6a7de5fde4afdffaa39af6be1e4c0c8091996e7658c97` |
| initial / oga | [6391745,6392063) | `b916b1567cf5758ceb4097725834aec4005127d0b885d852f374275089eaa0ed` |
| initial / sga | [6392063,6392335) | `85fb76f459c48e4080c0a1cebfcf2a47dd619a8c7568a59435c4058d67331594` |
| initial / bga | [6398523,6399084) | `a8856ffd12a963e9cbdd39998c0359957ab337483e9aaef10dd8981c9d31701b` |
| initial / xga | [6399085,6399348) | `850a5cbe0b9ff359a97d93e1d6b3cd22ed124cd60d15c3bc84ac5bed51e163e9` |
| initial / Cga | [6399517,6400029) | `5cfd2305fa89bccbec00a63e3d296292e2a0960de2135df0ab0908a8a1747756` |
| initial / wga | [6400030,6401215) | `5032d6ae46fccf8fbdbbaf4c313faffaf33b3e5f0a5b5703e38aa500300d23b3` |
| initial / Tga | [6401216,6401669) | `71b233a37a99c02bed99c9ec0e9682d77b89b6a8bad5de39475775daaf2b5609` |
| initial / Ega | [6401670,6403039) | `5a13e070906afb8c32dd6a46ecc067215a813dd465c1aaeceb713e2960101179` |
| initial / ula | [6202620,6203409) | `b5efb29034e90eeb32e9571717f21e3691e886c7d6cb8e1df0577a68249ab084` |
| initial / p2t | [2500001,2500026) | `3fca1fc9fcf00c314d92b22d8c036518748ab246eb9cb90ae3f7192741105de1` |
| initial / m2t | [2500027,2500067) | `4b0a1147e62ccadcf120901d78799077ac2dabc1da18d9c2503a490c0d2483d6` |
| initial / Tac | [10140171,10153275) | `3c53382ee20329703699ed82b59bd77f4f10e902025079fb251bde3d3c557ddd` |
| initial / Urc | [10104783,10104909) | `6ce7b18896fee40ce92881b4bcaf993191e95e1f272db92d94848c5a3d2fa28c` |
| initial / Wrc | [10104910,10105177) | `7ecd36a1406321f164c3404207f1f6412e08c2f0234706f9ce2678b19ee694e3` |
| initial / JX | [6218434,6218451) | `317263b51cecec42466cd9426820f147b4abd7be53ac10a131066863c10e0db8` |
| initial / Vrc | [10104259,10104564) | `fdbae3a5af926fb8553d9eeef1a000aa0a4870e6d72828300a6afccf93941eef` |
| initial / Hrc | [10104565,10104782) | `d143da420e263a041440ed8030aea95200fbf3a216ba78953e028f2699b23625` |
| initial / Rla | [6212999,6213118) | `ade915fd9ea7d858f5003feeee767a5fe98254007732f1d41e6f3e4e0245ca21` |
| initial / Irc | [10102821,10103204) | `e85588f1ea8e72d7eb0f9368db09d97c2e2cb7d905957e51d871c04a302826f0` |
| shared / zkn | [4444096,4444613) | `e8c0c8b0c2c7a809f24317f41f3f0f56cadc7b47f55702cafb3c9d05a48c09f3` |
| shared / qkn | [4446971,4447101) | `ac44d909e816f8fe250f511f2ee045cc69292bb7f84cb49e0939c84e49bba666` |
| shared / Kkn | [4446728,4446970) | `88fe37947b745303f9a506aa38e2cc0d5781fc426345cd5f141cefb47cf1b810` |
| shared / Wkn | [4445750,4446340) | `799eaad084dd638bb3412ba18c1f27438091d81106d8c1a4456d6518f19ec981` |
| shared / Gkn | [4446341,4446727) | `da9873bf260edf073b77f8eb03065cfacfdfded5351eadb5c55880fe6998b13c` |
| shared / Mkn | [4440306,4441220) | `eb223a77b05c1b6dec8e548c3a2bf84343c77d799776bd4e7c62c5ace1ad2158` |
| shared / Pkn | [4441309,4443228) | `b6ff40f46e571e02f8d92299558fe2e079f16004ff20c3d8877a1a5e7a647faf` |
| shared / skn | [4433625,4434608) | `c5640065f3469b1d9717f62cdf5dcaed936d10742e27ae91004527b7655eae22` |
| shared / akn | [4432898,4433551) | `d23fb9ffb6df7aca6125f5088329642d82671fff4d054fcedded38fc09de213f` |
| shared / e5 | [4427044,4429449) | `f3155d7a6be9ce164ea55cf39f06686a3bf0fe32e29fa098130f30f4e2091a82` |
| shared / Ykn | [4447170,4447835) | `c79c9f7f262e388c1e53e5d4baef669f2173a77fe48beef7c456089628cb2f66` |
| shared / B6 | [4353258,4353330) | `9d64e6b6d696cf73cc4087f2e60db8f0a1fc692990edbbdc5461a5906c9dd502` |
| shared / W6 | [4354022,4354397) | `5a6ed4ea8c03b89f4e60bc31a6464bed5059c4424266eabe6422dab7e1b9cacd` |
| shared / oDn | [4389576,4390167) | `45265e0a87b3d64d3d3416c7f6701fda8fe66e0b6ee3dcae7d5826bf1cdf5904` |
| shared / k8 | [4398976,4399421) | `4ed8b6ef52ac463ab85516911c63971615e5e1d8f47e9fac36a6881d96b69cfd` |
| shared / M8 | [4402148,4403603) | `f2c713a6ad93c57b41643edd74101c0d4ca1eef572e8be0aea9341de04804043` |
| shared / eOn | [4403672,4404444) | `d01906432581d4b073da99fc20fa99125a3c5136d5c78631fea6447859cee530` |
| shared / P8 | [4404996,4405357) | `cb668d67ac977d7b7ea78970e25c2039a2b65b777b70978a9d3089caf6783c9c` |
| shared / L8 | [4406626,4407396) | `f9047a3c043be0214f3682274984a15d0af7a8da29d861fd1cfa644ec2c67993` |
| shared / U8 | [4408190,4409088) | `9b4a30829abc360247cbd4b910f5bc5da32eeb31ed675df05657423d84e7eeff` |
| shared / yOn | [4409172,4410933) | `a96eef78d77e74a9779ef1cf00c3bc49084924f36c093dc775b5223608ab8d0d` |
| shared / G8 | [4411843,4413299) | `f98a7f3793d2e5c4fa105d8ea0d5679dbf4ab8852571cd8928c42499a5644da8` |
| shared / SOn | [4413373,4414188) | `4f825dd171719c81b960f0ef3ac6505a52b9c54797cee28c9d1676dd51993095` |
| shared / wOn | [4414257,4415135) | `f9614a26d9f869430471b9d8485aa211e0e3b453a95b70dbcfa63fe77db57c5b` |
| shared / MOn | [4418380,4420203) | `c8100dae85b92c0b03d822d927e34b79280d908dd969304e471a89ac885a1d8b` |
| shared / POn | [4420262,4420593) | `94de0b8ff9b60525f5b25c50918950bd3d86110ada966ca1754bd1ad8843b641` |
| shared / Vkn | [4444910,4445468) | `aff2d1ef6a0094da605886010be70e2869f28d1712318a7b876bee50623d5b02` |
| shared / RAn | [4463064,4465563) | `41b24176948987a181c78e354b1bd0ac07a2df780b8577f9735d3646a976c228` |
| shared / uMn | [4493122,4493735) | `c624b4cac4b4c431ef293c9e4d8c5e67dea6fe983f21a65fb0db57f108090802` |
| shared / jDn | [4398878,4398959) | `17de48bf1b7fae9a3e5bc83d64ca5794499875e6d353d1101506acc298c99139` |
| shared / dOn | [4405891,4406272) | `04dca6149619d6d4a55bbf196a2cec9d5e6ae905a62218cfaf079195c7efc8cd` |
| shared / IOn | [4420662,4421554) | `6566570b7b463e171841d9569351261849d2944201b3df913b0fc273d288cd02` |
| shared / JOn | [4430022,4430323) | `fa7ae37a461cffdc398d374aa7cca84ecf750bcf5a7584a8b2e0a8961a88dc40` |
| shared / lkn | [4434615,4435158) | `03578dea707483ee2c46a90ef1b7d69809477716317fc05f180277a205dd179b` |
| shared / pkn | [4435484,4435905) | `99cea02dcc709758a7b99077166e9c3deeb84575bb6dd5fd41055b28fc52df03` |
| shared / mkn | [4435906,4436083) | `0964394841399af52ebe8444c379d20f4a9b619aefcec10272bcff871c9a112a` |
| shared / Ckn | [4438350,4438768) | `3687cf064546cbb1e6876bcd87b6da1663929dacc4348dd0b14c3364259427cd` |
| shared / Ikn | [4443235,4443756) | `69508008483f190f30a3e7df76f700cfee09f8887d1f666e9cfe6ef0f0233a71` |
| shared / Bkn | [4444858,4444909) | `0950b56f45f8929ae5af24ab3be227e39e23bf3a1c27ac234327ef4be1cced99` |
| shared / eAn | [4448146,4448493) | `983c066ec0d28b6bd096bfc008ff59829d5291408bed8b38f2e275fa512f5aa8` |
| shared / oAn | [4448939,4449651) | `89f9824ff3fd99535ccc1579a4d7642f4966564ecd963569b627ccd6702d8e31` |
| shared / cAn | [4449706,4449883) | `1a1f0e06d9e740b42dd9c2d3491b07a74183b7f8ff047df80a852bb9fc22a2a2` |
| shared / fAn | [4450015,4450724) | `f950c36151065b0dfe10ae82067e002bb300bc876069b1e2f898e227c06628d7` |
| shared / kAn | [4459097,4460682) | `b48fc0e963a43a818c27a6bf5c8e0c950176000f0af5f0f7024bc32b5c55d0ec` |
| shared / FAn | [4461851,4462939) | `c0c9525bca9e19d3e16385ea430063a5a3dde4f512f22a89f73810ee99504fbe` |
| shared / yme | [727111,727133) | `2adf75033d46149e4f22eedb27f2473bf1ed562aaa050d3473f5483463638373` |
| shared / rDn | [4389076,4389162) | `73c9f56f84fa02428adbda7f8c3117c9117522ac527ae649e68107981f07b467` |
| shared / z8 | [4407442,4407561) | `7559c9f1aaa88f41750e857ea9f408878ed6fda8ee4dfe9620cb620628bd451d` |
| shared / V8 | [4407617,4407910) | `3ea3c4f0b0c874cceb037c4b3752f2723b2e9c85a940154e52f7a76022115126` |
| shared / _On | [4407917,4408100) | `58b36e1f1860da9d6119e71f4d26f4101e351250f238855d809355943ff030c0` |
| shared / kOn | [4416010,4416360) | `8dd7c218b64d78586ba50818c3c332d3f77662254de7a9140cd61534c99a34df` |
| shared / i5 | [4437128,4437282) | `fb8cd7cc9712aaad1ad79421384f57dc16a34c0f5475b14c3f00d356475e3e75` |
| shared / uAn | [4449890,4449929) | `d6799bdfafdaaab6ea0cefbb2ef648b6bf1345055babb8eb9dbaa7ba4458caf2` |
| shared / jAn | [4460689,4461433) | `a525d2ddaa0e014889064e7e804ebfcf513ee80d320212c5d9a1c91702e7cd4a` |
| shared / HAn | [4465903,4466139) | `3b6d1b47b4aa89d80efc530468a69be072df484c5191df45eefdf73022995a68` |
| shared / v8 | [4389314,4389447) | `c8dbe0fefccc36f1a754628f3257b60ac633d2f0ff655afc0a7eaf333d537274` |
| shared / MDn | [4398960,4398975) | `fc86e99660a7ed68b4a5ad56b717c3cd759dceb85588e41a03133b2cc9486033` |
| shared / ZDn | [4401818,4401953) | `87eb4c22f3b59f6f56a56569e067d5fa50f3e6789e33db212ee09120b5d086ac` |
| shared / uOn | [4405832,4405891) | `f63c49941be057288890e4b3c70bb2b69153c2831f4f281e4beac11b96f76450` |
| shared / fOn | [4406272,4406345) | `d489f97d6327842edd494bc65b979add6ffcce5557fcd1e13e0977d4ed644852` |
| shared / pOn | [4406345,4406402) | `2734ac86529afa09f73f2525bbdd796fefba61ff4275495f447c49b23956c1f2` |
| shared / gOn | [4406526,4406625) | `d2d8526b7fb4ae54f1422ffb1558df5d0059138497906475f9969a68ed1dc886` |
| shared / DOn | [4415213,4415760) | `75189f4bf1315e40ed65cbd788b96f52bb65ca05cb128dea00fb3d7b1b369d8f` |
| shared / J8 | [4415824,4415844) | `32408ed1247e47749788c6665c7029f4629f4d926af63419029957dd48029fa8` |
| shared / Okn | [4439934,4440168) | `8eb7af4719c411ecf65ffa5c54a3c74be7799262e1692641e18168a7a4bb41df` |
| shared / Lkn | [4443808,4444089) | `c451b706a8c0b881dc95e7c5b6b8c3e1a1077fdce5828592bd748ff461926f03` |
| shared / lOn | [4405699,4405832) | `ef2eb0c25d5e6b7452d9587ab7b3f75c6f569c3a5242664d80041a31daaf1337` |
| shared / mOn | [4406491,4406497) | `dd83d24b3f2bd0696ebb70083e2081ab795533dfc6b0b15027e313a6ac00e576` |
| shared / I8 | [4406505,4406525) | `687603a543d62cf167f0d5eac8a60997e139b5d277c3eb1cd16f6d9d9ca0afa2` |
| shared / OOn | [4415845,4416009) | `4535e28e8a81c66a38be4a2f60b94d5b7de691660bdae84799ab6582ddbc35c7` |
| shared / kkn | [4438798,4440175) | `21efb8a31734a2bb270d340f31e3301c52eada2237e2f9777fb7f7c73535d938` |
| shared / gkn | [4436090,4436271) | `a866368e89c3cfd07a75c976ce8e0e497c07ff62c6547e532169721bf5fbe825` |
| shared / _kn | [4436271,4436490) | `9ce96f675f5300351ca210a0f6ad7c7ddbaafeee122ae5a725a99bd5dc23add1` |
| shared / vkn | [4436490,4437128) | `44912b573908c1eec400412c7a68166083005c7be26795ad966b199e6d2db6b2` |
| shared / Ekn | [4439251,4439907) | `175cef89417dcbfd09ec7023266b7984a6acd4ebd17c7e4f1643bbf3271f6852` |
| shared / ykn | [4437282,4437412) | `89fcab480064dc0b9aecb1269230a5ceebf2f635136e7a212fe2482e746dfbee` |
| shared / Tkn | [4439172,4439238) | `83346b692cc43fc3425f850f1e0b7f023d8fdb0fc2f431c5d98cbfc9c376cb73` |
| shared / Dkn | [4439908,4439933) | `5afb9a296136fbc46ec9bf7a88d930a6a69f1a7865739de2be7272c419ef01dd` |
| shared / jOn | [4416367,4417532) | `2c2fc246ef3960986022855d49f4cf286ccd5bef86adf8e014a705d7b3274f9c` |
| shared / FEn | [4383497,4383645) | `9d85d0daf3db994a5224d72b16f7c0dddef4ac75c38c77dcf7e056a83584ae27` |
| shared / $6 | [4364911,4365089) | `14a455d8c686362a6be513051493ef8593aa54723398e6589f23dcc23453a343` |
| shared / LTn | [4362341,4363388) | `05c3d1746dd620c9be2091a758218598fb8cb0ce3eeb03d520566aab15c87505` |
| shared / C8 | [4394159,4394170) | `97249cd8d59b5f527a470bc1d59531002959b9e6e278af5038c4de2b82426efe` |
| shared / w8 | [4394171,4394182) | `ae6d5c5ca4ad37abd09ee697c3b7e861205ee7edda929585dcdd493ca7f6d6b8` |
| shared / s8 | [4384370,4384652) | `8adde96e70b929800c1f0510dc7b213b980b87c035de6f611180c3c55538b196` |
| shared / n8 | [4365943,4365991) | `2f77fd3eb916ec31e40ca0e1dca33d779be7aeef0daab9b716bbbd10286f3381` |
| shared / cDn | [4390978,4391396) | `6b64e841afb5a20641ea74694ec38e5241fecd9b7992ee27e442b165168f851a` |
| shared / uDn | [4391624,4392609) | `e2b65c7a281881a36328e8122d9988c62f08b870d8c237c54ffd994f9fc6efa3` |
| shared / dDn | [4392609,4393149) | `9266aed2b4c4a36b7e9a3e1d9cf22594dd3b776661c6c56e32f3bac9fd976b98` |
| shared / nMn | [4491874,4492215) | `86230354af1a24d465e73b8d156707150570747a317df41be3f53ece2068e9fb` |
| shared / Ujn | [4488065,4488964) | `2016048381a41897d1ecea6b2d67bf051bfabd4100a2df7c211d3aadcfd0bb1d` |
| shared / rkn | [4431993,4432792) | `a299462de0027aa9a31a516358d3cd9ab763c438ef5f59b2e8308724d0b1fb39` |
| shared / iMn | [4492270,4492470) | `4a4de23886ffd1f6ae4ae66d7f044e0460fbe3d09d38fb7a8f1ccb5773651e37` |
| shared / Gjn | [4489063,4489087) | `013f0afa4028952cce79c949e8f296a62972a8b56cd28590398166be12decc71` |
| shared / Kjn | [4489088,4489112) | `aba23a0f7344ea5da59a6a1ce6e9f38c09b221d8b717de14d41edd6304b19114` |
| shared / Wjn | [4489055,4489062) | `9cf9efc1e3196dc1c773acd52f3a8ebab50529605ff1a0e09e272715af3dcb6c` |
| shared / Xjn | [4489649,4489939) | `43f19ac3d4e2f0cad28215c0416f8cc5f015f959d6cb7604bce2fa445053a940` |
| shared / lDn | [4391396,4391624) | `1b04f75c150407a09d7fb5a1946b9d7cf5d78d459b2ff80ef2a4e52f8edb0ff8` |
| shared / fDn | [4393149,4393503) | `b056fea7e66471fe93f0654aeef2b2cfbebbbe3d6f99f31d070e8f0dcd96ce11` |
| shared / pDn | [4393503,4394097) | `bff460667d934526eaf1171c1438f5c5f58529ad8c5255b2cb8d36c79a4e0c6d` |
| shared / X8 | [4417654,4418306) | `5709d42c396f81248de1003183027606be328babd0e25477aef12effd2b9d2dd` |
| shared / n5 | [4429512,4430015) | `4cfe30664c63cb7aa7a78b34823715bceef76481e518ad3ce4eece8acff06b9b` |
| b74e19ff7ff4.css / 整文件 | [0,191618) | `add22f5a6ff93862827b6bba51ed6e4356708d8f99c2a6bdaca51993bc0df3ed` |

## 12. 后续聚焦补充（2026-11-05）

新增直接静态读取确认：Rjn 的 closing fence 仅在 code 最后一行恰为两个反引号、接着键入第三个时触发，删除该行与前面的 LF，再新建后续 paragraph。Ijn 对完整选中 code 内容的 Delete/Backspace 删除整个 code node；空 code 的 Backspace 改 paragraph；code 末尾 LF 的 Backspace 删除 LF 并在后面创建 paragraph。Ljn 加主 Tac 的 Lrc/Vrc 支持代码行末上下移动与边界退出。

typedTable rkn 在 Enter 前检查当前顶层末尾 paragraph 和之前两个 paragraph：三者只能包含 text；头/体必须首尾 pipe 且至少两cell，separator每格符合 `^:?-{3,}:?$`，列数相同；将三段替成两行 inline-cell table 与空paragraph。首行 rowIndex0，体行1，alignment来自separator；trim cell边缘、保留文本marks、删除转义pipe的反斜线。单行/块cell通用table插件不属于本路径。

原版 checked task 的 ShiftEnter 走 LTn，分裂新项可继承 checked=true；Enter 的非submit路径用 jOn，才显式将新 checked task 设false。快捷键 D8 的 list style 是切换/重建：相同普通列表解除，task在同种列表先改regular；AltMod0/1..3会先解除所选列表再改paragraph/heading，ShiftMod1..6直接setBlockType。

唯一匹配 checkbox wrapper click/mousedown 的 s8o 属 writing-block-task-list，调用点为另一编辑器assembler；本次未在主Tac/uMn安装路径找到该plugin，Pkn也无nodeView。不能以 writing-block 可切checkbox证明主composer checked交易行为。

发送/显示补充：composer-content 的 Me=getText、Pe=getPersistedText，it=Me用于context生成，at=Pe用于历史ot；普通提交无display_text替换。Hs optimistic文本另取getPlainText。user-message-bubble 将text交user-formatted-text，后者仅AA去storage link前缀，再将字符串交Markdown renderer与user-message extensions。没有“用草稿escaped Markdown覆盖实际消息展示文本”的已证路径；字面粘贴的raw标记可能在发送后按Markdown显示。

以下补足新函数和展示边界原始范围，校验方法同上。

| 成员 / 名称 | 原始 byte 范围 | SHA-256 |
|---|---|---|
| initial / Lrc | [10103204,10103642) | `4805e939c7d929352fb95586919cc0a53384ca1b0a9201ab5687d6456d679893` |
| initial / Rrc | [10103713,10103862) | `c35aa8fb2c8d655ce513609cccfdde5a60fc5bb7a73a329047957a78e5278a96` |
| initial / zrc | [10103863,10104236) | `71055b27ed15424afcadff8883f37db010ab28593fa5b8d9b41d78b69ce2e813` |
| initial / Brc | [10104237,10104258) | `36ce9649baa5bb922b3e89d9e89e5b62621b3b5221a4a3eeba556a25e4205a5d` |
| initial / s8o | [8347863,8349178) | `8c48485c4363a15f2e35ab47ca9fa491b4b9a22d9b57b1b1ba291ea55153b399` |
| initial / g8o | [8349948,8350160) | `31791209ff32f55e772ad500f82c0bcb69d275ae926eb796a92ea1db142a2183` |
| shared / Pjn | [4484634,4484847) | `d30866f06f7ec19cc8b2fb79a20154fef877ae7c7e6bca42cf27b35b00de6670` |
| shared / Fjn | [4484847,4484948) | `85fbf87752c608fb1d022ca3f3d22fab19cc133d390c6366d2acd44384ca5a66` |
| shared / Njn | [4484262,4484634) | `2907e678968d195d6a1f8c9dd5676c48eccce7eb824d4feecc21174f9cc8f833` |
| shared / D8 | [4398612,4398716) | `c1546489791de6be0bc85abbf12f9842a912f7c8e99787360494d7a132c8038c` |
| shared / kDn | [4398215,4398612) | `b5b942a4c4819019907560d136e51e9c9ebb648e2089342a036a62dcd798bdee` |
| shared / mDn | [4394189,4394493) | `4b1bf8f866bdb0d2a28bf3eb9aac3460b9edcedaba6490a695d6c3c370712a25` |
| shared / hDn | [4394493,4395081) | `3ac10d58371329479baf25f1df3c01c5f9cde0c010fe32ff8e36803fd690c2b6` |
| shared / XOn | [4430364,4430606) | `db3cfd3ba1f166b36872b8e0ce22c55231825b77bf03a9761389e2e9424a56dd` |
| shared / ZOn | [4430606,4430907) | `17e3d3056c69ac79254f25ba63729718bb5c1d8e175821ec7d3ab9de207912cf` |
| shared / QOn | [4430907,4431120) | `1f9768062892df70c1c7cdb3e4ff205a91530424579c25fb4d4f85f4c87aedd5` |
| shared / $On | [4431120,4431359) | `ef396f72d9d5deab0fb961820c0924d0980c2b97c587b78fe4eafafd764d5a5d` |
| shared / ekn | [4431359,4431434) | `9302794842a8225335f99614da3b6b1d9a45265696a4fa5a4fe5cda930790983` |
| shared / tkn | [4431434,4431914) | `e3dc5667ce7191d22dd26d6f9201dbec9247bb7e5041eda9d97edf62a746ced5` |
| shared / nkn | [4431914,4431993) | `6a2a9fd15d441ae5c40ac6456a5e4eea9fd2783560c27833f405840f2d824afe` |
| shared / UTn | [4365089,4365404) | `3c3adabfa78242671853aaf325f2c2f7a3ac68687995d672e62b7df601486baa` |
| shared / vDn | [4395923,4396239) | `b65ff78cc5b1513500837efec2e5f0bcec8b66aea62f1806209b999ea7bdee44` |
| shared / Rjn | [4486255,4486774) | `57d1511fea23c128e9608cdcbeb143f9dfa918e553a6f3471e4e6196f92671b7` |
| shared / Ljn | [4485713,4486255) | `a8856c9d51626576107df947d0e4e3ad636e7310fe178c2714e043fa76c7c706` |
| shared / Ijn | [4484948,4485713) | `5611c2cee71f0ae4b1a97bb3cb8e81c40a07d127ef3d7dc7ba878173e7ea3850` |
| shared / NDn | [4399428,4400034) | `e9a07fadb150da9ddea7a0a99f7741adb0f40cdecc53fe9491d2e499def02332` |
| shared / lEn | [4373978,4374298) | `632ef8e2935ce0bca0e27dcb8e7c64a4c7326ffc23a87e8f236dbc6920bb6aad` |
| shared / xOn | [4410940,4411769) | `527199e20c27af1af181efca801bf1fc19c3b22d0e5c98c57e1119366db93733` |
| shared / lMn | [4493031,4493122) | `8e06004b21eca36abe22150f457ce59e63e736e49990f84c4df4952bbbcad0b4` |
| composer-content-96b7e1cbf204.js / getText / getPersistedText | [378576,378855) | `06c5a8306cc9130bd3dd670efd410bced7cd1d3a3d90777039a0122fd3e8cef1` |
| composer-content-96b7e1cbf204.js / it/at与历史ot | [381317,381537) | `80dcc309edb9f20802d3d311d037bfe33cd1dfbb74d5c9c206372a497cf6f68c` |
| composer-content-96b7e1cbf204.js / context生成与openingPromptForHistory | [382300,384050) | `65a9dbdda0e73afa905a0e43536518d4779b54cc960d2a73eb2f942f065f7820` |
| composer-content-96b7e1cbf204.js / optimistic文本与U.submit | [384631,387900) | `b8abbc0e3039ff1c3f7abc3883be43a9b574362fae3575a527f38a3e802acaf3` |
| user-message-bubble-69113155ff5a.js / 完整成员 | [0,3482) | `e60e615c4b9d31cf6bc88c99457dc12292d94d556867229ddb1e071b3f03388e` |
| user-formatted-text-9c067d7eaaf3.js / 完整成员 | [0,2647) | `95ba36402820429d0e3271284984a501c6c942a48d49ac7034857feb082217f2` |


| Member / helper | Byte range | SHA-256 |
|---|---|---|
| initial / zla | [6213118,6213341) | `b0f2edf77143b8664b6053df5e19006cfdadbb3b8bd03c9fb3b983ea965181e9` |
| shared / JAn | [4467475,4468101) | `157ca785690949129746a241554ed318594cab8d93ffa234ef0b4ca3265225c2` |
| shared / Qjn | [4489946,4490426) | `da8b3a560d2c70608332e070199829ce117af74e81411e11523c22a610c9b239` |
| shared / $jn | [4490426,4490714) | `18fedca351ef3b9e97b5aaab0798db6e716253c1b3397e8184645308eec05fad` |
| shared / SMn | [4496827,4497820) | `c412c02c49bf8ff8dd7088eb2a3f2f90d3cdd95a78d67f4c19120ec27cc02820` |
| shared / CMn | [4497820,4497992) | `06e2b85b27857b7e754027b59192d3f9c52e946180daa34932ba60873249be41` |
| shared / wMn | [4497992,4498088) | `2ea49685f26b5962d61909c2d8abdc27729db7021c1155401aa410e582f768e9` |
| shared / TMn | [4498088,4498158) | `743e132b716f18a9cf6d79806c6becb41d0d76847a034cf633647adf4de8ed30` |
| shared / EMn | [4498158,4498365) | `a39ef1c05360d4290ea7a5dd487a032dc2d73a9c20366a5f0f3cacd5f1dda3ca` |


## 13. 空输入的队列快捷键（2026-11-05）

本次基于既有 REA 抽取成员做只读 AST 追踪，未运行或修改原应用。composer 局部 `_w` 是 **app-primary** 的 `Ow`（`UHn`），`Bw` 是同成员 `Vf`（`Thr`）；不能从 app-initial 的同名导出猜测绑定。composer 的定向 REA parent 为 `ev_1cecef535f4de6d290ec9acf4de2f387d405d8fb226d7e0053aff918cb8d06e5`，summary 为 `ev_36395e22dadbf0ad9048e32f51171bd9c451e132ed412e6199c8d092d3f3a698`：仅选择541,451 bytes、1个JS，解析失败0，17,533个文件未选择，semantic caps为20k，覆盖partial/truncated；另保留7个无关native addon声明hash mismatch。下表的依赖结论来自原成员精确字节与AST复核，不宣称该REA语义图覆盖依赖模块。

`UHn` 的 visibleMessages 来自 initial `Rga`，对原队列执行 filter，保留原有顺序。过滤自动start条目、已经通过精确clientUserMessageId匹配的条目；普通条目等待acceptedAtMs/createdAt后250ms，pausedReason及outcome-unknown可立即可见。AnyWork已有独立队列投递状态与服务端FIFO顺序，本次不引入原生全部admission/250ms呈现时序。

- **空输入引导取队首。** composer `mp` 仅在local、response in progress、无文本/附件、无队列编辑，且选定动作为steer时启动 `Hr[0]`。它还排除安全recourse、thread-goal-continuation和Aeon；AnyWork尚未建立这些原生模式的完整等价关系。实际操作走 `Ur.start` → `BHn` → coordinator的精确messageId；不是重建预览文本再发新消息。
- **空输入↑取队尾编辑。** `Dhr` 要求无Alt/Ctrl/Meta/Shift，编辑器无选区，实际DOM光标在文档末尾；先调用composer `Ld`。`Ld` 排除Aeon、内容、评论上下文和已有editingMessageId后调用 `jd(Hr.at(-1).id)`。它没有response in progress门禁，因此空闲时也允许取回尚存队列。主提示历史是后续独立fallback，现已按第14节接入。
- **空值依据文档内容。** controller `hasText` 对code_block检查trim后的textContent；普通text同样trim，其他inline节点直接算内容。因此纯空格不阻止这两项操作，但hard_break与引用atom会阻止。空代码块可以符合取回条件；非空代码、富文本正文、选区和非末尾光标保持原键盘行为。
- **AnyWork入口。** 空引导走现有队列steer接口；↑走现有take/restore/replace链路。只检查首/尾原条目，状态不可用时不越过它改操作其他行。pending操作由共享队列锁去重；sending/uncertain继续禁用投递或编辑。取回保留Markdown/JSON和附件，撤销恢复先前主草稿，重新提交恢复原FIFO位置。上传附件显示名按本项目files::upload明确的uploads/<同会话ID>/<UUIDv4>-<原名>存储规则恢复，普通工作区文件保留完整basename，实际路径不改变。
- **迟到与移动端。** 等待take时继续输入或切换会话，先restore原条目，保留当前草稿。空引导等待期间不清空后来输入，要求已确认running/waiting；starting连接中不从空框启动队列投递。空引导在带并发/会话保护的请求中向本地服务确认running/waiting，确认期间新输入或任务转为空闲则取消；避免初次页面刷新statusFresh尚未更新时错误吞掉快捷键。编辑中的空草稿禁止引导/取回其他条目，已归档会话禁止键盘提交/取回。输入法、229键码和结束冷却保留；手机普通Enter继续换行，外接键盘Cmd/Ctrl+Enter按当前queue/steer偏好反向选择。空框中的停止按钮继续中断任务。

原成员完整SHA-256：composer-content `3b2de4c008809246d38deb7732b9a13a250ccbb0be1a8f0687bfa86a2880329b`；app-primary `13d4eaac047bffc5a99d5f2207db7d646a9dc26c5bd259ee707653897a1691f7`；app-initial同本文开头。下列为UTF-8半开字节范围，非源码行；只记录定位和摘要，不将原成员并入公开源码归档。

| 原成员 / helper | UTF-8范围 | SHA-256 |
|---|---|---|
| composer-content-96b7e1cbf204.js / Ld | [496251,496339) | `4e0e1906e9f572fa8e5c96da7f7db0c2eea8b7717f80088faec02f9bda5ca3fe` |
| composer-content-96b7e1cbf204.js / Xd | [496929,496976) | `640f5d3400e7cd45137792387930a20d866e7ac91a22ea7fca302bc025b77ed1` |
| composer-content-96b7e1cbf204.js / mp | [503242,503513) | `8751ab0406460170b7b508e68f055a227cc0eb4cf7776903e729a8ef61b88fad` |
| composer-content-96b7e1cbf204.js / Xq | [539829,539863) | `c5afcb7b64d0356cbf60960e8b407cae54ea0998683be096a38cae1797821f4f` |
| app-primary-1309b9ae7c5f.js / BHn | [2159718,2161454) | `81bdfa89b113324e33064f967219dcf2fbb05bdbfa2a5e180fe4991dcbd89b10` |
| app-primary-1309b9ae7c5f.js / UHn | [2161593,2163342) | `b64f8037951aed9c93f8a07f0e911c29098047690b5934731f57c5eb3c20aa00` |
| app-primary-1309b9ae7c5f.js / Dhr | [3201126,3203033) | `bdb95431c35317924c87fbd294867ebb19661cfdfbebbcb099b71af23564b994` |
| app-initial-61c1d0e6137e.js / Nga | [6404282,6404426) | `a9ceabc78734f8dbed4ac7f74b56cd470d1b8531ba08d4fad30973ba9fdb125f` |
| app-initial-61c1d0e6137e.js / Rga | [6404948,6405226) | `f19c133aa4f4ed305689ce3c5c4de2982e6285a264addd4244db8b90efef4bf7` |
| app-initial-61c1d0e6137e.js / hasText | [10165102,10165313) | `4c4a44721e6f792f12c0c5d70931f26d0b6c2568681f6b2e7482db78b41c6cc4` |
| app-initial-61c1d0e6137e.js / isCursorAtEnd | [10169181,10169478) | `a9c1ccd3c85497d2f1c9902c2977ea237cfd63c592154b8a765bb742c21cc343` |


## 14. 主输入历史 ↑/↓ 回溯（2026-11-05）

本次复用原包只读静态抽取，定向 REA parent 为 `ev_90e6cf2688e03fe804ca3969284b681d3c47ba15de115ef6cd8778ed6d097fe0`，summary 为 `ev_d4f5de5b9d0bcd12fb25032e277b6fc5d82419d24bb52398093b7d1da30aac33`。只选择 app-primary 成员，读取4,629,527 bytes、1个JS，解析失败0；17,533文件未选择，semantic nodes/unknown均受5000 cap限制，覆盖partial/truncated。保留7个无关native addon声明hash mismatch，未运行原应用；下表中initial与composer依赖由已核对成员的精确字节独立复核，不扩大REA语义图覆盖范围。完整成员SHA沿用本文第13节。

- **范围与容量。** `Thr` 使用当前thread ID，只有无thread才回落global。`Shr` 仅在global读取旧数组；`Chr` 忽略trim后空文本，保留重复尝试，每个范围保留最新20条。更新范围先删除再追加，只保留最近100个会话范围，global及chatgpt-global不参与淘汰。AnyWork另按连接服务器隔离，保存在当前浏览器localStorage；不从服务端历史消息猜测输入历史，也不把附件存入历史。
- **记录时点。** composer `xG` 在backend提交之前记录persisted text与PM文档并重置导航索引，因此发送失败仍保留一次记录。AnyWork在发送前状态检查通过后、实际messages/queue replace请求前记录；普通新消息、排队、引导与编辑后重新入队均适用。空框队列引导、取回队尾不追加历史。主rich条目保存Markdown及JSON，旧plain与string保持各自恢复路径。
- **键盘门禁。** `Dhr` 要求无Alt/Ctrl/Meta/Shift、无选区且实际DOM光标在文档末尾。↑先尝试队尾取回，回调不处理才进入历史。历史首次只接受↑，并要求persisted text的trim为空；从最新条目开始，↑越过最早时循环到最新，↓从最新清空并退出。与队列hasText的语义空值门禁不同，rich空格可能序列化为`&#x20;`，不能只按可见空格判断。AnyWork保留输入法、229键码、结束冷却和只读状态保护。
- **编辑保护。** 事务后及下次导航前均比较当前persisted text与所选条目的`Ohr`，不同就退出，不继续覆盖草稿。包括JSON优先恢复后与保存字符串不一致、旧字面文本恢复后生成不同Markdown等情况；不能为了保持轮换而忽略不一致。切换服务器或会话也清索引。
- **恢复优先级。** JSON通过当前schema校验且顶层为doc时优先，替换文档内容、光标置末尾并聚焦；无效JSON按显式markdown/plain回落。旧string只在引用识别为真时走prompt parser，否则走setText。AnyWork的setText对应`XX/sua`：行内格式、标题、HTML保持字面，识别缩进列表、延续段落及闭合反引号代码围栏；tilde围栏不当代码，任务标记保留为普通列表文字。历史切换只更新文字/文档，保留当前附件。
- **本地持久化。** 存储不可用或写入失败时保留本页内存记录；成功保存后清除或损坏存储不再复活旧内存历史。非法条目过滤，范围按own key访问，`__proto__`不改变对象原型。刷新后读取当前浏览器记录，其他浏览器不会自动同步。

边界：本次覆盖普通现存会话的主composer提交；原版后台/opening prompt的`first`插入路径尚未接入。旧string引用检测使用本项目parsePromptText替代原版Dnt lexer，少见或畸形引用、所有复杂嵌套列表/围栏、旧模式迁移尚未证明完全等价。普通历史消息编辑器和目标编辑器没有接入主输入历史。以上静态证据与AnyWork浏览器验证不构成完整原应用运行态或逐像素1:1证明。

下表均为UTF-8半开字节范围；不将抽取原成员并入公开源码归档。

| 原成员 / helper | UTF-8范围 | SHA-256 |
|---|---|---|
| app-primary-1309b9ae7c5f.js / Shr | [3200109,3200174) | `45d011ac0ad2434141078f8c71923eaf69241b1de4619c7d4d14d0e86ad0245b` |
| app-primary-1309b9ae7c5f.js / Chr | [3200174,3200492) | `614a9cca9a592ab42090ec2bd05d8d432f12429bd078bec1df9ad8b45a8108f2` |
| app-primary-1309b9ae7c5f.js / Thr | [3200587,3201046) | `ed7078bb77a8e9bdf33fec07a0623947bb4bfed216c6cf87e5d77eaeb9d302c2` |
| app-primary-1309b9ae7c5f.js / Ehr | [3201046,3201126) | `660153152390d04906f3a40b2c42224973aac0562eff203935bdeca2b75615fb` |
| app-primary-1309b9ae7c5f.js / Dhr | [3201126,3203033) | `bdb95431c35317924c87fbd294867ebb19661cfdfbebbcb099b71af23564b994` |
| app-primary-1309b9ae7c5f.js / Ohr | [3203033,3203111) | `1027c3d25f1cd83199a9cffd345054d45c04c5567ad7012908a98760bce6970f` |
| app-initial-61c1d0e6137e.js / XX | [6222964,6223082) | `04a9d95a256cf4ab5cc70714841ea6965df73021f6bae39e20544178b69fafa8` |
| app-initial-61c1d0e6137e.js / sua | [6227391,6228859) | `6f727428e1883e14e0852ae1c0d8801554a2572357d5cee6db04c853ae510d67` |
| app-initial-61c1d0e6137e.js / cua | [6228859,6228983) | `2c854dfa143f6a92cded4deea70c1cd70586371fef9b2246c357435fcbf50259` |
| app-initial-61c1d0e6137e.js / lua | [6228983,6229112) | `e1655a286d285a3816b48fd635814b547bc936e1992ac6f8f9dce0e97f395093` |
| app-initial-61c1d0e6137e.js / uua | [6229112,6229322) | `17604b6bd727cbd1507425d5ce81e7d800f615122cb06aec4c3558f81fd285f1` |
| composer-content-96b7e1cbf204.js / xG history snapshot/append/reset | [381317,381537) | `80dcc309edb9f20802d3d311d037bfe33cd1dfbb74d5c9c206372a497cf6f68c` |


## 15. 行内链接动作与编辑浮层（2026-11-05）

本轮继续只读分析同一原 ASAR，未执行或修改原应用。定向 REA parent 为 `ev_65fdbfbd7672dfa6f04f45b632db25be80879260af477a93f766c9a34ead871d`，summary 为 `ev_ffe5628127365f15760d67abd49903f729ebe0afef5677fa14e694e19052f964`。请求只选择 app-initial，语义节点/unknown caps 为 3000，分析 worker 在默认1024MiB堆上耗尽内存，**未取得完整应用语义图，不能声称解析失败为0或语义覆盖完整**。17,533个文件未选择，7个无关native addon声明hash mismatch继续按record-and-continue记录。以下结论由已提取成员的精确UTF-8字节与独立Babel AST静态复核取得；REA失败不被当作支持结论的成功语义证据。

- **入口与焦点。** `lsc` 对非loading的richLink、`text-link-href`文字链接和`data-breakable-url`注册点击/聚焦后的Enter、Space；记录displayText/href并展开浮层。关闭后恢复仍连接的锚点焦点，否则回到编辑器；切换会话、只读和锚点卸载时取消未保存编辑。原版richLink的Codex thread URI可走专用导航；该分支的本地Web导航在后续第16节接入，跨host分发仍有边界。
- **同一浮层的三种状态。** `esc`的actions是横向分段按钮：打开链接、编辑文字、编辑链接。只有有效HTTP(S)显示打开动作，mailto仍可编辑。Codex模式按钮高28px、内间距6px、图文间距4px，外框8px圆角、相邻按钮1px分隔。编辑态为27rem宽、受屏幕宽度约束的圆角输入条，左内间距14px，右侧原包勾选保存图标。定位在锚点上方居中，碰撞留8px、空间不足时翻到下方，手机按可视视口重排。
- **保存与取消。** 文字trim后非空才能保存；网址trim后为空时仅移除链接，保留显示文字和其他marks。非法网址保留编辑值并显示危险边框和可访问错误，允许HTTP(S)、mailto和有效Codex thread URI。编辑态Escape退回actions，再次Escape关闭；外部点击/聚焦关闭。输入法确认不提交、不传播到父编辑器。原版编辑链接click显式preventDefault；AnyWork同样取消默认行为，防止React在切换页面后复用为submit按钮而立即提交。
- **文档事务。** `Tac.updateLink`按live DOM位置更新文字mark或单个richLink，拒绝已离开编辑器的锚点。文字链接保留非link marks、title/sourceAppId及其他元数据，清除旧autolink与literalMarkdown来源；移除仅删link mark。libraryFileId且href不变的richLink只改displayText。其他情况经VX重新识别来源，并保留serializeAsUrl；显示文字等于URL且未强制URL序列化时可转为href=null的breakable mark，其余普通网址转为文字链接。不额外插入closeHistory事务，撤销合并仍由正常ProseMirror历史处理。
- **显示和复制分离。** `ola`的live span/内层label和`Xca`的每段相同link mark首个图标适用于rich主输入及PZ历史编辑；图标为widget装饰，16px、文字间距3px，不进入文档或剪贴板。schema的HTML复制仍输出a[href,title]。加载中的richLink采用原包spinner、aria-busy及1.25秒动画，减少动态效果偏好下静止，不提供链接动作。提取静态SVG时同时保留原viewBox、fill和path，地球图标继承currentColor，避免只提取路径造成不可见。

本轮已接入打开/文字/网址/移除、焦点/取消、富文本格式与撤销、主输入草稿/实际提交和普通历史编辑。仍有边界：原包完整provider图标与异步加载注册表、跨host及原生窗口级thread分发、Mrc的完整选择几何/所有clipboard分支尚未逐一复刻。普通链接当前共用原包通用地球图标；原包内置浏览器分发以Web新标签替代。已有静态规则及自有浏览器验收不证明所有会话状态已经1:1，语音继续按用户要求延后。

下表为原成员UTF-8半开字节范围。`updateLink`记录成员内精确方法，其他记录静态声明或SVG函数。只公开定位与摘要，原成员及本机反编译工作区不进入源码归档。

| 原成员 / helper | UTF-8范围 | SHA-256 |
|---|---|---|
| app-initial-61c1d0e6137e.js / IPr | [4604540,4605272) | `ebf6214859ac38eaf0ef39df0d24314dcf65a7c6cab695c6beb803410acd4b46` |
| app-initial-61c1d0e6137e.js / kL | [4606017,4606432) | `a45f89dc4fa1f197142b995b227a7fe601dfd326bcd492ea197c4d39124060c8` |
| app-initial-61c1d0e6137e.js / tla | [6199127,6199558) | `836ccaf0f1c0c918e956d854357df9dd7bcb162f5d717c8ccdbb56452e09ef59` |
| app-initial-61c1d0e6137e.js / BX | [6199603,6199740) | `30dee773267e5d761fa32c14ab9226de7a7fb5d93568a8696879feccb373374e` |
| app-initial-61c1d0e6137e.js / VX | [6199740,6199936) | `21e20ac5cb70b40312ca5e1ff01699e66b4855b207c72b581f1fd07ba6857ef1` |
| app-initial-61c1d0e6137e.js / rla | [6199936,6200028) | `f732e58dacdd1812c11c4b0b84fd9666df65a17545adde40d54b9b852f9a5814` |
| app-initial-61c1d0e6137e.js / ila | [6200028,6200198) | `9f3c754a639e2f5a2c4f7ab86fb1d0a3eb979db3f2b47d6f5d831121b436d50e` |
| app-initial-61c1d0e6137e.js / ola | [6200291,6201031) | `c61ec7e7aa084282cfdfed9ab165844afc537f9105d07d4f21fbd4e8855f6616` |
| app-initial-61c1d0e6137e.js / Tac | [10140171,10153275) | `3c53382ee20329703699ed82b59bd77f4f10e902025079fb251bde3d3c557ddd` |
| app-initial-61c1d0e6137e.js / updateLink | [10175934,10176936) | `1d3e00fdc28a265d13c889ccf5379598a4b6fe5277fa011050fc7cc6e84ad5ba` |
| app-initial-61c1d0e6137e.js / esc | [10212417,10218056) | `df4b3e3e5b4159d75a2dc4348eae27921918d97a40be18d1a74a91eca4e5332d` |
| app-initial-61c1d0e6137e.js / tsc | [10218056,10218091) | `acd75cb3240370fcfbd94f479c114fd5baf43d0b55caff0360d121e9d42dcdcf` |
| app-initial-61c1d0e6137e.js / lsc | [10218523,10224121) | `d53c74f6f65bbdb6b12b384bc2ce9266a59dd652bd7967aea47224ba4d7f8b44` |
| app-initial-61c1d0e6137e.js / wJs | [9673488,9674860) | `a6c8dce855458771603e7de2bb82c42db9376f1f72ad102dffd4346bcb1aa609` |
| app-initial-61c1d0e6137e.js / Yoc | [10209999,10210585) | `4d35ddfbd1f1ef54511e11ca86f1b4b6185d7e1a93f1dc1f9eeef5a8ff6ce2e3` |
| app-initial-61c1d0e6137e.js / Qoc | [10210656,10212410) | `be7c4fe0064c60848d6dbd75578fbcf0e83df5041a5fbd8b9825d20f16b07dd2` |
| app-shared-e711d01481fb.js / $$ | [2348959,2349585) | `05d85929ac0b23600f82efa143217b0f2df0e3a246b9ec8d18a6ff0a9abb016f` |
| app-shared-e711d01481fb.js / vmn | [3827501,3829069) | `da99581f5eb4f5b05099e9203e158e85dbaf6a48c101f017eab48e63a02b5c35` |
| app-shared-e711d01481fb.js / C3 | [4215114,4215711) | `abf1e7887e04c8abf7e0fc5b0ec89ee23fdcb27b14c7cf777daa1ea436305b45` |


## 16. 输入器内的会话引用导航（2026-11-05）

本轮提升只读分析worker堆至4096MiB，对同一ASAR内的app-initial重新作定向REA分析，参数与上一轮不同。parent为 `ev_b38205ee9f656a6b080ffcce1cc1baa8dabacdc377b7d68d73f5debb090c19fd`，summary为 `ev_acd022afc8944d8b4bf4b8767e05c01ff1129449d1c7cc2de36332acfdaccf08`。读取10,859,750 bytes、解析1个JS、0 parse failures，visited AST nodes为2,945,289。17,533个文件未选择，semantic nodes/unknown caps均3000；primitive string-byte预算1,048,576触顶，应用关系与语义图仍partial，不能将解析成功当作完整数据流证明。7个无关native addon声明hash mismatch继续record-and-continue，原ASAR identity未变，原应用未执行。新增函数字节与导出别名由独立Babel AST复核，尤其不能把同名本地CL或USt直接当成另一成员的同名导出。

- **richLink与文字mark分流。** `lsc`仅在锚点有rich-link-href且tla验证成功时直接调用CL，不展开actions。普通text-link-href即使存放同一Codex URI，仍进入第15节浮层；HTTP打开动作不会因此出现。加载中的richLink继续不参与动作。原节点显示为role=link、tabindex=0，不附加button的aria-haspopup/aria-expanded。
- **严格URI。** tla先trim，要求codex://threads/前缀、没有空白，随后经shared导出USt（本地a9e）取得conversationId；精确单段pathname、没有hash、仅允许hostId且最多一项，并对解码hostId执行原字符规则。review/path/diffFilter等是通用桌面路由的另一分支，不作为composer的直接导航入口。AnyWork复用既有promptThreadHref校验，提取threadId/hostId，不另放宽解析器。
- **原分发链。** 此处CL是initial本地wrapper，转CNr，再由TNr和wL计算onOpen/修饰键及open-in-browser分发。wNr在平台主修饰键或中键下产生new-background-tab，合Shift为new-tab；dfe来自shared导出_F（本地Byn），按平台选择Meta或Control。这里仅证明静态分发参数，不声称已复刻桌面窗口、远程host注册、内置浏览器或所有onOpen消费者。
- **Web本地会话映射。** AnyWork当前每个服务器连接一个本地Codex工作区。hostId缺省或local时，只按当前服务器的agent=codex、原始thread_id精确匹配，不按标题或AnyWork自己的session id猜测。已归档会话可以打开，归档状态不变。当前索引缺失时只读刷新sessions一次；仍缺失或有多个对应项则提示并保留草稿，不创建、fork或发送消息。非local host明确拒绝映射到本地，跨host自动切换仍未实现。
- **主框、PZ和并发。** 所有PromptEditor通过相同上下文导航；点击或聚焦Enter/Space均在父提交逻辑前消费事件。跳转使用既有select/按会话保存草稿链路，原主框文档和目标会话草稿分开。未命中时的只读刷新可取消；会话/服务器变化、组件卸载或新的会话引用动作会中止旧请求，迟到成功或失败不跳转、不覆盖后来错误或草稿。普通链接浮层维持原行为。
- **Web新标签页。** 平台主修饰键或中键打开当前Web站点的codex-thread/<native-id> hash路由，以浏览器已保存的连接完成鉴权和索引映射，URL不携带token或文件路径。新页解析成功后replaceState，再选中服务内会话，避免Back返回中间解析路由并反复跳转。Web浏览器决定后台/前台标签页及弹出窗口策略，不能将此声明为原Electron窗口焦点控制的完全等价实现。

新增浏览器场景采用独立API夹具检验真实页面跳转、主草稿/文档保留、键盘、普通文字链接分流、外host、缺失/歧义、延迟索引、换会话后迟到响应、中键/修饰键新页、直接Web路由、Back和历史编辑入口；它们不调用真实私人会话。原服务端thread_id来自已有本地Codex索引，本轮没有修改Rust发现或控制协议。后续消息正文中的通用Codex链接、跨host路由和原生窗口管理仍需独立对照。

以下均为原成员UTF-8半开字节范围。shared的a9e/Byn为已核对的实际本地导出实现，不能用本地USt/_F代替。原始成员仍不进入公开源码归档。

| 原成员 / helper | UTF-8范围 | SHA-256 |
|---|---|---|
| app-initial-61c1d0e6137e.js / CL | [4574416,4574453) | `5abde35ba727212c31374f400b952c1862a5364cd8799b51b8244adaa4d65957` |
| app-initial-61c1d0e6137e.js / CNr | [4574483,4575444) | `7ad0d21ff024024640b7336f631f53e8944a1d8ed6731242560ff36e6e8ad8eb` |
| app-initial-61c1d0e6137e.js / wL | [4575444,4576150) | `65d4c3e0890980a4b280a85f3a3eacdc80c1c7d8efab70ccb79a53578b4ec494` |
| app-initial-61c1d0e6137e.js / wNr | [4576150,4576239) | `6b48054a36a5b2c677352a2da6b66fd67c83595750c38422c3d2f307ea22300a` |
| app-initial-61c1d0e6137e.js / TNr | [4576239,4577428) | `21d6a4b79dfd9622f4f56931997ad31c64535e9c54729732cf7e71764003997e` |
| app-initial-61c1d0e6137e.js / tla | [6199127,6199558) | `836ccaf0f1c0c918e956d854357df9dd7bcb162f5d717c8ccdbb56452e09ef59` |
| app-shared-e711d01481fb.js / a9e | [1715506,1716263) | `443eb825cf43338cd3e95ce5de86d34d13573b26f947ebb384db8d34e7d4d464` |
| app-shared-e711d01481fb.js / Byn | [4214928,4214981) | `3c40f9e24a17445507a1391b398eadb15f3bd27af21e9bbbd2f65d282792c2c7` |


## 17. 消息正文中的 Codex 会话地址

2026-11-05继续使用REA技能与原ASAR静态字节，不启动原应用。定向解析 `webview/assets/user-formatted-text-9c067d7eaaf3.js`：parent `ev_d59a4d290d97a45b653d14603b0e0caa218823f200665c4f456f4f8ab134fa4c`、summary `ev_411768f47107f5fc6368afffae95b6556d20e1c85d25a52349bc3f3dc1f001b6`；读取2647 bytes、1个JS、895 AST nodes、0 parse failures，17533文件未选择，semantic unknown caps1000触顶，整体应用与语义关系partial。7个无关native addon的声明hash矛盾继续record-and-continue；未执行这些文件。app-initial的大模块沿用第16节REA证据，新增调用链由独立Babel AST只读定位，不将未选择依赖说成已由本次REA完整分析。

**绑定与调用链。** user-formatted-text导入app-initial的`dl as c`与`ol as l`；实际导出绑定分别是本地Dtc与Anc，并非该模块另一个本地dl/ol。Dtc→ktc→Ctc为Markdown组件创建`a:Bxs(...)`。Bxs先处理review外部PR地址ogs与Ims的各类提及/文件，再使用Hzo→Uzo→Kzo；Kzo传`initiator:markdown_link_click`，默认ML→JPr→YPr最终使用真实`a`，附有href、target=_blank、noopener/noreferrer，主点击与中键经xNr→本地CL/TNr/wL分发。原生`codex://agents/`的agent提及另走Mms/IUo按钮，并非本节实现的threads链接，不混用其Space/选择防误触行为。

**正文和输入器校验不同。** shared导出USt对应本地a9e；其schema `_et`在初始化时定义：conversationId匹配大小写均可的UUID，host严格threads，protocol严格codex:，pathname按`split('/').filter(Boolean)`后只允许一个段；没有composer tla的精确pathname、hash和query白名单限制。`view=review`保留审阅意图；diffFilter只有branch/last-turn，否则catch(null)。只有合法diffFilter时才带非空path；没有filter时忽略path。未知view或filter不会使会话UUID本身无效。输入器仍使用独立的严格tla，不因正文支持而放宽富链接语法。

**AnyWork行为。** 用户和Agent正文中的合法threads地址现可点击或以Enter跳转当前服务器对应原thread_id，保留富文本标签、作者提供的title与原href；普通文本/HTML复制仍由原复制实现处理，不把Web内部路由写回正文。用户codex-text-link包装仍仅在user规范化路径解开，Agent内容不自动解包。中键、平台修饰键和Shift使用第16节无凭据Web标签页路由；浏览器控制焦点与弹窗策略，不保证Electron的前后台窗口语义。链接与输入器复用索引刷新、草稿及取消/迟到隔离，不提交消息、不新建或fork会话。Markdown文档预览共用此renderer，在连接上下文中也可打开本地threads；尚无原生文档预览caller的完整对照证据。

无有效href时按原Hzo分支直接显示children，避免href空字符串重新打开当前页面。协议白名单只新增经过独立校验的threads地址；javascript/data/非法UUID/多余非空路径段不会成为可导航正文链接。localFileTarget继续拒绝非file scheme，library与本地文件优先规则保持原有实现。折叠用户消息保留a[href]语义，以便已有inert/aria-hidden逻辑阻止隐藏内容导航。

**尚未完成。** 正文schema能识别review/branch/last-turn/path，但现有工作区git面板不等于原生审阅面板，本轮不将它静默当作目标。点击此类链接会保留会话和草稿并明确提示尚不支持；在异步解析中的后续review点击也先取消旧导航。hostId为非local时继续拒绝本地映射；hostId这一Web保护并非a9e原schema的一部分，原生跨host路由的全部caller仍待核对。外部HTTP内嵌浏览器/Alt分屏、Codex agent提及、原生上下文菜单和hover provider均不在本节完成范围。此处不是完整1:1验收。

只读UTF-8字节定位如下（原成员第1行，半开区间）：

| 原成员 / 本地符号 | byte range | SHA-256 |
| --- | --- | --- |
| app-initial-61c1d0e6137e.js / Bxs | [9145003,9145924) | `16ee50fd3211b1e5d621815f1a7b3f050d4872bf52edd844e78f8046f67c98c3` |
| app-initial-61c1d0e6137e.js / Ctc | [10049990,10050865) | `604bda2756ac86bb0f84e70229b6ea17c2bca0feff97029a355dd43add3d0515` |
| app-initial-61c1d0e6137e.js / Dtc | [10051035,10051293) | `2b0275aba6a30def6b57f9ed215891e0824732fd665cd952626d2a02d4e1443b` |
| app-initial-61c1d0e6137e.js / Hzo | [7989826,7991791) | `30651695eefd7ec1fecf922a3fdb67eb8d2a71cdfa5cae7c7a137a11d0eea75e` |
| app-initial-61c1d0e6137e.js / JPr | [4610566,4610823) | `7bb2e949c9503771558210139d29ab50f079bfa52b1418b5b55c084ebb7ebe3d` |
| app-initial-61c1d0e6137e.js / Kzo | [7993121,7996308) | `8378497eeaa6a5e898fe929aaa017f9cce8c9d8edb5446caa0f55f575a2938e3` |
| app-initial-61c1d0e6137e.js / ML | [4609950,4610252) | `7e0a0a265975b39cabb9c08db7c239e75e9972d4d2db882615a86c748f7d7950` |
| app-initial-61c1d0e6137e.js / YPr | [4610823,4613770) | `0158b9a126474d1f05ae3ab68d4e88deb99abd04d8676bf71b24a1e0ace54e56` |
| app-initial-61c1d0e6137e.js / ktc | [10051380,10055156) | `f63770a35084bf2eb134c6d8cf24be62882e5bcfbdb303388081b43f6642ad44` |
| app-initial-61c1d0e6137e.js / xNr | [4574144,4574416) | `07e8af94291ea10f3cbc17ac8ea1929a13a26146a0af4fa0f5e4179229106a4e` |
| app-shared-e711d01481fb.js / a9e | [1715506,1716263) | `443eb825cf43338cd3e95ce5de86d34d13573b26f947ebb384db8d34e7d4d464` |
| app-shared-e711d01481fb.js / _et assignment | [1721724,1721953) | `cba45d0064e6616911e6204e38ef989ac7f362da9affebfa0631de2575273321` |


## 18. 会话审阅分屏与差异来源

2026-11-05在第17节的消息地址基础上接入review目标；第17节当时“明确提示尚不支持审阅”的行为已被本节替代。使用REA只读分析原ASAR，未启动或修改原应用。parent `ev_38e2bab2b3eafaec588c6179f5af1dfa6ffcc029b50d964cc1b8472d70db282c`，summary `ev_eb7d61f3ac450bb551463e776dab23df068dc502712641f33323cb3ad38be8b7`；定向选择3个JS，65356 bytes、20818 AST nodes、0 parse failures，17531项未选择；nodes caps每文件3000/总5000、unknown caps每文件1000/总3000触顶，关系partial/truncated。7个无关native模块的原始声明hash矛盾继续record-and-continue。被选择的review-f5ee成员实际属于其他workspace发布功能，未用它推断Codex审阅交互。其余成员、initial/primary与worker由独立Babel AST和原始成员字节校验定位，不冒充本次REA全量覆盖。

**来源与调用绑定。** review-header-source-controls列出last-turn/uncommitted/unstaged/staged/commit/branch。initial本地lYa从last-explicit-review-diff-filter读取偏好，缺省branch；last-turn-only范围另有强制规则。jQa在last-turn时读取jXa，其余来源进入E1 summary查询；jXa通过YYa读取nXa，空补丁返回无diff，非空才进入_Ja parser。RYa写入nXa与cwd，实际导出qut；primary导入为X6e，本地x5r用lastTurnDiff/lastTurnCwd更新它。已追到该effect，尚未完整追到供应lastTurnDiff的所有caller。不能把initial另一个本地k1与同名导出别名混用。

**Git比较。** 原worker本地SM使用branch共同祖先、staged的--cached、uncommitted的HEAD或空树、unstaged的无基准比较；SL在branch/uncommitted/unstaged包含未跟踪文件。worker的ES→Ey按origin优先选择remote，先缓存remote HEAD，再可能查询remote，最后回落现存remote main/master。AnyWork采用同样比较基准与未跟踪文件范围，但默认分支只读取本地缓存与已存在remote引用，打开面板不会向Git服务器发起网络请求；无默认分支时让用户明确选择，不假定当前仓库必有main。

**轮次补丁。** 当前Codex协议turn/diff/updated提供该轮累计统一补丁；ThreadReadResponse的Turn没有等价聚合diff，item的FileUpdateChange.diff为单项差异。AnyWork只使用当前会话/当前轮的累计通知，读取最新更新，保留空字符串；执行中steer的本地回显带原turnId，继续显示同轮补丁；普通新用户消息、新轮次及history/reset不继承旧补丁，上一轮迟到通知也不能复活它。冷历史没有累计通知时显示该轮暂无变更，不用工作区Git或逐项diff伪造。此限制仍然存在。

**Web实现。** 用户/Agent正文review链接跳转目标原thread_id并打开审阅分屏；branch/last-turn/path条件继续遵循第17节的schema。内部Web地址保存来源与目标文件，支持刷新、新标签页和浏览器返回；原会话富文本草稿按原会话保留。手动来源选择存储在当前浏览器，默认branch；来源包括最后一轮、未提交、未暂存、已暂存和分支。只读GET /sessions/{id}/review提供原始patch、仓库root、分支选项和明确的预期空态。面板支持行号、文件折叠/全部折叠、统一/左右对照、换行、Git空白过滤、重试/刷新及文件预览入口，手机沿用覆盖式分屏。中间codex-thread路由仅用于索引解析，解析完成前不向会话API发送该路由；普通hash切换继续保留既有目标面板。请求按服务器/会话/来源隔离取消，轮次事件、可见页面的5秒轮询及重新聚焦更新数据；来源变化时清除旧数据，迟到响应不能替换当前比较。

**范围与剩余差距。** Git命令禁用外部diff/textconv，限定配置workspace内的仓库root；单次输出最多8MiB、stderr64KiB、每命令15秒，未跟踪最多500项并提示省略数。API不执行stage/revert/commit。当前代码表格为独立React实现，尚未复刻原Pierre diff的全部主题、词级高亮、语法着色、全文件上下文、虚拟滚动、评论/搜索及commit来源。原始UTF8文件名与标准Git路径转义受支持，非UTF8文件名明确报错。原生窗口/跨host与外部HTTP内嵌浏览器仍未实现。截图和本项目行为测试不是原应用同内容运行或像素1:1证明。

静态成员与worker函数证据（UTF8半开字节范围，原成员未放入公开源码归档）：

| 原成员/符号 | 范围/长度 | SHA-256 |
| --- | --- | --- |
| review-header-source-controls-ea54ff3ce684.js | 31068 bytes | e2a1a52db2ee3be32a20a99149e93d2b625df24309ef924d6033b9ebeffc4421 |
| diff-source-cfd1243b6fbc.js | 5102 bytes | 09d2d01df161a072b70789f1363d1b17cc68fe0fcdf711cb2791499bbbb19746 |
| review-source-dropdown-859cc13790ed.js | 3104 bytes | ea7a0e49f03fcbe62838b0712fb1b85648b285eea3be05d21ed61bc969f151a4 |
| .vite/build/worker.js / SM | [515000,516337) | 3db852b3a89062af2a243255185573ff07a6b511f2a1ca49901975b7e2748ce6 |

## 19. 提交来源与分支提交子菜单

2026-11-05继续只读原ASAR。REA选择`review-header-source-controls-ea54ff3ce684.js`和`diff-source-cfd1243b6fbc.js`：parent `ev_45d8d6f453b1c72271806df3546c50b0e4ce8ecb47b2f0f1b67dbaa7f413715a`，summary `ev_022d50e27d17bf6b08585ea4cf896e9346892c001c9395eac6b99c72db327b05`；2个JS、36170 bytes、12131 AST nodes、0 parse failures，17532文件未选。语义nodes每文件4000/总6000、unknown每文件2000/总3000触顶，关系partial/truncated；原有7个无关native integrity矛盾保留，未执行或修改原应用。initial和worker结论来自独立Babel AST及原成员字节，不冒充此次REA选中范围。第18节将commit列为未实现的描述已由本节替代。

**原生绑定与偏好。** source controls的`it`使用FlyoutSubmenuItem，`at → ot`渲染branchCommits。导入`Aut as j`的实际导出本地变量是bXa；`Gut as ge`实际UYa；`Vut as P`实际x1，不使用模块里无关同名本地函数。UYa先写x1所选SHA，再调用iYa(source=commit)。iYa明确只在source不等于commit时写sYa；lYa从last-explicit-review-diff-filter恢复常规来源，缺省branch，当前scope覆盖另存。commit不覆盖这一持久偏好。QYa使用branch-commits查询、当前repo与target base branch。

**原生提交列表与比较。** worker的yw先调用SM(branch)取得共同祖先；无共同祖先时返回空数组，不回落仓库所有历史。有基准时执行`git log --max-count=100 --format=%H%x00%cI%x00%s%x00%B%x1e <mergeBase>..HEAD`，输出最多2097152 bytes，字段为sha/committedAt/subject/message。原worker另有250ms短缓存与60秒live cache；Web每次打开子菜单重新读取，未复刻原watch generation缓存。SM(commit)比较选中SHA的第一父提交和该SHA，无法取得父提交时使用空树；SL只在branch/uncommitted/unstaged加入未跟踪文件，因此commit不得混入工作树内容。

**原生菜单UI。** ot有正在加载的禁用status、加载失败及重试、分支上无提交三种分支。列表`max-h-80 overflow-y-auto`；subject截断，完整message作为保留换行的tooltip，时间与subject同排。V2有选中图标和aria-current，已知且非零时可显示增删统计；legacy使用右侧选中图标。Et/kt的legacy分组为last-turn / uncommitted+unstaged+staged / commit+branch；V2为last-turn / branch+uncommitted+unstaged+staged / commit。ct显示选中subject，完整message tooltip，支持max320px inline和full-width两种布局。

**AnyWork实现。** 真实只读`review/commits`共用branch差异的仓库root/default/merge-base解析，最多100项和2MiB，不连接远端；有expected reason时返回空commits及分支上下文。选择提交时`review?source=commit&commit=...`只接受7至64位十六进制SHA前缀，再用Git验证为commit对象，之后只传完整解析SHA。第一父提交/根提交比较使用真实Git，暂存、工作区和未跟踪文件均不进入。普通分支/当前轮来源维持各自行为。

Web来源菜单采用legacy分组顺序，提交子菜单含截断标题、同排相对时间、完整说明title、V2式选中状态，单独滚动上限320px。选中subject显示在工具栏下方；提交仅在当前面板保留，不写常规来源localStorage，刷新恢复此前明确常规来源。ArrowRight进入、ArrowLeft/Escape返回、再次Escape关闭并恢复按钮焦点；Home/End/上下键导航，触屏点击选择，窄屏用同位置返回页，桌面按空间向左/右展开。取消/关闭/切换后中止旧请求；迟到结果不能替换重新打开后的列表或草稿。异步结果只在子菜单自身仍持有焦点时转至选中/第一项，不从其他输入区抢焦点。缺默认分支时提示先选择基准，不编造列表。

**验证与边界。** 临时Git HTTP测试新增6项：根提交、选定快照不混入index/worktree/untracked、合并第一父提交/重命名/二进制/删除、分支相对100项限制与完整说明、空默认/空分支/unborn/auth/root及非法SHA或参数，以及嵌套未跟踪仓库目录不影响其他文件差异。首次新测试受到另一项创建父仓库后未清理的夹具影响，得到预期边界403；补充临时父仓库清理后通过，没有放宽产品root校验。联合浏览器检查另发现工作区内嵌Git仓库时ls-files返回目录而旧逻辑将其交给no-index，导致其他文件审阅失败；后端改为识别目录、计入省略项，不伪造目录文件补丁，测试在finally清理自己创建的嵌套仓库。新增5个浏览器用例（桌面/手机共10场景），包括一项真实临时Git仓库与真实HTTP联通测试，其余用夹具覆盖重试、焦点、迟到、持久化及响应式。

仍未实现原V2全部分组/统计、原flyout悬停时序及provider几何、原tooltip完整行为、所选SHA在后台分支列表变化后的全部派生状态，以及完整Pierre主题/语法/词级高亮/全文件上下文/虚拟化/评论/搜索。当前tooltip使用浏览器title；不是原应用运行对照或像素1:1验收。原生正文review链接schema仍只接受branch/last-turn，没有因新增UI来源放宽commit链接。

静态UTF8半开字节定位（原成员第1行）：

| 成员/符号 | byte range | SHA-256 |
| --- | --- | --- |
| review-header-source-controls / it | [1374,1758) | `7d94683ccc52993da1bc285c38fc0d9196cea7a5cb5ee29e52ec93f249e70b5a` |
| review-header-source-controls / ot | [2587,5283) | `0a492eed8aef8383678aa1af50f60146e185b3484e6362a33080be9c0690fe1a` |
| review-header-source-controls / ct | [5707,6548) | `ead2de3e28a85f61d78ae6a2a842eeeaf4b243c5e63e7f9b05d791634572b48d` |
| review-header-source-controls / Et | [14718,19683) | `0a8ba13798b30a8b6b80e3181984806ce8f89f2122d84fbf70367f5e68d1e2e4` |
| review-header-source-controls / kt | [19765,20982) | `efc83917c526417bc9690b7ff52ac8752a13530e3725230bd330c72ec2c04c31` |
| app-initial / iYa | [7034089,7034229) | `948a9fedcfbc576c1226a904a72fb9d34db46e2c9735a8302e7b427b248831e3` |
| app-initial / lYa | [7034300,7034542) | `88d3ffa65087643095ab0bfdeb182a660345b29bf2f3df5c37ebf4daecc22058` |
| app-initial / UYa | [7041371,7041417) | `bce024c8686096fabea725f06b1f1699663f9d78b581b0c95a65fb128a19e96f` |
| app-initial / QYa | [7043556,7043782) | `fb808dd662ff0038b8f981a4f3c48c378bb165f7b22a58de8d4558c889cd0649` |
| .vite/build/worker / yw | [550912,552132) | `59091b1189e2e7767ee11a9f8e7f8e07233d29e23805da4af9619eeebaad5652` |

## 20. 审阅子菜单悬停与提交说明提示

2026-11-05继续使用REA技能只读原ASAR。定向分析`webview/assets/app-shared-e711d01481fb.js`，parent `ev_f661ac50e4201b35c73aacb749d2deeb9cb91f61a07a42156ab4fb769810a41c`，summary `ev_1fde4c8e3c91c85ad5f05c2f1a34dfa06050e9b1fcda0de31458438a1393b9fa`。此次REA的owned JavaScript worker在约4096MiB heap上限下耗尽内存，分析未完成，不能据此声称解析成功、零parse failures或完整语义图；17533文件未选、unknown cap1500、关系partial。保留此前7项无关native integrity矛盾，未执行或修改原应用。下面的具体行为来自对同一原成员进行的独立、惰性Babel AST定位与原字节摘要核对；提取脚本只解析文本，没有加载原模块。

**实际导出与悬停时序。** source controls导入`MP as f`，app-shared实际将MP导出为本地`$3`，其中FlyoutSubmenuItem绑定`kxn`，并非另一个同名局部MP。kxn的鼠标pointerenter/pointermove在未打开且无pending timer时启动Nxn=200ms；pointerleave取消，ownerDocument capture keydown也取消并设置recourse标记。timer完成后先focus触发器preventScroll，再打开；原事件被preventDefault时微任务取消。触屏不走悬停路径，LTR的ArrowRight/Enter/Space允许键盘进入。原子菜单设置collisionPadding6，普通缩放1下sideOffset由nbn=5-zoom得到4px，纵向alignOffset扣除内容padding/margin。原有紧凑替换分支使用din("not all")，本节不把此静态调用宣称为已证明的窄屏运行条件。

**说明提示。** 菜单Item经Z3包装到`$0`/Lrn；默认延迟200ms，touch不打开，键盘`:focus-visible`立即打开。qrn的trigger-overflows读取子级`[data-tooltip-overflow-target]`或trigger自身的scrollWidth/clientWidth及scrollHeight/clientHeight，打开前和timer结束时各检查一次。原提交行ot传完整message、whitespace-pre-wrap及trigger-overflows；所选标题ct为常规always提示。单击关闭并阻止同次指针聚焦重新打开；blur/contextmenu/window blur/Escape及非interactive pointerleave关闭。Rrn portal到body，role=tooltip、aria-describedby，普通偏移2px、边缘留8px，flip/shift；外层最大20rem、菜单说明内层最大16rem，圆角16、padding12px/5px、行高18、无箭头且不截获指针。默认提示居中，完整说明保留换行。CSS还观察到tracking -.15px、shadow 0 8px 18px #0f172a33；不同窗口/theme的字体与色彩规则有覆盖关系，没有原运行态computed style，不能以根默认值证明全部状态像素一致。

**AnyWork实现。** 提交入口增加200ms鼠标悬停及leave/key/close/unmount取消；鼠标打开时焦点留在父入口，ArrowRight/Enter/Space才进入提交列表。移动端覆盖式菜单隐藏父入口后转移焦点到自己的内容，属于Web适配。键盘在父列表移到其他来源时关闭子菜单并保留该项焦点。桌面子菜单对齐提交行，扣除5px内边距，屏幕顶部/底部留6px；水平间隙4px，窄屏有返回入口。异步列表只在内容自身仍持有焦点时进入选中/首项，不抢占其他控件。

新ReviewTooltip只用于审阅提交说明，替换浏览器title；列表以subject为overflow target，键盘立即显示、鼠标200ms，打开和计时结束重复核对截断。自定义portal保留完整换行、单个活动提示、关联aria-describedby、focus不转移、指针穿透，按窗口和滚动重定位，目标滚出裁切区域后关闭，点击/contextmenu/blur/Escape/unmount清理。列表提示最大内容宽度256px加外层padding/border，总宽282px，常规所选说明最大320px；保留8px视口边距。所选标题增加可聚焦入口供Web键盘读取，是明确的可访问性适配。现有队列全文预览仍是可选文字的独立dialog，其700ms延迟与编辑/引导流程不套用这个非交互提示。

**边界。** 原provider的跨提示skip-delay/handoff、交互式提示的选择与三角grace、整个flyout provider的斜向指针grace、RTL/缩放/所有overlay owner等分支尚未完整复刻；当前为已核对的审阅子集。此次不改变Rust/HTTP、队列或目标协议；原Pierre渲染和其他特化消息仍有既有差距。第19节所述浏览器title、鼠标自动聚焦第一项及缺少200ms时序的描述由本节替代，不等于整个产品1:1完成。

静态UTF8半开字节定位（均为原app-shared成员第1行）：

| 符号 | byte range | SHA-256 |
| --- | --- | --- |
| $3 | [4278057,4278321) | `d9195fde9bb25fd2f76d65b33a7f82d4ee7399751180f80d4402d53c1a70c3e8` |
| kxn | [4266245,4273618) | `7900d381afdff4a2d0e91a5655f4dd491c3215e33091356298298f9aa521193d` |
| Nxn | [4276165,4276172) | `628aba2ee196055315cff4b7ba4bbcaf48aee510dc456464775660d9195d2117` |
| $0 | [3345258,3345626) | `826377f70b870a68c6255d36bfb778f085d36d3179440611d0ae80366c92e8ea` |
| Lrn | [3345626,3355194) | `05697d1bcb7c0dd0cb35055525a5239c20251fcdb0d434020d6ec7face443247` |
| Rrn | [3355194,3361097) | `638aa104182430a3ca64b965ff487ad46186dc3c61458810fa9b9d0f6fa60985` |
| Z3 | [4276492,4277711) | `e50f4512bd66e69e1972aa6782634c92883d486489bf41bc3caa9b4862eb464e` |
| Urn | [3362145,3362222) | `1707685642e4722c274e9cb75648d512d713886738f43e77b3f92933b6657987` |
| qrn | [3363066,3363269) | `f132ab6c47a7153d40d6c90f74c7834edf19bfcc0111039aa324c170518caf72` |
| nbn | [4220670,4220697) | `2a3e207a1fdd19396d7438f6c65a22e4652da00409c05e795fe6ed8b98d129c9` |

## 21. Pierre 差异渲染、Codex 语法主题与按需缓存

2026-11-05继续使用REA技能，只读原ASAR中的code-diff、file-diff、codex-diff-css和full-content-metadata四个精确成员。parent `ev_67df280b6108b81961b0c5536689dc26c4ae335e2a2178d4f757c1c0d50edfef`，summary `ev_8b5e7f5a66df38039463f494b934ce677bf158d9fe39b8b3017b09ac957c5bfd`。本次读取80149字节，解析4个JavaScript文件、24745个AST节点，parse failures为0；17530个文件未选。语义节点总上限5000/单文件1800、unknown总上限2000/单文件600，关系仍为partial且unknown有截断。原有7项无关native完整性矛盾保留，没有把静态分析等同于原应用运行态或完整调用图。

**原实现依据。** code-diff的jn把viewType映射到split/unified、wrapLines映射到wrap/scroll，默认simple分隔符，以内容键保持文件身份，并以ErrorBoundary隔离失败。file-diff的I按当前appearance取得Codex主题，将symbols指示器偏好映射为classic，否则bars；file-diff-presentation的X将这些参数传给Pierre FileDiff，关闭组件内文件标题，传入原生CSS和可选上下文加载器。code-diff调用方使用expansionLineCount20；词级高亮使用word-alt，但受原偏好开关和总新增/删除行数限制，超过Ar=2000时关闭。当前AnyWork启用word-alt及该阈值；尚未接入原生偏好开关或symbols设置，不把默认bars声明为全部设置分支一致。

独立、惰性Babel AST还核对file-diff-presentation、code-theme两个主题注册入口，以及Codex Light/Dark静态数据。提取器仅接受字符串、无插值模板、数字/布尔/null、数组、普通对象和已解析标识符；拒绝调用、方法、计算属性和其他可执行表达式，没有导入或执行原模块。两份主题各保留245条TextMate规则、16条semanticTokenColors及颜色配置，输出reviewCodeThemes.json。注册到AnyWork本地组件时只改内部注册名称，保持颜色和规则。原light成员25376字节、SHA-256 `c5b87c72dd3aea345c71db06484ed8be51ced0ee26606d564ffbb7358b7e0891`；dark成员25373字节、SHA-256 `571e02eaff5582ac33b86481fdb2218406aa46aefb8ee4f3b0eb85d821eb93e1`。这些主题成员由独立AST解析，未包含在上述四文件REA统计中。

**实现。** 原手写table改为延迟加载的`@pierre/diffs/react` FileDiff，采用npm固定版1.6.2及其真实语法与词级差异引擎。原包没有提供可确认的前端Pierre版本元数据，因此只确认组件系列与参数契约，不宣称依赖版本相同。1.6.2的lockfile完整性已与官方npm元数据核对；Apache-2.0许可和依赖主题NOTICE均保留在licenses目录。

parseReviewDiff继续负责文件路径、元信息和统计，同时按原始字符偏移保留每份补丁的完整source slice，包括中文/emoji、CRLF、相邻plain unified文件及缺少末尾换行标记；不从hunk重拼原文。Pierre以throwOnError解析该原始slice，AnyWork保留既有Git C-quoted UTF8路径作为规范名。无效补丁回退为转义的完整原文，不让一个文件的失败隐藏其余文件。组件加载/渲染有独立错误边界。语法资源加载失败则显示纯文本差异与词级高亮，并明确提示，避免永久加载占位。主题从页面data-theme订阅，切换不重建会话；相同补丁刷新时保留组件身份和源文字选择。

样式以原codex-diff-css的背景、行号栏、变更标记、悬停和simple分隔线为依据，变量映射到AnyWork现有surface/text/accent。原全局CSS的字号来自font-code-size默认12px、行高1.8倍、上下留白0、最小行号宽4ch；绿色使用light #00a240/dark #40c977，红色light #ba2623/dark #fa423e。语法文字则使用两份Codex主题，未沿用旧表格的统一文字颜色。实际字体仍受浏览器和系统字体可用性影响，没有原运行态像素对照，不能以参数相同宣称整页像素相同。

**Web缓存适配。** 构建提供Vite manifest，PWA按真实静态依赖图区分运行时/应用视图和可选语言/第三方主题。后者及其专用共享模块首次使用再加载，已使用资源写入当前版本缓存；共享运行时仍预缓存。只缓存构建白名单内的同源成功资源，API、WebSocket和source下载继续排除。版本摘要包含缓存生成器代码，缓存策略变化也会更新版本。新语法在离线且尚未缓存时会降级为纯文本；已用语法可在后续离线访问中复用。没有删除语言支持来降低首屏下载量。

**剩余边界。** 现有API只返回部分补丁，没有与补丁双方版本严格匹配的完整内容。原full-content-metadata会逐一验证缺失上下文和双方行内容；AnyWork尚未实现该完整内容协议，因此不拿当前磁盘文件冒充历史版本，也不展示虚假的展开上下文入口。大文件虚拟化、行评论/选区操作、搜索/符号跳转、全部原生偏好、主题插件与高级上下文菜单仍待实现。当前接入真实Pierre正文及Codex主题，替代此前“缺少语法/词级高亮”的描述；不替代其余1:1缺口。

静态UTF8半开字节定位（各原成员第1行；均核对原字节摘要）：

| 成员/符号 | byte range | SHA-256 |
| --- | --- | --- |
| code-diff / jn | [12519,13599) | `40678de884695a47709c0899d756b875fb893bf8180647feaa7cc2d7b2a16a82` |
| code-diff / Ar | [62818,62824) | `cf0a037bb9644eef71fefa1f449ee0ce57dd3a3c7442ddf661bd92b9f376f807` |
| file-diff / I | [1297,2768) | `d5ae86b07662c29d40d882b33d6b92a68c905982316aba9a45bb0a63c80665f7` |
| file-diff-presentation / X | [16459,18658) | `7ad66f0d2c50020c3859b82707d211792831153e6a2bc5d6d81320fb1a291336` |
| codex-diff-css / C | [1110,8608) | `9e9c9bc9ead6e5aa66583f9858ca6cc69cff028236f80a05038c9590de93271a` |
| codex-diff-css / D | [8782,10587) | `818d25b27e8c31e3891d7a8f3bd33be15ad4f216a97a38f8d0bfe82def0a22d6` |
| codex-light / i | [976,24831) | `8266ff766a38abbc16817bdfda5e3862f3f124d9a721a9646e9f014ac6a25eea` |
| codex-dark / i | [974,24829) | `7bf75202f0183b7c0175f8b46c5a5e8a7aee911bfec442fedebee5601e9b6d4b` |
| fd9b7fd80db1.css / global diff tokens | [1361495,1361816) | `510fe53f65e77d0683baa3681036e07f72be65c3d0a7f09994400eedf688005c` |
