# 配置与密钥（0.10 设计稿）

> **状态：0.10 设计，尚未实现。** 0.9.0 没有配置文件，provider / model / baseUrl / key
> 只来自命令行参数与环境变量。本文冻结 0.10 的 `config` 命令与读取规则。
> 平台范围见 [platforms.md](platforms.md)：0.10 只支持 Windows 10/11 x64。

## 1. 三个先定死的决定

1. **0.10 不做项目级配置。** 配置只有用户级一份，放在 `%APPDATA%\yakusha\config.json`。
   游戏目录里的任何文件都不能改变 provider、baseUrl 或密钥。
2. **0.10 不把密钥写到磁盘。** 密钥只来自 `--api-key` 或环境变量。`config` 文件里
   没有 `apiKey` 这个键；出现也忽略并警告。
3. **0.10 不声称“文件权限能保护密钥”。** Windows 上 `chmod 0600` 实测无效
   （`mode & 0o777` 仍是 `0o666`），所以不设计“写一个 0600 文件存 key”的方案。
   GUI 的“记住密钥”留到 0.11，用 Electron `safeStorage`（Windows 上是 DPAPI）单独存。

这三条一起消掉了评审里的两个阻断项：项目配置把密钥重定向到攻击者端点、
Windows 上无法满足 0600。0.10 的配置里没有秘密，分享游戏目录也不会带出秘密。

## 2. 文件位置与格式

- 默认：`%APPDATA%\yakusha\config.json`（即 `C:\Users\<name>\AppData\Roaming\yakusha\config.json`）。
- 测试/高级用户：`YAKUSHA_CONFIG_DIR` 指定**目录**（不是文件），必须是绝对路径；
  文件固定叫 `config.json`。不做 `~` 展开，不读 XDG / `Application Support`。
- 目录不存在时，读取按“没有配置”处理；写入时创建目录（含父目录）。
- `APPDATA` 缺失且没有 `YAKUSHA_CONFIG_DIR` → `E_CONFIG`，消息说明缺哪个变量。

格式：

```json
{
  "schema": 1,
  "provider": "openai",
  "model": "gpt-4o-mini",
  "baseUrl": "https://api.openai.com/v1"
}
```

- `schema` 缺省按 `1` 处理（方便手写）；写入时总是写 `"schema": 1`。
- 未知键**保留**：`config set` / `unset` 只改目标键，不丢别人的字段。读取时忽略未知键。
- 文件里出现 `apiKey` / `key` / `token` / `authorization` 时：**忽略并 warn**，
  绝不使用、绝不在 `config list` 里回显值。
- 文本编码 UTF-8；写入用 2 空格缩进、LF、末尾一个换行，便于 diff。

## 3. 键与校验

| 键 | 类型 | 默认 | 校验 |
| --- | --- | --- | --- |
| `provider` | 字符串 | `openai` | `openai` / `compatible` / `mock`；`compatible` 是 OpenAI 兼容端点的别名 |
| `model` | 字符串 | `gpt-4o-mini` | 非空、≤200 字符、不含控制字符 |
| `baseUrl` | 字符串 | `https://api.openai.com/v1` | 绝对 `http(s)` URL；不含 userinfo、query、fragment；≤2000 字符；去掉结尾 `/` |

无效值分两种处理：

- **读取时**：warn 并忽略该键，回退到下一优先级。配置文件坏掉不应该让翻译完全跑不了。
- **`config set` 时**：`E_USAGE`，不写盘。用户明确要设一个值，就不该悄悄存进去。

`config set apiKey ...` 一律 `E_USAGE`，消息直接说“密钥不落盘，请用
`YAKUSHA_API_KEY` 或 `--api-key`”。

## 4. 优先级

| 值 | 从高到低 |
| --- | --- |
| provider | `--provider` → 配置文件 → 默认 `openai` |
| model | `--model` → `YAKUSHA_MODEL` → 配置文件 → 默认 `gpt-4o-mini` |
| baseUrl | `--base-url` → `YAKUSHA_BASE_URL` → 配置文件 → 默认 |
| apiKey | `--api-key` → `YAKUSHA_API_KEY` → `OPENAI_API_KEY` → 空（报错由 provider 决定） |

- 环境变量高于配置文件：CI 和临时切换端点不需要改用户的文件。
- `--dry-run` 强制 `mock`，**不读配置文件**，所以配置文件坏了也能离线跑。
- `--glossary-only` 不调用模型；配置文件坏了只 warn，不阻断（它不需要 key）。
- `--provider mock` 显式指定时不读 key；`baseUrl` 也不参与。

## 5. `config` 命令

```
yakusha config list
yakusha config get <key>
yakusha config set <key> <value>
yakusha config unset <key>
```

所有子命令都支持 `--json`；信封与退出码遵循 [json-contract.md](json-contract.md)，
`command` 是 `"config"`，载荷里的 `action` 是 `"list" | "get" | "set" | "unset"`。
`config` 不接游戏目录，也不读项目。

### 5.1 `list`

载荷：

```json
{
  "action": "list",
  "file": "C:\\Users\\me\\AppData\\Roaming\\yakusha\\config.json",
  "exists": true,
  "values": {
    "provider": { "value": "openai", "source": "default" },
    "model": { "value": "gpt-4o-mini", "source": "file" },
    "baseUrl": { "value": "https://api.openai.com/v1", "source": "default" }
  },
  "apiKey": { "set": true, "source": "YAKUSHA_API_KEY" }
}
```

- `source`：`file` / `env` / `default`。`env` 只可能出现在 `model` 与 `baseUrl`。
- `apiKey` 只报“有没有、来自哪个变量”，永不回显值。
- `baseUrl` 不是默认值时，文本模式额外打一行 warning，提示请求会发往该地址；
  JSON 模式该 warning 走 stderr，不污染 stdout。
- 文件损坏 / `schema` 不支持：`E_CONFIG`。用户来查配置，就应该看到“文件坏了”，
  而不是一份看似正常的默认值。

### 5.2 `get`

```json
{
  "action": "get",
  "key": "model",
  "value": "gpt-4o-mini",
  "source": "file"
}
```

`key` 只接受 `provider` / `model` / `baseUrl`；`apiKey` → `E_USAGE`。

### 5.3 `set` / `unset`

```json
{
  "action": "set",
  "key": "model",
  "value": "deepseek-chat",
  "file": "C:\\Users\\me\\AppData\\Roaming\\yakusha\\config.json",
  "changed": true
}
```

- 文件不存在时创建；父目录不存在时创建。
- 值相同 → `changed: false`，仍然 `ok`。
- `unset` 一个不存在的键 → `changed: false`，`ok`（幂等）。
- 写入是“同目录临时文件 + rename 覆盖”；失败时原文件保持不动，临时文件清理，
  返回 `E_IO`（目录不可写也是它）。
- 写之前重新读一遍文件并保留未知键；不要用“内存里的默认值”整体覆盖用户文件。
- 文件损坏时**拒绝写**：`E_CONFIG`，提示先修好或删除。这样不会把用户手写的内容冲掉。

## 6. 读取与损坏处理

`loadConfig()` 的规则：

1. 没有文件 → 返回默认值，`exists:false`，不 warn。
2. 读失败（权限等）→ `E_IO`；这是环境问题，不该假装没配置。
3. JSON 解析失败 → warn 一行（含文件路径与“using defaults”），返回默认值，`broken:true`。
4. `schema` 不是 `1` → warn（`unsupported config schema N; ignoring`），返回默认值。
5. 已知键值非法 → 每个键 warn 一行，忽略该键。
6. 未知键忽略；敏感键名忽略并 warn。
7. 顶层不是对象（数组、字符串、`null`）→ 按损坏处理。

翻译命令在 `broken:true` 时继续（除非用户显式跑 `config` 子命令），因为“配置坏了”
不应该让一个已经能跑的离线流程停摆。但`config list/get/set/unset` 遇到同样的文件
必须报 `E_CONFIG`，让问题可见。

## 7. 威胁模型

| 场景 | 0.10 的处理 |
| --- | --- |
| 恶意游戏目录想偷 key | 没有项目级配置；工具不执行游戏代码；游戏文件只被当作数据读取。 |
| 恶意游戏目录想改 baseUrl | 同上，游戏目录无法写用户配置。 |
| 用户配置文件里的 baseUrl 被改 | 这是用户目录被改，已在同一权限边界内；`config list` 显示实际地址并 warn 非默认值。 |
| `--api-key` 出现在进程命令行 | 同机同用户的进程可能看到；文档建议用环境变量。 |
| 密钥泄露进日志 / JSON / 报告 | 错误统一脱敏（`sk-` / `Bearer` / userinfo），provider 响应体不进 `message`。 |
| 启动游戏时把 key 传给子进程 | `launch` 复制环境变量后删除 `YAKUSHA_API_KEY` 与 `OPENAI_API_KEY` 再 spawn。 |
| 分享游戏目录 / 字典 / 导出文件 | 它们不含配置；配置在 `%APPDATA%`，不会被装进游戏目录。 |
| 备份/同步 `%APPDATA%` | 文件里没有 key，风险低于“把 key 写进文件”。 |
| 符号链接攻击配置文件 | 本地同用户场景，不把配置文件当安全边界；写入用临时文件 + rename。 |

明确不做的：不实现“配置加密”、不实现“便携模式把配置放游戏目录”、不实现
“按项目覆盖 provider/baseUrl”。加密一个不含密钥的文件没有意义；后两者都会把
配置变成可随游戏分发的攻击面。

## 8. 与 0.11 / 0.12 的边界

- **0.11（GUI）**：主进程用 Electron `safeStorage.encryptString()` 存 key（Windows 走 DPAPI），
  存在 `%APPDATA%\yakusha\credentials`，只有用户勾选“记住密钥”才写；读不出来时提示重输，
  不回退到明文。CLI 仍不读这个文件，避免两套密钥来源打架。
- **0.12（项目级配置）**：只在有明确需求时做，且必须是字段白名单（例如 `maxLength`、
  术语表路径），**永远不允许** `apiKey` / `baseUrl` / `provider`。
- **不做**：`YAKUSHA_CONFIG` 指向任意文件、环境变量里放整份 JSON、注册表配置。
  这些都会扩大解析面，收益不足。

## 9. 验收清单

- [ ] `config set/get/list/unset` 在临时 `YAKUSHA_CONFIG_DIR` 下全绿；文件内容可预测。
- [ ] `config set apiKey` 返回 `E_USAGE`，且临时目录里没有出现密钥字符串。
- [ ] 文件损坏时：翻译仍能跑（warn）；`config list` 返回 `E_CONFIG`；`config set` 不覆盖。
- [ ] 未知键在 `set` / `unset` 后仍保留。
- [ ] 优先级测试：flag > env > file > default；`--dry-run` 不读配置。
- [ ] `config list` 不回显 key，只报 `set` 与来源。
- [ ] `launch` 的 child env 里没有 `YAKUSHA_API_KEY` / `OPENAI_API_KEY`（用注入的 spawn 断言）。
- [ ] Windows CI 通过；测试不写 `chmod` 断言。
