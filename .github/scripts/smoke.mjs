// .github/scripts/smoke.mjs —— L3 集成冒烟（REQ-16）
//
// 用临时 CODEX_HOME / DSH_HOME / DSH_AGENTS_HOME 环境变量跑通全部 10 个工具
// （fake ctx），断言产物落盘且零错误；绝不触碰真实用户目录。
// 运行：node .github/scripts/smoke.mjs（CI 与本地均可）

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'codex2dsh-smoke-'))
let failures = 0

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✔ ${name}`)
  } else {
    failures++
    console.error(`  ✖ ${name} ${detail}`)
  }
}

// ── 搭建临时 Codex 家目录（脱敏夹具结构）──────────────────────────
const codexHome = join(root, 'codex-home')
mkdirSync(join(codexHome, 'skills', 'demo-skill'), { recursive: true })
mkdirSync(join(codexHome, 'sessions', '2026', '08', '13'), { recursive: true })
mkdirSync(join(codexHome, 'memories'), { recursive: true })
writeFileSync(join(codexHome, 'config.toml'), [
  'model = "demo-model"',
  'model_provider = "custom"',
  '',
  '[model_providers.custom]',
  'name = "Demo"',
  'base_url = "http://127.0.0.1:15721/v1"',
  '',
  '[mcp_servers.demo-db]',
  'command = "npx"',
  'args = ["demo-mcp", "--password", "Example#2023"]',
  '',
  '[mcp_servers.node_repl]',
  'command = "C:\\\\Codex\\\\runtimes\\\\x\\\\node_repl.exe"',
  '',
  '[windows]',
  'sandbox = "elevated"',
  '',
  '[features]',
  'memories = true',
].join('\n'), 'utf8')
writeFileSync(join(codexHome, 'skills', 'demo-skill', 'SKILL.md'),
  '---\nname: demo-skill\ndescription: 演示。\n---\n\n正文。\n', 'utf8')
writeFileSync(join(codexHome, 'AGENTS.md'), '# 全局规则\n', 'utf8')
writeFileSync(join(codexHome, 'memories', 'note.md'), '# 记忆\n', 'utf8')
writeFileSync(join(codexHome, 'sessions', '2026', '08', '13', 'rollout-20260813-000001-a.jsonl'), '{"type":"response_item"}\n', 'utf8')
writeFileSync(join(codexHome, 'auth.json'), '{"tokens":"x"}\n', 'utf8')

// ── 临时 DSH/AGENTS 家目录 + 环境变量（默认路径解析走 env）────────
const dshHome = join(root, 'dsh-home')
const agentsHome = join(root, 'agents')
process.env.CODEX_HOME = codexHome
process.env.DSH_HOME = dshHome
process.env.DSH_AGENTS_HOME = agentsHome

const { registerTools } = await import('../../lib/tools.mjs')
const registered = []
const ctx = { tools: { register: (t) => registered.push(t), get: (n) => registered.find((t) => t.name === n) } }
registerTools(ctx, join(dshHome, 'codex2dsh'))
const tool = (name) => registered.find((t) => t.name === name)

console.log('=== L3 冒烟：全工具链（临时环境） ===')

// 1) preview
const preview = await tool('migrate_codex_preview').execute({})
check('preview ok', preview.ok === true && preview.previewed === true)
check('preview 含 secret 报告', preview.items.some((i) => i.kind === 'secret' && i.name === 'auth.json'))

// 2) mcp apply
const mcp = await tool('migrate_codex_mcp').execute({ apply: true })
check('mcp 镜像生成', mcp.ok === true && mcp.items.some((i) => i.name === 'demo-db'))
const mirror = readFileSync(join(dshHome, 'codex2dsh', 'mcp-mirror.cordis.yml'), 'utf8')
check('mcp 镜像原样迁移密钥', mirror.includes('Example#2023'))
check('mcp 镜像排除运行时', !mirror.includes('node_repl'))
// maskSecrets:true → 脱敏
await tool('migrate_codex_mcp').execute({ apply: true, maskSecrets: true, force: true })
const maskedMirror = readFileSync(join(dshHome, 'codex2dsh', 'mcp-mirror.cordis.yml'), 'utf8')
check('maskSecrets 脱敏生效', maskedMirror.includes('****') && !maskedMirror.includes('Example#2023'))

// 3) skills apply
const skills = await tool('migrate_codex_skills').execute({ apply: true })
check('技能落盘', skills.ok === true && readFileSync(join(agentsHome, 'skills', 'demo-skill', 'SKILL.md'), 'utf8').includes('kind: dsh'))

// 4) instructions apply
const instr = await tool('migrate_codex_instructions').execute({ apply: true })
check('指令落盘', instr.ok === true && readFileSync(join(agentsHome, 'instructions', 'global.md'), 'utf8').includes('<!-- codex2dsh: 来源'))

// 5) memory apply
const mem = await tool('migrate_codex_memory').execute({ apply: true })
check('记忆落盘', mem.ok === true && existsSync(join(dshHome, 'memories', 'codex', 'note.md')))

// 6) config apply
const cfg = await tool('migrate_codex_config').execute({ apply: true })
check('配置建议片段', cfg.ok === true && existsSync(join(dshHome, 'codex2dsh', 'settings-suggest.yml')))
check('配置建议含模型', cfg.suggestions?.agentDefaultModel?.suggested?.model === 'demo-model')

// 7) sessions（无 import_codex → 指引；fake 注册后 → 委托）
const sess1 = await tool('migrate_codex_sessions').execute({})
check('sessions 未装指引', sess1.warnings.some((w) => w.includes('dsh-chat-import')))
ctx.tools.register({ name: 'import_codex', async execute(a) { return { ok: true, sessionIds: ['s1'] } } })
const sess2 = await tool('migrate_codex_sessions').execute({})
check('sessions 委托成功', sess2.items.some((i) => i.status === 'delegated'))

// 8) doctor
const doc = await tool('codex2dsh_doctor').execute({})
check('doctor 体检', doc.ok === true && doc.items.some((i) => i.kind === 'secret'))

// 8.5) fix_titles（fake ctx 无 sessionPersistence → 指引且不抛错）
const fix = await tool('codex2dsh_fix_titles').execute({})
check('fix_titles host 外指引', fix.ok === false && fix.warnings.some((w) => w.includes('sessionPersistence')))

// 8.6) regroup_sessions（fake ctx 无 sessionPersistence → 指引且不抛错）
const regroup = await tool('codex2dsh_regroup_sessions').execute({})
check('regroup_sessions host 外指引', regroup.ok === false && regroup.warnings.some((w) => w.includes('sessionPersistence')))

// 9) ledger
const ledger = await tool('codex2dsh_ledger').execute({})
check('台账存在', ledger.ok === true && Array.isArray(ledger.entries) && ledger.entries.length >= 4)

// 10) 幂等复跑（与上一次写盘相同参数：maskSecrets:true）
const mcp2 = await tool('migrate_codex_mcp').execute({ apply: true, maskSecrets: true })
check('mcp 幂等', mcp2.items.every((i) => i.status !== 'generated') || mcp2.warnings.some((w) => w.includes('跳过')))

// 11) 真实目录未被触碰（~/.agents 不应出现 smoke 产物）
const realAgents = join(process.env.USERPROFILE || process.env.HOME, '.agents')
if (existsSync(realAgents)) {
  const realSkill = join(realAgents, 'skills', 'demo-skill')
  check('真实 ~/.agents 无 smoke 产物', !existsSync(realSkill))
} else {
  check('真实 ~/.agents 无 smoke 产物', true)
}

rmSync(root, { recursive: true, force: true })

if (failures) {
  console.error(`\n冒烟失败：${failures} 项未通过`)
  process.exit(1)
}
console.log('\n冒烟通过：全工具链在临时环境验证成功，未触碰真实目录。')
