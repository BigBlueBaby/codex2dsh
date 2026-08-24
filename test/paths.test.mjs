// test/paths.test.mjs —— 路径解析单测（含回归：显式参数必须生效，防测试污染真实目录）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { resolveCodexHome, resolveDshHome, resolveAgentsHome, resolveCodex2dshHome, resolveMcpMirrorPath } from '../lib/paths.mjs'

test('resolveCodexHome：显式值优先，其次环境变量，最后默认', () => {
  assert.equal(resolveCodexHome('D:\\explicit'), 'D:\\explicit')
  const old = process.env.CODEX_HOME
  process.env.CODEX_HOME = 'D:\\env-home'
  try {
    assert.equal(resolveCodexHome(), 'D:\\env-home')
    delete process.env.CODEX_HOME
    assert.equal(resolveCodexHome(), join(homedir(), '.codex'))
  } finally {
    if (old === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = old
  }
})

test('回归：resolveAgentsHome 必须接受显式参数（防止写入 ~/.agents 造成污染）', () => {
  assert.equal(resolveAgentsHome('D:\\tmp\\agents'), 'D:\\tmp\\agents')
  const old = process.env.DSH_AGENTS_HOME
  process.env.DSH_AGENTS_HOME = 'D:\\env-agents'
  try {
    assert.equal(resolveAgentsHome(), 'D:\\env-agents')
    // 显式参数仍优先于环境变量
    assert.equal(resolveAgentsHome('D:\\tmp\\agents'), 'D:\\tmp\\agents')
    delete process.env.DSH_AGENTS_HOME
    assert.equal(resolveAgentsHome(), join(homedir(), '.agents'))
  } finally {
    if (old === undefined) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = old
  }
})

test('resolveDshHome / resolveCodex2dshHome / resolveMcpMirrorPath', () => {
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = 'D:\\dsh-home'
  try {
    assert.equal(resolveDshHome(), 'D:\\dsh-home')
    assert.equal(resolveCodex2dshHome(), 'D:\\dsh-home\\codex2dsh')
    assert.equal(resolveMcpMirrorPath(), 'D:\\dsh-home\\codex2dsh\\mcp-mirror.cordis.yml')
    assert.equal(resolveMcpMirrorPath('D:\\out\\x.yml'), 'D:\\out\\x.yml')
  } finally {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
  }
})
