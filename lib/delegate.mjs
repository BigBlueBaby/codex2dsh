// lib/delegate.mjs —— 会话迁移委托（Codex sessions → dsh-chat-import）
//
// 规范见 docs/03-映射规范.md §8：
//   1. 只读统计 sessions/YYYY/MM/DD/rollout-*.jsonl（数量/体积/时间范围）
//   2. 探测 dsh-chat-import 的导入工具（v0.8.0 起 import_codex 收敛为
//      import_chat 分发器，format 枚举含 'codex'；兼容旧版 import_codex）；
//      可用 → 委托执行（preview 透传）；不可用 → 返回安装指引
//      （dsh plugin --profile <p> add dsh-chat-import）
//   3. 台账记录委托结果（委托成功时）
// 委托只传本项目参数（format/path/preview/budget/restamp），不注入额外权限。

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { appendLedger } from './ledger.mjs'
import { makeReport } from './report.mjs'
import { planTitleBackfill } from './title.mjs'

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

/**
 * 探测 dsh-chat-import 的会话导入工具（返回 { tool, kind } 或 null）。
 * v0.8.0 起 import_codex 收敛为 import_chat 分发器（format 枚举含 'codex'）；
 * 兼容旧版（<0.8.0 的 import_codex）。schema 不可读时按可用处理
 * （调用时 format:'codex' 兜底，错误由调用方按失败处理）。
 */
export function findImportCodex(ctx) {
  const tools = ctx?.tools
  if (!tools) return null
  const get = typeof tools.get === 'function'
    ? (n) => tools.get(n) ?? null
    : (n) => (Array.isArray(tools.registered) ? tools.registered.find((t) => t.name === n) ?? null : null)
  // 优先 import_chat（v0.8.0+）：format 枚举必须含 'codex'
  const chat = get('import_chat')
  if (chat && typeof chat.execute === 'function') {
    const formatSchema = chat.parameters && typeof chat.parameters === 'object' ? chat.parameters.format : undefined
    const formats = Array.isArray(formatSchema?.enum) ? formatSchema.enum : null
    if (!formats || formats.includes('codex')) return { tool: chat, kind: 'import_chat' }
    return null
  }
  // 兼容旧版 import_codex
  const legacy = get('import_codex')
  if (legacy && typeof legacy.execute === 'function') return { tool: legacy, kind: 'import_codex' }
  return null
}

/** 委托调用（import_chat 分发器带 format:'codex'；旧版 import_codex 直调；透传 preview/budget/restamp） */
export async function callImportCodex(tool, codexHome, args = {}) {
  // tool 为 findImportCodex 返回的 { tool, kind }；旧调用方可能直接传工具对象（无 kind → 视为旧版直调）
  const impl = tool && typeof tool.tool === 'object' && tool.tool !== null ? tool.tool : tool
  const kind = tool && typeof tool === 'object' ? tool.kind : 'import_codex'
  if (!impl || typeof impl.execute !== 'function') return null
  const base = {
    path: join(codexHome, 'sessions'),
    ...(args.preview ? { preview: true } : {}),
    ...(args.budget ? { budget: args.budget } : {}),
    ...(args.restamp ? { restamp: true } : {}),
  }
  return kind === 'import_chat'
    ? await impl.execute({ format: 'codex', ...base })
    : await impl.execute(base)
}

/**
 * 预览/执行会话迁移。
 * @param {string} codexHome
 * @param {object} ctx host 上下文（用于探测 import_chat / import_codex）
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
      note: '未检测到会话导入工具（import_chat / import_codex，dsh-chat-import 未安装）；请先执行：dsh plugin --profile <profile> add dsh-chat-import',
    })
    return makeReport({
      items, previewed: true,
      warnings: ['会话导入依赖 dsh-chat-import 的 import_chat（format: codex）工具，当前未安装'],
    })
  }

  if (opts.preview) {
    // 委托预览：透传 preview，不落盘
    const result = await callImportCodex(importTool, codexHome, { preview: true })
    if (result) {
      items.push({ kind: 'session', name: 'import_chat', status: 'previewed', note: '委托预览完成（结果见 import_chat 返回）' })
    }
    return makeReport({ items, previewed: true })
  }

  // 正式委托
  const result = await callImportCodex(importTool, codexHome, { budget: opts.budget, restamp: opts.restamp })
  if (!result) {
    return makeReport({ ok: false, items, warnings: ['import_chat 调用失败或未返回结果'] })
  }
  // 新导入会话 id：兼容 import_chat / import_codex 的两种返回形态——
  //   单文件：{ sessionId: string }；目录批量：{ results: [{ path, status, sessionId }] }
  // （顶层 sessionIds 为兼容历史调用方的扩展，同样支持）
  const importedIds = []
  if (Array.isArray(result.sessionIds)) importedIds.push(...result.sessionIds)
  else if (typeof result.sessionId === 'string') importedIds.push(result.sessionId)
  if (Array.isArray(result.results)) {
    for (const item of result.results) {
      if (item && typeof item.sessionId === 'string' && (item.status === 'imported' || item.status === 'appended')) {
        importedIds.push(item.sessionId)
      }
    }
  }
  const imported = typeof result.imported === 'number' ? result.imported : importedIds.length
  items.push({
    kind: 'session', name: 'import_codex', status: 'delegated',
    note: `已委托导入：${imported} 个会话${result.summary && typeof result.summary === 'object' ? `（summary: ${JSON.stringify(result.summary).slice(0, 120)}）` : ''}`,
  })
  // 标题回填（best-effort）：import_codex 不写 session/title 事件，DSH 界面会
  // 回退到首条 user 消息（Codex rollout 首条常是 harness 注入 → 显示成路径/工作区
  // 名）。这里用 session_index.jsonl thread_name / rollout 首条真实提问补钉标题。
  // 只有 host 内（ctx.get 可用）才执行；失败不翻转迁移结果，只附加提示。
  if (importedIds.length > 0 && ctx && typeof ctx.get === 'function') {
    try {
      const fix = await planTitleBackfill(ctx, { codexHome, sessionIds: importedIds })
      if (fix && fix.ok !== false) {
        items.push({
          kind: 'session', name: 'title-backfill', status: fix.summary.migrated > 0 ? 'migrated' : 'skipped',
          note: `已补标题 ${fix.summary.migrated} 个（索引 ${fix.titleSources?.index ?? 0} / 首问 ${fix.titleSources?.rollout ?? 0}${fix.skipped && fix.skipped['has-title'] ? `，已有标题跳过 ${fix.skipped['has-title']}` : ''}）`,
        })
      } else if (fix && fix.warnings.length > 0) {
        items.push({ kind: 'session', name: 'title-backfill', status: 'skipped', note: fix.warnings[0] })
      }
    } catch (err) {
      items.push({ kind: 'session', name: 'title-backfill', status: 'skipped', note: '标题回填失败（不影响导入）：' + String((err && err.message) || err) })
    }
  }
  // 非工作区会话提示（best-effort）：新导入会话若属 Codex 非工作区
  // （projectless-thread-ids），提示运行「整理工作区」归入统一 DSH 工作区。
  // 不自动移动：直改日志会与宿主会话写游标冲突，归组应在 DSH 重启后执行。
  if (importedIds.length > 0) {
    try {
      const { readCodexGlobalState } = await import('./regroup.mjs')
      const state = readCodexGlobalState(codexHome)
      const nonWorkspace = importedIds.filter((id) =>
        typeof id === 'string' && id.startsWith('import-') && state.projectless.has(id.slice('import-'.length))).length
      if (nonWorkspace > 0) {
        items.push({
          kind: 'session', name: 'non-workspace', status: 'skipped',
          note: `${nonWorkspace} 个新导入会话属于 Codex 非工作区：请运行「整理工作区」（codex2dsh regroup --apply）归入统一 DSH 工作区，再重启 DSH 生效`,
        })
      }
    } catch {
      /* 提示失败不影响导入 */
    }
  }
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
