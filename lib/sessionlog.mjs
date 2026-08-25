// lib/sessionlog.mjs —— DSH 会话日志读取（JSONL backend，zstd 多帧拼接格式）
//
// DSH 的 dsh-session-persistence-jsonl 把会话日志存为：
//   <header 帧><事件批 1 帧><事件批 2 帧>…（每帧独立可解压、带校验和）
// 本模块用 node:zlib 的 zstd（Node ≥ 22.2，DSH 自身即用它）扫描帧边界并逐帧
// 解压，只读不改写。供 CLI / 标题回填等「无 host ctx」路径读取日志；
// 在 host 内（工具/面板）优先走 sessionPersistence 服务，不直接读文件。

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 4247762216 // 0xFD2FB528

/**
 * 扫描 zstd 帧边界（对齐 DSH scanZstdFrames 算法），返回完整帧 [{start,end}]。
 * 末帧不完整时返回 { frames, tornStart }（调用方按需忽略 torn 尾）。
 * @param {Buffer} buffer
 * @param {number} [maxFrames]
 */
export function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }
  return { frames }
}

/**
 * 读取一个会话日志工件（session.jsonl.zstd），返回 { header, events }。
 * 只读；日志损坏时抛错（大声不静默）。compression='none' 的 .jsonl 同样支持。
 * @param {string} path
 */
export function readSessionLog(path) {
  const buf = readFileSync(path)
  // 明文日志直接切行
  if (buf.length >= 1 && buf[0] !== 0x28) {
    return parseJsonlText(buf.toString('utf8'))
  }
  const { frames } = scanZstdFrames(buf)
  if (frames.length === 0) throw new Error('empty or header-less session log')
  const parts = []
  for (const f of frames) parts.push(zstdDecompressSync(buf.subarray(f.start, f.end)))
  return parseJsonlText(Buffer.concat(parts).toString('utf8'))
}

/** 解析 JSONL 文本：首行 = header，其余 = 事件（损坏行抛错） */
function parseJsonlText(text) {
  const lines = text.split('\n').filter(Boolean)
  if (lines.length === 0) throw new Error('empty session log')
  const header = JSON.parse(lines[0])
  const events = lines.slice(1).map((l) => JSON.parse(l))
  return { header, events }
}
