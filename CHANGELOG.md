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
- 工具面（`lib/tools.mjs`）：`migrate_codex_preview`、`migrate_codex_mcp`、`migrate_codex_skills`、`migrate_codex_instructions`、`migrate_codex_memory`、`migrate_codex_config`、`codex2dsh_doctor` 已实现；仅 `migrate_codex_sessions` 为占位（M4 委托）。
- M3 全资产覆盖：
  - `lib/instructions.mjs` —— AGENTS.md/instructions.md 原文完整迁移（来源注释块）、项目级 AGENTS.md 挂载建议、幂等/冲突/force。
  - `lib/memory.mjs` —— memories/ 资产迁移（text 带来源注释、json 原样）；`memories_1.sqlite` 用 `node:sqlite` 只读探测提取文本条目（结构未知/不可读降级报告）；记忆开关关闭时跳过。
  - `lib/settings.mjs` —— agent-default-model / provider（凭据脱敏）/ permission / projects 只读建议 + 确定性 `settings-suggest.yml` 片段（绝不自动写 settings.yaml）。
  - `lib/doctor.mjs` —— 台账驱动的逐资产体检（已迁移/待迁移/密钥残留）。
- CLI（`bin/codex2dsh.mjs`）：`preview` / `mcp` / `ledger`。
- 测试：64 个 `node:test` 用例全绿（行覆盖 93.10%）；脱敏夹具（`test/fixtures/`）；CI（GitHub Actions，node 22/24 × ubuntu/windows + 夹具敏感词检查）。
- 真实环境演练：`migrate_codex_skills` 在 `~/.codex/skills` 上 dry-run 验证（27 候选技能、`.system` 与 `codex-primary-runtime` 正确排除、零副作用）；M3 四工具在真实 `~/.codex` dry-run 验证（指令 3 项、记忆 3 文件 + sqlite 探测、配置建议完整、doctor 全类别状态）。

### 待实现（见 docs/08-路线图.md）

- M4：会话委托（import_codex）、CLI 补齐、（可选）面板路由与斜杠命令。
- M5：npm 发布与社区市场收录。
