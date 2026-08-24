#!/usr/bin/env node
// bin/codex2dsh.mjs —— CLI（无 GUI 环境下与工具同能力）
//
// 用法：
//   codex2dsh preview                     # 只读预览全部可迁移资产
//   codex2dsh mcp [--apply] [--out PATH]  # MCP 镜像（默认 dry-run）
//   codex2dsh skills [--apply] [--agents-home DIR] [--fix-frontmatter] [--force]
//   codex2dsh instructions [--apply] [--agents-home DIR] [--force]
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
  codex2dsh mcp [--apply] [--out PATH]   MCP 镜像（默认 dry-run，--apply 写盘）
  codex2dsh skills [--apply] [--agents-home DIR] [--fix-frontmatter] [--force]
  codex2dsh instructions [--apply] [--agents-home DIR] [--force]
  codex2dsh memory [--apply] [--out DIR] [--force]
  codex2dsh config [--apply] [--out PATH] [--force]
  codex2dsh sessions [--preview]         统计；委托需在 DSH 会话内调用工具
  codex2dsh doctor                       迁移体检
  codex2dsh ledger                       打印迁移台账

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
      const configPath = join(codexHome, 'config.toml')
      if (!existsSync(configPath)) return fail(`未找到 ${configPath}`)
      const source = readFileSync(configPath, 'utf8')
      const { config } = parseCodexConfig(source)
      const { plan, excluded, maskedCount } = buildMcpPlan(config, { excludeRuntime: true })
      const target = flags.out ? String(flags.out) : join(ledgerDir, 'mcp-mirror.cordis.yml')
      const content = renderMcpPlan({ plan, source: configPath })
      const items = plan.map((s) => ({ kind: 'mcp', name: s.name, status: 'generated', target, secretsMasked: s.secretsMasked ?? 0 }))
      for (const name of excluded) items.push({ kind: 'mcp', name, status: 'skipped', note: '运行时服务器，默认排除' })
      if (!apply) {
        console.log(JSON.stringify(makeReport({ items, previewed: true, warnings: maskedCount ? [`共脱敏 ${maskedCount} 处敏感值`] : [] }), null, 2))
        console.log('\n--- 预览片段（--apply 写盘）---\n' + content)
        return
      }
      const existing = existsSync(target) ? readFileSync(target, 'utf8') : null
      const decision = decideWrite(content, existing, false)
      if (decision === 'conflict') return fail(`目标文件已存在且内容不同（${target}）；请确认后删除或改用 --out`)
      if (decision === 'write') {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content, 'utf8')
        appendLedger(ledgerDir, { tool: 'migrate_codex_mcp', source: configPath, target, status: 'generated', maskedCount })
        ok(`已写入 ${target}（脱敏 ${maskedCount} 处；请人工审阅后合并进 profile）`)
      } else {
        ok('目标内容未变化，已跳过')
      }
      return
    }
    case 'skills': {
      const skillsDir = join(codexHome, 'skills')
      if (!existsSync(skillsDir)) return fail(`未找到技能目录 ${skillsDir}`)
      const report = apply
        ? await migrateSkills(skillsDir, agentsHome, { fixFrontmatter: flags['fix-frontmatter'] === true, force: flags.force === true, ledgerDir })
        : await planSkillsMigration(skillsDir, { agentsHome, fixFrontmatter: flags['fix-frontmatter'] === true })
      console.log(JSON.stringify(report, null, 2))
      return
    }
    case 'instructions': {
      const report = apply
        ? await migrateInstructions(codexHome, agentsHome, { force: flags.force === true, ledgerDir })
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
    case 'doctor': {
      const report = await runDoctor(codexHome, { ledgerDir })
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
