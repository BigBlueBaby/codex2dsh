// test/delegate.test.mjs —— 会话委托单测
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSessions, findImportCodex, planSessionsMigration } from '../lib/delegate.mjs'

function makeSessionsFixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex2dsh-del-'))
  const home = join(root, 'codex-home')
  const day = join(home, 'sessions', '2026', '08', '13')
  mkdirSync(day, { recursive: true })
  // 真实 Codex 命名格式
  writeFileSync(join(day, 'rollout-2026-08-13T11-33-37-019d230e-106a-7a83-aa0e-a93af8360183.jsonl'), '{"type":"response_item"}\n', 'utf8')
  writeFileSync(join(day, 'rollout-2026-08-13T14-18-11-019d23a4-bc8d-7ab1-957f-98ca031168da.jsonl'), '{"type":"response_item"}\n', 'utf8')
  writeFileSync(join(day, 'other.txt'), '忽略\n', 'utf8')
  const ledger = join(root, 'ledger')
  return { root, home, ledger, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('scanSessions 只统计 rollout-*.jsonl 并给出时间范围', () => {
  const fx = makeSessionsFixture()
  try {
    const s = scanSessions(fx.home)
    assert.equal(s.count, 2)
    assert.ok(s.bytes > 0)
    assert.equal(s.firstTs.slice(0, 10), '2026-08-13')
    assert.equal(s.lastTs.slice(0, 10), '2026-08-13')
  } finally {
    fx.cleanup()
  }
})

test('scanSessions 无会话目录返回零', () => {
  const fx = makeSessionsFixture()
  try {
    assert.equal(scanSessions(join(fx.root, 'empty')).count, 0)
  } finally {
    fx.cleanup()
  }
})

test('findImportCodex：支持 tools.get 与 registered 列表两种形态', () => {
  const fakeTool = { name: 'import_codex', execute: async () => ({}) }
  assert.equal(findImportCodex({ tools: { get: (n) => (n === 'import_codex' ? fakeTool : undefined) } }), fakeTool)
  assert.equal(findImportCodex({ tools: { registered: [fakeTool] } }), fakeTool)
  assert.equal(findImportCodex({ tools: { registered: [] } }), null)
  assert.equal(findImportCodex(null), null)
})

test('无会话 → skipped；未装 import_codex → 安装指引', async () => {
  const fx = makeSessionsFixture()
  try {
    const empty = await planSessionsMigration(join(fx.root, 'empty'), null)
    assert.ok(empty.items.some((i) => i.status === 'skipped' && i.note.includes('未发现')))

    const guidance = await planSessionsMigration(fx.home, null, { ledgerDir: fx.ledger })
    assert.ok(guidance.items.some((i) => i.name === 'delegation' && i.status === 'skipped'))
    assert.ok(guidance.warnings.some((w) => w.includes('dsh-chat-import')))
    assert.equal(guidance.items.filter((i) => i.status === 'migrated').length, 0)
    // 无委托成功 → 台账无记录
    assert.equal(readLedgerCount(fx.ledger), 0)
  } finally {
    fx.cleanup()
  }
})

test('有 import_codex → 委托（透传参数）+ 台账', async () => {
  const fx = makeSessionsFixture()
  const calls = []
  const fakeImport = {
    name: 'import_codex',
    async execute(args) {
      calls.push(args)
      return { ok: true, sessionIds: ['s1', 's2'], summary: { imported: 2 } }
    },
  }
  try {
    const ctx = { tools: { get: (n) => (n === 'import_codex' ? fakeImport : undefined) } }
    const r = await planSessionsMigration(fx.home, ctx, { ledgerDir: fx.ledger, budget: 100000, restamp: true })
    assert.ok(r.items.some((i) => i.status === 'delegated' && i.note.includes('2 个会话')))
    // 透传 path/preview/budget/restamp
    assert.equal(calls.length, 1)
    assert.ok(calls[0].path.endsWith('sessions'))
    assert.equal(calls[0].budget, 100000)
    assert.equal(calls[0].restamp, true)
    assert.equal(calls[0].preview, undefined)
    // 台账
    const entries = JSON.parse(readFileSync(join(fx.ledger, 'ledger.json'), 'utf8'))
    assert.equal(entries.length, 1)
    assert.equal(entries[0].tool, 'migrate_codex_sessions')
    assert.ok(entries[0].note.includes('imported=2'))
  } finally {
    fx.cleanup()
  }
})

test('preview 模式：委托透传 preview 且不写台账', async () => {
  const fx = makeSessionsFixture()
  const calls = []
  const fakeImport = {
    name: 'import_codex',
    async execute(args) {
      calls.push(args)
      return { ok: true, sessionIds: ['s1'] }
    },
  }
  try {
    const ctx = { tools: { get: () => fakeImport } }
    const r = await planSessionsMigration(fx.home, ctx, { preview: true, ledgerDir: fx.ledger })
    assert.ok(r.items.some((i) => i.name === 'import_codex' && i.status === 'previewed'))
    assert.equal(calls[0].preview, true)
    assert.equal(readLedgerCount(fx.ledger), 0)
  } finally {
    fx.cleanup()
  }
})

function readLedgerCount(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')).length
  } catch {
    return 0
  }
}
