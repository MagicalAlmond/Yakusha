# 开发交接文档（DEVLOG）

> 这份文档记录**阶段目标、已完成项、决策理由和下一步**，随开发进程更新。
> 最后更新：2026-10-25（0.5.0，新增 `terms` 与 `--overwrite`，188 个测试全绿）。

## 1. 项目目标（用户原话）

> "按顺序1->2执行，原有工具更新问题完全放弃，自主进行功能开发和测试并验收"

即：

1. **A 阶段** —— 通用化 MVP：任意 RPG Maker MZ / MV 游戏，能扫描、抽文本、装插件、运行时显示中文。
2. **B 阶段** —— LLM 翻译流水线：可配置端点、术语表、批量、并发、校验、断点续跑。
3. **原有工具强制更新补丁** —— 明确放弃，不再投入。

项目定位来自更早的判断（m04886）：**单人 + AI 开发，规模不大，个人使用为主，
顶多按 GPL 公开**。所以一切设计都优先"能跑、能验证、改动可回退"，
而不是"支持十几个引擎族"。

## 2. 当前状态

| 项 | 状态 |
| --- | --- |
| 版本 | 0.5.0（package.json） |
| 测试 | **188 个，全绿**（`npm test`，约 3.5s） |
| 支持引擎 | RPG Maker **MZ 1.3.2–1.9.0**、**MV 1.6.1–1.6.2** |
| 实测游戏 | 15 款可识别（本机全量普查），其中 3 款全量翻译 + 运行时验收 |
| 磁盘改动 | 只加 1 个插件文件 + `plugins.js` 里 1 条注册，卸载逐字节还原 |
| 运行时依赖 | 无第三方依赖（Node >= 22） |
| 许可 | GPL-3.0-or-later |

## 3. 阶段目标与完成情况

### A 阶段（已完成）

- [x] 项目发现：从任意上级目录向下有界搜索（3 层），支持 `www/`、改名子目录、
      `data/www/` 三种真实布局；同层两套游戏报错而不是随便挑。
- [x] 数据解码：明文 JSON / 单字节 XOR 穷举 256 键 / 0 字节空白占位（`empty` 不算 `undecodable`）。
- [x] 文本抽取：字段表 + 指令表（`src/core/fields.js` 是唯一真源）。
- [x] 字典格式 `yakusha/1`：key = 原文，value = `{text, contexts, error?}`。
- [x] 运行时插件：MZ 挂 `DataManager.onXhrLoad`；MV 挂 `loadDataFile` + `onLoad`
      并**按对象身份认领**（MV 的 XHR 是并发的，不能按到达顺序配对）。
- [x] 安装 / 卸载：备份 `plugins.js`，重写时保留原文件的**尾逗号**与**换行风格**（LF/CRLF）。
- [x] 真机验收：MZ《格闘娘はお金が無い！》、MV《常識改変者のいるギルド》均有中文对话/选项截图。

### B 阶段（已完成）

- [x] OpenAI 兼容 provider（DeepSeek 实测）+ mock provider（`--dry-run` 离线）。
- [x] 批处理（`--batch-size` / `--char-budget`）+ 并发（`--concurrency`）+ 每 N 条落盘。
- [x] 术语表（`--glossary` / `--glossary-only`），命中不发请求。
- [x] 六道校验闸门（`validateTranslation`）：空串、原样回显、转义码、`%N` 占位符、
      换行数、长度比、`U+FFFD`。**不合格绝不写伪造译文**，只记 `entry.error`。
- [x] 折行（`--max-length`）：按显示列宽（全角 2 列），标点断行 + 禁则处理（`！？` 不落到行首），
      转义码宽度算 0 且不拆开；对已翻完的字典可重复执行回填（`--no-rewrap` 关闭）。
- [x] 发布前自检（`verify`）：把人工审计脚本产品化，只读不写，8 类问题分 error/warn 两档。
      实测三款跑完的游戏上 error 全为 0，见第 6 节。
- [x] 一致性（`terms`）：从字典自身挖出名字/术语在正文里的**主流译法**，与名字条目比对报
      `drift`/`missing`，可导出成术语表回灌（配 `translate --glossary-only --overwrite`）。
      这一步解决的是`verify` 查不到的那类问题：`フェイリン` 的名字表现写「费琳」，
      而正文 3,653 行里 96% 写「菲琳」。`verify` 看到这条只会说「没有结构性问题」。

## 4. 文件地图

```
bin/yakusha.js             CLI（scan / extract / status / translate / verify / terms / install / uninstall）
src/core/fields.js        字段表与指令表（纯数据，会嵌进插件）
src/core/mzproject.js     项目发现（向下 3 层）、System.json 读取
src/core/datafile.js      数据文件解码（明文 / 单字节 XOR / 空白占位）
src/core/extract.js       遍历 data/ 抽出所有可译文本
src/core/textkey.js       转义码分词 / 归一化 / 校验
src/core/dict.js          字典读写
src/core/pluginsfile.js   js/plugins.js 解析与重写（保留尾逗号与换行风格）
src/core/install.js       安装 / 卸载
src/pipeline/provider.js  OpenAI 兼容 + mock provider
src/pipeline/translate.js 批处理、校验、重试、术语表
src/pipeline/wrap.js      按显示宽度折行（MZ/MV 不会横向自动换行）
src/pipeline/verify.js    译文体检（残留假名 / 原样回显 / 转义码 / 占位符 / 超宽行）
src/pipeline/terms.js     名字/术语的主流译法挖掘与漂移检测
src/plugin/YAKUSHA_Translator.js  运行时插件模板（install 时注入规则表）
test/                     188 个测试（含 CLI 端到端）
```

## 5. 关键决策与理由（改代码前请先读这一节）

| 决策 | 理由 |
| --- | --- |
| **运行时钩子，不改 `data/*.json`** | 改磁盘会破坏原游戏、更新即失效、无法回退；钩子只在内存里替换。 |
| **字典 key = 原文** | 不用 hash/自增 id：译文要能人工校对，key 必须是玩家能看懂的原文。 |
| **校验在写之前** | 宁可留日文，也不留一条会显示成乱码或吞掉转义码的译文。 |
| **`fields.js` 单一真源** | 插件的 `RULES` 由 `install` 生成，`test/rules-sync.test.js` 守着漂移。 |
| **不做自动语言检测（不做 `--skip-lang`）** | 实测判不出来：日文原版那款有 437 条"无假名"条目，多数是纯汉字日文（武闘家/騎士/鎧系）；用日文特有汉字集合加严后仍会**误跳过 64%** 的日文条目。误跳过 = 玩家直接看到日文（不可接受），误翻译 = 多花 token（可接受）。正确做法是全量跑，模型对已是中文的句子原样回显，被"原样回显"闸门拒收。 |
| **折行放在校验之后** | 模型输出仍逐字比对；折行是本地排版，不该被拉进校验闸门。 |
| **换行数闸门不放宽** | 曾为兼容折行试过 `b < a`，最后回退成严格相等——闸门一旦被扭曲，后面所有校验都不可信。 |
| **重写 `plugins.js` 保留原形状** | 有的游戏带尾逗号、有的不带，有的 CRLF。整文件重排会让一次安装变成全文件 diff。 |
| **`verify` 区分 error / warn，只有 error 让命令失败** | 发布前需要一条能过的判定线。原样回显、转义码损坏、占位符丢失会让玩家看到错内容，必须拦；残留 `ッ`、多一个换行、超宽行是风格问题，拦下来只会让人关掉检查。 |
| **`terms` 从正文反推名字表，而不是拿名字表去校验正文** | 实测反向走不通：名字表里 `フェイリン→费琳`、`ミスティ→迷雾` 本身就是错的（后者正文 0% 支撑），拿它去校验正文等于用错的标准判对的文章。反过来从 3,653 行正文里统计，`菲琳` 占 96%、`米丝蒂` 占 76%，这才是玩家实际读到的名字。 |
| **`terms` 在 90% 内取最长，而不是取最高频** | 纯频次会切碎片：`哥布林` 的每个子串出现次数都一样多，最高频会选中 `哥布`；实测 `ゴブリン` 因此变成「哥布」、`ベヒモス` 变成「希摩」。加「取最长」后一起变对。 |
| **`terms` 的候选首字排除虚词，但保留 `向`** | `丰满的胸部` 会切出 `的胸部` 这种假漂移，所以首字是「的/了/在/把」的候选直接丢。`向` 虽是助词，但也是真名字首字（向阳处），漏掉真名字比留下一个切口更糟——实测把它加进黑名单后，`向阳处` 被切成 `阳处`。 |
| **`--glossary-only` 默认只补空缺，覆盖要显式 `--overwrite`** | `terms` 报的漂移恰恰在「已翻译」的条目上，而词表应用原本跳过已翻译条目 → 挖出来的修复永远应用不上（第一版 CLI 测试就是这么挂的：`费琳` 没被改成 `菲琳`）。但覆盖是危险动作，所以做成 opt-in：普通词表仍是「补空缺」，不静默重写别人的译文。 |
| **不做跨游戏翻译记忆库（TM）** | 量过：15 款游戏并集 256,272 条、各游戏之和 259,165 → 跨游戏共享仅 **1.1%**；用其余 14 款已翻游戏去覆盖最大的那款（58,256 条）只命中 **0.87%**。省不到 1% 的 token，不值得引入一套 TM 存储与匹配。同游戏内的重复（名字一致性）才是真问题面，占 4%–39%。 |
| **`verify` 的假名判据排除 `・` 和 `ー`** | U+30FB / U+30FC 在中译文里是正常标点，早期审计脚本把 `睡眠・沈黙` 判成未翻译，一款误报 22 条、最大的那款误报 135 条（真值 106）。这类阈值一旦定错，整个命令就没人信了。 |

## 6. 实测数据（可复现的基准）

### 15 款游戏普查（本机全量，`undecodable` 全程 0）

| 引擎/版本 | data 文件 | unique | total | 游戏 |
| --- | --- | --- | --- | --- |
| mv 1.6.1 | 119 | 10,356 | 20,771 | An Arena RPG of Stripping |
| mv 1.6.1 | 64 | 14,945 | 25,605 | Hustle Battle Card Gamers |
| mv 1.6.2 | 31 | 19,890 | 28,400 | The Demon King's Reclusive Strategist |
| mz 1.7.0 | 51 | 38,044 | 80,502 | [RJ01312289]格闘娘はお金が無い！ |
| mz 1.9.0 | 82 | 4,018 | 7,110 | [RPG]催堕的魔法使 |
| mz 1.5.0 | 28 | 2,295 | 4,638 | [RPG]误入只有雌性的精灵村（XOR 混淆） |
| mz 1.8.0 | 27 | 6,797 | 10,366 | [SLG]与傲娇妹妹的治愈日常（改名子目录） |
| mz 1.3.2 | 276 | 58,256 | 113,050 | セックス実習のある島で |
| mv 1.6.2 | 268 | 36,203 | 41,136 | 一次性交易大师（data/www） |
| mv 1.6.2 | 41 | 4,388 | 7,161 | 常識改変者のいるギルド |
| mv 1.6.1 | 63 | 159 | 184 | 忧郁的安娜 |
| mz 1.7.0 | 265 | 24,757 | 31,575 | 桜御前 |
| mz 1.9.0 | 30 | 8,752 | 14,634 | 求生吧！无人岛性存生活♡ |
| mv 1.6.2 | 46 | 4,065 | 8,852 | 用时间停止肆意妄为 |
| mv 1.6.2 | 453 | 26,240 | 81,017 | 魔法少女コノハv2.04 |

合计 **259,165 unique / 475,001 total**。

### 全量翻译完成度

| 游戏 | total | translated | pending | 残留原因 |
| --- | --- | --- | --- | --- |
| 格闘娘はお金が無い！ | 38,044 | 38,042 | 2 | 一条是纯全角空格（`empty`）；一条转义码 7 vs 6（`\\.` 序列不可译） |
| 常識改変者のいるギルド | 4,388 | 4,387 | 1 | `\N<ひなた>` 标记剥掉后仍有假名 |
| 用时间停止肆意妄为 | 4,065 | 4,064 | 1 | 同上 |

残留全部是**校验闸门正确拒收**，不是 bug。

### verify 在三款已翻译游戏上的实测（0.4.0）

| 游戏 | translated | error | warn | warn 构成 |
| --- | --- | --- | --- | --- |
| 格闘娘はお金が無い！ (MZ) | 38,042 | **0** | 169 | kana 106（拟声词里的 `ッ`）、lines 61（中文比日文短，模型主动断行）、rejected 2 |
| 常識改変者のいるギルド (MV) | 4,387 | **0** | 1 | rejected 1 |
| 用时间停止肆意妄为 (MV) | 4,064 | **0** | 1 | rejected 1 |

加 `--max-length 48` 后再跑：格闘娘多出 width 388（这些条目当初没带 `--max-length` 翻译，
重跑一次 `translate --max-length 48` 就能回填折行），另两款分别只多 3 / 5 条。

格闘娘那 61 条 lines 全部是 `0 -> 1`（原文一行，模型为了可读性断成两行），不是文字损坏；
`--max-length` 的折行本来就会改写换行，所以这条判定只能是 warn。

### terms 在四款已翻译游戏上的实测（0.5.0）

| 游戏 | 名字条目 | 挖出术语 | drift | missing | 耗时 |
| --- | --- | --- | --- | --- | --- |
| 格闘娘はお金が無い！ (MZ) | 510 / 612 | 52 | **5** | 0 | 714ms |
| 常識改変者のいるギルド (MV) | 156 / 215 | 20 | **2** | 0 | 39ms |
| 用时间停止肆意妄为 (MV) | 145 / 148 | 6 | 0 | 0 | 29ms |
| [SLG]与傲娇妹妹的治愈日常 (MZ) | 45 / 45 | 3 | 0 | **3** | 12ms |

分母是全部命中 `NAME_CONTEXT` 的条目数（含因太短 / 像散文而被跳过的）。
真实挖出的漂移：
`フェイリン 费琳(4%)→菲琳(96%) n=3653`、`ミスティ 迷雾(0%)→米丝蒂(76%)`、
`ヒール 治愈(13%)→治疗(88%)`、`噴水 喷水→喷泉(100%)`、`突進 突进→冲撞(67%)`、
`ローパー 罗珀→触手(55%)`、`ジョッキ 大杯→精液(86%)`。

判对没误报的：`リンカ 琳卡`、`ルビー 露比`、`ホーク 霍克(99%)`、`ゾーイ 佐伊(100%)`、
`ゴブリン 哥布林(100%)`、`ベヒモス 贝希摩斯(92%)`、`オーク 兽人(97%)`。

与傲娇妹妹那 3 条 missing（加奈 / 哥哥 / 千夏）是**真结论**：官方中文游戏，名字字段的
target 是空的，但正文里译名早就统一了 → 正好用 `terms --write` 反过来补名字表。

### 名字在正文里的覆盖比例（决定要不要做一致性检查）

| 游戏 | 名字数 | 含名字的 key | 占比 |
| --- | --- | --- | --- |
| 格闘娘はお金が無い！ | 1,474 | 6,931 | **18.2%** |
| 一次性交易大师 | 1,022 | 14,216 | **39.3%** |
| 桜御前 | 1,473 | 3,465 | 14.0% |
| 常識改変者のいるギルド | 291 | 767 | 17.5% |
| セックス実習のある島で | 1,152 | 3,766 | 6.5% |
| 用时间停止肆意妄为 | 186 | 182 | 4.5% |

### 其它基准

- 术语表 127 条只占唯一数 0.3%，但覆盖 **18.4%** 的出现次数；要覆盖 42% 得进前 5000 条 → 长尾极重，机器翻译必须跑全量。
- 译文长度比：p50 **0.71×**（中文普遍比日文短），只有 0.9% 比原文长；`--max-length 54` 对 3.8 万条只改动 61 条，且**控制码 0 丢失、可见字符 0 丢失**。
- 6 款游戏做过 `install` → `uninstall` 往返，`plugins.js` 全部逐字节还原（md5 一致）。
- 运行时命中：MZ 那款 `lookups 60,781 / translated 60,779 / misses 2 / rejected 0`。

## 7. 已知限制

1. 只处理 `data/` 里的文本；插件 `js/plugins/*.js` 里硬编码的 UI 文案不动。
2. 图片里的文字不处理。
3. MV 的 `.rpgmvp` 加密图不影响文本，但 MV 若用了别的数据混淆方案可能解不出（会报 `undecodable`）。
4. **MZ/MV 不会横向自动换行**：`Window_Base.flushTextState` 把整行一次性 `drawText`，
   超宽即裁，只有纵向 `needsNewPage` 分页。默认靠 prompt 约束，硬保证加 `--max-length`。
5. 老 MV（2019/2020 的 nw.js）不吃 `--remote-debugging-port`，MV 的运行时取证不能靠 CDP。
6. 有些 MV 游戏把说话人写成 `\N<名字>`（插件自定义标记，非 RPG Maker 转义码），译文必须原样保留。
7. 不支持 XP/VX/VX Ace（`.rxdata` 二进制）、Unity / Godot / Kirikiri / Ren'Py 等其它引擎。
8. `verify` 只看字典里的结构性问题（回显 / 转义码 / 占位符 / 换行 / 宽度 / 假名残留），
   看不出风格、人名一致性和上下文是否贴切；那部分仍需人工抽读。
9. `verify` 的 width 档只在显式传 `--max-length` 时才有意义——不传就不知道窗口宽度该是多少。
10. `terms` 只挖「名字字段里有的东西」。纯 UI 词（攻击/防御/回合）、技能描述里的
    术语、正文里的地名，只要没进过数据库 name 字段就不会被挖出来。这是有意的：
    没有名字字段当锚点，任意中文串的统计没有可判定的正确答案。
11. `terms` 的判定是「正文主流译法」，不是「正确译法」。实测报出的 7 条里，
    `噴水 喷水→喷泉`、`ローパー 罗珀→触手`、`ジョッキ 大杯→精液` 属于**语义变化**
    而不是算法碎片（译文里确实 100%/55%/86% 这么写）。这类条目要不要采纳得人看，
    所以 `terms --write` 只是**建议**，真正落盘需要人再跑一次 `--glossary-only --overwrite`。
12. `translate` 侧对 glossary 条数没有上限（`systemPrompt` 会把整张表塞进去）。
    `terms --max-terms` 是目前唯一的约束手段；词表上千条时需要自己截断。
13. `terms` 的 `--drift-only` + `--overwrite` 会**重写已有译文**。这是唯一一处
    工具会主动改动已经翻好的内容，务必先看一眼 `--dry-run` 的输出。

## 8. 下一步（backlog，按优先级）

1. **push 到 GitHub**（用户说过"顶多公布到 github"，但还没要求立即推送）。
2. 可选：给 `translate` 的 glossary 加条数上限（现在整张表塞进 system prompt，
   `terms --max-terms` 是唯一约束手段）。
3. 可选：给 `verify` 加 `--write-report <file>`，把结果落成 markdown 便于贴 issue。
4. 可选：把「官中游戏不必全量翻」写成 README 里的分步建议（判据已定、数据在第 6 节、
   说明已在 README「已经是目标语言的游戏不必全量翻」段；还缺一条 `--limit` 抽样看拒绝率的具体命令示例）。
5. 可选：给 `translate` 加 `--only-context` 的多值支持（现在只能传一个位置子串）。
6. 可选：把运行时截图驱动脚本（CDP 解冻 / readPixels 回读 / 冻结后原子渲染）整理成
   `tools/` 下的取证工具，便于以后验收新游戏时复用。**注意：这类脚本会碰游戏进程，
   不建议随工具分发，只作开发期验证用。**
7. 可选：MV 老 nw 的运行时取证目前靠临时注入脚本，如果能找到不注入的办法（例如日志钩子）更好。
8. 可选：`terms` 目前只认数据库 name 字段；若以后要挖地名/技能术语，需要另找锚点
   （例如 `System.json` 的 `terms` 分组），且必须先解决「没有正确答案」的判定问题。

## 9. 继续工作的方法

```bash
# 全部测试
npm test

# 看一款游戏有多少可译文本
node bin/yakusha.js scan "D:/H/Games/<game>"

# 建字典
node bin/yakusha.js extract "D:/H/Games/<game>"

# 翻译（需要 key，可用环境变量 YAKUSHA_API_KEY / YAKUSHA_MODEL / YAKUSHA_BASE_URL）
node bin/yakusha.js translate "D:/H/Games/<game>" --concurrency 4 --batch-size 40 --char-budget 6000

# 离线全套验证（不联网）
node bin/yakusha.js translate "D:/H/Games/<game>" --dry-run --limit 50
node bin/yakusha.js translate "D:/H/Games/<game>" --glossary-only

# 名字/术语一致性（先看再改）
node bin/yakusha.js terms "D:/H/Games/<game>" --status drift
node bin/yakusha.js terms "D:/H/Games/<game>" --drift-only --write yakusha/terms.json --dry-run
node bin/yakusha.js translate "D:/H/Games/<game>" --glossary yakusha/terms.json --glossary-only --overwrite

# 发布前自检（只读）
node bin/yakusha.js verify "D:/H/Games/<game>" --max-length 48
node bin/yakusha.js verify "D:/H/Games/<game>" --kind echo,codes,slots --json

# 装 / 卸
node bin/yakusha.js install   "D:/H/Games/<game>"
node bin/yakusha.js uninstall "D:/H/Games/<game>"
```

## 10. 工程教训（踩过的坑，别再踩）

- **命令行输出里的 `return` 会吞掉后半段**：`terms` 在 terms 为空时 `return`，把后面的 glossary 行
  （以及 --status 过滤时的提示）一起跳过了。凡是「先判断再打印剩余段落」的 CLI，都要么改成
  if/else、要么最后统一收尾。已加回归测试守着。
- **CLI 的过滤参数要同时说明「列出多少」和「挖出多少」**：只打 `4 drift` 会让人以为总共就 4 条，
  实际是 52 条里筛出 4 条。现在打 `4 of 52 mined (4 drift, 0 missing)`。
- **给"建议型"命令加 `--dry-run` 时，语义要写清楚**：`terms --dry-run` 不是"不干活"，
  而是"只报会写什么"——它本来就不碰字典。别照抄 `translate --dry-run`（那个是真不调模型）。

- **Windows 上 ESM 不能直接 import 绝对路径**（`ERR_UNSUPPORTED_ESM_URL_SCHEME: d:`），
  必须 `pathToFileURL(p).href`；验证脚本一律写成 `.cjs` 再 `node` 跑，别塞进仓库。
- **`node --test test/` 在 Windows/Node 24 上会报 Cannot find module**，
  `scripts.test` 必须写 glob 形式 `node --test "test/*.test.js"`。
- `plugins.js` 有尾逗号（合法 JS、非法 JSON）→ 必须先 `stripTrailingCommas` 再 `JSON.parse`。
- `--save-every` 的 `lastSaved` 必须从 0 起（`progress.translated` 是本次运行增量，混基准会永不落盘）。
- `parseReply` 要能吃两种回显：模型把 `src` 字段回显、以及模型写出非法转义 `\{`
  （`parseJsonLoose` 逐字符修复）。
- DeepSeek 用 `response_format:{type:"json_object"}` 时，prompt 里必须出现 "json" 字样，否则 400。
- 长跑不要加 `--json`（否则没有进度输出，看起来像卡死）。
- 包装 LLM 调用的脚本要放在**仓库外**（例如 `临时目录下的 llm_run.mjs`），
  放仓库里会在清理临时文件时被误删，后台长任务整个白跑。
