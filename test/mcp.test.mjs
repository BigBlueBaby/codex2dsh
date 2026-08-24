// test/mcp.test.mjs —— MCP 镜像计划 / 渲染 / 幂等 / 工具迁移单测
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseCodexConfig } from '../lib/config.mjs'
import {
  isRuntimeServer, buildMcpPlan, renderMcpPlan, decideWrite,
  detectLocalTools, rewriteToolPaths, runMcpMigration,
} from '../lib/mcp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(here, 'fixtures', 'codex-config.sample.toml'), 'utf8')

test('isRuntimeServer 识别运行时服务器（名称/路径/env 特征）', () => {
  assert.equal(isRuntimeServer({ name: 'node_repl', command: '', env: {} }), true)
  assert.equal(isRuntimeServer({ name: 'browser-extra', command: '', env: {} }), true)
  assert.equal(isRuntimeServer({ name: 'my-server', command: 'C:\\...\\Codex\\runtimes\\x\\node_repl.exe', env: {} }), true)
  assert.equal(isRuntimeServer({ name: 'my-server', command: 'npx', env: { CODEX_CLI_PATH: 'C:\\codex.exe' } }), true)
  assert.equal(isRuntimeServer({ name: 'my-server', command: 'npx', env: { PATH: 'D:\\bin' } }), false)
})

test('buildMcpPlan 默认排除运行时；默认原样迁移密钥，maskSecrets 时脱敏', () => {
  const { config } = parseCodexConfig(fixture)
  const { plan, excluded, maskedCount } = buildMcpPlan(config, { excludeRuntime: true })
  assert.ok(excluded.includes('node_repl'), 'node_repl 应被排除')
  const names = plan.map((s) => s.name)
  assert.ok(names.includes('kingbase-demo-db'))
  assert.ok(names.includes('google-mcp-toolbox'))
  // 默认：原样迁移（maskedCount 仍统计敏感值数量供报告）
  assert.ok(maskedCount >= 2, `应统计到至少 2 处敏感值，实际 ${maskedCount}`)
  const kb = plan.find((s) => s.name === 'kingbase-demo-db')
  const pwIdx = kb.args.indexOf('--password')
  assert.equal(kb.args[pwIdx + 1], 'Example#2023', '默认应保留原值（用户需求：直接迁移密钥）')

  // maskSecrets:true → 脱敏
  const maskedPlan = buildMcpPlan(config, { excludeRuntime: true, maskSecrets: true })
  const kb2 = maskedPlan.plan.find((s) => s.name === 'kingbase-demo-db')
  assert.equal(kb2.args[kb2.args.indexOf('--password') + 1], '****')
})

test('buildMcpPlan include/exclude 选择性过滤（支持前缀通配）', () => {
  const { config } = parseCodexConfig(fixture)
  const only = buildMcpPlan(config, { excludeRuntime: true, include: ['kingbase-demo-db'] })
  assert.deepEqual(only.plan.map((s) => s.name), ['kingbase-demo-db'])
  assert.ok(only.excluded.includes('google-mcp-toolbox'))

  const noKb = buildMcpPlan(config, { excludeRuntime: true, exclude: ['kingbase-*'] })
  assert.ok(!noKb.plan.some((s) => s.name.startsWith('kingbase')))
  assert.ok(noKb.plan.some((s) => s.name === 'google-mcp-toolbox'))
})

test('excludeRuntime:false 时保留运行时服务器', () => {
  const { config } = parseCodexConfig(fixture)
  const { plan, excluded } = buildMcpPlan(config, { excludeRuntime: false })
  assert.equal(excluded.length, 0)
  assert.ok(plan.some((s) => s.name === 'node_repl'))
})

test('renderMcpPlan 输出可审阅 YAML（maskSecrets 时含掩码）', () => {
  const { config } = parseCodexConfig(fixture)
  const { plan } = buildMcpPlan(config, { excludeRuntime: true, maskSecrets: true })
  const yaml = renderMcpPlan({ plan, source: 'C:\\fixture\\config.toml' })
  assert.ok(yaml.includes('- insert:'))
  assert.ok(yaml.includes('id: dsh-mcp-client'))
  assert.ok(yaml.includes('kingbase-demo-db:'))
  assert.ok(yaml.includes('--password') && yaml.includes('****'))
  assert.ok(!yaml.includes('node_repl'), '渲染不应包含被排除的运行时服务器')
  assert.ok(!yaml.includes('Example#2023'), '脱敏模式下示例密码不得出现在输出')

  // 默认模式：原样保留（含密钥）
  const raw = buildMcpPlan(config, { excludeRuntime: true })
  const rawYaml = renderMcpPlan({ plan: raw.plan, source: 'C:\\fixture\\config.toml' })
  assert.ok(rawYaml.includes('Example#2023'), '默认模式应直接迁移密钥')
})

test('decideWrite 幂等三态', () => {
  assert.equal(decideWrite('x', null, false), 'write')
  assert.equal(decideWrite('x', 'x', false), 'skip')
  assert.equal(decideWrite('x', 'y', false), 'conflict')
  assert.equal(decideWrite('x', 'y', true), 'write')
})

test('detectLocalTools 识别 ~/.codex/tools 引用', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex2dsh-dlt-'))
  const codexHome = join(root, 'codex-home')
  const toolDir = join(codexHome, 'tools', 'mcp-toolbox')
  mkdirSync(toolDir, { recursive: true })
  writeFileSync(join(toolDir, 'toolbox.exe'), 'MOCK', 'utf8')
  try {
    // TOML 单引号字符串：反斜杠原样（不转义）
    const { config } = parseCodexConfig([
      '[mcp_servers.toolbox]',
      `command = '${join(toolDir, 'toolbox.exe')}'`,
      `args = ["--config", "${join(toolDir, 'tools.yaml').replace(/\\/g, '\\\\')}"]`,
      '[mcp_servers.remote]',
      'command = "npx"',
      'args = ["remote-mcp"]',
    ].join('\n'))
    const { plan } = buildMcpPlan(config, { excludeRuntime: true })
    const tools = detectLocalTools(codexHome, plan)
    assert.deepEqual(tools.map((t) => t.name), ['mcp-toolbox'])
    assert.ok(tools[0].size > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rewriteToolPaths 重写 command/args/env 中的工具路径', () => {
  const plan = [
    {
      name: 'toolbox',
      command: 'C:\\codex-home\\tools\\mcp-toolbox\\toolbox.exe',
      args: ['--config', 'C:/codex-home/tools/mcp-toolbox/tools.yaml'],
      env: { PATH: 'C:\\codex-home\\tools\\mcp-toolbox\\bin;${PATH}' },
    },
  ]
  const tools = [{ name: 'mcp-toolbox', dir: 'C:\\codex-home\\tools\\mcp-toolbox', size: 10 }]
  rewriteToolPaths(plan, 'C:\\codex-home', 'D:\\dsh\\codex2dsh\\tools', tools)
  assert.equal(plan[0].command, 'D:\\dsh\\codex2dsh\\tools\\mcp-toolbox\\toolbox.exe')
  assert.equal(plan[0].args[1], 'D:/dsh/codex2dsh/tools/mcp-toolbox/tools.yaml')
  assert.equal(plan[0].env.PATH, 'D:\\dsh\\codex2dsh\\tools\\mcp-toolbox\\bin;${PATH}')
})

test('runMcpMigration：工具目录随迁 + 镜像路径重写 + 原样密钥', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex2dsh-mcptool-'))
  const codexHome = join(root, 'codex-home')
  const toolDir = join(codexHome, 'tools', 'mcp-toolbox')
  mkdirSync(toolDir, { recursive: true })
  writeFileSync(join(toolDir, 'toolbox.exe'), 'MOCK-BINARY', 'utf8')
  writeFileSync(join(toolDir, 'tools.yaml'), 'tools: []\n', 'utf8')
  writeFileSync(join(codexHome, 'config.toml'), [
    '[mcp_servers.toolbox]',
    // TOML 单引号字符串：反斜杠原样
    `command = '${join(toolDir, 'toolbox.exe')}'`,
    `args = ["--config", "${join(toolDir, 'tools.yaml')}", "--password", "S3cret!"]`,
  ].join('\n'), 'utf8')
  const ledger = join(root, 'ledger')
  const toolsTarget = join(root, 'dsh', 'codex2dsh', 'tools')
  const outPath = join(root, 'dsh', 'codex2dsh', 'mcp-mirror.cordis.yml')
  try {
    // dry-run：报告工具将迁移
    const preview = await runMcpMigration({ codexHome, outPath, toolsTarget }, { ledgerDir: ledger })
    assert.ok(preview.items.some((i) => i.kind === 'tool' && i.name === 'mcp-toolbox' && i.status === 'previewed'))
    assert.equal(existsSync(join(toolsTarget, 'mcp-toolbox')), false, '预览不落盘')

    // apply：工具目录复制 + 路径重写 + 密钥原样
    const applied = await runMcpMigration({ codexHome, outPath, toolsTarget, apply: true }, { ledgerDir: ledger })
    assert.ok(applied.items.some((i) => i.kind === 'tool' && i.status === 'migrated'))
    assert.equal(readFileSync(join(toolsTarget, 'mcp-toolbox', 'toolbox.exe'), 'utf8'), 'MOCK-BINARY')
    const mirror = readFileSync(outPath, 'utf8')
    // 镜像中路径为单反斜杠（YAML 单引号原样）
    assert.ok(mirror.includes(join(toolsTarget, 'mcp-toolbox', 'toolbox.exe')))
    assert.ok(!mirror.includes(join(codexHome, 'tools')), '镜像不应再引用 Codex 源路径')
    assert.ok(mirror.includes('S3cret!'), '默认原样迁移密钥')

    // 幂等：工具目录已存在 → skipped
    const again = await runMcpMigration({ codexHome, outPath, toolsTarget, apply: true }, { ledgerDir: ledger })
    assert.ok(again.items.some((i) => i.kind === 'tool' && i.status === 'skipped'))
    // 台账含工具条目
    const ledgerJson = JSON.parse(readFileSync(join(ledger, 'ledger.json'), 'utf8'))
    assert.ok(ledgerJson.some((e) => e.tool === 'migrate_codex_tools'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
