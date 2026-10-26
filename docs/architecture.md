# 架构说明：CLI 内核 + Electron 外壳 + 多引擎适配器

> 这份文档回答"以后要支持多引擎汉化工具那样的多引擎（包括进程注入）时，现在的架构怎么不返工"。
> 项目名 **Yakusha**，文中也称"本项目"。

## 1. 三条约束先摆出来

1. **core 零第三方依赖**：`bin/yakusha.js` 和 `src/` 只用 Node 标准库，Node >= 22 直接能跑。
   Electron 只进 devDependencies，打包成 exe 时是外壳，不是 core 的依赖。
2. **交付按引擎分档，每档写清卸载后的状态**：MZ/MV 走插件（插件档：删掉插件与 `plugins.js` 那一行即还原）；
   Ren'Py 走翻译脚本（translation 档：删掉 `game/yakusha_translation.rpy` 即还原）；
   将来 RGSS / KRKR 走无原生注入（文件不改，退出即恢复）。没有"全局可逆"这个产品承诺，
   只有每一档对玩家可验证的实际影响，见 [dev/ENGINE-STRATEGY.md](dev/ENGINE-STRATEGY.md) §5.5。
3. **模型不可信**：译文先过校验再写字典；任何新引擎的接入都不能绕过这条流水线。

GUI 的定位是**壳**：玩家拖游戏进来、点按钮、看进度；汉化者仍然可以用 CLI 和脚本。
两者调同一份 core，不互相复制逻辑。

## 2. 分层

```
┌──────────────────────────────────────────────┐
│ gui/  (Electron)                             │  窗口、拖拽、设置、进度、对比编辑
│   main.js ── preload.js ── renderer/         │  main 直接 import core，不走子进程
└───────────────────┬──────────────────────────┘
                    │ 进程内调用 + IPC 事件（进度/日志）
┌───────────────────▼──────────────────────────┐
│ src/pipeline/  (引擎无关)                     │  provider、translate、wrap、verify、
│   dictionary / glossary / report / config     │  terms、speaker、report
└───────────────────┬──────────────────────────┘
                    │ EngineAdapter 契约（见 §3）
┌───────────────────▼──────────────────────────┐
│ src/engines/                                 │  mz、mv、renpy；未来 unity/wolf/krkr…
│   detect / scan / extract / install / launch │  每种引擎一个目录 + 一个 adapter
└───────────────────┬──────────────────────────┘
                    │ 仅 capabilities.runtime = "inject" 时需要
┌───────────────────▼──────────────────────────┐
│ native/  (未来)                               │  injector.exe、各引擎 hook DLL、清单
└──────────────────────────────────────────────┘
```

关键点：**"注入"是运行时模式之一，不是架构的前提。** MZ/MV 与 Ren'Py 都不需要原生代码；
未来接入 RGSS / Unity / Wolf / KRKR 时才启用 `inject`，而 pipeline、字典、GUI 全部不动。

## 3. EngineAdapter 契约

每个引擎导出同一个形状（`src/engines/adapter.js` 只放类型注释与辅助函数，
具体实现放 `src/engines/<id>/adapter.js`）：

```js
export default {
  id: "mz",
  name: "RPG Maker MZ",

  // 只读探测，返回判别式：成功 {ok:true, project}，
  // 失败 {ok:false, code, message, candidates?}。
  // 预期失败不抛异常、不写盘、不联网；完整契约见 engines.md §4。
  detect(dir) { ... },

  // 声明能力，GUI 用它决定按钮可不可点，而不是点了才报错。
  capabilities: {
    extract: true,
    export: true,
    runtime: "plugin",      // plugin（MZ/MV）| translation（Ren'Py）| debug | inject
    launch: true,
    debuggable: false,      // 引擎本身是否支持 CDP（MZ true，MV false）
    attach: false,          // 工具是否实现 attach；到 0.11 全为 false
    liveReload: false,      // 运行中改字典能否立即生效；契约位存在，实现前恒为 false
  },

  scan(project) { ... },               // 文本量统计
  extract(project) { ... },            // 生成字典条目（带 context）

  installRuntime(project, opts) { ... },   // 装插件 / 写翻译脚本 / 写钩子配置 / 准备注入
  uninstallRuntime(project) { ... },       // 卸载后必须回到原版可运行状态（四档见战略稿 §5.5）

  launch(project, opts) { ... },           // spawn 游戏进程，返回 {pid, exe}
  attach(project) { ... },                 // 仅 debug / inject 模式：返回会话

  // 引擎专属的译文校验规则（MZ 的 \{ \} \V[n]、Ren'Py 的 {b} 与 [var] 都挂在这里）
  rules: { controlCodes: true, maxColumns: 0 },
}
```

契约测试平铺在 `test/engine-contract.test.js`（`npm test` 只收 `test/*.test.js`，
放子目录会静默不执行）：每个 adapter 都要过同一套用例——错误目录返回判别式而不抛、
detect 幂等、install 后状态可读回、uninstall 后回到安装前（RPG Maker 逐字节还原，Ren'Py 删掉
自己写的那一个文件）、launch 只 spawn 不接管、attach 到 0.11 仍明确报 not-implemented。
用例清单见 [engines.md](engines.md) §12，Ren'Py 自己的契约用例在 `test/renpy-adapter.test.js`。

## 4. 四种运行时模式

| 模式 | 适用 | 机制 | 卸载后 | 现状 |
| --- | --- | --- | --- | --- |
| `plugin` | MZ / MV | 装一个 JS 插件，包装 `DataManager.onXhrLoad`（MZ）或 `onLoad`（MV） | 逐字节还原 | **已实现**，4 款游戏验收 |
| `translation` | Ren'Py | 在 `game/` 下写一个 `yakusha_translation.rpy`，里面是 `translate <lang> strings:` 块 | 删掉这一个文件即恢复 | **已实现**（0.11），Ren'Py SDK 自带的两个示例游戏跑通五步（见 [games.md](games.md)） |
| `debug` | NW.js / Electron / Chromium 系（含某些多引擎工具自带的运行时、部分 Unity WebGL 壳） | 启动参数 `--remote-debugging-port`，用 CDP `Runtime.evaluate` 注入钩子 | 结束即恢复 | **机制已实机验证**：MZ 加参数后可读 `SceneManager`、可改写 `startMessage`；但 `attach` 命令到 0.11 仍未实现（能力表 `attach:false`），MV 旧版不吃该参数 |
| `inject` | RGSS / Unity / Godot / Wolf / KRKR 等 | 原生注入器 + 引擎钩子 DLL，喂译文 | 需 detach/退出后恢复 | 未实现，仅预留契约 |

注意 `debug` 这一档很值钱：它证明"注入类目标"里有一整类可以**不写一行 C** 就拿下来。
未来排引擎优先级时，先做能用 `translation` / `debug` 吃掉的，再动 `inject`。

`translation` 档是 0.11 加的：Ren'Py 自己就有 `translate <lang> strings:` 这个机制，
所以不必写注入器，也不必改游戏脚本——生成一个只含 `old` / `new` 对的文件放在 `game/` 下，
引擎启动时自己就会读它。它比 `plugin` 档更"干净"（只有加法、没有修改），但也更弱：
只能做**整串替换**，一句台词里改一半做不到。

## 5. 文本通道：各档投递吃同一份数据

运行时消费的统一载荷，就是 `yakusha/dictionary.json` 的形状：

```json
{
  "format": "yakusha/1",
  "game": "游戏标题",
  "updatedAt": "2026-10-25T00:00:00.000Z",
  "entries": {
    "原文": { "text": "译文", "contexts": ["Map001.json:401"] }
  }
}
```

手写的字典可以用扁平形式 `"原文": "译文"`（工具会当成没有 `contexts`），但工具写出的永远是上一种。

三种投递方式，按引擎能力选：

| 通道 | 谁用 | 特点 |
| --- | --- | --- |
| 静态文件 | MZ/MV 插件、Ren'Py 翻译脚本 | 现在就是这样；`install --embed` 可把译文嵌进 MZ/MV 插件 |
| 本地 HTTP | 注入钩子 / 调试会话 | GUI 改一条、游戏里立刻变；支持热重载 |
| 共享内存 / IPC | 原生 hook | 最低延迟，实现最重 |

**载荷形状就是字典文件本身**（`format` + `entries`）：`rules`（转义码、行宽、说话人判定）由插件/引擎适配器持有，**不进 payload**。以后加投递通道不用改游戏侧钩子。

## 6. GUI 与 core 的边界

- `gui/main.js` 直接 `import` core 模块（同一进程），不 `spawn` CLI。
  CLI 和 GUI 都只是 core 的调用方，这满足"CLI 为主、GUI 隐藏控制台"。
- 渲染进程不开 `nodeIntegration`；`contextIsolation: true`，preload 只暴露白名单方法。
- 长任务（翻译）在主进程跑，进度通过 `webContents.send` 推给渲染进程；
  需要强隔离时再挪到 `worker_threads`，接口不变。
- 拖拽取真实路径用 Electron 的 `webUtils.getPathForFile`（浏览器拿不到绝对路径，
  这也是选 Electron 而不是本地网页版的根本原因）。
- 不加载任何远程内容；游戏目录一律当不可信输入校验。

## 7. 目标目录结构

```
bin/yakusha.js            CLI 薄壳（core 零第三方依赖；GUI 阶段才引入 Electron）
src/core/                引擎无关：dict、datafile、textkey、pluginsfile、config…
src/engines/
  adapter.js             契约与辅助（detect 结果形状、capability 常量）
  registry.js            按顺序探测：mz → mv → renpy（顺序是公开契约，见 registry.js）
  mz/adapter.js          mzproject、extract、install、plugin 模板
  mv/adapter.js
  renpy/                 project（game/ 发现）、extract、rpyscript/rpyc 解析、runtime、profile
src/pipeline/            provider、translate、verify、wrap、terms、speaker、report
gui/
  main.js preload.js renderer/
native/                  未来：injector 与 hook，打包时进 extraResources
test/engine-contract.test.js  适配器契约测试（平铺，npm test 只收 test/*.test.js）
test/fixtures/           各引擎最小夹具（mini-mz、mini-mv、renpy-*）
```

## 8. 为未来注入预留的五个点

1. **能力矩阵驱动 UI**：GUI 的按钮由 `adapter.capabilities` 决定，
   没实现的能力显示为灰色 + 原因，而不是点击后抛异常。
2. **native helper 清单**：`native/<os>-<arch>/<engine>/manifest.json` 记录版本、
   sha256、支持的引擎版本区间；文件缺失时 GUI 显示"此引擎需要原生组件，未随包提供"。
3. **会话生命周期**：`attach()` 返回 `{status, detach(), on('exit')}`；
   注入失败必须能回退到原版启动并告诉玩家原因，不能把游戏弄成打不开。
4. **权限与误报**：注入在用户权限下运行（非管理员优先）；杀软误报写进 FAQ。
   代码签名已决定 0.10/0.11 不做（纯 JS，用户跑的是自己签名的 node.exe）；
   0.12 起有原生组件，那时必须重新评估——不签名的四道拦截见战略稿 §9.4。
5. **引擎专属规则挂在 adapter 上**：MZ 的转义码、行宽、说话人判定，Ren'Py 的
   `{b}` 标签与 `[var]` 插值，都不能硬编码进 pipeline；新引擎只实现自己的
   `profile` 与 `validate(entry)`。

## 9. 分批计划

> 本节排期已按 2026-10-25 的决定更新，权威版本见 [dev/ENGINE-STRATEGY.md](dev/ENGINE-STRATEGY.md) §6.3。
> 本文件冻结的是**接口契约**（信封、错误码、adapter 形状），不是版本排期；排期变动不改契约。

| 版本 | 内容 | 验收 |
| --- | --- | --- |
| 0.10.0 | core 适配器化：`engines/registry` + mz/mv adapter 包住现有逻辑；新增 `export`、`launch`、`config`；全部命令 `--json` 稳定；契约先冻结（见下文五篇设计稿） | 既有测试全绿不降，新增适配器契约测试 |
| 0.10.x | ~~引擎拆缝 refactor~~（**已完成**，`refactor/engine-seams`）：引擎事实集中到 `src/engines/profile.js` 与 `rmFilePlan`，pipeline 从 `options.profile` 读、缺省回退原实现 | 354 pass（346 原有断言未改 + 8 条 profile 等价性新测试） |
| 0.11.0 | **已交付**：Ren'Py 接入——`.rpy` 解析器 + `.rpyc`（RENPY RPC2 头）解码、`game/` 项目发现（最多 3 层）、`translate <lang> strings:` 投递、Ren'Py 专属 profile 与 doctor 检查。战略稿 §6.3 排在 0.11 的"通用内容导入 v1"没有随这一版交付：源码里没有导入入口，命令仍是 13 个 | 459 pass / 0 fail；Ren'Py 8.5.3 SDK 自带的两个示例游戏走通 scan → extract → translate → install → uninstall，见 [games.md](games.md) |
| 0.12.0 | RGSS 注入 + 原生 helper：injector、hook DLL、按引擎下载与 manifest 校验的基础设施 | 失败时游戏不坏、能卸载干净 |
| 0.13.0 | 字典导出 v2（TSV/CSV）+ KRKR 提取 | 外部工具改过的表能回灌 |
| 0.14.0 | GUI（Electron）：拖 exe → 识别 → 启动 → 按能力矩阵加载译文；附 NScripter | 真机拖入多款游戏跑通 |
| 0.15.0 | KRKR 注入 + Wolf / SRPG Studio spike | 各一款真实游戏验收 |
| 1.0.0 | 10 个引擎 + 能力矩阵 + 便携 exe（图标、无控制台、最近游戏） | 双击 exe 可用 |

## 10. 风险

- **多引擎成本是乘法**：每个新引擎都是一次独立逆向，不是一个配置项。
  Ren'Py 是三者里最容易的——文本在 `.rpy`/`.rpyc`，引擎自带 `translate` 机制，
  所以 0.11 一个版本就拿下了；但它的代价是**只能整串替换**，做不到改半句。
  Unity 要面对 Mono/IL2CPP 两条路线；Wolf/KRKR 有成熟 hook 可参考。
- **Electron 体积与杀软**：便携包约 120–180 MB，首次运行可能被 Defender 拦一下；
  这是壳的成本，不影响 CLI 用户。
- **版本碎片**：MZ 已锁定 1.3.2–1.9.0；未来每加一个引擎都要维护版本区间与 fixture。
- **注入的失败风险**：注入类引擎必须能在崩溃后自恢复、能 detach 干净，否则玩家会丢存档进度——
  上线前的验收标准是"失败时游戏不坏、用户看得懂、能卸载干净"。

## 11. 与现有文档的关系

- JSON 信封、错误码、退出码（0.10 冻结，0.11 原样沿用） → [json-contract.md](json-contract.md)
- 引擎 adapter / 能力矩阵 / 安装与启动契约 → [engines.md](engines.md)
- 用户级配置与密钥优先级 → [config.md](config.md)
- 导出格式（0.11 仍只有 JSON，TSV/CSV 排 0.13） → [export-format.md](export-format.md)
- 平台支持矩阵与决策记录 → [platforms.md](platforms.md)
- 为什么选运行时钩子、文本面覆盖、转义码判据 → [design.md](design.md)
- 命令选项与 verify/terms/speaker 判据 → [commands.md](commands.md)
- 实测游戏（RPG Maker 15 款、Ren'Py SDK 自带项目）与支持边界 → [games.md](games.md)
- 已知限制全表 → [limitations.md](limitations.md)
