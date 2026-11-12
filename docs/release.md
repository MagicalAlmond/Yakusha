# 便携包构建与验收

本文记录 1.0 发布前最后一个工程件：把仓库与 Electron 运行时组装成可双击运行的
Windows x64 目录。它不是安装器，不写注册表，不需要管理员权限，也不包含游戏内容或译文。

## 1. 前置条件

- Windows 10/11 x64；Node.js >= 22。
- 仓库根执行过 `pnpm install`：Electron 只在 devDependencies 里，用来提供便携包的
  运行时；产物运行时不依赖 Node、pnpm 或仓库。
- `native/prebuilt/manifest.json` 与清单里的四个原生组件存在（仓库不追踪该目录，
  由 `node native/build.mjs --llvm-mingw <path>` 生成，见 [native/README.md](../native/README.md)）。
- 构建输入只读：`node_modules/electron/dist` 与 `native/prebuilt` 都不会被修改。

## 2. 构建

```bash
node tools/portable.mjs
```

默认输出 `dist/yakusha-<version>-win-x64/`，版本取自 `package.json`。常用参数：

| 参数 | 作用 |
| --- | --- |
| `--out <dir>` | 指定输出目录；默认 `dist/yakusha-<version>-win-x64` |
| `--electron-dir <dir>` | 指定解包后的 Electron 目录；默认 `node_modules/electron/dist` |
| `--native-dir <dir>` | 指定原生组件目录；默认 `native/prebuilt` |
| `--force` | 只替换本工具生成过的输出目录；用户自己的非空目录仍拒绝 |
| `--verify <dir>` | 只校验已有产物，不构建 |
| `--json` | 输出单个 JSON 文档，便于脚本消费 |
| `--help` | 打印用法 |

输出目录的布局：

```text
yakusha-0.79.0-win-x64/
  Yakusha.exe                 # 由 electron.exe 改名，双击即启动 GUI
  build-info.json             # 版本、Electron 版本、构建时间、原生组件清单、signed:false
  SHA256SUMS                  # 除自身外每个文件的 SHA-256，排序、两空格分隔
  README.md
  LICENSE
  resources/
    app/
      package.json            # main: gui/main.js，type: module
      bin/  src/  gui/
      native/prebuilt/        # 与根目录 native/prebuilt 同内容
    resources.pak
    locales/ ...
```

`resources/default_app.asar` 与 Electron 自带的默认应用会被删除；应用只加载
`resources/app`。GUI 的 profile 仍按 [gui.md](gui.md) §10 的规则解析：优先
`--user-data-dir`，其次应用数据目录，最后应用旁边的 `.yakusha-gui-profile`。

## 3. 校验

```bash
node tools/portable.mjs --verify dist/yakusha-0.79.0-win-x64
```

校验会重新计算每个文件的哈希，并检查：

- `build-info.json` 的 schema、工具名与版本；
- `Yakusha.exe`、`resources/app/package.json` 的 `main` / `type` / 版本；
- `SHA256SUMS` 不含绝对路径、重复项、缺失项，也不漏掉产物里的任何文件；
- 每个文件的 SHA-256 与清单一致。

任何一项不符都以 `E_VERIFY` 退出 1，不会给出"部分可用"的结论。

## 4. 真机验收

构建后用 GUI 验收工具直接运行便携包（而不是仓库里的 Electron）：

```bash
node tools/gui-acceptance.mjs --exe dist/yakusha-0.79.0-win-x64/Yakusha.exe
```

工具会为 MZ / MV / Ren'Py / RGSS / Kirikiri 五条链准备临时游戏，在真实窗口里点击
scan → extract → translate → verify → install → uninstall → doctor，并把截图与
`summary.json` 写到 `.dsh-scratch/gui-acceptance-*`。2026-11-12 的 0.79 构建实测：
163 个文件 / 307,921,513 字节，五链全部通过。

## 5. 签名、分发与更新

- **不签名**：Windows 代码签名在 2026-11-07 拍板暂不做（见 [DEVLOG](dev/DEVLOG.md)）。
  首次运行可能出现 SmartScreen 提示；这是未签名可执行文件的预期行为，不是缺陷。
- 原生组件本身带 SHA-256 `manifest.json`，安装前逐文件校验；这只保证组件与清单一致，
  不构成对构建者或下载渠道的信任。
- **不做自动更新**：更新渠道、增量与校验未设计；用户从发布页手动下载新目录替换旧目录。
- 产物目录默认在 `.gitignore` 的 `dist/` 下，不提交仓库；需要分发的压缩包由发布者
  在仓库外生成，仓库不保存二进制。
- 代码签名与托管方式的最终决定见 [evidence.md](evidence.md) 的 1.0 门禁；本工具只负责
  让"双击 Yakusha.exe 可用"这件事可复现、可校验。

## 6. 常见错误

| 错误码 | 含义 | 处理 |
| --- | --- | --- |
| `E_USAGE` | 参数缺失或未知 | 看 `--help`；退出码 2 |
| `E_IO` | Electron 目录或原生组件缺失 | 先 `pnpm install`，再确认 `native/prebuilt/manifest.json` |
| `E_EXISTS` | 输出目录非空且不是本工具生成的 | 换 `--out`；确认后手动清理，或只对自有目录加 `--force` |
| `E_VERIFY` | 产物被改动、缺文件或多文件 | 重新构建；不要手工编辑 `SHA256SUMS` |

## 7. 与发布流程的关系

版本号只改 `package.json`；`CHANGELOG.md`、`docs/architecture.md` 的路线表和
`docs/dev/DEVLOG.md` 同步记录。发布验收的顺序是：`npm test` 全绿 → 构建 →
`--verify` → 用 `--exe` 跑五链 GUI 验收 → 归档 `summary.json` 与截图。仓库不创建
tag、不推送 release，发布物由维护者在本地生成并自行分发。
