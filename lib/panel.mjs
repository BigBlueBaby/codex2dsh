// lib/panel.mjs —— web 面板路由（POST/GET /codex2dsh/*）
//
// 供 client/index.js（设置 → 插件 → 「Codex 迁移」Tab）调用；与工具面共享
// lib/* 纯函数（同一套转换/脱敏/幂等逻辑），headless / 无 webServer 的 profile
// 不挂载路由，工具照常可用。路由由 index.mjs 经 ctx.inject(['webServer']) 延后注册。
//
// 路由：
//   GET  /codex2dsh/status   → { ok, codexHome, assets[], ledgerCount, secrets[] }
//   POST /codex2dsh/preview  body { codexHome? } → 全资产预览 Report
//   POST /codex2dsh/migrate  body { action, apply?, codexHome?, agentsHome?, outDir?,
//                                    outPath?, force?, fixFrontmatter?, excludeRuntime?,
//                                    expectedHash?, budget?, restamp? } → Report

import { join } from 'node:path'
import { scanCodexHome } from './scan.mjs'
import { readLedger } from './ledger.mjs'
import { makeReport } from './report.mjs'
import { runMcpMigration } from './mcp.mjs'
import { planSkillsMigration, migrateSkills } from './skills.mjs'
import { planInstructionsMigration, migrateInstructions } from './instructions.mjs'
import { planMemoryMigration, migrateMemory } from './memory.mjs'
import { buildConfigSuggestions } from './settings.mjs'
import { runDoctor } from './doctor.mjs'
import { planSessionsMigration } from './delegate.mjs'
import { planTitleBackfill } from './title.mjs'
import { planRegroup } from './regroup.mjs'
import { resolveCodexHome, resolveAgentsHome, resolveDshHome } from './paths.mjs'

/** 读取请求体：优先 req.body（测试桩友好），否则收集 data 事件流 */
export function readBody(req) {
  return new Promise((resolve) => {
    if (req && typeof req.body === 'string') {
      resolve(req.body)
      return
    }
    let text = ''
    req.on('data', (chunk) => {
      text += chunk
    })
    req.on('end', () => resolve(text))
    req.on('error', () => resolve(text))
  })
}

/** 解析 JSON body（失败返回空对象） */
export async function parseBody(req) {
  const text = await readBody(req)
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/** 统一响应 */
function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

/**
 * 面板动作分发（与工具面同一套 lib 编排）。
 * @param {string} action mcp|skills|instructions|memory|config|sessions|doctor|ledger
 * @param {object} body
 * @param {object} opts { ledgerDir, ctx }
 */
export async function runPanelAction(action, body, opts) {
  const ledgerDir = opts.ledgerDir
  const codexHome = resolveCodexHome(body.codexHome)
  const agentsHome = resolveAgentsHome(body.agentsHome)
  const apply = body.apply === true

  switch (action) {
    case 'mcp':
      return runMcpMigration({
        codexHome: body.codexHome, outPath: body.outPath,
        excludeRuntime: body.excludeRuntime !== false,
        force: body.force === true, expectedHash: body.expectedHash,
        apply,
        maskSecrets: body.maskSecrets === true,
        include: body.include,
        exclude: body.exclude,
        migrateTools: body.migrateTools !== false,
        toolsTarget: body.toolsTarget,
      }, { ledgerDir })
    case 'skills': {
      const skillsDir = join(codexHome, 'skills')
      const { existsSync } = await import('node:fs')
      if (!existsSync(skillsDir)) {
        return makeReport({ ok: false, warnings: [`未找到技能目录 ${skillsDir}`] })
      }
      const sel = { include: body.include, exclude: body.exclude }
      return apply
        ? migrateSkills(skillsDir, agentsHome, { fixFrontmatter: body.fixFrontmatter === true, force: body.force === true, ledgerDir, ...sel })
        : planSkillsMigration(skillsDir, { agentsHome, fixFrontmatter: body.fixFrontmatter === true, ...sel })
    }
    case 'instructions':
      return apply
        ? migrateInstructions(codexHome, body.dshHome || resolveDshHome(), { force: body.force === true, ledgerDir })
        : planInstructionsMigration(codexHome)
    case 'memory': {
      const outDir = body.outDir || join(resolveDshHome(), 'memories', 'codex')
      return apply
        ? migrateMemory(codexHome, outDir, { force: body.force === true, ledgerDir })
        : planMemoryMigration(codexHome)
    }
    case 'config': {
      const { report, suggestions, yamlText } = await buildConfigSuggestions(codexHome, {
        apply, outPath: body.outPath, force: body.force === true, ledgerDir,
      })
      return { ...report, ...(suggestions ? { suggestions } : {}), ...(yamlText && !apply ? { yamlPreview: yamlText } : {}) }
    }
    case 'sessions':
      return planSessionsMigration(codexHome, opts.ctx ?? null, {
        preview: body.preview === true, budget: body.budget, restamp: body.restamp === true, ledgerDir,
      })
    case 'doctor':
      return runDoctor(codexHome, { ledgerDir })
    case 'ledger': {
      const entries = readLedger(ledgerDir)
      return { ok: true, entries: entries.slice(-20), ledgerPath: join(ledgerDir, 'ledger.json') }
    }
    default:
      return makeReport({ ok: false, warnings: [`未知动作：${action}`] })
  }
}

/** 全资产预览（零副作用）：汇总各迁移工具的 preview */
export async function previewAll(body, opts) {
  const codexHome = resolveCodexHome(body.codexHome)
  const agentsHome = resolveAgentsHome(body.agentsHome)
  const items = []
  const warnings = []
  const { items: scanItems, warnings: scanWarnings } = scanCodexHome(codexHome)
  items.push(...scanItems.filter((i) => i.kind !== 'secret' && i.kind !== 'config'))
  warnings.push(...scanWarnings)
  for (const i of scanItems.filter((x) => x.kind === 'secret')) items.push(i)
  return makeReport({ items, warnings, previewed: true, ledgerPath: opts.ledgerDir })
}

/** 构建可勾选清单：{ mcp: string[], skills: string[], tools: string[] } */
export async function buildSelectable(codexHome) {
  const { existsSync, readFileSync } = await import('node:fs')
  const { parseCodexConfig } = await import('./config.mjs')
  const { buildMcpPlan, detectLocalTools } = await import('./mcp.mjs')
  const { analyzeSkills } = await import('./skills.mjs')
  const mcp = []
  const configPath = join(codexHome, 'config.toml')
  if (existsSync(configPath)) {
    const { config } = parseCodexConfig(readFileSync(configPath, 'utf8'))
    const { plan } = buildMcpPlan(config, { excludeRuntime: true })
    mcp.push(...plan.map((s) => s.name))
  }
  const skillsDir = join(codexHome, 'skills')
  const skillEntries = existsSync(skillsDir) ? await analyzeSkills(skillsDir) : []
  const skills = skillEntries.filter((e) => e.status === 'ok').map((e) => e.name)
  // 本地工具（检测全部 MCP 服务器，含被 include 过滤掉的——用未过滤的 plan）
  let tools = []
  if (existsSync(configPath)) {
    const { config } = parseCodexConfig(readFileSync(configPath, 'utf8'))
    const { plan } = buildMcpPlan(config, { excludeRuntime: true })
    tools = detectLocalTools(codexHome, plan).map((t) => t.name)
  }
  return { mcp, skills, tools }
}

/**
 * 注册面板路由（ctx.inject(['webServer']) 延后调用）。
 * @param {object} ctx apply 的外层 ctx
 * @param {object} ws webServer 服务
 * @param {string} ledgerDir 台账目录
 */
export function registerPanelRoutes(ctx, ws, ledgerDir) {
  // 状态总览：资产清单 + 台账计数 + 凭据文件 + 可勾选清单
  ws.register({
    kind: 'exact',
    path: '/codex2dsh/status',
    handler: async (_req, res) => {
      try {
        const codexHome = resolveCodexHome()
        const { items } = scanCodexHome(codexHome)
        const ledger = readLedger(ledgerDir)
        const byTool = {}
        for (const e of ledger) byTool[e.tool] = (byTool[e.tool] ?? 0) + 1
        // 可勾选清单：MCP 服务器名（已排除运行时）、技能候选名、本地工具名
        const selectable = await buildSelectable(codexHome)
        json(res, 200, {
          ok: true,
          codexHome,
          assets: items,
          ledgerCount: ledger.length,
          byTool,
          secrets: items.filter((i) => i.kind === 'secret'),
          selectable,
        })
      } catch (err) {
        json(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  })

  // 全资产预览（零副作用）
  ws.register({
    kind: 'exact',
    path: '/codex2dsh/preview',
    handler: async (req, res) => {
      try {
        const body = await parseBody(req)
        const report = await previewAll(body, { ledgerDir })
        json(res, 200, report)
      } catch (err) {
        json(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  })

  // 迁移动作（preview 或 apply）
  ws.register({
    kind: 'exact',
    path: '/codex2dsh/migrate',
    handler: async (req, res) => {
      try {
        const body = await parseBody(req)
        const action = typeof body.action === 'string' ? body.action : ''
        if (!action) {
          json(res, 400, { ok: false, error: '缺少 action' })
          return
        }
        const report = await runPanelAction(action, body, { ledgerDir, ctx })
        json(res, 200, report)
      } catch (err) {
        json(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  })

  // 标题回填：已导入 Codex 会话补 session/title 事件（默认 dry-run 预览）
  ws.register({
    kind: 'exact',
    path: '/codex2dsh/backfill-titles',
    handler: async (req, res) => {
      try {
        const body = await parseBody(req)
        const codexHome = resolveCodexHome(body.codexHome)
        const report = await planTitleBackfill(ctx, {
          codexHome,
          sessionIds: Array.isArray(body.sessionIds) ? body.sessionIds : null,
          dryRun: body.apply !== true,
        })
        json(res, 200, report)
      } catch (err) {
        json(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  })

  // 工作区归组：非工作区会话统一归到一个 DSH 工作区（默认 dry-run）
  ws.register({
    kind: 'exact',
    path: '/codex2dsh/regroup',
    handler: async (req, res) => {
      try {
        const body = await parseBody(req)
        const report = await planRegroup(ctx, {
          codexHome: resolveCodexHome(body.codexHome),
          regroupDir: typeof body.regroupDir === 'string' && body.regroupDir ? body.regroupDir : undefined,
          dryRun: body.apply !== true,
        })
        json(res, 200, report)
      } catch (err) {
        json(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  })
}
