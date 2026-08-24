// .github/scripts/check-fixtures.mjs —— 夹具敏感词检查（CI 门禁）
//
// 扫描 test/fixtures 与 docs 中的示例代码块，防止真实凭据/内网地址入库。
// 敏感词表：常见密钥触发词 + 内网 IP 段。误报时在文件内用「示例/脱敏」注释说明，
// 或把确属示例的值改为 example 形态；不要放宽正则。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = join(fileURLToPath(import.meta.url), '..', '..', '..')
const TARGETS = [join(here, 'test', 'fixtures'), join(here, 'docs')]

// 敏感模式：密钥触发词（值形态）与内网地址（127.0.0.1 回环是安全的示例形态，放行）
const SENSITIVE = [
  { re: /(password|passwd|secret|api[_-]?key|bearer|token)\s*[=:]\s*[^\s"'`{}$*]+/i, why: '疑似内嵌密钥' },
  { re: /https?:\/\/(?!127\.0\.0\.1)\d{1,3}(\.\d{1,3}){3}/, why: '疑似内网 URL' },
  { re: /\b(10|192\.168)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, why: '疑似内网 IP（示例请改用 127.0.0.1）' },
  { re: /sk-[A-Za-z0-9]{12,}/, why: '疑似 API key' },
]

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (['.md', '.toml', '.yml', '.yaml', '.json', '.mjs'].includes(extname(e.name))) out.push(p)
  }
  return out
}

let failures = 0
for (const target of TARGETS) {
  if (!statSync(target, { throwIfNoEntry: false })) continue
  for (const file of walk(target)) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      for (const { re, why } of SENSITIVE) {
        const m = re.exec(line)
        if (m && !line.includes('****') && !/example|示例|脱敏|masked/i.test(line)) {
          console.error(`[敏感词检查] ${file}:${i + 1} ${why}: ${line.trim().slice(0, 120)}`)
          failures++
        }
      }
    })
  }
}

if (failures) {
  console.error(`\n发现 ${failures} 处疑似敏感内容，请脱敏后重试。`)
  process.exit(1)
}
console.log('[敏感词检查] 通过：fixtures 与 docs 未发现疑似真实凭据。')
