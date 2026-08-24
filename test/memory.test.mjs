// test/memory.test.mjs —— 记忆迁移单测（含 node:sqlite 只读探测）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { analyzeMemory, probeMemorySqlite, planMemoryMigration, migrateMemory } from '../lib/memory.mjs'

function makeFixture({ withConfig = true, memoriesEnabled = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'codex2dsh-mem-'))
  const home = join(root, 'codex-home')
  mkdirSync(join(home, 'memories'), { recursive: true })
  writeFileSync(join(home, 'memories', 'note-a.md'), '# 记忆 A\n\n重要事实。\n', 'utf8')
  writeFileSync(join(home, 'memories', 'data.json'), '{"key":"value"}\n', 'utf8')
  if (withConfig) {
    writeFileSync(join(home, 'config.toml'),
      memoriesEnabled ? '[features]\nmemories = true\n[memories]\nuse_memories = true\n' : '[features]\nmemories = false\n',
      'utf8')
  }
  // sqlite 夹具：含 content 列的表 + 无关表
  const db = new DatabaseSync(join(home, 'memories_1.sqlite'))
  db.exec('CREATE TABLE memories (id INTEGER PRIMARY KEY, content TEXT, created_at TEXT)')
  db.exec("INSERT INTO memories (content, created_at) VALUES ('记忆条目一', '2026-01-01'), ('记忆条目二', '2026-01-02')")
  db.exec('CREATE TABLE meta (k TEXT, v TEXT)')
  db.exec("INSERT INTO meta VALUES ('version', '1')")
  db.close()
  const outDir = join(root, 'dsh-home', 'memories', 'codex')
  const ledger = join(root, 'ledger')
  return { root, home, outDir, ledger, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('analyzeMemory 探测目录资产与 sqlite', () => {
  const fx = makeFixture()
  try {
    const a = analyzeMemory(fx.home)
    assert.equal(a.enabled, true)
    assert.equal(a.files.length, 2)
    assert.ok(a.sqlite)
  } finally {
    fx.cleanup()
  }
})

test('probeMemorySqlite 只读提取文本条目；损坏文件降级', () => {
  const fx = makeFixture()
  try {
    const probe = probeMemorySqlite(join(fx.home, 'memories_1.sqlite'))
    assert.equal(probe.ok, true)
    assert.ok(probe.tables.includes('memories'))
    assert.ok(probe.entries.some((e) => e.text.includes('记忆条目一')))
    // 非 db 文件 → 降级（不抛）
    const bad = join(fx.home, 'not-a-db.sqlite')
    writeFileSync(bad, 'garbage not sqlite', 'utf8')
    const badProbe = probeMemorySqlite(bad)
    assert.equal(badProbe.ok, false)
    assert.ok(badProbe.reason)
  } finally {
    fx.cleanup()
  }
})

test('planMemoryMigration 零副作用且报告 sqlite 规模', async () => {
  const fx = makeFixture()
  try {
    const r = await planMemoryMigration(fx.home)
    assert.equal(r.previewed, true)
    assert.ok(r.items.some((i) => i.name === 'note-a.md' && i.status === 'previewed'))
    const sqliteItem = r.items.find((i) => i.name === 'memories_1.sqlite')
    assert.equal(sqliteItem.status, 'previewed')
    assert.ok(sqliteItem.note.includes('2 条'))
    // 零副作用：目标目录未创建
    const fs = await import('node:fs')
    assert.equal(fs.existsSync(fx.outDir), false)
  } finally {
    fx.cleanup()
  }
})

test('migrateMemory：目录资产 + sqlite 提取落盘 + 台账 + 幂等', async () => {
  const fx = makeFixture()
  try {
    const r = await migrateMemory(fx.home, fx.outDir, { ledgerDir: fx.ledger })
    const migrated = r.items.filter((i) => i.status === 'migrated')
    assert.equal(migrated.length, 3, 'note-a.md + data.json + memory-sqlite.md')
    // 文本带来源注释
    assert.ok(readFileSync(join(fx.outDir, 'note-a.md'), 'utf8').startsWith('<!-- codex2dsh: 来源'))
    // json 原样
    assert.equal(readFileSync(join(fx.outDir, 'data.json'), 'utf8'), '{"key":"value"}\n')
    // sqlite 提取
    const md = readFileSync(join(fx.outDir, 'memory-sqlite.md'), 'utf8')
    assert.ok(md.includes('记忆条目一'))
    assert.ok(md.includes('记忆条目二'))
    // 台账
    const ledger = JSON.parse(readFileSync(join(fx.ledger, 'ledger.json'), 'utf8'))
    assert.equal(ledger.length, 3)
    // 幂等
    const again = await migrateMemory(fx.home, fx.outDir, { ledgerDir: fx.ledger })
    assert.equal(again.items.filter((i) => i.status === 'migrated').length, 0)
  } finally {
    fx.cleanup()
  }
})

test('记忆开关关闭时跳过', async () => {
  const fx = makeFixture({ memoriesEnabled: false })
  try {
    const r = await migrateMemory(fx.home, fx.outDir, { ledgerDir: fx.ledger })
    assert.ok(r.items.some((i) => i.status === 'skipped' && i.note.includes('记忆开关')))
    assert.equal(r.items.filter((i) => i.status === 'migrated').length, 0)
  } finally {
    fx.cleanup()
  }
})
