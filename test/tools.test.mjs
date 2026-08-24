// test/tools.test.mjs —— 工具面测试（fake ctx；需 @deepseek-ai/dsh-tools 已安装）
//
// @deepseek-ai/dsh-tools 是 peerDependency，未安装时本文件跳过（CI 中由 npm install 提供）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let registerTools
try {
  ({ registerTools } = await import('../lib/tools.mjs'))
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    test('工具面测试', { skip: '@deepseek-ai/dsh-tools 未安装（npm install 后启用）' }, () => {})
  } else {
    throw err
  }
}

if (registerTools) {
  /** 记录型 fake ctx */
  function fakeCtx() {
    const registered = []
    return {
      registered,
      tools: { register: (t) => registered.push(t) },
    }
  }

  function makeFixture() {
    const root = mkdtempSync(join(tmpdir(), 'codex2dsh-tools-'))
    const home = join(root, 'codex-home')
    mkdirSync(join(home, 'skills', 'demo'), { recursive: true })
    writeFileSync(join(home, 'config.toml'), [
      'model = "demo-model"',
      '[mcp_servers.demo-db]',
      'command = "npx"',
      'args = ["demo-mcp", "--password", "Example#2023"]',
      '[mcp_servers.node_repl]',
      'command = "C:\\\\Codex\\\\runtimes\\\\x\\\\node_repl.exe"',
    ].join('\n'), 'utf8')
    const ledger = join(root, 'dsh-home', 'codex2dsh')
    const out = join(root, 'out', 'mcp-mirror.cordis.yml')
    return { home, ledger, out, cleanup: () => rmSync(root, { recursive: true, force: true }) }
  }

  test('registerTools 注册全部 9 个工具', () => {
    const ctx = fakeCtx()
    registerTools(ctx, '/tmp/ledger')
    const names = ctx.registered.map((t) => t.name)
    for (const n of [
      'migrate_codex_preview', 'migrate_codex_mcp', 'migrate_codex_skills',
      'migrate_codex_instructions', 'migrate_codex_memory', 'migrate_codex_config',
      'migrate_codex_sessions', 'codex2dsh_doctor', 'codex2dsh_ledger',
    ]) {
      assert.ok(names.includes(n), `缺少工具 ${n}`)
    }
  })

  test('migrate_codex_preview 在夹具 CODEX_HOME 上工作', async () => {
    const fx = makeFixture()
    try {
      const ctx = fakeCtx()
      registerTools(ctx, fx.ledger)
      const tool = ctx.registered.find((t) => t.name === 'migrate_codex_preview')
      const report = await tool.execute({ codexHome: fx.home })
      assert.equal(report.ok, true)
      assert.equal(report.previewed, true)
      assert.ok(report.items.some((i) => i.kind === 'mcp'))
      assert.ok(report.items.some((i) => i.kind === 'secret') === false)
    } finally {
      fx.cleanup()
    }
  })

  test('migrate_codex_mcp：dry-run → apply → 幂等 skip', async () => {
    const fx = makeFixture()
    try {
      const ctx = fakeCtx()
      registerTools(ctx, fx.ledger)
      const tool = ctx.registered.find((t) => t.name === 'migrate_codex_mcp')

      // 1) dry-run：不写盘
      const dry = await tool.execute({ codexHome: fx.home, outPath: fx.out })
      assert.equal(dry.previewed, true)
      assert.equal(dry.summary.migrated, 1) // node_repl 被排除
      assert.throws(() => readFileSync(fx.out, 'utf8'))

      // 2) apply：写盘 + 脱敏
      const applied = await tool.execute({ codexHome: fx.home, outPath: fx.out, apply: true })
      assert.equal(applied.ok, true)
      const content = readFileSync(fx.out, 'utf8')
      assert.ok(content.includes('demo-db:'))
      assert.ok(!content.includes('Example#2023'))
      assert.ok(content.includes('****'))

      // 3) 再次 apply：内容相同 → skipped
      const again = await tool.execute({ codexHome: fx.home, outPath: fx.out, apply: true })
      assert.ok(again.warnings.some((w) => w.includes('跳过')))

      // 4) 台账已记录
      const ledger = JSON.parse(readFileSync(join(fx.ledger, 'ledger.json'), 'utf8'))
      assert.ok(ledger.length >= 1)
      assert.equal(ledger[0].tool, 'migrate_codex_mcp')
    } finally {
      fx.cleanup()
    }
  })

  test('migrate_codex_mcp：expectedHash 校验失败拒绝执行', async () => {
    const fx = makeFixture()
    try {
      const ctx = fakeCtx()
      registerTools(ctx, fx.ledger)
      const tool = ctx.registered.find((t) => t.name === 'migrate_codex_mcp')
      const report = await tool.execute({ codexHome: fx.home, outPath: fx.out, expectedHash: '0'.repeat(64) })
      assert.equal(report.ok, false)
      assert.ok(report.warnings.some((w) => w.includes('expectedHash')))
    } finally {
      fx.cleanup()
    }
  })

  test('占位工具返回友好报告而非抛错（M4 会话委托）', async () => {
    const ctx = fakeCtx()
    registerTools(ctx, '/tmp/ledger')
    const tool = ctx.registered.find((t) => t.name === 'migrate_codex_sessions')
    const report = await tool.execute({})
    assert.equal(report.ok, false)
    assert.ok(report.warnings[0].includes('尚未实现'))
  })

  test('migrate_codex_skills：dry-run → apply → 幂等 skip', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codex2dsh-toolskill-'))
    const home = join(root, 'codex-home')
    mkdirSync(join(home, 'skills', 'demo-skill'), { recursive: true })
    writeFileSync(join(home, 'skills', 'demo-skill', 'SKILL.md'),
      '---\nname: demo-skill\ndescription: 演示。\n---\n\n正文。\n', 'utf8')
    const ledger = join(root, 'dsh-home', 'codex2dsh')
    const agents = join(root, 'agents')
    try {
      const ctx = fakeCtx()
      registerTools(ctx, ledger)
      const tool = ctx.registered.find((t) => t.name === 'migrate_codex_skills')

      // dry-run：不写盘
      const dry = await tool.execute({ codexHome: home, agentsHome: agents })
      assert.equal(dry.previewed, true)
      assert.equal(existsSync(join(agents, 'skills')), false)

      // apply：落盘
      const applied = await tool.execute({ codexHome: home, agentsHome: agents, apply: true })
      assert.equal(applied.items.filter((i) => i.status === 'migrated').length, 1)
      const target = readFileSync(join(agents, 'skills', 'demo-skill', 'SKILL.md'), 'utf8')
      assert.ok(target.includes('kind: dsh'))

      // 幂等
      const again = await tool.execute({ codexHome: home, agentsHome: agents, apply: true })
      assert.equal(again.items.filter((i) => i.status === 'migrated').length, 0)
      assert.ok(again.items.some((i) => i.status === 'skipped' && i.note.includes('幂等')))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
