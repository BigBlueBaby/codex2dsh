/* global window, document, fetch, confirm */
// client/index.js —— codex2dsh 的 Browser 侧 bundle（手写 CJS factory，零构建）
//
// 由 dsh web 客户端 ModuleLoader 注入（package.json dsh.client.inject 声明依赖
// @deepseek-ai/dsh-client-locale）。注册「设置 → 插件」分区内的「Codex 迁移」Tab
// （settings.plugins.tab 槽，与 dsh-chat-import 同款写法）：
//   - 状态总览：资产清单（MCP/技能/指令/记忆/会话/凭据）+ 台账计数
//   - 每个迁移动作「预览 / 执行」按钮（调 POST /codex2dsh/migrate，后端路由见 lib/panel.mjs）
//   - 结果摘要：migrated/skipped/invalid/previewed 徽章 + 警告列表
// 纯前端：不 import 任何 DSH host 模块，只消费注入的 slots/locale 服务与 react。

window.__ModuleLoader__.load({
  id: "codex2dsh",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const { useState, useEffect, useCallback } = React;

    const NS = "codex2dsh";
    const DICT = {
      zh: {
        "settings.tab": "Codex 迁移",
        "status.title": "Codex → DSH 迁移状态",
        "status.codexHome": "源配置根",
        "status.ledger": "迁移台账",
        "status.secrets": "凭据文件（不读取、不迁移）",
        "status.loadError": "状态加载失败：{msg}",
        "actions.title": "迁移操作",
        "action.preview": "预览",
        "action.apply": "执行",
        "action.confirm": "确定要执行「{label}」吗？将写入迁移产物（密钥已脱敏），源文件不会被修改。",
        "action.busy": "执行中…",
        "result.title": "执行结果",
        "result.empty": "尚未执行操作",
        "warnings": "警告",
        "badge.migrated": "已迁移",
        "badge.generated": "已生成",
        "badge.delegated": "已委托",
        "badge.skipped": "跳过",
        "badge.invalid": "无效",
        "badge.previewed": "预览",
        "kind.mcp": "MCP",
        "kind.skill": "技能",
        "kind.instruction": "指令",
        "kind.memory": "记忆",
        "kind.session": "会话",
        "kind.config": "配置",
        "kind.secret": "凭据",
        "kind.other": "其他",
        "action.mcp": "MCP 镜像",
        "action.skills": "技能转换",
        "action.instructions": "全局指令",
        "action.memory": "记忆迁移",
        "action.config": "配置建议",
        "action.sessions": "会话导入",
        "action.doctor": "迁移体检",
        "action.ledger": "查看台账",
        "tip": "提示：涉及 profile 的改动（MCP/配置）只生成待审阅片段，不会自动修改；执行后请刷新状态查看台账。",
      },
      en: {
        "settings.tab": "Codex Migration",
        "status.title": "Codex → DSH migration status",
        "status.codexHome": "Source root",
        "status.ledger": "Migration ledger",
        "status.secrets": "Credential files (never read/migrated)",
        "status.loadError": "Failed to load status: {msg}",
        "actions.title": "Migration actions",
        "action.preview": "Preview",
        "action.apply": "Apply",
        "action.confirm": "Run \"{label}\"? Migration artifacts will be written (secrets masked); source files are never modified.",
        "action.busy": "Working…",
        "result.title": "Result",
        "result.empty": "Nothing executed yet",
        "warnings": "Warnings",
        "badge.migrated": "migrated",
        "badge.generated": "generated",
        "badge.delegated": "delegated",
        "badge.skipped": "skipped",
        "badge.invalid": "invalid",
        "badge.previewed": "preview",
        "kind.mcp": "MCP",
        "kind.skill": "Skill",
        "kind.instruction": "Instruction",
        "kind.memory": "Memory",
        "kind.session": "Session",
        "kind.config": "Config",
        "kind.secret": "Credential",
        "kind.other": "Other",
        "action.mcp": "MCP mirror",
        "action.skills": "Skills",
        "action.instructions": "Instructions",
        "action.memory": "Memory",
        "action.config": "Config suggestions",
        "action.sessions": "Sessions",
        "action.doctor": "Doctor",
        "action.ledger": "Ledger",
        "tip": "Profile-affecting actions (MCP/config) only produce reviewable snippets; nothing is auto-applied. Refresh status after applying.",
      },
    };

    const ACTIONS = [
      { id: "mcp", labelKey: "action.mcp" },
      { id: "skills", labelKey: "action.skills" },
      { id: "instructions", labelKey: "action.instructions" },
      { id: "memory", labelKey: "action.memory" },
      { id: "config", labelKey: "action.config" },
      { id: "sessions", labelKey: "action.sessions" },
      { id: "doctor", labelKey: "action.doctor" },
    ];

    const KIND_LABEL = {
      mcp: "kind.mcp", skill: "kind.skill", instruction: "kind.instruction",
      memory: "kind.memory", session: "kind.session", config: "kind.config",
      secret: "kind.secret", other: "kind.other",
    };

    const BADGE_COLOR = {
      migrated: "#1f9d55", generated: "#1f9d55", delegated: "#1f9d55",
      skipped: "#8792a2", invalid: "#d64545", previewed: "#2b6cb0",
    };

    async function api(path, body) {
      const res = await fetch(path, body
        ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : undefined);
      return res.json();
    }

    function fmt(text, vars) {
      return String(text).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));
    }

    // ── 设置页 Tab 主组件 ────────────────────────────────────────────
    function MigrateTab({ t }) {
      const [status, setStatus] = useState(null);
      const [busy, setBusy] = useState(null);
      const [result, setResult] = useState(null);
      const [error, setError] = useState(null);

      const load = useCallback(async () => {
        try {
          setError(null);
          setStatus(await api("/codex2dsh/status"));
        } catch (err) {
          setError(fmt(t("status.loadError"), { msg: String((err && err.message) || err) }));
        }
      }, [t]);

      useEffect(() => { load(); }, [load]);

      const run = useCallback(async (action, apply) => {
        if (apply && !window.confirm(fmt(t("action.confirm"), { label: t(ACTIONS.find((a) => a.id === action).labelKey) }))) return;
        setBusy(action);
        setError(null);
        try {
          const report = await api("/codex2dsh/migrate", { action, apply: apply === true });
          setResult(report);
        } catch (err) {
          setError(fmt(t("status.loadError"), { msg: String((err && err.message) || err) }));
        } finally {
          setBusy(null);
          load();
        }
      }, [t, load]);

      const style = {
        section: { marginBottom: 16 },
        title: { fontSize: 15, fontWeight: 600, marginBottom: 8 },
        row: { display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, lineHeight: 1.5 },
        badge: (statusName) => ({
          display: "inline-block", padding: "0 8px", borderRadius: 10,
          fontSize: 12, color: "#fff", background: BADGE_COLOR[statusName] || "#8792a2",
        }),
        kindTag: { color: "#5c6b7a", minWidth: 44 },
        button: { padding: "4px 12px", borderRadius: 6, border: "1px solid #cbd5e0", background: "#fff", cursor: "pointer", fontSize: 13 },
        buttonPrimary: { padding: "4px 12px", borderRadius: 6, border: "1px solid #2b6cb0", background: "#2b6cb0", color: "#fff", cursor: "pointer", fontSize: 13 },
        buttonDisabled: { opacity: 0.5, cursor: "not-allowed" },
        warn: { color: "#b7791f" },
        err: { color: "#d64545", fontSize: 13 },
        note: { color: "#5c6b7a", fontSize: 12 },
        tip: { color: "#5c6b7a", fontSize: 12, marginTop: 12 },
      };

      return React.createElement("div", null, [
        React.createElement("div", { key: "title", style: style.title }, t("status.title")),
        error && React.createElement("div", { key: "err", style: style.err }, error),

        // 状态区
        React.createElement("div", { key: "status", style: style.section },
          status && status.assets
            ? status.assets.map((a, i) => React.createElement("div", { key: "asset" + i, style: style.row },
                React.createElement("span", { style: style.kindTag }, t(KIND_LABEL[a.kind] || "kind.other")),
                React.createElement("span", { style: { fontWeight: 600 } }, a.name),
                React.createElement("span", { style: style.note }, a.note || ""),
              ))
            : React.createElement("div", { key: "loading", style: style.note }, t("action.busy")),
          status && status.ledgerCount !== undefined &&
            React.createElement("div", { key: "ledger", style: style.row },
              React.createElement("span", { style: style.kindTag }, t("status.ledger")),
              React.createElement("span", null, String(status.ledgerCount) + " 条"),
            ),
          status && status.secrets && status.secrets.length > 0 &&
            React.createElement("div", { key: "secrets", style: { ...style.row, ...style.warn } },
              React.createElement("span", null, t("status.secrets") + ": " + status.secrets.map((s) => s.name).join(", ")),
            ),
        ),

        // 操作区
        React.createElement("div", { key: "actions", style: style.section },
          React.createElement("div", { style: style.title }, t("actions.title")),
          ACTIONS.map((a) => {
            const isBusy = busy === a.id;
            return React.createElement("div", { key: a.id, style: style.row },
              React.createElement("span", { style: { minWidth: 90, fontWeight: 600 } }, t(a.labelKey)),
              React.createElement("button", {
                style: { ...style.button, ...(isBusy ? style.buttonDisabled : {}) },
                disabled: isBusy,
                onClick: () => run(a.id, false),
              }, isBusy ? t("action.busy") : t("action.preview")),
              React.createElement("button", {
                style: { ...style.buttonPrimary, ...(isBusy ? style.buttonDisabled : {}) },
                disabled: isBusy,
                onClick: () => run(a.id, true),
              }, t("action.apply")),
            );
          }),
        ),

        // 结果区
        React.createElement("div", { key: "result", style: style.section },
          React.createElement("div", { style: style.title }, t("result.title")),
          result
            ? [
                React.createElement("div", { key: "summary", style: style.row },
                  React.createElement("span", null,
                    "ok=" + String(result.ok) + " · " +
                    "migrated=" + (result.summary ? result.summary.migrated : 0) + " · " +
                    "skipped=" + (result.summary ? result.summary.skipped : 0) + " · " +
                    "warnings=" + (result.summary ? result.summary.warnings : 0)),
                ),
                (result.items || []).slice(0, 30).map((it, i) =>
                  React.createElement("div", { key: "item" + i, style: style.row },
                    React.createElement("span", { style: style.badge(it.status) }, t("badge." + it.status) || it.status),
                    React.createElement("span", { style: style.kindTag }, t(KIND_LABEL[it.kind] || "kind.other")),
                    React.createElement("span", { style: { fontWeight: 600 } }, it.name),
                    React.createElement("span", { style: style.note }, it.note || ""),
                  )),
                (result.warnings || []).map((w, i) =>
                  React.createElement("div", { key: "warn" + i, style: { ...style.row, ...style.warn } },
                    React.createElement("span", null, "⚠ " + w))),
              ]
            : React.createElement("div", { key: "empty", style: style.note }, t("result.empty")),
        ),

        React.createElement("div", { key: "tip", style: style.tip }, t("tip")),
      ]);
    }

    // ── 插件入口（Cordis client）────────────────────────────────────
    const name = "codex2dsh";
    const inject = ["slots", "locale"];

    function apply(ctx) {
      let localeSvc = null;
      const locale = ctx.get && ctx.get("locale");
      if (locale && typeof locale.register === "function" && typeof locale.bind === "function") {
        localeSvc = locale;
        ctx.effect(() => locale.register(NS, { zh: DICT.zh, en: DICT.en }));
      }
      const t = (key) => {
        if (localeSvc) return localeSvc.bind(NS)(key);
        return DICT.zh[key] || key;
      };

      // 设置 → 插件 → 「Codex 迁移」Tab（settings.plugins.tab 槽由 ui-settings-plugins 声明；
      // settingsScope 为可选服务，缺席时回调不执行、不报错）
      ctx.slots.inject("settings.plugins.tab", () => {
        const settingsScope = ctx.get && ctx.get("settingsScope");
        if (!settingsScope || typeof settingsScope.bind !== "function") return undefined;
        const scope = settingsScope.bind({ namespace: NS });
        return ctx.slots.register(
          {
            name: "settings.plugins.tab",
            id: "codex2dsh",
            order: 45,
            label: () => t("settings.tab"),
            locale: NS,
            inject: () => ({ scope }),
          },
          () => React.createElement(MigrateTab, { t }),
        );
      });
    }

    module.exports = { name, inject, apply };
    return module.exports;
  },
});
