// test/settings.test.mjs —— 配置建议单测（只读；绝不写 settings.yaml）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildConfigSuggestions, sandboxToPreset } from '../lib/settings.mjs'

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex2dsh-cfg-'))
  const home = join(root, 'codex-home')
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.toml'), [
    'model = "deepseek-v4-flash"',
    'model_provider = "custom"',
    'model_reasoning_effort = "max"',
    '',
    '[model_providers.custom]',
    'name = "Hi-Code"',
    'base_url = "http://127.0.0.1:15721/v1"',
    'wire_api = "responses"',
    'experimental_bearer_token = "PROXY_MANAGED"',
    '',
    '[windows]',
    'sandbox = "elevated"',
    '',
    "[projects.'d:\\\\proj\\\\a']",
    'trust_level = "trusted"',
    '',
    '[features]',
    'memories = true',
  ].join('\n'), 'utf8')
  const ledger = join(root, 'ledger')
  const settingsYaml = join(root, 'dsh-home', 'settings.yaml')
  mkdirSync(join(root, 'dsh-home'), { recursive: true })
  writeFileSync(settingsYaml, 'agent-default-model:\n  provider: old\n', 'utf8')
  return { root, home, ledger, settingsYaml, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('sandboxToPreset 映射', () => {
  assert.equal(sandboxToPreset('elevated').preset, 'danger-full-access')
  assert.equal(sandboxToPreset('restricted').preset, 'workspace-write')
  assert.equal(sandboxToPreset('weird').preset, null)
})

test('buildConfigSuggestions 只读返回结构化建议', async () => {
  const fx = makeFixture()
  try {
    const { report, suggestions, yamlText } = await buildConfigSuggestions(fx.home)
    assert.equal(report.ok, true)
    assert.equal(report.previewed, true)
    assert.equal(suggestions.agentDefaultModel.suggested.model, 'deepseek-v4-flash')
    assert.equal(suggestions.agentDefaultModel.suggested.reasoningEffort, 'max')
    assert.equal(suggestions.permission.suggestedPreset, 'danger-full-access')
    assert.equal(suggestions.projects.length, 1)
    assert.ok(yamlText.includes('agent-default-model:'))
    // 绝不修改 settings.yaml
    assert.equal(readFileSync(fx.settingsYaml, 'utf8'), 'agent-default-model:\n  provider: old\n')
    // 建议片段未写盘（未 apply）
    assert.equal(existsSync(join(fx.ledger, 'settings-suggest.yml')), false)
  } finally {
    fx.cleanup()
  }
})

test('buildConfigSuggestions apply 写建议片段 + 台账 + 幂等', async () => {
  const fx = makeFixture()
  try {
    const r1 = await buildConfigSuggestions(fx.home, { apply: true, ledgerDir: fx.ledger })
    assert.equal(r1.report.items.some((i) => i.status === 'migrated' && i.name === 'settings-suggest.yml'), true)
    const out = join(fx.ledger, 'settings-suggest.yml')
    assert.ok(existsSync(out))
    const content = readFileSync(out, 'utf8')
    assert.ok(content.includes('defaultPreset: danger-full-access'))
    // 幂等
    const r2 = await buildConfigSuggestions(fx.home, { apply: true, ledgerDir: fx.ledger })
    assert.equal(r2.report.items.some((i) => i.name === 'settings-suggest.yml' && i.note.includes('跳过')), true)
    // 台账
    const ledger = JSON.parse(readFileSync(join(fx.ledger, 'ledger.json'), 'utf8'))
    assert.ok(ledger.some((e) => e.tool === 'migrate_codex_config'))
    // settings.yaml 依然未被修改
    assert.equal(readFileSync(fx.settingsYaml, 'utf8'), 'agent-default-model:\n  provider: old\n')
  } finally {
    fx.cleanup()
  }
})
