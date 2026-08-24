// test/panel.test.mjs —— web 面板路由单测（fake ws / req / res）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerPanelRoutes, parseBody, runPanelAction } from '../lib/panel.mjs'

function makeEnv() {
  const root = mkdtempSync(join(tmpdir(), 'codex2dsh-panel-'))
  const home = join(root, 'codex-home')
  mkdirSync(join(home, 'skills', 'demo-skill'), { recursive: true })
  mkdirSync(join(home, 'sessions', '2026', '08', '13'), { recursive: true })
  writeFileSync(join(home, 'config.toml'), [
    'model = "demo-model"',
    '[mcp_servers.demo-db]',
    'command = "npx"',
    'args = ["demo-mcp", "--password", "Example#2023"]',
    '[mcp_servers.node_repl]',
    'command = "C:\\\\Codex\\\\runtimes\\\\x\\\\node_repl.exe"',
  ].join('\n'), 'utf8')
  writeFileSync(join(home, 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: 演示。\n---\n\n正文。\n', 'utf8')
  writeFileSync(join(home, 'AGENTS.md'), '# 规则\n', 'utf8')
  writeFileSync(join(home, 'sessions', '2026', '08', '13', 'rollout-2026-08-13T00-00-00-x.jsonl'), '{"type":"response_item"}\n', 'utf8')
  writeFileSync(join(home, 'auth.json'), '{"tokens":"x"}\n', 'utf8')
  const ledger = join(root, 'ledger')
  return { root, home, ledger, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** 收集路由的 fake webServer */
function fakeWs() {
  const routes = []
  return { routes, register: (r) => routes.push(r) }
}

/** fake req / res */
function fakeReq(body) {
  return { body: body === undefined ? '' : JSON.stringify(body) }
}
function fakeRes() {
  const out = { status: 0, payload: null }
  return {
    out,
    writeHead(status) { out.status = status },
    end(text) { out.payload = text },
  }
}

function call(ws, path, req) {
  const route = ws.routes.find((r) => r.kind === 'exact' && r.path === path)
  assert.ok(route, `路由不存在: ${path}`)
  const res = fakeRes()
  return route.handler(req, res).then(() => ({ status: res.out.status, payload: JSON.parse(res.out.payload) }))
}

test('parseBody 支持 req.body 与流两种形态', async () => {
  assert.deepEqual(await parseBody(fakeReq({ a: 1 })), { a: 1 })
  const stream = { body: '{"b":2}' }
  assert.deepEqual(await parseBody(stream), { b: 2 })
  assert.deepEqual(await parseBody({ body: 'not json' }), {})
})

test('GET /codex2dsh/status 返回资产 + 台账计数 + 凭据', async () => {
  const env = makeEnv()
  try {
    const ws = fakeWs()
    registerPanelRoutes({}, ws, env.ledger)
    const { status, payload } = await call(ws, '/codex2dsh/status', fakeReq())
    assert.equal(status, 200)
    assert.equal(payload.ok, true)
    assert.ok(payload.assets.some((a) => a.kind === 'mcp'))
    assert.ok(payload.secrets.some((s) => s.name === 'auth.json'))
    assert.equal(payload.ledgerCount, 0)
  } finally {
    env.cleanup()
  }
})

test('POST /codex2dsh/preview 全资产预览（零副作用）', async () => {
  const env = makeEnv()
  try {
    const ws = fakeWs()
    registerPanelRoutes({}, ws, env.ledger)
    const { status, payload } = await call(ws, '/codex2dsh/preview', fakeReq({ codexHome: env.home }))
    assert.equal(status, 200)
    assert.equal(payload.previewed, true)
    assert.ok(payload.items.some((i) => i.kind === 'mcp'))
  } finally {
    env.cleanup()
  }
})

test('POST /codex2dsh/migrate：mcp apply 落盘 + 幂等 + 未知动作', async () => {
  const env = makeEnv()
  try {
    const ws = fakeWs()
    registerPanelRoutes({}, ws, env.ledger)
    const mirrorPath = join(env.ledger, 'mcp-mirror.cordis.yml')
    // apply：写镜像（显式 outPath 指向临时目录，避免触碰真实 $DSH_HOME；默认原样迁移密钥）
    const applied = await call(ws, '/codex2dsh/migrate', fakeReq({ action: 'mcp', codexHome: env.home, apply: true, outPath: mirrorPath }))
    assert.equal(applied.status, 200)
    assert.equal(applied.payload.summary.migrated, 1)
    assert.ok(existsSync(mirrorPath))
    assert.ok(readFileSync(mirrorPath, 'utf8').includes('Example#2023'), '默认原样迁移密钥')
    // 幂等
    const again = await call(ws, '/codex2dsh/migrate', fakeReq({ action: 'mcp', codexHome: env.home, apply: true, outPath: mirrorPath }))
    assert.ok(again.payload.warnings.some((w) => w.includes('跳过')))
    // maskSecrets 透传：脱敏
    const maskedPath = join(env.ledger, 'mcp-masked.yml')
    const masked = await call(ws, '/codex2dsh/migrate', fakeReq({ action: 'mcp', codexHome: env.home, apply: true, outPath: maskedPath, maskSecrets: true }))
    assert.ok(masked.payload.ok)
    assert.ok(!readFileSync(maskedPath, 'utf8').includes('Example#2023'))
    // 选择性迁移：include 只留 demo-db（node_repl 运行时仍排除）
    const selPath = join(env.ledger, 'mcp-sel.yml')
    const sel = await call(ws, '/codex2dsh/migrate', fakeReq({ action: 'mcp', codexHome: env.home, apply: true, outPath: selPath, include: ['demo-db'] }))
    const selContent = readFileSync(selPath, 'utf8')
    assert.ok(selContent.includes('demo-db:'))
    assert.ok(!selContent.includes('node_repl'))
    // 台账
    const ledger = JSON.parse(readFileSync(join(env.ledger, 'ledger.json'), 'utf8'))
    assert.ok(ledger.length >= 2)
    // skills preview
    const skills = await call(ws, '/codex2dsh/migrate', fakeReq({ action: 'skills', codexHome: env.home }))
    assert.equal(skills.payload.previewed, true)
    assert.ok(skills.payload.items.some((i) => i.name === 'demo-skill'))
    // 未知动作
    const bad = await call(ws, '/codex2dsh/migrate', fakeReq({ action: 'nope' }))
    assert.equal(bad.payload.ok, false)
    // 缺 action → 400
    const noAction = await call(ws, '/codex2dsh/migrate', fakeReq({}))
    assert.equal(noAction.status, 400)
  } finally {
    env.cleanup()
  }
})

test('runPanelAction 直接调用（doctor / config / sessions）', async () => {
  const env = makeEnv()
  try {
    const doctor = await runPanelAction('doctor', { codexHome: env.home }, { ledgerDir: env.ledger, ctx: null })
    assert.ok(doctor.items.some((i) => i.kind === 'secret'))
    const cfg = await runPanelAction('config', { codexHome: env.home }, { ledgerDir: env.ledger })
    assert.equal(cfg.suggestions.agentDefaultModel.suggested.model, 'demo-model')
    const sess = await runPanelAction('sessions', { codexHome: env.home }, { ledgerDir: env.ledger, ctx: null })
    assert.ok(sess.warnings.some((w) => w.includes('dsh-chat-import')))
  } finally {
    env.cleanup()
  }
})
