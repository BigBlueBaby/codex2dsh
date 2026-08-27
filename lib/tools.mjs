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
import { runMcpMigration } from './mcp.mjs'
import { analyzeSkills, planSkillsMigration, migrateSkills } from './skills.mjs'
import { planInstructionsMigration, migrateInstructions } from './instructions.mjs'
import { planMemoryMigration, migrateMemory } from './memory.mjs'
import { buildConfigSuggestions } from './settings.mjs'
import { runDoctor } from './doctor.mjs'
import { planSessionsMigration } from './delegate.mjs'
import { planTitleBackfill } from './title.mjs'
import { verifyMigration } from './verify.mjs'
import { importMemoryToMnemon } from './memory.mjs'
import { planRegroup } from './regroup.mjs'
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
    description: '把 Codex config.toml 的 [mcp_servers.*] 镜像为 DSH MCP client 配置片段（mcp-mirror.cordis.yml）；默认 dry-run，apply:true 才写盘；密钥默认原样迁移（maskSecrets:true 脱敏）；本地工具目录（如 mcp-toolbox）随迁并重写路径；绝不自动修改 profile。',
    parameters: {
      apply: { type: 'boolean', description: 'true 时写盘生成 mcp-mirror.cordis.yml；缺省 false = 预览'},
      codexHome: { type: 'string', description: '可选：Codex 配置根（默认 ~/.codex）'},
      outPath: { type: 'string', description: '可选：镜像文件输出路径（默认 $DSH_HOME/codex2dsh/mcp-mirror.cordis.yml）'},
      excludeRuntime: { type: 'boolean', description: '可选：排除 Codex 运行时服务器（默认 true）'},
      force: { type: 'boolean', description: '可选：目标已存在且内容不同时强制覆盖（默认 false）'},
      expectedHash: { type: 'string', description: '可选：源文件期望 SHA-256（小写 hex），不匹配则失败'},
      maskSecrets: { type: 'boolean', description: '可选：true 时密钥脱敏为 ****（默认 false = 按原样迁移，仅报告计数）'},
      include: { type: 'array', items: { type: 'string' }, description: '可选：只迁移这些服务器（精确名；缺省 = 全部）'},
      exclude: { type: 'array', items: { type: 'string' }, description: '可选：排除这些服务器（支持 * 前缀通配，如 "node_*"）'},
      migrateTools: { type: 'boolean', description: '可选：迁移本地工具目录（如 mcp-toolbox）并重写镜像路径（默认 true）'},
      toolsTarget: { type: 'string', description: '可选：工具迁移目标根（默认 $DSH_HOME/codex2dsh/tools）'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      return runMcpMigration({
        codexHome: a.codexHome,
        outPath: a.outPath,
        excludeRuntime: a.excludeRuntime !== false,
        force: a.force === true,
        expectedHash: a.expectedHash,
        apply: a.apply === true,
        maskSecrets: a.maskSecrets === true,
        include: a.include,
        exclude: a.exclude,
        migrateTools: a.migrateTools !== false,
        toolsTarget: a.toolsTarget,
      }, { ledgerDir })
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
      include: { type: 'array', items: { type: 'string' }, description: '可选：只迁移这些技能（精确名；缺省 = 全部候选）'},
      exclude: { type: 'array', items: { type: 'string' }, description: '可选：排除这些技能（支持 * 前缀通配，如 "ccpanes-*"）'},
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
      const opts = {
        agentsHome,
        fixFrontmatter: a.fixFrontmatter === true,
        force: a.force === true,
        ledgerDir,
        include: a.include,
        exclude: a.exclude,
      }
      if (!a.apply) {
        return planSkillsMigration(skillsDir, opts)
      }
      return migrateSkills(skillsDir, agentsHome, opts)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'migrate_codex_instructions',
    description: '把 ~/.codex/AGENTS.md 与 instructions.md 迁移为 DSH 用户全局指令（$DSH_HOME/AGENTS.md，DSH 唯一识别的全局指令位置；原文完整保留，instructions.md 合并进同一文件）；默认 dry-run。',
    parameters: {
      apply: { type: 'boolean', description: 'true 时落盘；缺省 false = 预览'},
      codexHome: { type: 'string'},
      dshHome: { type: 'string', description: '可选：DSH 家目录（默认 $DSH_HOME，即 ~/.dsh），指令写到 <dshHome>/AGENTS.md'},
      force: { type: 'boolean', description: '可选：目标已存在且内容不同时覆盖'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      const codexHome = resolveCodexHome(a.codexHome)
      const dshHome = a.dshHome || resolveDshHome()
      if (!a.apply) return planInstructionsMigration(codexHome, {})
      return migrateInstructions(codexHome, dshHome, { force: a.force === true, ledgerDir })
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

  // ── migrate_codex_sessions（M4，已实现：统计 + 委托 import_chat）─────────
  ctx.tools.register(defineTool({
    name: 'migrate_codex_sessions',
    description: '统计 ~/.codex/sessions 会话规模并委托 import_chat（dsh-chat-import）导入为可续聊的 DSH 会话；未安装 dsh-chat-import 时返回安装指引。',
    parameters: {
      preview: { type: 'boolean', description: 'true 时只统计与委托预览（不落盘）'},
      codexHome: { type: 'string'},
      budget: { type: 'integer', description: '可选：上下文预算（token 数），透传给 import_chat'},
      restamp: { type: 'boolean', description: '可选：导入会话时间戳平移到当前时间，透传给 import_chat'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      const codexHome = resolveCodexHome(a.codexHome)
      return planSessionsMigration(codexHome, ctx, {
        preview: a.preview === true,
        budget: a.budget,
        restamp: a.restamp === true,
        ledgerDir,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'codex2dsh_fix_titles',
    description: '修复已导入 Codex 会话的标题：从 ~/.codex/session_index.jsonl（thread_name，优先）或 rollout 首条真实提问回填 session/title 事件；只补不覆盖（已有标题/用户改名/非 Codex 导入跳过）；默认 dry-run 预览，apply:true 才写盘。',
    parameters: {
      apply: { type: 'boolean', description: 'true 时写盘追加 session/title 事件；缺省 false = 只预览'},
      codexHome: { type: 'string'},
      sessionIds: { type: 'array', items: { type: 'string' }, description: '可选：只处理这些 DSH 会话 id（缺省 = 全部导入会话）'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      const codexHome = resolveCodexHome(a.codexHome)
      return planTitleBackfill(ctx, {
        codexHome,
        sessionIds: Array.isArray(a.sessionIds) ? a.sessionIds : null,
        dryRun: a.apply !== true,
        ledgerDir,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'codex2dsh_regroup_sessions',
    description: '整理已导入 Codex 会话的工作区：把 Codex 非工作区会话（.codex-global-state.json 的 projectless-thread-ids，或 cwd 在非工作区根下）统一归到单个 DSH 工作区（改写 header.cwd + 移动日志目录），消除「一个会话一个工作区」的乱序；其余会话不动；默认 dry-run，apply:true 才执行；执行后需重启 DSH。',
    parameters: {
      apply: { type: 'boolean', description: 'true 时执行归组（改写 header.cwd + 移动目录）；缺省 false = 只预览'},
      codexHome: { type: 'string'},
      regroupDir: { type: 'string', description: '可选：非工作区会话统一目录（默认取 Codex thread-workspace-root-hints 众数根）'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      const codexHome = resolveCodexHome(a.codexHome)
      return planRegroup(ctx, {
        codexHome,
        regroupDir: typeof a.regroupDir === 'string' && a.regroupDir ? a.regroupDir : undefined,
        dryRun: a.apply !== true,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'codex2dsh_import_memory',
    description: '把迁移的 Codex 记忆导入 dsh-mnemon（全局记忆引擎，storageScope=global → ~/.mnemon）：Runtime 层提炼 memory_summary.md 为每轮注入的 USER/MEMORY 条目（容量裁剪、合并去重）；Documents 层导入 MEMORY.md/memory_summary.md/raw_memories.md 三份完整文档（可搜索）。需先安装 dsh-mnemon 插件并完成首启。',
    parameters: {
      codexHome: { type: 'string'},
      mnemonRoot: { type: 'string', description: '可选：dsh-mnemon 存储根（默认 ~/.mnemon，即 storageScope=global）'},
      force: { type: 'boolean', description: '可选：true 时覆盖已导入的同名文档（memories.json 始终合并去重）'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      return importMemoryToMnemon({ codexHome: resolveCodexHome(a.codexHome), mnemonRoot: a.mnemonRoot, force: a.force === true, ledgerDir })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'codex2dsh_verify',
    description: '迁移可调用性验证（只读）：检查 MCP 镜像是否已合并进 profile（未合并 = DSH 中 MCP 未加载）、stdio 服务器命令/配置路径是否存在、AGENTS.md 中的 MCP/工具引用在 DSH 配置中是否成立。迁移成功 = 在 DSH 中真实可用，而非文件已生成。',
    parameters: {
      codexHome: { type: 'string'},
      dshHome: { type: 'string', description: '可选：DSH 家目录（默认 $DSH_HOME）'},
    },
    output: toolOutput(),
    async execute(args) {
      const a = args ?? {}
      return verifyMigration(resolveCodexHome(a.codexHome), a.dshHome || resolveDshHome(), { ledgerDir })
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
