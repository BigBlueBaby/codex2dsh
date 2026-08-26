// lib/instructions.mjs —— 全局指令迁移（AGENTS.md / instructions.md → DSH 用户全局指令）
//
// 规范见 docs/03-映射规范.md §5：
//   1. 读取 ~/.codex/AGENTS.md 与 instructions.md（原文完整保留，不做摘要）
//   2. 头部追加来源注释块（<!-- codex2dsh: ... -->），不改变正文
//   3. 落盘 $DSH_HOME/AGENTS.md —— 这是 DSH 的「用户全局指令」唯一位置
//      （@deepseek-ai/dsh-agent-instructions 的 USER_GLOBAL_FILE='AGENTS.md'，
//      discoverInstructionFiles 只探测 $DSH_HOME/AGENTS.md + 项目目录链上的
//      AGENTS.md/CLAUDE.md/AGENTS.local.md/CLAUDE.local.md；$DSH_AGENTS_HOME
//      下的目录不参与发现）。instructions.md 与 AGENTS.md 合并进同一文件
//      （分节保留），保证 DSH 一次加载全部全局规则。
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

/** 目标文件名（DSH 用户全局指令，USER_GLOBAL_FILE 固定为 AGENTS.md） */
export const GLOBAL_INSTRUCTIONS_FILE = 'AGENTS.md'

/** 分析指令资产：返回 { files: [{name, sourcePath, exists, size}], projects: [...] } */
export function analyzeInstructions(codexHome) {
  const files = []
  for (const name of ['AGENTS.md', 'instructions.md']) {
    const p = join(codexHome, name)
    files.push({
      name,
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
 * 组装全局指令目标内容：AGENTS.md + instructions.md（若存在）合并，
 * 每节带来源注释；分节分隔线保留可读性。
 * @param {string} codexHome
 * @returns {{ content: string, sources: string[] }} sources = 实际存在的源文件名
 */
export function buildGlobalInstructionsContent(codexHome) {
  const sections = []
  const sources = []
  for (const name of ['AGENTS.md', 'instructions.md']) {
    const p = join(codexHome, name)
    if (!existsSync(p)) continue
    sections.push(sourceBlock(p) + readFileSync(p, 'utf8'))
    sources.push(name)
  }
  return { content: sections.join('\n\n---\n\n'), sources }
}

/**
 * 预览指令迁移（dry-run，零副作用）。
 * @param {string} codexHome
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function planInstructionsMigration(codexHome, opts = {}) {
  void opts
  const { files, projects } = analyzeInstructions(codexHome)
  const target = join('$DSH_HOME', GLOBAL_INSTRUCTIONS_FILE)
  const items = []
  const present = files.filter((f) => f.exists)
  if (present.length === 0) {
    items.push({ kind: 'instruction', name: 'AGENTS.md', status: 'skipped', note: '源文件不存在（AGENTS.md / instructions.md）' })
  } else {
    for (const f of present) {
      items.push({
        kind: 'instruction', name: f.name, status: 'previewed',
        target,
        note: `${f.size} bytes → 原文保留 + 来源注释，合并落盘 ${target}`,
      })
    }
  }
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
 * @param {string} dshHome 落盘根（DSH 家目录，默认 ~/.dsh；调用方负责解析默认值）
 * @param {object} [opts] { force?, ledgerDir? }
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function migrateInstructions(codexHome, dshHome, opts = {}) {
  const ledgerDir = opts.ledgerDir
  const { files, projects } = analyzeInstructions(codexHome)
  const items = []
  const warnings = []
  const target = join(dshHome, GLOBAL_INSTRUCTIONS_FILE)

  const { content, sources } = buildGlobalInstructionsContent(codexHome)
  const presentFiles = files.filter((f) => f.exists)
  if (sources.length === 0) {
    for (const f of presentFiles.length ? presentFiles : [{ name: 'AGENTS.md' }]) {
      items.push({ kind: 'instruction', name: f.name, status: 'skipped', note: '源文件不存在' })
    }
  } else {
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (existing === content) {
      for (const name of sources) {
        items.push({ kind: 'instruction', name, status: 'skipped', target, note: '目标内容相同，幂等跳过' })
      }
    } else if (existing !== null && opts.force !== true) {
      for (const name of sources) {
        items.push({ kind: 'instruction', name, status: 'skipped', target, note: `目标已存在且内容不同（${target}）；如确认覆盖请用 force:true` })
      }
    } else {
      mkdirSync(dshHome, { recursive: true })
      writeFileSync(target, content, 'utf8')
      for (const name of sources) {
        if (ledgerDir) {
          appendLedger(ledgerDir, { tool: 'migrate_codex_instructions', source: join(codexHome, name), target, status: 'migrated' })
        }
        items.push({ kind: 'instruction', name, status: 'migrated', target, note: `原文完整保留，头部追加来源注释；合并落盘 ${target}` })
      }
    }
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
