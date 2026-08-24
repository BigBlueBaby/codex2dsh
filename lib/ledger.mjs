// lib/ledger.mjs —— 迁移台账（$DSH_HOME/codex2dsh/ledger.json）
//
// 每条记录：{ ts, tool, source, sourceFingerprint, target, status, maskedCount }
// 幂等判定：同一 (source + fingerprint + target) 视为已迁移（由调用方先查再写）。
// 并发：读写采用「临时文件 + rename」原子替换；单进程内串行足够。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from './report.mjs'

/** 读取台账；不存在返回空数组；损坏时抛错（调用方决定是否重建） */
export function readLedger(ledgerDir) {
  const file = join(ledgerDir, 'ledger.json')
  if (!existsSync(file)) return []
  const raw = readFileSync(file, 'utf8')
  const doc = JSON.parse(raw)
  return Array.isArray(doc) ? doc : []
}

/** 幂等键查询：存在同 (tool, source, fingerprint) 记录则返回该记录 */
export function findLedgerEntry(ledgerDir, { tool, source, fingerprint }) {
  const entries = readLedger(ledgerDir)
  return entries.find(
    (e) => e.tool === tool && e.source === source && e.sourceFingerprint === fingerprint,
  )
}

/** 追加一条台账记录（原子写） */
export function appendLedger(ledgerDir, entry) {
  const dir = ledgerDir
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'ledger.json')
  const entries = existsSync(file) ? readLedger(ledgerDir) : []
  entries.push({
    ts: new Date().toISOString(),
    ...entry,
    ...(entry.source ? { sourceFingerprint: sha256(entry.source) } : {}),
  })
  const tmp = join(dir, `.ledger-${process.pid}-${Date.now()}.tmp`)
  writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8')
  renameSync(tmp, file)
  return entries.length
}

/** 便捷：源文件指纹（不存在返回 null） */
export function fingerprintOf(sourcePath, readFile) {
  try {
    return sha256(readFile(sourcePath, 'utf8'))
  } catch {
    return null
  }
}
