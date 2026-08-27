// test/verify.test.mjs —— 迁移可调用性验证单测（lib/verify.mjs）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readMirrorServersDetail, scanProfileMcpMerge, verifyMigration, scanProfilePluginDuplicates,
} from '../lib/verify.mjs'
import { readMirrorServerNames } from '../lib/mcp.mjs'
import { adaptCodexReferences, dshMcpServers } from '../lib/instructions.mjs'

function makeRoot(prefix = 'codex2dsh-verify-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

// 与 renderMcpPlan 输出同构的 mirror 片段（每台服务器一个 dsh-mcp-client entry）
function makeMirror(dshHome) {
  const t = join(dshHome, 'codex2dsh', 'tools', 'mcp-toolbox')
  const exe = join(t, 'toolbox.exe')
  const yaml = join(t, 'tools.yaml')
  return [
    '- insert:',
    '    - id: mcp-google-mcp-toolbox',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: google-mcp-toolbox',
    '        transport: stdio',
    `        command: '${exe}'`,
    '        args:',
    '          - --config',
    `          - '${yaml}'`,
    '          - --stdio',
    '    - id: mcp-figma',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: figma',
    '        transport: streamable-http',
    '        url: http://127.0.0.1:9000/mcp',
  ].join('\n')
}

function writeMirror(root) {
  const dsh = join(root, 'dsh-home')
  const dir = join(dsh, 'codex2dsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'mcp-mirror.cordis.yml'), makeMirror(dsh), 'utf8')
  return dsh
}

test('readMirrorServerNames：提取服务器名（stdio + http）', () => {
  const fx = makeRoot()
  try {
    const dsh = writeMirror(fx.root)
    assert.deepEqual(readMirrorServerNames(join(dsh, 'codex2dsh', 'mcp-mirror.cordis.yml')), ['google-mcp-toolbox', 'figma'])
    assert.deepEqual(readMirrorServerNames(join(dsh, 'nope.yml')), [])
  } finally {
    fx.cleanup()
  }
})

test('readMirrorServersDetail：command 与 --config 路径提取', () => {
  const fx = makeRoot()
  try {
    const dsh = writeMirror(fx.root)
    const details = readMirrorServersDetail(join(dsh, 'codex2dsh', 'mcp-mirror.cordis.yml'))
    const g = details.find((s) => s.name === 'google-mcp-toolbox')
    assert.ok(g)
    assert.equal(g.command, join(dsh, 'codex2dsh', 'tools', 'mcp-toolbox', 'toolbox.exe'))
    assert.equal(g.configPath, join(dsh, 'codex2dsh', 'tools', 'mcp-toolbox', 'tools.yaml'))
    const f = details.find((s) => s.name === 'figma')
    assert.equal(f.transport, 'streamable-http')
  } finally {
    fx.cleanup()
  }
})

test('scanProfileMcpMerge：识别已合并/未合并 profile', () => {
  const fx = makeRoot()
  try {
    const dsh = writeMirror(fx.root)
    // web：已合并（含 insert + dsh-mcp-client）
    mkdirSync(join(dsh, 'profiles', 'web'), { recursive: true })
    writeFileSync(join(dsh, 'profiles', 'web', 'cordis.patch.yml'), [
      '- insert:',
      '    id: dsh-mcp-client',
      "    name: '@deepseek-ai/dsh-mcp-client'",
    ].join('\n'), 'utf8')
    // desktop：空 patch
    mkdirSync(join(dsh, 'profiles', 'desktop'), { recursive: true })
    writeFileSync(join(dsh, 'profiles', 'desktop', 'cordis.patch.yml'), '[]\n', 'utf8')
    const out = scanProfileMcpMerge(dsh)
    const web = out.find((p) => p.profile === 'web')
    const desktop = out.find((p) => p.profile === 'desktop')
    assert.equal(web.merged, true)
    assert.equal(desktop.merged, false)
    assert.equal(desktop.empty, true)
  } finally {
    fx.cleanup()
  }
})

test('verifyMigration：全链路（工具就位/未合并/引用失效）', async () => {
  const fx = makeRoot()
  try {
    const dsh = writeMirror(fx.root)
    // 工具目录就位
    mkdirSync(join(dsh, 'codex2dsh', 'tools', 'mcp-toolbox'), { recursive: true })
    writeFileSync(join(dsh, 'codex2dsh', 'tools', 'mcp-toolbox', 'toolbox.exe'), 'x', 'utf8')
    writeFileSync(join(dsh, 'codex2dsh', 'tools', 'mcp-toolbox', 'tools.yaml'), 'x', 'utf8')
    // profile 未合并
    mkdirSync(join(dsh, 'profiles', 'web'), { recursive: true })
    writeFileSync(join(dsh, 'profiles', 'web', 'cordis.patch.yml'), '[]\n', 'utf8')
    // AGENTS.md 带失效引用（figma 未配置）与有效引用（google-mcp-toolbox 已配置）
    writeFileSync(join(dsh, 'AGENTS.md'), [
      '数据库查询使用 `mcp__google_mcp_toolbox__execute_sql_dsj`。',
      'Figma 使用 `figma_developer` MCP。',
      '配置在 `C:\\Users\\x\\.codex\\tools\\mcp-toolbox\\tools.yaml`。',
    ].join('\n'), 'utf8')
    // codex home 对应路径（用于路径改写检测）
    const codexHome = join(fx.root, 'codex-home')
    mkdirSync(codexHome, { recursive: true })

    const r = await verifyMigration(codexHome, dsh)
    assert.equal(r.ok, true)
    // profile 未合并 → 警告
    assert.ok(r.warnings.some((w) => w.includes('未合并') || w.includes('未加载')))
    // 工具存在 → migrated
    const toolItem = r.items.find((i) => i.kind === 'tool' && i.name === 'google-mcp-toolbox')
    assert.equal(toolItem.status, 'migrated')
    // figma 引用失效 → 警告
    assert.ok(r.warnings.some((w) => w.includes('figma_developer')))
    // 残留 codex 路径 → 警告（适配遗漏）
    assert.ok(r.warnings.some((w) => w.includes('工具路径未改写')))
  } finally {
    fx.cleanup()
  }
})

test('verifyMigration：工具缺失 → invalid + 警告', async () => {
  const fx = makeRoot()
  try {
    const dsh = writeMirror(fx.root) // 不建工具目录
    const codexHome = join(fx.root, 'codex-home')
    mkdirSync(codexHome, { recursive: true })
    const r = await verifyMigration(codexHome, dsh)
    const toolItem = r.items.find((i) => i.kind === 'tool' && i.name === 'google-mcp-toolbox')
    assert.equal(toolItem.status, 'invalid')
    assert.ok(r.warnings.some((w) => w.includes('启动命令不存在')))
    // http 服务器不检查命令
    const figmaItem = r.items.find((i) => i.kind === 'tool' && i.name === 'figma')
    assert.equal(figmaItem.status, 'migrated')
  } finally {
    fx.cleanup()
  }
})

test('adaptCodexReferences：工具路径改写 + MCP 引用校验', () => {
  const fx = makeRoot()
  try {
    const codexHome = 'C:\\Users\\ichin\\.codex' // 与文本中的路径一致（纯文本适配，不 stat 文件）
    const dshHome = join(fx.root, 'dsh-home')
    const text = [
      '配置在 `C:\\Users\\ichin\\.codex\\tools\\mcp-toolbox\\tools.yaml`。',
      '正斜杠：`C:/Users/ichin/.codex/tools/mcp-toolbox/tools.yaml`。',
      '波浪线：`~/.codex/tools/mcp-toolbox/tools.yaml`。',
      '数据库用 `mcp__google_mcp_toolbox__execute_sql_dsj`。',
      'Figma 用 `figma_developer` MCP。',
    ].join('\n')
    const r = adaptCodexReferences(text, { codexHome, dshHome, mcpServers: ['google-mcp-toolbox'] })
    // 三处路径全部改写（反斜杠/正斜杠/波浪线）
    const expected = join(dshHome, 'codex2dsh', 'tools', 'mcp-toolbox', 'tools.yaml')
    assert.ok(r.adapted.includes(expected), '反斜杠路径改写')
    assert.ok(r.adapted.includes(expected.replace(/\\/g, '/')), '正斜杠路径改写')
    assert.ok(r.adapted.includes(expected.replace(/\\/g, '/')), '波浪线路径改写')
    assert.ok(!r.adapted.includes('.codex\\tools'), '不再残留 codex tools 路径')
    // 3 处路径改写 + 1 处 MCP 前缀归一（mcp__google_mcp_toolbox__ → mcp__google-mcp-toolbox__）
    assert.equal(r.changes.filter((c) => c.kind === 'tool-path').length, 3)
    assert.ok(r.changes.some((c) => c.kind === 'mcp-prefix' && c.from === 'mcp__google_mcp_toolbox__' && c.to === 'mcp__google-mcp-toolbox__'))
    assert.ok(r.adapted.includes('mcp__google-mcp-toolbox__execute_sql_dsj'), '前缀改写为连字符形态')
    // google-mcp-toolbox 已配置 → 无警告；figma_developer 未配置 → 警告
    assert.ok(!r.warnings.some((w) => w.includes('google-mcp-toolbox')))
    assert.ok(r.warnings.some((w) => w.includes('figma_developer')))
  } finally {
    fx.cleanup()
  }
})

test('dshMcpServers：从 dshHome 读取 mirror 服务器集合', () => {
  const fx = makeRoot()
  try {
    const dsh = writeMirror(fx.root)
    assert.deepEqual(dshMcpServers(dsh), ['google-mcp-toolbox', 'figma'])
    assert.deepEqual(dshMcpServers(join(fx.root, 'empty')), [])
  } finally {
    fx.cleanup()
  }
})

test('scanProfilePluginDuplicates：手动 insert 与 bundles 包重复加载检测', () => {
  const fx = makeRoot()
  try {
    const dsh = join(fx.root, 'dsh-home')
    const web = join(dsh, 'profiles', 'web')
    // profile package.json：bundles 含 dsh-mnemon（自动组合）
    mkdirSync(join(web, 'node_modules', 'dsh-mnemon'), { recursive: true })
    writeFileSync(join(web, 'package.json'), JSON.stringify({
      name: 'web-profile', version: '1.0.0',
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-mnemon'] } },
    }, null, 2), 'utf8')
    // 包声明 dsh.bundle.patch
    writeFileSync(join(web, 'node_modules', 'dsh-mnemon', 'package.json'), JSON.stringify({
      name: 'dsh-mnemon', version: '0.3.2', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, null, 2), 'utf8')
    writeFileSync(join(web, 'node_modules', 'dsh-mnemon', 'cordis.patch.yml'), '- insert:\n    - id: mnemon\n      name: dsh-mnemon\n', 'utf8')
    // 手动 patch：重复的 mnemon insert（模拟 dsh-mnemon 双加载事故）
    writeFileSync(join(web, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: mcp-x',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '- insert:',
      '    - id: mnemon',
      '      name: dsh-mnemon',
    ].join('\n'), 'utf8')

    const dupes = scanProfilePluginDuplicates(dsh, 'web')
    assert.equal(dupes.length, 1, '应检测到 mnemon 重复加载')
    assert.equal(dupes[0].id, 'mnemon')
    assert.equal(dupes[0].bundle, 'dsh-mnemon')
    assert.ok(dupes[0].note.includes('duplicate loader entry'), '提示包含 duplicate loader entry')

    // 修复后（移除手动 mnemon 行）→ 无重复
    writeFileSync(join(web, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: mcp-x',
      "      name: '@deepseek-ai/dsh-mcp-client'",
    ].join('\n'), 'utf8')
    assert.equal(scanProfilePluginDuplicates(dsh, 'web').length, 0)

    // 无 bundles / 无 patch → 无重复
    assert.deepEqual(scanProfilePluginDuplicates(dsh, 'nope'), [])
    assert.deepEqual(scanProfilePluginDuplicates(join(fx.root, 'empty'), 'web'), [])
  } finally {
    fx.cleanup()
  }
})

test('verifyMigration：重复加载纳入警告', async () => {
  const fx = makeRoot()
  try {
    const dsh = join(fx.root, 'dsh-home')
    const web = join(dsh, 'profiles', 'web')
    mkdirSync(join(web, 'node_modules', 'dsh-mnemon'), { recursive: true })
    writeFileSync(join(web, 'package.json'), JSON.stringify({
      name: 'web-profile', version: '1.0.0',
      dsh: { profile: { bundles: ['dsh-mnemon'] } },
    }, null, 2), 'utf8')
    writeFileSync(join(web, 'node_modules', 'dsh-mnemon', 'package.json'), JSON.stringify({
      name: 'dsh-mnemon', version: '0.3.2', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, null, 2), 'utf8')
    writeFileSync(join(web, 'node_modules', 'dsh-mnemon', 'cordis.patch.yml'), '- insert:\n    - id: mnemon\n', 'utf8')
    writeFileSync(join(web, 'cordis.patch.yml'), '- insert:\n    - id: mnemon\n', 'utf8')
    const codexHome = join(fx.root, 'codex-home')
    mkdirSync(codexHome, { recursive: true })
    const r = await verifyMigration(codexHome, dsh)
    assert.ok(r.warnings.some((w) => w.includes('duplicate loader entry') && w.includes('dsh-mnemon')), 'verify 应报告重复加载')
  } finally {
    fx.cleanup()
  }
})
