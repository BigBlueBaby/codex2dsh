// test/yaml.test.mjs —— 极简 YAML 渲染单测
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderYaml, renderScalar } from '../lib/yaml.mjs'

test('renderScalar 引号判定', () => {
  assert.equal(renderScalar('plain'), 'plain')
  assert.equal(renderScalar('true'), "'true'")
  assert.equal(renderScalar('C:\\Users\\a b\\x.exe'), "'C:\\Users\\a b\\x.exe'")
  assert.equal(renderScalar("it's"), '"it\'s"')
})

test('渲染注释与标量', () => {
  const out = renderYaml([
    ['# 头部注释', null],
    ['name', 'plain'],
    ['command', 'C:\\Users\\example\\a b.exe'],
    ['empty', null],
  ])
  assert.ok(out.startsWith('# 头部注释\n'))
  assert.ok(out.includes('name: plain\n'))
  assert.ok(out.includes("command: 'C:\\Users\\example\\a b.exe'\n"))
  assert.ok(out.includes('empty:\n'))
})

test('渲染数组（多行）与空数组', () => {
  const out = renderYaml([
    ['args', ['--stdio', '--config', 'C:\\x y.yaml']],
    ['none', []],
  ])
  assert.ok(out.includes('args:\n  - --stdio\n  - --config\n  - \'C:\\x y.yaml\'\n'))
  assert.ok(out.includes('none: []\n'))
})

test('渲染嵌套对象', () => {
  const out = renderYaml([['env', { PATH: 'D:\\bin;${PATH}', ORACLE_HOME: 'D:\\oracle' }]])
  assert.ok(out.includes('env:\n  PATH: \'D:\\bin;${PATH}\'\n  ORACLE_HOME: \'D:\\oracle\'\n'))
})

test('depth 参数支持手动缩进（- insert 场景）', () => {
  const out = renderYaml([
    ['- insert', null],
    ['- id: dsh-mcp-client', null, 1],
  ])
  assert.ok(out.includes('- insert:\n'))
  assert.ok(out.includes('  - id: dsh-mcp-client:\n'))
})
