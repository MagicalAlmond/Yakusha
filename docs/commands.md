# 命令参考

十个命令的完整选项、判据与实测数据。上手流程见 [README](../README.md)。

> **0.10 会改契约的部分（设计稿，尚未实现）**：`--json` 统一信封、错误码、
> 退出码 0/1/2、严格参数解析、`scan.version` 改名 `engineVersion`，以及新增
> `config` / `export` / `launch`。冻结内容见
> [json-contract.md](json-contract.md)；引擎与启动契约见 [engines.md](engines.md)；
> 配置见 [config.md](config.md)；导出见 [export-format.md](export-format.md)。
> 本文描述的是**当前 0.9 的行为**，两者冲突时以本文为准，直到 0.10 发布。

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
  doctor      查安装、备份、字典是否还与这版游戏对得上

translate:
  --provider <name>   openai / compatible / mock（真实调用必须显式指定）
  --model <name>      模型 id（真实调用必须配置）
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
  --dry-run           强制 mock provider、不落盘、不读配置
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

全局选项（所有命令都支持）：
  --json              机器可读输出
```

## 环境变量


| 变量 | 用途 |
| --- | --- |
| `YAKUSHA_API_KEY` | API key（真实调用必须配置；回退到 `OPENAI_API_KEY`） |
| `YAKUSHA_MODEL` | 模型 id（无默认，真实调用必须配置） |
| `YAKUSHA_BASE_URL` | 端点（OpenAI 官方为默认；`compatible` 必须显式配置） |

## terms：挖出人名/术语的主流译法


```bash
node bin/yakusha.js terms "/games/MyGame"
```

字典里 `Actors.json:name` 这类名字条目只有几百个，但它们在正文里被提到几千次。这条
命令把正文里**实际在用的译法**统计出来，和名字条目比对：对不上就叫 drift。

匿名案例（MZ-A，38,044 条）：名字表写的是「アリア → 艾莉亚」，但提到她的 3,653 行里
**96% 写的是「阿莉亚」**，只有 4% 用名字表的写法。这不是算法挑剔，是名字表本身错了。

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

实测四款游戏：MZ-A `names 510/612, mined 52, drift 5`；MV-G `156/215, 20, 2`；
MV-H `145/148, 6, 0`；MZ-G `45/45, 3, 0, missing 3`（官方中文，名字表反而缺）。

## doctor：装好之后，游戏更新了怎么办


最常遇到的事故是「游戏更新以后中文没了」。三种原因外观一样，`doctor` 把它们分开：

```bash
node bin/yakusha.js doctor "/games/MyGame"
```

```
game      : Example Game (RPG Maker MZ 1.7.0, 51 data files)
  engine      ok    RPG Maker MZ 1.7.0
  dictionary  ok    38044 entries (38042 translated, 2 pending, 2 rejected)
  progress    warn  2 entries are still empty - run: yakusha translate <game>
  rejected    warn  2 entries failed validation - run: yakusha verify
  sync        ok    every dictionary key still appears in data/
  install     ok    js/plugins/YAKUSHA_Translator.js registered in js/plugins.js
  backup      ok    uninstall can restore js/plugins.js byte for byte
  runtime     ok    yakusha/dictionary.json (found)
  verify      ok    0 error, 192 warning(s)
verdict   : usable with 2 warning(s)
```

| 症状 | 看哪一行 | 怎么办 |
| --- | --- | --- |
| 中文全没了，插件文件还在 | `install  fail` | 重跑 `install`（`$plugins` 里的条目被更新覆盖了） |
| 游戏一启动就报错 | `plugins.js  fail` | 从 `js/plugins.js.yakusha-backup` 恢复，或重装游戏 |
| 一部分台词变回日文 | `sync  warn` | 重跑 `extract` 补上新 key，再 `translate` |
| 部署版 MV 把游戏放在 `www/` 下 | `runtime  ok` | 不用管，插件在根目录和 `www/` 下都会找 |

`sync` 是最有用的那一行：它把字典每个 key 拿回 `data/` 里找一遍。游戏更新改写了台词，
key 就找不到了——这比插件坏了更常见，而且不重新抽文本就发现不了。

结尾四种：`broken`（有 fail，退出码 1）、`not installed`（还没装）、`usable`（能用但
有警告）、`ready`（全绿）。`--json` 输出完整的 `checks` 数组。`warn` 不让命令失败——
诊断不该因为「还有 2 条没翻」就把脚本打断。

## verify：发布前自检


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

## speaker：修掉没翻的说话人名


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

实测 MV-H：`verify` 报 411 个 speaker error，`speaker` 一次改掉
414 条（23 个名字），剩 3 条是全文未译的名字，`--names` 补上后 error 归零；
再用 `--include-drift` 把 8 个存在多种写法的名字（例如「写法 A」改成「写法 B」）
统一到主流写法，warn 也从 51 归零。两轮都只改字典，不调用模型。

## 术语表（glossary）


人名、技能名、选项这类必须锁定一致性的词，用人工词表覆盖，不经过模型：

```bash
node bin/yakusha.js translate "/games/MyGame" --glossary my-terms.json
```

```json
{
  "entries": {
    "アリア": "艾莉亚",
    "ゴブリン": "哥布林",
    "はい": "是",
    "いいえ": "否"
  }
}
```

词表命中直接写入（同样过校验），其余条目才发给模型；`--glossary-only` 则完全不联网。

手工词表之外，`terms` 能从字典自身挖出术语表（见上文 terms 一节），格式与这里完全一致，可以直接当
`--glossary` 用。

实测在 38,044 条唯一串的游戏上，127 条人工词表覆盖了 **18.4% 的文本出现次数**——
术语表划算，但长尾极重（前 5000 条才覆盖 42%），**剧情的机器翻译必须跑全量**。
