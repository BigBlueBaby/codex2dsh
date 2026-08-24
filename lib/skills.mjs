// lib/skills.mjs —— 技能转换（Codex skills → $DSH_AGENTS_HOME/skills）
//
// 规范见 docs/03-映射规范.md §4。TODO(REQ-06, M2)：
//   1. 判定：.system / codex-primary-runtime / openai-bundled → skipped(runtime|marketplace)
//   2. SKILL.md frontmatter 追加 kind: dsh / source: codex（已有 kind:dsh → skipped）
//   3. scripts/ 整体复制；冲突目标加 -codex 后缀；内容相同 → skipped
//   4. 缺 frontmatter 时 fixFrontmatter 补全（目录名 → name，首段 → description）
//   5. 台账记录（lib/ledger.mjs）
// 本文件为桩，实现后删除本注释块。

/**
 * 规划技能迁移。
 * @param {string} skillsDir Codex skills 根（~/.codex/skills）
 * @param {object} [opts] { fixFrontmatter?: boolean }
 * @returns {Promise<import('../index.d.ts').Report>} TODO(M2) 返回 Report
 */
export async function planSkillsMigration(skillsDir, opts = {}) {
  void skillsDir; void opts
  throw new Error('migrate_codex_skills 尚未实现（里程碑 M2，见 docs/05-实现方案.md §1、docs/03-映射规范.md §4）')
}

/**
 * 执行技能迁移（apply 语义）。
 * @param {string} skillsDir
 * @param {string} agentsHome
 * @param {object} [opts] { fixFrontmatter?, force?, ledgerDir? }
 * @returns {Promise<import('../index.d.ts').Report>} TODO(M2)
 */
export async function migrateSkills(skillsDir, agentsHome, opts = {}) {
  void skillsDir; void agentsHome; void opts
  throw new Error('migrate_codex_skills 尚未实现（里程碑 M2）')
}
