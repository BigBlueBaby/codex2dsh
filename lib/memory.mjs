// lib/memory.mjs —— 记忆迁移（Codex memories → DSH 记忆资产）
//
// 规范见 docs/03-映射规范.md §6：
//   1. memories/ 目录可读资产（*.md/*.txt/*.json）→ 目标目录（带来源注释，json 原样）
//   2. memories_1.sqlite 只读探测（node:sqlite readOnly）：可读 → 提取文本列条目；
//      不可读/结构未知 → 降级报告（绝不猜测解析、绝不写源库）
//   3. [memories] / [features] 开关关闭 → 报告跳过
//   4. 落盘默认 $DSH_HOME/memories/codex/；幂等（内容相同跳过）；台账

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { parseCodexConfig } from './config.mjs'
import { appendLedger } from './ledger.mjs'
import { makeReport } from './report.mjs'
import { resolveCodexHome } from './paths.mjs'

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

// ── dsh-mnemon 记忆导入（全局记忆引擎：storageScope=global → ~/.mnemon）─────────
//
// dsh-mnemon 存储格式（v0.3.x，实测源码）：
//   <root>/runtime/memories.json  { version: 1, entries: [{ content, created_at,
//     updated_at, target: 'user'|'memory', importance: 'critical'|'normal'|'low' }] }
//     —— 权威源；USER.md / MEMORY.md 是插件按 target 用 § 连接生成的投影（重启自动重建）
//   <root>/documents/index.json   { version: 1, documents: [{ id, title, description,
//     status, filename, relativePath, sourcePaths, sessionIds, createdAt, updatedAt,
//     lastAccessedAt, revision, contentHash, sizeBytes, memoryBodyIds }] }
//   <root>/documents/active/<filename>.md  —— frontmatter（renderDocument 格式）+ 正文
//
// 导入策略：
//   Runtime 层（每轮注入，容量有限：user ≤ 4096 B / memory ≤ 10240 B UTF-8）：
//     从 memory_summary.md 提炼——User Profile/User preferences → user；General Tips
//     与 What's in Memory 的 learnings → memory；按优先级裁剪到容量上限；
//   Documents 层（完整叙事、可搜索）：MEMORY.md / memory_summary.md / raw_memories.md
//     三份原文作为活动文档（保留完整 Markdown 结构）。

/** dsh-mnemon Runtime 投影容量（UTF-8 字节，§ 连接后） */
export const MNEMON_RUNTIME_LIMITS = { user: 4096, memory: 10240 }
/** dsh-mnemon 文档导入标题（幂等键） */
export const MNEMON_DOC_TITLES = {
  'MEMORY.md': 'codex2dsh-memory-MEMORY',
  'memory_summary.md': 'codex2dsh-memory-summary',
  'raw_memories.md': 'codex2dsh-memory-raw',
}

/** content 归一：空白折叠为单空格、剔除 § 分隔符（parseEntry 约束） */
export function mnemonEntryContent(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').replace(/§/gu, '').trim()
}

/**
 * 解析 Codex memory_summary.md → dsh-mnemon Runtime 条目候选。
 * 结构：## User Profile（画像）/ ## User preferences（- 条目）/ ## General Tips
 * （- 条目）/ ## What's in Memory（### 项目 → #### 日期 → - 标题 + desc/learnings）。
 * @param {string} text summary 原文
 * @returns {{ user: string[], memory: string[] }} 已归一化的条目（content 单行）
 */
export function parseMemorySummaryForMnemon(text) {
  const user = []
  const memory = []
  const lines = String(text ?? '').split(/\r?\n/)
  let section = null
  let profileBuf = []
  let inWhat = false
  for (const line of lines) {
    const h = /^##\s+(.+)$/.exec(line)
    if (h) {
      const name = h[1].trim().toLowerCase()
      if (name === 'user profile') { section = 'profile'; profileBuf = []; continue }
      if (name === 'user preferences') { section = 'prefs'; continue }
      if (name === 'general tips') { section = 'tips'; continue }
      if (name === "what's in memory") { section = 'what'; inWhat = true; continue }
      section = null
      continue
    }
    if (section === 'profile') {
      profileBuf.push(line)
      continue
    }
    if (section === 'prefs' || section === 'tips') {
      if (/^\s*-\s+/.test(line)) {
        const content = mnemonEntryContent(line.replace(/^\s*-\s+/, ''))
        if (content) (section === 'prefs' ? user : memory).push(content)
      }
      continue
    }
    if (section === 'what') {
      // - desc:/learnings: 追加进上一条（learnings 是核心经验）；- 开头为项目条目
      const inner = /^\s*-\s+(?:desc|learnings):\s*(.+)$/.exec(line)
      if (inner) {
        const content = mnemonEntryContent(inner[1])
        if (content && memory.length > 0) {
          memory[memory.length - 1] = memory[memory.length - 1] + '；' + content
        }
        continue
      }
      if (/^\s*-\s+/.test(line)) {
        const title = mnemonEntryContent(line.replace(/^\s*-\s+/, ''))
        if (title) memory.push(title)
      }
    }
  }
  // User Profile 整段（折叠为一条，放最前）
  const profile = mnemonEntryContent(profileBuf.join('\n'))
  if (profile) user.unshift(profile)
  return { user, memory }
}

/** 按容量裁剪条目列表（投影 § 连接后的 UTF-8 字节数） */
export function trimMnemonEntries(entries, limitBytes) {
  const out = []
  let used = 0
  for (const e of entries) {
    const add = used === 0 ? Buffer.byteLength(e, 'utf8') : Buffer.byteLength('§' + e, 'utf8')
    if (used + add > limitBytes) break
    out.push(e)
    used += add
  }
  return out
}

/** 复刻 dsh-mnemon renderDocument：frontmatter（YAML 单引号）+ 正文 */
export function renderMnemonDocument(record, content) {
  const yaml = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`
  const list = (arr) => (Array.isArray(arr) && arr.length ? arr.map((p) => `  - ${yaml(p)}`).join('\n') : '  []')
  return [
    '---',
    `id: ${yaml(record.id)}`,
    `title: ${yaml(record.title)}`,
    `description: ${yaml(record.description)}`,
    `status: ${yaml(record.status)}`,
    `created_at: ${yaml(record.createdAt)}`,
    `updated_at: ${yaml(record.updatedAt)}`,
    `content_hash: ${yaml(record.contentHash)}`,
    'source_paths:',
    list(record.sourcePaths),
    'session_ids:',
    list(record.sessionIds),
    'memory_body_ids:',
    list(record.memoryBodyIds),
    '---',
    '',
    String(content ?? '').trim(),
    '',
  ].join('\n')
}

/** 读取 dsh-mnemon runtime/memories.json（缺失返回空文件结构） */
export function readMnemonRuntime(mnemonRoot) {
  const p = join(mnemonRoot, 'runtime', 'memories.json')
  if (!existsSync(p)) return { version: 1, entries: [] }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) return parsed
  } catch { /* 损坏按空处理（报告方另行说明） */ }
  return { version: 1, entries: [] }
}

/** 读取 dsh-mnemon documents/index.json（缺失/损坏返回空索引） */
export function readMnemonDocIndex(indexPath) {
  if (!existsSync(indexPath)) return { version: 1, documents: [] }
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8'))
    if (parsed && parsed.version === 1 && Array.isArray(parsed.documents)) return parsed
  } catch { /* 损坏按空索引处理 */ }
  return { version: 1, documents: [] }
}

/**
 * 导入 Codex 记忆到 dsh-mnemon（全局记忆引擎）。
 * Runtime：memory_summary.md 提炼 → memories.json（合并去重、容量裁剪）；
 * Documents：三份原文 → documents/active + index.json（幂等按 title）。
 * @param {object} args { codexHome?, mnemonRoot?, force?, ledgerDir? }
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function importMemoryToMnemon(args = {}) {
  const codexHome = args.codexHome || resolveCodexHome()
  const dshHome = (await import('./paths.mjs')).resolveDshHome()
  // mnemonRoot 缺省：dsh-mnemon storageScope=global 时存储根为 ~/.mnemon
  const root = args.mnemonRoot || (process.env.USERPROFILE || process.env.HOME
    ? join(process.env.USERPROFILE || process.env.HOME, '.mnemon')
    : join(codexHome, '..', '.mnemon'))
  const items = []
  const warnings = []
  const ledgerDir = args.ledgerDir

  // 1) 源资产：优先已迁移副本（$DSH_HOME/memories/codex/），其次 Codex 源目录
  const migratedDir = join(dshHome, 'memories', 'codex')
  const sourceDir = existsSync(migratedDir) ? migratedDir : join(codexHome, 'memories')
  if (!existsSync(sourceDir)) {
    return makeReport({ ok: false, items, warnings: [`未找到记忆资产目录（已迁移: ${migratedDir} / 源: ${join(codexHome, 'memories')}）`] })
  }
  const summaryPath = join(sourceDir, 'memory_summary.md')
  if (!existsSync(summaryPath)) {
    warnings.push('memory_summary.md 缺失：Runtime 提炼跳过，仅导入 Documents')
  }

  // 2) Runtime 层
  const runtimeItems = []
  if (existsSync(summaryPath)) {
    const { user, memory } = parseMemorySummaryForMnemon(readFileSync(summaryPath, 'utf8'))
    const userTrim = trimMnemonEntries(user, MNEMON_RUNTIME_LIMITS.user)
    const memTrim = trimMnemonEntries(memory, MNEMON_RUNTIME_LIMITS.memory)
    const now = new Date().toISOString()
    const existing = readMnemonRuntime(root)
    const seen = new Set(existing.entries.map((e) => e.target + '::' + e.content))
    const added = []
    for (const content of userTrim) {
      if (seen.has('user::' + content)) continue
      added.push({ content, created_at: now, updated_at: now, target: 'user', importance: 'normal' })
    }
    for (const content of memTrim) {
      if (seen.has('memory::' + content)) continue
      added.push({ content, created_at: now, updated_at: now, target: 'memory', importance: 'normal' })
    }
    if (added.length > 0) {
      mkdirSync(join(root, 'runtime'), { recursive: true })
      writeFileSync(join(root, 'runtime', 'memories.json'),
        JSON.stringify({ version: 1, entries: [...existing.entries, ...added] }, null, 2) + '\n', 'utf8')
      if (ledgerDir) appendLedger(ledgerDir, { tool: 'codex2dsh_import_memory', source: summaryPath, target: join(root, 'runtime', 'memories.json'), status: 'migrated' })
    }
    runtimeItems.push({
      kind: 'memory', name: 'runtime/memories.json', status: added.length > 0 ? 'migrated' : 'skipped',
      note: `user 条目 ${added.filter((e) => e.target === 'user').length}（提炼 ${user.length} → 裁剪 ${userTrim.length}）、memory 条目 ${added.filter((e) => e.target === 'memory').length}（提炼 ${memory.length} → 裁剪 ${memTrim.length}）${added.length === 0 ? '；均已存在，幂等跳过' : ''}`,
    })
  } else {
    runtimeItems.push({ kind: 'memory', name: 'runtime/memories.json', status: 'skipped', note: '无 memory_summary.md，跳过 Runtime 导入' })
  }

  // 3) Documents 层（三份完整原文）
  const docItems = []
  const docIndexPath = join(root, 'documents', 'index.json')
  const activeDir = join(root, 'documents', 'active')
  const index = readMnemonDocIndex(docIndexPath)
  for (const [fileName, title] of Object.entries(MNEMON_DOC_TITLES)) {
    const src = join(sourceDir, fileName)
    if (!existsSync(src)) {
      docItems.push({ kind: 'memory', name: fileName, status: 'skipped', note: '源文件不存在' })
      continue
    }
    const existingDoc = index.documents.find((d) => d.title === title)
    const content = readFileSync(src, 'utf8').trim()
    const id = existingDoc ? existingDoc.id : randomUUID()
    const now = new Date().toISOString()
    const record = {
      id,
      title,
      description: `codex2dsh 导入的 Codex 记忆资产（${fileName}，来源 ${src}）`,
      status: 'active',
      filename: existingDoc ? existingDoc.filename : `codex2dsh-${fileName.replace(/\W+/g, '-')}-${id.slice(0, 8)}.md`,
      relativePath: '',
      sourcePaths: [src],
      sessionIds: [],
      createdAt: existingDoc ? existingDoc.createdAt : now,
      updatedAt: now,
      lastAccessedAt: now,
      revision: existingDoc ? existingDoc.revision + 1 : 1,
      contentHash: createHash('sha256').update(content).digest('hex'),
      sizeBytes: 0,
      memoryBodyIds: [],
    }
    record.relativePath = `active/${record.filename}`
    record.sizeBytes = Buffer.byteLength(renderMnemonDocument(record, content), 'utf8')

    if (existingDoc && !args.force) {
      docItems.push({ kind: 'memory', name: fileName, status: 'skipped', note: `文档已存在（${existingDoc.filename}）；如需覆盖请用 force:true` })
      continue
    }
    mkdirSync(activeDir, { recursive: true })
    writeFileSync(join(activeDir, record.filename), renderMnemonDocument(record, content), 'utf8')
    if (existingDoc) {
      index.documents = index.documents.map((d) => (d.id === id ? record : d))
    } else {
      index.documents.push(record)
    }
    if (ledgerDir) appendLedger(ledgerDir, { tool: 'codex2dsh_import_memory', source: src, target: join(activeDir, record.filename), status: 'migrated' })
    docItems.push({ kind: 'memory', name: fileName, status: 'migrated', note: `已导入 documents/active/${record.filename}（${record.sizeBytes} bytes）` })
  }
  if (index.documents.length > 0) {
    mkdirSync(join(root, 'documents'), { recursive: true })
    writeFileSync(docIndexPath, JSON.stringify(index, null, 2) + '\n', 'utf8')
  }

  items.push(...runtimeItems, ...docItems)
  if (!args.mnemonRoot && !existsSync(root)) {
    warnings.push(`dsh-mnemon 存储根 ${root} 尚不存在：请先安装 dsh-mnemon 插件并完成首启，再导入记忆`)
  }
  return makeReport({ items, warnings, ledgerPath: ledgerDir })
}
