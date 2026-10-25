# 开发交接文档（DEVLOG）

> 这份文档记录**阶段目标、已完成项、决策理由和下一步**，随开发进程更新。
> 最后更新：2026-10-25（0.9.0，项目改名 **Yakusha**，字典目录、插件文件、环境变量与
> 备份后缀全部随之改名；已翻译的游戏字典复制到新目录，253 个测试全绿；仓库已发布到
> https://github.com/MagicalAlmond/Yakusha（`main` 分支）。
> 0.8.0 的 `doctor`、0.7.1 的 `uninstall` 漂移保护、0.7.0 的报告/模板见下）。
> README 是一页 quickstart；判据、实测与限制在 `docs/design.md`、`docs/commands.md`、
> `docs/games.md`、`docs/limitations.md`。

## 1. 项目目标

起点是一次明确的取舍：**放弃给某个多引擎汉化工具打强制更新补丁**，把精力全部转到
自研的通用化工具上，自主完成功能开发、测试与验收。据此定下两件事、放弃第三件：

1. **A 阶段** —— 通用化 MVP：任意 RPG Maker MZ / MV 游戏，能扫描、抽文本、装插件、运行时显示中文。
2. **B 阶段** —— LLM 翻译流水线：可配置端点、术语表、批量、并发、校验、断点续跑。
3. **给多引擎汉化工具打强制更新补丁** —— 明确放弃，不再投入。

项目定位来自更早的判断（m04886）：**单人 + AI 开发，规模不大，个人使用为主，
顶多按 GPL 公开**。所以一切设计都优先"能跑、能验证、改动可回退"，
而不是"支持十几个引擎族"。

## 2. 当前状态

| 项 | 状态 |
| --- | --- |
| 版本 | 0.9.0（package.json） |
| 测试 | **253 个，全绿**（`npm test`，约 5.9s） |
| 持续集成 | GitHub Actions：`npm test` 在 Node 22 / 24 上各跑一遍 |
| 支持引擎 | RPG Maker **MZ 1.3.2–1.9.0**、**MV 1.6.1–1.6.2** |
| 实测游戏 | 15 款可识别（本机全量普查），其中 **4 款**全量翻译 + 运行时验收 |
| 磁盘改动 | 只加 1 个插件文件 + `plugins.js` 里 1 条注册，卸载逐字节还原 |
| 运行时依赖 | 无第三方依赖（Node >= 22） |
| 产品形态 | CLI 为内核；Electron GUI 在 0.11 落地（见 [architecture.md](architecture.md)） |
| 许可 | GPL-3.0-or-later |
| 仓库 | https://github.com/MagicalAlmond/Yakusha（`main`） |

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
- [x] 卸载的安全边界：装好之后 `plugins.js` 又被改过（游戏更新、另装插件、RPG Maker 编辑器里
      存过档）时不再用旧备份覆盖，只摘掉 `YAKUSHA_Translator` 那一条、把备份留在原地；
      `install` 也会先指出「备份已经对不上这份文件」。判断依据是整个 `$plugins` 除自己那条
      以外是否仍与备份一致（按 name/status/description/parameters 比对，键序与排版不算改动）。

### B 阶段（已完成）

- [x] OpenAI 兼容 provider（DeepSeek 实测）+ mock provider（`--dry-run` 离线）。
- [x] 批处理（`--batch-size` / `--char-budget`）+ 并发（`--concurrency`）+ 每 N 条落盘。
- [x] 术语表（`--glossary` / `--glossary-only`），命中不发请求。
- [x] 六道校验闸门（`validateTranslation`）：空串、原样回显、转义码、`%N` 占位符、
      换行数、长度比、`U+FFFD`。**不合格绝不写伪造译文**，只记 `entry.error`。
- [x] 折行（`--max-length`）：按显示列宽（全角 2 列），标点断行 + 禁则处理（`！？` 不落到行首），
      转义码宽度算 0 且不拆开；对已翻完的字典可重复执行回填（`--no-rewrap` 关闭）。
- [x] 发布前自检（`verify`）：把人工审计脚本产品化，只读不写，10 类问题分 error/warn 两档。
- [x] 0.5.2 补上两类「玩家能直接看到」的检查：`trad`（译文里混进原文没有的繁体字）
      与 `speaker`（MV 的 `\N<名字>` 标记没翻，或同一角色有多种写法）。
      实测三款跑完的游戏上 error 全为 0，见第 6 节。
- [x] 位置过滤（`--context`）可重复传多个值，任一命中即选（OR 语义）。
- [x] 说话人名修复（`speaker`）：把 `verify --kind speaker` 报出的问题按本作**自己已经在用**
      的写法机械修好（假名残留 → 已译写法；全汉字照抄名 → 中文写法），并能用 `--names`
      补一款游戏从头到尾没翻过的名字。全程不调用模型。实测用时间停止那款 411 → 0 error。
- [x] 一致性（`terms`）：从字典自身挖出名字/术语在正文里的**主流译法**，与名字条目比对报
      `drift`/`missing`，可导出成术语表回灌（配 `translate --glossary-only --overwrite`）。
      这一步解决的是`verify` 查不到的那类问题：`フェイリン` 的名字表现写「费琳」，
      而正文 3,653 行里 96% 写「菲琳」。`verify` 看到这条只会说「没有结构性问题」。
- [x] 0.7.0 补上发布流程的两块拼图：`verify --write-report <file>` 把 10 类问题
      连同「为什么重要」写成一份自包含的 markdown（终端里看 192 条警告不现实，
      报告能直接贴 issue）；`speaker --write-names <file>` 把「本作一次都没翻过、
      机械修复帮不上」的名字直接列成待填的 JSON 模板。同一轮修掉 `verify` 报 error
      时退出码仍为 0 的契约 bug（README 与本文第 5 节都承诺过它会失败），
      现在 `verify && install` 可以当发布闸门用。
- [x] 0.8.0 新增 `doctor`：把「游戏更新后中文没了」拆成三条可判定的问题——字典是否还对得上
      这版 `data/`（逐 key 回查）、插件条目是否还在 `$plugins` 里、运行时能否在根目录或
      `www/` 找到字典。结果分 `broken` / `not installed` / `usable` / `ready` 四态，
      只在 `broken` 时退出 1。`plugins.js` 被手写坏时也照常出报告（初版会抛栈）。

## 4. 文件地图

```
bin/yakusha.js             CLI（scan / extract / status / translate / verify / speaker / terms / install / uninstall / doctor）
src/core/fields.js        字段表与指令表（纯数据，会嵌进插件）
src/core/mzproject.js     项目发现（向下 3 层）、System.json 读取
src/core/datafile.js      数据文件解码（明文 / 单字节 XOR / 空白占位）
src/core/extract.js       遍历 data/ 抽出所有可译文本
src/core/textkey.js       转义码分词 / 归一化 / 校验
src/core/dict.js          字典读写
src/core/pluginsfile.js   js/plugins.js 解析与重写（保留尾逗号与换行风格）
src/core/install.js       安装 / 卸载（含 installedEntry / backupStatus 两个只读探针）
src/core/doctor.js        装完之后的体检（安装 / 备份 / 字典同步 / 运行时查找）
src/pipeline/provider.js  OpenAI 兼容 + mock provider
src/pipeline/translate.js 批处理、校验、重试、术语表
src/pipeline/wrap.js      按显示宽度折行（MZ/MV 不会横向自动换行）
src/pipeline/verify.js    译文体检（残留假名 / 原样回显 / 转义码 / 占位符 / 超宽行 / 繁体 / 说话人）
src/data/traditional.js   繁体专用字表（OpenCC TSCharacters，只留一繁对一简）
src/pipeline/terms.js     名字/术语的主流译法挖掘与漂移检测
src/pipeline/speaker.js   说话人标记的识别、房规统计与按房规修复
src/pipeline/report.js    verify 结果的 markdown 报告（只格式化，不重算）
src/plugin/YAKUSHA_Translator.js  运行时插件模板（install 时注入规则表）
test/                     253 个测试（含 CLI 端到端）
docs/design.md            为什么走运行时钩子、文本面覆盖、转义码、设计约束、作为库用
docs/commands.md          十个命令的完整选项与 verify / terms / speaker 判据
docs/games.md             15 款实测游戏、全量翻译记录、官中游戏的处理
docs/limitations.md       已知限制全表
docs/architecture.md      分层、引擎适配器契约、plugin/debug/inject 三种运行时模式、GUI 与 core 边界
```

## 5. 关键决策与理由（改代码前请先读这一节）

| 决策 | 理由 |
| --- | --- |
| **运行时钩子，不改 `data/*.json`** | 改磁盘会破坏原游戏、更新即失效、无法回退；钩子只在内存里替换。 |
| **GUI 是 Electron 薄壳，core 保持零依赖** | 玩家要拖拽启动，浏览器拿不到被拖入文件夹的绝对路径，所以选 Electron；但汉化者仍需要 CLI 与脚本。两者都只是 core 的调用方，逻辑不复制。 |
| **改名为 Yakusha（訳者），字典目录与产品同名** | 旧缩写既像「机器翻译」，又和那个多引擎汉化工具撞脸，当窗口标题、exe 名、CLI 命令都不合适。`yakusha` 是「译者」，与游戏文化同源，短、好念、好打；目录跟着产品走，`<游戏>/yakusha/` 一眼知道是谁放的。 |
| **改名不保留旧路径兼容分支** | 兼容别名会把旧名写回代码与文档，等于规则白立；旧目录只用一次性迁移脚本处理（脚本在仓库外），代码里只有 `yakusha` 一个名字。 |
| **引擎适配器 + 三种运行时模式，注入不是前提** | 长期要像成熟的多引擎汉化工具一样支持多引擎，但 MZ/MV 用插件就够；CDP（`--remote-debugging-port`）还能覆盖一整类 Chromium 壳。把 `inject` 留在契约里，pipeline 与 GUI 不因新引擎返工。 |
| **运行时载荷形状先定死（`format` + `rules` + `entries`）** | 插件、调试注入、原生 hook 吃同一份数据；以后加投递通道不用改游戏侧钩子。 |
| **字典 key = 原文** | 不用 hash/自增 id：译文要能人工校对，key 必须是玩家能看懂的原文。 |
| **校验在写之前** | 宁可留日文，也不留一条会显示成乱码或吞掉转义码的译文。 |
| **`fields.js` 单一真源** | 插件的 `RULES` 由 `install` 生成，`test/rules-sync.test.js` 守着漂移。 |
| **不做自动语言检测（不做 `--skip-lang`）** | 实测判不出来：日文原版那款有 437 条"无假名"条目，多数是纯汉字日文（武闘家/騎士/鎧系）；用日文特有汉字集合加严后仍会**误跳过 64%** 的日文条目。误跳过 = 玩家直接看到日文（不可接受），误翻译 = 多花 token（可接受）。正确做法是全量跑，模型对已是中文的句子原样回显，被"原样回显"闸门拒收。 |
| **折行放在校验之后** | 模型输出仍逐字比对；折行是本地排版，不该被拉进校验闸门。 |
| **`--max-length` 默认 0，不按窗口自动推断** | 先量后定：真机测得全角字宽 = `fontSize`、半角 = 其一半，四款跑完全量翻译的游戏**最长行都没超预算**（桜御前 84 < 104、格闘娘 54 < 82、两款 MV 52 < 82）。自动推断只会在 MZ 上把本来放得下的行折掉（桜御前会折 1,700 行），在 MV 上因 `System.json` 没有 `advanced` 字段直接算出 `NaN`。折行是排版动作，该由人决定要不要。 |
| **换行数闸门不放宽** | 曾为兼容折行试过 `b < a`，最后回退成严格相等——闸门一旦被扭曲，后面所有校验都不可信。 |
| **重写 `plugins.js` 保留原形状** | 有的游戏带尾逗号、有的不带，有的 CRLF。整文件重排会让一次安装变成全文件 diff。 |
| **`verify` 区分 error / warn，只有 error 让命令失败** | 发布前需要一条能过的判定线。原样回显、转义码损坏、占位符丢失会让玩家看到错内容，必须拦；残留 `ッ`、多一个换行、超宽行是风格问题，拦下来只会让人关掉检查。 |
| **`terms` 从正文反推名字表，而不是拿名字表去校验正文** | 实测反向走不通：名字表里 `フェイリン→费琳`、`ミスティ→迷雾` 本身就是错的（后者正文 0% 支撑），拿它去校验正文等于用错的标准判对的文章。反过来从 3,653 行正文里统计，`菲琳` 占 96%、`米丝蒂` 占 76%，这才是玩家实际读到的名字。 |
| **`terms` 在 90% 内取最长，而不是取最高频** | 纯频次会切碎片：`哥布林` 的每个子串出现次数都一样多，最高频会选中 `哥布`；实测 `ゴブリン` 因此变成「哥布」、`ベヒモス` 变成「希摩」。加「取最长」后一起变对。 |
| **`terms` 的候选首字排除虚词，但保留 `向`** | `丰满的胸部` 会切出 `的胸部` 这种假漂移，所以首字是「的/了/在/把」的候选直接丢。`向` 虽是助词，但也是真名字首字（向阳处），漏掉真名字比留下一个切口更糟——实测把它加进黑名单后，`向阳处` 被切成 `阳处`。 |
| **`--glossary-only` 默认只补空缺，覆盖要显式 `--overwrite`** | `terms` 报的漂移恰恰在「已翻译」的条目上，而词表应用原本跳过已翻译条目 → 挖出来的修复永远应用不上（第一版 CLI 测试就是这么挂的：`费琳` 没被改成 `菲琳`）。但覆盖是危险动作，所以做成 opt-in：普通词表仍是「补空缺」，不静默重写别人的译文。 |
| **术语表按请求过滤，不整张塞进 system prompt** | 实测格闘娘 952 个请求，每个请求的 40 行平均只提到 **3.3** 个术语（最多 14 个），却要为整张表的 693 字付费；过滤后每请求 47 字，省 93%。过滤是纯字面包含（跨条目用 `\u0000` 拼接，避免把上一行的结尾和下一行的开头拼出一个不存在的词）。代价是`名称一致`只对本次请求里真的出现的名字起作用，这是可接受的：词表本来就是「这个词固定这么翻」，不是「这一段要用这些词」。 |
| **不做跨游戏翻译记忆库（TM）** | 量过：15 款游戏并集 256,272 条、各游戏之和 259,165 → 跨游戏共享仅 **1.1%**；用其余 14 款已翻游戏去覆盖最大的那款（58,256 条）只命中 **0.87%**。省不到 1% 的 token，不值得引入一套 TM 存储与匹配。同游戏内的重复（名字一致性）才是真问题面，占 4%–39%。 |
| **`--context` 可重复，语义是「任一命中」（OR）而非「全部命中」（AND）** | 用这个过滤的真实目的几乎总是「只翻对话和道具说明，别碰系统术语」，那是并集。AND 在这类语料上恒为空集（一条文本不可能同时出自 `Map001.json` 和 `Items.json`）。实现上 `setFlag` 只给 `REPEATABLE` 里的名字做数组累积，其他开关重复传仍是「后者覆盖」的旧行为。 |
| **`verify` 的假名判据排除 `・` 和 `ー`** | U+30FB / U+30FC 在中译文里是正常标点，早期审计脚本把 `睡眠・沈黙` 判成未翻译，一款误报 22 条、最大的那款误报 135 条（真值 106）。这类阈值一旦定错，整个命令就没人信了。 |
| **`trad` 只报「原文里没有的」繁体字，不报译文里所有繁体字** | 日文原文本来就大量使用繁体形汉字（`愛`、`動`、`書`、`員`、`婦`），naive 判据在四款游戏上分别是 34/67/1/12 行；比对源文本后只剩 30/64/1/**0**，用时间停止那款直接从 12 归零——它的 12 行全是「日文说话人名原样保留」，而名字里的繁体字原文本来就有。曾试过按 CJK 段切、段内有假名就跳过的守卫，但那样会把同一行里别的真泄漏一起放过。 |
| **繁体字表只收「一繁对一简且不同」的行，多目标字必须丢** | OpenCC 的 TSCharacters 里 `乾→干,乾`、`藉→藉,借`、`於→于,於`、`瞭→瞭,了` 在简体里也是合法写法，收进来就是纯假阳性。第一版手写 286 字表因为没排这些，只报了 44 条（漏报）；用 2,898 对正式表 + 源文本守卫后是 118 条。 |
| **`speaker` 的「名字留日文」是 error，不是 warn** | 标记内容会被插件原样渲染进姓名窗，玩家看到的是「日向」和「ひなた」混在同一个角色身上。这和残留 `ッ` 那种风格问题不是一个性质。但只报「本游戏别处翻过这个名字」的（实测 411 条），全程刻意保留日文名的作品不报——否则会给每个日式名字刷警告。 |
| **房规（house rendering）优先「真正的译文」而非「原样照抄的源名」** | 初版纯按票数取房规，结果 `先生→老师 x1 / 先生 x2`、`主婦→主妇 x1 / 主婦 x3`、`鉄棒少女→单杠少女 x1 / 鉄棒少女 x1` 这类「既是日语称谓、又是真名字」的词会让「留日文」以票数取胜，然后反过来把**正确的中文译文**报成漂移、并建议改回日文。规则改成：非假名且与源名不同的写法优先，同层再比次数，平票取非假名。 |
| **`speaker` 默认只修「没翻的」，两种中文写法要显式 `--include-drift`** | 「这一行还是日文、别处翻过」有唯一正确答案（抄别处那个），可以机械执行；「沙耶香 vs 沙耶加」「疲惫的女性 vs 看起来疲惫的女性」是风格取舍，两个都是合理中文，自动统一等于替人做美学决定。所以后者做成 opt-in，跑之前先看 `--dry-run`。 |
| **`speaker` 是纯本地改写，不调模型** | 正确的译法就在同一个字典里（用了 490 次的「日向」），再问模型一次既贵又可能发明第三种写法。`repairSpeakerNames` 只做「按位置换掉标记内容」，转义码与正文一个字节都不动，跑两次幂等。 |
| **`speaker` 的标记识别用白名单正则，不用 `<[^>]*>`** | 桜御前 的 84 行 `<...>` 全是代码表达式（`<50*\v[65]>`、`<\s[25] ? " OFF ":" ON " >`），天真匹配会把它们当人名。只接受「纯中文/假名/空白、长度 ≤ 40」的内容后，那款游戏 0 命中，真正有 `\N<名字>` 插件的那款 1,151 行正常命中。 |
| **`verify` 有 error 时用 `process.exitCode = 1` 失败，不用 `process.exit(1)`** | 契约上要让 `verify && install` 能拦住有问题的字典；实现上必须让 `--json` 的 stdout 冲刷完再退。`process.exit` 会截断管道里的 JSON，脚本解析直接炸。这个 bug 实测存在过（打印 FAILED 但退出码 0），修复时把退出码本身写进了测试。 |
| **报告只格式化，不重算** | `buildReport` 吃的是 `verifyDictionary` 已经算好的 `result`，不重新跑一遍检查。重算会让报告和终端输出的数字有机会不一致（比如中途有人改了字典），而报告的价值就在「它和刚才那次运行是同一份事实」。失败时也照写——最需要贴出去的正是失败的那次。 |
| **`uninstall` 只在「除自己那条以外没变」时用备份整体还原** | 备份只是文件在某个时刻的一张照片，不是「撤销」的凭据。装好之后游戏更新、你另装了一个插件、或者在 RPG Maker 编辑器里存过档，`plugins.js` 就已经不是那张照片了；无条件还原会把别人的改动一起删掉，而且是静默的。所以先比 `$plugins`（name/status/description/parameters，键序与排版不算改动）：一致才逐字节还原，不一致就只摘掉自己那一条、备份留原地并明确打印出来。`install` 也会在发现备份对不上时先说明，避免用户以为「反正能一键还原」。 |
| **`doctor` 只在 `broken` 时退出 1，`warn` 不算失败** | 诊断命令的职责是报告，不是闸门：还有 2 条没翻、192 条风格警告都是正常状态，让它们退出 1 只会让脚本里到处加 `|| true`，闸门形同虚设。真正的发布闸门是 `verify`（error 才失败），`doctor` 回答的是「这台机器上现在是什么形状」。 |
| **README 只留能照着做的步骤，判据与实测拆到 `docs/`** | README 一度 650 行，安装步骤、十类判据、15 款游戏普查、19 条限制全堆在一起，想照着做的人要翻过一半文档才找得到命令。现在 README 只回答「怎么装、怎么跑、出问题看哪」；为什么这样实现（design）、完整选项与判据（commands）、跑过哪些游戏（games）、边界（limitations）各归一处。`docs/DEVLOG.md` 仍是内部开发日志，不面向使用者。 |
| **损坏的 `plugins.js` 要报出来，不能让 doctor 崩栈** | 手改坏或写了一半的文件，正是最需要诊断的时候。初版 `backupStatus` 直接 `parsePluginsJs` 抛异常，doctor 打出一段 stack trace 而不是「哪里坏了」；现在解析失败记成 `plugins.js fail`，并跳过依赖它的 `install` / `backup` 两项检查，其余照常输出。 |

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
| 桜御前 | 24,757 | 24,735 | 22 | 校验拒收：纯拟声词（`ぬらら`/`じゃろり`）、专有名词未译（`呼び寄せ鈴`）|
| 常識改変者のいるギルド | 4,388 | 4,387 | 1 | `\N<ひなた>` 标记剥掉后仍有假名 |
| 用时间停止肆意妄为 | 4,065 | 4,064 | 1 | 同上 |

残留全部是**校验闸门正确拒收**，不是 bug。

桜御前那 22 条只有 0.09%（24,757 条里），且都是"译了反而更容易出错"的短拟声词，
运行时插件回退原文，玩家看到的是日文感叹词而不是错位文本。

### 两款新游戏的验收（0.5.0/0.5.1，都是此前没跑过的游戏）

| 游戏 | 引擎 | 关键事实 |
| --- | --- | --- |
| 桜御前 | MZ 1.7.0 | 265 个 data 文件 / 24,757 条；**133 个插件共存无冲突**（含 `Chimaki_Lang`、`DarkPlasma_AutoLineBreak`、`TRP_SkitMZ`、`GalleryMode`）；1280×720；`__YAKUSHA.stats()` 实测 `lookups 2,789 / translated 2,020 / rejected 0` |
| 误入只有雌性的精灵村… | MZ 1.5.0 | **28 个 data 文件全部单字节 XOR**，`extract` 解出 2,295 条、`undecodable` 0；装插件后 `__YAKUSHA.stats()` `lookups 3,046 / translated 0`（官方中文，字典为空 → 全部 miss，属预期）；`install`→`uninstall` md5 逐字节还原 |

两款都拿到了运行时截图进 `docs/screenshots/sakura-*.png`；XOR 那款证明
**插件在 XOR 数据上照样能挂上**（钩子在 JSON 解析之后，与数据是否加密无关）。

### 单行宽度实测（决定 `--max-length` 要不要设默认值，结论：不设）

真机测（桜御前 CDP）：`Window_Message.contents.measureTextWidth()`
`あ`=20px、`中文字`=60px、`A`=10px → **全角字宽 = fontSize 实际渲染值，半角 = 其一半**，
与 `displayColumns` 的"全角 2 列 / 半角 1 列"在 10px 一列基准下完全一致。
`contentsWidth()` = 1248 = `boxWidth 1272 - 2×padding 12`。

用 `列预算 = 2 × floor((screenWidth - 32) / fontSize)` 算真实容量：

| 游戏 | screenWidth | fontSize | 列预算 | 实测最长行 | 超限 |
| --- | --- | --- | --- | --- | --- |
| 桜御前 (MZ) | 1280 | 24 | 104 | 84 | **0** |
| 格闘娘はお金が無い！ (MZ) | 1110 | 26 | 82 | 54 | **0** |
| 常識改変者のいるギルド (MV) | — | 28 | — | 52 | **0** |
| 用时间停止肆意妄为 (MV) | — | 28 | — | 52 | **0** |

四款跑完全量翻译的游戏**没有一行超宽**。原因：中文比日文短约 28%（p50 长度比 0.71），
system prompt 里还有"保持紧凑"的约束。所以 `--max-length` 保持默认 0，
只在需要硬保证时手动加。

若将来真要设默认，按行长分布（每行显示列宽）：
桜御前 `over40 2,557 / over44 1,700 / over48 1,076 / over56 364`（maxLine 84）、
格闘娘 `over40 3,226 / over44 1,300 / over48 388 / over56 0`（maxLine 54）、
常識改変者 `over40 79 / over44 19 / over48 3`（maxLine 52）。

**MV 上算不出这个预算**：MV 的 `System.json` 没有 `advanced` 字段（`advanced.screenWidth`
是 MZ 才有的），任何"从 System.json 自动推列宽"的实现在 MV 上会得到 `NaN`，
这也是不做自动推断的理由之一。

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

### `trad` / `speaker` 在五款已翻译游戏上的实测（0.5.2）

| 游戏 | error | warn | trad | speaker | 说明 |
| --- | --- | --- | --- | --- | --- |
| 格闘娘はお金が無い！ (MZ) | 0 | 192 | 23 | 0 | 没有 `\N<名字>` 插件 |
| 桜御前 (MZ) | 0 | 195 | 56 | 0 | 84 行尖括号全是代码表达式，被白名单排除 |
| 常識改変者のいるギルド (MV) | 0 | 1 | 0 | 0 | 干净 |
| 用时间停止肆意妄为 (MV) | **411** | 59 | 0 | 469 | `Lunatlazur_ActorNameWindow` 的名字窗 |
| [SLG]与傲娇妹妹的治愈日常 (MZ) | 0 | 1 | 0 | 0 | 官方中文，正文本来就是中文 |

`trad` 的命中最多的两款分别 23 / 56 条（0.06% / 0.23%），全部是模型偶发切到繁体的
长句（`身体的動作卻停不下來`、`乳頭、還有小穴`）。

用时间停止那款是 `speaker` 唯一的 error 来源：1,151 行带名字标记，32 个不同名字里
**25 个有多种写法**。最典型的是 `ひなた`：翻成「日向」490 次、「雏田」38 次，但仍有
**301 行原样留着 `ひなた`**；`サーキュ` 翻成「萨丘」103 次、留日文 54 次。
这类残留和「拟声词里的 `ッ`」不同——玩家会看到同一个角色的名字两种语言混排，
所以判 error。

另一个真发现：`水泳部員`、`主婦`、`新人社員`、`運転手`、`教師` 这 5 个纯汉字名字
共 12 行完全没翻。纯汉字所以逃过了假名检测，但它们含繁体专用字（員/婦/員/運/師），
在简体中文里一定写作 员/妇/员/运/师——加这条规则后 error 从 399 升到 411。

### `speaker` 修复在 用时间停止肆意妄为 上的实测（0.6.0）

```bash
node bin/yakusha.js speaker "<game>"                      # 第一轮：只修没翻的
node bin/yakusha.js speaker "<game>" --names names.json   # 补本作从没翻过的名字
node bin/yakusha.js speaker "<game>" --include-drift      # 第三轮：统一中文写法
```

| 轮次 | 改动 | error | 说明 |
| --- | --- | --- | --- |
| 修复前 | — | 411 | `ひなた` 留日文 301、`サーキュ` 54、`主婦`/`水泳部員` 等纯汉字名 12 |
| 第一轮 `speaker` | 23 个名字 / 414 条 | 411 → 3 | 只改「这一行还是日文、别处翻过」的两类 |
| `--names` | 1 个名字 / 3 条 | 3 → 0 | 只剩余 `水泳部員`（全作没翻过，没有可抄的写法） |
| `--include-drift` | 8 个名字 / 51 条 | 0 → 0（warn 51 → 0） | `雏田→日向` x38、`雏田爸爸` x4、`沙耶加→沙耶香` x3 等 |

三轮结束后 `verify` 只剩 1 条 warn（`N<ひなた>“呼ー♡` 被「原样回显」闸门正确拒收），
`status` 仍是 4,064/4,065。**全程没有调用模型**，跑两次 `speaker` 幂等（第二次 `entries: 0`）。

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

### 术语表按请求过滤的效果（0.5.0）

| 游戏 | 请求数 | 每请求条目数 | 术语表条数 | 每请求相关术语 | 整表字数 | 过滤后字数 | 省 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 格闘娘はお金が無い！ | 952 | 40 | 52 | 3.3（最多 14） | 693 | 47 | **93%** |
| 常識改変者のいるギルド | 110 | 40 | 20 | 3.0（最多 11） | 272 | 46 | **83%** |

把 `minHolders` 从 5 降到 1，术语表从 52 涨到 117 条（1,791 字），
但每请求过滤后仍只有 49 字 —— 词表变大几乎不影响开销，这才是敢把阈值调低的原因。

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
- 7 款游戏做过 `install` → `uninstall` 往返，`plugins.js` 全部逐字节还原（md5 一致）；
  XOR 那款是 `7c5df17309bb01551d0ba6de2d79ca31` → 装后 `6b55d468fd539ad7cff2782f9a4712f3` → 卸载后回到原 md5。
- 运行时命中：MZ 那款 `lookups 60,781 / translated 60,779 / misses 2 / rejected 0`。

### 0.7.0 报告与退出码实测

- 格闘娘（38,044 条）：0 error / **192 warning**（kana 106、lines 61、trad 23、rejected 2），
  `verify --write-report` 生成 **38,502 B** 报告，耗时 0.34s，退出码 0。
- 桜御前（24,757 条）：0 error / **195 warning**（kana 117、trad 56、rejected 22），
  报告 35,425 B，退出码 0。
- 报告不是一坨文本：按 kind 分节、error 类排在最前、每节带一句「为什么重要/怎么修」，
  单条是「severity: 原文 -> 译文」（原文和译文各自用反引号包住）再加一行缩进 detail；
  多行原文显示成 `⏎`，文本里含反引号时自动换更长的 fence。
  这两份报告就是「终端里看不过来」的实证。
- 退出码契约：构造一条原样回显 → 打印 `result : FAILED, 1 error(s)` 且退出码 **1**；
  只有 warning 时退出码 0。两条都有 CLI 测试守着（0.7.0 之前前者是 0，测试也只断言了 stdout）。

### 0.7.1 卸载漂移实测（格闘娘，plugins.js 6.6 MB / 46 条）

用这款游戏**装之前的那份** `plugins.js` 做基线（6,649,576 B；装完后是 6,649,775 B，多出来的
199 B 就是我们那一条）：

- 干净安装 → 卸载：`createdBackup:true`，卸载 `restored:true / drifted:false`，
  `plugins.js` 的 md5 与装前**逐字节一致**，`.yakusha-backup` 被删除。
- 装后往 `$plugins` 里插一条 `OtherMod` 再卸载：`drifted:true / restored:false`，
  `keptBackup` 指向备份；`OtherMod` 还在、`YAKUSHA_Translator` 已摘掉、插件文件已删、
  备份留原地。人读输出是 `plugins.js changed after install: removed only the yakusha entry` +
  `backup kept : <path>`。
- 被改过之后再 `install`：`staleBackup:true`，打印两行 warning（
  `plugins.js changed after the backup was taken;` / `uninstall will keep those edits and only remove the yakusha entry`）。
- 边界（有测试）：如果备份本身是在「已经装过、但当时没留备份」的状态下拍的，备份里就有自己那条；
  卸载判为 drifted、保留备份、**不还原**——否则刚摘掉的条目会被备份又写回去。

### 0.8.0 `doctor` 实测（格闘娘 / 桜御前 / 四种故障）

健康状态（格闘娘，已装，字典 38,044 条）10 项检查全 ok，只有 `progress` / `rejected` 两条
warn（还有 2 条没翻、2 条被校验拒收），结尾 `verdict : usable with 2 warning(s)`、EXIT=0，
耗时约 4.0s（大头是 `verify` 遍历 38k 条；桜御前 24,757 条同样 verdict，约 0.8s）。

故障复现（每条都先用 `install` 造出健康状态，再只破坏一处）：

| 破坏方式 | doctor 的结论 | 退出码 |
| --- | --- | --- |
| 从 `$plugins` 删掉我们那条（模拟游戏更新覆盖） | `install fail the plugin file is there but its $plugins entry is gone (game update?) - run install again`，verdict broken | 1 |
| 把 `plugins.js` 写成半截 `var $plugins = [{"name":` | `plugins.js fail js/plugins.js is not readable (plugins.js: unterminated array literal) - restore it from the backup or reinstall the game`，其余检查照常输出 | 1 |
| `install --embed`（离线分发形态） | `runtime ok translations compiled into the plugin (38042 entries)` | 0 |
| 删掉 `yakusha/dictionary.json` | `dictionary fail` + `runtime fail` | 1 |

「把文件写坏」这一行是实测踩出来的：初版 `backupStatus` 直接 `parsePluginsJs`，doctor 会在
最需要它的场景下打出一段 stack trace，而不是一句「哪里坏了」。

## 7. 已知限制

1. 只处理 `data/` 里的文本；插件 `js/plugins/*.js` 里硬编码的 UI 文案不动。
2. 图片里的文字不处理。
3. MV 的 `.rpgmvp` 加密图不影响文本，但 MV 若用了别的数据混淆方案可能解不出（会报 `undecodable`）。
4. **MZ/MV 不会横向自动换行**：`Window_Base.flushTextState` 把整行一次性 `drawText`，
   超宽即裁，只有纵向 `needsNewPage` 分页。默认靠 prompt 约束，硬保证加 `--max-length`。
5. 老 MV（2019/2020 的 nw.js）不吃 `--remote-debugging-port`，MV 的运行时取证不能靠 CDP。
6. 有些 MV 游戏把说话人写成 `\N<名字>`（插件自定义标记，非 RPG Maker 转义码），译文必须原样保留。
7. 不支持 XP/VX/VX Ace（`.rxdata` 二进制）、Unity / Godot / Kirikiri / Ren'Py 等其它引擎。
8. `verify` 只看字典里的结构性问题（回显 / 转义码 / 占位符 / 换行 / 宽度 / 假名残留 /
   繁体字混入 / 说话人名漏译），看不出风格、语义是否贴切；那部分仍需人工抽读。
9. `verify` 的 width 档只在显式传 `--max-length` 时才有意义——不传就不知道窗口宽度该是多少。
   实测 4 款跑完全量翻译的游戏**没有一行超宽**（第 6 节），所以这条**故意不自动推断**：
   MV 的 `System.json` 没有 `advanced` 字段，自动推断会得到 `NaN`；而 MZ 上按
   `screenWidth` 推出的预算会把本来放得下的行也折掉（桜御前会折 1,700 行）。
10. `terms` 只挖「名字字段里有的东西」。纯 UI 词（攻击/防御/回合）、技能描述里的
    术语、正文里的地名，只要没进过数据库 name 字段就不会被挖出来。这是有意的：
    没有名字字段当锚点，任意中文串的统计没有可判定的正确答案。
11. `terms` 的判定是「正文主流译法」，不是「正确译法」。实测报出的 7 条里，
    `噴水 喷水→喷泉`、`ローパー 罗珀→触手`、`ジョッキ 大杯→精液` 属于**语义变化**
    而不是算法碎片（译文里确实 100%/55%/86% 这么写）。这类条目要不要采纳得人看，
    所以 `terms --write` 只是**建议**，真正落盘需要人再跑一次 `--glossary-only --overwrite`。
12. `translate` 按**请求内字面出现**过滤术语表（实测每请求只剩 3–4 条、693 字降到 47 字），
    所以词表变大几乎不增加单请求开销。代价是**上下文相关的术语**（只在某个场景出现的词）
    不会出现在别的场景的请求里——词表表达的是"这个词固定这么翻"，这通常是想表达的语义。
    词表上万条时过滤本身会变慢，届时再考虑加 cap。
13. `terms` 的 `--drift-only` + `--overwrite` 会**重写已有译文**。这是唯一一处
    工具会主动改动已经翻好的内容，务必先看一眼 `--dry-run` 的输出。
14. `verify` 的 `trad` 只做**单字符**层面的判断，不判断词组用法（`干`/`乾` 这类两语
    都合法的多目标字已在字表里排除）。它抓的是"模型偶发切到繁体"的那几十行，
    不是繁简风格的统一性；如果哪天要保证全篇都是简体，得另做一套字频/词表判定。
15. `verify` 的 `speaker` 只认 `\N<名字>` 这一种形态（MV 插件 `Lunatlazur_ActorNameWindow`
    的写法），且要求该游戏**至少把这个名字翻过一次**才会报「留日文」。
    全程刻意保留日文名的作品不会被报——这是有意的取舍，否则每个日式名字都会刷警告。
    名字放在别处（独立窗口参数、JSON 配置、插件参数里的 UI 词典）的插件，整套工具都看不到。
16. `speaker` 的房规**来自这份字典自己的统计**，它只会把写法统一到本作已经在用的那一种，
    不判断哪个译名更好。所以「全作只用了一种错误译名」的情况它改不出来——那需要人改一条
    字典条目（或 `--names` 给一份映射），再跑一次就能把其余统一过去。
17. `speaker --include-drift` 会**重写已有的中文译文**（实测把 38 条 `雏田` 改成 `日向`）。
    这是除 `terms --drift-only --overwrite` 之外第二处会主动改动已翻内容的入口，
    跑之前先看 `--dry-run` 的输出。
18. `verify --write-report` 写的是**生成那一刻的快照**，之后改字典不会自动更新，
    要重新跑一次；`speaker --write-names` 只列 `verify` 报 error 的那些名字
    （本作别处翻过、能机械修的不在里面），所以模板是空的**不代表名字全都对**，
    只代表没有会被拦下的问题。
19. 装后被改过时，卸载会**保留** `js/plugins.js.yakusha-backup`（它仍是装之前的那份原文）。
    工具不会自动删它：确认改动都没问题后，你可以手动删掉，或者留着当对照。
    如果这份文件以后又被改回「除自己那条以外与备份一致」，下次卸载会照常逐字节还原。
    另外，如果备份是在「已经装过、当时却没有备份」的状态下拍的（备份里含自己那一条），
    卸载同样只摘条目、不还原，避免把条目写回去；这种备份得手动删。
20. `doctor` 只诊断不修：不改字典、不重装插件、不碰游戏文件。`sync` 能发现「字典里的 key 在
    新 `data/` 里不存在」，但发现不了「游戏新增了台词」——后者要看 `extract` 报的 new 计数，
    而 `doctor` 本身不抽文本。

## 8. 下一步（backlog，按优先级）

1. **push 到 GitHub**（用户说过"顶多公布到 github"，但还没要求立即推送）。
2. 可选：给 `translate` 的 glossary 加条数上限（按请求过滤后已经省了 90%+，
   但词表上万条时仍会让每请求的过滤变慢，届时值得加）。
3. ~~给 `verify` 加 `--write-report <file>`，并把 `speaker` 的 `--names` 模板一起生成~~
   —— **0.7.0 已完成**（`--write-report` / `--write-names`，见第 3 节与第 6 节）。
4. 可选：把运行时截图驱动脚本（CDP 解冻 / readPixels 回读 / 冻结后原子渲染）整理成
   `tools/` 下的取证工具，便于以后验收新游戏时复用。**注意：这类脚本会碰游戏进程，
   不建议随工具分发，只作开发期验证用。**
5. 可选：MV 老 nw 的运行时取证目前靠临时注入脚本，如果能找到不注入的办法（例如日志钩子）更好。
6. 可选：`terms` 目前只认数据库 name 字段；若以后要挖地名/技能术语，需要另找锚点
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

# 说话人名（先看再改）
node bin/yakusha.js verify  "D:/H/Games/<game>" --kind speaker
node bin/yakusha.js speaker "D:/H/Games/<game>" --dry-run
node bin/yakusha.js speaker "D:/H/Games/<game>"                    # 按本作自己的写法修
node bin/yakusha.js speaker "D:/H/Games/<game>" --names yakusha/names.json
node bin/yakusha.js speaker "D:/H/Games/<game>" --include-drift     # 连中文写法也统一

# 名字/术语一致性（先看再改）
node bin/yakusha.js terms "D:/H/Games/<game>" --status drift
node bin/yakusha.js terms "D:/H/Games/<game>" --drift-only --write yakusha/terms.json --dry-run
node bin/yakusha.js translate "D:/H/Games/<game>" --glossary yakusha/terms.json --glossary-only --overwrite

# 发布前自检（只读）
node bin/yakusha.js verify "D:/H/Games/<game>" --max-length 48
node bin/yakusha.js verify "D:/H/Games/<game>" --kind echo,codes,slots --json
node bin/yakusha.js verify "D:/H/Games/<game>" --kind trad,speaker   # 繁简混入 / 说话人名漏译
node bin/yakusha.js verify "D:/H/Games/<game>" --write-report yakusha/verify.md   # 全部问题落成 markdown

# 说话人名字模板（只列 verify 报 error、机械修复帮不上的）
node bin/yakusha.js speaker "D:/H/Games/<game>" --write-names yakusha/names.json
# 填好 value 后：
node bin/yakusha.js speaker "D:/H/Games/<game>" --names yakusha/names.json

# 装 / 卸
node bin/yakusha.js install   "D:/H/Games/<game>"
node bin/yakusha.js uninstall "D:/H/Games/<game>"

# 装完之后：游戏更新了、中文没了，先看它
node bin/yakusha.js doctor "D:/H/Games/<game>"
node bin/yakusha.js doctor "D:/H/Games/<game>" --json
```

## 10. 工程教训（踩过的坑，别再踩）

- **命令行输出里的 `return` 会吞掉后半段**：`terms` 在 terms 为空时 `return`，把后面的 glossary 行
  （以及 --status 过滤时的提示）一起跳过了。凡是「先判断再打印剩余段落」的 CLI，都要么改成
  if/else、要么最后统一收尾。已加回归测试守着。
- **CLI 的过滤参数要同时说明「列出多少」和「挖出多少」**：只打 `4 drift` 会让人以为总共就 4 条，
  实际是 52 条里筛出 4 条。现在打 `4 of 52 mined (4 drift, 0 missing)`。
- **给"建议型"命令加 `--dry-run` 时，语义要写清楚**：`terms --dry-run` 不是"不干活"，
  而是"只报会写什么"——它本来就不碰字典。别照抄 `translate --dry-run`（那个是真不调模型）。
- **新增检查项之前先量假阳性率，别凭直觉定档位**：`trad` 第一版直接扫译文里的繁体字，
  四款游戏命中 34/67/1/12；改成"只报原文没有的字"后变成 30/64/1/**0**——最后这款的
  12 条全是日文说话人名，属于合理保留。差一步就会给用户刷 12 条无用警告。
- **一个检查的判据要能在真实数据上被推翻至少一次**：`speaker` 的"平票"处理是被
  「疲れてそうな女性」这种 1:1 的名字逼出来的——第一版按插入顺序决胜，warn 落在了
  中文那行上，方向完全反了。修复后补了专门的平票测试。
- **「只报不修」的检查要配一个能修的入口**：`verify` 的 speaker 报了 411 条，用户下一步
  要么手改 411 行、要么放弃。这类"正确答案就在同一份数据里"的问题（用 490 次的那个写法），
  应该直接给出机械修复，并让 `--dry-run` 能先看。真正的判断类问题（两种中文哪个更好）
  才留给人和显式开关。
- **白名单正则比黑名单稳**：判断"尖括号里是不是人名"时，先试了排除含 `\` `$` `[` 的内容，
  漏了 `<s[25] ? " OFF ":" ON " >` 这类带空格的；改成"内容必须是纯 CJK/假名/空白且
  长度 ≤ 40"后一次通过。
- **文档里写下的承诺，必须有测试守着**：README 和第 5 节都写着「`verify` 的 error 会让命令
  失败」，实际退出码一直是 0，因为测试只断言了 stdout 里的 `result : FAILED`。
  凡是文档里写出「会失败 / 会写盘 / 会退出」的句子，都该有一条断言；`verify --write-report` 的
  「失败时也写」同理，是专门为它加的一条 CLI 测试。
- **备份 ≠ 撤销**：回滚一个文件前，先验证「除了我改的那部分，它还是当时的样子」。`uninstall` 的
  第一版无条件用备份覆盖，等于把「装好之后所有别的改动」当作不存在——这类 bug 在测试里
  看不出来，因为测试只走「装完立刻卸」这一条最干净的路。补的测试专门在中间插一次
  「别人也改了文件」，这才是真实世界里会发生的事。
- **诊断工具遇到损坏的输入要报出来，而不是抛栈**：`doctor` 是「坏了才跑」的命令，初版
  `backupStatus` 直接解析 `plugins.js`，遇到写了一半的文件就打出一段 stack trace——
  在最需要答案的时刻给出了最没用的输出。现在解析失败变成一条 `plugins.js fail`，依赖它的
  `install` / `backup` 两项跳过，其余照常输出。凡是「输入可能已经坏掉」的入口，先想清楚
  坏了时该打印什么。

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
- 包装 LLM 调用的脚本要放在**仓库外**（临时目录里的一个 `.mjs` 即可），
  放仓库里会在清理临时文件时被误删，后台长任务整个白跑。
