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
import { resolveCodexHome, resolveDshHome } from './paths.mjs'
import { readMirrorServerNames } from './mcp.mjs'

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
 * 适配 Codex 专属引用 → DSH（迁移质量核心：规则不能简单复制，必须让每条引用
 * 在 DSH 中仍然成立）。处理三类：
 *   1. 本地工具路径改写：`<codexHome>/tools/<name>/...`（含 `~/.codex/tools/...`
 *      形态）→ `<dshHome>/codex2dsh/tools/<name>/...`——migrateTools 把工具目录
 *      复制到该处，原路径失效；保留原文反斜杠/正斜杠风格。
 *   2. MCP 工具前缀 `mcp__<server>__`：命名规则与 DSH 一致（dsh-mcp-client 同为
 *      `mcp__<serverName>__<rawName>`），**无需改写**；但服务器名必须存在于
 *      DSH 侧配置（mirror/patch），否则引用失效 → 警告。
 *   3. 规则中出现的 `<server> MCP` 字样引用：同样对照 DSH 配置，未配置 → 警告。
 * @param {string} text 规则原文（合并后的全局指令文本）
 * @param {object} [opts] { codexHome?, dshHome?, mcpServers?: string[] }
 * @returns {{ adapted: string, changes: {from:string,to:string,kind:string}[],
 *            warnings: string[] }}
 */
export function adaptCodexReferences(text, opts = {}) {
  const codexHome = (opts.codexHome || resolveCodexHome()).replace(/[\\/]+$/, '')
  const dshHome = opts.dshHome || resolveDshHome()
  const toolsTarget = join(dshHome, 'codex2dsh', 'tools').replace(/\\/g, '/')
  const codexToolsBase = join(codexHome, 'tools').replace(/\\/g, '/')
  const servers = new Set(opts.mcpServers ?? [])
  const changes = []
  const warnings = []

  let adapted = String(text ?? '')

  // 1) 本地工具路径改写（绝对路径形态：C:\...\.codex\tools\<name> 与 C:/... 形态，
  //    分隔符与 base 中的反斜杠/正斜杠均兼容；base 只含 codexHome，tools 由正则匹配）
  // 逐字符构造 codexHome 的正则形态：\ 与 / → [\\/]（匹配任一分隔符），其余特殊字符转义
  let codexHomeFlex = ''
  for (const ch of String(codexHome)) {
    if (ch === '\\' || ch === '/') codexHomeFlex += '[\\\\/]'
    else if ('.*+?^${}()|[]'.includes(ch)) codexHomeFlex += '\\' + ch
    else codexHomeFlex += ch
  }
  const absRe = new RegExp('(' + codexHomeFlex + ')([\\\\/]+)tools([\\\\/]+)([^\\s"\'`<>\\\\/]+)', 'gi')
  adapted = adapted.replace(absRe, (m, _base, _sep1, _sep2, toolName) => {
    const dst = toolsTarget + '/' + toolName
    const backslash = m.includes('\\')
    changes.push({ from: m, to: backslash ? dst.replace(/\//g, '\\') : dst, kind: 'tool-path' })
    return backslash ? dst.replace(/\//g, '\\') : dst
  })
  // ~/.codex/tools/<name> 与 $HOME/.codex/tools/<name> 形态
  const tildeRe = /(?:~|\$HOME|\$\{HOME\})\/\.codex\/tools\/([^\s"'`<>\\/]+)/gi
  adapted = adapted.replace(tildeRe, (m, toolName) => {
    const dst = toolsTarget + '/' + toolName
    changes.push({ from: m, to: dst, kind: 'tool-path' })
    return dst
  })

  // 2) MCP 工具前缀引用：mcp__<server>__。命名规则与 DSH 一致（无需改前缀本身），
  //    但服务器名需对照 DSH 配置；规则文本里常见的下划线形态（如
  //    mcp__google_mcp_toolbox__ 实际服务器名 google-mcp-toolbox）自动改写为正确前缀
  const seen = new Set()
  const mcpPrefixRe = /mcp__([A-Za-z0-9_-]+)__/g
  const prefixFixes = []
  let mm
  while ((mm = mcpPrefixRe.exec(adapted))) {
    const raw = mm[1]
    const name = raw.replace(/_/g, '-')
    if (servers.has(name)) {
      if (raw !== name) prefixFixes.push({ raw, name })
      continue
    }
    if (!seen.has('prefix:' + name)) {
      seen.add('prefix:' + name)
      warnings.push(`MCP 服务器 "${name}" 未在 DSH 配置中（mcp__${raw}__ 工具引用将失效）：请先在 DSH 配置该服务器，或从规则中移除相关引用`)
    }
  }
  for (const f of prefixFixes) {
    const from = 'mcp__' + f.raw + '__'
    const to = 'mcp__' + f.name + '__'
    if (adapted.includes(from)) {
      adapted = adapted.split(from).join(to)
      changes.push({ from, to, kind: 'mcp-prefix' })
    }
  }
  // 3) 「<server> MCP」字样引用检查（允许反引号/引号包裹与大小写，如 `figma_developer` MCP / Figma MCP）
  const mcpWordRe = /([A-Za-z][A-Za-z0-9_-]*)[`"']?\s+MCP/g
  const serverKeys = new Set([...servers].map((s) => s.toLowerCase()))
  while ((mm = mcpWordRe.exec(adapted))) {
    const name = mm[1]
    const key = name.toLowerCase()
    if (name.startsWith('mcp__') || serverKeys.has(key) || seen.has('word:' + key)) continue
    seen.add('word:' + key)
    warnings.push(`规则引用 MCP 服务器 "${name}" 未在 DSH 配置中（将失效）：请先在 DSH 配置该服务器，或从规则中移除相关引用`)
  }

  return { adapted, changes, warnings }
}

/** 读取 DSH 侧 mirror 的服务器名集合（供适配与验证用；缺失返回空数组） */
export function dshMcpServers(dshHome) {
  return readMirrorServerNames(join(dshHome, 'codex2dsh', 'mcp-mirror.cordis.yml'))
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
  const warnings = []
  const present = files.filter((f) => f.exists)
  if (present.length === 0) {
    items.push({ kind: 'instruction', name: 'AGENTS.md', status: 'skipped', note: '源文件不存在（AGENTS.md / instructions.md）' })
  } else {
    // 适配预览：工具路径改写数 + MCP 引用校验（零副作用）
    const dshHome = resolveDshHome()
    const mcpServers = dshMcpServers(dshHome)
    const adapt = adaptCodexReferences(buildGlobalInstructionsContent(codexHome).content, { codexHome, dshHome, mcpServers })
    warnings.push(...adapt.warnings)
    for (const f of present) {
      items.push({
        kind: 'instruction', name: f.name, status: 'previewed',
        target,
        note: `${f.size} bytes → 合并落盘 ${target}；适配预览：${adapt.changes.length} 处 Codex 工具路径将改写为 $DSH_HOME/codex2dsh/tools/，MCP 引用已对照 ${mcpServers.length} 个服务器校验`,
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
  return makeReport({ items, previewed: true, warnings })
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
    // Codex → DSH 适配：工具路径改写 + MCP 引用校验（不能简单复制迁移）
    const mcpServers = opts.mcpServers ?? dshMcpServers(dshHome)
    const adapt = adaptCodexReferences(content, { codexHome, dshHome, mcpServers })
    warnings.push(...adapt.warnings)
    const note = adapt.changes.length > 0
      ? `已针对 DSH 适配改写 ${adapt.changes.length} 处 Codex 引用（工具路径→$DSH_HOME/codex2dsh/tools/；MCP 引用已校验）`
      : `MCP 引用已校验（${mcpServers.length} 个服务器）`
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (existing === adapt.adapted) {
      for (const name of sources) {
        items.push({ kind: 'instruction', name, status: 'skipped', target, note: '目标内容相同，幂等跳过' })
      }
    } else if (existing !== null && opts.force !== true) {
      for (const name of sources) {
        items.push({ kind: 'instruction', name, status: 'skipped', target, note: `目标已存在且内容不同（${target}）；如确认覆盖请用 force:true` })
      }
    } else {
      mkdirSync(dshHome, { recursive: true })
      writeFileSync(target, adapt.adapted, 'utf8')
      for (const name of sources) {
        if (ledgerDir) {
          appendLedger(ledgerDir, { tool: 'migrate_codex_instructions', source: join(codexHome, name), target, status: 'migrated' })
        }
        items.push({ kind: 'instruction', name, status: 'migrated', target, note })
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
