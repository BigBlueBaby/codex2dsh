// lib/instructions.mjs —— 全局指令迁移（AGENTS.md / instructions.md → DSH 指令资产）
//
// 规范见 docs/03-映射规范.md §5：
//   1. 读取 ~/.codex/AGENTS.md 与 instructions.md（原文完整保留，不做摘要）
//   2. 头部追加来源注释块（<!-- codex2dsh: ... -->），不改变正文
//   3. 落盘 $DSH_AGENTS_HOME/instructions/{global.md, global-instructions.md}
//   4. 项目级 AGENTS.md：按 [projects.*] 信任列表扫描，生成挂载建议（不自动写盘）
//   5. 幂等：目标内容相同 → skipped；不同且未 force → conflict
//   6. 台账记录

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCodexConfig } from './config.mjs'
import { appendLedger } from './ledger.mjs'
import { makeReport } from './report.mjs'

/** 来源注释块（HTML 注释，Markdown 渲染不可见，正文零改动） */
export function sourceBlock(file) {
  return `<!-- codex2dsh: 来源 ${file}（迁移自 Codex，正文未改动；删除本行即可脱离追踪） -->\n\n`
}

/** 分析指令资产：返回 { files: [{name, sourcePath, exists, size}], projects: [...] } */
export function analyzeInstructions(codexHome) {
  const files = []
  for (const name of ['AGENTS.md', 'instructions.md']) {
    const p = join(codexHome, name)
    files.push({
      name,
      target: name === 'AGENTS.md' ? 'global.md' : 'global-instructions.md',
      exists: existsSync(p),
      size: existsSync(p) ? statSync(p).size : 0,
    })
  }
  // 项目级 AGENTS.md（只读探测 [projects.*] 信任目录）
  const projects = []
  const configPath = join(codexHome, 'config.toml')
  if (existsSync(configPath)) {
    const { config } = parseCodexConfig(readFileSync(configPath, 'utf8'))
    for (const [path, info] of Object.entries(config.projects ?? {})) {
      const agents = join(path, 'AGENTS.md')
      projects.push({ path, trustLevel: info.trustLevel, hasAgents: existsSync(agents), agentsPath: agents })
    }
  }
  return { files, projects }
}

/**
 * 预览指令迁移（dry-run，零副作用）。
 * @param {string} codexHome
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function planInstructionsMigration(codexHome, opts = {}) {
  void opts
  const { files, projects } = analyzeInstructions(codexHome)
  const items = files.map((f) => ({
    kind: 'instruction', name: f.name, status: f.exists ? 'previewed' : 'skipped',
    target: f.exists ? join('$DSH_AGENTS_HOME/instructions', f.target) : undefined,
    note: f.exists ? `${f.size} bytes → 原文保留 + 来源注释` : '源文件不存在',
  }))
  for (const p of projects) {
    if (p.hasAgents) {
      items.push({
        kind: 'instruction', name: `${p.path}\\AGENTS.md`, status: 'previewed',
        note: `项目级规则（trust=${p.trustLevel}）：建议在 DSH 项目级指令资产挂载，不自动写盘`,
      })
    }
  }
  return makeReport({ items, previewed: true })
}

/**
 * 执行指令迁移（apply 语义）。
 * @param {string} codexHome
 * @param {string} agentsHome 指令落盘根（调用方负责解析默认值）
 * @param {object} [opts] { force?, ledgerDir? }
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function migrateInstructions(codexHome, agentsHome, opts = {}) {
  const ledgerDir = opts.ledgerDir
  const { files, projects } = analyzeInstructions(codexHome)
  const items = []
  const warnings = []
  const outRoot = join(agentsHome, 'instructions')

  for (const f of files) {
    if (!f.exists) {
      items.push({ kind: 'instruction', name: f.name, status: 'skipped', note: '源文件不存在' })
      continue
    }
    const source = readFileSync(join(codexHome, f.name), 'utf8')
    const content = sourceBlock(join(codexHome, f.name)) + source
    const target = join(outRoot, f.target)
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (existing === content) {
      items.push({ kind: 'instruction', name: f.name, status: 'skipped', target, note: '目标内容相同，幂等跳过' })
      continue
    }
    if (existing !== null && opts.force !== true) {
      items.push({ kind: 'instruction', name: f.name, status: 'skipped', target, note: `目标已存在且内容不同（${target}）；如确认覆盖请用 force:true` })
      continue
    }
    mkdirSync(outRoot, { recursive: true })
    writeFileSync(target, content, 'utf8')
    if (ledgerDir) {
      appendLedger(ledgerDir, { tool: 'migrate_codex_instructions', source: join(codexHome, f.name), target, status: 'migrated' })
    }
    items.push({ kind: 'instruction', name: f.name, status: 'migrated', target, note: '原文完整保留，头部追加来源注释' })
  }

  // 项目级规则：只生成建议（R4 人工闸门）
  for (const p of projects) {
    if (p.hasAgents) {
      items.push({
        kind: 'instruction', name: `${p.path}\\AGENTS.md`, status: 'skipped',
        note: `项目级规则（trust=${p.trustLevel}）已探测：建议在 DSH 项目级指令资产手动挂载，本工具不自动写盘`,
      })
    }
  }

  return makeReport({ items, warnings, ledgerPath: ledgerDir })
}
