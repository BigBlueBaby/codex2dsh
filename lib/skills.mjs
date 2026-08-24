// lib/skills.mjs —— 技能转换（Codex skills → $DSH_AGENTS_HOME/skills）
//
// 规范见 docs/03-映射规范.md §4：
//   1. 判定：. 开头 / codex-primary-runtime / openai-bundled → skipped(runtime|marketplace)
//   2. SKILL.md frontmatter 追加 kind: dsh / source: codex（已有 kind: dsh → skipped）
//   3. scripts/ 整体复制；目标同名且内容不同 → 默认消歧为 <name>-codex（-2/-3...），force 覆盖
//   4. 内容相同 → skipped（幂等）；缺 frontmatter → invalid（fixFrontmatter 可补全）
//   5. 台账记录（lib/ledger.mjs）
// 纯函数 + 少量 fs 写盘；源侧（skillsDir）只读。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendLedger } from './ledger.mjs'
import { makeReport } from './report.mjs'

// 运行时/市场分发技能判定（目录名特征）
const RUNTIME_DIR_RE = /^(\.|codex-primary-runtime)/i
const MARKETPLACE_DIR_RE = /openai-bundled|openai-primary-runtime/i

/** 判定技能目录是否可迁移 */
export function classifySkillDir(name) {
  if (RUNTIME_DIR_RE.test(name)) return 'runtime'
  if (MARKETPLACE_DIR_RE.test(name)) return 'marketplace'
  return 'candidate'
}

/** 解析 frontmatter：{ fm: 键值对 | null, body, raw, exists } */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!m) return { fm: null, body: text, raw: null, exists: false }
  const kv = {}
  for (const line of m[1].split(/\r?\n/)) {
    const eq = line.indexOf(':')
    if (eq <= 0) continue
    kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return { fm: kv, body: text.slice(m[0].length), raw: m[1], exists: true }
}

/** 生成补全的 frontmatter（无 frontmatter 时用目录名 + 首段） */
export function buildAutoFrontmatter(name, body) {
  const firstPara = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#')) ?? ''
  const description = (firstPara.slice(0, 80) || '（由 codex2dsh 自动补全）').replace(/['"]/g, '')
  return `name: ${name}\ndescription: ${description}\n`
}

/** 在 frontmatter 尾部追加 DSH 标记 */
export function addDshMarkers(rawFm, source) {
  return rawFm.trimEnd() + `\nkind: dsh\nsource: ${source}\n`
}

/** 组装转换后的 SKILL.md 文本；返回 null 表示不可转换（缺 frontmatter 且不补全） */
export function convertSkillText(skillName, text, { fixFrontmatter = false } = {}) {
  const { fm, body, raw, exists } = parseFrontmatter(text)
  if (!exists) {
    if (!fixFrontmatter) return null
    return `---\n${buildAutoFrontmatter(skillName, body)}kind: dsh\nsource: codex\n---\n${body}`
  }
  if (fm.kind === 'dsh') return null // 已适配，跳过
  return `---\n${addDshMarkers(raw, 'codex')}---\n${body}`
}

/** 递归复制目录（源缺失时静默跳过） */
function copyTree(srcDir, dstDir, collisions) {
  if (!existsSync(srcDir)) return
  mkdirSync(dstDir, { recursive: true })
  for (const e of readdirSync(srcDir, { withFileTypes: true })) {
    const s = join(srcDir, e.name)
    const d = join(dstDir, e.name)
    if (e.isDirectory()) {
      copyTree(s, d, collisions)
    } else {
      if (existsSync(d) && readFileSync(s, 'utf8') !== readFileSync(d, 'utf8')) {
        collisions.push(e.name)
      }
      writeFileSync(d, readFileSync(s))
    }
  }
}

/** 计算消歧目标目录（<name>-codex、-2、-3...） */
function altTargetDir(agentsHome, name) {
  const base = join(agentsHome, 'skills')
  for (let i = 1; ; i++) {
    const alt = join(base, `${name}-codex${i === 1 ? '' : `-${i}`}`)
    if (!existsSync(alt)) return alt
  }
}

/** 读取目标 SKILL.md 内容（不存在返回 null） */
function readTargetContent(agentsHome, name) {
  const p = join(agentsHome, 'skills', name, 'SKILL.md')
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

/**
 * 分析技能目录（只读）：返回逐技能条目与转换内容。
 * @param {string} skillsDir Codex skills 根
 * @param {object} [opts] {
 *   agentsHome?, fixFrontmatter?,
 *   include?: string[]  只迁移这些技能（精确名；缺省 = 全部候选）
 *   exclude?: string[]  排除这些技能（精确名；支持 '*' 前缀通配，如 'ccpanes-*'）
 * }
 * @returns {Promise<Array>} entries: { name, status, kind, target, note, content?, skillPath, targetPath?, collisions? }
 */
export async function analyzeSkills(skillsDir, opts = {}) {
  const agentsHome = opts.agentsHome
  const fixFrontmatter = opts.fixFrontmatter === true
  const include = Array.isArray(opts.include) && opts.include.length ? new Set(opts.include) : null
  const exclude = Array.isArray(opts.exclude) && opts.exclude.length ? opts.exclude : null
  const isExcluded = (name) => {
    if (include && !include.has(name)) return true
    if (exclude && exclude.some((e) => e === name || (e.endsWith('*') && name.startsWith(e.slice(0, -1))))) return true
    return false
  }
  if (!existsSync(skillsDir)) return []
  const entries = []
  for (const dirent of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const name = dirent.name
    const cls = classifySkillDir(name)
    if (cls !== 'candidate') {
      entries.push({ name, status: 'skipped', kind: cls, note: cls === 'runtime' ? '运行时/系统技能' : 'Codex 市场分发技能' })
      continue
    }
    if (isExcluded(name)) {
      entries.push({ name, status: 'skipped', kind: 'skill', note: '未选中（include/exclude），跳过' })
      continue
    }
    const skillPath = join(skillsDir, name)
    const mdPath = join(skillPath, 'SKILL.md')
    if (!existsSync(mdPath)) {
      entries.push({ name, status: 'invalid', kind: 'skill', note: '缺少 SKILL.md' })
      continue
    }
    const original = readFileSync(mdPath, 'utf8')
    const content = convertSkillText(name, original, { fixFrontmatter })
    if (content === null) {
      entries.push({
        name, status: 'skipped', kind: 'skill', skillPath,
        note: parseFrontmatter(original).exists
          ? '源已带 kind: dsh，跳过（避免重复迁移）'
          : '缺少 frontmatter（可用 fixFrontmatter 自动补全）',
      })
      continue
    }
    // 目标状态判定（内容比对优先，保证幂等）
    let status = 'ok'
    let targetDir = null
    let conflicted = false
    let note
    if (agentsHome) {
      const direct = join(agentsHome, 'skills', name)
      const existing = readTargetContent(agentsHome, name)
      if (existing !== null) {
        if (existing === content) {
          status = 'skipped'
          note = '目标内容相同，幂等跳过'
        } else {
          conflicted = true
          targetDir = altTargetDir(agentsHome, name)
          note = `目标同名且内容不同，将消歧为 ${targetDir.split(/[\\/]/).pop()}`
        }
      } else {
        targetDir = direct
      }
    }
    entries.push({ name, status, kind: 'skill', skillPath, content, targetDir, conflicted, note })
  }
  return entries
}

/**
 * 预览技能迁移（dry-run，零副作用）。
 * @param {string} skillsDir
 * @param {object} [opts] { agentsHome?, fixFrontmatter? }
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function planSkillsMigration(skillsDir, opts = {}) {
  const entries = await analyzeSkills(skillsDir, opts)
  const items = entries.map((e) => ({
    kind: 'skill', name: e.name, status: e.status === 'ok' ? 'previewed' : e.status,
    target: e.targetDir ? join(e.targetDir, 'SKILL.md') : undefined,
    note: e.note,
  }))
  return makeReport({ items, previewed: true })
}

/**
 * 执行技能迁移（apply 语义）。
 * @param {string} skillsDir
 * @param {string} agentsHome 技能落盘根（默认 $DSH_AGENTS_HOME，调用方负责解析）
 * @param {object} [opts] { fixFrontmatter?, force?, ledgerDir? }
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function migrateSkills(skillsDir, agentsHome, opts = {}) {
  const ledgerDir = opts.ledgerDir
  const entries = await analyzeSkills(skillsDir, {
    agentsHome,
    fixFrontmatter: opts.fixFrontmatter,
    include: opts.include,
    exclude: opts.exclude,
  })
  const items = []
  const warnings = []

  for (const e of entries) {
    if (e.status !== 'ok') {
      items.push({
        kind: 'skill', name: e.name, status: e.status,
        target: e.targetDir ? join(e.targetDir, 'SKILL.md') : undefined,
        note: e.note,
      })
      continue
    }
    // force 语义：目标同名且内容不同时，覆盖原名目录而非消歧
    let targetDir = e.targetDir
    let overwrite = false
    if (e.conflicted && opts.force === true) {
      targetDir = join(agentsHome, 'skills', e.name)
      overwrite = true
    }
    if (!targetDir) continue // 防御：缺 agentsHome 时不落盘
    mkdirSync(targetDir, { recursive: true })
    const targetMd = join(targetDir, 'SKILL.md')

    // 幂等防御：内容相同 → 跳过
    const existing = existsSync(targetMd) ? readFileSync(targetMd, 'utf8') : null
    if (existing === e.content) {
      items.push({ kind: 'skill', name: e.name, status: 'skipped', target: targetMd, note: '目标内容相同，幂等跳过' })
      continue
    }
    if (existing !== null && !overwrite) {
      items.push({ kind: 'skill', name: e.name, status: 'skipped', target: targetMd, note: '目标存在且未请求 force，跳过' })
      continue
    }

    writeFileSync(targetMd, e.content, 'utf8')
    // scripts/ 复制
    const collisions = []
    copyTree(join(e.skillPath, 'scripts'), join(targetDir, 'scripts'), collisions)
    if (collisions.length) {
      warnings.push(`技能 ${e.name} 的 scripts 有 ${collisions.length} 个同名冲突已覆盖：${collisions.join(', ')}`)
    }
    if (ledgerDir) {
      appendLedger(ledgerDir, {
        tool: 'migrate_codex_skills', source: join(e.skillPath, 'SKILL.md'),
        target: targetMd, status: 'migrated',
      })
    }
    items.push({
      kind: 'skill', name: e.name, status: 'migrated', target: targetMd,
      note: overwrite
        ? 'force 覆盖既有目标'
        : (e.conflicted
            ? `目标同名且内容不同，已消歧为 ${targetDir.split(/[\\/]/).pop()}`
            : 'frontmatter 已追加 kind: dsh / source: codex，scripts 已随迁'),
    })
  }

  return makeReport({ items, warnings, ledgerPath: ledgerDir })
}