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
