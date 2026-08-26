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

/** 解析 mirror 中每个 stdio 服务器的 command/args（行级扫描，提取命令与 --config 等参数） */
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
  let serversIndent = -1
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const leading = /^(\s*)/.exec(line)[1].length
    const keyMatch = /^(\s*)([A-Za-z0-9_.-]+):\s*$/.exec(line)
    const valMatch = /^(\s*)([A-Za-z0-9_.-]+):\s*(.+)$/.exec(line)
    const key = keyMatch ? keyMatch[2] : (valMatch ? valMatch[2] : null)
    if (key === 'servers' && keyMatch) {
      serversIndent = leading
      current = null
      continue
    }
    if (serversIndent < 0 || leading <= serversIndent) {
      if (leading <= serversIndent) serversIndent = -1
      current = null
      continue
    }
    if (leading === serversIndent + 2 && keyMatch) {
      current = key
      out.push({ name: key, command: null, configPath: null })
      continue
    }
    if (leading === serversIndent + 4 && current && valMatch) {
      const entry = out.find((s) => s.name === current)
      if (!entry) continue
      if (key === 'command') entry.command = strip(valMatch[3])
      if (key === 'type' && strip(valMatch[3]) === 'http') entry.type = 'http'
      continue
    }
    if (leading === serversIndent + 6 && current && !keyMatch && !valMatch) {
      // args 列表项：- 'C:\...' 或 - --config（indent 来自行首空格，不依赖 key 匹配）
      const itemMatch = /^\s*-\s*(.+)$/.exec(line)
      if (itemMatch) {
        const entry = out.find((s) => s.name === current)
        const val = strip(itemMatch[1])
        if (entry && val && !val.startsWith('--') && /[\\/]/.test(val) && /\.(yaml|yml|exe|cmd|bat|json)$/i.test(val)) {
          entry.configPath = entry.configPath ?? val
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
  }
  if (profiles.every((p) => !p.merged)) {
    warnings.push('所有 profile 均未合并 MCP 配置：请把 mcp-mirror.cordis.yml 的 insert 块合并进激活 profile 的 cordis.patch.yml，然后重启 DSH')
  }

  // 3) 工具可执行性：stdio 服务器的 command 与配置路径存在性（http 类型不检查命令）
  const details = readMirrorServersDetail(mirrorPath)
  for (const s of details) {
    if (s.type === 'http') {
      items.push({ kind: 'tool', name: s.name, status: 'migrated', note: 'type=http（远端服务器，无需本地命令检查）' })
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
