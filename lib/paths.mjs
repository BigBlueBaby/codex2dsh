// lib/paths.mjs —— 路径常量解析（参数/环境变量覆盖）
//
// 约定见 docs/03-映射规范.md §2：
//   CODEX_HOME（默认 ~/.codex）、DSH_HOME（默认 ~/.dsh）、
//   DSH_AGENTS_HOME（默认 ~/.agents）、CODEX2DSH_HOME（默认 $DSH_HOME/codex2dsh）。

import { homedir } from 'node:os'
import { join } from 'node:path'

/** 解析 Codex 配置根：优先显式值 > 环境变量 CODEX_HOME > ~/.codex */
export function resolveCodexHome(explicit) {
  return explicit || process.env.CODEX_HOME || join(homedir(), '.codex')
}

/** 解析 DSH 数据根：环境变量 DSH_HOME > ~/.dsh */
export function resolveDshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 解析技能/指令资产根：显式值 > 环境变量 DSH_AGENTS_HOME > ~/.agents */
export function resolveAgentsHome(explicit) {
  return explicit || process.env.DSH_AGENTS_HOME || join(homedir(), '.agents')
}

/** 解析 codex2dsh 数据目录：环境变量 CODEX2DSH_HOME > $DSH_HOME/codex2dsh */
export function resolveCodex2dshHome() {
  return process.env.CODEX2DSH_HOME || join(resolveDshHome(), 'codex2dsh')
}

/** 迁移台账文件路径 */
export function resolveLedgerDir() {
  return resolveCodex2dshHome()
}

/** MCP 镜像片段默认输出路径 */
export function resolveMcpMirrorPath(outPath) {
  return outPath || join(resolveCodex2dshHome(), 'mcp-mirror.cordis.yml')
}

/** 配置建议片段默认输出路径 */
export function resolveSettingsSuggestPath(outPath) {
  return outPath || join(resolveCodex2dshHome(), 'settings-suggest.yml')
}
