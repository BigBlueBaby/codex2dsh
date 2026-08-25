// test/title.test.mjs —— 标题回填单测（lib/title.mjs + lib/sessionlog.mjs）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import {
  normalizeTitle, readCodexTitleIndex, firstUserQuestionFromRolloutText,
  looksLikeInstructionsInjection, resolveImportedTitle, buildTitleEvent,
  hasTitleEvent, planTitleBackfill, scanTitleBackfillStandalone,
} from '../lib/title.mjs'
import { readSessionLog, scanZstdFrames } from '../lib/sessionlog.mjs'

function makeRoot(prefix = 'codex2dsh-title-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function codexImportedEvent(sourceId, sourcePath) {
  return {
    type: 'session/imported', seq: 0, time: 1, ignorable: true,
    data: { tool: 'codex', sourceId, sourcePath, importedAt: 2 },
  }
}

const USER_EVENT = {
  type: 'user/message', seq: 1, time: 1,
  data: { turn: 1, message: { id: 'm1', role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } } },
}

// ── normalizeTitle ──────────────────────────────────────────────────────

test('normalizeTitle：空白折叠/截断/空值', () => {
  assert.equal(normalizeTitle('  a   b  '), 'a b')
  assert.equal(normalizeTitle('   '), '')
  assert.equal(normalizeTitle(null), '')
  assert.equal(normalizeTitle(undefined), '')
  const long = '字'.repeat(100)
  assert.equal(normalizeTitle(long).length, 80)
  assert.ok(normalizeTitle(long).endsWith('…'))
})

// ── readCodexTitleIndex ─────────────────────────────────────────────────

test('readCodexTitleIndex：解析索引、同 id 取最新、空名/坏行跳过', () => {
  const fx = makeRoot()
  try {
    const home = join(fx.root, 'codex-home')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'session_index.jsonl'), [
      '{"id":"a1","thread_name":"旧标题","updated_at":"2026-04-15T03:59:50Z"}',
      '{"id":"a1","thread_name":"新标题","updated_at":"2026-04-15T06:10:45Z"}',
      '{"id":"a2","thread_name":"","updated_at":"2026-04-16T00:00:00Z"}',
      'not-json',
      '{"id":"a3","thread_name":"   "}',
      '{"id":"a4","thread_name":"无时间戳"}',
      '{"no-id":true}',
    ].join('\n'), 'utf8')
    const map = readCodexTitleIndex(home)
    assert.equal(map.get('a1'), '新标题') // updated_at 更大者胜
    assert.equal(map.has('a2'), false) // 空 thread_name 跳过
    assert.equal(map.has('a3'), false) // 纯空白跳过
    assert.equal(map.get('a4'), '无时间戳')
    assert.equal(map.size, 2)
  } finally {
    fx.cleanup()
  }
})

test('readCodexTitleIndex：无索引文件 → 空 Map', () => {
  const fx = makeRoot()
  try {
    assert.equal(readCodexTitleIndex(fx.root).size, 0)
  } finally {
    fx.cleanup()
  }
})

// ── firstUserQuestionFromRolloutText ────────────────────────────────────

const ROLLOUT_FIXTURE = [
  // session_meta（忽略）
  '{"type":"session_meta","payload":{"id":"s1","cwd":"C:\\\\work"}}',
  // 首条 user：<environment_context> 注入块（跳过）
  '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>\\nCWD: C:\\\\work\\n</environment_context>"}]}}',
  // 第二条 user：AGENTS.md 指令注入（跳过）
  '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for C:\\\\work\\n\\n<INSTRUCTIONS>\\n## 规则\\n</INSTRUCTIONS>"}]}}',
  // 第三条 user：真实提问（命中）
  '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"从历史记录读取记忆，为什么编译这么慢？"}]}}',
  // assistant 消息（忽略）
  '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"我来看看"}]}}',
].join('\n')

test('firstUserQuestionFromRolloutText：跳过注入块取首条真实提问', () => {
  const t = firstUserQuestionFromRolloutText(ROLLOUT_FIXTURE)
  assert.equal(t, '从历史记录读取记忆，为什么编译这么慢？')
})

test('firstUserQuestionFromRolloutText：无真实提问 → null', () => {
  const t = firstUserQuestionFromRolloutText(ROLLOUT_FIXTURE.split('\n').slice(0, 3).join('\n'))
  assert.equal(t, null)
})

test('looksLikeInstructionsInjection：识别 AGENTS.md/CLAUDE.md/<INSTRUCTIONS>', () => {
  assert.equal(looksLikeInstructionsInjection('# AGENTS.md instructions for C:\\work'), true)
  assert.equal(looksLikeInstructionsInjection('# CLAUDE.md instructions for /home/x'), true)
  assert.equal(looksLikeInstructionsInjection('带 <INSTRUCTIONS> 的内容'), true)
  assert.equal(looksLikeInstructionsInjection('正常提问：如何优化查询？'), false)
})

// ── resolveImportedTitle / buildTitleEvent / hasTitleEvent ──────────────

test('resolveImportedTitle：索引优先，其次 rollout 首问，非 codex 返回 null', () => {
  const fx = makeRoot()
  try {
    const home = join(fx.root, 'codex-home')
    mkdirSync(home, { recursive: true })
    const rollout = join(fx.root, 'rollout-2026-04-29-019d230e.jsonl')
    writeFileSync(rollout, ROLLOUT_FIXTURE, 'utf8')
    const index = readCodexTitleIndex(home) // 空索引

    // 索引命中
    const indexMap = new Map([['s1', '索引标题']])
    const events = [codexImportedEvent('s1', rollout), USER_EVENT]
    assert.deepEqual(resolveImportedTitle(events, { index: indexMap }), {
      title: '索引标题', source: 'index', sourceId: 's1', sourcePath: rollout,
    })

    // 索引未命中 → rollout 首问
    const r2 = resolveImportedTitle(events, { index })
    assert.equal(r2.title, '从历史记录读取记忆，为什么编译这么慢？')
    assert.equal(r2.source, 'rollout')

    // 非 codex 导入
    const claude = [{ ...codexImportedEvent('s1', rollout), data: { tool: 'claude', sourceId: 's1', sourcePath: rollout } }]
    assert.equal(resolveImportedTitle(claude, { index }), null)

    // rollout 不存在且索引未命中 → title null
    const missing = [codexImportedEvent('s1', join(fx.root, 'nope.jsonl'))]
    assert.equal(resolveImportedTitle(missing, { index }).title, null)
  } finally {
    fx.cleanup()
  }
})

test('buildTitleEvent：seq = 事件数，形状对齐 DSH session-title rename', () => {
  const events = [codexImportedEvent('s1', null), USER_EVENT]
  const ev = buildTitleEvent(events, '新标题', 12345)
  assert.equal(ev.type, 'session/title')
  assert.equal(ev.seq, 2)
  assert.equal(ev.time, 12345)
  assert.equal(ev.surfaceOp, 'append')
  assert.deepEqual(ev.data, { title: '新标题', messageSeqs: [], source: { kind: 'user' } })
})

test('hasTitleEvent：已有 session/title 判定', () => {
  assert.equal(hasTitleEvent([USER_EVENT]), false)
  assert.equal(hasTitleEvent([USER_EVENT, { type: 'session/title', seq: 2 }]), true)
})

// ── planTitleBackfill（fake ctx）────────────────────────────────────────

function fakeCtx({ headers, liveIds = [], coldSnapshot = async () => {} } = {}) {
  const appended = []
  const sessions = { get: (id) => (liveIds.includes(id) ? { id } : undefined) }
  const sp = {
    async list() { return headers },
    async readFrom(id) {
      const h = headers.find((x) => x.id === id)
      return { meta: { id }, events: h ? h.events : [] }
    },
    async append(id, events) {
      appended.push({ id, events })
      const h = headers.find((x) => x.id === id)
      if (h) h.events = [...h.events, ...events] // 模拟真实持久化：重读可见新事件
    },
  }
  return {
    ctx: {
      get: (name) => {
        if (name === 'sessionPersistence') return sp
        if (name === 'sessions') return sessions
        if (name === 'sessionProjectionCache') return { coldSnapshot }
        return undefined
      },
    },
    sp, appended, sessions, coldSnapshot,
  }
}

test('planTitleBackfill：host 外（无 ctx.get）→ ok:false 指引', async () => {
  const r = await planTitleBackfill(null, { codexHome: '/none' })
  assert.equal(r.ok, false)
  assert.ok(r.warnings[0].includes('sessionPersistence'))
})

test('planTitleBackfill：索引命中补标题、已有标题/非 codex/无源跳过、幂等', async () => {
  const fx = makeRoot()
  try {
    const home = join(fx.root, 'codex-home')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'session_index.jsonl'), '{"id":"s1","thread_name":"索引标题"}\n', 'utf8')

    const titled = [codexImportedEvent('s2', null), USER_EVENT, { type: 'session/title', seq: 2, data: { title: '已有' } }]
    const claude = [{ ...codexImportedEvent('s3', null), data: { tool: 'claude', sourceId: 's3', sourcePath: null } }]
    const noSource = [codexImportedEvent('s4', join(fx.root, 'missing.jsonl'))]
    const good = [codexImportedEvent('s1', null), USER_EVENT]

    const { ctx, appended } = fakeCtx({
      headers: [
        { id: 'a-titled', events: titled },
        { id: 'b-claude', events: claude },
        { id: 'c-nosource', events: noSource },
        { id: 'd-good', events: good },
      ],
    })
    const r = await planTitleBackfill(ctx, { codexHome: home })
    assert.equal(r.ok, true)
    assert.equal(r.summary.migrated, 1)
    assert.equal(r.titleSources.index, 1)
    // 只追加了 d-good
    assert.equal(appended.length, 1)
    assert.equal(appended[0].id, 'd-good')
    assert.equal(appended[0].events[0].seq, good.length)
    assert.equal(appended[0].events[0].data.title, '索引标题')
    // 跳过原因统计
    assert.equal(r.skipped['has-title'], 1)
    assert.equal(r.skipped['not-codex-import'], 1)
    assert.equal(r.skipped['no-title-source'], 1)

    // 幂等：再跑一次不再追加
    const r2 = await planTitleBackfill(ctx, { codexHome: home })
    assert.equal(r2.summary.migrated, 0)
    assert.equal(appended.length, 1)
  } finally {
    fx.cleanup()
  }
})

test('planTitleBackfill：dryRun 不写盘；sessionIds 过滤；live 会话跳过', async () => {
  const fx = makeRoot()
  try {
    const home = join(fx.root, 'codex-home')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'session_index.jsonl'), '{"id":"s1","thread_name":"T1"}\n{"id":"s2","thread_name":"T2"}\n', 'utf8')
    const e1 = [codexImportedEvent('s1', null), USER_EVENT]
    const e2 = [codexImportedEvent('s2', null), USER_EVENT]

    // dryRun：不写盘，previewed 项带将补标题
    const { ctx, appended } = fakeCtx({ headers: [{ id: 'x1', events: e1 }] })
    const dry = await planTitleBackfill(ctx, { codexHome: home, dryRun: true })
    assert.equal(dry.previewed, true)
    assert.equal(dry.summary.migrated, 0)
    assert.equal(appended.length, 0)
    assert.ok(dry.items.some((i) => i.status === 'previewed' && i.note.includes('T1')))

    // sessionIds 过滤：只处理 x2
    const ctx2 = fakeCtx({ headers: [{ id: 'x1', events: e1 }, { id: 'x2', events: e2 }] })
    const r2 = await planTitleBackfill(ctx2.ctx, { codexHome: home, sessionIds: ['x2'] })
    assert.equal(r2.summary.migrated, 1)
    assert.equal(ctx2.appended.length, 1)
    assert.equal(ctx2.appended[0].id, 'x2')
    assert.equal(ctx2.appended[0].events[0].data.title, 'T2')

    // live 会话跳过（不 append）
    const ctx3 = fakeCtx({ headers: [{ id: 'x1', events: e1 }], liveIds: ['x1'] })
    const r3 = await planTitleBackfill(ctx3.ctx, { codexHome: home })
    assert.equal(r3.summary.migrated, 0)
    assert.equal(ctx3.appended.length, 0)
    assert.equal(r3.skipped.live, 1)
  } finally {
    fx.cleanup()
  }
})

test('planTitleBackfill：rollout 首问兜底 + 投影缓存刷新被调用', async () => {
  const fx = makeRoot()
  try {
    const home = join(fx.root, 'codex-home')
    mkdirSync(home, { recursive: true })
    const rollout = join(fx.root, 'rollout.jsonl')
    writeFileSync(rollout, ROLLOUT_FIXTURE, 'utf8')
    const events = [codexImportedEvent('s1', rollout), USER_EVENT]

    let snapshots = []
    const { ctx, appended } = fakeCtx({
      headers: [{ id: 'x1', events }],
      coldSnapshot: async (id) => { snapshots.push(id) },
    })
    const r = await planTitleBackfill(ctx, { codexHome: home })
    assert.equal(r.summary.migrated, 1)
    assert.equal(r.titleSources.rollout, 1)
    assert.equal(appended[0].events[0].data.title, '从历史记录读取记忆，为什么编译这么慢？')
    assert.deepEqual(snapshots, ['x1'])
  } finally {
    fx.cleanup()
  }
})

// ── scanTitleBackfillStandalone（真实 zstd 日志工件）────────────────────

function writeZstdSessionLog(dir, id, events) {
  mkdirSync(dir, { recursive: true })
  const header = JSON.stringify({ type: 'session', version: 0, id, createdAt: 1, delegationDepth: 0 }) + '\n'
  const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  const buf = Buffer.concat([
    zstdCompressSync(Buffer.from(header)),
    zstdCompressSync(Buffer.from(body)),
  ])
  const path = join(dir, 'session.jsonl.zstd')
  writeFileSync(path, buf)
  return path
}

test('readSessionLog：多帧 zstd 日志可读（header + 事件）', () => {
  const fx = makeRoot()
  try {
    const events = [codexImportedEvent('s1', null), USER_EVENT]
    const path = writeZstdSessionLog(join(fx.root, 'ws', 'import-s1'), 'import-s1', events)
    const { header, events: got } = readSessionLog(path)
    assert.equal(header.id, 'import-s1')
    assert.equal(got.length, 2)
    assert.equal(got[0].type, 'session/imported')
    assert.equal(scanZstdFrames(readFileSync(path)).frames.length, 2)
  } finally {
    fx.cleanup()
  }
})

test('scanTitleBackfillStandalone：只读计划（缺标题 + 已标题 + 非 codex）', async () => {
  const fx = makeRoot()
  try {
    const home = join(fx.root, 'codex-home')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'session_index.jsonl'), '{"id":"s1","thread_name":"索引标题"}\n', 'utf8')
    const sessionsRoot = join(fx.root, 'sessions')
    const rollout = join(fx.root, 'rollout.jsonl')
    writeFileSync(rollout, ROLLOUT_FIXTURE, 'utf8')

    // 缺标题（索引命中）
    writeZstdSessionLog(join(sessionsRoot, '--p1--', 'import-a'), 'import-a', [codexImportedEvent('s1', null), USER_EVENT])
    // 缺标题（rollout 兜底）
    writeZstdSessionLog(join(sessionsRoot, '--p1--', 'import-b'), 'import-b', [codexImportedEvent('s2', rollout), USER_EVENT])
    // 已有标题
    writeZstdSessionLog(join(sessionsRoot, '--p1--', 'import-c'), 'import-c', [
      codexImportedEvent('s3', rollout), USER_EVENT, { type: 'session/title', seq: 2, data: { title: '已有' } },
    ])
    // 非 codex
    writeZstdSessionLog(join(sessionsRoot, '--p2--', 'import-d'), 'import-d', [
      { ...codexImportedEvent('s4', null), data: { tool: 'claude', sourceId: 's4', sourcePath: null } },
    ])

    const plan = await scanTitleBackfillStandalone(home, sessionsRoot)
    assert.equal(plan.total, 4)
    assert.equal(plan.planned.length, 2)
    assert.equal(plan.already, 1)
    assert.equal(plan.unavailable, 0)
    const a = plan.planned.find((p) => p.sessionId === 'import-a')
    assert.equal(a.title, '索引标题')
    assert.equal(a.source, 'index')
    const b = plan.planned.find((p) => p.sessionId === 'import-b')
    assert.equal(b.title, '从历史记录读取记忆，为什么编译这么慢？')
    assert.equal(b.source, 'rollout')
  } finally {
    fx.cleanup()
  }
})
