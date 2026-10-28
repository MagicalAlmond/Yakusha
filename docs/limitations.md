# 已知限制

这份清单是工具的诚实边界：哪些能做、哪些不能做、哪些刻意不做。它随版本更新，
每一条都对应实测或明确的决策记录。已知限制不是免责声明——写着做不到的就做不到。

## 文本面

- 只处理游戏自己的文本资源：MZ/MV 是 `data/` 里的 JSON，Ren'Py 是 `game/` 下
  `.rpy` / `.rpyc` 里的对话、选项、`_()` 字符串与 screen 文本，RGSS 是数据文档里
  事件指令与数据库字段的文本。插件 `js/plugins/*.js` 里硬编码的 UI 文案、图片里的文字不处理。

## 引擎覆盖

- 多引擎只接了 MZ / MV / Ren'Py / RGSS / Kirikiri 五个适配器；Unity、Godot、Wolf
  不在当前版本内，inject 档只有契约。0.12 注册的 RGSS 与 0.13 注册的 Kirikiri 都
  只到 L1–L3（识别 / 盘点 / 提取 / 翻译 / 校验 / 导出），没有交付层。

## Ren'Py

- 只投 `schinese` 一种语言（命令行没有选语言的入口）。
- `game/tl/` 下已有的译文不读也不合并。
- 图片文字、插件自定义的说话人容器看不到。

## RGSS（XP / VX / VX Ace）

- 本版没有交付层：`install` 与 `uninstall` 报 `E_NOT_IMPLEMENTED`（退出码 2），
  一个文件都不写，游戏仍然显示原文。交付层的路线已于 2026-10-27 拍板走原生注入器 +
  hook DLL（纯 JS 写回保留为历史备选），实现待后续工作包；工具链已就绪。
- 只提取玩家可读的位置：事件指令 401 / 405 / 102 / 101 与数据库字段 320。
  Ruby 脚本（codeobj）不碰。
- 归档（`.rgssad` / `.rgss2a` / `.rgss3a`）与散装 `Data/` 目录只读一边，不合并。
- Ruby Marshal 只认 4.x 版本。
- 一款 RGSS3 / VX Ace 商业游戏实测：644MB 归档、394 个数据文档、31,730 条唯一串、
  0 条解不开、约 380ms。
- 写回从未真机验证（没有交付层，谈不上验证）。

## Kirikiri（KRKR）

- 本版没有交付层：`install` 与 `uninstall` 报 `E_NOT_IMPLEMENTED`（退出码 2），
  一个文件都不写，游戏仍然显示原文。引擎没有翻译资源目录可填，交付意味着把改过的
  `.ks` 写回 XP3 归档，路线未拍板（见 `docs/dev/DEVLOG.md` 待拍板表）。
- 只读标准 XP3 索引；被外部工具改过索引的归档（Hxv4 形态）报
  `E_UNSUPPORTED`，不猜测、不重建索引。
- 加密变体（krkr2 per-file keys、krkrz cxdec）不解析，条目直接进 `undecodable`。
- `.tjs` 脚本只计数不读内容，可翻译文本只收 `.ks`。
- 编码按 BOM 识别 UTF-16LE/BE，再按 UTF-8 严格解码、Shift_JIS 兜底；解不出的行记进 `undecodable` 继续，不中断。
- 游戏标题与引擎版本藏在加密或可选配置里，0.13 不解析；`scan` / `doctor`
  显示 `(untitled)`。
- 读取器覆盖是合成夹具级测试（条目解包、adler-32 校验、行分类、标签剥离）加上
  0.16 的真实归档复核（两款商业归档全条目 adler-32 与长度校验通过、六款游戏 scan
  实测；改版索引与变换头归档只验证到干净报错），没有运行时全量翻译实测。

## 通用边界

- 模型译文是机器产出，发布前必须人工校对；`verify` 十条判据只能拦截常见模式
  （回声译、转义码、占位符、槽位、行宽、假名残留、繁简混排、说话人、被拒条目），
  不能替代校对。
- config / export / launch 已实现，attach（接管运行中的进程）仍是桩，
  能力表里 `attach: false`，没有 CLI 入口（GUI 也没有）。
- 发布渠道只有 `--json` 与文本两种输出：`--json` 是扁平单行 JSON，退出码 0 / 1 / 2，
  错误码 13 个，冻结于 0.10（详见 `docs/json-contract.md`）；其余 14 条命令
  走同一信封，没有第二种机器可读出口。
- 0.13 起有译文导入：`import` 配合 `export --format tsv / csv` 做表格往返
  （表头 `source` / `target` / `contexts`，UTF-8 BOM + CRLF，round-trip 字节相同）。
  仍然没有的：字典 v2 的 engine / locator 字段（多引擎共存与精确定位），
  待拍板事项见 `docs/dev/DEVLOG.md`。
- GUI 最小外壳 0.14 已交付（Electron，safeStorage 存 key，能力位驱动按钮灰显）；
  完整字典编辑界面等仍未做，见 `docs/gui.md`。
- 只在 Windows 10/11 x64 上支持与验收；Linux、macOS、WSL、Wine、Proton 不作为
  受支持环境。
