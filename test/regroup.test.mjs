// test/regroup.test.mjs —— 工作区归组修复单测（lib/regroup.mjs）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import {
  normalizePathForCompare, readCodexGlobalState, classifyCodexSession,
  resolveRegroupTargetDir, projectKey, rewriteSessionCwd, moveSessionDir,
  planRegroup, scanRegroupStandalone,
} from '../lib/regroup.mjs'
import { readSessionLog } from '../lib/sessionlog.mjs'

function makeRoot(prefix = 'codex2dsh-regroup-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const GLOBAL_STATE_FIXTURE = {
  'projectless-thread-ids': ['pl-1', 'pl-2'],
  'thread-workspace-root-hints': { 'pl-1': 'C:\\Users\\me\\Documents\\Codex', 'pl-2': 'C:\\Users\\me\\Documents\\Codex' },
  'local-projects': {
    'p1': { name: '项目A', rootPaths: ['D:\\Projects\\a', 'D:\\Projects\\a-sub'] },
    'p2': { name: '项目B', rootPaths: ['\\\\?\\D:\\Projects\\b'] },
  },
  'electron-saved-workspace-roots': ['D:\\Projects\\a', '\\\\?\\D:\\Projects\\b'],
  'electron-workspace-root-labels': { 'D:\\Projects\\a': '项目A' },
}

// ── 基础工具 ───────────────────────────────────────────────────────────

test('projectKey：与 DSH 一致的路径可读化（含正/反斜杠、非法字符、截断）', () => {
  assert.equal(projectKey('C:\\Users\\ichin\\Documents\\Codex'), '--C-Users-ichin-Documents-Codex--')
  assert.equal(projectKey('C:/Users/ichin/Documents/Codex'), '--C-Users-ichin-Documents-Codex--')
  assert.equal(projectKey('D:\\Projects\\xmzj-jx-backend'), '--D-Projects-xmzj-jx-backend--')
  assert.equal(projectKey('D:/Projects/xmzj-jx-backend'), '--D-Projects-xmzj-jx-backend--')
  // 非法字符 ~XXXX 编码
  assert.ok(projectKey('C:\\a b\\c').includes('~'))
  // 空/根
  assert.equal(projectKey(''), '--root--')
  // 长路径截断到 251
  assert.equal(projectKey('D:\\' + 'x'.repeat(300)).length, 2 + 251 + 2)
})

test('normalizePathForCompare：斜杠/大小写/长路径前缀归一', () => {
  assert.equal(normalizePathForCompare('D:\\Projects\\A'), 'd:/projects/a')
  assert.equal(normalizePathForCompare('D:/Projects/A'), 'd:/projects/a')
  assert.equal(normalizePathForCompare('\\\\?\\D:\\Projects\\b'), 'd:/projects/b')
  assert.equal(normalizePathForCompare('D:\\a\\\\b'), 'd:/a/b')
})

test('readCodexGlobalState：解析 projectless/根/标签，容错缺失', () => {
  const fx = makeRoot()
  try {
    const home = join(fx.root, 'codex-home')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.codex-global-state.json'), JSON.stringify(GLOBAL_STATE_FIXTURE), 'utf8')
    const s = readCodexGlobalState(home)
    assert.deepEqual([...s.projectless], ['pl-1', 'pl-2'])
    assert.equal(s.hintsRoot, 'C:\\Users\\me\\Documents\\Codex')
    assert.ok(s.workspaceRoots.includes('d:/projects/a'))
    assert.ok(s.workspaceRoots.includes('d:/projects/b'))
    assert.ok(s.workspaceRoots.includes('d:/projects/a-sub'))
    assert.equal(s.workspaceLabels['D:\\Projects\\a'], '项目A')
    // 缺失/损坏
    assert.equal(readCodexGlobalState(fx.root).projectless.size, 0)
    writeFileSync(join(home, '.codex-global-state.json'), 'not-json', 'utf8')
    assert.equal(readCodexGlobalState(home).projectless.size, 0)
  } finally {
    fx.cleanup()
  }
})

test('classifyCodexSession：projectless 权威 > hints 根 > 项目根 > other', () => {
  const st = {
    projectless: new Set(['pl-1']),
    hintsRoot: 'C:\\Users\\me\\Documents\\Codex',
    workspaceRoots: ['d:/projects/a', 'd:/projects/b'],
    workspaceLabels: {},
  }
  assert.equal(classifyCodexSession({ sourceId: 'pl-1', cwd: 'D:\\Projects\\a' }, st), 'projectless')
  assert.equal(classifyCodexSession({ sourceId: 'x', cwd: 'C:\\Users\\me\\Documents\\Codex\\2026-05-01\\hi' }, st), 'projectless')
  assert.equal(classifyCodexSession({ sourceId: 'x', cwd: 'C:\\Users\\me\\Documents\\Codex' }, st), 'projectless')
  assert.equal(classifyCodexSession({ sourceId: 'x', cwd: 'D:\\Projects\\a\\sub' }, st), 'workspace')
  assert.equal(classifyCodexSession({ sourceId: 'x', cwd: 'D:/Projects/b' }, st), 'workspace')
  assert.equal(classifyCodexSession({ sourceId: 'x', cwd: 'D:\\Projects\\unknown' }, st), 'other')
  assert.equal(classifyCodexSession({ sourceId: 'x', cwd: null }, st), 'other')
  assert.equal(classifyCodexSession(null, st), 'other')
})

test('resolveRegroupTargetDir：参数 > hints 根 > 默认目录', () => {
  assert.equal(resolveRegroupTargetDir({ hintsRoot: 'C:\\Codex' }, { regroupDir: 'D:\\Custom' }), 'D:\\Custom')
  assert.equal(resolveRegroupTargetDir({ hintsRoot: 'C:\\Codex' }, {}), 'C:\\Codex')
  assert.ok(resolveRegroupTargetDir({ hintsRoot: null }, { dshHome: 'D:\\dsh' }).startsWith('D:\\dsh'))
})

// ── header 重写 / 目录移动 ─────────────────────────────────────────────

function writeZstdLog(dir, id, events, cwd) {
  mkdirSync(dir, { recursive: true })
  const header = JSON.stringify({ type: 'session', version: 0, id, createdAt: 1, delegationDepth: 0, cwd }) + '\n'
  const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat([
    zstdCompressSync(Buffer.from(header)),
    zstdCompressSync(Buffer.from(body)),
  ]))
  return join(dir, 'session.jsonl.zstd')
}

const IMP_EVENT = (sourceId) => ({
  type: 'session/imported', seq: 0, time: 1, ignorable: true,
  data: { tool: 'codex', sourceId, sourcePath: null, importedAt: 2 },
})
const USER_EVENT = {
  type: 'user/message', seq: 1, time: 1, surfaceOp: 'append',
  data: { turn: 1, message: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } },
}

test('rewriteSessionCwd：zstd 与明文日志 header.cwd 改写、其余帧原样', () => {
  const fx = makeRoot()
  try {
    // zstd
    const zDir = join(fx.root, 'sessions', '--Old-Cwd--', 'import-z')
    const zPath = writeZstdLog(zDir, 'import-z', [IMP_EVENT('s1'), USER_EVENT], 'C:\\Old\\Cwd')
    assert.equal(rewriteSessionCwd(zPath, 'C:\\New\\Root'), true)
    const z = readSessionLog(zPath)
    assert.equal(z.header.cwd, 'C:\\New\\Root')
    assert.equal(z.header.id, 'import-z')
    assert.equal(z.events.length, 2)
    assert.equal(z.events[0].type, 'session/imported')
    assert.equal(z.events.every((e, i) => e.seq === i), true)

    // 明文
    const pDir = join(fx.root, 'sessions', '--Old-Cwd--', 'import-p')
    mkdirSync(pDir, { recursive: true })
    const pPath = join(pDir, 'session.jsonl')
    const header = JSON.stringify({ type: 'session', version: 0, id: 'import-p', createdAt: 1, delegationDepth: 0, cwd: 'C:\\Old\\Cwd' })
    writeFileSync(pPath, [header, JSON.stringify(IMP_EVENT('s1')), JSON.stringify(USER_EVENT)].join('\n') + '\n', 'utf8')
    assert.equal(rewriteSessionCwd(pPath, 'C:\\New\\Root'), true)
    const p = readSessionLog(pPath)
    assert.equal(p.header.cwd, 'C:\\New\\Root')
    assert.equal(p.events.length, 2)
  } finally {
    fx.cleanup()
  }
})

test('moveSessionDir：移动到新 projectKey 目录、已同目录幂等', () => {
  const fx = makeRoot()
  try {
    const sessionsRoot = join(fx.root, 'sessions')
    const zPath = writeZstdLog(join(sessionsRoot, '--Old-Cwd--', 'import-a'), 'import-a', [IMP_EVENT('s1')], 'C:\\Old\\Cwd')
    const m = moveSessionDir(zPath, 'C:\\New\\Root')
    assert.equal(m.ok, true)
    assert.ok(m.newDir.includes('--C-New-Root--'))
    assert.equal(existsSync(join(sessionsRoot, '--Old-Cwd--', 'import-a')), false)
    assert.equal(existsSync(join(sessionsRoot, '--C-New-Root--', 'import-a', 'session.jsonl.zstd')), true)
    // 再移一次（同目录）幂等
    const m2 = moveSessionDir(join(m.newDir, 'session.jsonl.zstd'), 'C:\\New\\Root')
    assert.equal(m2.ok, true)
  } finally {
    fx.cleanup()
  }
})

// ── scanRegroupStandalone（CLI 形态，真实文件）─────────────────────────

test('scanRegroupStandalone：dry-run 计划 → apply 移动并改 header', async () => {
  const fx = makeRoot()
  try {
    const home = join(fx.root, 'codex-home')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.codex-global-state.json'), JSON.stringify({
      'projectless-thread-ids': ['pl-1'],
      'thread-workspace-root-hints': { 'pl-1': 'C:\\Users\\me\\Documents\\Codex' },
      'local-projects': { 'p1': { name: 'A', rootPaths: ['D:\\Projects\\a'] } },
    }), 'utf8')
    const sessionsRoot = join(fx.root, 'sessions')
    const targetDir = join(fx.root, 'docs-codex') // 模拟 Documents\Codex（本地可创建）
    mkdirSync(targetDir, { recursive: true })
    // 非工作区（projectless）
    writeZstdLog(join(sessionsRoot, '--C-Users-me-Documents-Codex-2026-05-01-hi--', 'import-pl'), 'import-pl',
      [IMP_EVENT('pl-1'), USER_EVENT], 'C:\\Users\\me\\Documents\\Codex\\2026-05-01\\hi')
    // 工作区会话（不动）
    writeZstdLog(join(sessionsRoot, '--D-Projects-a--', 'import-ws'), 'import-ws',
      [IMP_EVENT('ws-1'), USER_EVENT], 'D:\\Projects\\a')
    // 非 codex（不动）
    writeZstdLog(join(sessionsRoot, '--Other--', 'import-cl'), 'import-cl',
      [{ ...IMP_EVENT('c1'), data: { tool: 'claude', sourceId: 'c1', sourcePath: null } }, USER_EVENT], 'C:\\X')

    // dry-run
    const plan = await scanRegroupStandalone(home, sessionsRoot, { dryRun: true, regroupDir: targetDir })
    assert.equal(plan.scanned, 3)
    assert.equal(plan.planned.length, 1)
    assert.equal(plan.planned[0].sessionId, 'import-pl')
    assert.equal(plan.planned[0].newCwd, targetDir)
    assert.equal(plan.applied.length, 0)
    // 文件未动
    const before = readSessionLog(join(sessionsRoot, '--C-Users-me-Documents-Codex-2026-05-01-hi--', 'import-pl', 'session.jsonl.zstd'))
    assert.equal(before.header.cwd, 'C:\\Users\\me\\Documents\\Codex\\2026-05-01\\hi')

    // apply
    const done = await scanRegroupStandalone(home, sessionsRoot, { dryRun: false, regroupDir: targetDir })
    assert.equal(done.applied.length, 1)
    assert.equal(done.planned.length, 0)
    // 已移动 + header 已改
    const moved = readSessionLog(join(sessionsRoot, projectKey(targetDir), 'import-pl', 'session.jsonl.zstd'))
    assert.equal(moved.header.cwd, targetDir)
    assert.equal(existsSync(join(sessionsRoot, '--C-Users-me-Documents-Codex-2026-05-01-hi--', 'import-pl')), false)
    // 工作区会话没动
    assert.equal(existsSync(join(sessionsRoot, '--D-Projects-a--', 'import-ws', 'session.jsonl.zstd')), true)
    // 幂等：再跑无事
    const again = await scanRegroupStandalone(home, sessionsRoot, { dryRun: false, regroupDir: targetDir })
    assert.equal(again.planned.length, 0)
    assert.equal(again.applied.length, 0)
  } finally {
    fx.cleanup()
  }
})

// ── planRegroup（host 形态，fake ctx）──────────────────────────────────

test('planRegroup：host 形态归类/跳过/执行，live 与已有归组跳过', async () => {
  const fx = makeRoot()
  try {
    const home = join(fx.root, 'codex-home')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.codex-global-state.json'), JSON.stringify({
      'projectless-thread-ids': ['pl-1'],
      'thread-workspace-root-hints': { 'pl-1': 'C:\\Users\\me\\Documents\\Codex' },
      'local-projects': { 'p1': { name: 'A', rootPaths: ['D:\\Projects\\a'] } },
    }), 'utf8')
    const targetDir = join(fx.root, 'docs-codex')
    mkdirSync(targetDir, { recursive: true })
    const sessionsRoot = join(fx.root, 'sessions')
    const logs = {
      'import-pl': writeZstdLog(join(sessionsRoot, '--C-Users-me-Documents-Codex-2026-05-01-hi--', 'import-pl'), 'import-pl',
        [IMP_EVENT('pl-1'), USER_EVENT], 'C:\\Users\\me\\Documents\\Codex\\2026-05-01\\hi'),
      'import-ws': writeZstdLog(join(sessionsRoot, '--D-Projects-a--', 'import-ws'), 'import-ws',
        [IMP_EVENT('ws-1'), USER_EVENT], 'D:\\Projects\\a'),
    }
    const headers = [
      { id: 'import-pl', cwd: 'C:\\Users\\me\\Documents\\Codex\\2026-05-01\\hi', events: [IMP_EVENT('pl-1'), USER_EVENT] },
      { id: 'import-ws', cwd: 'D:\\Projects\\a', events: [IMP_EVENT('ws-1'), USER_EVENT] },
    ]
    const sp = {
      async list() { return headers },
      async readFrom(id) {
        const h = headers.find((x) => x.id === id)
        return { meta: { id }, events: h ? h.events : [] }
      },
      locate(h) { return { kind: 'jsonl', path: logs[h.id] } },
    }
    const ctx = { get: (n) => (n === 'sessionPersistence' ? sp : n === 'sessions' ? { get: () => undefined } : undefined) }

    // dry-run：只预览
    const dry = await planRegroup(ctx, { codexHome: home, regroupDir: targetDir, dryRun: true })
    assert.equal(dry.previewed, true)
    assert.equal(dry.regrouped, 0)
    assert.ok(dry.items.some((i) => i.name === 'import-pl' && i.status === 'previewed'))
    // 文件未动
    assert.equal(readSessionLog(logs['import-pl']).header.cwd, 'C:\\Users\\me\\Documents\\Codex\\2026-05-01\\hi')

    // apply：只处理非工作区；工作区跳过
    const done = await planRegroup(ctx, { codexHome: home, regroupDir: targetDir, dryRun: false })
    assert.equal(done.regrouped, 1)
    assert.equal(done.skipped['workspace-session'], 1)
    assert.ok(done.warnings.some((w) => w.includes('重启 DSH')))
    assert.equal(readSessionLog(join(sessionsRoot, projectKey(targetDir), 'import-pl', 'session.jsonl.zstd')).header.cwd, targetDir)

    // 幂等：已归组跳过（fake 状态反映移动后：cwd 已改、日志已移到新目录）
    const movedHeaders = [
      { id: 'import-pl', cwd: targetDir, events: [IMP_EVENT('pl-1'), USER_EVENT] },
      { id: 'import-ws', cwd: 'D:\\Projects\\a', events: [IMP_EVENT('ws-1'), USER_EVENT] },
    ]
    const movedSp = {
      async list() { return movedHeaders },
      async readFrom(id) {
        const h = movedHeaders.find((x) => x.id === id)
        return { meta: { id }, events: h ? h.events : [] }
      },
      locate(h) { return { kind: 'jsonl', path: join(sessionsRoot, projectKey(targetDir), h.id, 'session.jsonl.zstd') } },
    }
    const againCtx = { get: (n) => (n === 'sessionPersistence' ? movedSp : n === 'sessions' ? { get: () => undefined } : undefined) }
    const again = await planRegroup(againCtx, { codexHome: home, regroupDir: targetDir, dryRun: false })
    assert.equal(again.regrouped, 0)
    assert.equal(again.skipped['already-regrouped'], 1)

    // live 会话跳过
    const liveCtx = { get: (n) => (n === 'sessionPersistence' ? sp : n === 'sessions' ? { get: (id) => (id === 'import-pl' ? {} : undefined) } : undefined) }
    const live = await planRegroup(liveCtx, { codexHome: home, regroupDir: targetDir, dryRun: false })
    assert.equal(live.regrouped, 0)
    assert.equal(live.skipped.live, 1)
  } finally {
    fx.cleanup()
  }
})

test('planRegroup：host 外（无 ctx.get）→ ok:false 指引', async () => {
  const r = await planRegroup(null, { codexHome: '/none' })
  assert.equal(r.ok, false)
  assert.ok(r.warnings[0].includes('sessionPersistence'))
})
