# 02 · Codex 配置全解剖

> 状态：**基线文档**（基于 Codex Desktop 26.818.41509 / Codex CLI 实测与本机 `~/.codex` 脱敏样例） · 关联：[03-映射规范](03-映射规范.md)

本文回答一个问题：**Codex 在 `~/.codex`（Windows：`C:\Users\<用户>\.codex`）里到底存了什么，哪些是可迁移资产，哪些是运行时/秘密。**

## 1. 目录总览

```
~/.codex/
├── config.toml                 # ★ 主配置（模型 / MCP / 市场 / 插件 / 项目信任 / 桌面偏好）
├── AGENTS.md                   # ★ 全局代理规则（模型每会话注入）
├── instructions.md             # 旧版全局指令（若存在，与 AGENTS.md 合并语义）
├── skills/                     # ★ 技能目录（市场安装 + 用户安装）
│   ├── <skill-name>/SKILL.md   #    技能定义（frontmatter: name/description）
│   │   └── scripts/...         #    技能附带脚本
│   ├── .system/                #    运行时内置技能（Codex 自身，不迁移）
│   └── .ccpanes-default-skills-version
├── sessions/                   # ★ 会话历史
│   └── YYYY/MM/DD/rollout-*.jsonl
├── memories/                   # ★ 记忆（[features]/[memories] 开启时）
├── plugins/                    # 官方插件运行时（browser/computer-use/...，随 Codex 分发）
│   └── cache/openai-bundled/...
├── auth.json                   # ⛔ 凭据（ChatGPT 登录 token / refresh token）—— 绝不迁移
├── .codex-global-state.json    # ⛔ 全局状态（provider 认证、设备指纹等）—— 绝不迁移
├── chrome-native-hosts*.json   # ⛔ Chrome 原生消息桥配置（含本地端口）
├── history.jsonl               # CLI 交互历史（纯本地，无迁移价值）
├── *.sqlite（goals/logs/memories/queue/state/thread_history）
│                               # 运行时状态库（含记忆库 memories_1.sqlite）
└── config.toml.bak-*           # 用户手工备份（可参考，不迁移）
```

> ⚠️ 上面标 ⛔ 的项属于**凭据/运行时**，本项目一律只"存在性报告"，不读取内容、不迁移。标 ★ 的是可迁移资产。

## 2. `config.toml` 逐节解剖

本机实测（**密钥已脱敏**，仅保留结构）：

```toml
# ── 模型与 Provider ──────────────────────────────────────────
model_provider = "custom"              # 当前使用的 provider 名
model = "deepseek-v4-flash"            # 当前模型
model_reasoning_effort = "max"         # 推理强度
disable_response_storage = true        # 不存储响应（隐私开关）

notify = [ "C:\\...\\codex-computer-use.exe", "turn-ended" ]   # 桌面通知钩子（忽略）

# 自定义 provider 定义
[model_providers.custom]
name = "Hi-Code"                       # 展示名
base_url = "http://127.0.0.1:15721/v1" # 端点
wire_api = "responses"                 # responses | chat
requires_openai_auth = true
experimental_bearer_token = "PROXY_MANAGED"   # ⚠️ 可能是敏感占位/令牌

# ── MCP 服务器（★ 迁移重点）──────────────────────────────────
[mcp_servers."google-mcp-toolbox"]
type = "stdio"                         # stdio | sse | http
command = 'C:\\Users\\...\\toolbox.exe'
args = ["--config", "C:\\...\\tools.yaml", "--stdio", "--disable-reload"]
startup_timeout_sec = 120

[mcp_servers."kingbase-gchgz-dsj-dev"]
type = "stdio"
command = "npx"
args = ["universal-db-mcp", "--permission-mode", "readwrite", "--type", "kingbase",
        "--host", "192.168.10.99", "--port", "54322", "--user", "system",
        "--password", "****", "--database", "dsj"]        # ⚠️ 内嵌密码！
startup_timeout_sec = 120

[mcp_servers."oracle-oldprovince-orcl-dev"]
type = "stdio"
command = "npx"
args = ["universal-db-mcp", "--type", "oracle", "--host", "192.168.10.100",
        "--port", "1521", "--user", "jxjzfpdb", "--password", "****",
        "--database", "orcl", "--oracle-client-path", 'D:\\app\\...\\dbhome_1\\BIN']
startup_timeout_sec = 120

[mcp_servers."oracle-oldprovince-orcl-dev".env]           # 服务器级环境变量
PATH = 'D:\\app\\...\\dbhome_1\\BIN;${PATH}'

[mcp_servers.node_repl]                                    # 运行时自带服务器（不迁移）
command = 'C:\\Users\\...\\Codex\\runtimes\\cua_node\\...\\node_repl.exe'
args = []
startup_timeout_sec = 120
[mcp_servers.node_repl.env]
NODE_REPL_TRUSTED_SERVICES = '{"browser":"...","sky":"@oai/sky/service"}'
CODEX_CLI_PATH = 'C:\\...\\codex.exe'

# ── 市场与插件（运行时绑定 Codex 分发，仅报告）───────────────
[marketplaces.openai-bundled]
source_type = "local"
source = '\\?\\C:\\Users\\...\\.codex\\.tmp\\bundled-marketplaces\\openai-bundled'

[plugins."browser@openai-bundled"]
enabled = true
# ... (pdf / spreadsheets / presentations / chrome / computer-use / visualize ...)

# ── 平台与特性 ──────────────────────────────────────────────
[windows]
sandbox = "elevated"                   # windows 沙箱级别（elevated | restricted）
[features]
memories = true                        # 记忆开关
js_repl = false

# ── 项目信任（★ 可迁移为建议）───────────────────────────────
[projects.'d:\projects\gchgz-backend']
trust_level = "trusted"                # trusted | untrusted | ...

# ── 记忆开关 ────────────────────────────────────────────────
[memories]
generate_memories = true
use_memories = true

# ── 桌面外观（❌ 不迁移，DSH 皮肤体系不同）───────────────────
[desktop]
selected-avatar-id = "custom:jiaran"
sansFontSize = 16
codeFontSize = 14
[desktop.appearanceLightChromeTheme]   # accent / contrast / ink / surface ...
[desktop.appearanceDarkChromeTheme]
```

### 2.1 字段级速查表（config.toml）

| 节 / 字段 | 类型 | 语义 | 迁移判定 |
| --- | --- | --- | --- |
| `model` | string | 当前模型 | ➡️ 映射 `settings.yaml: agent-default-model.model`（建议） |
| `model_provider` | string | 当前 provider 名 | ➡️ 建议（需目标 DSH 侧存在同名 provider 配置） |
| `model_reasoning_effort` | string | 推理强度 | ➡️ `agent-default-model.reasoningEffort`（建议） |
| `disable_response_storage` | bool | 隐私开关 | 📋 报告（DSH 无直接对应，提示用户） |
| `[model_providers.<name>]` | table | 自定义端点 | ⚠️ 仅生成建议；`base_url` 可迁移，`experimental_bearer_token` **脱敏** |
| `[mcp_servers.<name>]` | table | **MCP 服务器** | ✅ **镜像核心**（见 [03-映射规范 §3](03-映射规范.md#3-mcp-服务器镜像)） |
| `type` | string | `stdio`/`sse`/`http` | 映射 DSH MCP client 的 transport 声明 |
| `command` / `args` | string / array | 启动命令 | 原样保留（路径存在性校验后提示） |
| `env` | table | 环境变量 | 保留；含 `${VAR}` 的做变量透传；含凭据的建议改为 env 引用 |
| `startup_timeout_sec` | int | 启动超时 | 保留为建议值 |
| `[marketplaces.*]` | table | 市场源 | 📋 仅报告（Codex 分发绑定） |
| `[plugins.*]` | table | 插件启用 | 📋 仅报告（含许可证/分发问题，见 01-总体架构 Non-Goals） |
| `[windows].sandbox` | string | 沙箱级别 | 📋 对照 DSH `permission.defaultPreset` 给出建议 |
| `[features]` / `[memories]` | table | 记忆开关 | ✅ 决定记忆迁移范围 |
| `[projects.<path>]` | table | 项目信任 | ✅ 生成 DSH 侧项目级建议（如指令资产挂载范围） |
| `[desktop]` / 主题 | table | 外观 | ❌ 不迁移（报告即可） |

## 3. 技能目录 `~/.codex/skills/`

结构（Codex 市场技能格式）：

```
skills/<name>/
├── SKILL.md        # frontmatter(name/description) + 正文（可含脚本说明）
└── scripts/        # 附带脚本（bash/python/node/...，由 SKILL.md 引用）
```

**实测样例**（本机市场安装的技能名）：`ccpanes-*` 系列（browse-sessions / parallel-run / plan2codex / memory-dual-write ...）、`find-skills`、`hatch-pet`、`codex-primary-runtime`、`.system`（隐藏运行时技能）。

SKILL.md frontmatter 示例（标准 Codex 技能）：

```markdown
---
name: find-skills
description: 检索已安装技能并给出使用方法。
---

（正文：何时使用、流程、注意事项）
```

**迁移要点**：市场随 Codex 分发的技能（`.system`、`codex-primary-runtime`、`openai-bundled` 系）**不迁移**；用户/第三方技能（ccpanes 等，MIT 或开源许可）可迁移。判断依据：技能目录内是否含 Codex 分发标记（`.system`、marketplace 锁文件），以及许可证声明。

## 4. 全局指令

| 文件 | 语义 | 迁移目标 |
| --- | --- | --- |
| `~/.codex/AGENTS.md` | **全局代理规则**（每次会话注入，优先级高于技能） | DSH 指令资产（全局级）或 preset 系统提示 |
| `~/.codex/instructions.md` | 旧版全局指令（Codex 曾用，现合并进 AGENTS.md 语义） | 同上（存在时合并） |
| 项目根 `AGENTS.md` | 项目级规则 | 报告存在性；DSH 侧项目级指令资产建议（挂到 workspace） |

> 本机实测 `AGENTS.md` 为中文规则集（含"指令优先级：用户要求 > 仓库规则 > 本文件 > 技能 > 平台默认提示"等层级设计），迁移时必须**保留原文完整性与优先级语义**，不做摘要改写。

## 5. 会话历史 `~/.codex/sessions/`

```
sessions/YYYY/MM/DD/rollout-*.jsonl     # 每日会话文件（Codex wire 格式）
```

- 由 `import_codex`（dsh-chat-import）消费：解析 `user/assistant/function_call/custom_tool_call` 消息、还原工具调用与结果、支持增量续写与 force 副本。
- 本插件 `migrate_codex_sessions` **委托**该工具，只做：统计规模 → 提示调用 `import_codex` → 关联台账。

## 6. 记忆 `~/.codex/memories/` 与 `memories_1.sqlite`

- `[features].memories` / `[memories]` 开启后，Codex 会持久化长期记忆（`memories_1.sqlite` + `memories/` 目录）。
- SQLite 结构随版本变化，迁移策略：**优先读 `memories/` 目录下的可读资产（如 `*.md`）**；SQLite 不可用时降级为"仅报告存在 + 引导用户自查"。
- 迁移目标：DSH 记忆资产（`~/.dsh/memories/` 或 DSH 记忆目录），格式化为可检索的条目。

## 7. 凭据与运行时文件（⛔ 绝不迁移）

| 文件 | 内容 | 处理 |
| --- | --- | --- |
| `auth.json` | ChatGPT 登录凭据（token/refresh） | 只报告存在，不读取 |
| `.codex-global-state.json` | provider 认证、设备状态 | 只报告存在，不读取 |
| `chrome-native-hosts*.json` | Chrome 桥接（本地端口/密钥） | 只报告存在 |
| `notify` / `node_repl` MCP 等 | 运行时内部服务器 | 迁移时**默认排除**（名称匹配 `node_repl`、路径含 `Codex\runtimes` 或 `openai` 运行时目录的服务器） |

## 8. 脱敏样例的来源说明

本文所有样例来自本机 `~/.codex` 实测，**密码、token、用户名路径已替换为 `****` / 截断**。开发测试请使用仓库内 `test/fixtures/` 的脱敏夹具，禁止把真实配置提交入库（见 [09-安全边界](09-安全边界.md) §5）。
