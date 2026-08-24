// test/skills.test.mjs —— 技能转换单测（临时目录夹具）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifySkillDir, parseFrontmatter, convertSkillText,
  analyzeSkills, planSkillsMigration, migrateSkills,
} from '../lib/skills.mjs'

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex2dsh-skills-'))
  const src = join(root, 'codex-home', 'skills')
  const dst = join(root, 'agents')
  const ledger = join(root, 'ledger')
  // 合法技能（带 frontmatter）
  mkdirSync(join(src, 'find-skills'), { recursive: true })
  writeFileSync(join(src, 'find-skills', 'SKILL.md'),
    '---\nname: find-skills\ndescription: 检索已安装技能。\n---\n\n# find-skills\n\n正文。\n', 'utf8')
  // 带脚本的技能
  mkdirSync(join(src, 'with-scripts', 'scripts'), { recursive: true })
  writeFileSync(join(src, 'with-scripts', 'SKILL.md'),
    '---\nname: with-scripts\ndescription: 示例脚本技能。\n---\n\n正文。\n', 'utf8')
  writeFileSync(join(src, 'with-scripts', 'scripts', 'run.sh'), '#!/bin/sh\necho hi\n', 'utf8')
  // 缺 frontmatter
  mkdirSync(join(src, 'no-fm'), { recursive: true })
  writeFileSync(join(src, 'no-fm', 'SKILL.md'), '# no-fm\n\n没有任何 frontmatter 的技能。\n', 'utf8')
  // 已带 kind: dsh（幂等跳过）
  mkdirSync(join(src, 'already-dsh'), { recursive: true })
  writeFileSync(join(src, 'already-dsh', 'SKILL.md'),
    '---\nname: already-dsh\ndescription: x\nkind: dsh\nsource: codex\n---\n\n正文。\n', 'utf8')
  // 运行时 / 市场分发
  mkdirSync(join(src, '.system', 'hidden'), { recursive: true })
  writeFileSync(join(src, '.system', 'hidden', 'SKILL.md'), '---\nname: hidden\n---\n', 'utf8')
  mkdirSync(join(src, 'codex-primary-runtime', 'rt'), { recursive: true })
  writeFileSync(join(src, 'codex-primary-runtime', 'rt', 'SKILL.md'), '---\nname: rt\n---\n', 'utf8')
  // 缺 SKILL.md 的目录
  mkdirSync(join(src, 'broken'), { recursive: true })
  return { root, src, dst, ledger, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('classifySkillDir 判定运行时/市场/候选', () => {
  assert.equal(classifySkillDir('.system'), 'runtime')
  assert.equal(classifySkillDir('codex-primary-runtime'), 'runtime')
  assert.equal(classifySkillDir('x-openai-bundled'), 'marketplace')
  assert.equal(classifySkillDir('find-skills'), 'candidate')
})

test('parseFrontmatter 解析键值', () => {
  const { fm, exists } = parseFrontmatter('---\nname: a\ndescription: b c\n---\n\nbody\n')
  assert.equal(exists, true)
  assert.equal(fm.name, 'a')
  assert.equal(fm.description, 'b c')
  assert.equal(parseFrontmatter('no fm').exists, false)
})

test('convertSkillText 追加 kind/source 且正文原样', () => {
  const out = convertSkillText('x', '---\nname: x\ndescription: d\n---\n\n正文。\n')
  assert.ok(out.includes('kind: dsh'))
  assert.ok(out.includes('source: codex'))
  assert.ok(out.includes('\n\n正文。\n'))
  // 源顺序保留：name/description 在前
  assert.ok(out.indexOf('name: x') < out.indexOf('kind: dsh'))
})

test('convertSkillText 幂等：已带 kind: dsh → null', () => {
  assert.equal(convertSkillText('x', '---\nname: x\nkind: dsh\n---\nbody\n'), null)
})

test('convertSkillText 缺 frontmatter：默认 null，fixFrontmatter 补全', () => {
  assert.equal(convertSkillText('no-fm', '# t\n\n说明。\n'), null)
  const out = convertSkillText('no-fm', '# t\n\n说明。\n', { fixFrontmatter: true })
  assert.ok(out.startsWith('---\nname: no-fm\n'))
  assert.ok(out.includes('kind: dsh'))
  assert.ok(out.includes('# t\n\n说明。\n'))
})

test('analyzeSkills 全类别归位', async () => {
  const fx = makeFixture()
  try {
    const entries = await analyzeSkills(fx.src, { agentsHome: fx.dst })
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]))
    assert.equal(byName['.system'].status, 'skipped')
    assert.equal(byName['codex-primary-runtime'].status, 'skipped')
    assert.equal(byName['broken'].status, 'invalid')
    assert.equal(byName['already-dsh'].status, 'skipped')
    assert.equal(byName['no-fm'].status, 'skipped') // 无 fixFrontmatter
    assert.equal(byName['find-skills'].status, 'ok')
    assert.equal(byName['with-scripts'].status, 'ok')
  } finally {
    fx.cleanup()
  }
})

test('migrateSkills：落盘 + frontmatter + scripts + 台账 + 源不变', async () => {
  const fx = makeFixture()
  try {
    const report = await migrateSkills(fx.src, fx.dst, { ledgerDir: fx.ledger })
    const migrated = report.items.filter((i) => i.status === 'migrated')
    assert.equal(migrated.length, 2, 'find-skills + with-scripts')
    // 目标 SKILL.md 内容
    const target = readFileSync(join(fx.dst, 'skills', 'find-skills', 'SKILL.md'), 'utf8')
    assert.ok(target.includes('kind: dsh'))
    assert.ok(target.includes('source: codex'))
    // scripts 随迁
    assert.equal(readFileSync(join(fx.dst, 'skills', 'with-scripts', 'scripts', 'run.sh'), 'utf8'), '#!/bin/sh\necho hi\n')
    // 源未变
    assert.ok(!readFileSync(join(fx.src, 'find-skills', 'SKILL.md'), 'utf8').includes('kind: dsh'))
    // 台账
    const ledger = JSON.parse(readFileSync(join(fx.ledger, 'ledger.json'), 'utf8'))
    assert.ok(ledger.every((e) => e.tool === 'migrate_codex_skills'))
    assert.equal(ledger.length, 2)
  } finally {
    fx.cleanup()
  }
})

test('migrateSkills 幂等：第二次全 skipped', async () => {
  const fx = makeFixture()
  try {
    await migrateSkills(fx.src, fx.dst, { ledgerDir: fx.ledger })
    const again = await migrateSkills(fx.src, fx.dst, { ledgerDir: fx.ledger })
    assert.equal(again.items.filter((i) => i.status === 'migrated').length, 0)
    assert.equal(again.items.filter((i) => i.status === 'skipped' && i.note.includes('幂等')).length, 2)
  } finally {
    fx.cleanup()
  }
})

test('migrateSkills 冲突消歧：目标同名不同内容 → <name>-codex', async () => {
  const fx = makeFixture()
  try {
    mkdirSync(join(fx.dst, 'skills', 'find-skills'), { recursive: true })
    writeFileSync(join(fx.dst, 'skills', 'find-skills', 'SKILL.md'), '---\nname: find-skills\ndescription: 人工版本\n---\n', 'utf8')
    const report = await migrateSkills(fx.src, fx.dst, { ledgerDir: fx.ledger })
    const item = report.items.find((i) => i.name === 'find-skills' && i.status === 'migrated')
    assert.ok(item, '应迁移')
    assert.ok(item.target.includes('find-skills-codex'), `应消歧为 -codex，实际 ${item.target}`)
    assert.ok(item.note.includes('消歧'))
    // 人工版本未被覆盖
    assert.equal(readFileSync(join(fx.dst, 'skills', 'find-skills', 'SKILL.md'), 'utf8').includes('人工版本'), true)
  } finally {
    fx.cleanup()
  }
})

test('migrateSkills force：覆盖同名目标', async () => {
  const fx = makeFixture()
  try {
    mkdirSync(join(fx.dst, 'skills', 'find-skills'), { recursive: true })
    writeFileSync(join(fx.dst, 'skills', 'find-skills', 'SKILL.md'), '旧内容', 'utf8')
    const report = await migrateSkills(fx.src, fx.dst, { ledgerDir: fx.ledger, force: true })
    const item = report.items.find((i) => i.name === 'find-skills' && i.status === 'migrated')
    assert.ok(item.target.endsWith('find-skills\\SKILL.md') || item.target.endsWith('find-skills/SKILL.md'))
    assert.ok(item.note.includes('force'))
    assert.ok(readFileSync(join(fx.dst, 'skills', 'find-skills', 'SKILL.md'), 'utf8').includes('kind: dsh'))
  } finally {
    fx.cleanup()
  }
})

test('planSkillsMigration 零副作用', async () => {
  const fx = makeFixture()
  try {
    const report = await planSkillsMigration(fx.src, { agentsHome: fx.dst })
    assert.equal(report.previewed, true)
    assert.ok(report.items.some((i) => i.status === 'previewed'))
    assert.equal(existsSync(join(fx.dst, 'skills')), false, '预览不得创建任何目录')
  } finally {
    fx.cleanup()
  }
})
