# 手动验收清单

这份清单只列需要人工判断的验收项。仓库内的单元测试、真机 GUI 链路和便携包校验
都已完成；发布决策已在 2026-11-15 拍板，Kirikiri 启动画面点击路径也已在 0.77 的真机
验收中完成。所有条目现在都已关闭，保留为发布记录。

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
0.83 已满足。0.84 起 `scan` / `extract` 也会读 Ren'Py screen AST 里的文本，quick menu 的
Back / Auto / Skip / Hide / Menu 会进入字典；2026-11-15 的真机截图底部显示 mock 的
`译:Back` / `译:Auto` / `译:Skip` / `译:Hide` / `译:Menu`。图片文字仍需 OCR，不在文本面内。

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

## 3. 代码签名与托管方式（已决定，2026-11-15）

现状：2026-11-07 已决定 1.0 不做 Windows 代码签名；2026-11-15 拍板托管走
GitHub Releases，便携包与 `SHA256SUMS` 作为 Release 资产，由仓库维护者手动发布。
README、GUI 和 [release.md](release.md) 都已明确写出 SmartScreen 风险与 SHA-256 校验边界。

- [x] 确认 1.0 继续不签名（当前默认）
- [x] 选定发布渠道：GitHub Releases
- [x] 确认发布者、压缩包命名和 SHA-256 清单的存放方式（见 [release.md](release.md) §5）
- [x] 在 `docs/evidence.md` 的 1.0 门禁最后一项写下决定

通过标准：1.0 的发布页或分发说明能让用户确认「未签名」这件事，并能拿到可核对的
`SHA256SUMS`；签名与托管不再是悬空项。

## 4. 1.0 引擎名单（已决定，2026-11-15）

现状：2026-11-15 拍板 1.0 只发布当前五个引擎（MZ / MV / Ren'Py / RGSS / Kirikiri），
不补到十个。新增 NScripter、Wolf、SRPG Studio、TyranoScript、Godot 不在 1.0 范围，
后续按 [ENGINE-STRATEGY](dev/ENGINE-STRATEGY.md) 的拍板门槛单独立项。

- [x] 拍板 1.0 = 五个引擎 + 能力矩阵 + 便携 exe
- [x] 不补引擎；后续按 ENGINE-STRATEGY 的拍板门槛逐项立项
- [x] 1.0 路线表改为实际五个引擎，不把计划中但未实现的引擎写进名单

通过标准：1.0 发布说明中的引擎名单与 `docs/engines.json`、`docs/games.md` 完全一致，
没有「计划中但未实现」的模糊表述。

## 5. Kirikiri 启动画面点击路径（手工）

现状：Kirikiri 的 `launch` 只负责启动 `Game.exe`；标题画面上的「开始游戏」等按钮
要点击后才能进入对白。0.77 已在一款商业游戏上完成 install → 启动 → 点击 → 见译文
→ uninstall；点击是桌面操作，没有做成产品化自动化，因此按手工步骤验收，2026-11-13 已完成。

- [x] `node bin/yakusha.js launch <game-dir>` 启动游戏，等标题画面稳定（窗口不要最小化）
- [x] 用截图确认「开始游戏」按钮在窗口内的矩形，再把窗口移到固定位置；点击按钮中心
- [x] 点击必须走 DPI-aware 的真实鼠标输入（先让窗口到前台并取得焦点，再移动光标与按下）；
      `PostMessage` 之类的合成消息在 Kirikiri 上不可靠，不作为验收手段
- [x] 进入第一段对白，肉眼确认至少一句带 mock `译:` 前缀或已翻译中文
- [x] `node bin/yakusha.js uninstall <game-dir>`，确认 `data/patch.xp3` / `patch2.xp3` 与
      `yakusha/krkr-patch.json` 消失，原 `data.xp3` 字节不变

通过标准：标题画面点击后能看到一段中文对白；窗口坐标只用于本机操作，不写进仓库文档或夹具。

## 不需要手动验收的项

以下已经在仓库内自动化或真机跑过，不需要再占用人工：

- MZ / MV 的真实游戏 L4 与五引擎 GUI 五链：见 [evidence.md](evidence.md)（Kirikiri 的启动画面点击路径见 §5，仍需手工）
- 便携包的构建、PE Subsystem=2 检查与五链 `--exe` 验收：见 [release.md](release.md)
- 能力矩阵与 `docs/engines.json` 的一致性：`test/engines-json.test.js`
