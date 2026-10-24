# yakusha

**非侵入式 RPG Maker 运行时翻译工具。**

把一款日语 RPG Maker MZ / MV 游戏的文本抽出来，交给任意 LLM 翻译，再让游戏在运行时
显示中文——**不改动游戏里的任何原始文件**（除了在 `js/plugins.js` 里加一行插件注册，
卸载后会逐字节还原）。

```
scan  →  extract  →  translate  →  install
看有多少  建字典      LLM 填译文    装运行时插件
```

![开场旁白](docs/screenshots/opening-narration.png)

![地图对话](docs/screenshots/dialogue-main.png)

![MV 游戏中的说话人条与多行对白](docs/screenshots/mv-dialogue-multi-line.png)

![--max-length 折行后的长句](docs/screenshots/wrapped-dialogue.png)

（第 1、2、4 张实测游戏《格闘娘はお金が無い！》，MZ 1.7.0；第 3 张实测游戏
《常識改変者のいるギルド》，MV 1.6.2。均为 DeepSeek 翻译、运行时替换，原图见
[docs/screenshots](docs/screenshots)。第 4 张是 `--max-length 54` 折行的效果：日文原句
一整行会超出窗口宽度被裁，折行后变成两行，断点落在逗号后，下一行没有以标点开头。）

## 为什么这样做

RPG Maker 的文本全部在 `data/*.json` 里：数据库条目（道具、技能、敌人名）和事件指令
（`code 401` 对白、`code 102` 选项、`code 101` 说话人……）。MZ 的 `data/` 是明文
（MV 常做 base64+XOR 混淆，本项目也能解）。

因此有两条路：

| 路线 | 做法 | 代价 |
| --- | --- | --- |
| 重打包 | 改 `data/*.json` 写回磁盘 | 破坏原游戏、更新即失效、无法回退 |
| **运行时钩子** | 挂在数据加载回调上，JSON 解析完立刻就地替换 | 磁盘零改动、卸载即还原 |

本项目走第二条。运行时插件只包装数据加载回调，覆盖数据库、地图事件、公共事件、
敌群事件全部文本面：

- **MZ**：包装 `DataManager.onXhrLoad`，MZ 所有 `data/*.json` 都经过它。
- **MV**：MV 没有 `onXhrLoad`，改为包装 `DataManager.loadDataFile` 记下 `(name, src)`，
  再包装 `DataManager.onLoad`，按**对象身份**（`window[name] === object`）认领——因为 MV
  的 XHR 是并发发起的，回调顺序不可靠，不能按到达顺序配对。

## 安装

```bash
git clone https://github.com/<you>/yakusha
cd yakusha
node --version   # 需要 22 或更高
npm test         # 133 个测试，应该全绿
```

无第三方运行时依赖。

## 四步上手

以游戏目录 `/games/MyGame` 为例。

### 1. 看看能翻译多少

```bash
node bin/yakusha.js scan "/games/MyGame"
```

```
game      : 格闘娘はお金が無い！
engine    : mz 1.7.0
data files: 51
strings   : 38044 unique / 80502 total
w/ codes  : 268
  CommonEvents.json       59085
  Map029.json             5887
  ...
```

### 2. 建字典

```bash
node bin/yakusha.js extract "/games/MyGame"
```

在 `/games/MyGame/yakusha/dictionary.json` 生成一份**空译文**的字典，每个 key 都带
它出现的位置（`Map029.json:401`、`System.json:terms.commands`……）。
重复执行会合并，不会覆盖已有译文。

### 3. 翻译

任意 OpenAI 兼容端点都能用（OpenAI、DeepSeek、OpenRouter、Ollama、LM Studio、vLLM…）。

```bash
export YAKUSHA_API_KEY=sk-...
export YAKUSHA_MODEL=deepseek-chat
export YAKUSHA_BASE_URL=https://api.deepseek.com/v1

node bin/yakusha.js translate "/games/MyGame" --concurrency 4
```

实测：DeepSeek 上 400 条 / 19 秒（并发 4、每批 40 条），3.8 万条约 30 分钟。

**流水线不信任模型。** 每条译文都要过五道校验才会写进字典：

1. 转义码（`\C[2]`、`\V[12]`、`\{`）必须与原文逐字节一致且顺序相同；
2. `%1` `%2` 占位符序列必须一致（技能/状态消息里由引擎填角色名）；
3. 换行数量必须一致（MZ 按 `\n` 原样换行）；
4. 长度比必须在 0.12x–4x 之间（挡截断和"这是翻译："这类废话）；
5. 不能含 U+FFFD。

不合格会重试一次，仍不合格就**记为未翻译并留下 error 原因**，绝不写假译文。
每 200 条自动落盘，中断可续跑。

### 4. 装进游戏

```bash
node bin/yakusha.js install "/games/MyGame"
```

做的事只有三件：

1. `js/plugins.js` 备份成 `js/plugins.js.yakusha-backup`（只备份一次）；
2. 在 `$plugins` 末尾追加一条 `YAKUSHA_Translator` 条目；
3. 写入 `js/plugins/YAKUSHA_Translator.js`。

启动游戏，中文就出来了。

```bash
node bin/yakusha.js uninstall "/games/MyGame"   # 完全还原
```

`uninstall` 会删掉插件文件、清掉 `$plugins` 里的条目，并从备份复原 `plugins.js`；
测试里验证过**逐字节一致**。

## 术语表（glossary）

人名、技能名、选项这类必须锁定一致性的词，用人工词表覆盖，不经过模型：

```bash
node bin/yakusha.js translate "/games/MyGame" --glossary my-terms.json
```

```json
{
  "entries": {
    "フェイリン": "费琳",
    "ゴブリン": "哥布林",
    "はい": "是",
    "いいえ": "否"
  }
}
```

词表命中直接写入（同样过校验），其余条目才发给模型；`--glossary-only` 则完全不联网。

实测在 38,044 条唯一串的游戏上，127 条人工词表覆盖了 **18.4% 的文本出现次数**——
术语表划算，但长尾极重（前 5000 条才覆盖 42%），**剧情的机器翻译必须跑全量**。

## 支持的游戏

已实测：

| 游戏 | 引擎 | 唯一串 | 备注 |
| --- | --- | --- | --- |
| 格闘娘はお金が無い！ | MZ 1.7.0 | 38,044 | 端到端验收用 |
| セックス実習のある島で | MZ 1.3.2 | 58,256 | |
| 桜御前 | MZ 1.7.0 | 24,757 | |
| 求生吧！无人岛性存生活♡ | MZ 1.9.0 | 8,752 | |
| [RPG]催堕的魔法使 | MZ 1.9.0 | 4,018 | |
| 误入只有雌性的精灵村… | MZ 1.5.0 | 2,295 | **`data/` 单字节 XOR 混淆** |
| 与傲娇妹妹的治愈日常 | MZ 1.8.0 | 6,797 | **游戏在改名子目录里**（`ツンデレ妹と私の癒しの日常/`） |
| An Arena RPG of Stripping | MV 1.6.1 | 10,356 | `www/` 子目录 |
| Hustle Battle Card Gamers | MV 1.6.1 | 14,945 | |
| 忧郁的安娜 | MV 1.6.1 | 159 | |
| The Demon King's Reclusive Strategist | MV 1.6.2 | 19,890 | |
| 一次性交易大师 | MV 1.6.2 | 36,203 | **`data/www/` 浏览器构建** |
| 魔法少女コノハv2.04 | MV 1.6.2 | 26,240 | 453 个 data 文件 |
| 常識改変者のいるギルド | MV 1.6.2 | 4,388 | **MV 端到端验收用**（全量翻译 + 运行时截图） |
| 用时间停止肆意妄为 | MV 1.6.2 | 4,065 | 正文已中文、说话人标记是日文 |

上表 15 款即为本机全量普查结果：MZ 跨 1.3.2–1.9.0、MV 跨 1.6.1–1.6.2，单款 data 文件
从 27 个到 453 个，合计 259,165 条唯一串 / 475,001 次出现，`undecodable` 全程为 0。
`install`/`uninstall` 在其中 6 款上做过往返验证，`plugins.js` 均逐字节还原。

**游戏根目录不必正好指对。** 分发出来的游戏布局五花八门：有的外面套一层 `www/`
（MV 常见），有的把真正的游戏放进一个改名子目录，还有的额外带一份 `data/www/`
浏览器构建。`findProjectRoot` 会从你给的目录往下**有界搜索**（最多 3 层，跳过
`node_modules`、`img`、`audio` 这类资源目录），找到最浅的那一个；如果同一层有两个
游戏，它会报错并列出候选，而不是随便挑一个。

**加密的 `data/`**：有些 MZ 游戏把 JSON 单字节 XOR 掉了（每文件一个 key，键值由
`libGLESv2.dll` 的 sha256 推出来）。`src/core/datafile.js` 的做法是：先按明文试，
失败后**穷举 256 个单字节 key**，只有真的能 `JSON.parse` 且以 `[`/`{` 开头才接受；
解不出的文件不会静默跳过，会进 `undecodable` 列表并在 `scan` 里报出来。
0 字节的占位文件（有些游戏会留一个空的 `结果.json`）算 `empty` 而不算 `undecodable`，
因为它本来就没有文本可丢。

不支持的：XP/VX/VX Ace（`.rxdata` 二进制）、Unity/Godot/Kirikiri/Ren'Py 等其它引擎。

## 文本面覆盖

| 位置 | 内容 |
| --- | --- |
| `Actors.json` | name、nickname、profile |
| `Classes/Skills/Items/Weapons/Armors/Enemies/States/Tilesets` | name、description、message1..4 |
| `CommonEvents.json` | 名称 + 全部事件指令 |
| `Troops.json` | 全部事件指令 |
| `MapInfos.json` | 地图名 |
| `MapNNN.json` | displayName + 全部事件指令 |
| `System.json` | gameTitle、currencyUnit、terms.basic/commands/params/messages、各类类型名 |
| 事件指令 | `101`(说话人)、`401`(对白)、`102`(选项数组)、`105`/`405`(滚动文本)、`320`/`324`/`325`(改名/称号) |

不翻译：插件指令（`355`/`655`）、脚本（`355` 的 JS 体）、`note` 字段（插件数据）。

## 转义码

MZ 的文本里混着反斜杠转义，翻译时**一个都不能动**：

```
\C[n]  换文字颜色     \V[n]  取变量值      \N[n]  角色名
\P[n]  队员名         \G     货币单位      \I[n]  图标
\FS[n] 字号           \{ \}  放大/缩小     \> \< 瞬间显示
\! \| \. 停顿          \^     跳过等待      \$     显示窗口
```

这些码在引擎里会被 `convertEscapeCharacters` 替换掉，所以**译文必须原样保留它们**。
`src/core/textkey.js` 把文本切成"文字片段 / 转义码片段"两类 token，提取、校验、运行时
查表三处用同一套逻辑，保证字典 key 在离线与运行时完全一致（有 `rules-sync` 测试守着）。

## 作为库用

```js
import { openProject } from "./src/core/mzproject.js";
import { extractProject } from "./src/core/extract.js";
import { loadDictionary, dictionaryPath } from "./src/core/dict.js";
import { createProvider } from "./src/pipeline/provider.js";
import { translateDictionary } from "./src/pipeline/translate.js";

const project = openProject("/games/MyGame");
const dict = loadDictionary(dictionaryPath(project.root));

const result = await translateDictionary(dict, {
  provider: createProvider("openai", { model: "deepseek-chat" }),
  concurrency: 4,
  onProgress: (p) => console.log(p.done + "/" + p.total),
});
console.log(result.translated + " translated, " + result.rejected.length + " rejected");
```

## 命令一览

```
yakusha <command> <game-dir> [options]

  scan        报告可翻译的量
  extract     建/刷新 yakusha/dictionary.json
  status      查看翻译进度
  translate   调 LLM 填字典
  install     装运行时插件
  uninstall   卸载并还原

translate:
  --provider <name>   openai（默认）或 mock
  --model <name>      模型 id
  --base-url <url>    OpenAI 兼容端点
  --api-key <key>     API key
  --glossary <file>   术语表 JSON
  --limit <n>         最多翻 n 条
  --context <text>    只翻位置含该文本的条目（如 Map029）
  --batch-size <n>    每请求条数（默认 40）
  --char-budget <n>   每请求字符上限（默认 6000）
  --concurrency <n>   并发数（默认 2）
  --save-every <n>    每 n 条落盘一次（默认 200）
  --max-length <n>    把超过 n 显示列的译文自动换行（0 = 关闭，默认 0）
  --no-rewrap         不动已经翻好的条目（默认会按新宽度重新折行）
  --dry-run           用 mock provider 且不落盘
  --glossary-only     只应用术语表，不联网

install:
  --embed             把译文嵌进插件文件（离线分发用）

  --json              机器可读输出
```

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `YAKUSHA_API_KEY` | API key（回退到 `OPENAI_API_KEY`） |
| `YAKUSHA_MODEL` | 模型 id（默认 `gpt-4o-mini`） |
| `YAKUSHA_BASE_URL` | 端点（默认 `https://api.openai.com/v1`） |

## 目录结构

```
bin/yakusha.js            CLI，六个命令
src/core/textkey.js      转义码分词 / 归一化 / 校验
src/core/datafile.js     数据文件解码（明文 / 单字节 XOR / 空白占位）
src/core/mzproject.js    项目发现（向下 3 层搜索）、System.json 读取
src/core/fields.js       字段表与指令表（纯数据，会嵌进插件）
src/core/extract.js      遍历 data/ 抽出所有可译文本
src/core/dict.js         字典读写
src/core/pluginsfile.js  js/plugins.js 解析与重写（保留 RPG Maker 布局）
src/core/install.js      安装 / 卸载
src/pipeline/provider.js OpenAI 兼容 + mock provider
src/pipeline/translate.js 批处理、校验、重试、术语表
src/pipeline/wrap.js     按显示宽度折行（MZ/MV 不会横向自动换行）
src/plugin/YAKUSHA_Translator.js  运行时插件模板（install 时注入规则表）
test/                    133 个测试（含 CLI 端到端）
```

## 设计约束

- **磁盘零改动**：只加一个插件文件 + 一行注册，卸载逐字节还原。
- **字典 key = 原文**：不做语言检测、不改写原文，hash 之类的方案会让译文无法人工校对。
- **校验在写之前**：宁可留原文，也不留一条会显示成乱码的译文。
- **规则单一来源**：`src/core/fields.js` 是唯一真源，插件里的 `RULES` 由 `install` 生成，
  `test/rules-sync.test.js` 会在两者漂移时报错。
- **离线可用**：`--dry-run` 和 `--glossary-only` 完全不联网，整套流水线可在无 key 环境验证。

## 已知限制

- 只处理 `data/` 里的文本；插件 `js/plugins/*.js` 里硬编码的 UI 文案不动。
- 图片里的文字（`img/pictures`）不处理。
- MV 的 `.rpgmvp` 加密图不影响文本，但 MV 的 `data/` 若用了别的混淆方案可能解不出（会报 `undecodable`）。
- **MZ/MV 不会横向自动换行。** `Window_Base.flushTextState` 把整行一次性 `drawText` 到位图，
  超出 `contents` 宽度的部分直接被裁（只有纵向有 `needsNewPage` 分页）。默认仍以 prompt 里
  的"保持紧凑"约束为主，需要硬保证时加 `--max-length 54`：它按显示列宽（全角算 2 列）在标点处
  断行，转义码宽度算 0、不会被拆开；断点落在标点前时会把标点提到上一行（禁则处理），
  避免"！？"被拆到两行。这个折行发生在`校验通过之后`，所以模型输出仍然逐字比对。
  对已经翻完的字典重复执行同一条命令即可把旧译文也重新折行（本地计算，不重新请求模型）；
  不想动旧条目就加 `--no-rewrap`。
- **MV 老版本（2019/2020 的 nw.js）不吃 `--remote-debugging-port`**，所以 MV 的运行时
  验证不能靠 CDP；本项目验收时用的是临时注入的截图驱动脚本（`SceneManager.snap()`
  → `Bitmap._canvas.toDataURL()`），验完即删，不入库、不随工具分发。
- 有些 MV 游戏把说话人写成 `\N<名字>` 这种插件自定义标记（不是 RPG Maker 转义码），
  译文必须原样保留；`validateTranslation` 会把这类标记剥掉后判断"是否真的还有日文"，
  否则「正文已中文、只有名字是日文」的行会被误判成未翻译而永久拒收。

## 许可

GPL-3.0-or-later，见 [LICENSE](LICENSE)。

本项目**不含任何游戏内容**，也不分发译文；字典与译文由使用者自行生成，版权归原游戏权利方所有。
请只对自己合法拥有的游戏使用。
