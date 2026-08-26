// lib/config.mjs —— Codex config.toml 轻量解析
//
// 只解析本项目关心的节与字段（docs/03-映射规范.md §3）：
//   顶层：model / model_provider / model_reasoning_effort / disable_response_storage
//   节：  [mcp_servers.<name>]（type/command/args/env/startup_timeout_sec）
//         [mcp_servers.<name>.env]（子节：后续键值并入 env 表）
//         [model_providers.<name>]（name/base_url/wire_api/...）
//         [projects.<path>]（trust_level）
//         [features] / [memories] / [windows]（sandbox）
// 支持：注释（#）、键值、单双引号字符串、["a",'b'] 数组、{K="v"} 内联表。
// 不支持的语法（多行数组等）→ 该键标记 parse-partial，不静默丢弃。

/** 去除引号 */
export function unquote(s) {
  const t = String(s ?? '').trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

/** 解析 TOML 数组字符串：["a", 'b', "c d"]；非数组形态返回 null */
export function parseTomlArray(text) {
  const t = String(text ?? '').trim()
  if (!t.startsWith('[') || !t.endsWith(']')) return null
  const inner = t.slice(1, -1)
  const parts = []
  let cur = ''
  let quote = null
  for (const ch of inner) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
    } else if (ch === ',') {
      parts.push(unquote(cur))
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) parts.push(unquote(cur))
  return parts
}

/** 解析内联表字符串：{ KEY = "value", PATH = '...' }；非表形态返回 null */
export function parseInlineTable(text) {
  const t = String(text ?? '').trim()
  const m = /^\{(.*)\}$/s.exec(t)
  if (!m) return null
  const out = {}
  for (const pair of m[1].split(',')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const k = pair.slice(0, eq).trim()
    const v = pair.slice(eq + 1).trim()
    if (k) out[k] = unquote(v)
  }
  return out
}

/** 剥离行内注释（引号外）并拆键值；无等号返回 null */
function parseKeyValue(line) {
  let cleaned = ''
  let quote = null
  for (const ch of line) {
    if (quote) {
      cleaned += ch
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
      cleaned += ch
    } else if (ch === '#') {
      break
    } else {
      cleaned += ch
    }
  }
  const eq = cleaned.indexOf('=')
  if (eq <= 0) return null
  return { key: cleaned.slice(0, eq).trim(), raw: cleaned.slice(eq + 1).trim() }
}

/** 解析结构化值（数组 / 内联表），都不是返回 null */
function parseStructured(raw) {
  if (raw.startsWith('[') && raw.endsWith(']')) return parseTomlArray(raw)
  if (raw.startsWith('{') && raw.endsWith('}')) return parseInlineTable(raw)
  return null
}

/** 引号感知的节路径分割：['a', "b.c", 'd'] → ['a', 'b.c', 'd']（点号在引号内不分割） */
function splitSectionPath(sec) {
  const parts = []
  let cur = ''
  let quote = null
  for (const ch of sec) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
    } else if (ch === '.') {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur) parts.push(cur)
  return parts.map((p) => unquote(p))
}

/**
 * 解析 config.toml 文本为结构化对象。
 * @param {string} tomlText
 * @returns {{ config: object, partial: string[], errors: string[] }}
 *   config 形如：
 *   { model, modelProvider, modelReasoningEffort, disableResponseStorage,
 *     mcpServers: { name: {type, command, args, env, startupTimeoutSec, _partial?} },
 *     modelProviders: { name: {...} }, projects: { path: {trustLevel} },
 *     features: {...}, memories: {...}, windows: {sandbox}, _otherSections: [...] }
 */
export function parseCodexConfig(tomlText) {
  const config = {
    mcpServers: {}, modelProviders: {}, projects: {},
    features: {}, memories: {}, windows: {},
  }
  const partial = []
  const errors = []
  let topLevel = true
  let section = null // 当前节路径数组，如 ['mcp_servers','google-mcp-toolbox']（已去引号）
  let envSub = null // true = 处于 [mcp_servers.x.env] 子节

  const ensureSection = () => {
    if (!section) return null
    if (section[0] === 'mcp_servers') {
      const name = section[1]
      if (!name) return null // 空节 [mcp_servers]：不是服务器，忽略
      if (!config.mcpServers[name]) {
        config.mcpServers[name] = { type: 'stdio', command: '', args: [], env: {}, startupTimeoutSec: null }
      }
      return { type: 'server', server: config.mcpServers[name] }
    }
    if (section[0] === 'model_providers') {
      const name = section[1]
      if (!name) return null
      if (!config.modelProviders[name]) config.modelProviders[name] = {}
      return { type: 'provider', table: config.modelProviders[name] }
    }
    if (section[0] === 'projects') {
      const path = section[1]
      if (!path) return null
      if (!config.projects[path]) config.projects[path] = {}
      return { type: 'project', table: config.projects[path] }
    }
    if (section[0] === 'features') return { type: 'plain', table: config.features }
    if (section[0] === 'memories') return { type: 'plain', table: config.memories }
    if (section[0] === 'windows') return { type: 'plain', table: config.windows }
    return null // 其他节：只记录
  }

  for (const rawLine of String(tomlText ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const sec = /^\[([^\]]+)\]$/.exec(line)
    if (sec) {
      const path = splitSectionPath(sec[1].trim())
      section = path
      envSub = path.length === 3 && path[0] === 'mcp_servers' && path[2] === 'env'
      topLevel = false
      const target = ensureSection()
      if (!target && !envSub) {
        if (!config._otherSections) config._otherSections = []
        if (!config._otherSections.includes(path.join('.'))) config._otherSections.push(path.join('.'))
      }
      continue
    }

    const kv = parseKeyValue(line)
    if (!kv || !kv.key) continue

    if (topLevel) {
      if (kv.key === 'model') config.model = unquote(kv.raw)
      else if (kv.key === 'model_provider') config.modelProvider = unquote(kv.raw)
      else if (kv.key === 'model_reasoning_effort') config.modelReasoningEffort = unquote(kv.raw)
      else if (kv.key === 'disable_response_storage') config.disableResponseStorage = kv.raw === 'true'
      continue
    }

    // env 子节：键值全部并入服务器 env 表
    if (envSub && section && section[0] === 'mcp_servers') {
      const server = config.mcpServers[section[1]]
      if (server) server.env[kv.key] = unquote(kv.raw)
      continue
    }

    const target = ensureSection()
    if (!target) continue

    if (target.type === 'server') {
      const server = target.server
      if (kv.key === 'type') server.type = unquote(kv.raw)
      else if (kv.key === 'command') server.command = unquote(kv.raw)
      else if (kv.key === 'args') {
        const arr = parseStructured(kv.raw)
        if (Array.isArray(arr)) server.args = arr.map((v) => String(v)) // TOML 数值/布尔 → 字符串（命令行参数语义；DSH args schema 要求 string[]）
        else {
          server._partial = [...(server._partial ?? []), 'args']
          partial.push(`mcp_servers.${section[1]}.args`)
        }
      } else if (kv.key === 'env') {
        const table = parseStructured(kv.raw)
        if (table && !Array.isArray(table)) {
          server.env = {}
          for (const [k, v] of Object.entries(table)) server.env[k] = String(v) // env 值同样字符串化（DSH env schema 要求 string）
        } else {
          server._partial = [...(server._partial ?? []), 'env']
          partial.push(`mcp_servers.${section[1]}.env`)
        }
      } else if (kv.key === 'startup_timeout_sec') {
        const n = Number(kv.raw)
        server.startupTimeoutSec = Number.isFinite(n) ? n : null
      } else {
        server._partial = [...(server._partial ?? []), kv.key]
        partial.push(`mcp_servers.${section[1]}.${kv.key}`)
      }
      continue
    }

    if (target.type === 'provider') {
      target.table[kv.key] = unquote(kv.raw)
      continue
    }
    if (target.type === 'project') {
      target.table[kv.key === 'trust_level' ? 'trustLevel' : kv.key] = unquote(kv.raw)
      continue
    }
    if (target.type === 'plain') {
      target.table[kv.key] = unquote(kv.raw)
      continue
    }
  }

  return { config, partial, errors }
}
