// test/instructions.test.mjs —— 全局指令迁移单测
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeInstructions, planInstructionsMigration, migrateInstructions } from '../lib/instructions.mjs'

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex2dsh-instr-'))
  const home = join(root, 'codex-home')
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'AGENTS.md'), '# 全局规则\n\n- 规则一\n- 规则二\n', 'utf8')
  writeFileSync(join(home, 'instructions.md'), '旧版指令。\n', 'utf8')
  // 项目级：受信项目带 AGENTS.md
  const proj = join(root, 'proj-demo')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'AGENTS.md'), '# 项目规则\n', 'utf8')
  writeFileSync(join(home, 'config.toml'), `[projects.'${proj.replace(/\\/g, '\\\\')}']\ntrust_level = "trusted"\n`, 'utf8')
  const agents = join(root, 'agents')
  const ledger = join(root, 'ledger')
  return { root, home, agents, ledger, proj, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('analyzeInstructions 探测全局与项目级文件', () => {
  const fx = makeFixture()
  try {
    const { files, projects } = analyzeInstructions(fx.home)
    assert.equal(files.find((f) => f.name === 'AGENTS.md').exists, true)
    assert.equal(files.find((f) => f.name === 'instructions.md').exists, true)
    assert.equal(projects.length, 1)
    assert.equal(projects[0].hasAgents, true)
  } finally {
    fx.cleanup()
  }
})

test('planInstructionsMigration 零副作用', async () => {
  const fx = makeFixture()
  try {
    const r = await planInstructionsMigration(fx.home)
    assert.equal(r.previewed, true)
    assert.ok(r.items.some((i) => i.name === 'AGENTS.md' && i.status === 'previewed'))
    assert.ok(r.items.some((i) => i.note.includes('项目级规则')))
    assert.equal(existsSync(join(fx.agents, 'instructions')), false)
  } finally {
    fx.cleanup()
  }
})

test('migrateInstructions：原文保留 + 来源注释 + 台账 + 幂等', async () => {
  const fx = makeFixture()
  try {
    const r = await migrateInstructions(fx.home, fx.agents, { ledgerDir: fx.ledger })
    const migrated = r.items.filter((i) => i.status === 'migrated')
    assert.equal(migrated.length, 2)
    const global = readFileSync(join(fx.agents, 'instructions', 'global.md'), 'utf8')
    assert.ok(global.startsWith('<!-- codex2dsh: 来源'))
    assert.ok(global.includes('# 全局规则\n\n- 规则一\n- 规则二'), '正文必须原样保留')
    const inst = readFileSync(join(fx.agents, 'instructions', 'global-instructions.md'), 'utf8')
    assert.ok(inst.includes('旧版指令。'))
    // 台账
    const ledger = JSON.parse(readFileSync(join(fx.ledger, 'ledger.json'), 'utf8'))
    assert.equal(ledger.length, 2)
    assert.ok(ledger.every((e) => e.tool === 'migrate_codex_instructions'))
    // 幂等
    const again = await migrateInstructions(fx.home, fx.agents, { ledgerDir: fx.ledger })
    assert.equal(again.items.filter((i) => i.status === 'migrated').length, 0)
    assert.ok(again.items.some((i) => i.status === 'skipped' && i.note.includes('幂等')))
  } finally {
    fx.cleanup()
  }
})

test('migrateInstructions 冲突：目标不同且未 force → 拒绝覆盖', async () => {
  const fx = makeFixture()
  try {
    mkdirSync(join(fx.agents, 'instructions'), { recursive: true })
    writeFileSync(join(fx.agents, 'instructions', 'global.md'), '人工修改版本', 'utf8')
    const r = await migrateInstructions(fx.home, fx.agents, { ledgerDir: fx.ledger })
    const item = r.items.find((i) => i.name === 'AGENTS.md')
    assert.equal(item.status, 'skipped')
    assert.ok(item.note.includes('force'))
    assert.equal(readFileSync(join(fx.agents, 'instructions', 'global.md'), 'utf8'), '人工修改版本')
  } finally {
    fx.cleanup()
  }
})

test('migrateInstructions force：覆盖', async () => {
  const fx = makeFixture()
  try {
    mkdirSync(join(fx.agents, 'instructions'), { recursive: true })
    writeFileSync(join(fx.agents, 'instructions', 'global.md'), '旧', 'utf8')
    const r = await migrateInstructions(fx.home, fx.agents, { ledgerDir: fx.ledger, force: true })
    assert.equal(r.items.find((i) => i.name === 'AGENTS.md').status, 'migrated')
    assert.ok(readFileSync(join(fx.agents, 'instructions', 'global.md'), 'utf8').includes('# 全局规则'))
  } finally {
    fx.cleanup()
  }
})
