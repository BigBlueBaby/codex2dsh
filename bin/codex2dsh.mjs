#!/usr/bin/env node
// bin/codex2dsh.mjs —— CLI（无 GUI 环境下与工具同能力）
//
// 用法：
//   codex2dsh preview                     # 只读预览全部可迁移资产
//   codex2dsh mcp [--apply] [--out PATH]  # MCP 镜像（默认 dry-run）
//   codex2dsh skills [--apply] [--agents-home DIR] [--fix-frontmatter] [--force]
//   codex2dsh instructions [--apply] [--dsh-home DIR] [--force]
//   codex2dsh memory [--apply] [--out DIR] [--force]
//   codex2dsh config [--apply] [--out PATH] [--force]
//   codex2dsh sessions [--preview]        # 统计 + 委托指引（委托需在 DSH 会话内）
//   codex2dsh doctor                      # 体检
//   codex2dsh ledger                      # 打印迁移台账
//
// 全局参数：--codex-home PATH（默认 ~/.codex 或 $CODEX_HOME）
// 共享 lib/ 纯函数（与工具面同一套转换/脱敏/幂等逻辑）。

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveCodexHome, resolveAgentsHome, resolveDshHome, resolveLedgerDir } from '../lib/paths.mjs'
import { scanCodexHome } from '../lib/scan.mjs'
import { readLedger } from '../lib/ledger.mjs'
import { makeReport } from '../lib/report.mjs'
import { parseCodexConfig } from '../lib/config.mjs'
import { buildMcpPlan, renderMcpPlan, decideWrite } from '../lib/mcp.mjs'
import { appendLedger } from '../lib/ledger.mjs'
import { planSkillsMigration, migrateSkills } from '../lib/skills.mjs'
import { planInstructionsMigration, migrateInstructions } from '../lib/instructions.mjs'
import { planMemoryMigration, migrateMemory } from '../lib/memory.mjs'
import { buildConfigSuggestions } from '../lib/settings.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { planSessionsMigration } from '../lib/delegate.mjs'

const HELP = `codex2dsh —— 把 Codex 配置迁移进 DSH（DSH 插件 CLI）

用法:
  codex2dsh preview                      只读预览全部可迁移资产
  codex2dsh mcp [--apply] [--out PATH]   MCP 镜像（密钥默认原样迁移；工具目录随迁）
  codex2dsh skills [--apply] [--agents-home DIR] [--fix-frontmatter] [--force]
  codex2dsh instructions [--apply] [--dsh-home DIR] [--force]
  codex2dsh memory [--apply] [--out DIR] [--force]
  codex2dsh memory-import [--mnemon-root DIR] [--force]
                                         导入迁移的 Codex 记忆到 dsh-mnemon（全局记忆引擎，默认 ~/.mnemon）
  codex2dsh config [--apply] [--out PATH] [--force]
  codex2dsh sessions [--preview]         统计；委托需在 DSH 会话内调用工具
  codex2dsh titles [--dsh-home PATH]     只读预览：哪些已导入 Codex 会话缺标题、
                                         将补什么标题（写盘请在 DSH 面板/工具内执行）
  codex2dsh repair-titles [--apply]      修复坏标题事件（0.1.1 早期缺陷误带
                                         surfaceOp 导致会话打不开）；默认 dry-run；
                                         修复后请重启 DSH 再回填标题
  codex2dsh regroup [--apply] [--dir PATH]  整理已导入会话工作区：Codex 非工作区
                                         会话统一归到单个 DSH 工作区（默认 dry-run，
                                         执行后重启 DSH）
  codex2dsh doctor                       迁移体检
  codex2dsh verify                       迁移可调用性验证（只读）：MCP 是否已合并
                                         进 profile、工具是否可执行、AGENTS.md 引用
                                         是否在 DSH 配置中成立
  codex2dsh ledger                       打印迁移台账

选择性迁移（mcp / skills）:
  --include a,b    只迁移这些项（精确名）
  --exclude a,b    排除这些项（支持 * 前缀通配，如 ccpanes-*, kingbase-*）

mcp 专属:
  --mask-secrets   敏感值替换为 ****（默认原样迁移）
  --no-tools       不随迁本地工具目录（默认随迁并重写路径）
  --tools-target DIR  工具迁移目标根（默认 $DSH_HOME/codex2dsh/tools）

全局参数:
  --codex-home PATH  指定 Codex 配置根（默认 ~/.codex 或 $CODEX_HOME）
`

function fail(msg) {
  console.error(`[codex2dsh] ${msg}`)
  process.exitCode = 1
}

function ok(msg) {
  console.log(`[codex2dsh] ${msg}`)
}

/** 解析逗号分隔列表参数：--include a,b → ['a','b'] */
function splitList(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

function parseArgs(argv) {
  const out = { flags: {}, positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) out.flags[a.slice(2, eq)] = a.slice(eq + 1)
      else out.flags[a.slice(2)] = true
    } else {
      out.positional.push(a)
    }
  }
  return out
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2))
  const cmd = positional[0]
  const codexHome = flags['codex-home'] ? String(flags['codex-home']) : resolveCodexHome()
  const ledgerDir = resolveLedgerDir()
  const agentsHome = flags['agents-home'] ? String(flags['agents-home']) : resolveAgentsHome()
  const apply = flags.apply === true

  switch (cmd) {
    case 'preview': {
      const { items, warnings } = scanCodexHome(codexHome)
      console.log(JSON.stringify(makeReport({ items, warnings, previewed: true, ledgerPath: ledgerDir }), null, 2))
      return
    }
    case 'mcp': {
      const { runMcpMigration } = await import('../lib/mcp.mjs')
      const report = await runMcpMigration({
        codexHome,
        outPath: flags.out ? String(flags.out) : undefined,
        apply,
        force: flags.force === true,
        maskSecrets: flags['mask-secrets'] === true,
        include: splitList(flags.include),
        exclude: splitList(flags.exclude),
        migrateTools: flags['no-tools'] !== true,
        toolsTarget: flags['tools-target'] ? String(flags['tools-target']) : undefined,
      }, { ledgerDir })
      console.log(JSON.stringify(report, null, 2))
      return
    }
    case 'skills': {
      const skillsDir = join(codexHome, 'skills')
      if (!existsSync(skillsDir)) return fail(`未找到技能目录 ${skillsDir}`)
      const sel = { include: splitList(flags.include), exclude: splitList(flags.exclude) }
      const report = apply
        ? await migrateSkills(skillsDir, agentsHome, { fixFrontmatter: flags['fix-frontmatter'] === true, force: flags.force === true, ledgerDir, ...sel })
        : await planSkillsMigration(skillsDir, { agentsHome, fixFrontmatter: flags['fix-frontmatter'] === true, ...sel })
      console.log(JSON.stringify(report, null, 2))
      return
    }
    case 'instructions': {
      const dshHome = flags['dsh-home'] ? String(flags['dsh-home']) : (flags['agents-home'] ? String(flags['agents-home']) : resolveDshHome())
      const report = apply
        ? await migrateInstructions(codexHome, dshHome, { force: flags.force === true, ledgerDir })
        : await planInstructionsMigration(codexHome)
      console.log(JSON.stringify(report, null, 2))
      return
    }
    case 'memory': {
      const outDir = flags.out ? String(flags.out) : join(resolveDshHome(), 'memories', 'codex')
      const report = apply
        ? await migrateMemory(codexHome, outDir, { force: flags.force === true, ledgerDir })
        : await planMemoryMigration(codexHome)
      console.log(JSON.stringify(report, null, 2))
      return
    }
    case 'memory-import': {
      // 把迁移的 Codex 记忆导入 dsh-mnemon（全局记忆引擎，默认 ~/.mnemon）
      const { importMemoryToMnemon } = await import('../lib/memory.mjs')
      const mnemonRoot = flags['mnemon-root'] ? String(flags['mnemon-root']) : undefined
      const report = await importMemoryToMnemon({ codexHome, mnemonRoot, force: flags.force === true, ledgerDir })
      console.log(JSON.stringify(report, null, 2))
      return
    }
    case 'config': {
      const { report, suggestions, yamlText } = await buildConfigSuggestions(codexHome, {
        apply,
        outPath: flags.out ? String(flags.out) : undefined,
        force: flags.force === true,
        ledgerDir,
      })
      console.log(JSON.stringify({ ...report, ...(suggestions ? { suggestions } : {}), ...(yamlText && !apply ? { yamlPreview: yamlText } : {}) }, null, 2))
      return
    }
    case 'sessions': {
      // CLI 无 host 上下文：统计 + 委托指引；正式委托请在 DSH 会话内调用 migrate_codex_sessions
      const report = await planSessionsMigration(codexHome, null, { preview: flags.preview === true, ledgerDir })
      console.log(JSON.stringify(report, null, 2))
      if (report.items.some((i) => i.name === 'delegation' && i.status === 'skipped')) {
        ok('提示：正式委托导入请在 DSH 会话内调用 migrate_codex_sessions（需已安装 dsh-chat-import）')
      }
      return
    }
    case 'titles': {
      // 只读预览：直接读 DSH 会话日志工件，报告缺标题的 codex 导入会话与将补标题。
      // 不直写日志文件——写盘必须走宿主 sessionPersistence（面板「修复标题」/
      // codex2dsh_fix_titles 工具），避免与 DSH 运行中的写游标并发冲突。
      const { scanTitleBackfillStandalone } = await import('../lib/title.mjs')
      const dshHome = flags['dsh-home'] ? String(flags['dsh-home']) : resolveDshHome()
      const plan = await scanTitleBackfillStandalone(codexHome, join(dshHome, 'sessions'))
      console.log(JSON.stringify(plan, null, 2))
      if (plan.planned.length > 0) {
        ok(`提示：${plan.planned.length} 个会话将补标题；实际写盘请在 DSH 面板「会话导入 → 修复标题」或调用 codex2dsh_fix_titles 工具`)
      }
      return
    }
    case 'repair-titles': {
      // 修复 0.1.1 早期缺陷：session/title 误带 surfaceOp 导致会话无法打开。
      // 截掉日志末帧/末行的坏标题事件（默认 dry-run，--apply 才截断）。
      // 必须在 DSH 宿主外执行；修复后重启 DSH 再回填标题。
      const { repairBadTitleFrames } = await import('../lib/title.mjs')
      const dshHome = flags['dsh-home'] ? String(flags['dsh-home']) : resolveDshHome()
      const result = await repairBadTitleFrames(join(dshHome, 'sessions'), { dryRun: flags.apply !== true })
      console.log(JSON.stringify(result, null, 2))
      if (result.dryRun && result.repaired.length > 0) {
        ok(`提示：${result.repaired.length} 个会话含坏标题事件（将截断修复）；确认后加 --apply 执行`)
      } else if (!result.dryRun && result.repaired.length > 0) {
        ok(`提示：已修复 ${result.repaired.length} 个会话；请重启 DSH 后重新执行「修复标题」回填正确标题`)
      }
      return
    }
    case 'regroup': {
      // 整理工作区：Codex 非工作区会话统一归到单个 DSH 工作区
      // （改写 header.cwd + 移动日志目录；默认 dry-run，--apply 执行）。
      const { scanRegroupStandalone } = await import('../lib/regroup.mjs')
      const dshHome = flags['dsh-home'] ? String(flags['dsh-home']) : resolveDshHome()
      const result = await scanRegroupStandalone(codexHome, join(dshHome, 'sessions'), {
        dryRun: flags.apply !== true,
        regroupDir: flags.dir ? String(flags.dir) : undefined,
      })
      console.log(JSON.stringify(result, null, 2))
      if (result.dryRun && result.planned.length > 0) {
        ok(`提示：${result.planned.length} 个非工作区会话将归组到 ${result.regroupDir}；确认后加 --apply 执行，执行后请重启 DSH`)
      } else if (!result.dryRun && result.applied.length > 0) {
        ok(`提示：已归组 ${result.applied.length} 个会话到 ${result.regroupDir}；请重启 DSH 让工作区分组生效`)
      }
      return
    }
    case 'doctor': {
      const report = await runDoctor(codexHome, { ledgerDir })
      console.log(JSON.stringify(report, null, 2))
      return
    }
    case 'verify': {
      // 迁移可调用性验证（只读）：MCP 是否已合并进 profile、工具是否可执行、
      // AGENTS.md 引用是否在 DSH 配置中成立
      const { verifyMigration } = await import('../lib/verify.mjs')
      const dshHome = flags['dsh-home'] ? String(flags['dsh-home']) : resolveDshHome()
      const report = await verifyMigration(codexHome, dshHome, { ledgerDir })
      console.log(JSON.stringify(report, null, 2))
      return
    }
    case 'ledger': {
      console.log(JSON.stringify({ ok: true, entries: readLedger(ledgerDir).slice(-20), ledgerPath: join(ledgerDir, 'ledger.json') }, null, 2))
      return
    }
    case 'help':
    case undefined:
    case null: {
      console.log(HELP)
      return
    }
    default:
      return fail(`未知命令：${cmd}\n\n${HELP}`)
  }
}

main()
