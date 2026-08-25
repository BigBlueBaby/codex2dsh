// index.d.ts —— codex2dsh 类型面（手写维护，随工具 schema 变更同步）
//
// 本包是零构建 ESM 插件：index.mjs 只导出 Cordis 插件入口（apply/inject/name）。
// 工具由 apply 动态注册，因此本文件把「工具调用面」声明为类型化接口 ToolSurface，
// 供 TS 调用方参考参数与返回结构（参考 dsh-chat-import 的做法）。
// 修改 lib/tools.mjs 的 schema 时须同步此处。

// ---------- Cordis 插件入口 ----------

export declare const name: string
export declare const inject: string[]

export interface HostContext {
  tools: { register(tool: unknown): unknown }
  get?(name: string): unknown
  inject?(deps: string[], callback?: (ctx: Record<string, unknown>) => void): unknown
}

export declare function apply(ctx: HostContext): void

// ---------- 工具调用面（apply 注册的工具） ----------

export interface CommonOptions {
  /** dry-run 别名：只预览不落盘 */
  preview?: boolean
  dryRun?: boolean
  /** Codex 配置根（默认 ~/.codex，可用环境变量 CODEX_HOME 覆盖） */
  codexHome?: string
  /** 源文件期望 SHA-256（小写 hex）；不匹配则失败且不落盘 */
  expectedHash?: string
}

export interface MigrateMcpOptions extends CommonOptions {
  /** true 时写盘生成 mcp-mirror.cordis.yml；缺省 false = 预览 */
  apply?: boolean
  /** 镜像文件输出路径（默认 $DSH_HOME/codex2dsh/mcp-mirror.cordis.yml） */
  outPath?: string
  /** 排除 Codex 运行时服务器（默认 true） */
  excludeRuntime?: boolean
  /** 目标文件已存在且内容不同时强制覆盖（默认 false） */
  force?: boolean
}

export interface MigrateSkillsOptions extends CommonOptions {
  apply?: boolean
  /** 技能落盘根（默认 $DSH_AGENTS_HOME/skills，即 ~/.agents/skills） */
  agentsHome?: string
  /** 缺 frontmatter 时用目录名/首段自动补全（默认 false） */
  fixFrontmatter?: boolean
  force?: boolean
}

export interface MigrateInstructionsOptions extends CommonOptions {
  apply?: boolean
  agentsHome?: string
}

export interface MigrateMemoryOptions extends CommonOptions {
  apply?: boolean
  /** 记忆资产输出目录（默认 $DSH_HOME/memories/codex） */
  outDir?: string
}

export interface MigrateConfigOptions extends CommonOptions {
  /** 建议片段输出路径（默认 $DSH_HOME/codex2dsh/settings-suggest.yml） */
  outPath?: string
}

export interface MigrateSessionsOptions extends CommonOptions {
  /** true 时只统计并预览（委托 import_codex 的 preview 语义） */
  preview?: boolean
  /** 上下文预算（token 数），透传给 import_codex */
  budget?: number
  /** 导入会话时间戳平移到当前时间，透传给 import_codex */
  restamp?: boolean
}

export interface FixTitlesOptions extends CommonOptions {
  /** true 时写盘追加 session/title 事件；缺省 false = 只预览 */
  apply?: boolean
  /** 只处理这些 DSH 会话 id（缺省 = 全部 codex 导入会话） */
  sessionIds?: string[]
}

export interface RegroupSessionsOptions extends CommonOptions {
  /** true 时执行归组（改写 header.cwd + 移动日志目录）；缺省 false = 只预览 */
  apply?: boolean
  /** 非工作区会话统一目录（默认取 Codex thread-workspace-root-hints 众数根） */
  regroupDir?: string
}

export interface ReportItem {
  kind: 'mcp' | 'skill' | 'instruction' | 'memory' | 'config' | 'session' | 'secret' | 'other'
  name: string
  status: 'migrated' | 'generated' | 'skipped' | 'invalid' | 'previewed' | 'delegated'
  target?: string
  note?: string
  secretsMasked?: number
}

export interface Report {
  ok: boolean
  summary: { migrated: number; skipped: number; previewed: boolean; warnings: number }
  items: ReportItem[]
  warnings: string[]
  ledgerPath?: string
}

export interface ToolSurface {
  migrate_codex_preview(options?: CommonOptions): Promise<Report>
  migrate_codex_mcp(options?: MigrateMcpOptions): Promise<Report>
  migrate_codex_skills(options?: MigrateSkillsOptions): Promise<Report>
  migrate_codex_instructions(options?: MigrateInstructionsOptions): Promise<Report>
  migrate_codex_memory(options?: MigrateMemoryOptions): Promise<Report>
  migrate_codex_config(options?: MigrateConfigOptions): Promise<Report>
  migrate_codex_sessions(options?: MigrateSessionsOptions): Promise<Report>
  codex2dsh_fix_titles(options?: FixTitlesOptions): Promise<Report>
  codex2dsh_regroup_sessions(options?: RegroupSessionsOptions): Promise<Report>
  codex2dsh_doctor(options?: CommonOptions): Promise<Report>
  codex2dsh_ledger(): Promise<{ ok: boolean; entries: unknown[]; ledgerPath: string }>
}
