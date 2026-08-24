// lib/doctor.mjs —— 体检（迁移前后健康检查）
//
// 规范见 docs/03-映射规范.md §10 与 docs/09-安全边界.md。TODO(REQ-10, M3)：
//   1. 逐资产状态：已迁移 / 待迁移 / 不可迁移（secret / not-applicable / runtime）
//   2. 密钥残留扫描（台账 + 目标目录中的 **** 提示）
//   3. 汇总表（数量 / 体积 / 时间范围 / 警告）
// 本文件为桩，实现后删除本注释块。

/** 体检 */
export async function runDoctor(codexHome, opts = {}) {
  void codexHome; void opts
  throw new Error('codex2dsh_doctor 尚未实现（里程碑 M3，见 docs/05-实现方案.md §2）')
}
