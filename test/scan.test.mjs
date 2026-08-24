// test/scan.test.mjs —— 只读扫描单测（临时 CODEX_HOME 结构）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanCodexHome } from '../lib/scan.mjs'

function makeCodexHome() {
  const root = mkdtempSync(join(tmpdir(), 'codex2dsh-scan-'))
  const home = join(root, 'codex-home')
  mkdirSync(home, { recursive: true })
  // config.toml（最小但覆盖各节）
  writeFileSync(join(home, 'config.toml'), [
    'model = "demo-model"',
    'model_provider = "custom"',
    '',
    '[mcp_servers.demo]',
    'command = "npx"',
    'args = ["demo-mcp", "--password", "Example#2023"]',
    '',
    '[mcp_servers.node_repl]',
    'command = "C:\\\\Codex\\\\runtimes\\\\x\\\\node_repl.exe"',
    '',
    '[projects.\'d:\\demo\\app\']',
    'trust_level = "trusted"',
  ].join('\n'), 'utf8')
  // 技能
  mkdirSync(join(home, 'skills', 'find-skills'), { recursive: true })
  writeFileSync(join(home, 'skills', 'find-skills', 'SKILL.md'), '---\nname: find-skills\ndescription: 示例\n---\n正文\n', 'utf8')
  // 指令
  writeFileSync(join(home, 'AGENTS.md'), '# 全局规则\n', 'utf8')
  // 会话
  mkdirSync(join(home, 'sessions', '2026', '08', '13'), { recursive: true })
  writeFileSync(join(home, 'sessions', '2026', '08', '13', 'rollout-001.jsonl'), '{"type":"response_item"}\n', 'utf8')
  writeFileSync(join(home, 'sessions', '2026', '08', '13', 'rollout-002.jsonl'), '{"type":"response_item"}\n', 'utf8')
  // 敏感文件（只报告）
  writeFileSync(join(home, 'auth.json'), '{"tokens":"REAL"}\n', 'utf8')
  return { home, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('scanCodexHome 输出全部资产类别且零副作用', () => {
  const { home, cleanup } = makeCodexHome()
  try {
    const { items, warnings, sessionCount } = scanCodexHome(home)
    const kinds = items.map((i) => i.kind)
    for (const k of ['config', 'mcp', 'skill', 'instruction', 'session', 'secret']) {
      assert.ok(kinds.includes(k), `应包含 ${k} 类资产`)
    }
    assert.equal(sessionCount, 2)
    const secret = items.find((i) => i.name === 'auth.json')
    assert.equal(secret.status, 'skipped')
    assert.equal(secret.note.includes('不读取'), true)
    assert.equal(warnings.length, 0)
    // 零副作用：auth.json 内容未被读取（扫描只报告存在）
    assert.equal(items.find((i) => i.name === 'auth.json').note.includes('REAL'), false)
  } finally {
    cleanup()
  }
})

test('scanCodexHome 对缺失 config.toml 输出警告', () => {
  const { home, cleanup } = makeCodexHome()
  try {
    rmSync(join(home, 'config.toml'))
    const { warnings } = scanCodexHome(home)
    assert.ok(warnings.some((w) => w.includes('config.toml')))
  } finally {
    cleanup()
  }
})
