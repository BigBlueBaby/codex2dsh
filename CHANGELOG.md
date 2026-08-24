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
- 工具面（`lib/tools.mjs`）：`migrate_codex_preview`、`migrate_codex_mcp`、`migrate_codex_skills` 已实现；其余为占位工具（返回友好报告）。
- CLI（`bin/codex2dsh.mjs`）：`preview` / `mcp` / `ledger`。
- 测试：49 个 `node:test` 用例全绿（行覆盖 93.68%）；脱敏夹具（`test/fixtures/`）；CI（GitHub Actions，node 22/24 × ubuntu/windows + 夹具敏感词检查）。
- 真实环境演练：`migrate_codex_skills` 在 `~/.codex/skills` 上 dry-run 验证（27 候选技能、`.system` 与 `codex-primary-runtime` 正确排除、零副作用）。

### 待实现（见 docs/08-路线图.md）

- M3：指令 / 记忆 / 配置建议 / doctor。
- M4：会话委托（import_codex）、CLI 补齐、（可选）面板路由与斜杠命令。
- M5：npm 发布与社区市场收录。
