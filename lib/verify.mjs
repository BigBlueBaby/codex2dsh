// lib/verify.mjs —— 迁移可调用性验证（MCP 配置是否生效 / 工具是否可执行 / 规则引用是否成立）
//
// 迁移成功的标准不是「文件已生成」，而是「DSH 中真实可用」。本模块逐项验证：
//   1. mirror 片段存在且服务器可解析；
//   2. mirror 是否已合并进 profile 的 cordis.patch.yml（dsh-mcp-client insert）——
//      未合并 = DSH 中 MCP 未加载，迁移未完成；
//   3. mirror 中每个 stdio 服务器的 command/关键参数路径是否存在（工具可执行）；
//   4. AGENTS.md（$DSH_HOME/AGENTS.md）中的 MCP 引用（mcp__server__ / <server> MCP）
//      是否都能在 DSH 侧配置中找到对应服务器；
//   5. AGENTS.md 中的工具路径引用是否指向实际存在的文件。
// 只读：不写任何文件。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { makeReport } from './report.mjs'
import { readMirrorServerNames } from './mcp.mjs'
import { adaptCodexReferences } from './instructions.mjs'
import { resolveCodexHome, resolveDshHome } from './paths.mjs'

/**
 * 判断启动命令可解析：绝对路径（含盘符/分隔符）→ 文件必须存在；
 * 裸命令（如 npx）→ 在 PATH 中查找（Windows 追加 .exe/.cmd/.bat）。
 */
export function commandResolvable(command) {
  if (!command) return false
  if (/[\\/]/.test(command) || /^[A-Za-z]:/.test(command)) return existsSync(command)
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const dir of String(process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try {
        if (existsSync(join(dir, command + ext))) return true
      } catch {
        /* 不可读目录跳过 */
      }
    }
  }
  return false
}

/**
 * 解析 mirror 中每个服务器的连接详情（行级扫描）。
 * 新结构（renderMcpPlan，每台服务器一个 entry）：
 *   - insert:
 *       - id: mcp-google-mcp-toolbox
 *         config:
 *           serverName: google-mcp-toolbox
 *           transport: stdio
 *           command: '...'
 *           args:
 *             - --config
 *             - '...tools.yaml'
 */
export function readMirrorServersDetail(mirrorPath) {
  if (!mirrorPath || !existsSync(mirrorPath)) return []
  let text = ''
  try {
    text = readFileSync(mirrorPath, 'utf8')
  } catch {
    return []
  }
  const strip = (s) => s.replace(/^['"]|['"]$/g, '')
  const out = []
  let current = null
  let inArgs = false
  for (const line of text.split(/\r?\n/)) {
    const idMatch = /^\s*- id:\s*(.+)$/.exec(line)
    if (idMatch) {
      current = { name: strip(idMatch[1]).replace(/^mcp-/, ''), command: null, configPath: null }
      out.push(current)
      inArgs = false
      continue
    }
    if (!current) continue
    const keyOnlyMatch = /^\s*([A-Za-z0-9_.-]+):\s*$/.exec(line)
    if (keyOnlyMatch) {
      inArgs = keyOnlyMatch[1] === 'args'
      continue
    }
    const valMatch = /^\s*([A-Za-z0-9_.-]+):\s*(.+)$/.exec(line)
    if (valMatch) {
      const key = valMatch[1]
      const value = strip(valMatch[2])
      if (key === 'serverName') current.name = value
      else if (key === 'transport') current.transport = value
      else if (key === 'command') current.command = value
      else if (key === 'url') current.url = value
      inArgs = key === 'args'
      continue
    }
    if (inArgs) {
      const itemMatch = /^\s*-\s*(.+)$/.exec(line)
      if (itemMatch) {
        const val = strip(itemMatch[1])
        if (val && !val.startsWith('--') && /[\\/]/.test(val) && /\.(yaml|yml|exe|cmd|bat|json)$/i.test(val)) {
          current.configPath = current.configPath ?? val
        }
      }
    }
  }
  return out
}

/** 扫描 $DSH_HOME/profiles/ 下各 profile 的 cordis.patch.yml，报告哪些已合并 dsh-mcp-client */
export function scanProfileMcpMerge(dshHome) {
  const profilesRoot = join(dshHome, 'profiles')
  const out = []
  if (!existsSync(profilesRoot)) return out
  for (const e of readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const patchPath = join(profilesRoot, e.name, 'cordis.patch.yml')
    if (!existsSync(patchPath)) continue
    let text = ''
    try {
      text = readFileSync(patchPath, 'utf8')
    } catch {
      continue
    }
    const hasInsert = /(?:^|\n)\s*-\s*insert:/.test(text)
    const hasMcpClient = text.includes('dsh-mcp-client')
    out.push({
      profile: e.name,
      patchPath,
      merged: hasInsert && hasMcpClient,
      empty: text.trim() === '[]' || text.trim() === '',
      insertCount: (text.match(/(?:^|\n)\s*-\s*insert:/g) ?? []).length,
    })
  }
  return out
}

/** 提取文本中的 insert entry id（行级扫描 - id: <name>） */
function extractInsertIds(text) {
  const ids = []
  const re = /^\s*-\s*id:\s*([A-Za-z0-9_.-]+)\s*$/gm
  let m
  while ((m = re.exec(text))) ids.push(m[1])
  return ids
}

/**
 * 检测 profile 的插件重复加载：手动 patch 的 insert id 与 dsh.profile.bundles
 * 中声明 dsh.bundle.patch 的包（组合时自动应用其 patch）重复 = duplicate loader
 * entry id。实测教训：dsh-mnemon 手动 insert（id=mnemon）+ bundles 条目（包名
 * dsh-mnemon）导致任何插件更新组合失败。
 * @param {string} dshHome
 * @param {string} profile profile 名
 * @returns {Array<{ id: string, bundle: string, note: string }>}
 */
export function scanProfilePluginDuplicates(dshHome, profile) {
  const profileDir = join(dshHome, 'profiles', profile)
  const pkgPath = join(profileDir, 'package.json')
  if (!existsSync(pkgPath)) return []
  let pkg = null
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return []
  }
  const bundles = Array.isArray(pkg.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
  if (bundles.length === 0) return []
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) return []
  const manualIds = extractInsertIds(readFileSync(patchPath, 'utf8'))
  if (manualIds.length === 0) return []
  const issues = []
  for (const bundle of bundles) {
    // 解析 bundle 包声明的 dsh.bundle.patch → 其 insert ids（与手动 ids 求交集）
    const bundleDir = join(profileDir, 'node_modules', ...bundle.split('/'))
    const bp = join(bundleDir, 'package.json')
    if (!existsSync(bp)) continue
    let bpkg = null
    try {
      bpkg = JSON.parse(readFileSync(bp, 'utf8'))
    } catch {
      continue
    }
    const patchRel = bpkg.dsh?.bundle?.patch
    if (typeof patchRel !== 'string') continue
    const bundlePatchPath = join(bundleDir, patchRel)
    if (!existsSync(bundlePatchPath)) continue
    for (const id of extractInsertIds(readFileSync(bundlePatchPath, 'utf8'))) {
      if (!manualIds.includes(id)) continue
      issues.push({
        id,
        bundle,
        note: `手动 patch 与 bundle「${bundle}」重复加载（该包声明 dsh.bundle.patch，组合时自动应用 insert id=${id}；请从 cordis.patch.yml 移除手动 insert 行，否则插件更新/启动会报 duplicate loader entry id "${id}"）`,
      })
    }
  }
  return issues
}

/**
 * 迁移可调用性验证（只读）。
 * @param {string} [codexHome]
 * @param {string} [dshHome]
 * @param {object} [opts] { ledgerDir? }
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function verifyMigration(codexHome, dshHome, opts = {}) {
  const ch = codexHome || resolveCodexHome()
  const dh = dshHome || resolveDshHome()
  const items = []
  const warnings = []
  const mirrorPath = join(dh, 'codex2dsh', 'mcp-mirror.cordis.yml')

  // 1) mirror 与服务器
  const mirrorExists = existsSync(mirrorPath)
  items.push({
    kind: 'config', name: 'mcp-mirror.cordis.yml', status: mirrorExists ? 'migrated' : 'skipped',
    note: mirrorExists ? `镜像片段已生成（${mirrorPath}）` : '镜像片段缺失：请先运行 migrate_codex_mcp --apply',
  })
  const servers = readMirrorServerNames(mirrorPath)
  if (mirrorExists && servers.length === 0) {
    warnings.push('镜像片段存在但未解析出任何服务器：内容可能为空或被破坏，请重新生成')
  }

  // 2) profile 合并状态（DSH 中 MCP 是否真正加载）
  const profiles = scanProfileMcpMerge(dh)
  if (profiles.length === 0) {
    warnings.push(`未找到任何 profile（${join(dh, 'profiles')} 为空）：无法确认 MCP 是否已合并`)
  }
  for (const p of profiles) {
    items.push({
      kind: 'config', name: `profile ${p.profile}`, status: p.merged ? 'migrated' : 'skipped',
      note: p.merged
        ? `cordis.patch.yml 已合并 dsh-mcp-client（${p.patchPath}）`
        : (p.empty ? 'cordis.patch.yml 为空：MCP 配置未合并，DSH 中 MCP 未加载（迁移未完成）' : 'cordis.patch.yml 未包含 dsh-mcp-client：请合并 mirror 片段后重启 DSH'),
    })
    // 插件重复加载检测（bundles 自动组合 vs 手动 patch 行——duplicate loader entry id）
    const dupes = scanProfilePluginDuplicates(dh, p.profile)
    for (const d of dupes) {
      warnings.push(`profile ${p.profile}：${d.note}`)
    }
  }
  if (profiles.every((p) => !p.merged)) {
    warnings.push('所有 profile 均未合并 MCP 配置：请把 mcp-mirror.cordis.yml 的 insert 块合并进激活 profile 的 cordis.patch.yml，然后重启 DSH')
  }

  // 3) 工具可执行性：stdio 服务器的 command 与配置路径存在性（http 类型不检查命令）
  const details = readMirrorServersDetail(mirrorPath)
  for (const s of details) {
    if (s.transport === 'streamable-http') {
      items.push({ kind: 'tool', name: s.name, status: 'migrated', note: `transport=streamable-http（url=${s.url ?? '?'}，无需本地命令检查）` })
      continue
    }
    const cmdOk = s.command ? commandResolvable(s.command) : false
    const cfgOk = s.configPath ? existsSync(s.configPath) : true
    items.push({
      kind: 'tool', name: s.name, status: cmdOk && cfgOk ? 'migrated' : 'invalid',
      note: `command=${s.command ?? '?'}（${cmdOk ? '存在' : '缺失'}）` + (s.configPath ? `；config=${s.configPath}（${cfgOk ? '存在' : '缺失'}）` : ''),
    })
    if (!cmdOk) warnings.push(`服务器 ${s.name} 的启动命令不存在：${s.command}（工具未随迁或路径错误）`)
    if (s.configPath && !cfgOk) warnings.push(`服务器 ${s.name} 的配置文件不存在：${s.configPath}`)
  }

  // 4) AGENTS.md 引用校验：MCP 服务器名 + 工具路径
  const agentsPath = join(dh, GLOBAL_INSTRUCTIONS_FILE_NAME)
  if (existsSync(agentsPath)) {
    const adapt = adaptCodexReferences(readFileSync(agentsPath, 'utf8'), {
      codexHome: ch, dshHome: dh, mcpServers: servers,
    })
    items.push({
      kind: 'instruction', name: 'AGENTS.md 引用校验', status: adapt.warnings.length === 0 ? 'migrated' : 'invalid',
      note: adapt.warnings.length === 0
        ? '所有 MCP/工具引用在 DSH 配置中均成立'
        : `${adapt.warnings.length} 条失效引用（见警告）`,
    })
    warnings.push(...adapt.warnings.map((w) => `AGENTS.md：${w}`))
    // 路径引用存在性：检测仍指向 ~/.codex/tools 的残留（适配遗漏）
    if (adapt.changes.length > 0) {
      warnings.push(`AGENTS.md 中仍有 ${adapt.changes.length} 处 Codex 工具路径未改写（建议重新运行 migrate_codex_instructions --apply 或手动修正）`)
    }
  } else {
    items.push({ kind: 'instruction', name: 'AGENTS.md', status: 'skipped', note: 'DSH 用户全局指令未迁移（$DSH_HOME/AGENTS.md 缺失）' })
  }

  return makeReport({ items, warnings, ledgerPath: opts.ledgerDir })
}

/** $DSH_HOME 下用户全局指令文件名（与 lib/instructions.mjs 保持一致） */
const GLOBAL_INSTRUCTIONS_FILE_NAME = 'AGENTS.md'
