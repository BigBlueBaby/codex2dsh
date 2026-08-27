// lib/doctor.mjs —— 体检（迁移前后健康检查）
//
// 规范见 docs/03-映射规范.md §10 与 docs/09-安全边界.md：
//   逐资产状态：已迁移（台账命中）/ 待迁移（源存在未迁移）/ 不可迁移（secret/not-applicable）
//   密钥残留与待办汇总；只读，零副作用。

import { join } from 'node:path'
import { scanCodexHome } from './scan.mjs'
import { analyzeSkills } from './skills.mjs'
import { readLedger } from './ledger.mjs'
import { makeReport } from './report.mjs'

const CATEGORY_TOOL = {
  mcp: 'migrate_codex_mcp',
  skills: 'migrate_codex_skills',
  instructions: 'migrate_codex_instructions',
  memory: 'migrate_codex_memory',
  config: 'migrate_codex_config',
}

/**
 * 体检。
 * @param {string} codexHome
 * @param {object} [opts] { ledgerDir? }
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function runDoctor(codexHome, opts = {}) {
  const { items: scanItems, warnings } = scanCodexHome(codexHome)
  const ledger = opts.ledgerDir ? readLedger(opts.ledgerDir) : []
  const items = []
  const byTool = {}
  for (const t of Object.values(CATEGORY_TOOL)) byTool[t] = ledger.filter((e) => e.tool === t).length

  // 各资产类别状态
  const hasConfig = scanItems.some((i) => i.kind === 'config' && i.status !== 'skipped')
  if (hasConfig) {
    const migrated = byTool.migrate_codex_mcp > 0 || byTool.migrate_codex_config > 0
    items.push({
      kind: 'config', name: 'config.toml', status: migrated ? 'migrated' : 'skipped',
      note: migrated ? '已生成迁移产物（见台账）' : '未迁移：请先运行 migrate_codex_mcp / migrate_codex_config',
    })
  }

  const mcpItem = scanItems.find((i) => i.kind === 'mcp')
  if (mcpItem) {
    items.push({
      kind: 'mcp', name: 'mcp_servers', status: byTool.migrate_codex_mcp > 0 ? 'migrated' : 'skipped',
      note: byTool.migrate_codex_mcp > 0
        ? `已生成镜像（台账 ${byTool.migrate_codex_mcp} 次）；请确认已人工合并进 profile`
        : '未迁移：运行 migrate_codex_mcp 生成 mcp-mirror.cordis.yml',
    })
  }

  const skillsDir = join(codexHome, 'skills')
  const skillEntries = await analyzeSkills(skillsDir)
  const candidates = skillEntries.filter((e) => e.status === 'ok').length
  if (candidates > 0) {
    items.push({
      kind: 'skill', name: 'skills', status: byTool.migrate_codex_skills >= candidates ? 'migrated' : 'skipped',
      note: byTool.migrate_codex_skills >= candidates
        ? `已迁移 ${candidates} 个候选技能`
        : `候选技能 ${candidates} 个，已迁移 ${byTool.migrate_codex_skills} 个（台账）；运行 migrate_codex_skills --apply 补齐`,
    })
  }

  if (scanItems.some((i) => i.kind === 'instruction')) {
    items.push({
      kind: 'instruction', name: 'AGENTS.md / instructions.md',
      status: byTool.migrate_codex_instructions > 0 ? 'migrated' : 'skipped',
      note: byTool.migrate_codex_instructions > 0 ? '已迁移（见台账）' : '未迁移：运行 migrate_codex_instructions',
    })
  }

  if (scanItems.some((i) => i.kind === 'memory')) {
    items.push({
      kind: 'memory', name: 'memories',
      status: byTool.migrate_codex_memory > 0 ? 'migrated' : 'skipped',
      note: byTool.migrate_codex_memory > 0 ? '已迁移（见台账）' : '未迁移：运行 migrate_codex_memory',
    })
  }

  const sessionItem = scanItems.find((i) => i.kind === 'session')
  if (sessionItem) {
    items.push({
      kind: 'session', name: 'sessions', status: 'skipped',
      note: '会话导入由 dsh-chat-import 的 import_chat 承担（M4 委托）；当前未导入',
    })
  }

  // 敏感资产（只报告存在，作为警告）
  const secrets = scanItems.filter((i) => i.kind === 'secret')
  for (const s of secrets) {
    items.push({ kind: 'secret', name: s.name, status: 'skipped', note: s.note })
  }
  if (secrets.length) {
    warnings.push(`发现 ${secrets.length} 个凭据/状态文件（${secrets.map((s) => s.name).join(', ')}）：本工具不读取、不迁移，请知悉`)
  }

  const pending = items.filter((i) => i.status === 'skipped' && i.kind !== 'secret' && i.kind !== 'session')
  if (pending.length) {
    warnings.push(`有 ${pending.length} 类资产尚未迁移（${pending.map((i) => i.name).join('、')}）`)
  }

  return makeReport({ items, warnings, ledgerPath: opts.ledgerDir })
}
