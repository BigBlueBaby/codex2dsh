// lib/report.mjs —— 统一报告结构 / 密钥脱敏 / 文件指纹
//
// 报告结构约定见 docs/03-映射规范.md §10；脱敏规则见 docs/09-安全边界.md §2。

import { createHash } from 'node:crypto'

/** 计算文件/文本 SHA-256（小写 hex）；入参 Buffer 或 string */
export function sha256(input) {
  return createHash('sha256').update(input).digest('hex')
}

// 触发词：键名/参数旗标中命中即视为敏感（大小写不敏感）
const SECRET_KEY_RE =
  /(?:^|[^a-z0-9])?(?:password|passwd|pwd|token|secret|api[_-]?key|bearer|credential|authorization|cookie)(?:$|[^a-z0-9])/i

// 值形态：flag 后跟值（--flag=value / --flag value / KEY=value）
const FLAG_EQ_RE = /^(--?[a-z0-9-]+=)(.*)$/i
const FLAG_SPACE_RE = /^(--?[a-z0-9-]+)\s+(\S+.*)$/i
const ENV_EQ_RE = /^([A-Z][A-Z0-9_]*)=(\S+.*)$/

/**
 * 判断某「键」是否敏感（键名命中触发词）。
 * @param {string} key
 * @returns {boolean}
 */
export function isSecretKey(key) {
  return SECRET_KEY_RE.test(String(key ?? ''))
}

/**
 * 判断某「值」是否为可原样保留的非秘密（变量引用/占位符/空）。
 * @param {string} value
 * @returns {boolean} true = 无需脱敏
 */
function isSafeValue(value) {
  const v = String(value ?? '').trim()
  if (v === '' || v === '****') return true
  // ${...} 变量引用不是秘密本体，原样保留
  if (v.startsWith('${') && v.endsWith('}')) return true
  // 占位符（如 PROXY_MANAGED）保留
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(v)) return true
  return false
}

/** 把单个敏感值替换为掩码 */
export function maskValue(value) {
  return isSafeValue(value) ? String(value) : '****'
}

/**
 * 对参数数组做逐元素脱敏：
 *   --flag=value / --flag value / KEY=value 三种形态中，键名敏感时值替换为 ****；
 *   裸字符串不处理（无法判定语义）。
 * @param {string[]} args
 * @returns {{ args: string[], maskedCount: number }}
 */
export function maskArgs(args) {
  let maskedCount = 0
  const out = []
  const list = Array.isArray(args) ? args.map(String) : []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const eq = FLAG_EQ_RE.exec(item)
    if (eq && isSecretKey(eq[1])) {
      const masked = isSafeValue(eq[2]) ? eq[2] : '****'
      if (masked !== eq[2]) maskedCount++
      out.push(eq[1] + masked)
      continue
    }
    const sp = FLAG_SPACE_RE.exec(item)
    if (sp && isSecretKey(sp[1]) && list[i + 1] !== undefined) {
      const next = list[i + 1]
      const masked = isSafeValue(next) ? next : '****'
      if (masked !== next) maskedCount++
      out.push(item, masked)
      i++
      continue
    }
    // 裸旗标形态：--token 与值分属两个元素
    const bare = /^--?[a-z0-9-]+$/i.exec(item)
    if (bare && isSecretKey(item) && list[i + 1] !== undefined) {
      const next = list[i + 1]
      const masked = isSafeValue(next) ? next : '****'
      if (masked !== next) maskedCount++
      out.push(item, masked)
      i++
      continue
    }
    const env = ENV_EQ_RE.exec(item)
    if (env && isSecretKey(env[1])) {
      const masked = isSafeValue(env[2]) ? env[2] : '****'
      if (masked !== env[2]) maskedCount++
      out.push(env[1] + '=' + masked)
      continue
    }
    out.push(item)
  }
  return { args: out, maskedCount }
}

/**
 * 对环境变量表做脱敏：键名敏感的值替换为 ****。
 * @param {Record<string, string>} env
 * @returns {{ env: Record<string, string>, maskedCount: number }}
 */
export function maskEnv(env) {
  let maskedCount = 0
  const out = {}
  for (const [k, v] of Object.entries(env ?? {})) {
    if (isSecretKey(k)) {
      const masked = isSafeValue(v) ? v : '****'
      if (masked !== v) maskedCount++
      out[k] = masked
    } else {
      out[k] = v
    }
  }
  return { env: out, maskedCount }
}

/** 构造统一报告壳（items/warnings 由调用方填充） */
export function makeReport(overrides = {}) {
  const items = overrides.items ?? []
  const warnings = overrides.warnings ?? []
  const summary = {
    migrated: items.filter((i) => i.status === 'migrated' || i.status === 'generated' || i.status === 'delegated').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    previewed: overrides.previewed ?? false,
    warnings: warnings.length,
  }
  // ok 语义：显式 false 才算失败；warnings 是建议性信息，不自动翻转 ok
  return {
    ok: overrides.ok !== false,
    previewed: overrides.previewed ?? false,
    summary,
    items,
    warnings,
    ...(overrides.ledgerPath ? { ledgerPath: overrides.ledgerPath } : {}),
  }
}
