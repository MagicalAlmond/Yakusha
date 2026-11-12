# 手动验收清单

这份清单只列**仓库内已经没有办法继续自动化**的验收项。仓库内的单元测试、真机 GUI
链路和便携包校验都已完成；剩下的每一项都需要一台有真实游戏的 Windows 机器，或者
需要产品负责人做发布决策。

验收口径与能力矩阵见 [evidence.md](evidence.md) 和 [engines.json](engines.json)。本文件
不重复七能力表，只给操作步骤和通过标准。

## 1. Ren'Py 真实游戏 L4

现状：Ren'Py 的 scan / extract / translate / verify / install / uninstall / doctor 在 SDK
自带项目上全部通过，但还没有在一款真实商业游戏上启动并肉眼确认译文，因此证据等级
仍是 L3。需要准备一款未加密或可正常读取的 Ren'Py 游戏目录。

- [ ] 扫描并抽取：`node bin/yakusha.js scan <game-dir>`、`node bin/yakusha.js extract <game-dir>`
- [ ] 翻译并校验：`node bin/yakusha.js translate <game-dir>`、`node bin/yakusha.js verify <game-dir>`
- [ ] 安装译文：`node bin/yakusha.js install <game-dir>`，确认 `game/yakusha_translation.rpy` 存在
- [ ] 启动游戏：`node bin/yakusha.js launch <game-dir>`（或直接双击游戏 exe），进入一段对白，
      肉眼确认显示中文
- [ ] 卸载并复核：`node bin/yakusha.js uninstall <game-dir>`，确认译文文件消失，游戏仍能启动
- [ ] 把结果补进 `docs/evidence.md` 的 Ren'Py end-to-end 行；若只完成部分，把实际缺什么写清楚

通过标准：真实游戏启动后至少一段对白和一处菜单项显示中文；卸载后原游戏文件字节不变，
译文文件被删除。

## 2. RGSS XP / VX 真机基线

现状：RGSS 的 VX Ace（RGSS3）已有两款商业游戏的真机 L4；XP（RGSS1）和 VX（RGSS2）的
extract 已有合成夹具覆盖，但没有真实游戏启动记录。需要各准备一款 XP 游戏（`.rxproj`
或 `Game.ini` + `.rxdata`）和一款 VX 游戏（`.rvproj` + `.rvdata`）。

- [ ] XP：scan → extract → translate → verify → install → launch，进入对话框确认中文
- [ ] XP：uninstall，确认 `yakusha/native/` 消失，游戏仍能启动
- [ ] VX：重复上一组步骤
- [ ] 记录每款的引擎版本（RGSS1 / RGSS2）、归档/数据布局、是否遇到杀软误报
- [ ] 如果暂时没有样本，在 1.0 发布说明中把 RGSS XP / VX 明确标为 experimental

通过标准：至少各一款 XP 与 VX 游戏在 `install` 后启动并看到中文对白；`uninstall`
后原生组件目录被删除，原游戏可正常启动。没有样本时，第 5 项是唯一替代路径。

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
