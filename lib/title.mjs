// lib/title.mjs —— Codex 导入会话的标题回填（修复 DSH 会话列表标题丢失）
//
// 背景：dsh-chat-import 的 codex 转换器只回填 out.title，从不写 session/title
// 事件；DSH 界面取「最后一条 session/title 事件」或回退到首条 user/message。
// Codex rollout 的首条 user 消息通常是 harness 注入（<environment_context> /
// AGENTS.md 指令文件），导致导入会话全部显示成工作区/路径类标题。
//
// 本模块：
//   1. 标题源（按优先级）：
//      a. ~/.codex/session_index.jsonl 的 thread_name（Codex 官方线程标题，
//         通常是模型生成的简明中文标题）；
//      b. rollout 文件的「首条真实提问」（跳过 < 开头块与 AGENTS.md 注入）。
//   2. 写回：向导入会话追加 session/title 事件（seq = 日志事件数，data 形状
//      对齐 DSH session-title 服务的 rename()）。只补不覆盖：已有 session/title
//      事件（含用户手动改名）一律跳过；幂等可重复执行。
//   3. **绝不能给 session/title 加 surfaceOp**：DSH 宿主只允许
//      user/message / assistant/message / tool/result 三个类型携带 surfaceOp
//      （@deepseek-ai/dsh-session surface.js isSurfaceEligibleType），非 surface
//      事件携带 surfaceOp 会让整份日志在打开时校验失败
//      （SessionPersistenceCorruptionError: ... is not surface-eligible and
//      cannot carry surfaceOp）。0.1.1 早期版本踩过此坑：误加 surfaceOp 导致
//      已回填会话无法打开；repairBadTitleFrames() 用于清除这类坏事件。
//   4. 落盘路径：host 内（工具/面板）走 ctx.sessionPersistence.append（协调器
//      校验 seq 连续 + 类型白名单）；写后刷新 sessionProjectionCache.coldSnapshot
//      让界面立即显示新标题。CLI 只做只读预览（不直写日志文件，避免与宿主
//      并发写冲突）。
//
// session/title 事件规范（DSH dsh-session-title lib）：事件 data 为
//   { title, messageSeqs: [], source: { kind: 'user' } }；findLast 取最后一条。
// DSH 自己的 rename()（dsh-session-title lib/index.js）调用
//   session.append('session/title', data) —— 不带任何 surface 元数据。

import { existsSync, readFileSync, truncateSync } from 'node:fs'
import { join } from 'node:path'
import { readSessionLog, scanZstdFrames } from './sessionlog.mjs'
import { makeReport } from './report.mjs'
import { resolveCodexHome } from './paths.mjs'

// 与 dsh-chat-import 相同的标题归一规则：去首尾/折叠空白，>80 字符截断加省略号
const TITLE_MAX_LEN = 80
const TITLE_ELLIPSIS = '…'

/** 发现坏标题事件时的修复引导（工具/面板报告用） */
export const REPAIR_HINT =
  '检测到损坏的 session/title 事件（误带 surfaceOp，导致会话无法打开）：请先执行 codex2dsh repair-titles --apply（CLI，需在 DSH 外运行），再重新回填标题'

/** 归一化标题文本（空/纯空白返回 ''） */
export function normalizeTitle(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return t.length <= TITLE_MAX_LEN ? t : t.slice(0, TITLE_MAX_LEN - TITLE_ELLIPSIS.length) + TITLE_ELLIPSIS
}

/**
 * 读取 ~/.codex/session_index.jsonl → Map<id, thread_name>。
 * 同一 id 多条记录时取 updated_at 最新（无 updated_at 时后写覆盖）。
 * @param {string} codexHome
 * @returns {Map<string, string>}
 */
export function readCodexTitleIndex(codexHome) {
  const map = new Map()
  const path = join(codexHome, 'session_index.jsonl')
  if (!existsSync(path)) return map
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return map
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (!rec || typeof rec.id !== 'string' || !rec.id) continue
    const name = typeof rec.thread_name === 'string' ? rec.thread_name.trim() : ''
    if (!name) continue
    const cur = typeof rec.updated_at === 'string' ? rec.updated_at : ''
    const prev = map.get(rec.id)
    // 同 id 多条：updated_at 更大者胜；缺失/相等时后写覆盖
    if (prev === undefined || (cur && (!prev.at || cur >= prev.at))) {
      map.set(rec.id, { name, at: cur })
    }
  }
  const clean = new Map()
  for (const [k, v] of map) clean.set(k, v.name)
  return clean
}

/** harness 注入的指令文件（AGENTS.md / CLAUDE.md）判定 */
export function looksLikeInstructionsInjection(text) {
  const t = String(text ?? '')
  if (/^#\s+(?:AGENTS|CLAUDE)\.md\s+instructions\b/i.test(t)) return true
  if (t.includes('<INSTRUCTIONS>')) return true
  return false
}

/**
 * 从 rollout 文本提取「首条真实提问」：
 *   只认 response_item/message role=user；跳过以 < 开头的块（harness 注入）；
 *   整条消息是 AGENTS.md/CLAUDE.md 指令注入时跳过；其余取首个非空提问。
 * @param {string} text rollout JSONL 全文
 * @returns {string|null} 归一化后的标题（无可用提问返回 null）
 */
export function firstUserQuestionFromRolloutText(text) {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (!rec || rec.type !== 'response_item' || !rec.payload) continue
    const p = rec.payload
    if (p.type !== 'message' || p.role !== 'user' || !Array.isArray(p.content)) continue
    const parts = []
    for (const block of p.content) {
      if (block && block.type === 'input_text' && typeof block.text === 'string') {
        if (!block.text.startsWith('<')) parts.push(block.text)
      }
    }
    const joined = parts.join('\n').trim()
    if (!joined) continue
    if (looksLikeInstructionsInjection(joined)) continue
    const title = normalizeTitle(joined)
    if (title) return title
  }
  return null
}

/**
 * 从 rollout 文件提取首条真实提问（文件不存在/不可读返回 null）。
 * @param {string} rolloutPath
 * @returns {string|null}
 */
export function firstUserQuestionFromRollout(rolloutPath) {
  if (!rolloutPath || !existsSync(rolloutPath)) return null
  try {
    return firstUserQuestionFromRolloutText(readFileSync(rolloutPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 从会话事件里定位 codex 导入标记并解析标题。
 * @param {object[]} events 会话事件（readFrom 或 readSessionLog 产物）
 * @param {{ index?: Map<string,string> }} [opts]
 * @returns {{ title: string|null, source: 'index'|'rollout'|null, sourceId: string|null, sourcePath: string|null }|null}
 *          events 里无 codex 导入标记时返回 null（非本插件导入的会话）
 */
export function resolveImportedTitle(events, opts = {}) {
  if (!Array.isArray(events) || events.length === 0) return null
  const imp = events.find((e) => e && e.type === 'session/imported' && e.data && e.data.tool === 'codex')
  if (!imp) return null
  const sourceId = typeof imp.data.sourceId === 'string' ? imp.data.sourceId : null
  const sourcePath = typeof imp.data.sourcePath === 'string' ? imp.data.sourcePath : null
  if (sourceId && opts.index && opts.index.get(sourceId)) {
    return { title: opts.index.get(sourceId), source: 'index', sourceId, sourcePath }
  }
  const question = firstUserQuestionFromRollout(sourcePath)
  if (question) return { title: question, source: 'rollout', sourceId, sourcePath }
  return { title: null, source: null, sourceId, sourcePath }
}

/**
 * 构造 session/title 追加事件（对齐 DSH dsh-session-title 的 rename() 形状）。
 * seq = 事件数（协调器要求从当前游标连续编号；导入会话事件自 0 连续）。
 * **不带 surfaceOp**：session/title 不是 surface 事件（DSH 宿主只认
 * user/message / assistant/message / tool/result），携带 surfaceOp 会导致
 * 会话打开时校验失败（SessionPersistenceCorruptionError）。
 * @param {object[]} events 当前会话全部事件（readFrom(0) 结果）
 * @param {string} title
 * @param {number} [time]
 */
export function buildTitleEvent(events, title, time = Date.now()) {
  return {
    type: 'session/title',
    seq: Array.isArray(events) ? events.length : 0,
    time,
    data: { title, messageSeqs: [], source: { kind: 'user' } },
  }
}

/** 是否「坏标题事件」：session/title 非法携带 surfaceOp（0.1.1 早期回填的缺陷形态） */
export function isBadTitleEvent(event) {
  return !!(event && event.type === 'session/title' && event.surfaceOp !== undefined)
}

/** 会话是否已带 session/title 事件（含用户手动改名；坏标题也算，需先修复） */
export function hasTitleEvent(events) {
  return Array.isArray(events) && events.some((e) => e && e.type === 'session/title')
}

/** 写后刷新投影缓存（界面立即显示新标题）；失败不阻塞 */
async function warmProjection(ctx, sessionId) {
  try {
    const pc = ctx && typeof ctx.get === 'function' ? ctx.get('sessionProjectionCache') : null
    if (pc && typeof pc.coldSnapshot === 'function') await pc.coldSnapshot(sessionId)
  } catch {
    /* 投影刷新失败：下次冷读/重启后自然生效 */
  }
}

/**
 * 标题回填主流程（host 内：工具 / 面板 / 导入后自动补）。
 * @param {object} ctx host 上下文（需 get('sessionPersistence')：list + readFrom + append）
 * @param {object} [opts]
 * @param {string} opts.codexHome Codex 配置根（默认 resolveCodexHome）
 * @param {string[]|null} [opts.sessionIds] 只处理这些会话 id（缺省 = 全部）
 * @param {boolean} [opts.dryRun] true = 只预览不写盘
 * @param {string} [opts.ledgerDir]
 * @returns {Promise<object>} Report（含 titleSources 统计）
 */
export async function planTitleBackfill(ctx, opts = {}) {
  const { dryRun = false, sessionIds = null, ledgerDir } = opts
  const codexHome = opts.codexHome || resolveCodexHome()
  const sp = ctx && typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : null
  if (!sp || typeof sp.list !== 'function' || typeof sp.readFrom !== 'function' || typeof sp.append !== 'function') {
    return makeReport({
      ok: false,
      warnings: ['sessionPersistence 不可用（需要 list + readFrom + append）：标题回填只能在 DSH 宿主内执行（面板「修复标题」或 codex2dsh_fix_titles 工具）'],
    })
  }
  const index = readCodexTitleIndex(opts.codexHome)
  let headers = []
  try {
    headers = await sp.list()
  } catch (err) {
    return makeReport({ ok: false, warnings: ['sessionPersistence.list 失败: ' + String((err && err.message) || err)] })
  }
  const targets = Array.isArray(sessionIds) && sessionIds.length > 0
    ? headers.filter((h) => h && sessionIds.includes(h.id))
    : headers

  const items = []
  const warnings = []
  const skipped = {}
  const titleSources = { index: 0, rollout: 0 }
  let migrated = 0

  const addSkip = (id, reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
    items.push({ kind: 'session', name: id, status: 'skipped', note: reason })
  }

  for (const h of targets) {
    const id = h && h.id
    if (!id) continue
    try {
      // 跳过正在被宿主使用的会话（避免与 live 会话写入游标冲突）
      const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
      if (sessions && typeof sessions.get === 'function' && sessions.get(id)) {
        addSkip(id, 'live')
        continue
      }
      const { events } = await sp.readFrom(id, 0)
      if (!Array.isArray(events) || events.length === 0) {
        addSkip(id, 'empty-log')
        continue
      }
      const resolved = resolveImportedTitle(events, { index })
      if (!resolved) {
        addSkip(id, 'not-codex-import')
        continue
      }
      // 坏标题（0.1.1 早期缺陷：session/title 误带 surfaceOp）→ 跳过并引导修复。
      // 这类事件会让会话打开失败（宿主 surface 校验），必须先用 CLI 修复再回填。
      const bad = events.find(isBadTitleEvent)
      if (bad) {
        addSkip(id, 'bad-title-event')
        if (!warnings.includes(REPAIR_HINT)) warnings.push(REPAIR_HINT)
        continue
      }
      if (hasTitleEvent(events)) {
        addSkip(id, 'has-title')
        continue
      }
      if (!resolved.title) {
        addSkip(id, 'no-title-source')
        continue
      }
      if (dryRun) {
        items.push({ kind: 'session', name: id, status: 'previewed', note: `将补标题（${resolved.source}）：${resolved.title}` })
        continue
      }
      await sp.append(id, [buildTitleEvent(events, resolved.title)])
      await warmProjection(ctx, id)
      migrated++
      titleSources[resolved.source] = (titleSources[resolved.source] ?? 0) + 1
      items.push({ kind: 'session', name: id, status: 'migrated', note: `标题（${resolved.source}）：${resolved.title}` })
    } catch (err) {
      addSkip(id, 'error:' + String((err && err.message) || err))
    }
  }

  if (dryRun) warnings.push('dry-run：仅预览，未写盘')
  const report = makeReport({ items, warnings, previewed: dryRun, ledgerPath: ledgerDir })
  report.titleSources = titleSources
  report.skipped = skipped
  report.dryRun = dryRun
  return report
}

/**
 * 只读扫描版标题回填计划（CLI 用，无 host ctx）：直接读 DSH 会话日志工件，
 * 报告「哪些 codex 导入会话缺标题、将补什么标题、来自哪个源」。零副作用。
 * @param {string} codexHome Codex 配置根
 * @param {string} sessionsRoot DSH 会话根（缺省 $DSH_HOME/sessions）
 * @returns {Promise<object>} { total, planned: [{sessionId, title, source}], already: number, unavailable: number }
 */
export async function scanTitleBackfillStandalone(codexHome, sessionsRoot) {
  const { readdirSync, statSync } = await import('node:fs')
  const index = readCodexTitleIndex(codexHome)
  const logs = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
      } else if (e.name === 'session.jsonl.zstd' || e.name === 'session.jsonl') {
        try {
          if (statSync(p).isFile()) logs.push(p)
        } catch {
          /* 跳过不可读 */
        }
      }
    }
  }
  walk(sessionsRoot)
  const planned = []
  let already = 0
  let unavailable = 0
  for (const logPath of logs) {
    try {
      const { events } = readSessionLog(logPath)
      const resolved = resolveImportedTitle(events, { index })
      if (!resolved) continue
      if (hasTitleEvent(events)) {
        already++
        continue
      }
      if (!resolved.title) {
        unavailable++
        continue
      }
      planned.push({
        sessionId: logPath.split(/[\\/]/).slice(-2)[0],
        title: resolved.title,
        source: resolved.source,
        logPath,
      })
    } catch {
      unavailable++
    }
  }
  planned.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
  return { total: logs.length, planned, already, unavailable }
}

/**
 * 修复坏标题事件（0.1.1 早期缺陷：session/title 误带 surfaceOp，会话无法打开）。
 *
 * 修复方式：坏标题总是由「单事件 append」写入 → 位于日志**末帧**（zstd 一帧
 * 一批）或明文日志**末行**。校验末帧/末行恰好是「一个 session/title 且带
 * surfaceOp」后，把文件截断到该帧/该行起始处——日志恢复为回填前的原状
 * （seq 连续、无坏事件），零数据丢失。末帧不是坏标题的日志一律跳过。
 *
 * ⚠ 必须在 DSH 宿主**外**（CLI）执行：直改日志文件会使宿主进程内已 adopt 的
 * 会话写游标过期，因此修复后需**重启 DSH** 再回填标题（重启后宿主重新 adopt，
 * 游标与文件一致）。
 *
 * @param {string} sessionsRoot DSH 会话根（缺省 $DSH_HOME/sessions）
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] true = 只预览不截断（默认）
 * @returns {{ scanned: number, repaired: {sessionId:string,path:string}[],
 *            skipped: {path:string,reason:string}[], dryRun: boolean }}
 */
export async function repairBadTitleFrames(sessionsRoot, opts = {}) {
  const { dryRun = true } = opts
  const { readdirSync, statSync } = await import('node:fs')
  const logs = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
      } else if (e.name === 'session.jsonl.zstd' || e.name === 'session.jsonl') {
        try {
          if (statSync(p).isFile()) logs.push(p)
        } catch {
          /* 跳过不可读 */
        }
      }
    }
  }
  walk(sessionsRoot)
  const repaired = []
  const skipped = []

  for (const path of logs) {
    const sessionId = path.split(/[\\/]/).slice(-2)[0]
    try {
      const buf = readFileSync(path)
      let truncateTo = null
      let reason = null
      if (buf.length > 0 && buf[0] === 0x28) {
        // zstd：末帧必须恰好是一个坏标题事件
        const { frames } = scanZstdFrames(buf)
        if (frames.length === 0) {
          reason = 'no-frames'
        } else {
          const last = frames[frames.length - 1]
          const { zstdDecompressSync } = await import('node:zlib')
          const text = zstdDecompressSync(buf.subarray(last.start, last.end)).toString('utf8')
          const lines = text.split('\n').filter(Boolean)
          let ev = null
          try {
            ev = lines.length === 1 ? JSON.parse(lines[0]) : null
          } catch {
            ev = null
          }
          if (lines.length === 1 && ev && isBadTitleEvent(ev)) truncateTo = last.start
          else reason = lines.length === 1 ? 'last-frame-not-bad-title' : 'last-frame-multi-line'
        }
      } else {
        // 明文：末行必须是坏标题事件（文件每行以 \n 结尾）
        const text = buf.toString('utf8')
        const lines = text.split('\n').filter(Boolean)
        if (lines.length < 2) {
          reason = 'single-line'
        } else {
          let ev = null
          try {
            ev = JSON.parse(lines[lines.length - 1])
          } catch {
            ev = null
          }
          if (ev && isBadTitleEvent(ev)) {
            // 截断到末行起始字节（最后一条 \n 之后）
            const nl = buf.lastIndexOf(0x0a, buf.length - 2)
            truncateTo = nl === -1 ? 0 : nl + 1
          } else {
            reason = 'last-line-not-bad-title'
          }
        }
      }
      if (truncateTo === null) {
        skipped.push({ path, reason: reason || 'unknown' })
        continue
      }
      if (dryRun) {
        repaired.push({ sessionId, path, truncateTo })
        continue
      }
      truncateSync(path, truncateTo)
      repaired.push({ sessionId, path, truncateTo })
    } catch (err) {
      skipped.push({ path, reason: 'error:' + String((err && err.message) || err) })
    }
  }
  return { scanned: logs.length, repaired, skipped, dryRun }
}
