// index.mjs —— codex2dsh 插件入口（薄组合层）
//
// 把 Codex（~/.codex）的 MCP / 技能 / 全局指令 / 记忆 / 模型偏好
// 以「适配 DSH」的形式迁移进 DeepSeek Harness。消费 host 的 fs / tools 服务，
// webServer / commands 为可选服务（headless / CLI 会话不挂载，插件照常激活）。
//
// 职责拆分见 docs/05-实现方案.md；映射规范见 docs/03-映射规范.md。
// 当前为骨架：registerTools 只注册已实现的工具，其余随里程碑 M1–M4 逐步补齐。

import { resolveLedgerDir } from './lib/paths.mjs'
import { registerTools } from './lib/tools.mjs'
import { registerCommands } from './lib/command.mjs'
import { registerPanelRoutes } from './lib/panel.mjs'

// 必需 host 服务（缺失则插件不激活）
const inject = ['fs', 'tools']

function apply(ctx) {
  // 1) 注册迁移工具（核心面）
  registerTools(ctx, resolveLedgerDir())

  // 2) 斜杠命令（可选服务，延后注册；headless 下不执行）
  ctx.inject?.(['commands'], ({ commands }) => {
    registerCommands(ctx, commands, resolveLedgerDir())
  })

  // 3) web 面板路由（可选服务，延后注册；headless 下不执行）
  ctx.inject?.(['webServer'], ({ webServer }) => {
    registerPanelRoutes(ctx, webServer, resolveLedgerDir())
  })
}

export { apply, inject }
export const name = 'codex2dsh'
