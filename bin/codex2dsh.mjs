#!/usr/bin/env node
// bin/codex2dsh.mjs —— CLI（无 GUI 环境下与工具同能力）
//
// 用法：
//   codex2dsh preview                     # 只读预览（等同 migrate_codex_preview）
//   codex2dsh mcp [--apply] [--out PATH]  # MCP 镜像（默认 dry-run）
//   codex2dsh ledger                      # 打印台账摘要
//   codex2dsh skills|instructions|memory|config|sessions|doctor   # 里程碑 M2–M4 逐步开放
//
// 共享 lib/ 纯函数（同一套转换/脱敏/幂等逻辑）。

import { resolveCodexHome, resolveLedgerDir } from '../lib/paths.mjs'
import { scanCodexHome } from '../lib/scan.mjs'
import { readLedger } from '../lib/ledger.mjs'
import { makeReport } from '../lib/report.mjs'

const HELP = `codex2dsh —— 把 Codex 配置迁移进 DSH（DSH 插件 CLI）

用法:
  codex2dsh preview                     只读预览全部可迁移资产
  codex2dsh mcp [--apply] [--out PATH]  MCP 镜像（默认 dry-run，--apply 写盘）
  codex2dsh ledger                      打印迁移台账
  codex2dsh skills|instructions|memory|config|sessions|doctor   尚未实现（见 docs/05-实现方案.md）

全局参数:
  --codex-home PATH  指定 Codex 配置根（默认 ~/.codex 或 $CODEX_HOME）
`

function fail(msg) {
  console.error(`[codex2dsh] ${msg}`)
  process.exitCode = 1
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

  switch (cmd) {
    case 'preview': {
      const { items, warnings } = scanCodexHome(codexHome)
      const report = makeReport({ items, warnings, previewed: true, ledgerPath: resolveLedgerDir() })
      console.log(JSON.stringify(report, null, 2))
      return
    }
    case 'mcp': {
      // CLI 直接复用 lib/ 纯函数（与 migrate_codex_mcp 工具同一套逻辑）
      const { buildMcpPlan, renderMcpPlan, decideWrite } = await import('../lib/mcp.mjs')
      const { readFileSync, existsSync, writeFileSync, mkdirSync } = await import('node:fs')
      const { join } = await import('node:path')
      const { parseCodexConfig } = await import('../lib/config.mjs')
      const { appendLedger } = await import('../lib/ledger.mjs')
      const configPath = join(codexHome, 'config.toml')
      if (!existsSync(configPath)) return fail(`未找到 ${configPath}`)
      const source = readFileSync(configPath, 'utf8')
      const { config } = parseCodexConfig(source)
      const { plan, excluded, maskedCount } = buildMcpPlan(config, { excludeRuntime: true })
      const target = flags.out ? String(flags.out) : join(resolveLedgerDir(), 'mcp-mirror.cordis.yml')
      const content = renderMcpPlan({ plan, source: configPath, generatedAt: new Date().toISOString() })
      if (!flags.apply) {
        console.log(JSON.stringify(makeReport({
          items: plan.map((s) => ({ kind: 'mcp', name: s.name, status: 'generated', target, secretsMasked: s.secretsMasked ?? 0 })),
          previewed: true,
          warnings: maskedCount ? [`共脱敏 ${maskedCount} 处敏感值`] : [],
        }), null, 2))
        console.log('\n--- 预览片段（--apply 写盘）---\n' + content)
        return
      }
      const existing = existsSync(target) ? readFileSync(target, 'utf8') : null
      const decision = decideWrite(content, existing, false)
      if (decision === 'conflict') return fail(`目标文件已存在且内容不同（${target}）；CLI 暂不支持 force，请确认后删除或改用 --out`)
      if (decision === 'write') {
        mkdirSync(resolveLedgerDir(), { recursive: true })
        writeFileSync(target, content, 'utf8')
        appendLedger(resolveLedgerDir(), { tool: 'migrate_codex_mcp', source: configPath, target, status: 'generated', maskedCount })
        console.log(`[codex2dsh] 已写入 ${target}（脱敏 ${maskedCount} 处；请人工审阅后合并进 profile）`)
      } else {
        console.log('[codex2dsh] 目标内容未变化，已跳过')
      }
      return
    }
    case 'ledger': {
      console.log(JSON.stringify({ ok: true, entries: readLedger(resolveLedgerDir()).slice(-20), ledgerPath: join(resolveLedgerDir(), 'ledger.json') }, null, 2))
      return
    }
    case 'skills':
    case 'instructions':
    case 'memory':
    case 'config':
    case 'sessions':
    case 'doctor': {
      return fail(`${cmd} 尚未实现（里程碑见 docs/05-实现方案.md §2）`)
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
