// test/mnemon.test.mjs —— dsh-mnemon 记忆导入单测（lib/memory.mjs 的导入适配）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mnemonEntryContent, parseMemorySummaryForMnemon, trimMnemonEntries,
  renderMnemonDocument, readMnemonRuntime, importMemoryToMnemon,
} from '../lib/memory.mjs'

function makeRoot(prefix = 'codex2dsh-mnemon-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

// 与 Codex memory_summary.md 同构的摘要夹具（章节结构一致）
const SUMMARY = [
  'v1',
  '',
  '## User Profile',
  '用户维护 Windows + PowerShell 下的 Java/Spring 政务系统与 Codex MCP/技能配置。',
  '常见任务包括 Kingbase 只读取证、SQL 补丁、接口性能与业务口径、Maven 本地依赖。',
  '',
  '## User preferences',
  '- 默认简体中文，先给结论，再给可执行 SQL、命令或最小补充。',
  '- 多步骤商密改造先给完整开发文档、接口/表清单和等价 SQL，用户确认后再开发。',
  '- 默认不主动新增测试、编译、构建、打包或跑全项目验证；只做定向静态检查、差异复核和查库取证。',
  '',
  '## General Tips',
  '- Kingbase 空串 NULL 语义：避免 = \'\' / <> \'\'；去空格后非空用 IS NOT NULL AND LENGTH(BTRIM(...)) > 0，并以当次实库验证 [ad-hoc note]。',
  '- XXL-JOB 锁优先用 RedissonClient + RLock.tryLock(...) + isHeldByCurrentThread()/unlock()；不以 RedisTemplate#setIfAbsent 返回值判锁 [ad-hoc note]。',
  '',
  "## What's in Memory",
  '',
  '### D:\\Projects\\gchgz-backend',
  '',
  '#### 2026-08-19',
  '',
  '- sjgx 独立迁移设计与上线就绪: cyberunner-sjgx, writing-plans, XxlJob',
  '  - desc: 继续时先查；cwd=D:\\Projects\\gchgz-backend。',
  '  - learnings: 用户已批准独立 api/biz 重构和运维接口范围；先补可执行计划与受助详情等策略。',
  '',
  '### D:\\Projects\\xmzj-jx-backend',
  '',
  '#### 2026-08-11',
  '',
  '- WorkProj 批量查询: list_id 每批最大 1000。',
  '  - desc: 性能判断按 endpoint phase 计时。',
  '  - learnings: 广候选列表和固定汇总可能比少量末端查询更慢。',
].join('\n')

test('mnemonEntryContent：空白折叠 + 剔除 §', () => {
  assert.equal(mnemonEntryContent('  a\n   b  c  '), 'a b c')
  assert.equal(mnemonEntryContent('含§分隔'), '含分隔')
  assert.equal(mnemonEntryContent('   '), '')
})

test('parseMemorySummaryForMnemon：章节解析与条目归类', () => {
  const { user, memory } = parseMemorySummaryForMnemon(SUMMARY)
  // user：User Profile 整段（1 条，最前）+ User preferences（3 条）
  assert.equal(user.length, 4)
  assert.ok(user[0].includes('Java/Spring 政务系统'), 'Profile 整段折叠为首条')
  assert.ok(user.some((u) => u.includes('默认简体中文')), 'preferences 归 user')
  // memory：General Tips（2 条）+ What\'s in Memory 标题与 learnings（2 条）
  assert.equal(memory.length, 4)
  assert.ok(memory.some((m) => m.includes('Kingbase 空串 NULL 语义')), 'tips 归 memory')
  assert.ok(memory.some((m) => m.includes('list_id 每批最大 1000')), 'What\'s in Memory 标题归 memory')
  assert.ok(memory.some((m) => m.includes('广候选列表') && m.includes('list_id')), 'learnings 追加进同一条')
  // 空文本安全
  assert.deepEqual(parseMemorySummaryForMnemon(''), { user: [], memory: [] })
})

test('trimMnemonEntries：按投影字节容量裁剪（§ 为 2 字节 UTF-8）', () => {
  const entries = ['a', 'b', 'c']
  // a=1B；a§b=1+2+1=4B；a§b§c=7B
  assert.deepEqual(trimMnemonEntries(entries, 3), ['a'])
  assert.deepEqual(trimMnemonEntries(entries, 4), ['a', 'b'])
  assert.deepEqual(trimMnemonEntries(entries, 7), ['a', 'b', 'c'])
  assert.deepEqual(trimMnemonEntries([], 10), [])
})

test('renderMnemonDocument：frontmatter 与正文（幂等可解析）', () => {
  const record = {
    id: 'abc', title: 't', description: 'd', status: 'active', filename: 'f.md',
    relativePath: 'active/f.md', sourcePaths: ['C:\\x\\y.md'], sessionIds: [],
    createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
    lastAccessedAt: '2026-08-26T00:00:00.000Z', revision: 1, contentHash: 'h',
    sizeBytes: 0, memoryBodyIds: [],
  }
  const md = renderMnemonDocument(record, '正文\n内容')
  assert.ok(md.startsWith('---\nid: \'abc\''))
  assert.ok(md.includes('status: \'active\''))
  assert.ok(md.includes("source_paths:\n  - 'C:\\x\\y.md'"))
  assert.ok(md.endsWith('正文\n内容\n'))
  // 引号转义
  const q = renderMnemonDocument({ ...record, title: "it's" }, 'x')
  assert.ok(q.includes("title: 'it''s'"))
})

test('importMemoryToMnemon：Runtime 提炼 + Documents 导入 + 幂等', async () => {
  const fx = makeRoot()
  try {
    // 源资产（迁移副本布局：<dsh>/memories/codex/）
    const dshHome = join(fx.root, 'dsh-home')
    const srcDir = join(dshHome, 'memories', 'codex')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'memory_summary.md'), SUMMARY, 'utf8')
    writeFileSync(join(srcDir, 'MEMORY.md'), '# 长期记忆\n\n- 事实一\n', 'utf8')
    writeFileSync(join(srcDir, 'raw_memories.md'), 'raw 内容\n', 'utf8')
    process.env.DSH_HOME = dshHome

    const mnemonRoot = join(fx.root, 'mnemon')
    const r = await importMemoryToMnemon({ mnemonRoot })
    assert.equal(r.ok, true)

    // Runtime：memories.json 结构正确（version 1 + entries）
    const runtime = readMnemonRuntime(mnemonRoot)
    assert.equal(runtime.version, 1)
    const users = runtime.entries.filter((e) => e.target === 'user')
    const mems = runtime.entries.filter((e) => e.target === 'memory')
    assert.ok(users.length >= 4, `user 条目 ${users.length}`)
    assert.ok(mems.length >= 4, `memory 条目 ${mems.length}`)
    assert.ok(runtime.entries.every((e) => typeof e.content === 'string' && !e.content.includes('§')))
    assert.ok(runtime.entries.every((e) => typeof e.created_at === 'string' && e.importance === 'normal'))

    // Documents：index.json + active 文件（三份，幂等键 title）
    const index = JSON.parse(readFileSync(join(mnemonRoot, 'documents', 'index.json'), 'utf8'))
    assert.equal(index.version, 1)
    assert.equal(index.documents.length, 3)
    for (const d of index.documents) {
      assert.equal(d.status, 'active')
      assert.ok(existsSync(join(mnemonRoot, 'documents', d.relativePath)), 'active 文件存在: ' + d.relativePath)
      assert.ok(d.contentHash.length === 64, 'sha256 hash')
      assert.ok(d.sizeBytes > 0)
    }
    const memDoc = index.documents.find((d) => d.title === 'codex2dsh-memory-MEMORY')
    assert.ok(memDoc)
    const body = readFileSync(join(mnemonRoot, 'documents', memDoc.relativePath), 'utf8')
    assert.ok(body.includes('# 长期记忆'), '正文保留')

    // 幂等：再跑 → memories 无新增、documents skipped
    const again = await importMemoryToMnemon({ mnemonRoot })
    assert.equal(readMnemonRuntime(mnemonRoot).entries.length, runtime.entries.length)
    assert.ok(again.items.some((i) => i.status === 'skipped' && i.note.includes('已存在')))
    // force：覆盖文档
    writeFileSync(join(srcDir, 'MEMORY.md'), '# 更新版\n', 'utf8')
    const forced = await importMemoryToMnemon({ mnemonRoot, force: true })
    const idx2 = JSON.parse(readFileSync(join(mnemonRoot, 'documents', 'index.json'), 'utf8'))
    const memDoc2 = idx2.documents.find((d) => d.title === 'codex2dsh-memory-MEMORY')
    assert.equal(memDoc2.revision, memDoc.revision + 1, 'force 覆盖后 revision +1')
  } finally {
    delete process.env.DSH_HOME
    fx.cleanup()
  }
})

test('importMemoryToMnemon：无源资产 → ok:false 指引', async () => {
  const fx = makeRoot()
  try {
    // 隔离 DSH_HOME：避免解析到真实 ~/.dsh/memories/codex
    process.env.DSH_HOME = join(fx.root, 'dsh-home-empty')
    const r = await importMemoryToMnemon({ mnemonRoot: join(fx.root, 'mnemon'), codexHome: join(fx.root, 'no-codex') })
    assert.equal(r.ok, false)
    assert.ok(r.warnings.some((w) => w.includes('未找到记忆资产')))
  } finally {
    delete process.env.DSH_HOME
    fx.cleanup()
  }
})
