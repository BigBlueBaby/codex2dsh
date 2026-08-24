// lib/mcp.mjs —— MCP 镜像计划与渲染（Codex config.toml → DSH MCP client 片段）
//
// 规范见 docs/03-映射规范.md §3：
//   运行时服务器排除（名称/路径/env 特征）→ 计划归一化 → 密钥脱敏 → YAML 渲染。
// 纯函数，全部可单测；输出格式由 test/mcp.test.mjs 快照锁定。

import { renderScalar } from './yaml.mjs'
import { maskArgs, maskEnv } from './report.mjs'

// 运行时服务器名称特征（Codex 自带能力，DSH 有等价物，默认排除）
const RUNTIME_NAME_RE = /^(node_repl|computer_use|browser|chrome)([._-]|$)/
// 运行时命令路径特征
const RUNTIME_PATH_RE = /[\\/]Codex[\\/]runtimes[\\/]|[\\/]openai-bundled[\\/]|codex-computer-use|node_repl\.exe/i
// env 特征：CODEX_CLI_PATH / SKY_CUA_* 说明服务器由 Codex 运行时托管
const RUNTIME_ENV_RE = /^(CODEX_CLI_PATH|SKY_CUA_|NODE_REPL_)/

/**
 * 判定服务器是否为 Codex 运行时自带（应默认排除）。
 * @param {{ name: string, command: string, env: Record<string,string> }} server
 */
export function isRuntimeServer(server) {
  if (RUNTIME_NAME_RE.test(server.name ?? '')) return true
  if (RUNTIME_PATH_RE.test(server.command ?? '')) return true
  return Object.keys(server.env ?? {}).some((k) => RUNTIME_ENV_RE.test(k))
}

/**
 * 构建 MCP 迁移计划：源服务器 → 脱敏后的目标条目。
 * @param {object} parsedConfig parseCodexConfig 的 config
 * @param {object} [opts] { excludeRuntime?: boolean }
 * @returns {{ plan: Array, excluded: Array, maskedCount: number }}
 *   plan 条目：{ name, type, command, args, env, startupTimeoutSec, secretsMasked }
 */
export function buildMcpPlan(parsedConfig, opts = {}) {
  const excludeRuntime = opts.excludeRuntime !== false
  const plan = []
  const excluded = []
  let maskedCount = 0

  for (const [name, server] of Object.entries(parsedConfig.mcpServers ?? {})) {
    if (excludeRuntime && isRuntimeServer({ name, command: server.command, env: server.env })) {
      excluded.push(name)
      continue
    }
    const maskedArgs = maskArgs(server.args ?? [])
    const maskedEnv = maskEnv(server.env ?? {})
    maskedCount += maskedArgs.maskedCount + maskedEnv.maskedCount
    const entry = {
      name,
      type: server.type ?? 'stdio',
      command: server.command ?? '',
      args: maskedArgs.args,
      env: maskedEnv.env,
      startupTimeoutSec: server.startupTimeoutSec ?? undefined,
      secretsMasked: maskedArgs.maskedCount + maskedEnv.maskedCount,
      partial: server._partial ? [...server._partial] : [],
    }
    if (Object.keys(entry.env).length === 0) delete entry.env
    if (entry.startupTimeoutSec === undefined) delete entry.startupTimeoutSec
    if (entry.secretsMasked === 0) delete entry.secretsMasked
    if (entry.partial.length === 0) delete entry.partial
    plan.push(entry)
  }

  return { plan, excluded, maskedCount }
}

/**
 * 渲染 mcp-mirror.cordis.yml（可人工审阅合并进 profile 的组合补丁片段）。
 * 内容确定性：不写入生成时间戳，保证幂等比对稳定（时间戳记入台账与报告）。
 * @param {{ plan: Array, excluded: Array, source: string }} input
 */
export function renderMcpPlan(input) {
  const L = []
  L.push('# codex2dsh 生成的 MCP 镜像（人工审阅后合并进 profile 的 cordis.patch.yml / cordis.yml）')
  L.push(`# 来源: ${input.source ?? ''} · 幂等键: sha256(config.toml)`)
  L.push('# ⚠️ 若片段含 **** 掩码，请改为环境变量引用后再启用；本文件请勿提交到公开仓库')
  L.push('- insert:')
  L.push('    - id: dsh-mcp-client')
  L.push('      name: dsh-mcp-client')
  if (input.plan.length === 0) {
    L.push('      config:')
    L.push('        servers: {}')
  } else {
    L.push('      config:')
    L.push('        servers:')
    for (const s of input.plan) {
      L.push(`          ${s.name}:`)
      L.push(`            type: ${renderScalar(s.type)}`)
      L.push(`            command: ${renderScalar(s.command)}`)
      if (s.args && s.args.length) {
        L.push('            args:')
        for (const a of s.args) L.push(`              - ${renderScalar(a)}`)
      }
      if (s.env) {
        L.push('            env:')
        for (const [k, v] of Object.entries(s.env)) L.push(`              ${k}: ${renderScalar(v)}`)
      }
      if (s.startupTimeoutSec !== undefined) L.push(`            startupTimeoutSec: ${s.startupTimeoutSec}`)
      if (s.secretsMasked) {
        L.push(`            # ⚠️ 该服务器 ${s.secretsMasked} 处敏感值已脱敏，请改用环境变量`)
      }
    }
  }
  return L.join('\n') + '\n'
}

/**
 * 幂等判定：目标文件已存在时，内容相同 → 'skip'；不同且未 force → 'conflict'。
 * @param {string} targetContent 待写入内容
 * @param {string|null} existingContent 现有文件内容（null=不存在）
 * @param {boolean} force
 * @returns {'write' | 'skip' | 'conflict'}
 */
export function decideWrite(targetContent, existingContent, force) {
  if (existingContent === null) return 'write'
  if (existingContent === targetContent) return 'skip'
  return force ? 'write' : 'conflict'
}

/**
 * 执行 MCP 镜像迁移（工具层与面板路由共用的编排）。
 * @param {object} args { codexHome?, outPath?, excludeRuntime?, force?, expectedHash?, apply? }
 * @param {object} opts { ledgerDir }
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function runMcpMigration(args = {}, opts = {}) {
  const { existsSync: has, readFileSync: read, writeFileSync: write, mkdirSync: mkdir } = await import('node:fs')
  const { dirname, join: j } = await import('node:path')
  const { parseCodexConfig } = await import('./config.mjs')
  const { sha256, makeReport } = await import('./report.mjs')
  const { appendLedger } = await import('./ledger.mjs')
  const { resolveCodexHome, resolveMcpMirrorPath } = await import('./paths.mjs')

  const codexHome = resolveCodexHome(args.codexHome)
  const configPath = j(codexHome, 'config.toml')
  if (!has(configPath)) {
    return makeReport({ ok: false, warnings: [`未找到 ${configPath}`] })
  }
  const source = read(configPath, 'utf8')
  if (args.expectedHash) {
    if (sha256(source) !== args.expectedHash.toLowerCase()) {
      return makeReport({ ok: false, warnings: ['expectedHash 与源文件 SHA-256 不匹配，拒绝执行'] })
    }
  }
  const { config, partial } = parseCodexConfig(source)
  const { plan, excluded, maskedCount } = buildMcpPlan(config, { excludeRuntime: args.excludeRuntime !== false })
  const target = resolveMcpMirrorPath(args.outPath)
  const content = renderMcpPlan({ plan, source: configPath })

  const items = plan.map((s) => ({
    kind: 'mcp', name: s.name, status: 'generated', target,
    secretsMasked: s.secretsMasked ?? 0,
    note: `${s.type} ${s.command}${s.secretsMasked ? '（含脱敏值，请改环境变量）' : ''}`,
  }))
  for (const name of excluded) {
    items.push({ kind: 'mcp', name, status: 'skipped', note: '运行时服务器，默认排除' })
  }
  for (const p of partial) {
    items.push({ kind: 'mcp', name: p, status: 'invalid', note: '仅部分解析，请人工确认' })
  }
  if (!args.apply) {
    return makeReport({ items, previewed: true, warnings: maskedCount ? [`共脱敏 ${maskedCount} 处敏感值`] : [], ledgerPath: opts.ledgerDir })
  }

  // 幂等：内容相同跳过；不同且未 force 拒绝覆盖
  const existing = has(target) ? read(target, 'utf8') : null
  const decision = decideWrite(content, existing, args.force === true)
  if (decision === 'skip') {
    return makeReport({ items, warnings: ['目标文件内容未变化，已跳过'], ledgerPath: opts.ledgerDir })
  }
  if (decision === 'conflict') {
    return makeReport({ ok: false, items, warnings: [`目标文件已存在且内容不同（${target}）；如确认覆盖请用 force:true`], ledgerPath: opts.ledgerDir })
  }
  mkdir(dirname(target), { recursive: true })
  write(target, content, 'utf8')
  if (opts.ledgerDir) {
    appendLedger(opts.ledgerDir, {
      tool: 'migrate_codex_mcp', source: configPath, target,
      status: 'generated', maskedCount,
    })
  }
  return makeReport({ items, warnings: maskedCount ? [`共脱敏 ${maskedCount} 处敏感值；请人工审阅 ${target} 后合并进 profile`] : [], ledgerPath: opts.ledgerDir })
}
