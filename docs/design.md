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
  把整份文件变成全文件 diff。注意这是**插件档**的性质；将来注入档是"游戏文件不改、退出即恢复"，
  两者不能混成一句"整个产品可逆"，四档见 [dev/ENGINE-STRATEGY.md](dev/ENGINE-STRATEGY.md) §5.5。
- **translation 档只写一个新文件**：Ren'Py 的交付是 `game/yakusha_translation.rpy` 一个文件，
  不碰 `game/` 里的任何原脚本，也不碰 `game/tl/`（社区翻译补丁的目录，扫描时整个跳过）。
  卸载删掉它即恢复；因为是引擎自带的翻译资源，这一档是 L4-resource，不是插件档。
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
const extracted = extractRenpyProject(project.root);      // entries: Map<原文, { text, contexts, count }>

// pairs 是 [原文, 译文] 数组，由调用方提供（通常来自字典或自己的流水线）
const pairs = [["Original line", "译好的那一行"]];

installTranslation(project, pairs, { language: "schinese" }); // 写 game/yakusha_translation.rpy
uninstallTranslation(project);                                // 删掉它，游戏回到原样
```
