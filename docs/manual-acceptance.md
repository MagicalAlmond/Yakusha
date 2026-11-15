# 手动验收清单

这份清单只列需要人工判断的验收项。仓库内的单元测试、真机 GUI 链路和便携包校验
都已完成；剩下的每一项都需要一台有真实游戏的 Windows 机器，或者需要产品负责人做
发布决策。已经完成的历史项保留为记录并标 `[x]`。

验收口径与能力矩阵见 [evidence.md](evidence.md) 和 [engines.json](engines.json)。本文件
不重复七能力表，只给操作步骤和通过标准。

## 1. Ren'Py 真实游戏 L4（已完成，2026-11-15）

现状：0.83 已在一款商业 Ren'Py 游戏（RPA-3.0 打包）上完成 `scan` → `extract` →
`translate`（`mock`）→ `verify` → `install` → `launch` → `uninstall`；启动后对话框
显示 mock 的 `译:` 前缀，卸载后原 `.rpa` 字节不变。结果已写入
[evidence.md](evidence.md) 的 Ren'Py 行。

- [x] 扫描并抽取：`node bin/yakusha.js scan <game-dir>`、`node bin/yakusha.js extract <game-dir>`
- [x] 翻译并校验：`node bin/yakusha.js translate <game-dir>`、`node bin/yakusha.js verify <game-dir>`
- [x] 安装译文：`node bin/yakusha.js install <game-dir>`，确认 `game/yakusha_translation.rpy` 存在
- [x] 启动游戏：`node bin/yakusha.js launch <game-dir>`（或直接双击游戏 exe），进入一段对白，
      肉眼确认显示中文
- [x] 卸载并复核：`node bin/yakusha.js uninstall <game-dir>`，确认译文文件消失，游戏仍能启动
- [x] 把结果补进 `docs/evidence.md` 的 Ren'Py end-to-end 行

通过标准：真实游戏启动后至少一段对白显示中文；卸载后原游戏文件字节不变，译文文件被删除。
0.83 已满足。菜单项与 quick menu（Back / Auto / Skin / Hide / Menu）属于引擎 UI，是否翻译
取决于游戏是否把它们放进 Ren'Py 的翻译系统，不在本次 L4 门禁内；本次验收只确认了对白。

## 2. RGSS XP / VX 真机基线

现状：0.82 已在 XP（RGSS1）、VX（RGSS2）与 VX Ace（RGSS3）各一款商业游戏上完成
`scan` → `extract` → `translate`（`mock`）→ `verify` → `install` → `launch`。
XP 与 VX 的运行时画面都已归档产品化截图；VX 的 hook 日志记录 `drawn: 译` 与
`drawn: :`，2026-11-15 亮屏后重截的截图与日志一致。

- [x] XP：scan → extract → translate → verify → install → launch，进入对话框确认中文
- [x] XP：uninstall，确认 `yakusha/native/` 消失，游戏仍能启动
- [x] VX：重复上一组步骤，进入对话框确认中文（产品化截图已归档）
- [x] 记录每款的引擎版本（RGSS1 / RGSS2）、归档/数据布局、是否遇到杀软误报（未观察到拦截）
- [x] 0.82 已补上实机基线，不再需要把 XP / VX 标成 experimental

通过标准：至少各一款 XP 与 VX 游戏在 `install` 后启动并看到中文对白；`uninstall`
后原生组件目录被删除，原游戏可正常启动。0.82 已满足。

## 3. 代码签名与托管方式

现状：2026-11-07 已决定 1.0 暂不做 Windows 代码签名；便携包按未签名发布，README、
GUI 和 [release.md](release.md) 都已明确写出 SmartScreen 风险与 SHA-256 校验边界。
托管方式仍未定。

- [ ] 确认 1.0 继续不签名（当前默认），或改为购买证书并重新验收 SmartScreen
- [ ] 选定发布渠道：GitHub Releases、自建静态下载页，或仅私下分发
- [ ] 如果使用 GitHub Releases，确认发布者、压缩包命名和 SHA-256 清单的存放方式
- [ ] 在 `docs/evidence.md` 的 1.0 门禁最后一项写下决定

通过标准：1.0 的发布页或分发说明能让用户确认「未签名」这件事，并能拿到可核对的
`SHA256SUMS`；签名与托管不再是悬空项。

## 4. 1.0 引擎名单

现状：当前仓库支持 MZ / MV / Ren'Py / RGSS / Kirikiri 五个引擎。ENGINE-STRATEGY 的
1.0 目标写的是 10 个引擎，但新增 NScripter、Wolf、SRPG Studio、TyranoScript、Godot
需要真实游戏样本、fixture 与路线拍板，不能在仓库内凭空完成。

- [ ] 拍板 1.0 是「五个引擎 + 能力矩阵 + 便携 exe」，还是先补到十个引擎
- [ ] 如果补引擎，按 [ENGINE-STRATEGY](dev/ENGINE-STRATEGY.md) 的拍板门槛逐项立项
- [ ] 如果维持五个引擎，把 1.0 路线表里的「10 个引擎」改成实际数字，并把不达标项标 experimental

通过标准：1.0 发布说明中的引擎名单与 `docs/engines.json`、`docs/games.md` 完全一致，
没有「计划中但未实现」的模糊表述。

## 不需要手动验收的项

以下已经在仓库内自动化或真机跑过，不需要再占用人工：

- MZ / MV / Kirikiri 的真实游戏 L4 与五引擎 GUI 五链：见 [evidence.md](evidence.md)
- 便携包的构建、PE Subsystem=2 检查与五链 `--exe` 验收：见 [release.md](release.md)
- 能力矩阵与 `docs/engines.json` 的一致性：`test/engines-json.test.js`
