// lib/scan.mjs —— 只读扫描 ~/.codex 各资产类别（纯 Node fs，无 host 依赖）
//
// 供 migrate_codex_preview / codex2dsh_doctor 复用；零副作用。
// 敏感资产只报告存在（skipped(secret)），绝不读取内容。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseCodexConfig } from './config.mjs'
import { buildMcpPlan } from './mcp.mjs'

// 敏感资产清单（只报告存在）
const SECRET_FILES = ['auth.json', '.codex-global-state.json', 'chrome-native-hosts.json', 'chrome-native-hosts-v2.json']

/**
 * 扫描 Codex 配置根。
 * @param {string} codexHome
 * @returns {{ items: Array, warnings: string[], sessionCount: number }}
 */
export function scanCodexHome(codexHome) {
  const items = []
  const warnings = []
  const configPath = join(codexHome, 'config.toml')

  // 主配置
  let parsed = null
  if (existsSync(configPath)) {
    parsed = parseCodexConfig(readFileSync(configPath, 'utf8'))
    items.push({
      kind: 'config', name: 'config.toml', status: 'previewed',
      note: `model=${parsed.config.model ?? '?'} provider=${parsed.config.modelProvider ?? '?'} ` +
            `mcpServers=${Object.keys(parsed.config.mcpServers ?? {}).length} ` +
            `projects=${Object.keys(parsed.config.projects ?? {}).length}`,
    })
    if (parsed.partial.length) {
      warnings.push(`config.toml 有 ${parsed.partial.length} 处仅部分解析：${parsed.partial.slice(0, 5).join(', ')}${parsed.partial.length > 5 ? '...' : ''}`)
    }
  } else {
    warnings.push(`未找到 ${configPath}，请确认 Codex 配置位置（可用 codexHome 参数或 CODEX_HOME 环境变量）`)
  }

  // MCP 计划（脱敏后统计）
  if (parsed) {
    const plan = buildMcpPlan(parsed.config, { excludeRuntime: true })
    items.push({
      kind: 'mcp', name: 'mcp_servers', status: 'previewed',
      note: `可镜像 ${plan.plan.length} 个服务器，排除运行时 ${plan.excluded.length} 个（${plan.excluded.join(', ')}），脱敏 ${plan.maskedCount} 处`,
    })
  }

  // 技能
  const skillsDir = join(codexHome, 'skills')
  if (existsSync(skillsDir)) {
    const names = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
    items.push({ kind: 'skill', name: 'skills', status: 'previewed', note: `${names.length} 个技能目录：${names.slice(0, 8).join(', ')}${names.length > 8 ? '...' : ''}` })
  }

  // 全局指令
  for (const f of ['AGENTS.md', 'instructions.md']) {
    const p = join(codexHome, f)
    if (existsSync(p)) {
      items.push({ kind: 'instruction', name: f, status: 'previewed', note: `${statSync(p).size} bytes` })
    }
  }

  // 记忆
  const memDir = join(codexHome, 'memories')
  const memDb = join(codexHome, 'memories_1.sqlite')
  if (existsSync(memDir) || existsSync(memDb)) {
    items.push({ kind: 'memory', name: 'memories', status: 'previewed', note: `目录=${existsSync(memDir)} sqlite=${existsSync(memDb) ? statSync(memDb).size + ' bytes' : '无'}` })
  }

  // 会话（rollout-*.jsonl 计数）
  let sessionCount = 0
  let sessionBytes = 0
  const sessDir = join(codexHome, 'sessions')
  if (existsSync(sessDir)) {
    for (const y of readdirSync(sessDir)) {
      const yd = join(sessDir, y)
      if (!statSync(yd).isDirectory()) continue
      for (const m of readdirSync(yd)) {
        const md = join(yd, m)
        if (!statSync(md).isDirectory()) continue
        for (const d of readdirSync(md)) {
          const dd = join(md, d)
          if (!statSync(dd).isDirectory()) continue
          for (const f of readdirSync(dd)) {
            if (f.startsWith('rollout-') && f.endsWith('.jsonl')) {
              sessionCount++
              sessionBytes += statSync(join(dd, f)).size
            }
          }
        }
      }
    }
    items.push({ kind: 'session', name: 'sessions', status: 'previewed', note: `${sessionCount} 个 rollout 文件，约 ${(sessionBytes / 1024 / 1024).toFixed(1)} MB` })
  }

  // 敏感资产（只报告存在）
  for (const f of SECRET_FILES) {
    if (existsSync(join(codexHome, f))) {
      items.push({ kind: 'secret', name: f, status: 'skipped', note: '凭据/状态文件：不读取、不迁移' })
    }
  }

  return { items, warnings, sessionCount }
}
