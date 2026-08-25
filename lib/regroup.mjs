// lib/regroup.mjs —— 已导入 Codex 会话的工作区归组修复
//
// 背景：DSH 的 workspace 语义 = 会话 header.cwd 的 realpath（dsh-workspace 按
// cwd 分组、reconcile 时按 cwd 建组）。Codex 中「非工作区会话」（projectless）
// 的 cwd 是 Documents\Codex\<日期>\<主题> 这类一次性目录，迁移后每个会话一个
// 独立 workspace；又因 C: 前缀字母序排前，导致侧边栏「非工作区会话反而在最
// 上面、工作区会话在最下面」。
//
// 本模块（修复规则）：
//   1. 非工作区判定（权威优先）：
//      a. ~/.codex/.codex-global-state.json 的 projectless-thread-ids
//         （Codex 官方标记的 projectless 线程 id，与 rollout sourceId 对齐）；
//      b. 兜底：cwd 位于 thread-workspace-root-hints 众数根（如
//         C:\Users\ichin\Documents\Codex）之下（旧线程未进列表的情况）。
//      其余会话一律不动（cwd 在任一项目 rootPaths 下 = 工作区会话；未登记
//      目录保守跳过，避免误伤真实工作目录）。
//   2. 归组：把非工作区会话的 header.cwd 统一改写为目标目录（默认 =
//      hints 众数根；可参数覆盖），并把会话日志目录物理移动到新 projectKey
//      目录（DSH 按 projectKey 组织物理目录；header 是第一帧，重写后其余
//      帧原样保留）。
//   3. 排序：不动——DSH 启动 reconcile（bootstrap）按组内会话时间排序，
//      归组正确后非工作区会话集中在尾部，与 Codex 列表顺序一致。
//   4. 写盘路径：只能由 CLI/工具执行（直改日志文件）；**执行后需重启 DSH**
//      让 workspaceRegistry 重建成组（运行中的内存索引仍按旧 cwd）。
//
// 安全性：只处理带 session/imported（tool='codex'）标记的会话；live 会话跳过；
// 幂等（已归组 = header.cwd 已等于目标目录 → 跳过）；默认 dry-run。

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { readSessionLog, scanZstdFrames } from './sessionlog.mjs'
import { makeReport } from './report.mjs'
import { resolveCodexHome, resolveDshHome } from './paths.mjs'

/** 规范化路径用于比较：正反斜杠统一为 /、折叠重复分隔符、小写、去 \\?\ 前缀 */
export function normalizePathForCompare(p) {
  return String(p ?? '')
    .replace(/^\\\\\?\\/, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

/**
 * 读取 ~/.codex/.codex-global-state.json（容错：缺失/损坏返回空状态）。
 * @param {string} codexHome
 * @returns {{ projectless: Set<string>, hintsRoot: string|null,
 *             workspaceRoots: string[], workspaceLabels: Record<string,string> }}
 */
export function readCodexGlobalState(codexHome) {
  const empty = { projectless: new Set(), hintsRoot: null, workspaceRoots: [], workspaceLabels: {} }
  const path = join(codexHome, '.codex-global-state.json')
  if (!existsSync(path)) return empty
  let gs
  try {
    gs = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return empty
  }
  const projectless = new Set()
  if (Array.isArray(gs['projectless-thread-ids'])) {
    for (const id of gs['projectless-thread-ids']) if (typeof id === 'string' && id) projectless.add(id)
  }
  // 非工作区根：thread-workspace-root-hints 众数
  const hints = gs['thread-workspace-root-hints'] && typeof gs['thread-workspace-root-hints'] === 'object'
    ? gs['thread-workspace-root-hints'] : {}
  const counts = new Map()
  for (const v of Object.values(hints)) {
    if (typeof v === 'string' && v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let hintsRoot = null
  for (const [path0, n] of counts) {
    if (hintsRoot === null || n > counts.get(hintsRoot)) hintsRoot = path0
  }
  // 项目根：local-projects 的 rootPaths + electron-saved-workspace-roots 并集
  const roots = new Set()
  const projects = gs['local-projects'] && typeof gs['local-projects'] === 'object' ? gs['local-projects'] : {}
  for (const p of Object.values(projects)) {
    if (p && Array.isArray(p.rootPaths)) for (const r of p.rootPaths) if (typeof r === 'string' && r) roots.add(r)
  }
  if (Array.isArray(gs['electron-saved-workspace-roots'])) {
    for (const r of gs['electron-saved-workspace-roots']) if (typeof r === 'string' && r) roots.add(r)
  }
  const workspaceLabels = gs['electron-workspace-root-labels'] && typeof gs['electron-workspace-root-labels'] === 'object'
    ? gs['electron-workspace-root-labels'] : {}
  return {
    projectless,
    hintsRoot,
    workspaceRoots: [...roots].map((r) => normalizePathForCompare(r)),
    workspaceLabels,
  }
}

/**
 * 分类一个 codex 会话：
 *   'projectless' —— 非工作区（权威列表命中，或 cwd 在非工作区根下）
 *   'workspace'   —— cwd 位于任一项目根下
 *   'other'       —— 未登记目录（保守：不动）
 * @param {{ sourceId?: string|null, cwd?: string|null }} session
 * @param {{ projectless: Set<string>, hintsRoot: string|null, workspaceRoots: string[] }} state
 * @returns {'projectless'|'workspace'|'other'}
 */
export function classifyCodexSession(session, state) {
  if (!session || !state) return 'other'
  const sourceId = session.sourceId
  if (sourceId && state.projectless.has(sourceId)) return 'projectless'
  const cwd = normalizePathForCompare(session.cwd)
  if (!cwd) return 'other'
  if (state.hintsRoot && (cwd === normalizePathForCompare(state.hintsRoot) || cwd.startsWith(normalizePathForCompare(state.hintsRoot) + '/'))) {
    return 'projectless'
  }
  if (state.workspaceRoots.some((r) => cwd === r || cwd.startsWith(r + '/'))) return 'workspace'
  return 'other'
}

/**
 * 归组目标目录：参数 > hints 众数根 > $DSH_HOME/codex2dsh-non-workspace。
 * @param {{ hintsRoot: string|null }} state
 * @param {object} [opts] { regroupDir?, dshHome? }
 */
export function resolveRegroupTargetDir(state, opts = {}) {
  if (opts.regroupDir) return opts.regroupDir
  if (state && state.hintsRoot) return state.hintsRoot
  return join(opts.dshHome || resolveDshHome(), 'codex2dsh-non-workspace')
}

// ── 物理日志操作 ──────────────────────────────────────────────────────

/** DSH projectKey(cwd)：路径可读化目录名（对齐 dsh-session-persistence-jsonl） */
export function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * 重写会话日志的 header.cwd（zstd 第一帧 / 明文第一行），其余事件帧原样保留。
 * @param {string} logPath session.jsonl.zstd 或 session.jsonl
 * @param {string} newCwd
 * @returns {boolean} 成功与否
 */
export function rewriteSessionCwd(logPath, newCwd) {
  const buf = readFileSync(logPath)
  if (buf.length > 0 && buf[0] === 0x28) {
    const { frames } = scanZstdFrames(buf)
    if (frames.length === 0) return false
    const headerFrame = frames[0]
    const parsed = JSON.parse(zstdDecompressSync(buf.subarray(headerFrame.start, headerFrame.end)).toString('utf8'))
    if (!parsed || typeof parsed !== 'object') return false
    const next = { ...parsed, cwd: newCwd }
    const newHeader = zstdCompressSync(Buffer.from(JSON.stringify(next) + '\n'))
    writeFileSync(logPath, Buffer.concat([newHeader, buf.subarray(headerFrame.end)]))
    return true
  }
  // 明文
  const nl = buf.indexOf(0x0a)
  if (nl === -1) return false
  const parsed = JSON.parse(buf.subarray(0, nl).toString('utf8'))
  if (!parsed || typeof parsed !== 'object') return false
  const next = { ...parsed, cwd: newCwd }
  writeFileSync(logPath, Buffer.concat([Buffer.from(JSON.stringify(next) + '\n'), buf.subarray(nl + 1)]))
  return true
}

/**
 * 把会话日志目录从旧 projectKey 目录移动到新 cwd 对应的目录。
 * @param {string} logPath 会话日志当前路径
 * @param {string} newCwd 新的 cwd（用于推导目标目录）
 * @returns {{ ok: boolean, oldDir: string, newDir: string, error?: string }}
 */
export function moveSessionDir(logPath, newCwd) {
  const oldDir = dirname(logPath)
  const sessionsRoot = dirname(dirname(oldDir))
  const newDir = join(sessionsRoot, projectKey(newCwd))
  const target = join(newDir, oldDir.split(/[\\/]/).pop())
  if (target === oldDir) return { ok: true, oldDir, newDir }
  try {
    mkdirSync(newDir, { recursive: true })
    renameSync(oldDir, target)
    return { ok: true, oldDir, newDir: target }
  } catch (err) {
    return { ok: false, oldDir, newDir: target, error: String((err && err.message) || err) }
  }
}

/**
 * 归组修复主流程（host 内：工具 / 面板；也供 CLI 只读预览）。
 * @param {object} ctx host 上下文（需 get('sessionPersistence')：list + readFrom；get('sessions') 可选）
 * @param {object} [opts]
 * @param {string} opts.codexHome Codex 配置根（默认 resolveCodexHome）
 * @param {string} [opts.regroupDir] 非工作区会话统一目录（默认 hints 众数根）
 * @param {boolean} [opts.dryRun] true = 只预览（默认）
 * @returns {Promise<object>} Report（含 regroup 统计与 restartHint）
 */
export async function planRegroup(ctx, opts = {}) {
  const { dryRun = true } = opts
  const codexHome = opts.codexHome || resolveCodexHome()
  const sp = ctx && typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : null
  if (!sp || typeof sp.list !== 'function' || typeof sp.readFrom !== 'function') {
    return makeReport({ ok: false, warnings: ['sessionPersistence 不可用（需要 list + readFrom）：归组修复只能在 DSH 宿主内执行（工具或面板）或由 CLI 预览'] })
  }
  const state = readCodexGlobalState(codexHome)
  const targetDir = resolveRegroupTargetDir(state, { regroupDir: opts.regroupDir })
  if (typeof targetDir !== 'string' || !targetDir) {
    return makeReport({ ok: false, warnings: ['无法确定非工作区归组目录（无 hints 根且未传 regroupDir）'] })
  }
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    return makeReport({ ok: false, warnings: [`归组目标目录不存在或不是目录：${targetDir}（请先创建或传 --dir）`] })
  }
  const targetNorm = normalizePathForCompare(targetDir)

  let headers = []
  try {
    headers = await sp.list()
  } catch (err) {
    return makeReport({ ok: false, warnings: ['sessionPersistence.list 失败: ' + String((err && err.message) || err)] })
  }

  const items = []
  const warnings = []
  const skipped = {}
  let regrouped = 0
  const sessionsSvc = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null

  const addSkip = (id, reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
    items.push({ kind: 'session', name: id, status: 'skipped', note: reason })
  }

  for (const h of headers) {
    const id = h && h.id
    if (!id) continue
    try {
      if (sessionsSvc && typeof sessionsSvc.get === 'function' && sessionsSvc.get(id)) {
        addSkip(id, 'live')
        continue
      }
      const { events } = await sp.readFrom(id, 0)
      const imp = Array.isArray(events) ? events.find((e) => e && e.type === 'session/imported' && e.data && e.data.tool === 'codex') : undefined
      if (!imp) {
        addSkip(id, 'not-codex-import')
        continue
      }
      const sourceId = typeof imp.data.sourceId === 'string' ? imp.data.sourceId : null
      const cls = classifyCodexSession({ sourceId, cwd: h.cwd }, state)
      if (cls !== 'projectless') {
        addSkip(id, cls === 'workspace' ? 'workspace-session' : 'unclassified')
        continue
      }
      const cwdNorm = normalizePathForCompare(h.cwd)
      if (cwdNorm === targetNorm) {
        addSkip(id, 'already-regrouped')
        continue
      }
      if (!h.cwd) {
        addSkip(id, 'no-cwd')
        continue
      }
      const note = `归组：${h.cwd} → ${targetDir}`
      if (dryRun) {
        items.push({ kind: 'session', name: id, status: 'previewed', note })
        continue
      }
      // 1) 定位日志 → 2) 重写 header.cwd → 3) 物理移动目录
      let logPath = null
      try {
        const located = sp.locate ? sp.locate(h) : null
        if (located && typeof located.path === 'string') logPath = located.path
      } catch {
        logPath = null
      }
      if (!logPath || !existsSync(logPath)) {
        addSkip(id, 'log-not-found')
        continue
      }
      const rewrote = rewriteSessionCwd(logPath, targetDir)
      if (!rewrote) {
        addSkip(id, 'rewrite-failed')
        continue
      }
      const move = moveSessionDir(logPath, targetDir)
      if (!move.ok) {
        items.push({ kind: 'session', name: id, status: 'invalid', note: `header 已改但目录移动失败：${move.error}` })
        warnings.push(`会话 ${id} header.cwd 已改写为 ${targetDir}，但目录移动失败（${move.error}），请手动检查`)
        continue
      }
      regrouped++
      items.push({ kind: 'session', name: id, status: 'migrated', note: `已归组：${h.cwd} → ${targetDir}` })
    } catch (err) {
      addSkip(id, 'error:' + String((err && err.message) || err))
    }
  }

  if (dryRun) warnings.push('dry-run：仅预览，未写盘')
  if (!dryRun && regrouped > 0) {
    warnings.push('已移动 ' + regrouped + ' 个会话的日志目录并改写 header.cwd；**请重启 DSH** 让 workspaceRegistry 重建成组（运行中的分组索引仍按旧 cwd）')
  }
  const report = makeReport({ items, warnings, previewed: dryRun })
  report.regroupDir = targetDir
  report.regrouped = regrouped
  report.skipped = skipped
  report.dryRun = dryRun
  return report
}

/**
 * 只读/执行扫描版归组（CLI 用，无 host ctx）：直接读 DSH 会话日志工件，
 * 判定非工作区会话并（apply 时）改写 header.cwd + 移动日志目录。
 * 执行后需重启 DSH（workspaceRegistry 按 header.cwd 重建分组）。
 * @param {string} codexHome Codex 配置根
 * @param {string} sessionsRoot DSH 会话根
 * @param {object} [opts] { dryRun?, regroupDir? }
 * @returns {Promise<object>} { scanned, planned: [{sessionId, oldCwd, newCwd, sourceId}],
 *                              applied, skipped: [{path, reason}], dryRun, regroupDir }
 */
export async function scanRegroupStandalone(codexHome, sessionsRoot, opts = {}) {
  const { dryRun = true } = opts
  const { readdirSync } = await import('node:fs')
  const state = readCodexGlobalState(codexHome)
  const targetDir = resolveRegroupTargetDir(state, { regroupDir: opts.regroupDir })
  if (!targetDir) return { scanned: 0, planned: [], applied: 0, skipped: [], dryRun, regroupDir: null, warnings: ['无法确定归组目录'] }
  const targetNorm = normalizePathForCompare(targetDir)
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
        logs.push(p)
      }
    }
  }
  walk(sessionsRoot)
  const planned = []
  const applied = []
  const skipped = []
  for (const logPath of logs) {
    try {
      const { header, events } = readSessionLog(logPath)
      const imp = events.find((e) => e && e.type === 'session/imported' && e.data && e.data.tool === 'codex')
      if (!imp) continue
      const sourceId = typeof imp.data.sourceId === 'string' ? imp.data.sourceId : null
      const cls = classifyCodexSession({ sourceId, cwd: header.cwd }, state)
      if (cls !== 'projectless') continue
      const cwdNorm = normalizePathForCompare(header.cwd)
      if (cwdNorm === targetNorm) continue
      const sessionId = logPath.split(/[\\/]/).slice(-2)[0]
      if (dryRun) {
        planned.push({ sessionId, sourceId, oldCwd: header.cwd, newCwd: targetDir })
        continue
      }
      const rewrote = rewriteSessionCwd(logPath, targetDir)
      if (!rewrote) {
        skipped.push({ path: logPath, reason: 'rewrite-failed' })
        continue
      }
      const move = moveSessionDir(logPath, targetDir)
      if (!move.ok) {
        skipped.push({ path: logPath, reason: 'move-failed:' + move.error })
        continue
      }
      applied.push({ sessionId, sourceId, oldCwd: header.cwd, newCwd: targetDir })
    } catch (err) {
      skipped.push({ path: logPath, reason: 'error:' + String((err && err.message) || err) })
    }
  }
  return { scanned: logs.length, planned, applied, skipped, dryRun, regroupDir: targetDir }
}
