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

- M5 收尾（需用户操作）：创建 GitHub 仓库并推送、替换 `package.json` 中 `<你的用户名>` 占位、`npm publish`（release workflow 已就绪）、提交 awesome-dsh-plugin 收录 PR。
- 可选项：斜杠命令（REQ-14）。

### M5 发布准备（本轮）

- `.github/workflows/release.yml`：`v*` tag 触发（门禁：check:fixtures + 单测 + L3 冒烟）→ `npm publish --provenance` → GitHub Release。
- 真实环境 L4 演练：`codex2dsh mcp --apply` 生成真实镜像（`~/.dsh/codex2dsh/mcp-mirror.cordis.yml`，7 个服务器、6 处脱敏、运行时排除、台账落盘），待用户审阅后合并进 profile。
- 回归修复：`[mcp_servers]` 空节不再产生 `undefined` 服务器条目（真实 config.toml 触发，preview 计数 9→8）。

### 可视化面板（设置 → 插件 → Codex 迁移）

- `lib/panel.mjs` —— webServer 路由：`GET /codex2dsh/status`（资产+台账+凭据）、`POST /codex2dsh/preview`（全资产预览）、`POST /codex2dsh/migrate`（按 action 执行/预览，与工具面同一套 lib 编排）；headless 不挂载。
- `client/index.js` —— Browser client（`window.__ModuleLoader__.load` 手写 CJS factory，零构建）：注册 `settings.plugins.tab` 槽位，提供状态总览（资产清单/台账计数/凭据警告）、7 个迁移动作的「预览/执行」按钮（执行带确认）、结果徽章（migrated/skipped/invalid/previewed）与警告列表；`settingsScope` 缺席时优雅跳过。
- `package.json`：`dsh.client.inject: ["@deepseek-ai/dsh-client-locale"]`、`exports["./client"]`、files 含 `client/`。
- 重构：`runMcpMigration` 抽为 `lib/mcp.mjs` 可复用编排（工具层与面板共用）。
- 测试：79 个全绿（新增 panel 路由 4 个 + client 契约 3 个）；真实环境 status 路由验证（全部资产类别 + 台账 + 凭据）。

### 需求迭代：密钥原样迁移 / 工具随迁 / 选择性迁移 / 界面升级

- **密钥默认原样迁移**（用户需求）：`maskSecrets` 默认 `false`——MCP 镜像/配置建议中的 `password/token` 等敏感值**完整保留**直接可用（仅报告计数 + 头部警告）；`maskSecrets:true` 恢复脱敏。`lib/report.mjs` 的 `maskArgs/maskEnv` 增加 `mask` 开关。
- **本地工具目录随迁**：`detectLocalTools` 识别 `command/args/env` 引用的 `~/.codex/tools/<name>`（如 mcp-toolbox），`migrateTools`（默认 true）复制到 `$DSH_HOME/codex2dsh/tools/`，`rewriteToolPaths` 把镜像路径同步重写为目标路径（幂等：目标已存在跳过）；报告新增 `kind: "tool"`。
- **选择性迁移**：MCP 服务器与技能均支持 `include`/`exclude`（精确名 + `*` 前缀通配，如 `ccpanes-*`、`kingbase-*`）；UI 提供勾选清单（全选/清空/仅非 ccpanes）。
- **面板路由升级**：`GET /codex2dsh/status` 增加 `selectable`（MCP 服务器名 / 技能候选 / 本地工具清单）；`POST /codex2dsh/migrate` 透传 `maskSecrets/include/exclude/migrateTools/toolsTarget`。
- **可视化界面重构**：`client/index.js` —— 全局选项卡（密钥方式、工具随迁）、**全量迁移向导**（1 预览 → 2 选择分类+勾选 → 3 逐步执行 → 4 结果汇总）、**分类迁移卡片**（每类独立卡片：MCP/技能勾选清单 + 预览/执行 + 结果徽章）、最近结果区。
- CLI：`mcp` 复用 `runMcpMigration`（行为与工具/面板一致），新增 `--mask-secrets/--include/--exclude/--no-tools/--tools-target`；`skills` 支持 `--include/--exclude`。
- 测试：83 个全绿（新增工具迁移、include/exclude 过滤、密钥模式切换用例）；真实环境验证 selectable 清单（7 MCP / 27 技能 / mcp-toolbox）与 ccpanes 排除。
- 文档同步：docs/03（密钥策略、选择性、工具随迁）、docs/09（安全边界修订）、docs/05、README、CHANGELOG。
