// lib/memory.mjs —— 记忆迁移（Codex memories → DSH 记忆资产）
//
// 规范见 docs/03-映射规范.md §6。TODO(REQ-08, M3)：
//   1. memories/ 目录下可读资产（*.md 等）解析为条目（带来源与时间戳）
//   2. memories_1.sqlite 只读探测：可读 → 提取；不可读/版本不明 → 降级报告（不猜测解析）
//   3. [memories] 开关关闭时报告"Codex 记忆未开启，跳过"
//   4. 落盘 $DSH_HOME/memories/codex/；台账记录
// 本文件为桩，实现后删除本注释块。

/** 规划记忆迁移 */
export async function planMemoryMigration(codexHome, opts = {}) {
  void codexHome; void opts
  throw new Error('migrate_codex_memory 尚未实现（里程碑 M3，见 docs/03-映射规范.md §6）')
}

/** 执行记忆迁移（apply 语义） */
export async function migrateMemory(codexHome, outDir, opts = {}) {
  void codexHome; void outDir; void opts
  throw new Error('migrate_codex_memory 尚未实现（里程碑 M3）')
}
