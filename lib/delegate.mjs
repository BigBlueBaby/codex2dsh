// lib/delegate.mjs —— 会话迁移委托（Codex sessions → import_codex）
//
// 规范见 docs/03-映射规范.md §8：
//   1. 只读统计 sessions/YYYY/MM/DD/rollout-*.jsonl（数量/体积/时间范围）
//   2. 检测 import_codex 工具可用性（ctx.tools.get）：可用 → 委托执行（preview 透传）；
//      不可用 → 返回安装指引（dsh plugin --profile <p> add dsh-chat-import）
//   3. 台账记录委托结果（委托成功时）
// 委托只传本项目参数（path/preview/budget/restamp），不注入额外权限。

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { appendLedger } from './ledger.mjs'
import { makeReport } from './report.mjs'

/** 只读统计会话规模：{ count, bytes, firstTs, lastTs }（时间范围取文件名时间戳，不读内容） */
export function scanSessions(codexHome) {
  const root = join(codexHome, 'sessions')
  if (!existsSync(root)) return { count: 0, bytes: 0, firstTs: null, lastTs: null }
  let count = 0
  let bytes = 0
  const ts = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
      } else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        count++
        bytes += statSync(p).size
        // 兼容两种命名：rollout-2026-03-25T11-33-37-<uuid>.jsonl / rollout-20260813-000001-<id>.jsonl
        const m = /rollout-(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})/.exec(e.name) || /rollout-(\d{8})-(\d{6})/.exec(e.name)
        if (m) {
          ts.push(m[1].includes('-') ? `${m[1]} ${m[2].replace(/-/g, ':')}` : `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)} ${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}`)
        }
      }
    }
  }
  walk(root)
  ts.sort()
  return { count, bytes, firstTs: ts[0] ?? null, lastTs: ts[ts.length - 1] ?? null }
}

/** 探测 import_codex 工具是否可用 */
export function findImportCodex(ctx) {
  const tools = ctx?.tools
  if (!tools) return null
  if (typeof tools.get === 'function') return tools.get('import_codex') ?? null
  // 兼容最小 ctx（测试桩）：检查已注册工具列表
  if (Array.isArray(tools.registered)) {
    return tools.registered.find((t) => t.name === 'import_codex') ?? null
  }
  return null
}

/** 委托调用 import_codex（透传 preview/budget/restamp） */
export async function callImportCodex(tool, codexHome, args = {}) {
  if (!tool || typeof tool.execute !== 'function') return null
  const result = await tool.execute({
    path: join(codexHome, 'sessions'),
    ...(args.preview ? { preview: true } : {}),
    ...(args.budget ? { budget: args.budget } : {}),
    ...(args.restamp ? { restamp: true } : {}),
  })
  return result
}

/**
 * 预览/执行会话迁移。
 * @param {string} codexHome
 * @param {object} ctx host 上下文（用于探测 import_codex）
 * @param {object} [opts] { preview?, budget?, restamp?, ledgerDir? }
 * @returns {Promise<import('../index.d.ts').Report>}
 */
export async function planSessionsMigration(codexHome, ctx, opts = {}) {
  const stats = scanSessions(codexHome)
  const items = []
  if (stats.count === 0) {
    items.push({ kind: 'session', name: 'sessions', status: 'skipped', note: '未发现 rollout-*.jsonl 会话文件' })
    return makeReport({ items, previewed: true })
  }
  const importTool = findImportCodex(ctx)
  const range = stats.firstTs && stats.lastTs ? `${stats.firstTs.slice(0, 10)} ~ ${stats.lastTs.slice(0, 10)}` : '未知'
  items.push({
    kind: 'session', name: 'sessions', status: opts.preview ? 'previewed' : 'previewed',
    note: `${stats.count} 个 rollout 文件，约 ${(stats.bytes / 1024 / 1024).toFixed(1)} MB（${range}）`,
  })

  if (!importTool) {
    items.push({
      kind: 'session', name: 'delegation', status: 'skipped',
      note: '未检测到 import_codex（dsh-chat-import 未安装）；请先执行：dsh plugin --profile <profile> add dsh-chat-import',
    })
    return makeReport({
      items, previewed: true,
      warnings: ['会话导入依赖 dsh-chat-import 插件的 import_codex 工具，当前未安装'],
    })
  }

  if (opts.preview) {
    // 委托预览：透传 preview，不落盘
    const result = await callImportCodex(importTool, codexHome, { preview: true })
    if (result) {
      items.push({ kind: 'session', name: 'import_codex', status: 'previewed', note: '委托预览完成（结果见 import_codex 返回）' })
    }
    return makeReport({ items, previewed: true })
  }

  // 正式委托
  const result = await callImportCodex(importTool, codexHome, { budget: opts.budget, restamp: opts.restamp })
  if (!result) {
    return makeReport({ ok: false, items, warnings: ['import_codex 调用失败或未返回结果'] })
  }
  const imported = Array.isArray(result.sessionIds) ? result.sessionIds.length
    : (result.sessionId ? 1 : 0)
  items.push({
    kind: 'session', name: 'import_codex', status: 'delegated',
    note: `已委托导入：${imported} 个会话${result.summary && typeof result.summary === 'object' ? `（summary: ${JSON.stringify(result.summary).slice(0, 120)}）` : ''}`,
  })
  if (opts.ledgerDir) {
    appendLedger(opts.ledgerDir, {
      tool: 'migrate_codex_sessions', source: join(codexHome, 'sessions'),
      target: 'DSH 会话（import_codex）', status: 'delegated', note: `imported=${imported}`,
    })
  }
  return makeReport({ items, ledgerPath: opts.ledgerDir })
}

/** 兼容旧导出名（tools.mjs 引用） */
export const delegateSessions = planSessionsMigration
