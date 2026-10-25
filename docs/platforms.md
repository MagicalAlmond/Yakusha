# 平台支持决策（0.10）

> **状态：已决定，0.10 起生效。** 这是一份决策记录，不是路线图承诺。变更它需要
> 新的决策记录，不能靠改代码悄悄扩大支持面。

## 1. 决定

| 平台 | 支持级别 | 说明 |
| --- | --- | --- |
| Windows 10 22H2 及以上 / Windows 11，x64 | **支持** | 官方验收、CI、文档都以它为准 |
| Windows ARM64 | 不支持 | 未测试；Node 与 Electron 都能跑，但游戏与启动路径未验证 |
| Linux | **推迟，不开发** | 没有足够证据说明玩家量，也没有验收机器；见 §4 |
| macOS | **不支持** | 不做开发、不做测试、不写安装文档 |
| WSL / Wine / Proton | 不支持 | 不属于原生产品路径；用户可以自己试，工具不承诺 |

“不支持”不等于“代码里加了拦截”。core 是纯 JavaScript，理论上能在别的系统上跑；
但**没测过就不写进支持范围**，也不在文档里给安装步骤。唯一会主动报错的平台相关操作是
`launch`（只认 Windows `.exe`），返回 `E_UNSUPPORTED_PLATFORM`。

## 2. 理由

1. **目标游戏以 Windows 为主。** 当前实测的 15 款 MZ/MV 游戏全部带 Windows 启动器；
   `launch` 的契约就是“找到项目根目录里唯一的 `.exe` 并启动”。Linux/macOS 原生版
   RPG Maker 游戏不是这个形状，需要另一套发现与启动逻辑。
2. **单人 + AI 开发，验收带宽是第一约束。** 每多一个平台，就多一套路径规则、换行/权限
   差异、CI 机器和真机验收。当前连 Linux 玩家量都未探明（m13854 的决定：先不投入）。
3. **CI 已经在云端跑。** GitHub Actions 的 Windows runner 能提供真实 Windows 环境；
   本地开发机也是 Windows。加 Linux job 容易，但没有对应的产品承诺，等于制造“看起来支持”的假象。
4. **macOS 的代价最高。** 即使 core 能跑，Electron 外壳还要签名、公证、`.app` 启动，
   而目标游戏几乎没有 macOS 原生版。投入产出比最差，先明确不支持。

## 3. 对实现的硬约束

### 3.1 CI

- `.github/workflows/test.yml` 的 `runs-on` 改为 `windows-latest`，matrix 仍为 Node 22 / 24。
- 删除 `ubuntu-latest`，不保留“顺手也跑一下”的 job：没承诺的平台不占绿灯。
- 测试不得依赖 POSIX 行为：不写 `chmod` / `stat.mode` 断言，不假设路径分隔符是 `/`，
  不假设大小写敏感。
- Windows 上 `chmod 0600` 不生效（实测 `mode & 0o777` 仍是 `0o666`）。因此**任何**
  “靠文件权限保护密钥”的设计都不成立；0.10 的处理是密钥根本不落盘（见 [config.md](config.md)）。

### 3.2 配置

- 只认 `%APPDATA%\\yakusha\\config.json`；`YAKUSHA_CONFIG_DIR` 仅供测试注入目录。
- 不实现 XDG（`~/.config`）、macOS `Application Support`、`safeStorage` / Keychain。
  这些留到真有对应平台时再说；0.10 写它们只会产生无法验收的代码。
- 配置读写用 Node 的跨平台 API，但**路径规则按 Windows 写死**；非 Windows 上
  `APPDATA` 缺失时报 `E_CONFIG`，不做平台猜测。

### 3.3 启动

- `launch` 只发现项目根目录下的 `.exe`；不处理 `.app`、AppImage、Flatpak、Steam 启动项。
- 非 Windows 调用 `launch` → `E_UNSUPPORTED_PLATFORM`，消息直接说“launch is Windows-only”。
- 不实现“通过 Wine/Proton 启动”的回退：那会把“启动失败”变成一类无法复现的支持请求。

### 3.4 文本与换行

- 仓库加 `.gitattributes`：`* text=auto eol=lf`。夹具（fixture）里被 git 自动改成 CRLF
  会让差分测试随机失败。
- 游戏文件仍可能是 CRLF：`plugins.js` 重写必须保留原文件的 LF/CRLF 风格（现有能力，
  见 [design.md](design.md)），这条不因仓库用 LF 而放松。
- 源码、文档、JSON 输出统一 LF；Windows 上写文件也不要额外转 CRLF。

### 3.5 GUI（0.11 起）

- Electron 外壳只在 Windows 10/11 上验收；不写 macOS 菜单栏、不写 Linux 桌面集成。
- 拖拽路径用 `webUtils.getPathForFile`，在 Windows 上验证；不承诺其它平台。

## 4. Linux 为什么是“推迟”而不是“永不”

不是技术判断，是需求判断：目前没有可靠数据说明有多少目标玩家在 Linux 上玩这类游戏。
在需求未知时投入适配，等于用单人开发的有限时间赌一个假设。重新评估需要同时满足：

1. 有可复现的需求证据（issue、讨论、实际用户反馈），不是“理论上应该支持”；
2. 有能跑真机验收的 Linux 环境（本机 WSL 目前没装发行版，Docker 也没装）；
3. 想清楚启动路径：原生 Linux 版、Proton、还是只支持“用户自己启动、工具只装插件”。

三条都满足再写新的决策记录。0.10 不预留半成品分支，避免代码里出现“看起来支持”的死路径。

## 5. macOS 为什么是不支持

目标游戏基本没有 macOS 原生版；即使有，Electron 外壳还要签名与公证，成本远高于收益。
“core 是纯 JS，所以 macOS 能跑”是事实，但不是产品承诺。文档不写 macOS 安装步骤，
CI 不跑 macOS，issue 模板也不把 macOS 列为可选环境。

## 6. 仍然跨平台的部分

- `src/core`、`src/pipeline` 不依赖原生模块，算法本身可在 Node 支持的任何系统运行。
- 字典、插件、报告都是纯文本/JS，换平台不改变格式。
- 因此未来若要支持新平台，主要工作在外壳、路径、启动与验收，而不是重写核心。
  这也是“现在只支持 Windows”不会把路堵死的原因。

## 7. 重新评估的触发条件

| 平台 | 触发条件 |
| --- | --- |
| Linux | 有需求证据 + 有验收机器 + 启动路径定案（见 §4） |
| macOS | 出现真实的目标游戏 macOS 版需求，且愿意承担签名/公证/启动适配 |
| Windows ARM64 | 有用户实际在 ARM64 上跑，且能提供可复现的失败样本 |

任何一条触发后，先写新的平台决策记录（改本文或新增文档），再动代码与 CI。
