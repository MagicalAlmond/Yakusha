# 引擎适配器契约（0.10 设计稿）

> **状态：0.10 设计，尚未实现。** 现有 `src/core/mzproject.js` / `extract.js` /
> `install.js` 已经能处理 MZ 与 MV；0.10 只是把它们包进统一的 adapter，
> **不搬文件、不重写算法**。本文冻结 adapter 的形状、能力矩阵、安装/启动契约
> 与契约测试的落点。

## 1. 目标与非目标

目标：

- CLI 与未来的 GUI 只依赖 `detect()` + adapter 方法，不再在 `bin/yakusha.js` 里
  写 `if (engine === "mz")`。
- 新引擎的接入点固定：一个 `src/engines/<id>/adapter.js` + 一份 fixture + 契约测试。
- 把“引擎能不能做某事”变成数据（`capabilities`），让 GUI 在点击前就能置灰。

非目标：

- 0.10 不实现 Ren'Py / Unity / Wolf / Kirikiri / RGSS；不实现原生注入（`inject`）。
- 0.10 不搬 `src/core` 的文件。adapter 是薄包装，`core` 仍可被库用户直接使用。
- 0.10 不实现 `attach`（CDP 调试注入），只登记能力与接口。

## 2. 目录与注册表

```
src/engines/
  adapter.js        契约常量、能力默认值、detect 结果形状的辅助函数（无引擎逻辑）
  registry.js       按顺序探测；把 engine id 映射到 adapter
  mz/adapter.js     包装 mzproject / extract / install / plugin 模板
  mv/adapter.js     同上，差异只在 detect 的 core 文件与 runtime 能力
src/index.js        公共门面（见 §10）
```

`registry.js` 导出：

- `getAdapters()`：按 `mz → mv` 顺序返回 adapter 数组。
- `detectProject(startDir)`：返回与 `adapter.detect` 相同的判别式结果，外加 `adapter`。
- `getAdapter(engine)`：按 id 取；未知 id 返回 `null`（不抛）。

探测顺序固定：**MZ 优先**。一个目录同时有 `js/rmmz_core.js` 与 `js/rpg_core.js` 时
按 MZ 处理（与现有 `openProject` 的 `fs.existsSync(MZ_CORE) ? "mz" : "mv"` 一致）。
`detectProject` 遇到 `E_MULTI_ROOT` 立即返回，不再尝试下一个 adapter。

## 3. Adapter 形状

```js
export default {
  id: "mz",
  name: "RPG Maker MZ",

  capabilities: {
    extract: true,        // 能抽文本
    export: true,         // 能导出（0.10 只有 JSON）
    runtime: "plugin",    // 已实现的运行时投递方式：plugin | debug | inject
    launch: true,         // 能发现并启动游戏 exe
    debuggable: true,     // 引擎本身支持 CDP 调试（不等于工具已实现 attach）
    attach: false,        // 工具是否实现 attach；0.10 全为 false
    liveReload: false,    // 改字典后是否自动生效；0.10 只能手动 reload
  },

  // 只读探测：不抛预期错误、不写盘、不联网。
  // 成功 {ok:true, project}；失败 {ok:false, code, message, candidates?}
  detect(startDir) { ... },

  scan(project) { ... },                 // 文本量统计（CLI scan 的载荷）
  extract(project) { ... },              // 写字典（CLI extract 的载荷）
  installRuntime(project, options) { ... },
  uninstallRuntime(project) { ... },
  launch(project, options) { ... },      // {pid, exe, root}
  attach(project, options) { ... },      // 0.10 只返回/抛出 E_NOT_IMPLEMENTED

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
2. **不写盘、不联网、不改全局状态。** 只读 core 文件、`data/`、`js/plugins.js`。
3. **幂等。** 同一目录连续调用两次，结果一致（除了文件系统在这期间被改）。
4. **有界搜索。** 从 `startDir` 开始，向上找自身，向下最多 `MAX_SEARCH_DEPTH = 3` 层，
   跳过隐藏目录与 `SKIP_DIRS`；与现有 `findProjectRoot` 完全一致。
5. **顺序稳定。** 多根时 `candidates` 按深度、再按 `localeCompare` 排序，与现有实现一致。

### 4.2 错误文案

0.10 沿用现有文案，避免 CLI 测试与用户习惯同时断掉：

- `E_NOT_PROJECT`：
  `not an RPG Maker project (no js/rmmz_core.js or js/rpg_core.js found in <dir> or up to 3 levels below it)`
- `E_MULTI_ROOT`：
  `found N RPG Maker projects under <dir>, pass one of them instead: <roots>`
- 找到根但缺目录：
  - `missing data/ directory in <root>`
  - `missing js/plugins.js in <root>`

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

| 能力 | MZ | MV | 含义 |
| --- | --- | --- | --- |
| `extract` | true | true | `data/*.json` 文本抽取；明文或单字节 XOR |
| `export` | true | true | 0.10 只有 JSON 导出 |
| `runtime` | `plugin` | `plugin` | 装 JS 插件；MZ 包 `onXhrLoad`，MV 包 `loadDataFile` + `onLoad` |
| `launch` | true | true | 项目根唯一 `.exe` |
| `debuggable` | true | **false** | MZ 可被 `--remote-debugging-port` + CDP 驱动；MV 的旧 nw.js 不吃这个参数 |
| `attach` | false | false | 0.10 没有实现 |
| `liveReload` | false | false | 插件有 `window.__YAKUSHA.reload()`，但没有文件监听 |

三个概念必须分开，否则 GUI 会显示一个点了就报错的按钮：

- `runtime`：**已经实现**的投递方式。0.10 只有 `plugin`。
- `debuggable`：**引擎本身**是否支持 CDP。MZ 为 true，是实测结论；不代表工具能用。
- `attach`：**工具是否实现** attach。0.10 为 false；GUI 只有它为 true 才显示“调试注入”。

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

## 7. 安装 / 卸载契约

### 7.1 写哪些文件

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
  但 0.10 只读 JSON/JS 文本，不执行它们。

## 8. 启动契约（`launch`）

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

- **无参数**：0.10 不传 `--` 之后的参数，也不支持“启动器参数”。需要参数的玩家
  自己启动游戏，工具只负责装插件。
- **`shell:false`**：exe 路径即使含空格也不经过 cmd.exe；避免命令注入。
- **`detached:true` + `stdio:"ignore"` + `unref()`**：CLI 退出后游戏继续跑；
  不接管 stdout/stderr，不等待退出，不 kill。
- **cwd = 项目根**：RPG Maker 游戏按相对路径找 `www/` / `data/`。
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

## 9. attach 契约（0.10 只有桩）

```js
attach(project, options) {
  const err = new Error("attach is not implemented in 0.10");
  err.code = "E_NOT_IMPLEMENTED";
  throw err;
}
```

- 0.10 **没有** `yakusha attach` 命令；GUI 也不会显示入口（`capabilities.attach:false`）。
- 未来实现时，返回值固定为 `{status, detach(), on("exit", cb)}`；
  失败必须能回退到“不带注入启动”，不能把游戏弄成打不开。
- MZ 的 `debuggable:true` 是为未来留的证据，不是“现在能用”的承诺：
  实测要点是 `--remote-debugging-port` 能监听、`Runtime.evaluate` 能读写；
  `Page.captureScreenshot` 不稳定；窗口在后台时渲染循环会停，必须先前台化。
  这些写进未来的 attach 设计，不写进 0.10 的用户文档。

## 10. 公共门面与打包

新增 `src/index.js`，至少导出：

```js
export { openProject, findProjectRoot, findProjectRoots } from "./core/mzproject.js";
export { detectProject, getAdapter, getAdapters } from "./engines/registry.js";
export { extractProject } from "./core/extract.js";
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
- `bin` 仍是 `./bin/yakusha.js`；0.10 的 bin 只做解析/分派/输出，不再塞业务逻辑。

## 11. 版本单一真源

现状有三处版本：`package.json`、插件里的 `VERSION`、测试断言。0.10 起：

- `package.json` 是唯一真源。
- 插件的 `VERSION` 由 `installPlugin` 在渲染模板时替换成 `package.json` 的值；
  模板里的常量只是占位，测试不得断言具体版本号。
- `--version` 输出 `yakusha <package.json version>`。
- `test/version.test.js` 断言：门面 `VERSION`、`--version`、插件模板渲染结果三者一致。
- 发布时只改 `package.json` 一处。

## 12. 契约测试

### 12.1 位置

`test/engine-contract.test.js`，**平铺在 `test/` 下**。

原因：`package.json` 的 `npm test` 是 `node --test "test/*.test.js"`，不收子目录；
放 `test/contract/` 会静默不执行。不要为了一个测试去赌 Node 22 的 globstar。

### 12.2 fixtures

- `test/fixtures/mini-mz`：已有，保持。
- `test/fixtures/mini-mv`：新增。最小形状：
  `js/rpg_core.js`（含 `v1.6.2` 注释）、`js/plugins.js`（`var $plugins = [];`）、
  `data/System.json`（含 `gameTitle`）、`data/Map001.json`（一条 401 文本）、
  `index.html`。不需要 exe，也不需要可运行。
- 测试不得改 fixture 本体；每个用例复制到临时目录（现有 `tempGame()` 的做法）。

### 12.3 每个 adapter 必过的用例

- detect：空目录 → `E_NOT_PROJECT`；同层两个项目 → `E_MULTI_ROOT` + 候选；
  子目录/上级目录 → 找到同一个 root；幂等；不写盘。
- scan：`uniqueStrings > 0`，字段与 [json-contract.md](json-contract.md) 一致。
- extract：生成字典；再跑一次 `added: 0`。
- install：装完 `isInstalled()` 为真；`$plugins` 只有一条；两次安装不重复；
  `plugins.js` 的 CRLF 夹具仍保持 CRLF。
- uninstall：干净安装后逐字节还原；装后改过别的条目 → `drifted:true`、备份保留。
- launch：发现规则用纯函数测（0 个 / 1 个 / 多个 / `--exe` 非法 / 项目外路径）；
  spawn 用注入的假实现断言参数与 env，**不真的启动游戏**。
- attach：返回/抛出 `E_NOT_IMPLEMENTED`，且 `capabilities.attach === false`。
- capabilities：字段齐全、类型正确；MZ `debuggable:true`、MV `debuggable:false`。

### 12.4 运行环境

- 测试显式清空 `YAKUSHA_*` / `OPENAI_API_KEY`，避免开发机环境让断言飘。
- 只用 `os.tmpdir()` 下的临时目录；测试结束清理，失败也清理（`after` 钩子）。
- CI 在 `windows-latest` 上跑 Node 22 / 24；不写 POSIX-only 断言。

## 13. 文本抽取契约（adapter 共同部分）

- 数据源只来自 `data/*.json`（按文件名排序）。不读 `js/plugins/*.js`、
  不读图片、不读 `www/data`（除非它就是项目的 `data/`）。
- 明文直接 `JSON.parse`；失败时按单字节 XOR 穷举 256 个 key；0 字节 / 空白占位算
  `empty`，不算 `undecodable`。
- 字段表与指令表来自 `src/core/fields.js`（唯一真源）；adapter 不得复制一份。
- context 形如 `<文件名>:<code>` 或 `<文件名>:<字段>`，与现有 `extract.js` 一致。
- `engineVersion` 来自 core 文件的 `vX.Y.Z`；读不到就是 `null`，不猜。
- `scan` 不需要字典；`extract` 会写 `yakusha/dictionary.json`，已存在时只增不删。

## 14. 未来引擎（只记边界，不排期）

| 引擎 | 文本形态 | 可能的运行时 | 0.10 |
| --- | --- | --- | --- |
| Ren'Py | `.rpy` 明文 / `.rpyc` | 文件替换或 `debug` | 不做 |
| Unity | 资源包 / Mono / IL2CPP | `inject` 或运行时补丁 | 不做 |
| Wolf / Kirikiri | 自有归档 | `inject` | 不做 |
| RGSS (XP/VX/VX Ace) | `.rxdata` 二进制 | `inject` | 不做 |

新引擎必须自带：adapter、capabilities、fixture、契约测试、启动规则（如果有 exe）。
不允许把引擎特判写进 `src/pipeline`；引擎专属校验规则挂在 adapter 的 `rules` 上。

## 15. 验收清单

- [ ] `detectProject` 对错误目录/多根返回判别式，不抛、不写盘。
- [ ] registry 按 `mz → mv` 顺序；同目录双 core 取 MZ。
- [ ] MZ / MV 两个 fixture 都过同一套契约测试；MV 的 CDP 能力为 false。
- [ ] 安装幂等、卸载逐字节还原、漂移时不还原；路径逃逸被拒。
- [ ] launch 发现规则全测；spawn 参数与 env 用假实现断言；非 Windows 报平台错误。
- [ ] `attach` 桩返回 `E_NOT_IMPLEMENTED`，能力为 false。
- [ ] `import "yakusha"` 自引用可用；旧深路径仍可用。
- [ ] 版本三处一致；`--version` 有测试。
- [ ] `npm test` 在 `windows-latest` Node 22/24 全绿。
