// lib/command.mjs —— 斜杠命令（/codex2dsh）
//
// 可选服务（commands），headless / CLI 会话可能不挂载；由 index.mjs 延后注册。
// TODO(REQ-14, M4)：/codex2dsh preview|mcp|skills|doctor|ledger，复用 lib/tools.mjs 逻辑。

/**
 * 注册 /codex2dsh 命令。
 * @param {object} ctx host 上下文
 * @param {object} commands commands 服务
 * @param {string} ledgerDir 台账目录
 */
export function registerCommands(ctx, commands, ledgerDir) {
  void ctx; void commands; void ledgerDir
  // TODO(M4)：commands 服务 API 以 @deepseek-ai/cordis 发布类型为准，实现后补全
}
