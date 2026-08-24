// lib/memory.mjs —— 记忆迁移（Codex memories → DSH 记忆资产）
//
// 规范见 docs/03-映射规范.md §6：
//   1. memories/ 目录可读资产（*.md/*.txt/*.json）→ 目标目录（带来源注释，json 原样）
//   2. memories_1.sqlite 只读探测（node:sqlite readOnly）：可读 → 提取文本列条目；
//      不可读/结构未知 → 降级报告（绝不猜测解析、绝不写源库）
//   3. [memories] / [features] 开关关闭 → 报告跳过
//   4. 落盘默认 $DSH_HOME/memories/codex/；幂等（内容相同跳过）；台账

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCodexConfig } from './config.mjs'
import { appendLedger } from './ledger.mjs'
import { makeReport } from './report.mjs'

const TEXT_EXT = ['.md', '.txt', '.markdown']
const JSON_EXT = ['.json']
const CONTENT_COL_RE = /^(content|text|body|message|memory|summary|note|value|prompt|input)$/i

/** 只读探测 sqlite：返回 { ok, tables, entries } 或 { ok:false, reason } */
export function probeMemorySqlite(dbPath) {
  // process.getBuiltinModule 同步取内置模块；Node < 22.3 或无 node:sqlite 时优雅降级
  let DatabaseSync
  try {
    DatabaseSync = process.getBuiltinModule('node:sqlite')?.DatabaseSync
  } catch {
    DatabaseSync = undefined
  }
  if (!DatabaseSync) {
    return { ok: false, reason: 'node:sqlite 不可用（需要 Node ≥ 22.3 且支持内置 sqlite）' }
  }
  let db
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
      .map((r) => r.name)
    const entries = []
    const maxRows = 200
    for (const table of tables) {
      let cols
      try {
        cols = db.prepare(`SELECT * FROM "${table}" LIMIT 1`).columns()
      } catch {
        continue // 视图/损坏表跳过
      }
      const contentCol = cols.map((c) => c.name).find((n) => CONTENT_COL_RE.test(n))
      if (!contentCol) continue
      const rows = db.prepare(`SELECT "${contentCol}" AS c FROM "${table}" WHERE "${contentCol}" IS NOT NULL AND "${contentCol}" != '' LIMIT ?`)
        .all(maxRows)
      for (const row of rows) {
        const text = String(row.c ?? '').trim()
        if (text) entries.push({ table, text })
      }
    }
    return { ok: true, tables, entries }
  } catch (err) {
    return { ok: false, reason: err.message }
  } finally {
    try { db?.close() } catch { /* 忽略关闭错误 */ }
  }
}

/** 分析记忆资产：返回 { enabled, files: [{name, path, size}], sqlite: {path, size} | null } */
export function analyzeMemory(codexHome) {
  const configPath = join(codexHome, 'config.toml')
  let enabled = true
  if (existsSync(configPath)) {
    const { config } = parseCodexConfig(readFileSync(configPath, 'utf8'))
    const features = config.features ?? {}
    const memories = config.memories ?? {}
    enabled = !(features.memories === 'false' || memories.use_memories === 'false')
  }
  const dir = join(codexHome, 'memories')
  const files = []
  if (existsSync(dir)) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue
      const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase()
      if (TEXT_EXT.includes(ext) || JSON_EXT.includes(ext)) {
        const p = join(dir, e.name)
        files.push({ name: e.name, path: p, size: statSync(p).size, kind: TEXT_EXT.includes(ext) ? 'text' : 'json' })
      }
    }
  }
  const sqlitePath = join(codexHome, 'memories_1.sqlite')
  const sqlite = existsSync(sqlitePath) ? { path: sqlitePath, size: statSync(sqlitePath).size } : null
  return { enabled, files, sqlite }
}

/** 单文件目标内容（text 类带来源注释；json 原样保留） */
function entryContent(file, codexHome) {
  const raw = readFileSync(file.path, 'utf8')
  if (file.kind === 'text') {
    return `<!-- codex2dsh: 来源 ${file.path}（迁移自 Codex 记忆，正文未改动） -->\n\n${raw}`
  }
  return raw // json 保持结构完整
}

/**
 * 预览记忆迁移（dry-run，零副作用；sqlite 探测只读）。
 * @param {string} codexHome
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function planMemoryMigration(codexHome, opts = {}) {
  void opts
  const { enabled, files, sqlite } = analyzeMemory(codexHome)
  const items = []
  if (!enabled) {
    items.push({ kind: 'memory', name: 'memories', status: 'skipped', note: 'Codex 记忆开关未开启（[features]/[memories]），跳过' })
  }
  for (const f of files) {
    items.push({ kind: 'memory', name: f.name, status: 'previewed', note: `${f.size} bytes（${f.kind}）→ 记忆资产` })
  }
  if (sqlite) {
    const probe = probeMemorySqlite(sqlite.path)
    items.push({
      kind: 'memory', name: 'memories_1.sqlite', status: probe.ok ? 'previewed' : 'skipped',
      note: probe.ok
        ? `${sqlite.size} bytes，探测到表 ${probe.tables.length} 个、可提取文本条目 ${probe.entries.length} 条`
        : `${sqlite.size} bytes，只读探测失败（${probe.reason}），降级为引导自查`,
    })
  }
  if (!enabled && files.length === 0 && !sqlite) {
    items.push({ kind: 'memory', name: 'memories', status: 'skipped', note: '未发现记忆资产' })
  }
  return makeReport({ items, previewed: true })
}

/**
 * 执行记忆迁移（apply 语义）。
 * @param {string} codexHome
 * @param {string} outDir 记忆资产输出目录（调用方负责解析默认值）
 * @param {object} [opts] { force?, ledgerDir? }
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function migrateMemory(codexHome, outDir, opts = {}) {
  const ledgerDir = opts.ledgerDir
  const { enabled, files, sqlite } = analyzeMemory(codexHome)
  const items = []
  const warnings = []
  const written = []

  if (!enabled) {
    items.push({ kind: 'memory', name: 'memories', status: 'skipped', note: 'Codex 记忆开关未开启，跳过全部记忆迁移' })
    return makeReport({ items, warnings, ledgerPath: ledgerDir })
  }

  // 目录资产
  for (const f of files) {
    const target = join(outDir, f.name)
    const content = entryContent(f, codexHome)
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (existing === content) {
      items.push({ kind: 'memory', name: f.name, status: 'skipped', target, note: '目标内容相同，幂等跳过' })
      continue
    }
    if (existing !== null && opts.force !== true) {
      items.push({ kind: 'memory', name: f.name, status: 'skipped', target, note: `目标已存在且内容不同（${target}）；如确认覆盖请用 force:true` })
      continue
    }
    mkdirSync(outDir, { recursive: true })
    writeFileSync(target, content, 'utf8')
    written.push({ name: f.name, source: f.path, target })
    items.push({ kind: 'memory', name: f.name, status: 'migrated', target, note: f.kind === 'text' ? '已带来源注释' : 'json 原样保留' })
  }

  // sqlite 资产（只读提取）
  if (sqlite) {
    const probe = probeMemorySqlite(sqlite.path)
    if (probe.ok && probe.entries.length) {
      const target = join(outDir, 'memory-sqlite.md')
      const md = [
        '<!-- codex2dsh: 来源 memories_1.sqlite（只读提取；条目为逐行文本，未改写源库） -->',
        '',
        `共提取 ${probe.entries.length} 条记忆（来源表：${[...new Set(probe.entries.map((e) => e.table))].join(', ') || '未知'}）：`,
        '',
        ...probe.entries.map((e) => `- ${e.text.replace(/\r?\n/g, ' ').slice(0, 500)}`),
        '',
      ].join('\n')
      const existing = existsSync(target) ? readFileSync(target, 'utf8') : null
      if (existing === md) {
        items.push({ kind: 'memory', name: 'memory-sqlite.md', status: 'skipped', target, note: '目标内容相同，幂等跳过' })
      } else if (existing !== null && opts.force !== true) {
        items.push({ kind: 'memory', name: 'memory-sqlite.md', status: 'skipped', target, note: `目标已存在且内容不同（${target}）；如确认覆盖请用 force:true` })
      } else {
        mkdirSync(outDir, { recursive: true })
        writeFileSync(target, md, 'utf8')
        written.push({ name: 'memory-sqlite.md', source: sqlite.path, target })
        items.push({ kind: 'memory', name: 'memory-sqlite.md', status: 'migrated', target, note: `从 sqlite 只读提取 ${probe.entries.length} 条` })
      }
    } else {
      items.push({
        kind: 'memory', name: 'memories_1.sqlite', status: 'skipped',
        note: probe.ok ? '无可提取的文本条目' : `只读探测失败（${probe.reason}），请自查记忆内容`,
      })
    }
  }

  for (const w of written) {
    if (ledgerDir) appendLedger(ledgerDir, { tool: 'migrate_codex_memory', source: w.source, target: w.target, status: 'migrated' })
  }

  return makeReport({ items, warnings, ledgerPath: ledgerDir })
}
