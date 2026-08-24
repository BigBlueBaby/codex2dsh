// lib/instructions.mjs —— 全局指令迁移（AGENTS.md / instructions.md → DSH 指令资产）
//
// 规范见 docs/03-映射规范.md §5。TODO(REQ-07, M3)：
//   1. 读取 ~/.codex/AGENTS.md 与 instructions.md（原文完整保留）
//   2. 头部追加来源注释块（<!-- codex2dsh: from ... -->），不改变正文
//   3. 落盘 $DSH_AGENTS_HOME/instructions/global.md 等
//   4. 项目级 AGENTS.md：按 [projects.*] 信任列表扫描，生成挂载建议（不自动写盘）
//   5. 台账记录
// 本文件为桩，实现后删除本注释块。

/** 规划全局指令迁移 */
export async function planInstructionsMigration(codexHome, opts = {}) {
  void codexHome; void opts
  throw new Error('migrate_codex_instructions 尚未实现（里程碑 M3，见 docs/03-映射规范.md §5）')
}

/** 执行全局指令迁移（apply 语义） */
export async function migrateInstructions(codexHome, agentsHome, opts = {}) {
  void codexHome; void agentsHome; void opts
  throw new Error('migrate_codex_instructions 尚未实现（里程碑 M3）')
}
