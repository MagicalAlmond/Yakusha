# 引擎适配器契约（0.11 契约）

> **状态：0.11 覆盖三个引擎——RPG Maker MZ、RPG Maker MV、Ren'Py。**
> 0.10 把 MZ 与 MV 包进统一的 adapter，**不搬文件、不重写算法**；0.11 用同一套
> contract 接入 Ren'Py，作为第三个 adapter 挂在 registry 末位。本文冻结 adapter
> 的形状、能力矩阵、安装/启动契约与契约测试的落点；引擎之间真正的差异（文本形态、
> 投递方式、控制码语法）下沉到 adapter 与 profile 数据里，不进 `src/pipeline`。

## 1. 目标与非目标

目标：

- CLI 与未来的 GUI 只依赖 `detect()` + adapter 方法，不再在 `bin/yakusha.js` 里
  写 `if (engine === "mz")`。
- 新引擎的接入点固定：一个 `src/engines/<id>/adapter.js` + 一份 fixture + 契约测试。
- 把“引擎能不能做某事”变成数据（`capabilities`），让 GUI 在点击前就能置灰。

非目标：

- 0.11 只做 MZ / MV / Ren'Py 三个引擎，不实现 Unity / Wolf / Kirikiri / RGSS；
  不实现原生注入（`inject`）。Ren'Py 走引擎自带的 translation 资源档，不是注入档，
  理由见 [design.md](design.md)。
- 不搬 `src/core` 的文件。RPG Maker 的 adapter 是薄包装，`core` 仍可被库用户直接使用。
- 不实现 `attach`（CDP 调试注入），只登记能力与接口；三个引擎的 `attach` 都是 `false`。

## 2. 目录与注册表

```
src/engines/
  adapter.js        契约常量、能力默认值、detect 结果形状的辅助函数（无引擎逻辑）
  registry.js       按顺序探测；把 engine id 映射到 adapter
  launch.js         exe 发现与 spawn（三引擎共用，见 §8）
  profile.js        RPG Maker 的 profile 数据（prompt / grammar / validate / verify）
  mz/adapter.js     包装 mzproject / extract / install / plugin 模板
  mv/adapter.js     同上，差异只在 detect 的 core 文件与 runtime 能力
  renpy/
    adapter.js      Ren'Py adapter：detect / scan / extract / install / uninstall
    project.js      定位 game/、读 config.name 与 config.version、遍历脚本
    extract.js      脚本 → 字典条目；跳过 tl/ 与自己生成的翻译文件
    rpyscript.js    .rpy 词法：哪些字面量算可翻译文本
    rpyc.js         .rpyc 容器：RPC2 槽表 + slot 1 的 pickle
    pickle.js       纯 JS pickle 读取（无依赖、不 eval）
    runtime.js      生成 / 删除 / 读取 game/yakusha_translation.rpy
    profile.js      Ren'Py 的 profile 数据（{tag} 与 [var] 语法）
src/index.js        公共门面（见 §10）
```

`registry.js` 导出：

- `getAdapters()`：按 `mz → mv → renpy` 顺序返回 adapter 数组。
- `detectProject(startDir)`：返回与 `adapter.detect` 相同的判别式结果，外加 `adapter`。
- `getAdapter(engine)`：按 id 取；未知 id 返回 `null`（不抛）。

探测顺序固定：**MZ 优先**。一个目录同时有 `js/rmmz_core.js` 与 `js/rpg_core.js` 时
按 MZ 处理（与现有 `openProject` 的 `fs.existsSync(MZ_CORE) ? "mz" : "mv"` 一致）。
Ren'Py 排最后：它按 `game/` 下的 `.rpy` / `.rpyc` 识别，与 RPG Maker 的 core 文件
不重叠，顺序只影响“三个都不像”时报哪一句。

`detectProject` 遇到 `E_MULTI_ROOT` 立即返回，不再尝试下一个 adapter：多根意味着
用户给的是一个装了多款游戏的目录，换引擎试没有意义。Ren'Py 的 `E_MULTI_ROOT` 只出现
在它自己的 `game/` 搜索里，候选集不会与 RPG Maker 混在一起。

registry 把两句 `not a … project`（RPG Maker 一句、Ren'Py 一句）当成“这个引擎不匹配，
继续试下一个”；其余 `E_NOT_PROJECT`（缺 `data/`、缺 `js/plugins.js`）立即返回——
那说明引擎已经认出来、只是项目不完整，不该再拿别的引擎去猜。三个都不匹配时返回第一句
通用文案，也就是 RPG Maker 那句（见 §4.2）。

## 3. Adapter 形状

```js
export default {
  id: "mz",
  name: "RPG Maker MZ",

  capabilities: {
    extract: true,        // 能抽文本
    export: true,         // 能导出（0.11 只有 JSON）
    runtime: "plugin",    // 已实现的运行时投递方式：plugin | translation
    launch: true,         // 能发现并启动游戏 exe
    debuggable: true,     // 引擎本身支持 CDP 调试（不等于工具已实现 attach）
    attach: false,        // 工具是否实现 attach；0.11 全为 false
    liveReload: false,    // 改字典后是否自动生效；0.11 只能手动 reload
  },

  // 只读探测：不抛预期错误、不写盘、不联网。
  // 成功 {ok:true, project}；失败 {ok:false, code, message, candidates?}
  detect(startDir) { ... },

  scan(project) { ... },                 // 文本量统计（CLI scan 的载荷）
  extract(project) { ... },              // 写字典（CLI extract 的载荷）
  installRuntime(project, options) { ... },
  uninstallRuntime(project) { ... },
  launch(project, options) { ... },      // {pid, exe, root}
  attach(project, options) { ... },      // 0.11 只抛出 E_NOT_IMPLEMENTED

  // 引擎专属规则；pipeline 不硬编码 MZ 的转义码
  rules: { controlCodes: true, maxColumns: 0 },
};
```

方法可以返回 Promise；本文不规定同步/异步，调用方一律 `await`。

`project` 就是现有 `openProject()` 的返回对象：

```js
{
  root, engine, pluginDir, dataDir, pluginsFile, indexPath,
  gameTitle,   // System.json 的 gameTitle，可能为 null
  version,     // 引擎版本，例如 "1.7.0"，可能为 null
}
```

adapter 不得改写这个对象；需要派生值时返回新对象。

Ren'Py 的 adapter 用同一个形状，但多两个字段、少一半 project 字段：

```js
{
  id: "renpy",
  name: "Ren'Py",
  capabilities: { extract: true, export: true, runtime: "translation", launch: true,
                  debuggable: false },   // attach / liveReload 为 false
  dataUnit: "scripts",   // doctor 与 scan 的行标：scripts 而不是 data files
  diagnostics(project) { return { extract, dataFiles, translation, sourceLabel: "game/" }; },
  profile: renpyProfile, // {tag} / [var] 语法与判据，见 §14 末尾的 profile 说明
  rules: { controlCodes: true, maxColumns: 0 },
}
```

- `runtime: "translation"`：投递方式是**生成引擎自带的翻译资源**，不是装插件。
  Ren'Py 没有插件系统，也没有可挂的加载回调。
- `pluginDir` / `pluginsFile` / `indexPath` 全为 `null`：目录不存在就不指向一个
  不存在的路径，下游靠 `null` 判断而不是靠 `engine === "renpy"`。
- `dataDir` 是相对 root 的 `"game"`（脚本所在目录），`gameDir` 是它的绝对路径；
  `gameTitle` / `version` 来自 `game/options.rpy` 里的 `define config.name` 与
  `define config.version`，静态读取、不执行脚本，读不到就是 `null`。`gameTitle`
  为 `null` 时回落到项目目录名。
- `dataUnit` 与 `diagnostics` 只有 Ren'Py 有；CLI 用 `adapter.dataUnit === "scripts"`
  决定打印 `scripts` 还是 `data files`，用 `diagnostics` 把引擎自己的抽取器与
  翻译文件状态交给 `doctor`。MZ / MV 不带这两个字段，走原有分支。

## 4. `detect` 契约

### 4.1 结果

成功：

```js
{ ok: true, project: { root, engine: "mz", ... } }
```

失败：

```js
{ ok: false, code: "E_NOT_PROJECT", message: "..." }
{ ok: false, code: "E_MULTI_ROOT", message: "...", candidates: ["...", "..."] }
```

规则：

1. **预期失败不抛异常。** 找不到项目、同层多项目、缺 `data/`、缺 `plugins.js` 都走
   `{ok:false}`；只有真正的 I/O 异常（EACCES 等）可以抛，CLI 映射成 `E_IO`。
2. **不写盘、不联网、不改全局状态。** RPG Maker 只读 core 文件、`data/`、`js/plugins.js`；
   Ren'Py 只读 `game/` 下脚本的文件名与 `game/options.rpy` 里的两行 `define`。
3. **幂等。** 同一目录连续调用两次，结果一致（除了文件系统在这期间被改）。
4. **有界搜索。** 从 `startDir` 开始，向上找自身，向下最多 `MAX_SEARCH_DEPTH = 3` 层，
   跳过隐藏目录与 `SKIP_DIRS`；与现有 `findProjectRoot` 完全一致。
5. **顺序稳定。** 多根时 `candidates` 按深度优先排列。第二关键字两个引擎不同（都是
   既有实现，不是新约定）：RPG Maker 用 `localeCompare`，Ren'Py 用代码元顺序的字符串
   比较。`candidates` 只列最浅那一层的根——更深的根算是“某个候选项目内部的东西”。

### 4.2 错误文案

0.10 沿用现有文案，避免 CLI 测试与用户习惯同时断掉；Ren'Py 的两句是 0.11 新增：

- `E_NOT_PROJECT`（RPG Maker）：
  `not an RPG Maker project (no js/rmmz_core.js or js/rpg_core.js found in <dir> or up to 3 levels below it)`
- `E_MULTI_ROOT`（RPG Maker）：
  `found N RPG Maker projects under <dir>, pass one of them instead: <roots>`
- 找到根但缺目录：
  - `missing data/ directory in <root>`
  - `missing js/plugins.js in <root>`
- `E_NOT_PROJECT`（Ren'Py）：
  `not a Ren'Py project (no game/ directory with .rpy or .rpyc scripts found in <dir> or up to 3 levels below it)`
- `E_MULTI_ROOT`（Ren'Py）：
  `found N Ren'Py projects under <dir>, pass one of them instead: <roots>`

哪一句会被看到，由 §2 的注册表规则决定：`detectProject` 只在收到本引擎的通用文案时
继续试下一个 adapter，所以**空目录下用户看到的是 RPG Maker 那句**——它来自第一个
adapter，与“这个目录是什么游戏”无关。

adapter 只负责给 `code` + `message`；CLI 负责把它塞进错误信封（`error.code` / `error.message`）。
消息里的路径必须是 adapter 自己解析出的绝对路径。

### 4.3 `openProject` 与 `detect` 的关系

- `src/core/mzproject.js` 的 `openProject()` **保持抛异常**：它是现有库 API，
  已有调用方与测试依赖 `throw`。
- `adapter.detect()` 是它的非抛包装：`try { openProject(dir) } catch (e) { 分类 }`。
- 公共门面同时导出两者：`openProject`（抛）与 `detectProject`（判别式）。
  文档示例优先用 `detectProject`，但 0.10 不删旧 API。
- CLI **只**用 `detectProject`；这样“用户拖错目录”不会变成 stack trace。

## 5. 能力矩阵

| 能力 | MZ | MV | Ren'Py | 含义 |
| --- | --- | --- | --- | --- |
| `extract` | true | true | true | RM：`data/*.json`，明文或单字节 XOR；Ren'Py：`game/` 下的 `.rpy` / `.rpyc` |
| `export` | true | true | true | 0.11 只有 JSON 导出 |
| `runtime` | `plugin` | `plugin` | `translation` | RM 装 JS 插件（MZ 包 `onXhrLoad`，MV 包 `loadDataFile` + `onLoad`）；Ren'Py 生成一个翻译脚本 |
| `launch` | true | true | true | 项目根唯一 `.exe`（Ren'Py 发行版的根目录通常就是启动器所在处） |
| `debuggable` | true | **false** | false | MZ 可被 `--remote-debugging-port` + CDP 驱动；MV 的旧 nw.js 不吃这个参数；Ren'Py 是 Python 引擎，没有 CDP |
| `attach` | false | false | false | 0.11 没有实现 |
| `liveReload` | false | false | false | RM 插件有 `window.__YAKUSHA.reload()`，但没有文件监听；Ren'Py 每次启动重读翻译文件 |

三个概念必须分开，否则 GUI 会显示一个点了就报错的按钮：

- `runtime`：**已经实现**的投递方式，0.11 有两档：
  - `plugin`（MZ、MV）——装一个 JS 插件，运行时由插件读字典替换显示文本；删掉插件
    条目即还原。
  - `translation`（Ren'Py）——生成引擎自带的翻译资源
    `game/yakusha_translation.rpy`，由引擎自己的 `translate <lang> strings:` 机制
    查表替换；删掉这一个文件即还原。
  - 两档的共同点都是“加一个文件、删掉即还原”，区别在谁执行替换：`plugin` 是 yakusha
    的插件，`translation` 是引擎本身。`debug` / `inject` 只是预留枚举，0.11 没实现。
- `debuggable`：**引擎本身**是否支持 CDP。MZ 为 true，是实测结论；不代表工具能用。
- `attach`：**工具是否实现** attach。0.11 三个引擎都为 false；GUI 只有它为 true 才显示“调试注入”。

MV 的 `debuggable:false` 有实测依据：2019/2020 年的 nw.js 版本传
`--remote-debugging-port` 不监听；MZ 1.7.0 可以监听并执行 `Runtime.evaluate`。
未来若发现某个 MV 版本可调试，应改成“按版本判断”，而不是全局 true。

## 6. MZ / MV 的差异

| 项 | MZ | MV |
| --- | --- | --- |
| core 文件 | `js/rmmz_core.js` | `js/rpg_core.js` |
| 引擎版本 | core 里 `vX.Y.Z` | 同上 |
| 实测区间 | 1.3.2–1.9.0 | 1.6.1–1.6.2 |
| 数据目录 | `data/` | `data/` |
| 明文 | 是 | 通常是；也可能单字节 XOR |
| 插件钩子 | `DataManager.onXhrLoad` | `DataManager.loadDataFile` + `onLoad`（按对象身份认领） |
| CDP | 可用 | 旧版本不可用 |

MV 的插件路径不是“计划”：`src/plugin/YAKUSHA_Translator.js` 已经有
`installMvHook`（包 `loadDataFile` 记录 `(name, src)`，再包 `onLoad` 用
`window[entry.name] === object` 认领），并已在 4 款 MV 游戏上跑通。
adapter 只是把“装哪个插件、怎么探测”变成统一接口，不改变运行时行为。

### 6.1 Ren'Py 与两者的差异

| 项 | MZ / MV | Ren'Py |
| --- | --- | --- |
| 数据形态 | `data/*.json`，明文或单字节 XOR | `game/` 下的 `.rpy` 明文与 `.rpyc` 编译文件 |
| 识别依据 | `js/rmmz_core.js` / `js/rpg_core.js` | `game/` 直接下层存在 `.rpy` 或 `.rpyc` |
| 引擎版本来源 | core 文件里的 `vX.Y.Z` | `game/options.rpy` 的 `define config.version`；没有就是 `null` |
| 投递 | 装插件，运行时读字典 | 生成 `game/yakusha_translation.rpy`，引擎自己查表 |
| 卸载 | 删插件文件 + 摘 `$plugins` 条目 + 从备份还原 `plugins.js` | 只删那一个翻译文件 |
| 备份 | `js/plugins.js.yakusha-backup` | 不需要（不改任何原有文件） |
| 计数单位 | data files（`data/` 下的文件数） | scripts（实际解码成功的脚本数） |
| 控制码 | `\\C[6]`、`\\N[1]` 这类转义码 | `{b}` / `{color=#ff0000}` 文本标签与 `[player_name]` 插值 |
| 占位符校验 | `%1` 形式的数字槽 | `[...]` 形式的插值 |
| 只读来源 | 不读 `js/plugins/*.js` | 跳过 `game/tl/`（引擎自己的翻译目录）与自己生成的翻译文件 |

控制码与占位符的语法差异由 profile 数据承担（`src/engines/profile.js` 与
`src/engines/renpy/profile.js`），`rules` 仍是 `{controlCodes:true, maxColumns:0}`
三键不变，pipeline 里没有引擎特判。

## 7. 安装 / 卸载契约

安装的产物按 `capabilities.runtime` 分两档，载荷键名相同（6 个 / 5 个），只是
Ren'Py 下部分键恒为 `null` / `false`。下面 7.1–7.4 是插件档（MZ / MV），7.5 是
translation 档（Ren'Py）。

### 7.1 写哪些文件（插件档）

- 插件：`<root>/js/plugins/YAKUSHA_Translator.js`
- 注册：`<root>/js/plugins.js` 的 `$plugins` 数组里一条
- 备份：`<root>/js/plugins.js.yakusha-backup`（只在首次安装时创建）

除此之外不写任何游戏文件。不写 `data/`，不改 exe，不写注册表。

### 7.2 安装

1. 读 `plugins.js`；解析失败 → `E_IO`（消息指出行/原因，不带 stack）。
2. 没有备份时复制一份；已有备份时比对“当前 `plugins.js` 去掉自己那条”与备份，
   不一致则返回 `staleBackup: true` 并 warn（不覆盖备份）。
3. 用 `src/core/fields.js` 重新生成 `RULES`，把插件模板写到 `js/plugins/`。
4. 把 `$plugins` 里的条目 upsert（同名替换，不重复添加），保留原文件的尾逗号与
   LF/CRLF 风格。
5. 返回 `{pluginPath, registered:true, backupPath, createdBackup, staleBackup, state}`。
6. **幂等**：连续安装两次，文件内容一致（除了新生成的 `RULES` 与版本号本来就相同），
   `$plugins` 里不会出现两条。

`--embed`：把字典条目编译进插件（`EMBEDDED` 块），适合离线分发；需要字典存在，
否则 `E_NO_DICTIONARY`。卸载仍然只删插件文件、摘注册条目，不留内嵌数据在别处。

### 7.3 卸载

1. 删插件文件。
2. 从 `$plugins` 摘掉自己那条。
3. 有备份时比对“当前 `plugins.js`”与备份：
   - 一致（只差自己那条）→ 用备份逐字节还原，删备份，`restored:true`；
   - 不一致（游戏更新 / 用户装了别的插件）→ 不还原，保留备份，`drifted:true`，
     `keptBackup` 指向它。
4. 返回 `{removed, restored, backupPath, drifted, keptBackup}`。
5. **幂等**：没装时卸载返回 `removed:false`，不报错。

### 7.4 路径 containment

所有写入/删除前：

- 对 `project.root` 与目标路径做 `realpath`（目标不存在时对父目录做）。
- 目标必须仍在 root 内（Windows 大小写不敏感比较）；否则 `E_IO`，
  消息说明“refusing to write outside the project root”。
- 拒绝把 `plugins.js` 的备份写到项目外；拒绝跟随指向项目外的符号链接。
- 不把 containment 当“防恶意游戏”的完整沙箱：游戏文件仍是不可信输入，
  但 0.11 只读 JSON / JS / `.rpy` 文本与 `.rpyc` 容器，不执行它们，也没有
  一条路径会把游戏代码跑起来。

### 7.5 写哪些文件（translation 档，Ren'Py）

只有一个文件：`<root>/game/yakusha_translation.rpy`。

- 直接放在 `game/` 下，**不**放 `game/tl/`。`tl/` 是 Ren'Py 自己的翻译目录，
  yakusha 既不写它、扫描时也跳过它（见 §13.2）。
- 不改 `options.rpy`、不改任何原有脚本、不建备份。卸载就是删这一个文件，
  其他字节一个不动。

文件内容三段：

```renpy
# Generated by yakusha. Do not edit by hand.
# （若干行注释：这是 yakusha 生成的一次性文件，删掉即卸载）

init python:
    if config.default_language is None:
        config.default_language = "schinese"

translate schinese strings:

    old "原文"
    new "译文"
```

- 第二段只在 `config.default_language` 仍是 `None` 时设置语言：玩家自己在设置里
  选过的语言存在 `_preferences.language` 里，不能被覆盖。
- 第三段的 `old` / `new` 对来自字典里**已翻译**的条目：按原文排序、按原文去重
  （同一个 `old` 出现两次会让 Ren'Py 启动即报错），跳过空串与空白串。
- 字符串按 `renpy.translation.quote_unicode` 的规则转义：反斜杠加倍、双引号转义、
  七个控制字符写成 `\a \b \f \n \r \t \v`；`{tag}` 与 `[var]` 原样通过。
- 一条译文都没有时 `install` **不写空文件**，而是报 `E_NO_DICTIONARY`（§7.6）：
  空文件在运行时什么也不做，静默失败比报错更难查。库层的 `installTranslation`
  拿到空列表时只写文件头，不报错——那是库调用方的责任。

### 7.6 安装与卸载（translation 档）

安装的前置条件与 7.2 的 `--embed` 类似，但这里是硬性的两条 `E_NO_DICTIONARY`：

- 没有字典 → `no dictionary yet: <file> - run: yakusha extract <game>`
- 有字典但一条都没译 → `the dictionary has no translated entries yet - run: yakusha translate <game>`

语言名必须是 Python 标识符（`^[A-Za-z_][A-Za-z0-9_]*$`，且不能是 `None` /
`True` / `False`），否则 `E_USAGE`：
`invalid Ren'Py language name: "<value>" (expected a Python identifier such as "schinese")`。
0.11 的命令行没有选语言的入口，固定写 `schinese`；只有库调用能传别的语言名。

- **幂等**：重写内容一致时不改文件时间戳，`state` 停在 `unchanged`，
  `created` / `changed` 均为 `false`。
- **载荷仍是那 6 个键**：`pluginPath`（生成的 `.rpy` 绝对路径）、
  `registered`（恒 `true`，文件存在即注册）、`state`（`added` / `unchanged`），
  `backupPath` / `createdBackup` / `staleBackup` 恒为 `null` / `false`。
  adapter 还返回 `entries` 与 `language`，但**不进 JSON 信封**——它们只用于文本模式
  的 `strings    : N (schinese)` 那一行。
- **没有 `--embed`**：翻译文件本身就是投递物，没有“嵌进插件”这回事。`--embed`
  在 Ren'Py 上只是语法合法的空操作——产物与不带它时逐字节相同，也不多打一行；
  但它仍会先走 CLI 那层通用于所有引擎的字典前置校验，所以零已译条目时
  照样报 `E_NO_DICTIONARY`（`--embed needs a dictionary` /
  `--embed found no translated entries`），不是在 adapter 里被忽略。
- **卸载**：只删 `game/yakusha_translation.rpy`。`removed` 为 `false` 表示它本来
  就不在（不报错）；`restored` 恒 `false`，`backupPath` 与 `keptBackup` 恒 `null`，
  `drifted` 恒 `false`。没有“漂移”概念：没有第三方会改这个文件。
- **containment**：写之前对最近的存在祖先做 `realpath`，目标逃出项目根就
  `E_IO` `refusing to write outside the project root: <target>`。

## 8. 启动契约（`launch`，0.10 已实现，0.11 不变）

### 8.1 命令

```
yakusha launch <game-dir> [--exe <name>] [--json]
```

0.10 只支持 Windows；非 Windows → `E_UNSUPPORTED_PLATFORM`。

### 8.2 发现 exe

1. 只看 `project.root` **直接子项**，不递归。
2. 收集 `lstat` 为普通文件、名字以 `.exe` 结尾（大小写不敏感）的项。
   符号链接不算（避免指到项目外）；目录不算。
3. 恰好一个 → 用它。
4. 0 个或多个 → `E_EXE`，`details.candidates` 列出最多 20 个文件名，消息提示用 `--exe`。
5. `--exe <name>`：
   - 必须是**裸文件名**：不含 `/`、`\`、`..`，不是绝对路径；
   - 必须以 `.exe` 结尾；
   - 必须在 root 直接子项中存在且是普通文件；
   - 大小写不敏感匹配（Windows 语义），但最终用磁盘上的真实文件名。
   任一不满足 → `E_EXE`，不尝试“修正”用户输入。

### 8.3 spawn

```js
const child = spawn(exeAbs, [], {
  cwd: project.root,
  detached: true,
  stdio: "ignore",
  shell: false,
  windowsHide: false,
  env: childEnv,
});
child.unref();
```

- **无参数**：不传任何启动器参数，也不支持“启动器参数”。需要参数的玩家自己启动
  游戏，工具只负责投递翻译。三引擎同一套规则。
- **`shell:false`**：exe 路径即使含空格也不经过 cmd.exe；避免命令注入。
- **`detached:true` + `stdio:"ignore"` + `unref()`**：CLI 退出后游戏继续跑；
  不接管 stdout/stderr，不等待退出，不 kill。
- **cwd = 项目根**：RPG Maker 游戏按相对路径找 `www/` / `data/`；Ren'Py 的启动器
  也按自己所在目录找 `game/`，两者都以项目根为工作目录。
- **env**：复制 `process.env`，删除 `YAKUSHA_API_KEY` 与 `OPENAI_API_KEY`
  （以及大小写变体），防止把翻译密钥传给游戏进程。其余环境变量原样保留。
- 失败（`error` 事件 / 立即非零退出）→ `E_IO`，消息含 exe 与错误码；
  不做“重试另一个 exe”。
- 成功返回 `{pid, exe, root}`；`pid` 只用于展示，不用于后续 kill（工具不管理游戏生命周期）。

### 8.4 安全边界

- exe 只能来自项目根的直接子项；**不能**来自配置文件、字典、`package.json` 或
  游戏内的任意路径。`--exe` 也只接受裸文件名。
- 不读 `package.json` 的 `main` 来决定启动什么；RPG Maker 的 exe 与网页入口是两回事。
- 不实现“以管理员身份启动”“兼容模式”“Winlator/Proton 包装”。

## 9. attach 契约（0.10 起是桩，0.11 不变）

```js
attach(project, options) {
  const err = new Error("attach is not implemented in 0.10");
  err.code = "E_NOT_IMPLEMENTED";
  throw err;
}
```

- **没有** `yakusha attach` 命令；GUI 也不会显示入口（`capabilities.attach:false`）。
  三个引擎共用这一个桩：Ren'Py 也没有调试注入，`debuggable` 同样是 `false`。
- 未来实现时，返回值固定为 `{status, detach(), on("exit", cb)}`；
  失败必须能回退到“不带注入启动”，不能把游戏弄成打不开。
- MZ 的 `debuggable:true` 是为未来留的证据，不是“现在能用”的承诺：
  实测要点是 `--remote-debugging-port` 能监听、`Runtime.evaluate` 能读写；
  `Page.captureScreenshot` 不稳定；窗口在后台时渲染循环会停，必须先前台化。
  这些写进未来的 attach 设计，不写进 0.11 的用户文档。
- 那句 `"attach is not implemented in 0.10"` 是**历史措辞，不要改**：契约测试断言的就是
  这一行字符串（`test/engine-contract.test.js` 与 `test/renpy-adapter.test.js` 各一条），
  用户文档也不引用它。改文案要同时改两处测试。

## 10. 公共门面与打包

新增 `src/index.js`，至少导出：

```js
export { openProject, findProjectRoot, findProjectRoots } from "./core/mzproject.js";
export { detectProject, getAdapter, getAdapters } from "./engines/registry.js";
export { extractProject } from "./core/extract.js";
export { openRenpyProject, findRenpyRoot, findRenpyRoots } from "./engines/renpy/project.js";
export { extractRenpyProject, collectRenpyUnits } from "./engines/renpy/extract.js";
export { installTranslation, uninstallTranslation, translationStatus } from "./engines/renpy/runtime.js";
export { loadDictionary, saveDictionary, dictionaryPath } from "./core/dict.js";
export { translateDictionary } from "./pipeline/translate.js";
export { verifyDictionary } from "./pipeline/verify.js";
export { installPlugin, uninstallPlugin, isInstalled } from "./core/install.js";
export { diagnose } from "./core/doctor.js";
export { buildRules } from "./core/fields.js";
export { VERSION } from "./version.js";
```

（`src/version.js` 从 `package.json` 读版本，避免第三处手写。）

`package.json` 加：

```json
{
  "main": "./src/index.js",
  "exports": {
    ".": "./src/index.js",
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  }
}
```

- 只加 `"."` 会斩断现有深路径（`import "yakusha/src/core/dict.js"`）；`./src/*`
  保住它们。
- 自引用测试：在仓库根用 `node --input-type=module -e "import('yakusha')"` 能拿到门面。
- `files` 已包含 `src`，不需要改。
- `bin` 仍是 `./bin/yakusha.js`；bin 只做解析/分派/输出，不塞业务逻辑——0.11 接
  Ren'Py 时 bin 只多了一个 `adapter.dataUnit === "scripts"` 的分支（`scan` 与 `doctor`
  的行标）和一个 `runtime === "translation"` 的分支（`install` 的三行文本），
  没有出现 `if (engine === "renpy")`。

## 11. 版本单一真源

现状有三处版本：`package.json`、插件里的 `VERSION`、测试断言。0.10 起如此，0.11
不变：

- `package.json` 是唯一真源。
- 插件的 `VERSION` 由 `installPlugin` 在渲染模板时替换成 `package.json` 的值；
  模板里的常量只是占位，测试不得断言具体版本号。
- `--version` 输出 `yakusha <package.json version>`。
- `test/version.test.js` 断言：门面 `VERSION`、`--version`、插件模板渲染结果三者一致。
- Ren'Py 的翻译文件**不参与**这条链：`installTranslation` 支持一个可选的
  `pluginVersion` 只用来装饰文件头（`# Generated by yakusha <version>.`），但 0.11 的
  `install` 不传它，所以实际落盘的头部是第一行 `# Generated by yakusha. Do not edit by hand.`，
  不带版本号。文件内容与时间戳都不参与版本比对。
- 发布时只改 `package.json` 一处。

## 12. 契约测试

### 12.1 位置

`test/engine-contract.test.js` 与 `test/renpy-adapter.test.js`，**都平铺在 `test/` 下**。

原因：`package.json` 的 `npm test` 是 `node --test "test/*.test.js"`，不收子目录；
放 `test/contract/` 会静默不执行。不要为了一个测试去赌 Node 22 的 globstar。

Ren'Py 的契约用例单独一个文件，原因写在 `engine-contract.test.js` 的文件头：Ren'Py
共用 adapter 形状，但不共用 fixture 布局、插件注册表和安装语义，硬塞进同一个文件只会
让每个用例都长出一堆 `if (engine === "renpy")`。

### 12.2 fixtures

- `test/fixtures/mini-mz`：已有，保持。
- `test/fixtures/mini-mv`：已有。最小形状：
  `js/rpg_core.js`（含 `v1.6.2` 注释）、`js/plugins.js`（`var $plugins = [];`）、
  `data/System.json`（含 `gameTitle`）、`data/Map001.json`（一条 401 文本）、
  `index.html`。不需要 exe，也不需要可运行。
- Ren'Py（0.11 新增）：
  - `test/fixtures/renpy-extract/{rpy,mixed,rpyc,broken,lineless}/game/`：
    只给 `.rpy`、两种格式并存、只给 `.rpyc`、故意损坏的 `.rpyc`、没有行号的条目。
  - `test/fixtures/renpy-rpyc/`：同一份脚本的 `.rpy` 与 `.rpyc` 并排放，用来断言
    “同 stem 只读 `.rpy`”。
  - `test/fixtures/renpy-rpy/*.rpy`：词法覆盖——对话、screen、标记、未闭合引号、
    Python 块、应当被跳过的构造。
  - `test/fixtures/renpy-extract/README.md` 与 `test/fixtures/renpy-rpyc/README.md`
    说明这两组夹具各覆盖什么；每个子目录不单独再来一份。
- 测试不得改 fixture 本体；每个用例复制到 `os.tmpdir()` 下的新目录
  （`engine-contract.test.js` 的 `copyGame()`、`renpy-adapter.test.js` 的 `sandbox()`）。

### 12.3 每个 adapter 必过的用例

三引擎共用（`engine-contract.test.js` 的 `getAdapters()` 循环 + 各引擎自己的同名用例）：

- capabilities：七个键齐全、类型正确；`rules` 恒为 `{controlCodes:true, maxColumns:0}`；
  方法都是函数；`getAdapter("nope") === null`；`getAdapters()` 返回副本。
- detect：空目录 → 本引擎的 `E_NOT_PROJECT`；子目录/上级目录 → 找到同一个 root；
  幂等；不写盘。
- scan：载荷字段与 [json-contract.md](json-contract.md) §7 一致（Ren'Py 是同一组
  11 个键）。
- extract：生成字典；再跑一次 `added: 0`。
- attach：抛 `E_NOT_IMPLEMENTED`，且 `capabilities.attach === false`。
  `capabilities.runtime` 为 `plugin`（MZ / MV）或 `translation`（Ren'Py）。

RPG Maker 专属（`engine-contract.test.js`，因为依赖 `data/` 与 `js/plugins.js`）：

- detect：同层两个项目 → `E_MULTI_ROOT` + 排序后的候选；缺 `data/` 或 `plugins.js`
  仍报原有文案；一个 adapter 拒绝另一个引擎的 fixture。
- install：`isInstalled()` 为真；`$plugins` 只有一条；两次安装不重复；
  CRLF 的 `plugins.js` 仍保持 CRLF；插件路径逃出 root 被拒。
- uninstall：干净安装后逐字节还原；装后改过别的条目 → `drifted:true`、备份保留；
  卸载路径逃出 root 被拒。
- launch：发现规则用纯函数测（0 个 / 1 个 / 多个 / `--exe` 非法 / 项目外路径）；
  spawn 用注入的假实现断言参数与 env，**不真的启动游戏**（`test/launch.test.js`）。

Ren'Py 专属（`test/renpy-adapter.test.js`，14 条）：

- 在 registry 里排最后、带自己的 profile、`runtime` 为 `translation`、
  `dataUnit` 为 `scripts`、有 `diagnostics`。
- 从 root、`game/`、以及上一级目录都能找到同一个项目；从 `game/` 找到时 `root`
  仍是项目根而不是 `game/`。
- 错误目录报 Ren'Py 那句 `E_NOT_PROJECT`；两个同级项目报 `E_MULTI_ROOT` 且候选排序。
- scan 保留那 11 个键；解码失败的脚本按“一条脚本一行”进 `undecodable`。
- install 交付一个翻译脚本；缺字典或零已译条目分别报两次 `E_NO_DICTIONARY`；
  生成的 `game/yakusha_translation.rpy` **不会**被下一次 extract 当成源脚本。
- uninstall 只删那一个文件；install + uninstall 前后游戏脚本逐字节不变。
- doctor 把交付的文件当成 install 与 runtime 两项来检查。

### 12.4 运行环境

- 测试显式清空 `YAKUSHA_*` / `OPENAI_API_KEY`，避免开发机环境让断言飘。
- 只用 `os.tmpdir()` 下的临时目录；测试结束清理，失败也清理（`after` 钩子）。
- CI 在 `windows-latest` 上跑 Node 22 / 24；不写 POSIX-only 断言。

## 13. 文本抽取契约

### 13.1 RPG Maker（MZ / MV）

- 数据源只来自 `data/*.json`（按文件名排序）。不读 `js/plugins/*.js`、
  不读图片、不读 `www/data`（除非它就是项目的 `data/`）。
- 明文直接 `JSON.parse`；失败时按单字节 XOR 穷举 256 个 key；0 字节 / 空白占位算
  `empty`，不算 `undecodable`。
- 字段表与指令表来自 `src/core/fields.js`（唯一真源）；adapter 不得复制一份。
- context 形如 `<文件名>:<code>` 或 `<文件名>:<字段>`，与现有 `extract.js` 一致。
- `engineVersion` 来自 core 文件的 `vX.Y.Z`；读不到就是 `null`，不猜。
- `scan` 不需要字典；`extract` 会写 `yakusha/dictionary.json`，已存在时只增不删。

### 13.2 Ren'Py

与 13.1 共享的是**策略**（只增不删、context 指回原位置、`scan` 不需要字典、
解码失败的来源只记录不中断），不同之处如下。

**两种源。** `game/` 下的 `.rpy` 是明文，`.rpyc` 是编译产物。两者都读：

- `.rpy` 走 `rpyscript.js`，按 Ren'Py 自己的词法规则决定一个引号字面量在运行时
  求值成什么（转义、三引号分段、`[` / `{` / `%` 的加倍）。
- `.rpyc` 走 `rpyc.js`：`RENPY RPC2` 容器 → slot 1 的 `(header, statements)` →
  纯 JS 的 pickle 读取（`pickle.js`，无依赖、不 `eval`）。Ren'Py 7.x 里只有
  Python 2 才认识的 opcode 直接报 `undecodable`，不猜。
- `.rpyc` 末尾 16 字节的 MD5 **不校验**：用它判断“这个文件是不是被改过”只会把
  本来能读的游戏拒掉，收益为零。

**同 stem 只读 `.rpy`。** 同一个名字的 `.rpy` 与 `.rpyc` 同时存在时只读 `.rpy`。
理由很实际：两者内容相同，都读会让每条文本在`totalStrings`里出现两次，
唯一串数不变而出现次数翻倍，`scan` 的“strings: X unique / Y total”就没意义了。
纯 `.rpyc` 分发的商业游戏仍然能抽，只是条目拿不到行号（见下面的 context）。

**跳过两类文件。** `game/tl/**`（Ren'Py 自己的翻译目录，里面是别人已有的译文，
不是原文）和 yakusha 自己生成的 `game/yakusha_translation.rpy`（否则装完再抽会把
自己的译文当成原文再翻一遍）。`tl/` 在任何层级出现都跳过。

**四类文本。** `kind` 有四种，与 [design.md](design.md) 的分类一致：

| kind | 来源 |
| --- | --- |
| `say` | 对话与裸旁白；带说话人时只取引号里的台词（`"Lucy" "Better watch out."` 取第二句） |
| `menu` | `menu:` 的标题**与选项标签**（`menu:` 块的第一层字面量整体算 `menu`） |
| `string` | 被 `_()` 包起来的字符串，出现在哪里都算 |
| `screen` | `screen` 里 `text` / `textbutton` / `label` / `tooltip` / `notify` 的第一个字面量 |

刻意不抽：注释、Python 代码块与 `$` 行里的字符串、`define` / `default` 右值
（除非被 `_()` 包住）、`old` / `new` 语句、整个 `translate` 块、图片/音乐/字体路径、
`style` 属性值与 ATL 块。它们要么不是给玩家看的，要么改了会坏。

**context 与行号。** `<相对项目根的 posix 路径>:<行号>`，例如
`game/script.rpy:12`。从 `.rpyc` 抽出的条目没有行号，context 退化成只有路径
（`game/script.rpyc`）。路径分隔符统一用 `/`，不随平台变。

**失败不中断。** 一个打不开或解不出的脚本进 `undecodable`（`<file>: <error>`），
遍历继续；`scripts` 与 `encodings` 的计数只在成功解码后加一，所以
“scripts 显示的数”与“doctor 首行括号里的数”永远是同一个数。

**`engineVersion`。** 来自 `game/options.rpy` 的 `define config.version`，静态读取、
不执行脚本；没有就是 `null`，`scan` 的 `engine    : renpy` 后面就不带版本号。

**实测规模（外部样本，非仓库可复现）。** 在一套 Ren'Py 8.5.3 SDK 的全部 585 个
`.rpyc` 上跑解码：585 个全部成功、0 个失败，共 81,041 条字符串、70,728 个 AST 节点，
脚本格式版本一律 5003000。全 SDK 有 581 个 stem 同时带 `.rpy` 与 `.rpyc`；只看两个
官方示例游戏里那 29 个同 stem 脚本（不含 `tl/`），`.rpy` 读出 1,446 条、逐脚本去重后
相加 1,319 条，`.rpyc` 读出 854 条、同法 852 条：`.rpyc` 独有而 `.rpy` 缺的为 **0**，
同一口径下 `.rpyc` 少 467 条——所以「同 stem 只读 `.rpy`」不会丢文本。两个官方
示例游戏的扫描结果见 [games.md](games.md)，那里同时写明这不等于对商业 Ren'Py 游戏的验收。

## 14. 引擎覆盖与未来引擎

已经接入的：

| 引擎 | 文本形态 | 运行时档 | 状态 |
| --- | --- | --- | --- |
| RPG Maker MZ | `data/*.json` | `plugin`（L4-plugin） | 0.10 已实现 |
| RPG Maker MV | `data/*.json` | `plugin`（L4-plugin） | 0.10 已实现 |
| Ren'Py | `.rpy` 明文 / `.rpyc` 编译 | `translation`（L4-resource） | 0.11 实现：L2–L4 |

还没做的（只记边界，不排期）：

| 引擎 | 文本形态 | 可能的运行时 | 状态 |
| --- | --- | --- | --- |
| Unity | 资源包 / Mono / IL2CPP | `inject` 或运行时补丁 | 不做 |
| Wolf / Kirikiri | 自有归档 | `inject` | 不做 |
| RGSS (XP/VX/VX Ace) | `.rxdata` 二进制 | `inject` | 不做 |

L4-plugin / L4-resource 是 [dev/ENGINE-STRATEGY.md](dev/ENGINE-STRATEGY.md) §5.5
的四档交付术语：plugin 是“加插件、删文件即还原”，resource 是“生成引擎自带的资源、
删文件即还原”。Ren'Py 做到了 L2（真实游戏提取）、L3（翻译与校验）、L4（运行时交付），
**L5（卸载验证）由契约测试里的“install + uninstall 前后脚本逐字节不变”覆盖**。
不要说“完全支持 Ren'Py”：三档里每一档的实际含义都以战略稿的定义为准。

新引擎必须自带：adapter、capabilities、fixture、契约测试、启动规则（如果有 exe）、
自己的 profile。不允许把引擎特判写进 `src/pipeline`；引擎专属校验规则挂在 adapter 上——
0.10.x 起是一份 `profile` 数据（`src/engines/profile.js` 与
`src/engines/renpy/profile.js`，含 prompt / grammar / validate / verify），
`rules` 三键保持不变。

## 15. 验收清单

- [x] `detectProject` 对错误目录/多根返回判别式，不抛、不写盘。
- [x] registry 按 `mz → mv → renpy` 顺序；同目录双 core 取 MZ。
- [x] MZ / MV 两个 fixture 都过同一套契约测试；MV 的 CDP 能力为 false。
- [x] 安装幂等、卸载逐字节还原、漂移时不还原；路径逃逸被拒。
- [x] launch 发现规则全测；spawn 参数与 env 用假实现断言；非 Windows 报平台错误。
- [x] `attach` 桩返回 `E_NOT_IMPLEMENTED`，能力为 false；三个引擎共用同一个桩。
- [x] `import "yakusha"` 自引用可用；旧深路径仍可用。
- [x] 版本三处一致；`--version` 有测试。
- [x] Ren'Py：`.rpy` 与 `.rpyc` 都能抽，同 stem 只读 `.rpy`，`tl/` 与自己生成的
  翻译文件被跳过，解码失败只记一行不中断。
- [x] Ren'Py：`install` 只生成 `game/yakusha_translation.rpy`，`uninstall` 只删它；
  前后游戏脚本逐字节不变；零已译条目报 `E_NO_DICTIONARY` 而不是写空文件。
- [x] Ren'Py：doctor 把翻译文件当 install 与 runtime 两项检查，首行按 `scripts` 计数。
- [ ] `npm test` 在 `windows-latest` Node 22/24 全绿（推送后由 CI 验证）。
