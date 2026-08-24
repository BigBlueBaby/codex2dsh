<div align="center">

# 🔁 Codex2DSH

**把 Codex（OpenAI Codex CLI / Desktop）的 MCP、技能、全局指令、记忆与运行偏好，以「适配 DSH」的形式一键迁移进 DeepSeek Harness —— 以 DSH 插件形式交付，可测试、可分享、可上架社区市场。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Node.js >= 22.13](https://img.shields.io/badge/Node.js-%3E%3D22.13-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)
[![dsh >= 0.1.x](https://img.shields.io/badge/dsh-%3E%3D0.1.x-4A90D9?style=for-the-badge)](docs/01-总体架构.md)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)](.github/workflows/ci.yml)

[📖 快速开始](#-快速开始) · [✨ 功能](#-功能) · [🗺️ 映射范围](#-映射范围) · [📚 文档](#-文档) · [🚀 路线图](docs/08-路线图.md) · [🤝 贡献](CONTRIBUTING.md)

</div>

> **一句话**：Codex 的配置是资产，不是牢笼。`codex2dsh` 帮你把多年积累的 MCP 服务器、技能、全局规则、记忆一键「翻译」成 DSH 原生形态，迁移全程**只读源码、脱敏密钥、dry-run 预览、人工确认**。

> 🚧 **开发状态**：里程碑 M1–M4 已完成（9 个迁移工具全部可用，70+ 单测全绿，L3 冒烟通过，真实 `~/.codex` 演练验证）；M5 发布流程已就绪（npm / GitHub Actions release workflow），待创建 GitHub 仓库后即可发布分享。详见 [docs/08-路线图.md](docs/08-路线图.md)。

---

## 📥 快速开始

### 环境要求

- Node.js ≥ 22.13（DSH 运行时要求）
- DeepSeek Harness `dsh` CLI ≥ 0.1.x（本插件在 `0.1.1-rc.2` 实测）
- 本机已有 Codex 配置（`~/.codex/`，Windows 为 `C:\Users\<你>\ .codex\`）

### 安装插件（本地开发模式）

```bash
# 在 codex2dsh 项目目录外执行：
dsh plugin --profile web add -w link:D:/Projects/codex2dsh   # Windows
# 或发布后直接装 npm 包：
dsh plugin --profile web add codex2dsh
```

> 安装后重启 DSH（Desktop 或 `dsh` CLI），插件即注册一组 `migrate_codex_*` 工具与 `/codex2dsh` 命令。

### 首次迁移（推荐流程）

1. **预览**：`migrate_codex_preview({})` —— 只读扫描 `~/.codex`，返回将迁移的清单（MCP 服务器、技能、指令、记忆、会话规模），零副作用。
2. **逐项迁移**（每步都有 `preview:true` 可先看再落盘）：
   - `migrate_codex_mcp({ apply: true })` → 生成 `mcp-mirror.cordis.yml`（人工审阅后合并进 profile）
   - `migrate_codex_skills({ apply: true })` → 技能落盘 `~/.agents/skills/<name>/SKILL.md`
   - `migrate_codex_instructions({ apply: true })` → 全局规则落为 DSH 指令资产 / preset
   - `migrate_codex_memory({ apply: true })` → 记忆导出为可检索的 DSH 记忆资产
   - `migrate_codex_sessions({ preview: true })` → 委托 `import_codex` 把会话历史导入为可续聊的 DSH 会话
3. **体检**：`codex2dsh_doctor()` —— 校验迁移结果、报告未迁移项与残留密钥风险。

> 会话导入能力由生态插件 **dsh-chat-import**（`import_codex` / `scan_discover`）提供，本插件负责**配置与资产**侧并与其协同，不重复造轮子。详见 [docs/01-总体架构.md](docs/01-总体架构.md#-范围界定)。

---

## ✨ 功能

| 能力 | 工具 / 入口 | 说明 |
| --- | --- | --- |
| 迁移总览 | `migrate_codex_preview` | 只读扫描 `~/.codex` 全部可迁移资产，输出结构化清单与规模 |
| MCP 镜像 | `migrate_codex_mcp` | 解析 `config.toml` 的 `[mcp_servers.*]`，生成可人工审阅合并的 DSH MCP client YAML（`mcp-mirror.cordis.yml`）；**密钥默认原样迁移**（可选脱敏）；`include/exclude` 选择性迁移；**本地工具目录（mcp-toolbox 等）随迁并重写路径**；绝不自动改 profile |
| 技能转换 | `migrate_codex_skills` | `~/.codex/skills/<name>/SKILL.md` → `~/.agents/skills/<name>/SKILL.md`，frontmatter 适配（`kind: dsh`），脚本目录随迁，冲突加后缀消歧、内容相同幂等跳过；**`include/exclude` 选择性迁移（如排除 `ccpanes-*`）** |
| 全局指令 | `migrate_codex_instructions` | `AGENTS.md` / `instructions.md` → DSH 指令资产（项目级与全局级分开处理） |
| 记忆迁移 | `migrate_codex_memory` | Codex `[memories]` 与记忆库 → DSH 记忆资产（只读导出、可检索） |
| 模型与偏好 | `migrate_codex_config` | `model_provider` / `model` → `settings.yaml` 的 `agent-default-model` 建议（只读建议，人工确认） |
| 会话历史 | `migrate_codex_sessions` | 统计 `~/.codex/sessions`（数量/体积/时间范围）并委托 `import_codex`（dsh-chat-import）导入为可续聊会话；未安装时返回安装指引 |
| 体检报告 | `codex2dsh_doctor` | 迁移前后健康检查：已迁移/待迁移/不可迁移/密钥残留 |
| 可视化面板 | 设置 → 插件 → **Codex 迁移** Tab | 状态总览 + 迁移选项（密钥原样/脱敏、工具随迁）+ **全量迁移向导**（预览→选择→执行→汇总）+ **分类迁移卡片**（MCP/技能勾选清单、预览/执行按钮、结果徽章） |
| 安全边界 | 全部工具 | 源码只读、**密钥默认原样迁移**（`maskSecrets:true` 可选脱敏）、dry-run 优先、`expectedHash` 强校验、迁移台账落盘 |

---

## 🗺️ 映射范围

| Codex 资产 | 位置 | 迁移目标 | 方式 |
| --- | --- | --- | --- |
| MCP 服务器 | `~/.codex/config.toml` `[mcp_servers.*]` | DSH MCP client 配置（`cordis.patch.yml` 合并片段） | 生成 YAML，人工审阅 |
| 技能 Skills | `~/.codex/skills/<name>/` | `~/.agents/skills/<name>/`（`$DSH_AGENTS_HOME`） | 直接落盘 |
| 全局指令 | `~/.codex/AGENTS.md`、`instructions.md` | DSH 指令资产 / preset 系统提示 | 转换落盘 |
| 项目信任 | `[projects.*] trust_level` | 建议（DSH 权限预设对照） | 只读建议 |
| 模型与 Provider | `model` / `model_provider` / `[model_providers.*]` | `settings.yaml` `agent-default-model` / llm providers | 只读建议 |
| 记忆 | `~/.codex/memories/`、`[memories]` | DSH 记忆资产 | 只读导出 |
| 会话历史 | `~/.codex/sessions/**/rollout-*.jsonl` | DSH 可续聊会话 | 委托 `import_codex` |
| **不迁移** | `auth.json`、`.codex-global-state.json`、浏览器凭据、桌面主题 | —— | 明示跳过并说明原因 |

完整逐项映射与字段级对照见 [docs/03-映射规范.md](docs/03-映射规范.md)。

---

## 📚 文档

完整详细的开发文档（中文，含实现方案、测试验收、发布分享）位于 [`docs/`](docs/)：

| 文档 | 内容 |
| --- | --- |
| [01-总体架构.md](docs/01-总体架构.md) | 项目目标、范围界定、DSH 插件体系（Cordis / bundle / patch / host 服务）、技术栈决策 |
| [02-Codex配置解剖.md](docs/02-Codex配置解剖.md) | Codex 配置全解剖：`config.toml` 各节字段表、skills、AGENTS.md、会话、记忆、密钥文件（含脱敏实测样例） |
| [03-映射规范.md](docs/03-映射规范.md) | Codex → DSH 逐项映射规范（字段级对照、转换规则、幂等与冲突策略、不迁移清单） |
| [04-插件API参考.md](docs/04-插件API参考.md) | DSH 插件 API 参考：package.json `dsh` 字段、`cordis.patch.yml`、`apply/inject/name`、`defineTool`、commands、webServer 路由、host 服务清单 |
| [05-实现方案.md](docs/05-实现方案.md) | 实现方案：模块划分、工具清单与参数、数据流、错误处理、幂等设计 |
| [06-测试与验收.md](docs/06-测试与验收.md) | 测试策略：单元测试、夹具、headless 冒烟、真实迁移演练、验收矩阵、CI |
| [07-发布与分享.md](docs/07-发布与分享.md) | npm 发布、awesome-dsh-plugin 收录、dsh-community-market 目录契约、awesome 列表、版本管理 |
| [08-路线图.md](docs/08-路线图.md) | 里程碑（M1–M5）与需求清单（REQ 表） |
| [09-安全边界.md](docs/09-安全边界.md) | 只读原则、密钥脱敏、人工确认、审计与台账 |

---

## 🤝 参与

- 使用中发现问题或有新想法 → [Issues](https://github.com/<你的用户名>/codex2dsh/issues)
- 想直接上手 → [CONTRIBUTING.md](CONTRIBUTING.md) 与 [docs/05-实现方案.md](docs/05-实现方案.md)
- 版本历史 → [CHANGELOG.md](CHANGELOG.md)

## 📄 许可

MIT License —— 见 [LICENSE](LICENSE)。

> ⚠️ 免责声明：本插件只负责「翻译」配置，不承担目标服务器、凭据与访问策略的合规责任；迁移含密钥的 MCP 配置前请务必阅读 [docs/09-安全边界.md](docs/09-安全边界.md)。
