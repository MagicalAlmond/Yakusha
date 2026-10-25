# yakusha

**非侵入式 RPG Maker 运行时翻译工具。**

把 RPG Maker MZ / MV 游戏的文本抽出来交给任意 LLM 翻译，再让游戏**在运行时**显示中文。
磁盘上只多一个插件文件、`js/plugins.js` 里多一行注册；`uninstall` 会把它逐字节还原。

```
scan  →  extract  →  translate  →  install
看有多少   建字典      LLM 填译文    装运行时插件
```

![地图对话](docs/screenshots/dialogue-main.png)

![桜御前的地图实时对白与立绘](docs/screenshots/sakura-dialogue-cn.png)

（实测游戏《格闘娘はお金が無い！》《桜御前》，均为 MZ 1.7.0、运行时替换，原图见
[docs/screenshots](docs/screenshots)。支持范围与实测数据见 [docs/games.md](docs/games.md)。）

## 安装

```bash
git clone https://github.com/<you>/yakusha
cd yakusha
node --version   # 需要 22 或更高
npm test         # 253 个测试，应该全绿
```

无第三方运行时依赖。

## 五步上手

以游戏目录 `/games/MyGame` 为例。

### 1. scan：看有多少文本

```bash
node bin/yakusha.js scan "/games/MyGame"
```

```
game      : 格闘娘はお金が無い！
engine    : mz 1.7.0
data files: 51
strings   : 38044 unique / 80502 total
```

### 2. extract：建字典

```bash
node bin/yakusha.js extract "/games/MyGame"
```

在 `/games/MyGame/yakusha/dictionary.json` 生成一份**空译文**的字典，每个 key 都带它出现的
位置（`Map029.json:401`、`System.json:terms.commands`……）。重复执行会合并，不覆盖已有译文。

### 3. translate：翻译

任意 OpenAI 兼容端点都能用（OpenAI、DeepSeek、OpenRouter、Ollama、LM Studio、vLLM…）。

```bash
export YAKUSHA_API_KEY=sk-...
export YAKUSHA_MODEL=deepseek-chat
export YAKUSHA_BASE_URL=https://api.deepseek.com/v1

node bin/yakusha.js translate "/games/MyGame" --concurrency 4
```

实测：DeepSeek 上 400 条 / 19 秒（并发 4、每批 40 条），3.8 万条约 30 分钟。

**流水线不信任模型。** 每条译文都要过五道校验才会写进字典：转义码序列、`%1` 占位符、
换行数、长度比（0.12x–4x）、`U+FFFD`。不合格会重试一次，仍不合格就**记为未翻译并留下
error 原因**，绝不写假译文。每 200 条自动落盘，中断可续跑。

### 4. install：装进游戏

```bash
node bin/yakusha.js install "/games/MyGame"
```

只做三件事：备份 `js/plugins.js`、在 `$plugins` 末尾加一条 `YAKUSHA_Translator`、写入
`js/plugins/YAKUSHA_Translator.js`。启动游戏，中文就出来了。

```bash
node bin/yakusha.js uninstall "/games/MyGame"   # 完全还原
```

装好之后如果 `plugins.js` 又被改过（游戏更新、另装插件、编辑器存过档），`uninstall`
**不会**拿旧备份盖掉这些改动，只摘掉自己那条、把备份留在原地给你核对。
细节见 [docs/design.md](docs/design.md)。

### 5. verify / doctor：自检

```bash
node bin/yakusha.js verify "/games/MyGame"
```

字典会被逐条体检，只读不写。`error` 让命令失败退出（`echo`、转义码、占位符、说话人名），
`warn` 只提示（残留假名、超宽行、繁体字、被拒条目）。`--write-report report.md` 把全部
问题写成一份可贴进 issue 的 markdown。

游戏更新后中文没了，先跑 `doctor` 分清是插件条目丢了、备份对不上，还是字典与这版
`data/` 脱节：

```bash
node bin/yakusha.js doctor "/games/MyGame"
```

```
  install     ok    js/plugins/YAKUSHA_Translator.js registered in js/plugins.js
  sync        ok    every dictionary key still appears in data/
  runtime     ok    yakusha/dictionary.json (found)
verdict   : usable with 2 warning(s)
```

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `scan` | 报告可翻译的量 |
| `extract` | 建/刷新 `yakusha/dictionary.json` |
| `status` | 查看翻译进度 |
| `translate` | 调 LLM 填字典 |
| `verify` | 体检字典（发布前自检） |
| `speaker` | 按本作自己的写法修复说话人名 |
| `terms` | 挖人名/术语的主流译法，报出漂移 |
| `install` | 装运行时插件 |
| `uninstall` | 卸载并还原 |
| `doctor` | 查安装、备份、字典是否还与这版游戏对得上 |

完整选项、判据、实测见 [docs/commands.md](docs/commands.md)。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `YAKUSHA_API_KEY` | API key（回退到 `OPENAI_API_KEY`） |
| `YAKUSHA_MODEL` | 模型 id（默认 `gpt-4o-mini`） |
| `YAKUSHA_BASE_URL` | 端点（默认 `https://api.openai.com/v1`） |

## 目录结构

```
bin/yakusha.js            CLI，十个命令
src/core/                项目发现、数据解码、文本抽取、字典、安装、doctor
src/pipeline/            provider、批处理、校验、折行、verify、terms、speaker、报告
src/plugin/              运行时插件模板
test/                    253 个测试（含 CLI 端到端）
docs/                    设计说明、命令参考、实测记录、已知限制、DEVLOG
```

## 已知限制

- 只处理 `data/` 里的文本：插件 `js/plugins/*.js` 里硬编码的 UI 文案、图片里的文字不处理。
- 只支持 RPG Maker **MZ / MV**。XP/VX/VX Ace（`.rxdata` 二进制）、Unity、Godot、Kirikiri、
  Ren'Py 等其它引擎不在范围内。
- 图片文字、插件自定义的说话人容器（`\N<名字>` 之外）看不到。
- `verify` 只查结构性缺陷，译文风格与剧情上下文它判断不了。

完整清单见 [docs/limitations.md](docs/limitations.md)。

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/commands.md](docs/commands.md) | 十个命令的完整选项、`verify` 十类判据、`terms`/`speaker` 算法说明 |
| [docs/design.md](docs/design.md) | 为什么走运行时钩子、文本面覆盖、转义码、设计约束、作为库用 |
| [docs/games.md](docs/games.md) | 已实测的 15 款游戏、全量翻译记录、官中游戏的处理方式 |
| [docs/limitations.md](docs/limitations.md) | 已知限制全表 |
| [docs/DEVLOG.md](docs/DEVLOG.md) | 内部开发日志（阶段、决策、实测、教训） |

## 许可

GPL-3.0-or-later，见 [LICENSE](LICENSE)。

本项目**不含任何游戏内容**，也不分发译文；字典与译文由使用者自行生成，版权归原游戏权利方所有。
请只对自己合法拥有的游戏使用。
