// lib/settings.mjs —— 模型 / Provider / 权限 / 项目信任 → 只读建议
//
// 规范见 docs/03-映射规范.md §7。TODO(REQ-09, M3)：
//   1. model / model_provider / model_reasoning_effort → agent-default-model 建议
//   2. [model_providers.*] base_url → settings.yaml provider 配置建议（凭据脱敏）
//   3. [windows].sandbox → permission.defaultPreset 建议
//   4. [projects.*] trust_level → 项目级指令挂载建议
//   5. 输出 settings-suggest.yml + 结构化返回；绝不自动写入 ~/.dsh/settings.yaml
// 本文件为桩，实现后删除本注释块。

/** 生成配置迁移建议（只读） */
export async function buildConfigSuggestions(codexHome, opts = {}) {
  void codexHome; void opts
  throw new Error('migrate_codex_config 尚未实现（里程碑 M3，见 docs/03-映射规范.md §7）')
}
