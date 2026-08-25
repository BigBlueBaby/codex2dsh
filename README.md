<div align="center">

# 🔁 Codex2DSH

**把 Codex（OpenAI Codex CLI / Desktop）的 MCP 服务器、技能、全局配置、记忆，一键迁移进 DeepSeek Harness（DSH）—— 全程可视化操作，无需命令行。**

[![npm version](https://img.shields.io/npm/v/codex2dsh?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/codex2dsh)
[![npm downloads](https://img.shields.io/npm/dm/codex2dsh?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/codex2dsh)
[![CI](https://img.shields.io/github/actions/workflow/status/BigBlueBaby/codex2dsh/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/BigBlueBaby/codex2dsh/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Node.js >= 22.13](https://img.shields.io/badge/Node.js-%3E%3D22.13-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)
[![dsh >= 0.1.x](https://img.shields.io/badge/dsh-%3E%3D0.1.x-4A90D9?style=for-the-badge)](docs/01-总体架构.md)

[🖥️ 可视化使用指南](#-可视化使用指南) · [📥 安装](#-安装) · [✨ 功能](#-功能) · [🔒 安全说明](#-安全说明) · [❓ 常见问题](#-常见问题) · [📚 文档](#-文档)

</div>

> **一句话**：Codex 的配置是资产，不是牢笼。`codex2dsh` 帮你把多年积累的 MCP 服务器、技能、全局规则、记忆、**会话历史**「翻译」成 DSH 原生形态——**迁移全程可视化操作、源码只读、密钥按原样迁移、dry-run 预览、人工确认**。

> **搜索关键词**：Codex → DeepSeek Harness 迁移 · MCP 服务器镜像 · 技能（Skills）转换 · 全局指令（AGENTS.md）· 记忆迁移 · 会话历史导入 · DSH 插件 · 可视化迁移面板 · 无命令行迁移

---

## 📸 截图预览

| 插件首页：状态总览 + 迁移选项 + 全量迁移向导 + 分类迁移卡片 | 插件底页：分类卡片（含会话导入「修复标题」）+ 最近结果 |
| --- | --- |
| ![插件首页](https://raw.githubusercontent.com/BigBlueBaby/codex2dsh/main/assets/screenshot-panel-top.png) | ![插件底页](https://raw.githubusercontent.com/BigBlueBaby/codex2dsh/main/assets/screenshot-panel-bottom.png) |

---

## 🖥️ 可视化使用指南（推荐）

### 打开迁移面板

安装插件并**重启 DSH** 后：

1. 打开 **设置 → 插件**
2. 找到 **「Codex 迁移」** 标签页
3. 面板包含 5 个区域，从下到上操作即可完成迁移

### 面板功能一览

| 区域 | 功能 |
| --- | --- |
| **① 状态总览** | 源配置根路径、全部可迁移资产清单（MCP/技能/指令/记忆/会话）、迁移台账条数、凭据文件黄色警告 |
| **② 迁移选项** | 「密钥脱敏」开关（默认**原样迁移**，直接可用）、「随迁本地工具目录」开关（默认开） |
| **③ 全量迁移向导** | 一键走完 **1 预览 → 2 选择 → 3 执行 → 4 完成** 四步全流程（推荐首次迁移使用） |
| **④ 分类迁移** | 7 张独立卡片：MCP 服务器、技能、全局指令、记忆、配置建议、会话导入、迁移体检——每张卡片有勾选清单 + 「预览 / 执行」按钮 |
| **⑤ 最近结果** | 最近一次执行的徽章式结果（已迁移=绿 / 跳过=灰 / 无效=红 / 预览=蓝）+ 警告列表 |

### 推荐流程（首次迁移）

1. **看状态**：打开面板先看「状态总览」——确认源配置根正确、了解有哪些资产、注意黄色凭据警告
2. **走向导**：点「开始全量迁移」
   - **第 1 步 预览**：查看各分类资产规模（零副作用）
   - **第 2 步 选择**：勾选要迁移的分类；MCP 与技能可在下方分类卡片细化勾选
   - **第 3 步 执行**：自动按 MCP → 技能 → 指令 → 记忆 → 配置 顺序执行，显示进度
   - **第 4 步 完成**：查看每类结果汇总（成功 / 跳过 / 警告）
3. **细化选择（可选）**：在「分类迁移」里
   - **MCP 服务器**：勾选要迁移的服务器（如只留 `google-mcp-toolbox`），本地工具目录会自动随迁并重写路径
   - **技能**：勾选想要的技能；用「排除前缀」批量取消勾选整套技能（如输入 `ccpanes-` 排除全部 ccpanes 技能）
4. **收尾**：迁移产物（如 `mcp-mirror.cordis.yml`）生成后，按产物中的提示**人工审阅**并合并进 DSH profile 即可使用（见 [常见问题](#mcp-迁移后如何让-dsh-真正用上这些服务器)）

> 💡 每个「执行」按钮点击前都有确认框；所有写盘操作默认先「预览」，确认后再执行。

---

## 📥 安装

### 环境要求

- Node.js ≥ 22.13
- DeepSeek Harness `dsh` ≥ 0.1.x（本插件在 `0.1.1-rc.2` 实测）
- 本机已有 Codex 配置（`~/.codex/`，Windows 为 `C:\Users\<你>\.codex\`）

### 方式一：npm 包安装（推荐）

```bash
# DSH Desktop 用户（desktop profile）：
dsh plugin --profile desktop add codex2dsh

# 或 dsh CLI / Web profile 用户：
dsh plugin --profile web add codex2dsh
```

安装后**重启 DSH**，即可在「设置 → 插件」看到「Codex 迁移」面板。

### 方式二：本地开发 / 试用最新版

```bash
dsh plugin --profile desktop add -w link:D:/Projects/codex2dsh   # 替换为你的项目路径
```

> 卸载：`dsh plugin --profile <name> remove codex2dsh`，已迁移的资产不会被删除。

---

## ✨ 功能

| 能力 | 入口 | 说明 |
| --- | --- | --- |
| 🖥️ **可视化迁移面板** | 设置 → 插件 → Codex 迁移 | 状态总览 + 迁移选项 + 全量迁移向导（预览→选择→执行→完成）+ 分类迁移卡片 + 结果徽章 |
| **全量迁移向导** | 面板「开始全量迁移」 | 四步向导一键迁移全部资产，逐步展示进度与结果 |
| **MCP 镜像** | 面板 MCP 卡片 / `migrate_codex_mcp` | 解析 `config.toml` 的 `[mcp_servers.*]` 生成可合并的 DSH MCP client YAML；**密钥默认原样迁移**（可选脱敏）；`include/exclude` 选择性迁移；**本地工具目录（如 mcp-toolbox）随迁并重写路径** |
| **技能转换** | 面板技能卡片 / `migrate_codex_skills` | `~/.codex/skills/<name>/SKILL.md` → DSH 技能资产（frontmatter 适配 `kind: dsh`），脚本目录随迁，冲突自动消歧、幂等跳过；支持**按前缀批量排除**（如 `ccpanes-`） |
| **全局指令** | 面板指令卡片 / `migrate_codex_instructions` | `AGENTS.md` / `instructions.md` → DSH 指令资产（原文完整保留），项目级规则给出挂载建议 |
| **记忆迁移** | 面板记忆卡片 / `migrate_codex_memory` | Codex 记忆（含 sqlite 只读探测）→ DSH 记忆资产，不可读时降级报告 |
| **配置建议** | 面板配置卡片 / `migrate_codex_config` | 模型 / Provider / 权限 / 项目信任 → 只读建议片段（绝不自动改 `settings.yaml`） |
| **会话导入** | 面板会话卡片 / `migrate_codex_sessions` | 统计会话规模并委托 `import_codex`（dsh-chat-import）导入为可续聊会话 |
| **会话标题回填** | 面板会话卡片「修复标题」/ `codex2dsh_fix_titles` | `import_codex` 不写 `session/title` 事件导致中文标题丢失（显示成工作区名）：从 `~/.codex/session_index.jsonl` 的 `thread_name` 或 rollout 首条真实提问回填标题（只补不覆盖、幂等、live 会话跳过）；委托导入后自动执行 |
| **坏标题修复** | CLI `codex2dsh repair-titles` | 修复 0.1.1 早期缺陷误写的 `session/title` surfaceOp 坏事件（会话打不开 `SessionPersistenceCorruptionError`）；截断式修复零数据丢失，修复后重启 DSH 再回填 |
| **工作区归组** | 面板会话卡片「整理工作区」/ `codex2dsh_regroup_sessions` / CLI `codex2dsh regroup` | Codex 非工作区会话（projectless）迁移后每个会话一个独立工作区、列表乱序：统一改写 header.cwd 并移动日志目录，归入单个 DSH 工作区（`projectless-thread-ids` 权威判定；其余会话不动；执行后重启 DSH） |
| **迁移体检** | 面板体检卡片 / `codex2dsh_doctor` | 逐资产状态：已迁移 / 待迁移 / 不可迁移 / 密钥残留 |
| **命令行** | `codex2dsh` | 无 GUI 环境的同能力 CLI：`preview / mcp / skills / instructions / memory / config / sessions / titles / repair-titles / regroup / doctor / ledger` |

---

## 🔧 命令行（可选）

```bash
codex2dsh preview                      # 只读预览全部可迁移资产
codex2dsh mcp --apply                  # 生成 MCP 镜像（密钥默认原样；--mask-secrets 脱敏）
codex2dsh skills --apply --exclude ccpanes-*   # 技能迁移（排除 ccpanes）
codex2dsh titles                       # 预览：哪些导入会话缺标题、将补什么标题
codex2dsh repair-titles --apply        # 修复坏标题事件（0.1.1 缺陷导致会话打不开；修复后重启 DSH）
codex2dsh regroup --apply              # 整理工作区：非工作区会话统一归组（执行后重启 DSH）
codex2dsh doctor                       # 迁移体检
codex2dsh ledger                       # 查看迁移台账
```

---

## 🔒 安全说明

| 承诺 | 说明 |
| --- | --- |
| **源码只读** | `~/.codex/**` 任何文件永不写入、永不移动、永不删除 |
| **密钥原样迁移（默认）** | 为让迁移后配置**直接可用**，`password/token` 等敏感值按原样写入产物；产物含真实凭据，**请勿提交公开仓库**；面板「迁移选项」可一键切换为脱敏（`****`） |
| **凭据文件不触碰** | `auth.json`、`.codex-global-state.json` 等只报告存在，不读取、不迁移 |
| **默认预览** | 一切写盘操作默认 dry-run，确认后才执行 |
| **profile 不自动改** | MCP / 配置只生成待审阅片段，由你人工合并，绝不自动修改 |
| **幂等不覆盖** | 目标已存在且内容不同时拒绝覆盖（需 force），防覆盖人工修改 |

---

## ❓ 常见问题

### MCP 迁移后如何让 DSH 真正用上这些服务器？
迁移生成的是**待审阅片段**（如 `~/.dsh/codex2dsh/mcp-mirror.cordis.yml`）。请把片段中的 `- insert: dsh-mcp-client` 块合并进 profile 的 `cordis.patch.yml`（`~/.dsh/profiles/<你的profile>/cordis.patch.yml`），然后重启 DSH。

### 我该用哪个 profile？
**DSH Desktop** 用户看「设置 → 关于/插件」里当前激活的 profile（通常是 `desktop` 或你切换后的 `web`）——插件要装到**当前激活的 profile** 才会出现在设置里。用 `dsh plugin --profile <当前profile> add codex2dsh`。

### 连接 MCP 服务器失败？
部分服务器（如 Google MCP Toolbox）的 stdio transport 走 **NDJSON** 而非标准帧格式，DSH 的 MCP 客户端可能连不上。此时可改用 **HTTP 模式**：`toolbox serve` 常驻 + 镜像配置 `type: http`（`url: http://127.0.0.1:5000/mcp`）。如遇此类问题，可在 [Issues](https://github.com/BigBlueBaby/codex2dsh/issues) 反馈，我们会给出适配指引。

### 迁移后技能/指令去哪了？
- 技能 → `~/.agents/skills/<name>/`（可用 `DSH_AGENTS_HOME` 覆盖）
- 指令 → `~/.agents/instructions/`
- 记忆 → `~/.dsh/memories/codex/`
- MCP 镜像与台账 → `~/.dsh/codex2dsh/`

### 导入的 Codex 会话标题丢了 / 显示成工作区名？
`import_codex` 不写 `session/title` 事件，DSH 会回退到首条 user 消息——而 Codex rollout 首条常是 harness 注入（`<environment_context>` / AGENTS.md），所以显示成路径/工作区名。修复：面板「会话导入 → **修复标题**」按钮（或 `codex2dsh_fix_titles` 工具，`apply: true`），标题取自 `~/.codex/session_index.jsonl` 的 `thread_name`，缺失时取 rollout 首条真实提问；只补不覆盖、可重复执行。委托导入后也会自动补。

### 会话打不开，报 `SessionPersistenceCorruptionError: ... is not surface-eligible ...`？
这是 0.1.1 早期回填缺陷：`session/title` 误带 `surfaceOp` 导致整份日志校验失败。修复：在 DSH 外执行 `codex2dsh repair-titles --apply`（截断清除坏事件，零数据丢失），**重启 DSH** 后重新点「修复标题」即可。

### 会话列表很乱：非工作区会话每个一个工作区、还排在最上面？
DSH 的 workspace 按会话工作目录（cwd）分组，而 Codex 非工作区会话的 cwd 是 `Documents\Codex\<日期>\<主题>` 这类一次性目录，迁移后各自成组，又因 `C:` 前缀字母序排前。修复：面板「会话导入 → **整理工作区**」（或 `codex2dsh regroup --apply`）——按 Codex 官方标记（`projectless-thread-ids`）把非工作区会话统一改写 header.cwd 并移动到同一工作区目录，**重启 DSH** 后生效；其余工作区会话不动，排序恢复为按时间、与 Codex 一致。

### 卸载后数据会丢吗？
不会。插件从不自动删除已迁移资产；卸载只移除插件本身。

---

## 📚 文档

| 文档 | 内容 |
| --- | --- |
| [01-总体架构](docs/01-总体架构.md) | 项目目标、DSH 插件体系、技术栈 |
| [02-Codex配置解剖](docs/02-Codex配置解剖.md) | Codex 配置全解剖（config.toml / skills / 记忆 / 凭据） |
| [03-映射规范](docs/03-映射规范.md) | 逐项映射规范（MCP / 技能 / 指令 / 记忆 / 配置） |
| [04-插件API参考](docs/04-插件API参考.md) | 开发者：插件 API 与 client 注入契约 |
| [05-实现方案](docs/05-实现方案.md) | 开发者：模块划分与实现细节 |
| [06-测试与验收](docs/06-测试与验收.md) | 测试策略与验收矩阵 |
| [07-发布与分享](docs/07-发布与分享.md) | 开发者：npm 发布与社区市场收录 |
| [08-路线图](docs/08-路线图.md) | 里程碑与需求清单 |
| [09-安全边界](docs/09-安全边界.md) | 安全承诺与密钥策略 |

---

## 🤝 参与

- 使用中发现问题或有新想法 → [Issues](https://github.com/BigBlueBaby/codex2dsh/issues)
- 想直接上手 → [CONTRIBUTING.md](CONTRIBUTING.md) 与 [docs/05-实现方案.md](docs/05-实现方案.md)
- 版本历史 → [CHANGELOG.md](CHANGELOG.md)

## 📄 许可

MIT License —— 见 [LICENSE](LICENSE)。

> ⚠️ 免责声明：本插件只负责「翻译」配置，不承担目标服务器、凭据与访问策略的合规责任；迁移含密钥的 MCP 配置前请务必阅读 [docs/09-安全边界.md](docs/09-安全边界.md)。
