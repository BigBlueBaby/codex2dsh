// test/ledger.test.mjs —— 迁移台账单测（临时目录）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendLedger, readLedger, findLedgerEntry } from '../lib/ledger.mjs'

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'codex2dsh-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('append / read / find 幂等键', () => {
  const { dir, cleanup } = makeTmp()
  try {
    appendLedger(dir, { tool: 'migrate_codex_mcp', source: 'C:\\s\\config.toml', target: 'C:\\t\\mcp.yml', status: 'generated' })
    appendLedger(dir, { tool: 'migrate_codex_mcp', source: 'C:\\s\\config.toml', target: 'C:\\t\\mcp.yml', status: 'generated' })
    const entries = readLedger(dir)
    assert.equal(entries.length, 2)
    assert.equal(entries[0].sourceFingerprint, entries[1].sourceFingerprint)
    const found = findLedgerEntry(dir, {
      tool: 'migrate_codex_mcp',
      source: 'C:\\s\\config.toml',
      fingerprint: entries[0].sourceFingerprint,
    })
    assert.ok(found)
    const file = join(dir, 'ledger.json')
    assert.ok(readFileSync(file, 'utf8').includes('sourceFingerprint'))
  } finally {
    cleanup()
  }
})

test('台账不存在时 read 返回空数组', () => {
  const { dir, cleanup } = makeTmp()
  try {
    assert.deepEqual(readLedger(dir), [])
  } finally {
    cleanup()
  }
})
