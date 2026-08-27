# 04 · DSH 插件 API 参考

> 状态：**基线文档**（以本机 dsh 0.1.1-rc.2 与生态参考插件 dsh-chat-import 0.7.0 实测为准） · 关联：[01-总体架构](01-总体架构.md) · [05-实现方案](05-实现方案.md)

本文是开发 `codex2dsh` 时需要的 **DSH 插件 API 速查**。完整权威定义以 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-settings` 的发布类型为准；本文沉淀的是**生态实测共识**，新人照此即可写出能跑的插件。

## 1. package.json 声明（插件包）

```jsonc
{
  "name": "codex2dsh",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.mjs",
  "types": "./index.d.ts",
  "bin": { "codex2dsh": "./bin/codex2dsh.mjs" },
  "exports": {
    ".": { "types": "./index.d.ts", "default": "./index.mjs" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["index.mjs", "index.d.ts", "lib/*.mjs", "bin", "cordis.patch.yml", "docs/**", "README.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": ["@deepseek-ai/dsh-client-locale"], "platform": "web" }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.6",
    "@deepseek-ai/schemastery": ">=3.0.0",
    "@deepseek-ai/dsh-client-locale": ">=0.1.0-rc.6"
  },
  "engines": { "node": ">=22.13" }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `dsh.bundle.patch` | 指向 `cordis.patch.yml`；市场安装器（dsh-community-market）校验该文件**存在于包内且不越界** |
| `dsh.client.inject` | 需要注入的 web 客户端包；**无 UI 需求可不加**（本项目 M1–M3 不需要，M4 面板若做再加） |
| `peerDependencies` | 运行时由 host 提供；不放入 `dependencies`（避免版本分裂） |
| `files` | 决定 npm 包内容；`lib/*.mjs` 通配注意子目录（参考插件用 `lib/*.mjs` + `lib/convert` 等显式列） |

## 2. `cordis.patch.yml`（组合补丁）

```yaml
- insert:
    - id: codex2dsh
      name: codex2dsh
```

- `id`：组合层内唯一标识（profile 内不得与既有条目冲突）；
- `name`：npm 包名；
- 可追加 `config: {...}` 传入插件配置（本项目不需要）。

## 3. 插件入口 `index.mjs`

Cordis 插件的标准三导出：

```js
// 声明消费的 host 服务（缺失则插件不激活；webServer 等可选服务不写进 inject）
const inject = ['fs', 'tools']

function apply(ctx) {
  // 1) 注册工具（host 服务 'tools' 已注入）
  registerTools(ctx, resolveLedgerDir())

  // 2) 可选：斜杠命令（commands 服务可选，headless 可能没有 → 用 ctx.inject 延后注册）
  ctx.inject?.(['commands'], ({ commands }) => { registerCommands(ctx, commands) })

  // 3) 可选：web 面板路由（webServer 可选服务 → 延后注册，headless 不挂载）
  ctx.inject?.(['webServer'], ({ webServer }) => { registerPanelRoutes(ctx, webServer) })
}

export { apply, inject, name }
export const name = 'codex2dsh'
```

要点（来自 dsh-chat-import 的实测经验）：

- `inject` 只放**必需**服务；`webServer` / `commands` 用 `ctx.inject([...], cb)` 延后注册，headless / CLI 会话下回调不执行、插件照常激活；
- `ctx.inject` 的回调参数是**注入服务对象集合**（如 `{ webServer }`）；
- 不要 import host 内部模块，只通过 ctx 服务交互。

## 4. 工具注册（`@deepseek-ai/dsh-tools`）

```js
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'migrate_codex_mcp',
  description: '把 Codex config.toml 的 MCP 服务器镜像为 DSH MCP client 配置片段（默认 dry-run）',
  parameters: {
    apply: { type: 'boolean', description: 'true 时写盘生成 mcp-mirror.cordis.yml；缺省 false=预览', required: false },
    codexHome: { type: 'string', description: '可选：Codex 配置根（默认 ~/.codex）', required: false },
    outPath: { type: 'string', description: '可选：镜像文件输出路径', required: false },
    excludeRuntime: { type: 'boolean', description: '可选：排除 Codex 运行时服务器（默认 true）', required: false },
    expectedHash: { type: 'string', description: '可选：源文件期望 SHA-256 强校验', required: false }
  }
  // execute 由注册侧注入（defineTool 返回可执行工具，注册后 host 调用）
}))
```

要点：

- 参数 schema 用 **JSON Schema 子集**（`type/description/required/enum`），与 dsh-chat-import 的工具面一致；
- 工具名小写下划线；description 写清"默认行为（dry-run）"与幂等语义；
- `defineTool` 返回对象直接传给 `ctx.tools.register`；执行逻辑封装在 `lib/` 纯函数中，便于单测。

## 5. host 服务清单（本项目用到的）

| 服务 | 注入方式 | 用法 |
| --- | --- | --- |
| `fs` | `inject: ['fs']` | 读写 `$DSH_HOME/codex2dsh/`（台账、镜像、资产）；**读 Codex 源用 Node `node:fs` 只读**（不依赖 host 写权限语义） |
| `tools` | `inject: ['tools']` | `ctx.tools.register(...)`；也用于检测 `import_chat` 是否存在（`ctx.get?.('tools')` 或记录注册表） |
| `sessionPersistence` | 需要时 | 委托场景（会话相关） |
| `workspaceRegistry` | 需要时 | 委托场景（cwd 归组） |
| `webServer` | `ctx.inject(['webServer'])` | 面板路由 `POST /codex2dsh/preview` 等（M4） |
| `commands` | `ctx.inject(['commands'])` | `/codex2dsh` 命令（M4） |
| `settings` | `ctx.inject(['settings'])` | 插件配置命名空间（如"迁移后是否注入来源提示"开关），参考 dsh-chat-import 的 `chat-import` 命名空间写法 |

## 6. 数据目录约定

| 路径 | 用途 |
| --- | --- |
| `$DSH_HOME/codex2dsh/ledger.json` | 迁移台账（数组追加；每条含 `ts/source/target/fingerprint/status/tool`） |
| `$DSH_HOME/codex2dsh/mcp-mirror.cordis.yml` | MCP 镜像片段（人工审阅后合并） |
| `$DSH_HOME/codex2dsh/settings-suggest.yml` | 模型/权限建议片段 |
| `$DSH_AGENTS_HOME/skills/<name>/` | 技能落盘（默认 `~/.agents/skills`） |
| `$DSH_AGENTS_HOME/instructions/` | 指令资产落盘 |

## 7. CLI（`bin/codex2dsh.mjs`）

提供无 GUI 环境下的同能力：

```bash
codex2dsh preview            # 等同 migrate_codex_preview
codex2dsh mcp --apply        # 等同 migrate_codex_mcp(apply:true)
codex2dsh skills --apply
codex2dsh doctor
codex2dsh ledger             # 打印台账
codex2dsh titles             # 只读预览：已导入 Codex 会话的缺标题清单与将补标题
codex2dsh repair-titles      # 修复坏标题事件（0.1.1 缺陷误带 surfaceOp 导致会话打不开；默认 dry-run，--apply 截断，修复后重启 DSH）
codex2dsh regroup [--apply] [--dir PATH]  # 整理工作区：非工作区会话统一归组（默认 dry-run，执行后重启 DSH）
```

- CLI 与工具共享 `lib/` 纯函数（同一套转换/脱敏/幂等逻辑）；
- 参考插件把 CLI 做成独立 bin（`dsh-chat-import`），我们同构。

## 8. 本地开发调试工作流

```bash
# 1) 建 profile（或复用 web）
dsh plugin --profile web add -w link:D:/Projects/codex2dsh

# 2) 重启后验证插件已加载
dsh ...  # 或桌面端重启；看日志确认 codex2dsh 激活无报错

# 3) 会话内调用工具 / 命令行调用 CLI 验证

# 4) 改代码：link 模式符号链接，重启 dsh 进程生效

# 5) 卸载调试
dsh plugin --profile web remove codex2dsh   # 或从 profile bundles 移除 insert 行
```

> 已知边界（生态实测）：`dsh plugin add` 走 pnpm，profile 的 `package.json/pnpm-lock.yaml/pnpm-workspace.yaml` 会被快照与恢复；**不要手工编辑**这三个文件去"修"插件安装，用 `dsh plugin` 命令。

## 9. 与 dsh-chat-import 的类型面对齐

`index.d.ts` 声明工具调用面（`ToolSurface`）而非假模块导出（参考插件做法），让 TS 调用方有参数/返回类型提示，同时保持零构建。我们同样维护 `index.d.ts`，并在 `docs/05-实现方案.md` 中给出每个工具的 `parameters` 与返回值类型。

## 10. Browser client 注入契约（可视化面板）

「设置 → 插件 → Codex 迁移」Tab 由 client 侧实现（参考 dsh-chat-import / dshmarket 同款机制）：

### 10.1 包声明

```jsonc
// package.json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "inject": ["@deepseek-ai/dsh-client-locale"], "platform": "web" }
},
"exports": { "./client": "./client/index.js" }
```

- `dsh.client.inject`：声明需要注入进 web bundle 的 client 包（本项目只用 locale）；
- `exports["./client"]`：client 入口（`client/index.js`，手写 CJS factory，零构建）。

### 10.2 client 入口形态（`window.__ModuleLoader__.load`）

```js
window.__ModuleLoader__.load({
  id: 'codex2dsh',
  factory: (require) => {
    const React = require('react')           // host 提供（唯一外部依赖）
    // ...
    module.exports = { name, inject: ['slots', 'locale'], apply }
    return module.exports
  },
})
```

### 10.3 服务与槽位

| 服务 | 用途 |
| --- | --- |
| `locale`（注入声明） | `ctx.effect(() => locale.register(NS, { zh, en }))` 注册面板字典，随 DSH web 语言切换 |
| `slots`（注入声明） | `ctx.slots.inject('settings.plugins.tab', cb)` 注册设置页 Tab |
| `settingsScope`（可选，回调内 resolve） | `ctx.get('settingsScope')` → `bind({ namespace })`；缺席时跳过注册（无设置页的 profile 不报错） |

槽位 `settings.plugins.tab`（由 ui-settings-plugins 声明）：`ctx.slots.register({ name, id, order, label: () => t(...), locale, inject: () => ({ scope }) }, () => h(Tab, { t }))`。

### 10.4 面板路由（后端）

client 通过 fetch 调用后端路由（`lib/panel.mjs`，经 `ctx.inject(['webServer'])` 延后注册，headless 不挂载）：

| 路由 | 语义 |
| --- | --- |
| `GET /codex2dsh/status` | 资产清单 + 台账计数 + 凭据文件（只读） |
| `POST /codex2dsh/preview` | 全资产预览（零副作用） |
| `POST /codex2dsh/migrate` | `{ action, apply?, ... }` 执行/预览单个迁移（与工具面同一套 lib 编排） |
| `POST /codex2dsh/backfill-titles` | `{ apply?, codexHome?, sessionIds? }` 已导入 Codex 会话补 `session/title` 事件（默认 dry-run 预览；只补不覆盖） |
| `POST /codex2dsh/regroup` | `{ apply?, codexHome?, regroupDir? }` 非工作区会话统一归组（默认 dry-run；执行后重启 DSH） |

webServer 路由形态：`ws.register({ kind: 'exact', path, handler: async (req, res) => {...} })`，`res.writeHead/end` 输出 JSON。
