# 交付证据台账

这份台账记录每个引擎走到了哪一步、证据在哪里、离 1.0 的 L4 门禁还差什么。它不重复能力值——能力值的唯一事实源是 [engines.json](engines.json)，本表只记录证据。

证据分两类：一类在仓库内，任何人都能用 `npm test` 复核；另一类是仓库外的真机验收，游戏、机器与截图都不入库，只记匿名事实与日期。第二类不可复核，所以写的是「当时看到了什么」，不是「任何机器都能重现」。

只剩人工完成的验收项见 [manual-acceptance.md](manual-acceptance.md)。

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
| extract | L2 | `test/renpy-extract.test.js`、`test/renpy-rpyc.test.js`、`test/renpy-rpa.test.js`；`docs/games.md` 的 Ren'Py 一节；仓库外真机验收 2026-11-15 | 真实商业游戏（RPA-3.0）读出 43,860 唯一串 / 54,617 次，`undecodable` 0；图片文字不处理；插件自定义容器只读字面量或显式 `_()`，运行时拼接/自绘看不到 |
| export | L2 | `test/export.test.js` | 同 extract 的样本缺口；真实游戏导出未单独记录 |
| runtime | L4 | `test/renpy-runtime.test.js`；`docs/games.md` 的 Ren'Py 一节；`docs/manual-acceptance.md` §1；仓库外真机验收 2026-11-15 | 图片文字不处理（需 OCR）；插件自定义容器的运行时拼接/自绘文本看不到；quick menu 已覆盖（2026-11-15 截图见 `译:Back` 等） |
| launch | L4 | `test/launch.test.js`；仓库外真机验收 2026-11-15 | — |
| debuggable | — | `docs/engines.json`（`debuggable: false`）；`src/engines/contract.js` | 未实现 |
| attach | — | `docs/engines.json`（`attach: false`）；`test/engine-contract.test.js:418-427` | 0.10 起是桩，无 CLI |
| liveReload | — | `docs/engines.json`（`liveReload: false`）；`src/engines/contract.js` | 未实现 |
| end-to-end | L4 | `test/renpy-runtime.test.js`、`test/renpy-rpa.test.js`；`docs/games.md` 的 Ren'Py 一节；仓库外真机验收 2026-11-15 | — |

2026-11-15 的仓库外真机验收用的是一款商业 Ren'Py 游戏（RPA-3.0 打包，`game/script.rpa` 内含 245 个 `.rpyc`）。`scan` 读出 292 个数据文件、43,860 唯一串 / 54,617 次，`undecodable` 0；`extract` 43,860；`translate`（mock）43,860；`verify --source-lang en` 2,974 条 source warning、0 errors；`install` 写 5,301,453 字节的 `game/yakusha_translation.rpy`；启动后对话框出现 mock 的 `译:` 前缀（说话人「心声...」，正文「译:马上就要到了...」）；0.84 又从同一款的 screen AST 读出 quick menu 标签，2026-11-15 的运行时截图底部显示 mock 的 `译:Back` / `译:Auto` / `译:Skip` / `译:Hide` / `译:Menu`；`uninstall` 返回 `removed:true`、`drifted:false`，原 `.rpa` 字节不变。

## RGSS（XP / VX / VX Ace）

| 能力键 | 证据等级 | 证据指针 | 缺什么 |
| --- | --- | --- | --- |
| extract | L2 | `test/rgss-extract.test.js`、`test/rgss-archive.test.js`、`test/rgss-marshal.test.js`；`docs/games.md` 的 RGSS 一节 | XP / VX / VX Ace 各一款真实游戏完成 scan / extract（XP 5,316 串、VX 733 串、VX Ace 31,730 串）；三个版本另有合成夹具（`test/rgss-extract.test.js`） |
| export | L2 | `test/export.test.js` | 同 extract；真实游戏导出未单独记录 |
| runtime | L4 | `test/rgss-native-source.test.js`；`docs/limitations.md` 的 RGSS 一节；`docs/engines.md` 的 RGSS 一节 | 三版各一款真机走查；VX 也有产品化截图（仓库外 2026-11-15），与 hook 日志一致；自绘位图字体与图片文字不在钩子覆盖内 |
| launch | L4 | `test/launch.test.js`；`docs/limitations.md` 的 RGSS 一节 | 同 runtime；XP / VX / VX Ace 各一款经注入器启动 |
| debuggable | — | `docs/engines.json`（`debuggable: false`）；`src/engines/contract.js` | 未实现 |
| attach | — | `docs/engines.json`（`attach: false`）；`test/engine-contract.test.js:418-427` | 0.10 起是桩，无 CLI |
| liveReload | — | `docs/engines.json`（`liveReload: false`）；`src/engines/contract.js` | 未实现 |
| end-to-end | L4 | `test/rgss-native-source.test.js`；`docs/games.md` 的 RGSS 一节 | 三版各一款走完 translate（mock）→ verify → install → launch；VX 的运行时证据是 hook 日志 + 产品化截图（仓库外 2026-11-15） |

## Kirikiri

| 能力键 | 证据等级 | 证据指针 | 缺什么 |
| --- | --- | --- | --- |
| extract | L2 | `test/krkr-extract.test.js`、`test/krkr-xp3.test.js`、`test/krkr-ks.test.js`、`test/krkr-project.test.js`；`docs/games.md` 的 Kirikiri 一节 | 只读标准未加密 XP3；加密变体与 Hxv4 索引不支持 |
| export | L2 | `test/export.test.js` | 真实游戏上的导出与回读未单独记录 |
| runtime | L4 | `test/krkr-patch.test.js`、`test/krkr-cli.test.js:172-193`；`docs/limitations.md` 的 Kirikiri 一节；仓库外真机验收 2026-11-13 | — |
| launch | L4 | `test/launch.test.js`；`docs/limitations.md` 的 Kirikiri 一节；`docs/manual-acceptance.md` §5；仓库外真机验收 2026-11-13 | 启动画面点击路径是手工步骤（见 `docs/manual-acceptance.md` §5），未做成自动化验收 |
| debuggable | — | `docs/engines.json`（`debuggable: false`）；`src/engines/contract.js` | 未实现 |
| attach | — | `docs/engines.json`（`attach: false`）；`test/engine-contract.test.js:418-427` | 0.10 起是桩，无 CLI |
| liveReload | — | `docs/engines.json`（`liveReload: false`）；`src/engines/contract.js` | 未实现 |
| end-to-end | L4 | `test/krkr-patch.test.js`、`test/krkr-cli.test.js:172-193`；`docs/limitations.md` 的 Kirikiri 一节；`docs/manual-acceptance.md` §5；仓库外真机验收 2026-11-13 | 启动画面点击路径按 `docs/manual-acceptance.md` §5 手工执行；Hxv4 索引仍报 `E_UNSUPPORTED` |

2026-11-13 的仓库外真机验收用的是一款商业 KiriKiri 游戏（1280×960 KAG）。该游戏已有 `patch.xp3`，`install` 按规则顺延写入 `patch2.xp3`（10,125 条目 / 44 个 `.ks`）；启动后对白两处出现 mock 的 `译:` 前缀，说明归档被加载、UTF-8 BOM 与 UTF-16LE 的 `.ks` 都被正确解码；`uninstall` 返回 `removed:true`、`drifted:false`，只回收 `patch2.xp3`，原 `data.xp3`、`patch.xp3` 与 exe 字节不变。`docs/games.md` 的 Kirikiri 一节曾把「headless 无法开窗」写成限制，这条结论已被 0.77 的真机验收推翻，本台账按实测记录。

## 缺口汇总

| 引擎 | 到 L4 还差什么 |
| --- | --- |
| RPG Maker MZ | 无；L4 已达成 |
| RPG Maker MV | 无；L4 已达成 |
| Ren'Py | 无；L4 已达成（2026-11-15 真实商业游戏，RPA-3.0） |
| RGSS | 三版各一款已有 L4；VX 也有产品化截图（仓库外 2026-11-15） |
| Kirikiri | 无；L4 已达成。启动画面点击路径按 `docs/manual-acceptance.md` §5 手工执行，Hxv4 索引不在支持范围 |

## 1.0 门禁清单

依据 [ENGINE-STRATEGY](dev/ENGINE-STRATEGY.md) 的 1.0 行：每个引擎都要有 L4 证据；不达标的要明确标 experimental。

- [x] RPG Maker MZ 达到 L4。
- [x] RPG Maker MV 达到 L4。
- [x] Ren'Py 达到 L4（2026-11-15 真实商业游戏，RPA-3.0；启动后对话框见 mock `译:` 前缀）。
- [x] RGSS 在 XP / VX / VX Ace 上各一款达到 L4。
- [x] RGSS XP / VX 补实机基线（0.82；VX 运行时证据为 hook 日志 + 产品化截图，仓库外 2026-11-15）。
- [x] Kirikiri 达到 L4。
- [x] 五个引擎的 `capabilities` 与 `docs/engines.json`、`docs/games.md`、`docs/limitations.md` 一致（`test/engines-json.test.js` 守住）。
- [x] GUI 真机走查：`docs/gui.md` 的验收项逐条在真机点过。0.78 用 `tools/gui-acceptance.mjs` 在 Electron 真窗跑通 MZ / MV / Ren'Py / RGSS / Kirikiri 五链的 scan → extract → translate → verify → install → uninstall → doctor，并核对 plugin 档 `js/plugins.js` 与 patch 档原 `data.xp3` 的字节不变（`test/gui-e2e.test.js` 只是 handler 层的自动化覆盖）。
- [x] 便携 exe：1.0.0 用 `tools/portable.mjs` 构建，`--verify` 重算全部哈希，`tools/gui-acceptance.mjs --exe` 在便携包上跑通五链（2026-11-15 实测 167 个 payload 文件 / 307,967,151 字节，`summary.json` 与截图归档在仓库外验收目录）。构建与 `--verify` 还校验 `Yakusha.exe` 的 PE Subsystem=2（Windows GUI，拒绝控制台黑框），并在 `build-info.json` 记 `subsystem: "windows-gui"`；最近项目与窗口状态见 `docs/gui.md` §9。
- [x] 代码签名与托管方式已定稿（2026-11-15）：继续不签名，发布渠道为 GitHub Releases，SHA-256 清单随发布物；见 [release.md](release.md) §5。
