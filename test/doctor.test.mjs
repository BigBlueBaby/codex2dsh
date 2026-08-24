// test/doctor.test.mjs —— 体检单测（台账驱动状态判定）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctor } from '../lib/doctor.mjs'
import { appendLedger } from '../lib/ledger.mjs'

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex2dsh-doc-'))
  const home = join(root, 'codex-home')
  mkdirSync(join(home, 'skills', 'demo-skill'), { recursive: true })
  writeFileSync(join(home, 'config.toml'), [
    'model = "demo"',
    '[mcp_servers.demo-db]',
    'command = "npx"',
    'args = ["demo-mcp"]',
  ].join('\n'), 'utf8')
  writeFileSync(join(home, 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: 演示。\n---\n\n正文。\n', 'utf8')
  writeFileSync(join(home, 'AGENTS.md'), '# 规则\n', 'utf8')
  writeFileSync(join(home, 'auth.json'), '{"tokens":"x"}\n', 'utf8')
  const ledger = join(root, 'ledger')
  return { root, home, ledger, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('runDoctor：未迁移 → pending 项 + 密钥警告', async () => {
  const fx = makeFixture()
  try {
    const r = await runDoctor(fx.home, { ledgerDir: fx.ledger })
    assert.equal(r.ok, true)
    assert.ok(r.items.some((i) => i.kind === 'mcp' && i.status === 'skipped'))
    assert.ok(r.items.some((i) => i.kind === 'skill' && i.status === 'skipped'))
    assert.ok(r.items.some((i) => i.kind === 'instruction' && i.status === 'skipped'))
    assert.ok(r.items.some((i) => i.kind === 'secret' && i.name === 'auth.json'))
    assert.ok(r.warnings.some((w) => w.includes('凭据')))
    assert.ok(r.warnings.some((w) => w.includes('尚未迁移')))
  } finally {
    fx.cleanup()
  }
})

test('runDoctor：台账命中后状态翻转为已迁移', async () => {
  const fx = makeFixture()
  try {
    appendLedger(fx.ledger, { tool: 'migrate_codex_mcp', source: join(fx.home, 'config.toml'), target: 'x', status: 'generated' })
    appendLedger(fx.ledger, { tool: 'migrate_codex_skills', source: join(fx.home, 'skills', 'demo-skill', 'SKILL.md'), target: 'y', status: 'migrated' })
    appendLedger(fx.ledger, { tool: 'migrate_codex_instructions', source: join(fx.home, 'AGENTS.md'), target: 'z', status: 'migrated' })
    const r = await runDoctor(fx.home, { ledgerDir: fx.ledger })
    const mcp = r.items.find((i) => i.kind === 'mcp')
    const skill = r.items.find((i) => i.kind === 'skill')
    const instr = r.items.find((i) => i.kind === 'instruction')
    assert.equal(mcp.status, 'migrated')
    assert.equal(skill.status, 'migrated')
    assert.equal(instr.status, 'migrated')
    // 密钥警告仍在
    assert.ok(r.warnings.some((w) => w.includes('凭据')))
  } finally {
    fx.cleanup()
  }
})
