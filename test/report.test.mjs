// test/report.test.mjs —— 脱敏 / 指纹 / 报告结构单测
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sha256, maskArgs, maskEnv, isSecretKey, makeReport } from '../lib/report.mjs'

test('sha256 输出小写 hex 且稳定', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256('abc'), sha256('abc'))
})

test('isSecretKey 命中常见敏感键名', () => {
  for (const k of ['password', '--password', 'api_key', 'API_KEY=', 'token', 'bearer_token', 'secret']) {
    assert.equal(isSecretKey(k), true, `应命中: ${k}`)
  }
  for (const k of ['host', 'port', 'user', 'database', '--type', 'PATH']) {
    assert.equal(isSecretKey(k), false, `不应命中: ${k}`)
  }
})

test('maskArgs 覆盖 --flag=value / --flag value / KEY=value 三种形态', () => {
  const { args, maskedCount } = maskArgs([
    '--password=SuperSecret123',
    '--user', 'system',
    '--token', 'tok_abc',
    'API_KEY=sk-xyz',
    '--host', '192.168.10.99',
  ])
  assert.equal(maskedCount, 3)
  assert.deepEqual(args, [
    '--password=****',
    '--user', 'system',
    '--token', '****',
    'API_KEY=****',
    '--host', '192.168.10.99',
  ])
})

test('maskArgs 保留 ${VAR} 变量引用与占位符', () => {
  const { args, maskedCount } = maskArgs(['--password=${DB_PASSWORD}', '--token=PROXY_MANAGED'])
  assert.equal(maskedCount, 0)
  assert.deepEqual(args, ['--password=${DB_PASSWORD}', '--token=PROXY_MANAGED'])
})

test('maskEnv 对敏感键值脱敏，普通键保留', () => {
  const { env, maskedCount } = maskEnv({ PATH: 'D:\\bin;${PATH}', ORACLE_PASSWORD: 'p@ss', ORACLE_HOME: 'D:\\oracle' })
  assert.equal(maskedCount, 1)
  assert.equal(env.PATH, 'D:\\bin;${PATH}')
  assert.equal(env.ORACLE_PASSWORD, '****')
  assert.equal(env.ORACLE_HOME, 'D:\\oracle')
})

test('makeReport 汇总计数正确（warnings 建议性，不翻转 ok）', () => {
  const r = makeReport({
    items: [
      { kind: 'mcp', name: 'a', status: 'generated' },
      { kind: 'skill', name: 'b', status: 'migrated' },
      { kind: 'skill', name: 'c', status: 'skipped' },
    ],
    warnings: ['w1'],
    previewed: true,
    ledgerPath: '/tmp/ledger',
  })
  assert.equal(r.summary.migrated, 2)
  assert.equal(r.summary.skipped, 1)
  assert.equal(r.summary.warnings, 1)
  assert.equal(r.previewed, true)
  assert.equal(r.ok, true) // 有警告仍视为成功（ok 仅由显式 false 翻转）

  const failed = makeReport({ ok: false, warnings: ['x'] })
  assert.equal(failed.ok, false)
})
