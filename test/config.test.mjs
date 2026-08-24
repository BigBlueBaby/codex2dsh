// test/config.test.mjs —— config.toml 轻量解析单测
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseCodexConfig, unquote, parseTomlArray, parseInlineTable } from '../lib/config.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(here, 'fixtures', 'codex-config.sample.toml'), 'utf8')

test('unquote 支持单双引号', () => {
  assert.equal(unquote('"a b"'), 'a b')
  assert.equal(unquote("'c'"), 'c')
  assert.equal(unquote('plain'), 'plain')
})

test('parseTomlArray 支持混用引号', () => {
  assert.deepEqual(parseTomlArray('["a", \'b c\', "d"]'), ['a', 'b c', 'd'])
  assert.equal(parseTomlArray('not-array'), null)
})

test('parseInlineTable 解析 {K="v"}', () => {
  assert.deepEqual(parseInlineTable('{ PATH = \'D:\\bin;${PATH}\', N = "1" }'), { PATH: 'D:\\bin;${PATH}', N: '1' })
})

test('顶层键解析（model / provider / reasoning）', () => {
  const { config } = parseCodexConfig(fixture)
  assert.equal(config.model, 'deepseek-v4-flash')
  assert.equal(config.modelProvider, 'custom')
  assert.equal(config.modelReasoningEffort, 'max')
  assert.equal(config.disableResponseStorage, true)
})

test('mcp_servers 完整字段解析（含 env 子节）', () => {
  const { config } = parseCodexConfig(fixture)
  const oracle = config.mcpServers['oracle-demo-db']
  assert.ok(oracle, 'oracle-demo-db 应存在')
  assert.equal(oracle.type, 'stdio')
  assert.equal(oracle.command, 'npx')
  assert.equal(oracle.startupTimeoutSec, 120)
  assert.ok(oracle.args.includes('--password'))
  assert.equal(oracle.env.PATH, 'D:\\app\\example\\product\\11.2.0\\dbhome_1\\BIN;${PATH}')
  assert.equal(oracle.env.ORACLE_HOME, 'D:\\app\\example\\product\\11.2.0\\dbhome_1')
})

test('运行时服务器与普通服务器并存解析', () => {
  const { config } = parseCodexConfig(fixture)
  assert.ok(config.mcpServers['node_repl'])
  assert.equal(config.mcpServers['node_repl'].env.CODEX_CLI_PATH.includes('codex.exe'), true)
})

test('projects / features / memories / windows 解析', () => {
  const { config } = parseCodexConfig(fixture)
  assert.equal(config.projects['d:\\projects\\demo-backend'].trustLevel, 'trusted')
  assert.equal(config.features.memories, 'true')
  assert.equal(config.memories.use_memories, 'true')
  assert.equal(config.windows.sandbox, 'elevated')
})

test('不解析的节记录到 _otherSections（marketplaces/plugins/desktop）', () => {
  const { config } = parseCodexConfig(fixture)
  assert.ok(config._otherSections.includes('marketplaces.openai-bundled'))
  assert.ok(config._otherSections.includes('plugins.browser@openai-bundled'))
  assert.ok(config._otherSections.includes('desktop'))
})

test('损坏/空输入不抛错', () => {
  const { config, errors } = parseCodexConfig('not toml at all\n= broken')
  assert.ok(Array.isArray(errors))
  assert.deepEqual(config.mcpServers, {})
})
