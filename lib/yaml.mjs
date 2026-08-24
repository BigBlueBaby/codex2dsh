// lib/yaml.mjs —— 极简 YAML 渲染器（只覆盖本项目输出形态）
//
// renderScalar：标量引号判定（供手写缩进场景复用）。
// renderYaml：键值树渲染，条目 [key, value, depth?]；注释条目 ['#...', null, depth?]；
//   支持数组（多行 - 项 / 空数组 []）、嵌套对象（递归）。
// 不打算成为通用 YAML 引擎；输出格式由 test/yaml.test.mjs 快照锁定。

/** 标量渲染：按需加单引号（含单引号时退回 JSON 双引号转义） */
export function renderScalar(value) {
  const s = String(value)
  if (/^[A-Za-z0-9_./:${}@,-]+$/.test(s) && s !== '' && s !== 'true' && s !== 'false' && s !== 'null') {
    return s
  }
  if (s.includes("'")) return JSON.stringify(s)
  return `'${s}'`
}

/** 渲染对象条目（value 为纯对象/数组时递归） */
function renderObjectLines(key, value, depth, indentUnit, out) {
  const pad = (d) => indentUnit.repeat(d)
  out.push(pad(depth) + `${key}:`)
  for (const [k, v] of Object.entries(value)) {
    if (v !== null && typeof v === 'object') {
      if (Array.isArray(v)) {
        if (v.length === 0) {
          out.push(pad(depth + 1) + `${k}: []`)
        } else {
          out.push(pad(depth + 1) + `${k}:`)
          for (const item of v) {
            if (item !== null && typeof item === 'object') {
              const e = Object.entries(item)
              out.push(pad(depth + 2) + `- ${e[0][0]}: ${renderScalar(e[0][1])}`)
              for (const [k2, v2] of e.slice(1)) {
                out.push(pad(depth + 3) + `${k2}: ${v2 !== null && typeof v2 === 'object' ? '' : renderScalar(v2)}`)
              }
            } else {
              out.push(pad(depth + 2) + `- ${renderScalar(item)}`)
            }
          }
        }
      } else {
        renderObjectLines(k, v, depth + 1, indentUnit, out)
      }
    } else {
      out.push(pad(depth + 1) + `${k}: ${renderScalar(v)}`)
    }
  }
}

/**
 * 渲染 YAML 文本。
 * @param {Array} entries 顶层条目数组，每项 [key, value, depth?]：
 *   - ['# 注释', null]          → 注释行
 *   - ['key', scalar]           → key: scalar
 *   - ['key', null]             → key:
 *   - ['key', {...}]            → 嵌套对象（递归）
 *   - ['key', ['a','b']]        → 多行 - 项 / 空数组 []
 *   depth 用于手动缩进（如 - insert 场景）
 */
export function renderYaml(entries, opts = {}) {
  const indentUnit = opts.indent ?? '  '
  const out = []
  for (const entry of entries) {
    const [key, value, depth = 0] = entry
    const pad = indentUnit.repeat(depth)
    if (key.startsWith('#')) {
      out.push(pad + key)
      continue
    }
    if (value === null || value === undefined) {
      out.push(pad + `${key}:`)
      continue
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push(pad + `${key}: []`)
        continue
      }
      out.push(pad + `${key}:`)
      for (const item of value) {
        if (item !== null && typeof item === 'object') {
          const e = Object.entries(item)
          out.push(pad + indentUnit + `- ${e[0][0]}: ${renderScalar(e[0][1])}`)
          for (const [k, v] of e.slice(1)) {
            out.push(pad + indentUnit + indentUnit + `${k}: ${v !== null && typeof v === 'object' ? '' : renderScalar(v)}`)
          }
        } else {
          out.push(pad + indentUnit + `- ${renderScalar(item)}`)
        }
      }
      continue
    }
    if (typeof value === 'object') {
      renderObjectLines(key, value, depth, indentUnit, out)
      continue
    }
    out.push(pad + `${key}: ${renderScalar(value)}`)
  }
  return out.join('\n') + '\n'
}
