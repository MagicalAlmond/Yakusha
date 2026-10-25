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

![桜御前的章节选择，选项已译成中文](docs/screenshots/sakura-choices-cn.png)

![桜御前的地图实时对白与立绘](docs/screenshots/sakura-dialogue-cn.png)

（第 1、2、4 张实测游戏《格闘娘はお金が無い！》，MZ 1.7.0；第 3 张实测游戏
《常識改変者のいるギルド》，MV 1.6.2；第 5、6 张实测游戏《桜御前》，MZ 1.7.0，
该作装了 133 个插件、1280×720。均为 DeepSeek 翻译、运行时替换，原图见
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
npm test         # 229 个测试，应该全绿
```

无第三方运行时依赖。

## 上手步骤

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

如果装好之后 `plugins.js` 又被改过（游戏更新、你另装了别的插件、在 RPG Maker 编辑器里
存过档），`uninstall` 不会拿旧备份盖掉这些改动：它只删掉 `YAKUSHA_Translator` 那一条，
把 `js/plugins.js.yakusha-backup` 留在原地给你核对，并打印一行提示。`install` 也会在发现备份
已经对不上时先说明这一点。

### 5. 挖出人名/术语的主流译法

```bash
node bin/yakusha.js terms "/games/MyGame"
```

字典里 `Actors.json:name` 这类名字条目只有几百个，但它们在正文里被提到几千次。这条
命令把正文里**实际在用的译法**统计出来，和名字条目比对：对不上就叫 drift。

真实案例（38,044 条的游戏）：名字表写的是「フェイリン → 费琳」，但提到她的 3,653 行里
**96% 写的是「菲琳」**，只有 4% 用名字表的写法。这不是算法挑剔，是名字表本身错了。

| 状态 | 含义 |
| --- | --- |
| `ok` | 正文用法与名字条目一致 |
| `drift` | 正文的主流译法与名字条目不同，且主流占比达到 `--min-support` 并领先 20% 以上 |
| `missing` | 名字条目还没翻译，但正文里已经有稳定译法（官方中文游戏常见） |

```bash
node bin/yakusha.js terms "/games/MyGame" --status drift --limit 50    # 只看对不上的
node bin/yakusha.js terms "/games/MyGame" --drift-only --write yakusha/terms.json
node bin/yakusha.js translate "/games/MyGame" --glossary yakusha/terms.json --glossary-only --overwrite
```

上面三行是**一条完整的修复回路**：挖出漂移 → 存成词表 → 覆盖回去。第三步必须带
`--overwrite`，因为漂移条目本身就是「已经翻译过」的条目，默认的词表应用只补空缺。

判据（改之前先读 `src/pipeline/terms.js` 顶部注释）：

- **候选必须是 2 字以上的中文连续串**，取字频最高者的 90% 以内**最长**的那个。只取最高频
  会切出碎片：`哥布林` 的每个子串出现次数都一样多，纯频次会选中 `哥布`。
- **候选首字不能是中文虚词**（的、了、在、把等）。这是 `丰满的胸部` 变出 `的胸部`
  这种假漂移的根源。`向` 刻意没进黑名单：它既是助词，也是真名字的首字（向阳处）。
- **源名是假名且超过 4 个字符的，当散文跳过**。`激しくピストン` 这类短语被游戏填在名字
  字段里，给它算「主流译法」没有意义。
- **互为子串不算漂移**（`哥布` 与 `哥布林` 是同一个译法的长短形式），只建议取更长的那个。

实测四款游戏：格闘娘 `names 510/612, mined 52, drift 5`；常識改変者 `156/215, 20, 2`；
用时间停止 `145/148, 6, 0`；与傲娇妹妹 `45/45, 3, 0, missing 3`（官方中文，名字表反而缺）。

### 6. 发布前自检

```bash
node bin/yakusha.js verify "/games/MyGame"
```

字典会被逐条体检，只读不写。问题分两档：`error` 会让命令以失败退出（
`--json` 里 `ok:false`），`warn` 只提示、退出码仍是 0。

| 类型 | 档位 | 含义 |
| --- | --- | --- |
| `echo` | error | 译文与日文原文完全相同（模型原样回显） |
| `codes` | error | 转义码与原文不一致 |
| `slots` | error | `%1` `%2` 占位符被丢弃或改名 |
| `kana` | warn | 译文里还残留假名（多为拟声词里的 `ッ`） |
| `lines` | warn | 换行数与原文不同（`--max-length` 会主动改写） |
| `width` | warn | 单行超过 `--max-length` 指定的列数 |
| `no-text` | warn | 原文有汉字、译文一个汉字都没有（词被吃掉了） |
| `trad` | warn | 译文里混进了原文没有的繁体字（模型偶发切到繁体） |
| `speaker` | error / warn | 说话人标记 `\N<名字>` 的内容没翻（error）或同一名字有多种写法（warn） |
| `rejected` | warn | 流水线放弃的条目，运行时显示原文 |

```bash
node bin/yakusha.js verify "/games/MyGame" --max-length 48      # 顺带查超宽行
node bin/yakusha.js verify "/games/MyGame" --kind echo,codes    # 只看致命项
node bin/yakusha.js verify "/games/MyGame" --json --limit 500   # 机器可读，全量列出
node bin/yakusha.js verify "/games/MyGame" --write-report verify.md  # 写一份 markdown 报告
```

终端只适合边改边看：192 条警告滚过去就没法对照了。`--write-report` 把同样的结果写成
一份自包含的 markdown——摘要表、按类型分节、每条问题的原文与译文，可以直接贴进 issue，
也可以存档对比两个版本。命令失败时同样会写，因为那正是需要读它的时候。

```markdown
| entries | 38044 (38042 translated, 2 pending, 2 rejected) |
| problems | 192 (0 errors, 192 warnings) |

**OK with 192 warning(s)** - nothing blocks a release.

## kana (106)
1. warning: `ラスボス敗北時(通常)(テ)` -> `最终BOSS败北时(通常)(テ)`
   Japanese kana left in the translation
```

报告里换行显示为 `⏎`，否则一条多行台词会和两条问题混在一起。

判据是踩过坑之后定下来的，改之前请先读 `src/pipeline/verify.js` 顶部的注释：
`・`（U+30FB）和 `ー`（U+30FC）**不算**假名（它们在中译文里是正常标点，早期版本
把 `睡眠・沈黙` 判成未翻译，是最大的假阳性来源）；`MAP001`、`ＨＰ` 这类必须原样保留
的标签不会被报；整行拟声词（`ッ…♡♡♡`）不会被要求出现汉字。

`trad` 只报**原文里没有的**繁体字。日文原文本来就大量使用繁体形汉字（`愛`、`動`、
`書`、`員`、`婦`），把它们算成泄漏会让每一行都命中；比对源文本后就只剩模型自己
新引入的那些。字表来自 OpenCC 的 TSCharacters（Apache-2.0），只收「一繁对一简且不同」
的行——`乾`、`藉`、`於`、`瞭`、`徵` 这些在简体里也是合法写法的多目标字必须排除，
否则全是假阳性。

`speaker` 针对 MV 插件把 `\N<名字>` 渲染成独立姓名窗的那类游戏（标记内容原样显示
给玩家）。三条判级：

- 名字含假名，但**同一游戏别处翻过这个名字** → error（玩家会看到一个日文名混在中文里）
- 名字全汉字且与源相同，但含繁体专用字（`水泳部員`、`主婦`、`運転手`）→ error
  （仍是日文；`少女`、`入浴女性` 两语同形，不含这类字，不会报）
- 同一源名出现多种非假名写法 → warn（译名漂移）

尖括号里放代码表达式的游戏（`<50*\v[65]>`、`<\s[25] ? " OFF ":" ON " >`）不会被
误认成名字：标记内容必须是纯中文/假名/空白才算。

### 7. 修掉没翻的说话人名

`verify` 只报不修，而「同一角色的名字在别处翻过、这一行还留日文」这种问题的正确答案
**已经在这个字典里**（用了 490 次的那个写法），不该再问模型一次：

```bash
node bin/yakusha.js speaker "/games/MyGame"               # 按本作自己用得最多的写法统一
node bin/yakusha.js speaker "/games/MyGame" --dry-run     # 只看会改什么
node bin/yakusha.js speaker "/games/MyGame" --include-drift
```

默认只改两类，都是「这一行没翻，别处翻过」：
没翻的假名（`ひなた` → `日向`）和原样照抄的汉字名（`主婦` → `主妇`）。
两种不同的中文写法属于风格选择（`沙耶香` vs `沙耶加`），要显式 `--include-drift` 才统一。

房规的取法有一条关键规则：**真正的译文优先于「原样照抄的源名」**，同层再比出现次数，
平票取非假名。否则 `先生`（既是「老师」也是日语称谓）、`主婦` 这类名字会让「留日文」
以票数取胜，反过来把正确的中文译文报成漂移。

有些名字在这款游戏里**一次都没翻过**，字典里没有可抄的写法，机械修复帮不上忙。
`speaker` 会把它们点出来，用一份一行的映射表补上：

```bash
node bin/yakusha.js speaker "/games/MyGame" --names my-names.json
```

```json
{ "entries": { "水泳部員": "游泳社员" } }
```

名字多的时候不用手抄：`--write-names` 会把它挑出来的名字（只含本作一次都没翻过、
机械修复帮不上的那些）写成一个空模板，填空后再用 `--names` 传回去。

```bash
node bin/yakusha.js speaker "/games/MyGame" --write-names names.json
# 编辑 names.json，把每个名字的中文填进 value
node bin/yakusha.js speaker "/games/MyGame" --names names.json
```

实测《用时间停止肆意妄为》（MV）：`verify` 报 411 个 speaker error，`speaker` 一次改掉
414 条（23 个名字），剩 3 条是全文未译的 `水泳部員`，`--names` 补上后 error 归零；
再用 `--include-drift` 把 `雏田`/`雏田爸爸`/`雏田妈妈`/`沙耶加` 等 8 个名字统一到主流写法，
warn 也从 51 归零。两轮都只改字典，不调用模型。

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

手工词表之外，`terms` 能从字典自身挖出术语表（见第 5 步），格式与这里完全一致，可以直接当
`--glossary` 用。

实测在 38,044 条唯一串的游戏上，127 条人工词表覆盖了 **18.4% 的文本出现次数**——
术语表划算，但长尾极重（前 5000 条才覆盖 42%），**剧情的机器翻译必须跑全量**。

## 支持的游戏

已实测：

| 游戏 | 引擎 | 唯一串 | 备注 |
| --- | --- | --- | --- |
| 格闘娘はお金が無い！ | MZ 1.7.0 | 38,044 | 端到端验收用 |
| セックス実習のある島で | MZ 1.3.2 | 58,256 | |
| 桜御前 | MZ 1.7.0 | 24,757 | **全量翻译 + 运行时验收**；133 个插件共存 |
| 求生吧！无人岛性存生活♡ | MZ 1.9.0 | 8,752 | |
| [RPG]催堕的魔法使 | MZ 1.9.0 | 4,018 | |
| 误入只有雌性的精灵村… | MZ 1.5.0 | 2,295 | **`data/` 单字节 XOR 混淆**；插件在 XOR 游戏上实测可运行 |
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
`install`/`uninstall` 在其中 7 款上做过往返验证，`plugins.js` 均逐字节还原。

其中 **4 款跑完过一次全量翻译**（合计 71,254 条唯一串），并在真实游戏里截图确认中文
出现在对话框里：

| 游戏 | 引擎 | 唯一串 | 译完 | `verify` 的 error |
| --- | --- | --- | --- | --- |
| 格闘娘はお金が無い！ | MZ 1.7.0 | 38,044 | 38,042 | 0 |
| 桜御前 | MZ 1.7.0 | 24,757 | 24,735 | 0 |
| 常識改変者のいるギルド | MV 1.6.2 | 4,388 | 4,387 | 0 |
| 用时间停止肆意妄为 | MV 1.6.2 | 4,065 | 4,064 | 0 |

剩下的 2 / 22 / 1 / 1 条是校验主动拒收的（全角空格、纯拟声词里保留的「ッ」、
`\N<ひなた>` 这种只有假名人名的行），运行时插件对它们回退显示原文——宁可留一句日文，
也不留一句可能错位的译文。

**游戏根目录不必正好指对。** 分发出来的游戏布局五花八门：有的外面套一层 `www/`
（MV 常见），有的把真正的游戏放进一个改名子目录，还有的额外带一份 `data/www/`
浏览器构建。`findProjectRoot` 会从你给的目录往下**有界搜索**（最多 3 层，跳过
`node_modules`、`img`、`audio` 这类资源目录），找到最浅的那一个；如果同一层有两个
游戏，它会报错并列出候选，而不是随便挑一个。

**已经是目标语言的游戏不必全量翻。** 官方中文版里绝大多数条目本来就该原样留着，
送进模型既费 token 又可能被改写（本机两款官中游戏里不含假名的条目分别是
6,788/6,797 与 3,994/4,018，抽样看过去基本都是现成的中文）。本项目**不做自动语言检测**——实测
"没有假名"这一条判不出来：日文原版那款里 437 条无假名条目就有「武闘家」「騎士」「鎧系」
「盾系」这类纯汉字日文，用日文特有汉字集合加严后仍会误跳过 64% 的日文条目。误跳过
意味着玩家直接看到日文，代价远高于多花的那点 token。所以流程是：全量跑，模型对已经是
中文的句子会原样回显，随后的"原样回显"闸门把它拒收（记 `error`、保持未翻译），
不会写进错误译文；想省钱就先用 `--limit` 抽样，看 `status` 的拒绝率再决定。

抽样判断的具体做法（以官方中文游戏为例）：

```bash
node bin/yakusha.js extract "/games/SomeGame"
node bin/yakusha.js translate "/games/SomeGame" --limit 200     # 只翻 200 条
node bin/yakusha.js status "/games/SomeGame"
```

`status` 里的 `withError` 绝大多数就是"原样回显被拒"的条目。**拒绝率高说明这款游戏
本来就是中文**——全量跑只会白花 token 并把每一条都记成 `error`，此时直接
`install` 装插件即可（插件对没翻的条目回退原文，玩家看到的就是官中原文）。
拒绝率低则说明是日文原版，再跑全量。

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
  verify      体检字典（发布前自检）
  speaker     按本作自己的写法修复说话人名
  terms       挖人名/术语的主流译法，报出漂移
  install     装运行时插件
  uninstall   卸载并还原

translate:
  --provider <name>   openai（默认）或 mock
  --model <name>      模型 id
  --base-url <url>    OpenAI 兼容端点
  --api-key <key>     API key
  --glossary <file>   术语表 JSON
  --limit <n>         最多翻 n 条
  --context <text>    只翻位置含该文本的条目（如 Map029）；可重复，任一命中即选
  --batch-size <n>    每请求条数（默认 40）
  --char-budget <n>   每请求字符上限（默认 6000）
  --concurrency <n>   并发数（默认 2）
  --save-every <n>    每 n 条落盘一次（默认 200）
  --max-length <n>    把超过 n 显示列的译文自动换行（0 = 关闭，默认 0）
  --no-rewrap         不动已经翻好的条目（默认会按新宽度重新折行）
  --dry-run           用 mock provider 且不落盘
  --glossary-only     只应用术语表，不联网
  --overwrite         允许术语表覆盖已经翻好的条目

verify:
  --kind <list>       只报这些类型，逗号分隔
                      （kana / echo / codes / slots / lines / width / no-text / trad / speaker / rejected）
  --max-length <n>    同时检查超过 n 显示列的行
  --limit <n>         最多打印多少条（默认 20）
  --write-report <f>  把全部问题写成一份 markdown 报告

speaker:
  --include-drift     连中文写法不一致的也统一（默认只修没翻的）
  --names <file>      给本作从没翻过的名字补一份映射表
  --write-names <f>   把这些名字写成待填的 JSON 模板
  --dry-run           只报会改什么，不落盘
  --limit <n>         最多打印多少个名字（默认 20）

terms:
  --status <list>     只列这些状态（ok / drift / missing）
  --min-holders <n>   名字要被提到多少次才挖（默认 5）
  --min-support <n>   主流译法的最低占比（默认 0.5）
  --drift-only        只写对不上的条目
  --max-terms <n>     术语表条数上限（0 = 全部）
  --limit <n>         最多打印多少条（默认 20）
  --write <file>      存成术语表，可直接给 translate --glossary
  --dry-run           只报会写什么，不落盘

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
bin/yakusha.js            CLI，九个命令
src/core/textkey.js      转义码分词 / 归一化 / 校验
src/core/datafile.js     数据文件解码（明文 / 单字节 XOR / 空白占位）
src/core/mzproject.js    项目发现（向下 3 层搜索）、System.json 读取
src/core/fields.js       字段表与指令表（纯数据，会嵌进插件）
src/core/extract.js      遍历 data/ 抽出所有可译文本
src/core/dict.js         字典读写
src/core/pluginsfile.js  js/plugins.js 解析与重写（保留尾逗号与换行风格）
src/core/install.js      安装 / 卸载
src/pipeline/provider.js OpenAI 兼容 + mock provider
src/pipeline/translate.js 批处理、校验、重试、术语表
src/pipeline/wrap.js     按显示宽度折行（MZ/MV 不会横向自动换行）
src/pipeline/verify.js   译文体检（残留假名 / 原样回显 / 转义码 / 占位符 / 超宽行 / 繁体 / 说话人）
src/pipeline/terms.js    名字/术语的主流译法挖掘与漂移检测
src/pipeline/speaker.js  说话人标记的识别与按房规修复
src/pipeline/report.js   verify 结果的 markdown 报告
src/data/traditional.js  繁体专用字表（OpenCC TSCharacters，一繁对一简）
src/plugin/YAKUSHA_Translator.js  运行时插件模板（install 时注入规则表）
test/                    239 个测试（含 CLI 端到端）
```

## 设计约束

- **磁盘零改动**：只加一个插件文件 + 一行注册，卸载逐字节还原。重写 `plugins.js` 时会记住原文件
  是否带尾逗号、用 LF 还是 CRLF，免得一次安装把整份文件变成全文件 diff。
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
  实测 4 款跑完全量翻译的游戏，**没有任何一行超出窗口**（桜御前最长 84 列 < 预算 104 列，
  格闘娘 54 < 82，两款 MV 都是 52 < 82）——模型输出的中文天然比日文短约 28%，所以
  `--max-length` 是"需要硬保证时"的保险，不是每次都该开的默认值。
- **MV 老版本（2019/2020 的 nw.js）不吃 `--remote-debugging-port`**，所以 MV 的运行时
  验证不能靠 CDP；本项目验收时用的是临时注入的截图驱动脚本（`SceneManager.snap()`
  → `Bitmap._canvas.toDataURL()`），验完即删，不入库、不随工具分发。
- 有些 MV 游戏把说话人写成 `\N<名字>` 这种插件自定义标记（不是 RPG Maker 转义码），
  译文必须原样保留；`validateTranslation` 会把这类标记剥掉后判断"是否真的还有日文"，
  否则「正文已中文、只有名字是日文」的行会被误判成未翻译而永久拒收。标记内容会原样
  显示在姓名窗里，所以它是否翻、翻了用哪种写法，由 `verify --kind speaker` 单独检查。
- **`verify` 的 `trad` 只查单个字符是否属于繁体专用字**，不判断词组级用法
  （`干`/`乾` 这类两语都合法的字已在字表里排除）。它抓的是模型偶发切到繁体
  的那几十行，不是繁简风格的统一性。
- **`terms` 只认名字字段**：数据库 `name` 字段里没有的东西（UI 词、技能描述里的术语、
  正文地名）挖不出来。这是有意的——没有名字当锚点，任意中文串的统计没有可判定的正确答案。
- **`terms` 报的是「正文主流译法」，不是「正确译法」**。实测里 `噴水 喷水→喷泉`、
  `ジョッキ 大杯→精液` 属于语义变化而非算法碎片（译文里确实这么写），要不要采纳得人看一眼。
  所以 `terms --write` 只是建议，落盘还得自己再跑一次 `--glossary-only --overwrite`。
- **`translate` 不会整张术语表塞进每个请求**：按该请求的条目做字面匹配过滤（实测每请求
  只剩 3–4 条，prompt 里术语表的占比从 693 字降到 47 字）。代价是**上下文相关的术语**
  （只在某个场景里出现的词）不会出现在别的场景的请求里——词表本身要表达的是固定译法，
  这通常是想要的。词表上千条时仍建议用 `terms --max-terms` 截断。
- **`speaker` 只认 `\N<名字>` 这一种标记形态**（MV 的 `Lunatlazur_ActorNameWindow` 风格）。
  别的插件把名字放在别处（独立窗口参数、JSON 配置、插件参数里的 UI 词典）它看不到；
  那类文本目前整套工具都不处理。
- **`speaker` 的房规来自这份字典自己的统计**：它只会把写法统一到本作**已经在用**的那一种，
  不会判断哪个译名更好。一款游戏从头到尾没翻过某个名字时，字典里没有可抄的写法，
  机械修复帮不上忙，得用 `--names` 人工补一行。`--include-drift` 会改写已有的中文译文
  （比如把 38 条 `雏田` 改成 `日向`），跑之前先看一眼 `--dry-run` 的输出。
- **`verify` 只查字典能查的东西**：译文风格、和剧情上下文是否吻合，这些它看不出来；
  它只保证没有结构性缺陷（原样回显、转义码损坏、占位符丢失、超宽行、繁体字混入、
  说话人名漏译）。
  人名一致性有一部分交给 `terms`（见第 5 步），但 `terms` 也只统计、不判断对错。
  实测在四款跑完的游戏上，`echo`/`codes`/`slots` 三类致命项**都是 0**，
  留下的 `kana` 全是拟声词里故意保留的 `ッ`（格闘娘 106 条，占 0.28%）。
  `trad` 命中 23 / 56 / 0 / 0 条（0.02%–0.28%），`speaker` 只在装了 `\N<名字>`
  插件的那款上有 411 条 error —— 全部是「同一个角色在别处译过、这里还留着日文名」，
  属于玩家能直接看到的日文，所以定成 error 而不是 warn。

## 许可

GPL-3.0-or-later，见 [LICENSE](LICENSE)。

本项目**不含任何游戏内容**，也不分发译文；字典与译文由使用者自行生成，版权归原游戏权利方所有。
请只对自己合法拥有的游戏使用。
