# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 SemVer。

## [0.1.2] - 未发布

### 修复：MCP 镜像与 dsh-mcp-client 契约不符导致 DSH 启动失败（三连）

0.1.1 生成的 `mcp-mirror.cordis.yml` 合并进 profile 后 DSH 启动失败并自动回滚，
共三处与 `@deepseek-ai/dsh-mcp-client`（0.1.x）契约不符：

1. **name 用短 id**：`name: dsh-mcp-client` → loader 按 name 解析安装包失败
   （`cannot resolve package "dsh-mcp-client"`）——改为完整包名
   `'@deepseek-ai/dsh-mcp-client'`（@ 开头加引号）；
2. **结构整体不符**：旧版 `servers: {name: {type, command}}` 映射，而契约是
   **每台服务器一个插件实例** `{serverName(必填), transport: stdio|streamable-http,
   command, args, env}`——渲染器重写为每服务器一个 insert entry
   （id=`mcp-<serverName>` 唯一）；移除 schema 不存在的 `startupTimeoutSec`；
3. **TOML 数值 args 未字符串化**：`--port 54322` 为数字 → schema 要求
   `args: string[]` → `ValidationError: invalid config`——config 解析与
   buildMcpPlan 双层字符串化兜底。

同步：mirror 解析器（`readMirrorServerNames`/`readMirrorServersDetail`）重写、
verify 增加契约级检查与 `commandResolvable`（npx 等 PATH 命令不误报）、
全部测试 fixture/断言更新（含 TOML 数字 args 防回归），全量绿。

## [0.1.1] - 未发布

### 修复：AGENTS.md 迁移未适配 Codex 专属引用（迁移可用性）

- **缺陷**：旧版把 AGENTS.md 原文照搬，其中 Codex 专属引用在 DSH 中失效：
  本地工具绝对路径（`~/.codex/tools/mcp-toolbox/...`，工具随迁后路径已变）、
  MCP 工具前缀下划线形态（`mcp__google_mcp_toolbox__` 实际服务器名
  `google-mcp-toolbox`）、未配置的 MCP 服务器引用（如 `figma_developer`）。
- **修复**（`lib/instructions.mjs` 新增 `adaptCodexReferences` 适配层）：
  - 工具路径改写：`<codexHome>/tools/<name>/...`（含 `~/.codex/tools/...` 形态，
    反斜杠/正斜杠兼容）→ `$DSH_HOME/codex2dsh/tools/<name>/...`；
  - MCP 前缀归一：`mcp__<server_下划线>__` → `mcp__<server-连字符>__`（对照
    mirror 实际服务器名自动改写）；
  - MCP 引用校验：规则中 `mcp__<server>__` 与 `<server> MCP` 字样逐一对照
    DSH 侧已配置服务器，未配置的逐条警告（迁移报告可见）；
  - 幂等/冲突语义不变；预览也展示改写数与警告。

### 新增：迁移可调用性验证（`codex2dsh_verify` / CLI `verify` / 面板「验证迁移」）

- 迁移成功的标准 = **DSH 中真实可用**，而非文件已生成。`lib/verify.mjs`
  只读验证：
  1. mirror 片段是否已合并进 profile 的 `cordis.patch.yml`（未合并 =
     DSH 中 MCP 未加载，迁移未完成）；
  2. mirror 中每个 stdio 服务器的 command / `--config` 路径是否存在
     （工具是否随迁、路径是否有效）；
  3. `$DSH_HOME/AGENTS.md` 中的 MCP/工具引用是否在 DSH 配置中成立
     （复用适配层校验，残留未改写路径逐条报告）。
- 面板「迁移体检」卡片新增「验证迁移」按钮；CLI `codex2dsh verify`。

### 修复：全局指令迁移位置错误导致 DSH 未注入

- **缺陷**：旧版 `migrate_codex_instructions` 把全局指令写到
  `$DSH_AGENTS_HOME/instructions/global.md`（`~/.agents/instructions/`），但
  DSH 的指令发现（`@deepseek-ai/dsh-agent-instructions`）只认
  `$DSH_HOME/AGENTS.md`（用户全局指令唯一位置）与项目目录链上的
  `AGENTS.md/CLAUDE.md/AGENTS.local.md/CLAUDE.local.md`——`~/.agents/`
  下的目录不参与发现，导致迁移的 Codex 全局规则从未注入对话（只看到项目级规则）。
- **修复**（`lib/instructions.mjs`）：
  - 目标改为 `$DSH_HOME/AGENTS.md`；`instructions.md`（若存在）合并进同一文件
    （分节保留 + 每节来源注释），保证 DSH 一次加载全部全局规则；
  - 幂等/冲突语义不变（目标相同跳过；不同且未 force 拒绝覆盖，保护人工修改）；
  - 工具/面板/CLI 参数 `agentsHome` → `dshHome`（CLI 兼容旧 `--agents-home`）。
- 测试：instructions 用例重写 + 新增（合并内容/无源跳过/目标位置断言），
  总计 117 个全绿；L3 冒烟断言同步更新为 `$DSH_HOME/AGENTS.md`。

### 修复：导入 Codex 会话的标题丢失

- **背景**：`import_codex` 的 codex 转换器不写 `session/title` 事件，DSH 标题
  回退到首条 `user/message`——而 Codex rollout 首条几乎总是 harness 注入
  （`<environment_context>` / `# AGENTS.md instructions` / `<agents-instructions>`），
  导致导入会话全部显示成工作区/路径类标题。
- **回填机制**（`lib/title.mjs` + `lib/sessionlog.mjs`）：
  - 标题源按优先级：`~/.codex/session_index.jsonl` 的 `thread_name`（同 id 取
    `updated_at` 最新）→ rollout 首条真实提问（跳过 `<` 开头块与 AGENTS.md/
    CLAUDE.md 指令注入）；
  - 写回 `session/title` 事件（`seq`=事件数、data 形状对齐 DSH `session-title`
    服务的 `rename()`，**不带 surfaceOp**）；**只补不覆盖**（已有标题/
    用户改名/非 Codex 导入/live 会话跳过），幂等可重复执行；
  - 写后刷新 `sessionProjectionCache.coldSnapshot`，界面立即显示新标题。
- **入口**：
  - `codex2dsh_fix_titles` 工具（`apply:true` 才写盘，默认 dry-run）；
  - 面板「会话导入」卡片新增「修复标题」按钮（`POST /codex2dsh/backfill-titles`）；
  - `migrate_codex_sessions` 委托成功后自动补标题（best-effort，失败不影响导入）；
  - CLI `codex2dsh titles`（只读预览：缺标题清单 + 将补标题 + 来源统计）。
- 测试：新增 17 个用例（索引解析/注入过滤/事件构造/回填编排/真实 zstd 工件
  读取），总计 100 个全绿。

### 修复：session/title 误带 surfaceOp 导致会话无法打开

- **缺陷**：0.1.1 早期回填给 `session/title` 事件附加了 `surfaceOp: 'append'`，
  但 DSH 宿主只允许 `user/message` / `assistant/message` / `tool/result` 携带
  surfaceOp（`@deepseek-ai/dsh-session` 的 surface 校验），非 surface 事件携带
  surfaceOp 会让整份日志在打开时校验失败（`SessionPersistenceCorruptionError`：
  `session event "session/title" is not surface-eligible and cannot carry
  surfaceOp`），导致已回填的会话历史无法加载。
- **修复**：
  - `buildTitleEvent` 不再附加 surfaceOp（与 DSH `rename()` / dsh-chat-import
    的 title 事件完全一致）；新增 `isBadTitleEvent` 检测；
  - `codex2dsh repair-titles`（CLI）：清除日志末帧/末行的坏标题事件
    （截断式修复，零数据丢失；默认 dry-run，`--apply` 才截断；修复后需重启
    DSH 再回填标题）；
  - `planTitleBackfill` 发现坏标题事件时跳过并给出修复指引（不覆盖）。
- 测试：+5 个用例（坏标题检测/回填跳过/末帧截断/明文日志/非末帧跳过），
  总计 105 个全绿。

### 新增：工作区归组修复（非工作区会话统一归组）

- **问题**：DSH workspace = 会话 header.cwd 的 realpath（按目录分组）。Codex
  非工作区会话（projectless）cwd 是 `Documents\Codex\<日期>\<主题>` 这类一次性
  目录，迁移后**每个会话一个独立工作区**，且 `C:` 前缀字母序排前 → 「非工作区
  会话反而在最上面、工作区会话在最下面」。
- **修复**（`lib/regroup.mjs`）：
  - 非工作区判定：`~/.codex/.codex-global-state.json` 的 `projectless-thread-ids`
    （权威）∪ cwd 在 `thread-workspace-root-hints` 众数根下（兜底）；cwd 在任一
    项目 `rootPaths` 下 = 工作区会话不动；未登记目录保守跳过；
  - 归组：改写 header.cwd（日志第一帧 zstd 重写，其余帧原样）+ 物理移动会话
    目录到新 projectKey 目录；幂等（已归组跳过）、live 会话跳过、默认 dry-run；
  - 排序不动：DSH 启动 reconcile 按时间排，归组后与 Codex 顺序一致；
  - 入口：`codex2dsh_regroup_sessions` 工具 / 面板「会话导入 → 整理工作区」
    （`POST /codex2dsh/regroup`）/ CLI `codex2dsh regroup [--apply] [--dir]`；
    委托导入后报告非工作区会话数（不自动移动，避免与宿主写游标冲突）；
  - 执行后需重启 DSH 生效。
- 测试：+10 个用例（projectKey/路径归一/状态解析/分类/header 重写/目录移动/
  CLI 扫描/host 编排），总计 115 个全绿。

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
