# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 SemVer。

## [0.1.0] - 未发布（骨架与文档基线）

### 新增（骨架）

- 完整开发文档集（`docs/01`–`docs/09`）：总体架构 / Codex 配置解剖 / 映射规范 / 插件 API 参考 / 实现方案 / 测试与验收 / 发布与分享 / 路线图 / 安全边界。
- 插件骨架：`package.json`（`dsh.bundle.patch`）、`cordis.patch.yml`、`index.mjs`（`apply/inject/name`）、`index.d.ts`（ToolSurface 类型面）。
- 核心原语（已实现并单测）：
  - `lib/config.mjs` —— Codex `config.toml` 轻量解析（mcp_servers 含引号节名 / env 子节 / 数组 / 内联表）。
  - `lib/mcp.mjs` —— MCP 镜像计划（运行时排除、密钥脱敏、确定性 YAML 渲染、幂等三态）。
  - `lib/skills.mjs` —— 技能转换：运行时/市场分发判定、frontmatter 追加 `kind: dsh / source: codex`、scripts 随迁、同名冲突消歧 `-codex`（force 覆盖）、幂等跳过、`fixFrontmatter` 补全、台账。
  - `lib/report.mjs` —— 统一报告、`maskSecrets` 脱敏（`--flag=value` / `--flag value` 分离元素 / `KEY=value`）、SHA-256 指纹。
  - `lib/yaml.mjs`、`lib/ledger.mjs`、`lib/scan.mjs`、`lib/paths.mjs`（含 `resolveAgentsHome` 显式参数回归）。
- 工具面（`lib/tools.mjs`）：9 个工具全部实现（`migrate_codex_preview/mcp/skills/instructions/memory/config/sessions` + `codex2dsh_doctor/ledger`）。
- M4 会话与入口：
  - `lib/delegate.mjs` —— `migrate_codex_sessions`：只读统计（兼容 `rollout-2026-03-25T11-33-37-<uuid>` 与 `rollout-20260813-000001` 两种命名）、时间范围、探测 `import_codex`（`ctx.tools.get`）→ 透传委托（preview/budget/restamp）→ 台账；未安装时返回安装指引。
  - CLI 补齐：`skills / instructions / memory / config / sessions / doctor` 子命令（与工具面共享 lib 纯函数）。
  - L3 集成冒烟：`.github/scripts/smoke.mjs`（临时 CODEX_HOME/DSH_HOME/DSH_AGENTS_HOME 跑通全工具链，16 项断言，含"真实 ~/.agents 无产物"检查），已接入 CI。
- 测试：70 个 `node:test` 用例全绿（行覆盖 93.39%）；脱敏夹具（`test/fixtures/`）；CI（GitHub Actions，node 22/24 × ubuntu/windows + 夹具敏感词检查 + L3 冒烟）。
- 真实环境演练：M3 四工具 + CLI `doctor/sessions/skills` 在真实 `~/.codex` dry-run 验证（336 个 rollout 会话统计 2026-03-25 ~ 2026-08-21、安装指引正确）。

### 待实现（见 docs/08-路线图.md）

- M5：npm 发布与社区市场收录。
- 可选项：面板路由（REQ-13）与斜杠命令（REQ-14）。
