// lib/panel.mjs —— web 面板路由（POST /codex2dsh/*）
//
// 可选服务（webServer），headless 下不挂载；由 index.mjs 延后注册。
// TODO(REQ-13, M4)：preview / apply / doctor / ledger 路由，复用 lib/tools.mjs 逻辑。

/**
 * 注册面板路由。
 * @param {object} ctx host 上下文
 * @param {object} webServer webServer 服务
 * @param {string} ledgerDir 台账目录
 */
export function registerPanelRoutes(ctx, webServer, ledgerDir) {
  void ctx; void webServer; void ledgerDir
  // TODO(M4)：webServer 路由 API 以 host 发布类型为准，实现后补全
}
