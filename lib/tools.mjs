// lib/tools.mjs —— 工具注册（TOOL_SPECS + registerTools）
//
// 工具清单与参数见 docs/05-实现方案.md §2；schema 与 index.d.ts 的 ToolSurface 对齐。
// 已实现：migrate_codex_preview（M1）、migrate_codex_mcp（M2 核心）；
// 其余为占位工具（返回"尚未实现"报告，不抛异常，保证会话内可安全调用）。
//
// defineTool 契约（@deepseek-ai/dsh-tools，实测 0.1.0-rc.6）：
//   { name, description, parameters, output: { schema, render }, execute(args, exec) }
//   output 必填：schema 声明规范 JSON 值；render 生成模型可见文本。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseCodexConfig } from './config.mjs'
import { buildMcpPlan, renderMcpPlan, decideWrite } from './mcp.mjs'
import { analyzeSkills, planSkillsMigration, migrateSkills } from './skills.mjs'
import { planInstructionsMigration, migrateInstructions } from './instructions.mjs'
import { planMemoryMigration, migrateMemory } from './memory.mjs'
import { buildConfigSuggestions } from './settings.mjs'
import { runDoctor } from './doctor.mjs'
import { makeReport, sha256 } from './report.mjs'
import { appendLedger, readLedger } from './ledger.mjs'
import { scanCodexHome } from './scan.mjs'
import { resolveCodexHome, resolveAgentsHome, resolveDshHome, resolveMcpMirrorPath } from './paths.mjs'

/** 统一 output 声明：规范 JSON 值 + 文本渲染 */
function toolOutput() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

/** 未实现占位工具执行体：返回友好报告而非抛错 */
function notImplemented(toolName, milestone) {
  return async () => makeReport({
    ok: false,
    warnings: [`${toolName} 尚未实现（里程碑 ${milestone}，见 docs/05-实现方案.md）`],
  })
}

/**
 * 注册全部工具。
 * @param {object} ctx host 上下文（tools 已注入）
 * @param {string} ledgerDir 台账目录
 */
export function registerTools(ctx, ledgerDir) {
  // ── migrate_codex_preview（M1，已实现）──────────────────────────────
  ctx.tools.register(defineTool({
    name: 'migrate_codex_preview',
    description: '只读扫描 ~/.codex 全部可迁移资产（MCP/技能/指令/记忆/会话/敏感文件），返回结构化清单与规模；零副作用。',
    parameters: {
      codexHome: { type: 'string', description: '可选：Codex 配置根（默认 ~/.codex，可用环境变量 CODEX_HOME 覆盖）'},
    },
    output: toolOutput(),
    async execute(args) {
      const codexHome = resolveCodexHome(args?.codexHome)
      const { items, warnings } = scanCodexHome(codexHome)
      return makeReport({ items, warnings, previewed: true, ledgerPath: ledgerDir })
    },
  }))

  // ── migrate_codex_mcp（M2 核心，已实现）─────────────────────────────
  ctx.tools.register(defineTool({
    name: 'migrate_codex_mcp',
    description: '把 Codex config.toml 的 [mcp_servers.*] 镜像为 DSH MCP client 配置片段（mcp-mirror.cordis.yml）；默认 dry-run，apply:true 才写盘；密钥脱敏；绝不自动修改 profile。',
    parameters: {
      apply: { type: 'boolean', description: 'true 时写盘生成 mcp-mirror.cordis.yml；缺省 false = 预览'},
      codexHome: { type: 'string', description: '可选：Codex 配置根（默认 ~/.codex）'},
      outPath: { type: 'string', description: '可选：镜像文件输出路径（默认 $DSH_HOME/codex2dsh/mcp-mirror.cordis.yml）'},
      excludeRuntime: { type: 'boolean', description: '可选：排除 Codex 运行时服务器（默认 true）'},
      force: { type: 'boolean', description: '可选：目标已存在且内容不同时强制覆盖（默认 false）'},
      expectedHash: { type: 'string', description: '可选：源文件期望 SHA-256（小写 hex），不匹配则失败'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      const codexHome = resolveCodexHome(a.codexHome)
      const configPath = join(codexHome, 'config.toml')
      if (!existsSync(configPath)) {
        return makeReport({ ok: false, warnings: [`未找到 ${configPath}`] })
      }
      const source = readFileSync(configPath, 'utf8')
      if (a.expectedHash) {
        if (sha256(source) !== a.expectedHash.toLowerCase()) {
          return makeReport({ ok: false, warnings: ['expectedHash 与源文件 SHA-256 不匹配，拒绝执行'] })
        }
      }
      const { config, partial } = parseCodexConfig(source)
      const { plan, excluded, maskedCount } = buildMcpPlan(config, { excludeRuntime: a.excludeRuntime !== false })
      const target = resolveMcpMirrorPath(a.outPath)
      const content = renderMcpPlan({ plan, source: configPath, generatedAt: new Date().toISOString() })

      const items = plan.map((s) => ({
        kind: 'mcp', name: s.name, status: 'generated', target,
        secretsMasked: s.secretsMasked ?? 0,
        note: `${s.type} ${s.command}${s.secretsMasked ? '（含脱敏值，请改环境变量）' : ''}`,
      }))
      for (const name of excluded) {
        items.push({ kind: 'mcp', name, status: 'skipped', note: '运行时服务器，默认排除' })
      }
      for (const p of partial) {
        items.push({ kind: 'mcp', name: p, status: 'invalid', note: '仅部分解析，请人工确认' })
      }
      if (!a.apply) {
        return makeReport({ items, previewed: true, warnings: maskedCount ? [`共脱敏 ${maskedCount} 处敏感值`] : [], ledgerPath: ledgerDir })
      }

      // 幂等：内容相同跳过；不同且未 force 拒绝覆盖
      const existing = existsSync(target) ? readFileSync(target, 'utf8') : null
      const decision = decideWrite(content, existing, a.force === true)
      if (decision === 'skip') {
        return makeReport({ items, warnings: ['目标文件内容未变化，已跳过'], ledgerPath: ledgerDir })
      }
      if (decision === 'conflict') {
        return makeReport({ ok: false, items, warnings: [`目标文件已存在且内容不同（${target}）；如确认覆盖请用 force:true`], ledgerPath: ledgerDir })
      }
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content, 'utf8')
      appendLedger(ledgerDir, {
        tool: 'migrate_codex_mcp', source: configPath, target,
        status: 'generated', maskedCount,
      })
      return makeReport({ items, warnings: maskedCount ? [`共脱敏 ${maskedCount} 处敏感值；请人工审阅 ${target} 后合并进 profile`] : [], ledgerPath: ledgerDir })
    },
  }))

  // ── migrate_codex_skills（M2，已实现）───────────────────────────────
  ctx.tools.register(defineTool({
    name: 'migrate_codex_skills',
    description: '把 ~/.codex/skills 的用户技能转换落盘为 DSH 技能资产（$DSH_AGENTS_HOME/skills，默认 ~/.agents/skills）；frontmatter 追加 kind: dsh / source: codex，scripts 随迁；默认 dry-run（apply:true 才落盘）。',
    parameters: {
      apply: { type: 'boolean', description: 'true 时落盘；缺省 false = 预览'},
      codexHome: { type: 'string'},
      agentsHome: { type: 'string', description: '可选：技能落盘根（默认 $DSH_AGENTS_HOME，即 ~/.agents）'},
      fixFrontmatter: { type: 'boolean', description: '可选：缺 frontmatter 时用目录名/首段自动补全'},
      force: { type: 'boolean', description: '可选：目标同名且内容不同时覆盖（默认 false，自动消歧为 <name>-codex）'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      const codexHome = resolveCodexHome(a.codexHome)
      const skillsDir = join(codexHome, 'skills')
      if (!existsSync(skillsDir)) {
        return makeReport({ ok: false, warnings: [`未找到技能目录 ${skillsDir}`] })
      }
      const agentsHome = resolveAgentsHome(a.agentsHome)
      const opts = { agentsHome, fixFrontmatter: a.fixFrontmatter === true, force: a.force === true, ledgerDir }
      if (!a.apply) {
        return planSkillsMigration(skillsDir, opts)
      }
      return migrateSkills(skillsDir, agentsHome, opts)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'migrate_codex_instructions',
    description: '把 ~/.codex/AGENTS.md 与 instructions.md 迁移为 DSH 指令资产（原文完整保留）；默认 dry-run。',
    parameters: {
      apply: { type: 'boolean', description: 'true 时落盘；缺省 false = 预览'},
      codexHome: { type: 'string'},
      agentsHome: { type: 'string', description: '可选：指令资产落盘根（默认 $DSH_AGENTS_HOME，即 ~/.agents）'},
      force: { type: 'boolean', description: '可选：目标已存在且内容不同时覆盖'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      const codexHome = resolveCodexHome(a.codexHome)
      const agentsHome = resolveAgentsHome(a.agentsHome)
      if (!a.apply) return planInstructionsMigration(codexHome, {})
      return migrateInstructions(codexHome, agentsHome, { force: a.force === true, ledgerDir })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'migrate_codex_memory',
    description: '把 Codex 记忆（memories/ 与 memories_1.sqlite 只读探测）导出为 DSH 记忆资产；默认 dry-run；sqlite 不可读时降级报告。',
    parameters: {
      apply: { type: 'boolean', description: 'true 时落盘；缺省 false = 预览'},
      codexHome: { type: 'string'},
      outDir: { type: 'string', description: '可选：记忆资产输出目录（默认 $DSH_HOME/memories/codex）'},
      force: { type: 'boolean', description: '可选：目标已存在且内容不同时覆盖'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      const codexHome = resolveCodexHome(a.codexHome)
      const outDir = a.outDir || join(resolveDshHome(), 'memories', 'codex')
      if (!a.apply) return planMemoryMigration(codexHome, {})
      return migrateMemory(codexHome, outDir, { force: a.force === true, ledgerDir })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'migrate_codex_config',
    description: '只读生成模型/Provider/权限/项目信任迁移建议（settings-suggest.yml，apply 时写建议片段），绝不自动修改 settings.yaml。',
    parameters: {
      codexHome: { type: 'string'},
      apply: { type: 'boolean', description: 'true 时写建议片段文件；缺省 false = 只返回结构化建议'},
      outPath: { type: 'string', description: '可选：建议片段输出路径'},
      force: { type: 'boolean'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      const codexHome = resolveCodexHome(a.codexHome)
      const { report, suggestions, yamlText } = await buildConfigSuggestions(codexHome, {
        apply: a.apply === true,
        outPath: a.outPath,
        force: a.force === true,
        ledgerDir,
      })
      // 结构化建议附在报告上（schema additionalProperties:true 允许扩展字段）
      return { ...report, ...(suggestions ? { suggestions } : {}), ...(yamlText && !a.apply ? { yamlPreview: yamlText } : {}) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'migrate_codex_sessions',
    description: '统计 ~/.codex/sessions 会话规模并委托 import_codex（dsh-chat-import）导入为可续聊的 DSH 会话；未安装时返回安装指引。',
    parameters: {
      preview: { type: 'boolean'},
      codexHome: { type: 'string'},
      budget: { type: 'integer'},
      restamp: { type: 'boolean'},
    },
    output: toolOutput(),
    async execute() {
      return notImplemented('migrate_codex_sessions', 'M4')()
    },
  }))

  ctx.tools.register(defineTool({
    name: 'codex2dsh_doctor',
    description: '迁移体检：逐资产状态（已迁移/待迁移/不可迁移/密钥残留）与汇总。',
    parameters: {
      codexHome: { type: 'string'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      const codexHome = resolveCodexHome(a.codexHome)
      return runDoctor(codexHome, { ledgerDir })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'codex2dsh_ledger',
    description: '打印迁移台账摘要。',
    parameters: {},
    output: toolOutput(),
    async execute() {
      const entries = readLedger(ledgerDir)
      return { ok: true, entries: entries.slice(-20), ledgerPath: join(ledgerDir, 'ledger.json') }
    },
  }))
}
