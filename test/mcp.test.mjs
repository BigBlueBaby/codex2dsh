// test/mcp.test.mjs —— MCP 镜像计划 / 渲染 / 幂等单测
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseCodexConfig } from '../lib/config.mjs'
import { isRuntimeServer, buildMcpPlan, renderMcpPlan, decideWrite } from '../lib/mcp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(here, 'fixtures', 'codex-config.sample.toml'), 'utf8')

test('isRuntimeServer 识别运行时服务器（名称/路径/env 特征）', () => {
  assert.equal(isRuntimeServer({ name: 'node_repl', command: '', env: {} }), true)
  assert.equal(isRuntimeServer({ name: 'browser-extra', command: '', env: {} }), true)
  assert.equal(isRuntimeServer({ name: 'my-server', command: 'C:\\...\\Codex\\runtimes\\x\\node_repl.exe', env: {} }), true)
  assert.equal(isRuntimeServer({ name: 'my-server', command: 'npx', env: { CODEX_CLI_PATH: 'C:\\codex.exe' } }), true)
  assert.equal(isRuntimeServer({ name: 'my-server', command: 'npx', env: { PATH: 'D:\\bin' } }), false)
})

test('buildMcpPlan 默认排除运行时并脱敏敏感值', () => {
  const { config } = parseCodexConfig(fixture)
  const { plan, excluded, maskedCount } = buildMcpPlan(config, { excludeRuntime: true })
  assert.ok(excluded.includes('node_repl'), 'node_repl 应被排除')
  const names = plan.map((s) => s.name)
  assert.ok(names.includes('kingbase-demo-db'))
  assert.ok(names.includes('google-mcp-toolbox'))
  assert.ok(maskedCount >= 2, `应至少脱敏 2 处（两个数据库密码），实际 ${maskedCount}`)
  const kb = plan.find((s) => s.name === 'kingbase-demo-db')
  const pwIdx = kb.args.indexOf('--password')
  assert.equal(kb.args[pwIdx + 1], '****')
})

test('excludeRuntime:false 时保留运行时服务器', () => {
  const { config } = parseCodexConfig(fixture)
  const { plan, excluded } = buildMcpPlan(config, { excludeRuntime: false })
  assert.equal(excluded.length, 0)
  assert.ok(plan.some((s) => s.name === 'node_repl'))
})

test('renderMcpPlan 输出可审阅 YAML（含掩码与注释）', () => {
  const { config } = parseCodexConfig(fixture)
  const { plan } = buildMcpPlan(config, { excludeRuntime: true })
  const yaml = renderMcpPlan({ plan, source: 'C:\\fixture\\config.toml', generatedAt: '2026-08-13T00:00:00Z' })
  assert.ok(yaml.includes('- insert:'))
  assert.ok(yaml.includes('id: dsh-mcp-client'))
  assert.ok(yaml.includes('kingbase-demo-db:'))
  assert.ok(yaml.includes('--password: ****') || yaml.includes("'****'"))
  assert.ok(yaml.includes('脱敏'))
  assert.ok(!yaml.includes('node_repl'), '渲染不应包含被排除的运行时服务器')
  assert.ok(!yaml.includes('Example#2023'), '真实示例密码不得出现在输出')
})

test('decideWrite 幂等三态', () => {
  assert.equal(decideWrite('x', null, false), 'write')
  assert.equal(decideWrite('x', 'x', false), 'skip')
  assert.equal(decideWrite('x', 'y', false), 'conflict')
  assert.equal(decideWrite('x', 'y', true), 'write')
})
