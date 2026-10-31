# 设计说明

这份文档解释 yakusha 为什么这样实现、覆盖哪些文本面、以及代码里那些判据的来历。
只想把游戏汉化掉可以跳过它，直接看 [README](../README.md)。

## 为什么这样做

RPG Maker 的文本全部在 `data/*.json` 里：数据库条目（道具、技能、敌人名）和事件指令
（`code 401` 对白、`code 102` 选项、`code 101` 说话人……）。MZ 的 `data/` 是明文
（MV 常做 base64+XOR 混淆，本项目也能解）。

因此有两条路：

| 路线 | 做法 | 代价 |
| --- | --- | --- |
| 重打包 | 改 `data/*.json` 写回磁盘 | 破坏原游戏、更新即失效、无法回退 |
| **运行时钩子** | 挂在数据加载回调上，JSON 解析完立刻就地替换 | 磁盘零改动、卸载即还原 |

本项目走第二条。运行时插件只包装数据加载回调，覆盖数据库、地图事件、公共事件、
敌群事件全部文本面：

- **MZ**：包装 `DataManager.onXhrLoad`，MZ 所有 `data/*.json` 都经过它。
- **MV**：MV 没有 `onXhrLoad`，改为包装 `DataManager.loadDataFile` 记下 `(name, src)`，
  再包装 `DataManager.onLoad`，按**对象身份**（`window[name] === object`）认领——因为 MV
  的 XHR 是并发发起的，回调顺序不可靠，不能按到达顺序配对。

## Ren'Py 为什么用 translation-file

Ren'Py 没有对应的"加载回调"可以挂：文本是脚本里的字面量（`.rpy` 明文，或它编译出的
`.rpyc`），由引擎自己的语句执行时直接交给界面，不存在一个"数据解析完就地替换"的中间点。
要在这条路上换掉文字，只能往引擎进程里注入 Python，那已经是另一档（注入档），不是本项目
现在走的路。

Ren'Py 自己就有字符串翻译机制：`translate <language> strings:` 里是一张 old/new 表，
渲染时 `renpy.translation.translate_string()` 拿原文查这张表；`config.default_language`
决定默认用哪种语言。于是 yakusha 只做一件事——生成一个 `game/yakusha_translation.rpy`，
把字典里已翻译的条目写成这张表，剩下的交给引擎查表：

- 原脚本一个字节都不改，卸载就是删掉这一个文件，连备份都不需要（没有"还原"这回事）；
- 没翻的条目不在表里，引擎照读原文，所以可以分批翻、也可以只翻一部分；
- 同一语言里重复的 `old` 在启动时是硬报错，不是警告，所以写文件前按原文去重并稳定排序；
- 激活语言只在 `config.default_language` 仍是 `None` 时发生：游戏自己声明的默认语言
  不被覆盖。玩家在设置里选过的语言则是 Ren'Py 自己记在 persistent 里的，
  `00defaults.rpy` 只在首次启动时才把 `config.default_language` 拷进偏好，之后一直是
  玩家的选择——工具全程不碰它。

提取侧覆盖四类（`kind` 字段）：`say` 对白与旁白、`menu` 菜单标题与选项、`string` 用
`_()` 标出的可翻译串（`translate ... strings` 的原文）、`screen` 里 `text` /
`textbutton` / `label` / `tooltip` / `notify` 的文本。

## RGSS 为什么用原生注入器

RGSS（XP / VX / VX Ace）是本项目接的第四种引擎。它没有可以挂的钩子：没有插件目录、没有
`js/plugins.js`、也没有一个工具能改写而不碰游戏自身文件的数据目录——文本直接烧在
`Data/*.rxdata`、`*.rvdata`、`*.rvdata2` 这些 Ruby Marshal 文档里，打包发行时那些文档还
整体藏在 `Game.rgssad` / `.rgss2a` / `.rgss3a` 归档里（`src/engines/rgss/adapter.js:1-16`）。
换掉文字要么把这些文档写回去，要么在运行时把译文喂进游戏进程。

交付层路线于 2026-10-27 拍板走**原生注入器 + hook DLL**，0.18 实现，`capabilities.runtime`
从 `null` 变成 `"inject"`（`src/engines/rgss/adapter.js:180-190`）。选它而不是纯 JS 写回，
是因为它不改盘：游戏自身文件一个字节不动，卸载删掉注入器目录即还原；写回路线则要重打
归档，备份、游戏更新与还原的责任都落在游戏文件上，所以纯 JS 写回只保留为历史备选。

**注入怎么发生**（32 位 Windows）：`yakusha_injector.exe` 以挂起方式启动 `Game.exe`
（`CreateProcessW` 的 `CREATE_SUSPENDED`），把 hook DLL 的路径写进目标进程，用
`CreateRemoteThread(LoadLibraryW)` 加载 DLL，等加载完成再恢复主线程
（`native/injector/src/main.rs`）。游戏文件全程不改，游戏自己的工作目录与命令行也保持原样。

`yakusha_rgss_hook.dll` 在进程里改的是游戏导入表里 `kernel32!GetProcAddress` 这一格：游戏
每次解析 `RGSSEval` / `RGSSGameMain` 都会经过它。解析 `RGSSGameMain` 时返回自己的包装函数；
包装函数先用真正的 `RGSSEval` 执行 `bootstrap.rb`（此时 Ruby VM 已经初始化），再把控制权
交回真正的 `RGSSGameMain`（`native/rgss-hook/src/lib.rs`）。`bootstrap.rb` 把
`dictionary.txt` 读成 Ruby 哈希，包装 `Kernel#load_data`：每个加载出来的数据库 / 地图对象
被递归遍历（String、Array、Hash、实例变量，深度上限 64），命中的字符串就地替换——地图
事件、公共事件、数据库术语这些从 `load_data` 返回对象里能到达的文本都在覆盖范围内。菜单
标签这类写在脚本源码里的字符串另有一个 `Vocab` 兜底（`native/rgss-hook/bootstrap.rb`）。
日志写在 `<game>/yakusha/native/rgss-hook.log`：打了哪一格、解析到哪些导出、字典多大、
每次 `load_data` 替换了几条。

`install --native` 往 `<game>/yakusha/native/` 放 6 个文件：4 个组件
（`yakusha_rgss_hook.dll`、`libunwind.dll`、`yakusha_injector.exe`、`bootstrap.rb`）+
按字典生成的 `dictionary.txt` + 记录组件 SHA-256 的 `manifest.json`。复制前逐个核对
`manifest.json` 里的大小与哈希，`uninstall` 整个目录删掉；目录里没有我们的 `manifest.json` 时
拒绝删除而不是删别人的目录（`src/engines/rgss/native.js`）。不带 `--native` 的 `install`
直接报 `E_USAGE`，因为装原生组件是可见的改动，必须显式要求。

覆盖不到的地方也要说清楚：只有 `load_data` 返回对象里能到达的字符串（加 `Vocab` 兜底）会被
替换，直接写在脚本里的字面量参数不经过这里；注入器是进程内 IAT patch，未签名的 exe / DLL
可能被杀毒软件拦，SHA-256 清单是 0.18 的完整性机制、代码签名留给后续；已经加壳的可执行
文件不在范围内。版本上只在一款 VX Ace 商业游戏的副本上实测过（RGSS300.dll），XP / VX
（RGSS1 / RGSS2）未测，RGSS301 只按同族推断。

## Kirikiri 为什么没有交付层

Kirikiri（KAG）是第五种引擎，也是目前唯一只做到 L1–L3 的：`capabilities.runtime` 是 `null`
（`src/engines/krkr/adapter.js:189-200`）。它没有插件目录、没有 `js/plugins.js`，也不像
Ren'Py 那样自带一个可以放翻译资源的目录（`src/engines/krkr/adapter.js:1-15`）。文本烧在
`.xp3` 归档里的 `.ks` / `.tjs` 脚本中，换掉文字等于**把归档写回去**。

把归档写回去这条路本身还有一道墙：发行版常用加密变体。krkr2 引入逐文件密钥，krkrz
引入 cxdec 解密，两者都需要游戏自己的密钥数据；本项目**刻意不碰**这些加密变体，写回
路线在支持它们之前不成立（`src/engines/krkr/adapter.js:229-237`）。另一条路线是原生注入器
+ hook DLL（RGSS 已拍板走这条），Kirikiri 自己的两条路线都还没有拍板，所以交付层记成
**待拍板**（[dev/DEVLOG.md](dev/DEVLOG.md) 的待拍板清单），
`install` / `uninstall` 报指向决策记录的 `E_NOT_IMPLEMENTED`（`install is not implemented for
Kirikiri yet - see the pending decisions in docs/dev/DEVLOG.md`，`src/engines/krkr/adapter.js:178-183`），
`doctor` 的 install 检查是 warning、runtime 检查是 info。`src/index.js` 只导出
`openKrkrProject` / `extractKrkrProject`（`src/index.js:19-20`），同样没有 install 入口。

## 文本面覆盖


| 位置 | 内容 |
| --- | --- |
| `Actors.json` | name、nickname、profile |
| `Classes/Skills/Items/Weapons/Armors/Enemies/States/Tilesets` | name、description、message1..4 |
| `CommonEvents.json` | 名称 + 全部事件指令 |
| `Troops.json` | 全部事件指令 |
| `MapInfos.json` | 地图名 |
| `MapNNN.json` | displayName + 全部事件指令 |
| `System.json` | gameTitle、currencyUnit、terms.basic/commands/params/messages、各类类型名 |
| 事件指令 | `101`(说话人)、`401`(对白)、`102`(选项数组)、`105`/`405`(滚动文本)、`320`/`324`/`325`(改名/称号) |

不翻译：插件指令（`355`/`655`）、脚本（`355` 的 JS 体）、`note` 字段（插件数据）。

RGSS 的数据面在 Ruby Marshal 文档里，字段名带 `@`（`@name` 而不是 `name`），所以按文档名
（扩展名随版本变：XP 是 `.rxdata`、VX 是 `.rvdata`、VX Ace 是 `.rvdata2`）匹配，位置是：

| 位置 | 内容 |
| --- | --- |
| `Actors` / `Classes` / `Skills` / `Items` / `Weapons` / `Armors` / `Enemies` | `@name`、`@description`（`Actors` 另有 `@nickname`，`Skills` 另有 `@message1`/`@message2`） |
| `States` | `@name`、`@message1`..`@message4` |
| `Tilesets` / `CommonEvents` | `@name` |
| `System` | `@game_title`、`@currency_unit`，以及 `@terms` 的四张表（basic / params / etypes / commands） |
| `MapInfos` | `@name`（地图名） |
| `MapNNN` / `Troops` / `CommonEvents` | 全部事件指令 |
| 事件指令 | `101`(说话人)、`401`(对白)、`405`(滚动文字续行)、`102`(选项标签)、`320`(改角色名) |

字段清单在 `src/engines/rgss/extract.js:41-52`（`RGSS_DB_FIELDS`）与 `src/engines/rgss/extract.js:58-61`
（`SYSTEM_TEXT_FIELDS`、`TERM_FIELDS`）；指令码在 `src/engines/rgss/extract.js:79-85`（`COMMAND_TEXT`）。

**`402` 为什么不收**：它是选项分支的标记指令，文本和前一条 `102` 选项标签是同一个字符串。
再收一次只会给同一条原文多一个 context，不会多一条译文，所以提取器直接跳过它
（`src/engines/rgss/extract.js:73-75`）。MZ 的提取表里同样没有 `402`（`src/core/fields.js:63-72`），
是同一个判断。

**编辑器注释和 `@note` 为什么不收**：`108`/`408` 是事件编辑器里给人看的注释，运行时一个字都
不显示；`@note` 是脚本用的元数据通道（自定义图标标记之类）。同在“不翻译”一类的还有脚本行
（`355`/`655`）、文件名（`231`/`322`）和脚本参数（`111`/`118`/`119`/`122`/`123`/`283`/`284`）——
翻它们要么什么都不会发生，要么直接把游戏弄坏（`src/engines/rgss/extract.js:1-23`、
`src/engines/rgss/extract.js:29-39`）。数据库里所有 `@*_name` 字段也一样：它们存的是图片或
音频文件名，不进字典。

Kirikiri 的文本面在 `.xp3` 归档内的 `.ks` 脚本里，按行抽取（`src/engines/krkr/extract.js:119-122`）：

| 行类型 | 处理 |
| --- | --- |
| 文本行 | 收进字典；行内 KAG 标签剥离后存纯文本，context 是 `<归档内文件名>:<行号>` |
| 注释行（行首 `;`） | 跳过 |
| 标签行（行首 `[`） | 不收文本，但其中的 `[name_set name=...]` 会记成后续文本行的说话人 |
| 标签行（行首 `*`） | 跳过（标签/跳转点） |
| `.tjs` 脚本 | 只计数不读内容：TJS 是编程语言，不理解代码就翻译其中的字符串不安全 |

行分类与说话人跟踪在 `src/engines/krkr/ks.js:48-56`（`classifyLine`）与 `:94-100`
（`nameSetValue`）；行内标签剥离在 `:65-88`（`stripInlineTags`），未闭合的 `[` 按普通文字
处理。编码先按 UTF-8 严格解码、失败再按 Shift_JIS 兜底，仍解不开的字节记 `undecodable`，
一条损坏的脚本不影响其余文件（`src/engines/krkr/ks.js:13-36`）。

## 转义码


MZ 的文本里混着反斜杠转义，翻译时**一个都不能动**：

```
\C[n]  换文字颜色     \V[n]  取变量值      \N[n]  角色名
\P[n]  队员名         \G     货币单位      \I[n]  图标
\FS[n] 字号           \{ \}  放大/缩小     \> \< 瞬间显示
\! \| \. 停顿          \^     跳过等待      \$     显示窗口
```

这些码在引擎里会被 `convertEscapeCharacters` 替换掉，所以**译文必须原样保留它们**。
`src/core/textkey.js` 把文本切成"文字片段 / 转义码片段"两类 token，提取、校验、运行时
查表三处用同一套逻辑，保证字典 key 在离线与运行时完全一致（有 `rules-sync` 测试守着）。

Ren'Py 的码是完全另一套形态，**不是反斜杠**，而是两类零宽标记：

```
{i} {/i} {b} {/b} {color=#ff0000} {size=+4} {w} {nw} {#id}    花括号标签
[player_name] [var!q] [var:.2f] [obj.attr]                      方括号插值
```

它们同样**一个都不能动，顺序也不能变**：标签决定这一段怎么显示，插值在运行时换成变量值，
译文里挪走一个就等于丢格式或丢数据。`src/engines/renpy/profile.js` 的 `tokenize()` 把它们
切成零宽 code token，`controlCodes()` 和 `plainText()` 都建在它上面：prompt 给模型看的转义
示例来自同一个 profile 的 `escapeExamples`，校验时 `validateTranslation` 比对两边的 code
序列，`verify` 复查时也走这套切分。以 `#` 开头的标签（如 `{#playlist}`）引擎不显示，只用
来区分同一句话的不同出处——但它同样进 code token，跟着原文一起走。

还有三个双写转义 `{{` `[[` `%%`：它们显示成一个普通的 `{` `[` `%`，是可见字符，
所以按文字处理；落单的 `{` 或 `[`（没有配对）也当普通文字，因为玩家看到的就是它。

### RGSS 控制码

RGSS 的码又回到反斜杠一族，和 MZ/MV 是同一个语法家族：`\C[n]` 换色、`\V[n]` 变量、
`\N[n]` 角色名、`\I[n]` 图标、`\G` 货币单位、`\{`/`\}` 放大缩小、`\>`/`\<` 瞬时显示、
`\^` 跳过等待、`\!`/`\|`/`\.` 停顿（`src/engines/rgss/profile.js:41-55`）。所以
**`src/core/textkey.js` 一个字都没改**：`tokenize()`、`controlCodes()`、`plainText()`、
`visibleText()` 原样接过来（`src/engines/rgss/profile.js:82`），提取、校验、运行时查表三处
仍用同一套切分。

RGSS profile 与 MZ/MV profile 的差别只有措辞和语言判定：`prompt.task()` 说的是“把 RPG Maker
XP / VX / VX Ace 的游戏文本从日文翻成 X”（`src/engines/rgss/profile.js:72-78`），
`escapeExamples` 只列对白里真的会出现的 13 个码（`src/engines/rgss/profile.js:41`、
`src/engines/rgss/profile.js:79`）。校验与复查用的 `%1` 一类槽位正则、假名/汉字/繁体判定
也都和 MZ/MV 共用（`src/engines/rgss/profile.js:84-94`）。

实测样本里 2,063 条文本带控制码、共 23 种，数量最多的是 `\i[n]`、`\c[n]`、`\v[n]`；
这说明“共用一套 tokenizer”不是省事，而是这个家族的文本本来就长这样。

### Kirikiri 控制码

Kirikiri 又换了一族：KAG 的控制码是**方括号标签**，不是反斜杠——`[r]` 换行、`[er]` 清屏、
`[emb exp=...]` 嵌值，转义是 `[[`（显示成一个 `[`）（`src/engines/krkr/profile.js:130-153`）。
所以 `src/core/textkey.js` 这次**没有复用**：Kirikiri 带了自己的 tokenizer
（`src/engines/krkr/profile.js:41-74`），按方括号切分——`[[` 出现时是字面 `[`，`[...]` 在
换行前闭合的是 code token，落单未闭合的 `[` 按普通文字处理。`plainText()` / `visibleText()`
的语义与 MZ 一致（剥标签后的可读文本），`isUntranslated` 的假名判定也作用在剥标签后的
文本上，所以标签里的假名不会把回显误判成未翻（`src/engines/krkr/profile.js:111-113`）。

槽位同样是 `%1` 一族的 `/ %[0-9]+/`：KAG 用 `[emb]` 标签嵌值而不是内联占位符，实际文本里
能见到的只有 `%` 形式，校验只报它（`src/engines/krkr/profile.js:115-123`）。`prompt.task()`
说的是“把 Kirikiri KAG 的游戏文本从日文翻成 X”，`escapeExamples` 列 `[r]`、`[er]`、
`[emb exp=...]`、`[[` 四个（`src/engines/krkr/profile.js:130-153`）。

## data/ 的编码

**加密的 `data/`**：有些 MZ 游戏把 JSON 单字节 XOR 掉了（每文件一个 key；有资料称键值由
`libGLESv2.dll` 的 sha256 推出，但工具不依赖这个推导）。`src/core/datafile.js` 的做法是：先按明文试，
失败后**穷举 256 个单字节 key**，只有真的能 `JSON.parse` 且以 `[`/`{` 开头才接受；
解不出的文件不会静默跳过，会进 `undecodable` 列表并在 `scan` 里报出来。
0 字节的占位文件（有些游戏会留一个空的 `结果.json`）算 `empty` 而不算 `undecodable`，
因为它本来就没有文本可丢。

## 卸载不会盖掉别人的改动

如果装好之后 `plugins.js` 又被改过（游戏更新、你另装了别的插件、在 RPG Maker 编辑器里
存过档），`uninstall` 不会拿旧备份盖掉这些改动：它只删掉 `YAKUSHA_Translator` 那一条，
把 `js/plugins.js.yakusha-backup` 留在原地给你核对，并打印一行提示。`install` 也会在发现备份
已经对不上时先说明这一点。

## 设计约束


- **插件档只碰两处**：只加一个插件文件 + 一行注册，卸载时还原这两处（`plugins.js` 用备份
  逐字节还原）。重写 `plugins.js` 时会记住原文件是否带尾逗号、用 LF 还是 CRLF，免得一次安装
  把整份文件变成全文件 diff。注意这是**插件档**的性质；0.18 起的注入档是"游戏文件不改、退出即恢复"，
  两者不能混成一句"整个产品可逆"，四档见 [dev/ENGINE-STRATEGY.md](dev/ENGINE-STRATEGY.md) §5.5。
- **translation 档只写一个新文件**：Ren'Py 的交付是 `game/yakusha_translation.rpy` 一个文件，
  不碰 `game/` 里的任何原脚本，也不碰 `game/tl/`（社区翻译补丁的目录，扫描时整个跳过）。
  卸载删掉它即恢复；因为是引擎自带的翻译资源，这一档是 L4-resource，不是插件档。
- **RGSS 的交付只写一个目录**：`install --native` 往 `<game>/yakusha/native/` 放 6 个文件——
  4 个组件（`yakusha_rgss_hook.dll`、`libunwind.dll`、`yakusha_injector.exe`、`bootstrap.rb`）
  + 按字典生成的 `dictionary.txt` + 记录组件 SHA-256 的 `manifest.json`；游戏自身文件一个字节
  不改，`uninstall` 删掉这个目录即还原。注入器是 32 位 Windows 程序；装了 native 层后
  `launch` 先经过 `yakusha_injector.exe`，没装则照旧直接启动 `Game.exe`。
- **Kirikiri 也只到 L1–L3**：`capabilities.runtime` 是 `null`，`install` /
  `uninstall` 抛指向决策记录的 `E_NOT_IMPLEMENTED`。写回 `.xp3` 还多一道墙——发行版常用的
  krkr2 / krkrz 加密变体刻意不碰（`src/engines/krkr/adapter.js:229-237`），所以 0.13 同样
  **不往游戏里写回任何一个字节**，交付路线定了才有下一步。
- **字典 key = 原文**：不做语言检测、不改写原文，hash 之类的方案会让译文无法人工校对。
- **校验在写之前**：宁可留原文，也不留一条会显示成乱码的译文。
- **规则单一来源**：`src/core/fields.js` 是唯一真源，插件里的 `RULES` 由 `install` 生成，
  `test/rules-sync.test.js` 会在两者漂移时报错。
- **离线可用**：`--dry-run` 和 `--glossary-only` 完全不联网，整套流水线可在无 key 环境验证。

## 作为库用


```js
import { openProject } from "./src/core/mzproject.js";
import { extractProject } from "./src/core/extract.js";
import { loadDictionary, dictionaryPath } from "./src/core/dict.js";
import { createProvider } from "./src/pipeline/provider.js";
import { translateDictionary } from "./src/pipeline/translate.js";

const project = openProject("/games/MyGame");
const dict = loadDictionary(dictionaryPath(project.root));

const result = await translateDictionary(dict, {
  provider: createProvider("openai", { model: "deepseek-chat" }),
  concurrency: 4,
  onProgress: (p) => console.log(p.done + "/" + p.total),
});
console.log(result.translated + " translated, " + result.rejected.length + " rejected");
```

Ren'Py 走的是另一条交付路：提取是 `extractRenpyProject`，安装是 `installTranslation`
（写那一张 old/new 表），卸载是 `uninstallTranslation`（删掉它）。上面这些名字都由
`src/index.js` 导出：

```js
import { openRenpyProject, extractRenpyProject, installTranslation, uninstallTranslation } from "./src/index.js";

const project = openRenpyProject("/games/SomeRenpyGame"); // 指到启动器目录或 game/ 都行
const extracted = extractRenpyProject(project.root);      // entries: Map<原文, { text, contexts, count, locators }>

// pairs 是 [原文, 译文] 数组，由调用方提供（通常来自字典或自己的流水线）
const pairs = [["Original line", "译好的那一行"]];

installTranslation(project, pairs, { language: "schinese" }); // 写 game/yakusha_translation.rpy
uninstallTranslation(project);                                // 删掉它，游戏回到原样
```

RGSS 的交付走 CLI 的 `install --native`（`src/engines/rgss/native.js` 里的 `installNative` /
`uninstallNative`），库的公开面仍然只有读取和提取。提取结果与 MZ/MV 同形
（`entries` 是 `Map<原文, { text, contexts, count, locators }>`），可以直接喂给同一条翻译、
校验流水线：

```js
import { openRgssProject, extractRgssProject } from "./src/index.js";

const project = openRgssProject("/games/SomeRgssGame"); // 目录或 exe 都行，向上找 3 层
const extracted = extractRgssProject(project.root);
// entries: Map<原文, { text, contexts, count, locators }>
// contexts 形如 "Map001.rvdata2:401"，commandCounts 统计每种指令码收了多少条
console.log(extracted.entries.size + " strings in " + extracted.documents + " documents");
// 没有 installRgss / uninstallRgss：交付只走 CLI 的 install --native
```

Kirikiri 同样：公开面上只有读取和提取，没有安装/卸载函数：

```js
import { openKrkrProject, extractKrkrProject } from "./src/index.js";

const project = openKrkrProject("/games/SomeKrkrGame"); // 目录或其 data/ 里放 .xp3
const extracted = extractKrkrProject(project.root);
// entries: Map<原文, { text, contexts, count, locators }>
// contexts 形如 "script.ks:12"；scripts 统计 ks / tjs 文件数，tjs 只计数不读
console.log(extracted.entries.size + " strings in " + extracted.documents + " archives");
// 没有 installKrkr / uninstallKrkr：交付路线定了才会有
```
