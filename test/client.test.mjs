// test/client.test.mjs —— client/index.js 加载与注册契约测试
//
// 用 vm 模拟浏览器环境（window.__ModuleLoader__ + require('react') stub），
// 验证：factory 可加载、导出 { name, inject, apply }、apply 注册
// settings.plugins.tab（settingsScope 缺席时优雅跳过）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(here, '..', 'client', 'index.js'), 'utf8')

/** 加载 client factory，返回 { id, mod } */
function loadClient() {
  let captured = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          captured = entry
        },
      },
    },
    document: {},
    fetch: async () => ({ json: async () => ({}) }),
    confirm: () => true,
    console,
    require: (name) => {
      if (name === 'react') {
        return {
          useState: () => [undefined, () => {}],
          useEffect: () => {},
          useCallback: (f) => f,
          createElement: () => ({}),
        }
      }
      throw new Error(`unexpected require: ${name}`)
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(clientSrc, sandbox, { filename: 'client/index.js' })
  assert.ok(captured, '__ModuleLoader__.load 应被调用')
  const mod = captured.factory((name) => sandbox.require(name))
  return { id: captured.id, mod }
}

test('client factory 导出插件契约', () => {
  const { id, mod } = loadClient()
  assert.equal(id, 'codex2dsh')
  assert.equal(mod.name, 'codex2dsh')
  // vm realm 数组原型不同，deepEqual 也做原型检查 → 用 JSON 逐值比较
  assert.equal(JSON.stringify(mod.inject), JSON.stringify(['slots', 'locale']))
  assert.equal(typeof mod.apply, 'function')
})

test('apply 注册 settings.plugins.tab（settingsScope 存在时）', () => {
  const { mod } = loadClient()
  const injected = []
  const registered = []
  const effects = []
  const ctx = {
    get: (key) => {
      if (key === 'locale') return { register: () => {}, bind: () => (k) => k }
      if (key === 'settingsScope') return { bind: () => ({ namespace: 'codex2dsh' }) }
      return undefined
    },
    effect: (fn) => effects.push(fn),
    slots: {
      inject: (slot, cb) => injected.push({ slot, cb }),
      register: (meta, render) => {
        registered.push({ meta, render })
        return () => {}
      },
    },
  }
  mod.apply(ctx)
  // locale 字典注册
  assert.equal(effects.length, 1)
  // settings.plugins.tab 注入
  const tab = injected.find((i) => i.slot === 'settings.plugins.tab')
  assert.ok(tab, '应注入 settings.plugins.tab')
  const disposer = tab.cb()
  assert.equal(typeof disposer, 'function')
  assert.equal(registered.length, 1)
  assert.equal(registered[0].meta.name, 'settings.plugins.tab')
  assert.equal(registered[0].meta.id, 'codex2dsh')
  assert.equal(typeof registered[0].meta.label, 'function')
})

test('apply 在 settingsScope 缺席时优雅跳过（不抛错）', () => {
  const { mod } = loadClient()
  const injected = []
  const ctx = {
    get: () => undefined,
    effect: () => {},
    slots: {
      inject: (slot, cb) => injected.push({ slot, cb }),
      register: () => () => {},
    },
  }
  mod.apply(ctx)
  const tab = injected.find((i) => i.slot === 'settings.plugins.tab')
  assert.ok(tab)
  const result = tab.cb() // settingsScope 缺失 → undefined
  assert.equal(result, undefined)
})
