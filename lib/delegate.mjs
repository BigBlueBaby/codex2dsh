// lib/delegate.mjs —— 会话迁移委托（Codex sessions → import_codex）
//
// 规范见 docs/03-映射规范.md §8。TODO(REQ-11, M4)：
//   1. 只读统计 sessions/YYYY/MM/DD/rollout-*.jsonl（数量/行数/时间范围）
//   2. 检测 import_codex 工具可用性：可用 → 委托（preview 透传）；不可用 → 安装指引
//   3. 台账记录委托结果
// 本文件为桩，实现后删除本注释块。

/** 规划会话迁移（统计 + 委托探测） */
export async function planSessionsMigration(codexHome, opts = {}) {
  void codexHome; void opts
  throw new Error('migrate_codex_sessions 尚未实现（里程碑 M4，见 docs/03-映射规范.md §8）')
}

/** 执行会话迁移（委托 import_codex） */
export async function delegateSessions(codexHome, ctx, opts = {}) {
  void codexHome; void ctx; void opts
  throw new Error('migrate_codex_sessions 尚未实现（里程碑 M4）')
}
