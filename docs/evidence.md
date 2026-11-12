# 交付证据台账

这份台账记录每个引擎走到了哪一步、证据在哪里、离 1.0 的 L4 门禁还差什么。它不重复能力值——能力值的唯一事实源是 [engines.json](engines.json)，本表只记录证据。

证据分两类：一类在仓库内，任何人都能用 `npm test` 复核；另一类是仓库外的真机验收，游戏、机器与截图都不入库，只记匿名事实与日期。第二类不可复核，所以写的是「当时看到了什么」，不是「任何机器都能重现」。

四个等级：

- **L1 detect（识别）**：adapter 在真实游戏目录上认出项目，不依赖手工指定引擎。
- **L2 read（读取）**：真实游戏的 `scan` / `extract` 能读出可译文本，`undecodable` 可解释。
- **L3 static（交付）**：`translate`（`mock` 亦可）→ `verify` → `install` 全链路走通，并静态核对交付物里的译文。
- **L4 runtime（运行时）**：启动真实游戏，肉眼在游戏画面里看到译文。

表中的「证据等级」是该能力目前走到的最远一级；`—` 表示这一项不是 L1–L4 链上的交付能力（布尔能力位或未实现），只看仓库内契约与测试。

## RPG Maker MZ

| 能力键 | 证据等级 | 证据指针 | 缺什么 |
| --- | --- | --- | --- |
| extract | L2 | `test/extract.test.js`、`test/plugin-runtime.test.js`；`docs/games.md:14-38` | — |
| export | L2 | `test/export.test.js`（json / flat / tsv / csv / jsonl、导入导出、provenance） | 真实游戏上的导出与回读未单独记录 |
| runtime | L4 | `test/plugin-runtime.test.js`、`test/install.test.js`；`docs/games.md:32-38` | — |
| launch | L4 | `test/launch.test.js`；`docs/games.md:14-38` | — |
| debuggable | — | `docs/engines.json`（`debuggable: true`）；`test/engine-contract.test.js:102` | 能力位已开放，未在真实游戏上单独验收调试通道 |
| attach | — | `docs/engines.json`（`attach: false`）；`test/engine-contract.test.js:418-427` | 0.10 起是桩，无 CLI |
| liveReload | — | `docs/engines.json`（`liveReload: false`）；`src/engines/contract.js` | 未实现 |
| end-to-end | L4 | `test/plugin-runtime.test.js`、`test/install.test.js`、`test/launch.test.js`；`docs/games.md:14-38` | — |

## RPG Maker MV

| 能力键 | 证据等级 | 证据指针 | 缺什么 |
| --- | --- | --- | --- |
| extract | L2 | `test/extract.test.js`、`test/plugin-runtime.test.js`；`docs/games.md:14-38` | — |
| export | L2 | `test/export.test.js` | 真实游戏上的导出与回读未单独记录 |
| runtime | L4 | `test/plugin-runtime.test.js`、`test/install.test.js`；`docs/games.md:32-38` | — |
| launch | L4 | `test/launch.test.js`；`docs/games.md:14-38` | — |
| debuggable | — | `docs/engines.json`（`debuggable: false`）；`docs/games.md:98` | 引擎本身不支持挂 `--remote-debugging-port` |
| attach | — | `docs/engines.json`（`attach: false`）；`test/engine-contract.test.js:418-427` | 0.10 起是桩，无 CLI |
| liveReload | — | `docs/engines.json`（`liveReload: false`）；`src/engines/contract.js` | 未实现 |
| end-to-end | L4 | `test/plugin-runtime.test.js`、`test/install.test.js`、`test/launch.test.js`；`docs/games.md:14-38` | — |

## Ren'Py

| 能力键 | 证据等级 | 证据指针 | 缺什么 |
| --- | --- | --- | --- |
| extract | L2 | `test/renpy-extract.test.js`、`test/renpy-rpyc.test.js`；`docs/games.md:125-144` | 只用 SDK 官方示例验收，未测真实商业游戏 |
| export | L2 | `test/export.test.js` | 同 extract 的样本缺口；真实游戏导出未单独记录 |
| runtime | L3 | `test/renpy-runtime.test.js`；`docs/games.md:125-144` | 只做到 install 后静态核对 `game/yakusha_translation.rpy`，未启动游戏看对话框 |
| launch | L1 | `test/launch.test.js` | 只有适配器启动路径测试，没有真实游戏启动记录 |
| debuggable | — | `docs/engines.json`（`debuggable: false`）；`src/engines/contract.js` | 未实现 |
| attach | — | `docs/engines.json`（`attach: false`）；`test/engine-contract.test.js:418-427` | 0.10 起是桩，无 CLI |
| liveReload | — | `docs/engines.json`（`liveReload: false`）；`src/engines/contract.js` | 未实现 |
| end-to-end | L3 | `test/renpy-runtime.test.js`；`docs/games.md:125-144` | 缺 L4：启动真实游戏并肉眼确认译文 |

## RGSS（XP / VX / VX Ace）

| 能力键 | 证据等级 | 证据指针 | 缺什么 |
| --- | --- | --- | --- |
| extract | L2 | `test/rgss-extract.test.js`、`test/rgss-archive.test.js`、`test/rgss-marshal.test.js`；`docs/games.md:146-193` | 只有 VX Ace 样本，XP / VX 未测 |
| export | L2 | `test/export.test.js` | 同 extract 的样本缺口；真实游戏导出未单独记录 |
| runtime | L4 | `test/rgss-native-source.test.js`；`docs/limitations.md:43-44`；`docs/engines.md:1416` | XP / VX 未测；自绘位图字体与图片文字不在钩子覆盖内 |
| launch | L4 | `test/launch.test.js`；`docs/limitations.md:43-44` | 同 runtime |
| debuggable | — | `docs/engines.json`（`debuggable: false`）；`src/engines/contract.js` | 未实现 |
| attach | — | `docs/engines.json`（`attach: false`）；`test/engine-contract.test.js:418-427` | 0.10 起是桩，无 CLI |
| liveReload | — | `docs/engines.json`（`liveReload: false`）；`src/engines/contract.js` | 未实现 |
| end-to-end | L4 | `test/rgss-native-source.test.js`；`docs/games.md:146-193` | 只覆盖 VX Ace 样本；XP / VX 未测 |

## Kirikiri

| 能力键 | 证据等级 | 证据指针 | 缺什么 |
| --- | --- | --- | --- |
| extract | L2 | `test/krkr-extract.test.js`、`test/krkr-xp3.test.js`、`test/krkr-ks.test.js`、`test/krkr-project.test.js`；`docs/games.md:195-237` | 只读标准未加密 XP3；加密变体与 Hxv4 索引不支持 |
| export | L2 | `test/export.test.js` | 真实游戏上的导出与回读未单独记录 |
| runtime | L4 | `test/krkr-patch.test.js`、`test/krkr-cli.test.js:172-193`；`docs/limitations.md:74-80`；仓库外真机验收 2026-11-13 | — |
| launch | L4 | `test/launch.test.js`；`docs/limitations.md:74-80`；仓库外真机验收 2026-11-13 | 启动画面点击路径仍是手工操作，未做成自动化验收 |
| debuggable | — | `docs/engines.json`（`debuggable: false`）；`src/engines/contract.js` | 未实现 |
| attach | — | `docs/engines.json`（`attach: false`）；`test/engine-contract.test.js:418-427` | 0.10 起是桩，无 CLI |
| liveReload | — | `docs/engines.json`（`liveReload: false`）；`src/engines/contract.js` | 未实现 |
| end-to-end | L4 | `test/krkr-patch.test.js`、`test/krkr-cli.test.js:172-193`；`docs/limitations.md:74-80`；仓库外真机验收 2026-11-13 | 启动画面点击路径未自动化；Hxv4 索引仍报 `E_UNSUPPORTED` |

2026-11-13 的仓库外真机验收用的是一款商业 KiriKiri 游戏（1280×960 KAG）。该游戏已有 `patch.xp3`，`install` 按规则顺延写入 `patch2.xp3`（10,125 条目 / 44 个 `.ks`）；启动后对白两处出现 mock 的 `译:` 前缀，说明归档被加载、UTF-8 BOM 与 UTF-16LE 的 `.ks` 都被正确解码；`uninstall` 返回 `removed:true`、`drifted:false`，只回收 `patch2.xp3`，原 `data.xp3`、`patch.xp3` 与 exe 字节不变。`docs/games.md:226-230` 曾把「headless 无法开窗」写成限制，这条结论已被 0.77 的真机验收推翻，本台账按实测记录。

## 缺口汇总

| 引擎 | 到 L4 还差什么 |
| --- | --- |
| RPG Maker MZ | 无；L4 已达成 |
| RPG Maker MV | 无；L4 已达成 |
| Ren'Py | 缺一个真实商业游戏样本；当前只到 L3，需要在真实游戏里启动并肉眼确认译文 |
| RGSS | VX Ace 已有 L4；XP / VX 没有实机基线，1.0 前不补测就按 experimental 标 |
| Kirikiri | 无；L4 已达成。启动画面点击路径仍靠手工，Hxv4 索引不在支持范围 |

## 1.0 门禁清单

依据 `docs/dev/ENGINE-STRATEGY.md:599`：每个引擎都要有 L4 证据；不达标的要明确标 experimental。

- [x] RPG Maker MZ 达到 L4。
- [x] RPG Maker MV 达到 L4。
- [ ] Ren'Py 达到 L4（当前 L3，缺真实商业游戏运行时验收）。
- [x] RGSS 在 VX Ace 上达到 L4。
- [ ] RGSS XP / VX 补实机基线，或在 1.0 明确标 experimental。
- [x] Kirikiri 达到 L4。
- [x] 五个引擎的 `capabilities` 与 `docs/engines.json`、`docs/games.md`、`docs/limitations.md` 一致（`test/engines-json.test.js` 守住）。
- [ ] GUI 真机走查：`docs/gui.md` 的验收项逐条在真机点过（仓库内 `test/gui-e2e.test.js` 只是自动化覆盖，不等同真机验收）。
- [ ] 发布级验收：便携 exe、代码签名与托管方式在 1.0 前定稿（`docs/dev/ENGINE-STRATEGY.md:599` 之外的发布前置）。
