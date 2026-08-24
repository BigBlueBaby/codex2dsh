// lib/settings.mjs —— 模型 / Provider / 权限 / 项目信任 → 只读建议
//
// 规范见 docs/03-映射规范.md §7：
//   model/model_provider/model_reasoning_effort → agent-default-model 建议
//   [model_providers.*] → settings.yaml provider 建议（凭据脱敏）
//   [windows].sandbox → permission.defaultPreset 建议（语义不完全一致，标注）
//   [projects.*] → 项目级指令挂载建议
//   绝不自动写入 ~/.dsh/settings.yaml；apply 时只生成建议片段文件 settings-suggest.yml。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseCodexConfig } from './config.mjs'
import { appendLedger } from './ledger.mjs'
import { maskEnv, makeReport } from './report.mjs'
import { renderYaml } from './yaml.mjs'

/** 沙箱级别 → 权限预设建议映射（语义近似，标注差异） */
export function sandboxToPreset(sandbox) {
  const map = {
    elevated: { preset: 'danger-full-access', note: '源 [windows].sandbox=elevated 近似 DSH 全权限预设，请按需收敛' },
    restricted: { preset: 'workspace-write', note: '源 [windows].sandbox=restricted 建议使用受限预设，请按需选择' },
  }
  return map[sandbox] ?? { preset: null, note: `源沙箱级别 "${sandbox}" 无直接对应，请按需选择` }
}

/**
 * 构建配置迁移建议（只读；apply 时写建议片段文件）。
 * @param {string} codexHome
 * @param {object} [opts] { outPath?, apply?, ledgerDir? }
 * @returns {Promise<{ report: import('../index.d.ts').Report, suggestions: object, yamlText: string|null }>}
 */
export async function buildConfigSuggestions(codexHome, opts = {}) {
  const configPath = join(codexHome, 'config.toml')
  if (!existsSync(configPath)) {
    return {
      report: makeReport({ ok: false, warnings: [`未找到 ${configPath}`] }),
      suggestions: null,
      yamlText: null,
    }
  }
  const { config } = parseCodexConfig(readFileSync(configPath, 'utf8'))
  const items = []
  const warnings = []
  const suggestions = {}

  // 1) agent-default-model 建议
  if (config.model || config.modelProvider) {
    suggestions.agentDefaultModel = {
      suggested: {
        provider: config.modelProvider ?? '（未知，请在 DSH settings.yaml 中配置 provider）',
        model: config.model ?? '（未知）',
        reasoningEffort: config.modelReasoningEffort ?? undefined,
      },
      note: config.modelProvider && config.modelProviders[config.modelProvider]
        ? `源 provider base_url: ${config.modelProviders[config.modelProvider].base_url ?? '（未声明）'}；DSH 侧请先在 settings.yaml 配置同名 provider 后采用本建议`
        : '源 provider 未声明 base_url，请在 DSH 侧自行配置',
    }
    items.push({
      kind: 'config', name: 'agent-default-model', status: 'generated',
      note: '只读建议（不自动写入 settings.yaml）',
    })
  }

  // 2) provider 建议（凭据脱敏）
  for (const [name, p] of Object.entries(config.modelProviders ?? {})) {
    const maskedEnv = maskEnv({ experimental_bearer_token: p.experimental_bearer_token ?? '', api_key: p.api_key ?? '' })
    const sensitive = Object.values(maskedEnv.env).filter((v) => v === '****')
    suggestions[`provider:${name}`] = {
      name: p.name ?? name,
      baseUrl: p.base_url ?? '',
      wireApi: p.wire_api ?? undefined,
      requiresOpenaiAuth: p.requires_openai_auth ?? undefined,
      ...(sensitive.length ? { maskedSecrets: sensitive.length } : {}),
      note: sensitive.length
        ? '含凭据字段已脱敏（****）：请改用环境变量（如 ${CODEX2DSH_PROVIDER_TOKEN}）后在 DSH settings.yaml 配置'
        : undefined,
    }
    items.push({
      kind: 'config', name: `model_providers.${name}`, status: 'generated',
      secretsMasked: sensitive.length,
      note: sensitive.length ? '凭据已脱敏，建议环境变量化' : '无凭据字段',
    })
  }

  // 3) 权限建议
  const sandbox = config.windows?.sandbox
  if (sandbox) {
    const perm = sandboxToPreset(sandbox)
    suggestions.permission = { suggestedPreset: perm.preset, note: perm.note }
    items.push({ kind: 'config', name: 'permission', status: 'generated', note: perm.note })
  }

  // 4) 项目信任建议
  const trustedProjects = Object.entries(config.projects ?? {}).filter(([, v]) => v.trustLevel)
  if (trustedProjects.length) {
    suggestions.projects = trustedProjects.map(([path, v]) => ({
      path,
      trustLevel: v.trustLevel,
      suggestion: '建议挂载项目级指令资产（AGENTS.md 若有）',
    }))
    items.push({
      kind: 'config', name: 'projects', status: 'generated',
      note: `${trustedProjects.length} 个受信项目 → 项目级指令挂载建议`,
    })
  }

  // 建议片段 YAML（确定性内容，幂等比对稳定）
  const yamlLines = [['# codex2dsh 配置迁移建议（人工审阅后应用到 ~/.dsh/settings.yaml）', null]]
  if (suggestions.agentDefaultModel) {
    yamlLines.push(['agent-default-model', suggestions.agentDefaultModel.suggested])
  }
  if (suggestions.permission) {
    yamlLines.push(['permission', { defaultPreset: suggestions.permission.suggestedPreset }])
  }
  const yamlText = Object.keys(suggestions).length ? renderYaml(yamlLines) : null

  // apply：写建议片段（不写 settings.yaml）
  let target = null
  let decision = 'none'
  if (opts.apply && yamlText) {
    target = opts.outPath || join(opts.ledgerDir || '.', 'settings-suggest.yml')
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (existing === yamlText) decision = 'skip'
    else if (existing !== null && opts.force !== true) decision = 'conflict'
    else {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, yamlText, 'utf8')
      decision = 'write'
      if (opts.ledgerDir) {
        appendLedger(opts.ledgerDir, { tool: 'migrate_codex_config', source: configPath, target, status: 'generated' })
      }
    }
    items.push({
      kind: 'config', name: 'settings-suggest.yml', status: decision === 'write' ? 'migrated' : 'skipped',
      target: existsSync(target) ? target : undefined,
      note: decision === 'write' ? '建议片段已写入，请人工审阅后应用' : decision === 'skip' ? '目标内容相同，已跳过' : '目标已存在且内容不同（用 force:true 覆盖）',
    })
  }

  return {
    report: makeReport({ items, warnings, previewed: opts.apply !== true, ledgerPath: opts.ledgerDir }),
    suggestions,
    yamlText,
  }
}
