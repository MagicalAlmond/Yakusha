# 引擎适配器契约（0.16 契约）

> **状态：0.16 覆盖五个引擎——RPG Maker MZ、RPG Maker MV、Ren'Py、RGSS（XP / VX / VX Ace）、Kirikiri。**
> 0.14 交付 GUI 外壳，0.15 加 JSONL 导入，0.16 起 `scan` 载荷带引擎能力位（GUI 据此灰显按钮）；
> RGSS 与 Kirikiri 的交付层仍未拍板（DEVLOG §8.1 第 10 行）。
> 0.10 把 MZ 与 MV 包进统一的 adapter，**不搬文件、不重写算法**；0.11 用同一套
> contract 接入 Ren'Py，作为第三个 adapter 挂在 registry 末位；0.12 接入 RGSS，排在
> 第四位，只做到 L1–L3（detect / scan / extract），**没有交付层**；0.13 接入
> Kirikiri，排在第五位，同样只做到 L1–L3，也没有交付层。本文冻结 adapter 的形状、
> 能力矩阵、安装/启动契约与契约测试的落点；引擎之间真正的差异（文本形态、投递方式、
> 控制码语法）下沉到 adapter 与 profile 数据里，不进 `src/pipeline`。

## 1. 目标与非目标

目标：

- CLI 与未来的 GUI 只依赖 `detect()` + adapter 方法，不再在 `bin/yakusha.js` 里
  写 `if (engine === "mz")`。
- 新引擎的接入点固定：一个 `src/engines/<id>/adapter.js` + 一份 fixture + 契约测试。
- 把“引擎能不能做某事”变成数据（`capabilities`），让 GUI 在点击前就能置灰。

非目标：

- RGSS（0.12）与 Kirikiri（0.13）都只到 L1–L3（detect / scan / extract + 既有
  pipeline），**没有交付层**：`capabilities.runtime` 是 `null`，`install` /
  `uninstall` 抛 `E_NOT_IMPLEMENTED`（见 §7.7 与 §7.8）。本版不实现 Unity / Wolf，
  也不实现原生注入（`inject`）。
  Ren'Py 走引擎自带的 translation 资源档，不是注入档，理由见 [design.md](design.md)。
- 不搬 `src/core` 的文件。RPG Maker 的 adapter 是薄包装，`core` 仍可被库用户直接使用。
- 不实现 `attach`（CDP 调试注入），只登记能力与接口；五个引擎的 `attach` 都是 `false`。

## 2. 目录与注册表

```
src/engines/
  adapter.js        契约常量、能力默认值、detect 结果形状的辅助函数（无引擎逻辑）
  registry.js       按顺序探测；把 engine id 映射到 adapter
  launch.js         exe 发现与 spawn（五引擎共用，见 §8）
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
  rgss/
    adapter.js      RGSS adapter：detect / scan / extract；install / uninstall 抛桩
    project.js      定位 Game.ini / 归档 / Data/，判定 XP / VX / VX Ace 与版本号
    archive.js      RGSSAD / RGSS2A / RGSS3A 三种归档的读（与写，本版未用于交付）
    marshal.js      纯 JS Ruby Marshal 4.8 读写（无 eval、不执行任何对象）
    extract.js      数据文档 → 字典条目；只收玩家能读到的位置（见 §13.3）
    profile.js      RGSS 的 profile 数据（反斜杠转义码语法）
  krkr/
    adapter.js      Kirikiri adapter：detect / scan / extract；install / uninstall 抛桩
    project.js      定位 data/（或根目录本身）下的 .xp3 归档，向上/向下最多 3 层
    xp3.js          纯 JS XP3 容器读：头部、File 索引、info / segm / adlr 子块
    ks.js           .ks 词法：行分类、行内标签剥离、[name_set] 说话人跟踪
    extract.js      归档里的 .ks 脚本 → 字典条目；.tjs 只计数不解析（见 §13.4）
    profile.js      Kirikiri 的 profile 数据（KAG 标签语法）
src/index.js        公共门面（见 §10）
```

`registry.js` 导出：

- `getAdapters()`：按 `mz → mv → renpy → rgss → krkr` 顺序返回 adapter 数组。
- `detectProject(startDir)`：返回与 `adapter.detect` 相同的判别式结果，外加 `adapter`。
- `getAdapter(engine)`：按 id 取；未知 id 返回 `null`（不抛）。

探测顺序固定：**MZ → MV → Ren'Py → RGSS → Kirikiri**，这是公开契约
（`src/engines/registry.js:18` 的 `ADAPTERS` 数组顺序，模块头注释也这么写）。一个目录同时有 `js/rmmz_core.js` 与
`js/rpg_core.js` 时按 MZ 处理（与现有 `openProject` 的
`fs.existsSync(MZ_CORE) ? "mz" : "mv"` 一致）。Ren'Py 按 `game/` 下的 `.rpy` / `.rpyc`
识别、RGSS 按 `Game.ini` / `RGSSAD` 家族归档 / `Data/` 识别、Kirikiri 按
`data/`（或根目录本身）下的 `.xp3` 归档识别，都与 RPG Maker 的 core 文件不重叠；
顺序只影响“五个都不像”时报哪一句。

`detectProject` 遇到 `E_MULTI_ROOT` 立即返回，不再尝试下一个 adapter：多根意味着
用户给的是一个装了多款游戏的目录，换引擎试没有意义。Ren'Py、RGSS 与 Kirikiri 的
`E_MULTI_ROOT` 只出现在各自的搜索里，候选集不会与 RPG Maker 混在一起。

registry 把四句 `not a … project`（RPG Maker、Ren'Py、RGSS、Kirikiri 各一句，
`src/engines/registry.js:26-31` 的 `NOT_PROJECT_PREFIXES`）当成“这个引擎不匹配，
继续试下一个”；其余 `E_NOT_PROJECT`（缺 `data/`、缺 `js/plugins.js`）立即返回——
那说明引擎已经认出来、只是项目不完整，不该再拿别的引擎去猜。五个都不匹配时返回第一句
通用文案，也就是 RPG Maker 那句（见 §4.2）。

RGSS 的 detect 先向上找（`src/engines/rgss/adapter.js:63-72` 的 `containingRoot`，
最多 3 层），再向下 BFS；用户点的是“装了游戏的文件夹”还是“游戏里的 `Data/`”，
都能落到同一个 root。Kirikiri 的 detect 同样先向上找（`src/engines/krkr/adapter.js:60-69`
的 `containingRoot`，最多 3 层），再向下 BFS；`data/` 目录本身也算一个项目根——
用户把目录指到 `data/` 上时，root 就是 `data/` 自己。

## 3. Adapter 形状

```js
export default {
  id: "mz",
  name: "RPG Maker MZ",

  capabilities: {
    extract: true,        // 能抽文本
    export: true,         // 能导出（0.10 起只有 JSON）
    runtime: "plugin",    // 已实现的运行时投递方式：plugin | translation | null
    launch: true,         // 能发现并启动游戏 exe
    debuggable: true,     // 引擎本身支持 CDP 调试（不等于工具已实现 attach）
    attach: false,        // 工具是否实现 attach；0.10 起全为 false
    liveReload: false,    // 改字典后是否自动生效；至今只能手动 reload
  },

  // 只读探测：不抛预期错误、不写盘、不联网。
  // 成功 {ok:true, project}；失败 {ok:false, code, message, candidates?}
  detect(startDir) { ... },

  scan(project) { ... },                 // 文本量统计（CLI scan 的载荷）
  extract(project) { ... },              // 写字典（CLI extract 的载荷）
  installRuntime(project, options) { ... },
  uninstallRuntime(project) { ... },
  launch(project, options) { ... },      // {pid, exe, root}
  attach(project, options) { ... },      // 0.10 起只抛出 E_NOT_IMPLEMENTED

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
- `dataUnit` 与 `diagnostics` 只有 Ren'Py 与 RGSS 有；CLI 用
  `adapter.dataUnit === "scripts"` 决定打印 `scripts` 还是 `data files`，用
  `diagnostics` 把引擎自己的抽取器与交付状态交给 `doctor`。MZ / MV 不带这两个字段，
  走原有分支。

RGSS 同样用这个形状，带着 `dataUnit: "data files"` 与一个 `diagnostics()`
（`src/engines/rgss/adapter.js:290-309`）：

```js
{
  id: "rgss",
  name: "RGSS",
  capabilities: { extract: true, export: true, runtime: null, launch: true,
                  debuggable: false },   // attach / liveReload 为 false
  dataUnit: "data files",              // 不是 scripts
  profile: rgssProfile,                // 反斜杠转义码语法，见 §13.3
  rules: { controlCodes: true, maxColumns: 0 },
}
```

- `runtime: null` 是 0.12 的**诚实取值**，不是漏填：RGSS 既没有插件档也没有
  translation 档，交付层还没做（见 §7.7）。能力默认值本来就是 `runtime: null`
  （`src/engines/adapter.js:53-64`），RGSS 不覆盖它。
- `diagnostics()` 返回 `{extract, dataFiles, delivery, sourceLabel}`，其中
  `sourceLabel` 是 `"Data/"`，`delivery` 是
  `{pending: true, message: "RGSS has no delivery layer yet, so nothing is written back into the game"}`。
  `doctor` 靠这个 `pending` 分支把 install 记成 warn、runtime 记成 info，而不是走
  RPG Maker 那条读 `pluginsFile` 的分支（RGSS 的 `pluginsFile` 是 `null`）。
- `pluginDir` / `pluginsFile` / `indexPath` 全为 `null`，`version` 是字符串
  `"1"` / `"2"` / `"3"`（不是 MZ 那样的 `"1.7.0"`），读不到就是 `null`。

Kirikiri（0.13，第五位）也用这个形状，带着 `dataUnit: "data files"` 与一个
`diagnostics()`（`src/engines/krkr/adapter.js:277-296`）：

```js
{
  id: "krkr",
  name: "Kirikiri",
  capabilities: { extract: true, export: true, runtime: null, launch: true,
                  debuggable: false },   // attach / liveReload 为 false
  dataUnit: "data files",              // scan 的行标仍是 data files（数的是归档）
  profile: krkrProfile,                // KAG 标签语法，见 §13.4
  rules: { controlCodes: true, maxColumns: 0 },
}
```

- `runtime: null` 与 RGSS 同理，是**诚实取值**：交付意味着把归档写回去（重打包
  XP3），0.13 没做这一层（`src/engines/krkr/adapter.js:226-237` 的注释明说）。
- `diagnostics()` 的 `sourceLabel` 是 `"xp3 archives"`，`delivery` 是
  `{pending: true, message: "Kirikiri has no delivery layer yet, so nothing is written back into the game"}`。
- `gameTitle` / `version` 恒为 `null`：标题与版本住在加密或可选的配置文件里，
  0.13 不解析（`src/engines/krkr/project.js:117-145` 的注释）；scan 因此显示
  `(untitled)`，engine 行没有版本后缀。

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
   Ren'Py 只读 `game/` 下脚本的文件名与 `game/options.rpy` 里的两行 `define`；
   RGSS 只读 `Game.ini`、`Data/` 的文件名与归档的目录区
   （`src/engines/rgss/archive.js:343` 的 `openArchive` 只加载头部窗口，最大 64 MiB）；
   Kirikiri 只读目录布局与 `.xp3` 文件名（判断归档是否存在），归档本身的解析留给
   extract，不参与 detect。
3. **幂等。** 同一目录连续调用两次，结果一致（除了文件系统在这期间被改）。
4. **有界搜索。** 从 `startDir` 开始，向上找自身，向下最多 `MAX_SEARCH_DEPTH = 3` 层，
   跳过隐藏目录与 `SKIP_DIRS`；与现有 `findProjectRoot` 完全一致。
5. **顺序稳定。** 多根时 `candidates` 按深度优先排列。第二关键字两组不同（都是既有
   实现，不是新约定）：RPG Maker 用 `localeCompare`（`src/core/mzproject.js:97`），
   Ren'Py、RGSS 与 Kirikiri 用代码元顺序的字符串比较（`src/engines/renpy/project.js:125`、
   `src/engines/rgss/project.js:272`、`src/engines/krkr/project.js:105`）。`candidates` 只列最浅那一层的根——更深的根算是
   “某个候选项目内部的东西”。

### 4.2 错误文案

0.10 沿用现有文案，避免 CLI 测试与用户习惯同时断掉；Ren'Py 的两句是 0.11 新增，
RGSS 的两句是 0.12 新增，Kirikiri 的两句是 0.13 新增：

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
- `E_NOT_PROJECT`（RGSS，`src/engines/rgss/adapter.js:42-48`）：
  `not an RGSS project (no Game.ini, no .rgssad/.rgss2a/.rgss3a archive and no Data/ directory with .rxdata, .rvdata or .rvdata2 files in <dir> or up to 3 levels below it)`
- `E_MULTI_ROOT`（RGSS，`src/engines/rgss/project.js:291-293`）：
  `found N RGSS projects under <dir>, pass one of them instead: <roots>`
- `E_MULTI_ROOT`（RGSS）的候选只列**最浅那一层**的根
  （`src/engines/rgss/adapter.js:80-87` 的 `shallowestRoots`），与其他引擎一致。
- `E_NOT_PROJECT`（Kirikiri，`src/engines/krkr/adapter.js:39-45`）：
  `not a Kirikiri project (no .xp3 archive in <dir> or up to 3 levels below it)`
- `E_MULTI_ROOT`（Kirikiri，`src/engines/krkr/project.js:99-114`）：
  `found N Kirikiri projects under <dir>, pass one of them instead: <roots>`
- `E_MULTI_ROOT`（Kirikiri）的候选同样只列**最浅那一层**的根
  （`src/engines/krkr/adapter.js:77-84` 的 `shallowestRoots`），排序是代码元顺序
  （`src/engines/krkr/project.js:105`）。

哪一句会被看到，由 §2 的注册表规则决定：`detectProject` 只在收到本引擎的通用文案时
继续试下一个 adapter，所以**空目录下用户看到的是 RPG Maker 那句**——它来自第一个
adapter，与“这个目录是什么游戏”无关。同理，随便指一个五个引擎都不像的目录给
`scan`，报的也是 RPG Maker 那句，而不是 RGSS 那句。

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

| 能力 | MZ | MV | Ren'Py | RGSS | Kirikiri | 含义 |
| --- | --- | --- | --- | --- | --- | --- |
| `extract` | true | true | true | true | true | RM：`data/*.json`，明文或单字节 XOR；Ren'Py：`game/` 下的 `.rpy` / `.rpyc`；RGSS：`Data/*.rxdata` / `.rvdata` / `.rvdata2` 或 `RGSSAD` 家族归档里的同一批文档；Kirikiri：`data/`（或根目录本身）下 `.xp3` 归档里的 `.ks` 脚本 |
| `export` | true | true | true | true | true | 0.10 起只有 JSON 导出 |
| `runtime` | `plugin` | `plugin` | `translation` | **`null`** | **`null`** | RM 装 JS 插件（MZ 包 `onXhrLoad`，MV 包 `loadDataFile` + `onLoad`）；Ren'Py 生成一个翻译脚本；RGSS 与 Kirikiri 本版没有交付层 |
| `launch` | true | true | true | true | true | 项目根唯一 `.exe`（Ren'Py 发行版的根目录通常就是启动器所在处） |
| `debuggable` | true | **false** | false | false | false | MZ 可被 `--remote-debugging-port` + CDP 驱动；MV 的旧 nw.js 不吃这个参数；Ren'Py 是 Python 引擎，没有 CDP；RGSS 是闭源 C++ 运行时；Kirikiri 的 exe 同样没有 CDP |
| `attach` | false | false | false | false | false | 从 0.10 起就没有实现 |
| `liveReload` | false | false | false | false | false | RM 插件有 `window.__YAKUSHA.reload()`，但没有文件监听；Ren'Py 每次启动重读翻译文件；RGSS 与 Kirikiri 没有可重读的文件 |

RGSS 与 Kirikiri 两列的值由 `src/engines/rgss/adapter.js:195-205` 与
`src/engines/krkr/adapter.js:189-199` 固定，并在
`test/engine-contract.test.js:71-94` 里对五个引擎逐个断言
（`ALL_ENGINES = ["mz","mv","renpy","rgss","krkr"]`、
`RUNTIME_TIERS = { mz:"plugin", mv:"plugin", renpy:"translation", rgss:null, krkr:null }`）。

三个概念必须分开，否则 GUI 会显示一个点了就报错的按钮：

- `runtime`：**已经实现**的投递方式，0.11 有两档，0.12 的 RGSS 与 0.13 的 Kirikiri 都是 `null`：
  - `plugin`（MZ、MV）——装一个 JS 插件，运行时由插件读字典替换显示文本；删掉插件
    条目即还原。
  - `translation`（Ren'Py）——生成引擎自带的翻译资源
    `game/yakusha_translation.rpy`，由引擎自己的 `translate <lang> strings:` 机制
    查表替换；删掉这一个文件即还原。
  - `null`（RGSS、Kirikiri）——**没有**交付层。XP / VX / VX Ace 没有插件系统、也没有可挂的
    加载回调；Kirikiri 的译文要写回去就得重打包 XP3 归档。两条路都还没做，所以这个格子必须是
    `null` 而不是随便猜一个档位。`doctor` 的 `install` 检查因此是 warn、`runtime`
    检查是 info（见 §7.7 与 §7.8）。
  - 两档已实现的共同点都是“加一个文件、删掉即还原”，区别在谁执行替换：`plugin` 是
    yakusha 的插件，`translation` 是引擎本身。`debug` / `inject` 只是预留枚举，
    0.13 没实现。
- `debuggable`：**引擎本身**是否支持 CDP。MZ 为 true，是实测结论；不代表工具能用。
- `attach`：**工具是否实现** attach。从 0.10 起所有引擎都为 false，RGSS 与 Kirikiri 也一样
  （`src/engines/rgss/adapter.js:260-262`、`src/engines/krkr/adapter.js:253-255` 都抛共享的
  `notImplemented("attach")`）；GUI 只有它为 true 才显示“调试注入”。

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

控制码与占位符的语法差异由 profile 数据承担（`src/engines/profile.js`、
`src/engines/renpy/profile.js`、`src/engines/rgss/profile.js` 与
`src/engines/krkr/profile.js`），`rules` 仍是
`{controlCodes:true, maxColumns:0}` 三键不变，pipeline 里没有引擎特判。

### 6.2 RGSS 与前三个的差异

| 项 | MZ / MV / Ren'Py | RGSS（XP / VX / VX Ace） |
| --- | --- | --- |
| 数据形态 | `data/*.json` 明文或单字节 XOR；Ren'Py 是 `.rpy` / `.rpyc` | Ruby Marshal 二进制：`Data/*.rxdata`（XP）、`*.rvdata`（VX）、`*.rvdata2`（VX Ace）；打包版把这批文档放进 `Game.rgssad` / `.rgss2a` / `.rgss3a` 归档 |
| 识别依据 | `js/rmmz_core.js` / `js/rpg_core.js`；Ren'Py 是 `game/` 直接下层的 `.rpy` / `.rpyc` | `Game.ini`（大小写不敏感）、`Game.rgss{ad,2a,3a}` 归档，或 `Data/` 下有 `.rxdata` / `.rvdata` / `.rvdata2`（`src/engines/rgss/project.js:214-236`） |
| 引擎版本来源 | core 文件里的 `vX.Y.Z`；Ren'Py 是 `options.rpy` 的 `define config.version` | 归档扩展名 → `Game.ini` 的 `Library=`（`RGSS300`/`301`→3、`RGSS200`-`202`→2、`RGSS100`-`104`→1）→ `Scripts=` 的扩展名 → `Data/` 里的文件扩展名 → `null`；值域是字符串 `"1"` / `"2"` / `"3"`（`src/engines/rgss/project.js:309-326`） |
| 投递 | 装插件 / 生成翻译资源 | **无**（`runtime: null`，见 §7.7） |
| 卸载 | 删插件文件 + 摘 `$plugins` 条目 + 还原备份；Ren'Py 删那一个翻译文件 | **无**（`uninstall` 抛 `E_NOT_IMPLEMENTED`） |
| 备份 | `js/plugins.js.yakusha-backup`；Ren'Py 不需要 | **无**（不改任何原有文件，所以没有要备份的东西） |
| 计数单位 | data files（`data/` 下的文件数）；Ren'Py 是 scripts | data files，但含义是**实际解码成功的文档数**——打包版磁盘上没有文件可数，只能数归档里读到的文档（`src/engines/rgss/extract.js:421-423`） |
| 控制码 | 反斜杠转义（如 `\C[6]`、`\N[1]`）；Ren'Py 是 `{b}` / `[var]` | `\C[n]`、`\V[n]`、`\N[n]`、`\i[n]`、`\!` 等，**同样是反斜杠转义，与 MZ / MV 同族**，所以直接复用 `src/core/textkey.js` 的 tokenizer（`src/engines/rgss/profile.js:22`） |
| 只读来源 | 不读 `js/plugins/*.js`；Ren'Py 跳过 `game/tl/` 与自己生成的翻译文件 | 跳过 `@note` 与所有资源名字段；不含玩家文本的文档根本不打开（见 §13.3） |

### 6.3 Kirikiri 与前四个的差异

| 项 | MZ / MV / Ren'Py / RGSS | Kirikiri |
| --- | --- | --- |
| 数据形态 | `data/*.json` 明文或单字节 XOR；Ren'Py 是 `.rpy` / `.rpyc`；RGSS 是 Ruby Marshal 文档与 `RGSSAD` 家族归档 | XP3 容器归档（`data/` 直接下层，或根目录本身），里面的 `.ks` 脚本承载文本 |
| 识别依据 | core 文件 / `game/` 下脚本 / `Game.ini` 与 RGSSAD 家族 / `Data/` | `data/`（或根目录本身）直接下层存在 `.xp3`（`src/engines/krkr/project.js:49-51`） |
| 引擎版本来源 | core 文件 / `options.rpy` / `Game.ini` 的 `Library=` | **恒为 `null`**：版本住在加密或可选的配置文件里，0.13 不解析 |
| 投递 | 装插件 / 生成翻译资源 / **无** | **无**（`runtime: null`，写回意味着重打包 XP3，见 §7.8） |
| 卸载 | 删文件还原 / Ren'Py 删一个文件 / **无** | **无**（`uninstall` 抛 `E_NOT_IMPLEMENTED`） |
| 备份 | `js/plugins.js.yakusha-backup` / 不需要 / **无** | **无**（不改任何原有文件） |
| 计数单位 | data files / scripts / data files（RGSS 是解码成功的文档数） | data files，含义是**成功打开的 XP3 归档数**（`src/engines/krkr/extract.js:96`） |
| 控制码 | 反斜杠转义 / `{b}` 文本标签 / 反斜杠转义 | `[r]`、`[er]`、`[emb exp=...]` 等 KAG 方括号标签；`[[` 转义出字面 `[`（`src/engines/krkr/profile.js:29`） |
| 占位符校验 | `%1` / `[...]` / 反斜杠槽位 | `%N` 形式的数字槽（`src/engines/krkr/profile.js:123`）；方括号标签已按控制码比较，不重复报 |
| 说话人 | 不追踪（speaker 命令靠字典键形态） | `.ks` 里 `[name_set name=...]` 被逐行跟踪（`src/engines/krkr/ks.js:94-100`），但 0.13 的字典不存说话人 |
| 只读来源 | 不读插件 / 跳过 `game/tl/` / 跳过 `@note` 与资源字段 | `.tjs` 脚本**只计数不解析**——TJS 是编程语言，不懂代码就翻字符串不安全（`src/engines/krkr/extract.js:98-102`） |

## 7. 安装 / 卸载契约

安装的产物按 `capabilities.runtime` 分两档，载荷键名相同（6 个 / 5 个），只是
Ren'Py 下部分键恒为 `null` / `false`。下面 7.1–7.4 是插件档（MZ / MV），7.5–7.6 是
translation 档（Ren'Py），7.7 是 RGSS、7.8 是 Kirikiri——`runtime` 为 `null`，
`install` / `uninstall` 只抛 `E_NOT_IMPLEMENTED`。

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
  但本版只读 JSON / JS / `.rpy` 文本 / `.rpyc` 容器 / Ruby Marshal 字节，不执行它们，
  也没有一条路径会把游戏代码跑起来。

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
0.11 起命令行就没有选语言的入口，固定写 `schinese`；只有库调用能传别的语言名。

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

### 7.7 RGSS：本版没有交付层

RGSS 的 `capabilities.runtime` 是 `null`，`installRuntime()` 与 `uninstallRuntime()`
直接抛错（`src/engines/rgss/adapter.js:184-189` 的 `pending()`、`:245-254`）：

```js
installRuntime() { throw pending("install"); }    // E_NOT_IMPLEMENTED
uninstallRuntime() { throw pending("uninstall"); } // E_NOT_IMPLEMENTED
```

消息原文（两个命令只差开头那个动词）：

- `install is not implemented for RGSS yet - see the pending decisions in docs/dev/DEVLOG.md`
- `uninstall is not implemented for RGSS yet - see the pending decisions in docs/dev/DEVLOG.md`

用户看到的是**退出码 2** 加一个错误信封，`error.code` 是 `E_NOT_IMPLEMENTED`：

```
$ yakusha install <game-dir>
error: install is not implemented for RGSS yet - see the pending decisions in docs/dev/DEVLOG.md

$ yakusha install <game-dir> --json
{"schema":1,"command":"install","ok":false,"outcome":"error","error":{"code":"E_NOT_IMPLEMENTED","message":"install is not implemented for RGSS yet - see the pending decisions in docs/dev/DEVLOG.md"}}
```

- **不写任何文件**。`test/rgss-adapter.test.js` 的 `install: nothing is written into the game
  before the layer exists` 用安装前后的目录快照对比证明这一点；`test/rgss-cli.test.js`
  的 `cli: install says the delivery layer is pending, and writes nothing` 从 CLI 侧再证明一次。
- **不带 `--embed` 时，没有字典也先报这一句**：普通 `install` 不读字典，
  `adapter.installRuntime` 之前没有字典校验，所以缺字典时报的仍是 `E_NOT_IMPLEMENTED`
  （`test/rgss-cli.test.js` 的 `cli: install on a game with no dictionary reports the same
  pending layer`）。反过来，**带 `--embed` 时先撞的是 CLI 那层通用校验**：没有字典报
  `--embed needs a dictionary`，有字典但没译文报 `--embed found no translated entries`，
  两条都是 `E_NO_DICTIONARY` / 退出 2——`--embed` 在 `adapter.installRuntime` 之前
  （`src/cli/runner.js:730-736`），RGSS 也躲不掉。
- **为什么不是一句笼统的“未实现”**：RGSS 的交付层是**计划内**的，只是没拍板，所以
  文案指向决策记录而不断言功能不存在——这与 `attach` 用的那句历史措辞是两种语气，
  两种都有测试盯着（前者 `test/rgss-adapter.test.js:246` 与 `test/rgss-cli.test.js:103`，
  后者 `test/engine-contract.test.js:410`）。

两条路线都还没拍板，写在 `src/engines/rgss/adapter.js:232-244` 的注释里，
待办清单见 [dev/DEVLOG.md](dev/DEVLOG.md) §8.1：

1. **纯 JS 写回数据文档**：把译文塞回 Ruby Marshal 流，重写 `Data/*.rvdata2` 或整个
   `Game.rgss3a` 归档。读写器都已经在 `src/engines/rgss/` 里了
   （`marshal.js` 的 `marshal()`、`archive.js` 的 `writeArchive()`），这条路不需要任何
   原生组件。
2. **原生注入器 + hook DLL**：把译文在运行时塞给游戏进程。这条路需要编译器，而本机
   没有 C/C++/Rust 工具链，也没有 ruby，编译不出来——这是 0.12 排期与验收的硬阻塞。

选定哪条决定 `uninstall` 要还原什么：写回路线要备份被改的文档，注入路线不改盘、
删掉注入器即还原。所以这件事不能靠猜。

另一件**尚未验证**的事：官方 RGSS 读数据时是归档优先还是 `Data/` 目录优先，本版没有
结论（mkxp 的行为是归档优先，但官方 RGSS 不是 mkxp）。本版的 `openDataSource()`
（`src/engines/rgss/project.js:392-429`）在两者都在时选归档，这是**当前实现的选择**，
不是对官方行为的断言。

### 7.8 Kirikiri：本版没有交付层

与 RGSS（§7.7）同一条路，0.13 只做到 L1–L3：

- `install` / `uninstall` 抛 `E_NOT_IMPLEMENTED`，消息
  `install is not implemented for Kirikiri yet - see the pending decisions in docs/dev/DEVLOG.md`
  （`uninstall` 换个动词），退出 2（`src/engines/krkr/adapter.js:178-183` 的 `pending()`，
  `installRuntime` / `uninstallRuntime` 在 :238-240 / :245-247 调它）。
- **不写任何文件**。交付层缺位意味着写回就得重打包 XP3 归档，0.13 没做，也留下
  两个待拍板项（`src/engines/krkr/adapter.js:226-237` 的注释）。
- **带 `--embed` 时先撞的是 CLI 那层通用校验**：没有字典报 `--embed needs a dictionary`，
  有字典但没译文报 `--embed found no translated entries`，都是 `E_NO_DICTIONARY` /
  退出 2（`src/cli/runner.js:730-736`）；不带 `--embed` 时没有字典也先报 pending 那句。
- 测试钉住：`test/krkr-adapter.test.js:150`（install/uninstall 指向待拍板清单）、
  `test/krkr-cli.test.js:101` / :116 / :124（CLI 侧 install 与 uninstall 不写盘）、
  `test/engine-contract.test.js:412`（attach 共享历史措辞）。待拍板清单见
  [dev/DEVLOG.md](dev/DEVLOG.md) §8.1。

## 8. 启动契约（`launch`，0.10 已实现，0.11–0.13 不变）

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
  游戏，工具只负责投递翻译。五个引擎同一套规则。
- **`shell:false`**：exe 路径即使含空格也不经过 cmd.exe；避免命令注入。
- **`detached:true` + `stdio:"ignore"` + `unref()`**：CLI 退出后游戏继续跑；
  不接管 stdout/stderr，不等待退出，不 kill。
- **cwd = 项目根**：RPG Maker 游戏按相对路径找 `www/` / `data/`；Ren'Py 的启动器
  也按自己所在目录找 `game/`；RGSS 的 exe 与 `Data/`、归档都在根下；Kirikiri 的
  exe 与 `data/` 同样在根下，都以项目根为工作目录。五引擎一致。
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

## 9. attach 契约（0.10 起是桩，0.11–0.13 不变）

```js
attach(project, options) {
  const err = new Error("attach is not implemented in 0.10");
  err.code = "E_NOT_IMPLEMENTED";
  throw err;
}
```

- **没有** `yakusha attach` 命令；GUI 也不会显示入口（`capabilities.attach:false`）。
  五个引擎共用这一个桩：Ren'Py 也没有调试注入，`debuggable` 同样是 `false`；RGSS 与
  Kirikiri 的 `attach` 调的是同一个 `notImplemented("attach")`
  （`src/engines/rgss/adapter.js:268-270`、`src/engines/krkr/adapter.js:261-263`）。
- 未来实现时，返回值固定为 `{status, detach(), on("exit", cb)}`；
  失败必须能回退到“不带注入启动”，不能把游戏弄成打不开。
- MZ 的 `debuggable:true` 是为未来留的证据，不是“现在能用”的承诺：
  实测要点是 `--remote-debugging-port` 能监听、`Runtime.evaluate` 能读写；
  `Page.captureScreenshot` 不稳定；窗口在后台时渲染循环会停，必须先前台化。
  这些写进未来的 attach 设计，不写进用户文档。
- 那句 `"attach is not implemented in 0.10"` 是**历史措辞，不要改**：契约测试断言的就是
  这一行字符串（`test/engine-contract.test.js`、`test/renpy-adapter.test.js`、
  `test/rgss-adapter.test.js` 与 `test/krkr-adapter.test.js` 各一条），用户文档也不引用它。
  改文案要同时改这几处测试。

## 10. 公共门面与打包

新增 `src/index.js`，至少导出：

```js
export { openProject, findProjectRoot, findProjectRoots } from "./core/mzproject.js";
export { detectProject, getAdapter, getAdapters } from "./engines/registry.js";
export { extractProject } from "./core/extract.js";
export { openRenpyProject, findRenpyRoot, findRenpyRoots } from "./engines/renpy/project.js";
export { extractRenpyProject, collectRenpyUnits } from "./engines/renpy/extract.js";
export { installTranslation, uninstallTranslation, translationStatus } from "./engines/renpy/runtime.js";
export { openRgssProject, findRgssRoot, findRgssRoots } from "./engines/rgss/project.js";
export { extractRgssProject } from "./engines/rgss/extract.js";
export { openKrkrProject, findKrkrRoot, findKrkrRoots } from "./engines/krkr/project.js";
export { extractKrkrProject } from "./engines/krkr/extract.js";
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
  没有出现 `if (engine === "renpy")`。0.12 接 RGSS 时只多了 `doctor` 的一个分支：
  把 `own.delivery || own.translation || null` 交给诊断器（`src/cli/runner.js:988`），
  让 RGSS 的 `delivery.pending` 能走到 `src/core/doctor.js` 的 pending 分支；
  同样没有出现 `if (engine === "rgss")`。0.13 接 Kirikiri 时 bin **什么都没加**：
  `dataUnit` 是 `data files`、`diagnostics.delivery` 走同一个分支，全库搜不到
  `engine === "krkr"`。

## 11. 版本单一真源

现状有三处版本：`package.json`、插件里的 `VERSION`、测试断言。0.10 起如此，0.11 到
0.13 不变（RGSS 与 Kirikiri 不写任何文件，所以不参与这条链）：

- `package.json` 是唯一真源。
- 插件的 `VERSION` 由 `installPlugin` 在渲染模板时替换成 `package.json` 的值；
  模板里的常量只是占位，测试不得断言具体版本号。
- `--version` 输出 `yakusha <package.json version>`。
- `test/version.test.js` 断言：门面 `VERSION`、`--version`、插件模板渲染结果三者一致。
- Ren'Py 的翻译文件**不参与**这条链：`installTranslation` 支持一个可选的
  `pluginVersion` 只用来装饰文件头（`# Generated by yakusha <version>.`），但 CLI 的
  `install` 从不传它，所以实际落盘的头部是第一行 `# Generated by yakusha. Do not edit by hand.`，
  不带版本号。文件内容与时间戳都不参与版本比对。
- 发布时只改 `package.json` 一处。

## 12. 契约测试

### 12.1 位置

`test/engine-contract.test.js`、`test/renpy-adapter.test.js`、`test/rgss-adapter.test.js`
与 `test/krkr-adapter.test.js`（外加 CLI 侧的 `test/rgss-cli.test.js` 与
`test/krkr-cli.test.js`），**都平铺在 `test/` 下**。

原因：`package.json` 的 `npm test` 是 `node --test "test/*.test.js"`，不收子目录；
放 `test/contract/` 会静默不执行。不要为了一个测试去赌 Node 22 的 globstar。

Ren'Py 与 RGSS 的契约用例各占一个文件，原因写在 `engine-contract.test.js` 的文件头：
它们共用 adapter 形状，但不共用 fixture 布局、插件注册表和安装语义，硬塞进同一个文件
只会让每个用例都长出一堆 `if (engine === "renpy")`。`test/engine-contract.test.js:61-64`
的注释就是这么写的（RGSS 也从这份文件里分出去）。

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
- RGSS（0.12 新增）：**`test/fixtures/` 下没有 rgss 目录**，夹具由 `test/rgss-fixture.js`
  在 `os.tmpdir()` 里现生成（`writeRgssProject` / `writePackedProject`，见 §12.3 末尾）。
- Kirikiri（0.13 新增）：**`test/fixtures/` 下没有 krkr 目录**，夹具由 `test/krkr-fixture.js`
  现生成：`buildXp3(files, { indexMagic })` 合成 XP3 字节（raw / zlib 分段、标准
  `File` 索引；换 4 字节 magic 就能伪造 `Hxv4` 索引做反向用例），`writeKrkrProject`
  组装 `data/*.xp3` 项目。生成内容全是合成的，没有真实游戏文本。
- 测试不得改 fixture 本体；每个用例复制到 `os.tmpdir()` 下的新目录
  （`engine-contract.test.js` 的 `copyGame()`、`renpy-adapter.test.js` 与
  `rgss-adapter.test.js` 的 `sandbox()`）。

### 12.3 每个 adapter 必过的用例

五引擎共用（`engine-contract.test.js` 的 `getAdapters()` 循环 + 各引擎自己的同名用例）：

- capabilities：七个键齐全、类型正确；`rules` 恒为 `{controlCodes:true, maxColumns:0}`；
  方法都是函数；`getAdapter("nope") === null`；`getAdapters()` 返回副本。
- detect：空目录 → 本引擎的 `E_NOT_PROJECT`；子目录/上级目录 → 找到同一个 root；
  幂等；不写盘。
- scan：载荷字段与 [json-contract.md](json-contract.md) §7 一致（Ren'Py、RGSS 与 Kirikiri
  是同一组 11 个键）。
- extract：生成字典；再跑一次 `added: 0`。
- attach：抛 `E_NOT_IMPLEMENTED`，且 `capabilities.attach === false`。
  `capabilities.runtime` 为 `plugin`（MZ / MV）、`translation`（Ren'Py）或
  `null`（RGSS、Kirikiri）。

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

- 在 registry 里排第三、带自己的 profile、`runtime` 为 `translation`、
  `dataUnit` 为 `scripts`、有 `diagnostics`（`test/renpy-adapter.test.js:81` 的
  `the registry ships Ren'Py third, with its own profile and runtime tier`）。
- 从 root、`game/`、以及上一级目录都能找到同一个项目；从 `game/` 找到时 `root`
  仍是项目根而不是 `game/`。
- 错误目录报 Ren'Py 那句 `E_NOT_PROJECT`；两个同级项目报 `E_MULTI_ROOT` 且候选排序。
- scan 保留那 11 个键；解码失败的脚本按“一条脚本一行”进 `undecodable`。
- install 交付一个翻译脚本；缺字典或零已译条目分别报两次 `E_NO_DICTIONARY`；
  生成的 `game/yakusha_translation.rpy` **不会**被下一次 extract 当成源脚本。
- uninstall 只删那一个文件；install + uninstall 前后游戏脚本逐字节不变。
- doctor 把交付的文件当成 install 与 runtime 两项来检查。

RGSS 专属（`test/rgss-adapter.test.js` 17 条 + `test/rgss-cli.test.js` 13 条）：

- registry 里排第四、带自己的 profile、`runtime` 为 `null`、`dataUnit` 为 `data files`、
  有 `diagnostics`（`test/rgss-adapter.test.js:66` 的 `the registry ships RGSS fourth, with its
  own profile and no runtime tier`）。同一断言在 `test/engine-contract.test.js:71-94` 与
  `test/renpy-adapter.test.js:81-85` 各有一份：`getAdapters()` 的 id 序列是五元素
  `["mz","mv","renpy","rgss","krkr"]`，`RUNTIME_TIERS` 里 `rgss: null`、`krkr: null`。
- 从 root、`Data/`、以及上一级目录都能找到同一个项目；**打包版没有 `Data/` 也能识别**
  （`detect: a packed game is found without a Data folder`）；空目录报 RGSS 那句
  `E_NOT_PROJECT`，两个同级游戏报 `E_MULTI_ROOT` 且候选只列最浅一层。
- scan 保留那 11 个键；打包版与磁盘版数字相同、只有 `encodings` 的键不同；
  一个解不开的文档只记一行，其余文档照常扫描
  （`scan: a document the reader rejects is one line, and the rest still scans`）。
- extract：第一次建字典，第二次 `added: 0`；已翻译的条目不覆盖；字典损坏时重建而不中断。
- install / uninstall：抛 `E_NOT_IMPLEMENTED`，消息是 §7.7 那两句；
  `install` 前后目录快照逐项相同（**不写任何文件**）；无字典时也先报这一句。
- attach：走共享的 `notImplemented()`，消息是 `attach is not implemented in 0.10`。
- doctor：`delivery.pending` 分支让 install 记 warn、runtime 记 info，verdict 仍是
  `usable`；`diagnostics.dataFiles` 必须等于 scan 数出来的文档数
  （`doctor: diagnostics counts the documents the scan counts`）。
- profile：`\C[n]` / `\N[n]` 这类转义码被 `grammar.controlCodes` 认出来，译文里的
  同类码也要被保留（`profile: RGSS keeps the escape codes the generator renders`）。

Kirikiri 专属（`test/krkr-adapter.test.js` 11 条 + `test/krkr-cli.test.js` 13 条）：

- registry 里排第五、带自己的 profile、`runtime` 为 `null`、`dataUnit` 为
  `data files`、有 `diagnostics`（`test/krkr-adapter.test.js:45` 的
  `the registry ships Kirikiri fifth, with its own profile and no runtime tier`）。
- detect：从 root 与 `data/` 都能找到项目（指到 `data/` 本身时 root 就是它）；
  空目录报 Kirikiri 那句 `E_NOT_PROJECT`（:76）；两个同级项目报 `E_MULTI_ROOT`
  且候选排序（:85）。
- scan：载荷保持那 11 个键（:98）；解不开的归档按“一行一条”进 `undecodable`（:116）。
- extract：写出的字典译文为空、同名文本合并 contexts（:127）；已翻译的条目不覆盖（:137）。
- install / uninstall：抛 `E_NOT_IMPLEMENTED` 指向待拍板清单（:150）；install 前后
  目录逐项相同，**不写任何文件**。
- attach：走共享的 `notImplemented()`（:171）。
- doctor：`delivery.pending` 让 install 记 warn、runtime 记 info，verdict 仍是
  `usable`；`diagnostics.dataFiles` 是成功打开的归档数（:183）。
- profile：`[r]` / `[emb exp=...]` 这类 KAG 标签被 `grammar.controlCodes` 认出来；
  `[[` 转义出字面 `[`。

CLI 侧（`test/krkr-cli.test.js`，13 条）走真实的 `bin/yakusha.js`：scan 文本模式打
`data files:` 与 `encodings : xp3 N`（engine 行没有版本后缀，game 行显示 `(untitled)`）；
extract 写出字典且 context 指回 `.ks` 行（如 `scenario/first.ks:2`）；install /
uninstall 退出码 2 且不写盘；doctor 有字典时 `usable` 并点名 pending 的交付层，无字典
`broken` 且退出码 1；verify / speaker / terms / export 在同一套 pipeline 上跑通；
非游戏目录报 RPG Maker 那句（registry 第一个 adapter 的文案，Kirikiri 自己的措辞由
adapter 测试覆盖）。

CLI 侧（`test/rgss-cli.test.js`，13 条）走真实的 `bin/yakusha.js`：scan 文本模式打
`data files:`、`rgss 3`；extract 写出字典且 context 指回 `Map001.rvdata2:101`；
install / uninstall 退出码 2 且不写盘；doctor 有字典 usable、无字典 broken 且退出码 1；
verify / speaker / terms / export 在同一套 pipeline 上跑通；非游戏目录报
RPG Maker 那句（registry 第一个 adapter 的文案）。

夹具：RGSS 没有 `test/fixtures/` 下的目录，用的是 `test/rgss-fixture.js` 在 `os.tmpdir()`
里现生成的合成游戏——`writeRgssProject(root, {version})` 造磁盘版（`Game.ini` + 7 个
`Data/` 文档），`writePackedProject(root)` 造打包版（同一批文档塞进 `Game.rgss3a`）。
三个版本共用一组文档，只换扩展名与 `Game.ini` 里的 `Library=`，所以 XP / VX / VX Ace
走的是同一条抽取路径。**这份夹具是合成的，不含任何真实游戏内容**；真实样本的实测数字
见 §13.3 末尾，两者不要混为一谈。Kirikiri 同理：`test/krkr-fixture.js` 的 `buildXp3` /
`writeKrkrProject` 现生成合成 XP3 与 `.ks`，也不含任何真实游戏内容。

### 12.4 运行环境

- 测试显式清空 `YAKUSHA_*` / `OPENAI_API_KEY`，避免开发机环境让断言飘。
- 只用 `os.tmpdir()` 下的临时目录；测试结束清理，失败也清理（`after` 钩子）。
- CI 在 `windows-latest` 上跑 Node 22 / 24；不写 POSIX-only 断言。
- RGSS 的归档与 Marshal 测试都自己造字节（`test/rgss-archive.test.js` 里有一组按版本
  循环的写回—读回用例）；Kirikiri 的 XP3 / KS 测试同理（`test/krkr-xp3.test.js` /
  `test/krkr-ks.test.js` 合成字节与文本），不依赖外部游戏，也不需要网络。

## 13. 文本抽取契约

0.17 起每条抽取结果还带 `locators`（`<文件>#<JSON Pointer>`，行式引擎为 `file:line`）；写字典时由 `src/core/dict.js` 的 `recordExtracted()` 统一落成条目的 `engine` 与 `locator` 字段。各引擎的 locator 形状见本节各小节与 [json-contract.md](json-contract.md) §7.1。

### 13.1 RPG Maker（MZ / MV）

- 数据源只来自 `data/*.json`（按文件名排序）。不读 `js/plugins/*.js`、
  不读图片、不读 `www/data`（除非它就是项目的 `data/`）。
- 明文直接 `JSON.parse`；失败时按单字节 XOR 穷举 256 个 key；0 字节 / 空白占位算
  `empty`，不算 `undecodable`。
- 字段表与指令表来自 `src/core/fields.js`（唯一真源）；adapter 不得复制一份。
- context 形如 `<文件名>:<code>` 或 `<文件名>:<字段>`，与现有 `extract.js` 一致。
- locator 形如 `Map002.json#/events/12/pages/0/list/5/parameters/0`（事件指令）或 `Actors.json#/3/name`（字段）；`pickParamsWithSlots` 对列表参数再退一格（`parameters/0/0`）。
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

### 13.3 RGSS（XP / VX / VX Ace）

与 13.1 共享的是**策略**（只增不删、context 指回原位置、`scan` 不需要字典、解码失败只
记录不中断），数据来源与字段表完全不同：

- 源是 Ruby Marshal 二进制。磁盘版读 `Data/*.rxdata` / `*.rvdata` / `*.rvdata2`；
  打包版从 `Game.rgssad` / `.rgss2a` / `.rgss3a` 归档里读 `Data/` 前缀下的同一批文档
  （`src/engines/rgss/project.js:392-429` 的 `openDataSource`）。
- Marshal 读取是纯 JS（`src/engines/rgss/marshal.js:91` 的 `unmarshal`）：只接受主版本 4，
  只记 class / module 的名字，`T_DATA` 只保留原始字节，**任何对象都不执行**。
- 文档按名字排序后再抽（`src/engines/rgss/extract.js:372`），所以磁盘版与打包版抽出的
  顺序、条数、context 逐条一致；归档目录与目录列表本来都是无序的，排序是唯一能让两边
  对上的办法。

**事件指令：只收五种码。** 表在 `src/engines/rgss/extract.js:79-85` 的 `COMMAND_TEXT`：

| 码 | 指令 | 取哪个参数 |
| --- | --- | --- |
| 101 | Show Text 的头部 | `parameters[0]`，说话人名，空串不收 |
| 102 | Show Choices | `parameters[0]` 数组的每个元素（选项标签） |
| 320 | Change Actor Name | `parameters[1]` |
| 401 | Show Text 的一行台词 | `parameters[0]` |
| 405 | Scroll Text 的续行 | `parameters[0]` |

刻意不进的码，理由分别是：

- **402**（选项分支标记）：文本与配对的 102 同源，收了只会多一条 context，不会多一条
  可翻译文本（`src/engines/rgss/extract.js:73-76` 的注释就是这么写的）。
- **108 / 408**：编辑器注释，玩家看不到。
- **355 / 655**：Ruby 脚本行，是代码不是台词。
- **231 / 322**：图片文件名，改了游戏会找不到图。
- **111 / 118 / 119 / 122 / 123 / 283 / 284**：脚本、资源与数值操作数，同上。

**数据库文档的字段表**（`src/engines/rgss/extract.js:41-52` 的 `RGSS_DB_FIELDS`）。
扩展名随版本变，所以按 **base name** 匹配：

| 文档 | 收的字段 |
| --- | --- |
| `Actors` | `name`、`description`、`nickname` |
| `Classes` | `name`、`description` |
| `Skills` | `name`、`description`、`message1`、`message2` |
| `Items` / `Weapons` / `Armors` / `Enemies` | `name`、`description` |
| `States` | `name`、`message1`–`message4` |
| `Tilesets` | `name` |
| `CommonEvents` | `name`，加上它的事件指令 |

**`System`** 只收两处纯文本与四张术语表（`src/engines/rgss/extract.js:58-61`、`:260-287`）：

- `@game_title`（游戏标题）与 `@currency_unit`（货币单位），context 分别是
  `System.rvdata2:game_title` / `System.rvdata2:currency_unit`。
- `@terms` 下的 `@basic`、`@params`、`@etypes`、`@commands` 四张表，数组的每个元素都收，
  context 形如 `System.rvdata2:terms.params`。菜单上印的“等级”“攻击”“新游戏”就是这四张表。
- 其它 `@*_name` 字段（`@title1_name`、`@battleback_name` 之类）全是资源名，一个都不收。

**`MapInfos`** 只收 `@name`（地图名），context 是 `MapInfos.rvdata2:name`。
**`Troops` 与 `Map*`** 只收事件指令，没有字段表。其它文档（`Scripts`、`Animations`
这类）根本不打开——不在 `RGSS_DB_FIELDS` 里、也不是刚才那几类的文档直接跳过。

**`@note` 一律不收。** 它是 RPG Maker 的脚本元数据通道（自定义图标标签之类），玩家读
不到，翻译它只会破坏插件的数据。这条与“资源名不收”一起写在
`src/engines/rgss/extract.js:35-37` 的注释里。

**context 格式**：`<文档名>:<401 这类指令码>` 或 `<文档名>:<字段名>`，指令码不带方括号，
例如 `Map001.rvdata2:401`、`Actors.rvdata2:name`、`System.rvdata2:terms.params`、
`MapInfos.rvdata2:name`。打包版与磁盘版用同一个文档名，所以 context 不随分发形式变。

**失败不中断。** 一个解不开的文档进 `undecodable`（`<文档名>: <error>`，单行），遍历
继续；`documents` 与 `encodings` 只在成功解码后加一（`src/engines/rgss/extract.js:421-423`），
所以 `scan` 的 `data files` 与 `doctor` 首行括号里的数是同一个数。

**`encodings` 的语义按来源变**：打包版一律记 `marshal`（所有文档都来自同一份 Marshal
字节流），磁盘版记文件扩展名（`rvdata2` / `rvdata` / `rxdata`）——
`src/engines/rgss/extract.js:422-423`。

**`engineVersion`** 是字符串 `"1"` / `"2"` / `"3"`（对应 XP / VX / VX Ace），
来路见 §6.2 的版本来源一行；一个都读不到就是 `null`，`scan` 的 `engine    : rgss`
后面就不带版本号。

**实测规模（外部样本，非仓库可复现）。** 一款 RGSS3（VX Ace）商业游戏，日文原版加中文
补丁：`Game.rgss3a` 644,284,359 字节，归档里 5,138 个条目，其中 `Data/` 399 个
（398 个 `.rvdata2` 加 1 个非数据的 zip 包）、`Graphics/` 4,739 个。381 张地图，364 张
带事件，共 5,300 个事件。抽取结果：394 个文档、31,730 条唯一串 / 49,732 条出现次数、
0 条 `undecodable`、282 个文件有文本，耗时约 380 ms。

这套样本里含反斜杠转义码的条目 2,063 条，共 23 种码：`\i[n]` 2,252、`\c[n]` 557、
`\v[n]` 517、`\!` 313、`\>` 272、`\A[n]` 204、`\W[n]` 179、`\n[n]` 89、`\V[n]` 76、
`\T[n]` 73、`\t[n]` 72、`\C[n]` 51、`\a[n]` 46、`\N[n]` 43、`\s[n]` 33、`\w[n]` 30、
`\S[n]` 10、`\{` 7、`\I[n]` 6、`\}` 5、`\.` 4、`\F[n]` 2、`\^` 1。它们全部落在
`src/core/textkey.js` 的通用 tokenizer 覆盖范围内，所以 RGSS 不需要自己的一套控制码
解析器，只在自己的 profile 里声明用的是这一套（`src/engines/rgss/profile.js:22`）。

版本判定的旁证（离线核过，不是工具行为）：该游戏的 `Data/Scripts.rvdata2` 里有 234 个
脚本条目，`codeobj` 是 deflate 压缩的 Ruby 源码（解压后是 `# ■ Main` 这类 RGSS 脚本）。
本版**既不抽也不读** `Scripts`：它不在 `RGSS_DB_FIELDS` 里，也不是 `System` /
`MapInfos` / `Map*` / `Troops`，所以 `src/engines/rgss/extract.js:413` 的 `continue`
直接跳过，连 `readDocument` 都不会调。这份样本不是仓库里的夹具，也不构成对商业 RGSS
游戏的验收。

### 13.4 Kirikiri（KAG）

与前三节共享的是**策略**（只增不删、context 指回原位置、`scan` 不需要字典、
解码失败的来源只记录不中断），不同之处如下。

**XP3 容器。** `data/` 直接下层（或根目录本身，见 §6.3）的每个 `.xp3` 都是归档：

- 头部 40 字节，magic 是 8 字节 `XP3\r\n \n\x1a`（`src/engines/krkr/xp3.js:29`）；
  头里还带一个版本标记与索引区的 64 位偏移，读取器只校验 magic，其余按偏移走。
- 索引容器头是 `{u8 模式, u64 压缩长度}`，模式 0 原样、1 zlib；真实归档在压缩长度后面还有一个 8 字节未压缩长度字段（头共 17 字节），合成夹具则没有——读取器按 zlib 头特征自动判位。解开后前 4 字节
  必须是 `File`（标准索引）。改过的索引（`Hxv4`，部分汉化发行版在用）**报
  `E_UNSUPPORTED`，绝不猜**：
  `<archive>: the XP3 index uses an unsupported format ("Hxv4") - yakusha only reads standard XP3 indexes`
  （`src/engines/krkr/xp3.js:77-80`）。
- 文件条目由 `info`（原始名，UTF-16LE）、`segm`（每段 28 字节：模式 / 绝对起点 /
  原始长 / 压缩长，多段文件存在）与 `adlr`（重组后字节的 adler32）三个子块组成；
  读取器逐条重组并校验 adler32 与长度。开发期读过的样本归档，**所有条目都校验通过**。
  条目上限 100,000（`src/engines/krkr/xp3.js:32`），防的是构造出来的恶意归档。

**KS 脚本。** 归档里扩展名为 `.ks` 的条目按行处理（`src/engines/krkr/ks.js`）：

- 编码先按 BOM 识别 UTF-16LE / UTF-16BE（本地化组常见），否则先按 UTF-8 严格解码、失败退回 Shift_JIS；Shift_JIS 下出现替换字符就把整份脚本
  记一行 `undecodable`（`N undecodable byte(s) under Shift_JIS`），**已解出的行仍然收**。
- 行分五类：空行、注释（`;` 开头）、标签（`*` 开头）、纯标签行、文本行；只有文本行进字典。
- 行内标签（`[r]`、`[er]`、`[emb exp=...]`……）从存下的字符串里剥掉；`[[` 转义出
  字面 `[`（`src/engines/krkr/ks.js:65-88`，`[[` 的加倍规则在
  `src/engines/krkr/profile.js:29`）。
- `[name_set name=...]` 逐行跟踪说话人（`src/engines/krkr/ks.js:94-100`，测试
  `test/krkr-ks.test.js:34-42`）；**0.13 的字典不存说话人**，speaker / terms 命令照旧
  靠共享 pipeline 在字典键上工作。
- 上下文是 `<归档内条目名>:<行号>`，例如 `scenario/first.ks:2`；行号从 1 起。

**`.tjs` 只计数不解析。** TJS 是编程语言，不懂代码就翻它的字符串不安全；`scan` 里
它们只体现在计数上（`src/engines/krkr/extract.js:98-101` 的注释）。其余扩展名静默计入
`encodings` 的总数，不逐个列出。

**失败不中断。** 一个打不开的归档进 `undecodable`（`<归档名>: <error>`，单行），
遍历继续；`documents` 与 `encodings.xp3` 只在归档成功打开后加一
（`src/engines/krkr/extract.js:96`），所以 `scan` 的 `data files` 与 `doctor`
首行括号里的数是同一个数。`encodings` 一律记 `xp3`。

**`engineVersion` / `gameTitle` 恒为 `null`**：标题与版本住在加密或可选的配置文件里，
0.13 不解析（`src/engines/krkr/project.js:117-145` 的注释）；`scan` 因此显示
`(untitled)`，engine 行不带版本后缀。

**同名文本合并。** 不同位置出现同一字符串时，字典里只有一条，`count` 累加、
contexts 合并（`src/engines/krkr/extract.js:74`）。

**实测规模（外部样本，非仓库可复现）。** 开发期读过两款真实 Kirikiri 游戏的归档
（含一份语音归档），所有条目的 adler32 与长度都校验通过；具体数字不写进文档——
它们随游戏而变，也不构成对商业 Kirikiri 游戏的验收。

## 14. 引擎覆盖与未来引擎

已经接入的：

| 引擎 | 文本形态 | 运行时档 | 状态 |
| --- | --- | --- | --- |
| RPG Maker MZ | `data/*.json` | `plugin`（L4-plugin） | 0.10 已实现 |
| RPG Maker MV | `data/*.json` | `plugin`（L4-plugin） | 0.10 已实现 |
| Ren'Py | `.rpy` 明文 / `.rpyc` 编译 | `translation`（L4-resource） | 0.11 实现：L2–L4 |
| RGSS (XP/VX/VX Ace) | Ruby Marshal：`Data/*.rxdata` / `.rvdata` / `.rvdata2`，或 `RGSSAD` 家族归档 | **无**（`runtime: null`） | 0.12 已接 L1–L3：detect / scan / extract，交付层未做 |
| Kirikiri | XP3 归档里的 `.ks` 脚本（KAG 标签） | **无**（`runtime: null`） | 0.13 已接 L1–L3：detect / scan / extract，交付层未做 |

RGSS 的 L1–L3 是这么算的：L1 是识别（`Game.ini` / 归档 / `Data/`，版本 `"1"`–`"3"` 判得出来），
L2 是真实游戏提取（§13.3 末尾那款商业样本 394 个文档、31,730 条唯一串、0 条解码失败），
L3 是翻译与校验（`translate` / `verify` / `speaker` / `terms` / `export` 都跑同一套
pipeline，profile 里带反斜杠转义码的 grammar 与判据）。**L4 没有**：没有交付层，所以
`install` / `uninstall` 抛 `E_NOT_IMPLEMENTED`（§7.7）。不要把它写成“RGSS 已支持运行时
翻译”——本版明确没有。

Kirikiri 的 L1–L3 同理：L1 是识别（`data/` 或根下的 `.xp3`，BFS 最多 3 层），
L2 是真实归档提取（§13.4 末尾：开发期样本全部条目校验通过），L3 是翻译与校验
（`translate` / `verify` / `speaker` / `terms` / `export` 跑同一套 pipeline，profile
带 KAG 方括号标签的 grammar 与判据）。**L4 同样没有**（§7.8）。

还没做的（只记边界，不排期）：

| 引擎 | 文本形态 | 可能的运行时 | 状态 |
| --- | --- | --- | --- |
| Unity | 资源包 / Mono / IL2CPP | `inject` 或运行时补丁 | 不做 |
| Wolf | 自有归档 | `inject` | 不做 |

RGSS 的运行时档**不是** `inject`，这里不再给它排一个猜测的档位：两条候选路线（纯 JS
写回数据文档、原生注入器 + hook DLL）都还没拍板，见 §7.7。写“RGSS 将来做 inject”
就是把没决定的事写成计划。

L4-plugin / L4-resource 是 [dev/ENGINE-STRATEGY.md](dev/ENGINE-STRATEGY.md) §5.5
的四档交付术语：plugin 是“加插件、删文件即还原”，resource 是“生成引擎自带的资源、
删文件即还原”。Ren'Py 做到了 L2（真实游戏提取）、L3（翻译与校验）、L4（运行时交付），
**L5（卸载验证）由契约测试里的“install + uninstall 前后脚本逐字节不变”覆盖**。
不要说“完全支持 Ren'Py”：三档里每一档的实际含义都以战略稿的定义为准。

新引擎必须自带：adapter、capabilities、fixture、契约测试、启动规则（如果有 exe）、
自己的 profile。不允许把引擎特判写进 `src/pipeline`；引擎专属校验规则挂在 adapter 上——
0.10.x 起是一份 `profile` 数据（`src/engines/profile.js`、
`src/engines/renpy/profile.js`、`src/engines/rgss/profile.js` 与
`src/engines/krkr/profile.js`，含 prompt / grammar / validate / verify），
`rules` 三键保持不变。

RGSS 接入时这三样都按这个模式落：adapter（`src/engines/rgss/adapter.js`）、fixture
（`test/rgss-fixture.js` 在 `os.tmpdir()` 里合成，不在 `test/fixtures/` 下）、契约测试
（`test/rgss-adapter.test.js` + `test/rgss-cli.test.js`）；`src/pipeline` 一行没改。
Kirikiri 照抄了这个模式：`src/engines/krkr/` 五个模块、`test/krkr-fixture.js`、
`test/krkr-adapter.test.js` + `test/krkr-cli.test.js`，`src/pipeline` 同样一行没改。

## 15. 验收清单

- [x] `detectProject` 对错误目录/多根返回判别式，不抛、不写盘。
- [x] registry 按 `mz → mv → renpy → rgss → krkr` 顺序；同目录双 core 取 MZ。
- [x] MZ / MV 两个 fixture 都过同一套契约测试；MV 的 CDP 能力为 false。
- [x] 五个 adapter 的 capabilities 七键齐全，`runtime` 分档为 `plugin` / `plugin` /
  `translation` / `null` / `null`，`rules` 三键不变（`test/engine-contract.test.js` 逐个断言）。
- [x] 安装幂等、卸载逐字节还原、漂移时不还原；路径逃逸被拒。
- [x] launch 发现规则全测；spawn 参数与 env 用假实现断言；非 Windows 报平台错误。
- [x] `attach` 桩返回 `E_NOT_IMPLEMENTED`，能力为 false；五个引擎共用同一个桩。
- [x] `import "yakusha"` 自引用可用；旧深路径仍可用。
- [x] 版本三处一致；`--version` 有测试。
- [x] Ren'Py：`.rpy` 与 `.rpyc` 都能抽，同 stem 只读 `.rpy`，`tl/` 与自己生成的
  翻译文件被跳过，解码失败只记一行不中断。
- [x] Ren'Py：`install` 只生成 `game/yakusha_translation.rpy`，`uninstall` 只删它；
  前后游戏脚本逐字节不变；零已译条目报 `E_NO_DICTIONARY` 而不是写空文件。
- [x] Ren'Py：doctor 把翻译文件当 install 与 runtime 两项检查，首行按 `scripts` 计数。
- [x] RGSS：`Game.ini` / 归档 / `Data/` 三种依据都能识别，版本 `"1"`–`"3"` 判得出来；
  打包版没有 `Data/` 也认；空目录报 RGSS 那句，同级两款游戏报 `E_MULTI_ROOT`。
- [x] RGSS：磁盘版与打包版抽出同一批串、同一批 context；`@note` 与资源名不收；
  一个文档解不开只记一行，其余照常抽（`test/rgss-extract.test.js`）。
- [x] RGSS：`install` / `uninstall` 抛 `E_NOT_IMPLEMENTED` 且不写任何文件（安装前后
  目录快照逐项相同）；`doctor` 的 install 是 warn、runtime 是 info，verdict 仍 `usable`。
- [x] RGSS：`runtime` 为 `null` 在契约测试里被断言——这一格不允许靠猜填一个档位。
- [x] Kirikiri：`data/`（或根目录本身）下的 `.xp3` 都能识别，空目录报 Kirikiri 那句，
  同级两款游戏报 `E_MULTI_ROOT`；`.tjs` 只计数不解析；`Hxv4` 索引报
  `E_UNSUPPORTED` 不猜（`test/krkr-project.test.js` / `test/krkr-xp3.test.js`）。
- [x] Kirikiri：`.ks` 按 UTF-8 严格解码、Shift_JIS 兜底；文本行收进字典、行内标签剥掉、
  `[name_set]` 逐行跟踪说话人但不进字典（`test/krkr-ks.test.js` / `test/krkr-extract.test.js`）。
- [x] Kirikiri：`install` / `uninstall` 抛 `E_NOT_IMPLEMENTED` 且不写任何文件；
  `doctor` 的 install 是 warn、runtime 是 info，verdict 仍 `usable`。
- [x] Kirikiri：`runtime` 为 `null` 在契约测试里被断言，排第五由 adapter 测试钉住。
- [ ] `npm test` 在 `windows-latest` Node 22/24 全绿（推送后由 CI 验证）。
