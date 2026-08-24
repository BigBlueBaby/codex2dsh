/* global window, document, fetch, confirm */
// client/index.js —— codex2dsh 的 Browser 侧 bundle（手写 CJS factory，零构建）
//
// 注册「设置 → 插件 → Codex 迁移」Tab（settings.plugins.tab 槽），提供：
//   1. 状态总览：资产清单 / 台账 / 凭据警告 / 可勾选清单（MCP 服务器、技能、本地工具）
//   2. 全局选项：密钥迁移方式（原样 / 脱敏）、工具目录随迁开关
//   3. 全量迁移向导：1 预览 → 2 选择（分类 + MCP/技能勾选）→ 3 执行（逐步进度）→ 4 完成汇总
//   4. 分类迁移：每类独立卡片（勾选 + 预览 / 执行 + 结果徽章）
// 后端路由见 lib/panel.mjs；纯前端：只消费注入的 slots/locale 服务与 react。

window.__ModuleLoader__.load({
  id: "codex2dsh",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const { useState, useEffect, useCallback } = React;
    const h = React.createElement;

    const NS = "codex2dsh";
    const DICT = {
      zh: {
        "settings.tab": "Codex 迁移",
        "status.title": "Codex → DSH 迁移",
        "status.codexHome": "源配置根",
        "status.ledger": "迁移台账",
        "status.secrets": "凭据文件（不读取、不迁移）",
        "status.refresh": "刷新",
        "status.loadError": "加载失败：{msg}",
        "option.title": "迁移选项",
        "option.maskSecrets": "密钥脱敏（****）",
        "option.maskSecrets.desc": "关闭 = 按原样迁移密钥（默认）；开启 = 敏感值替换为 ****",
        "option.migrateTools": "随迁本地工具目录（mcp-toolbox 等）",
        "option.migrateTools.desc": "复制 ~/.codex/tools 下被引用的工具并重写镜像路径",
        "wizard.title": "全量迁移向导",
        "wizard.start": "开始全量迁移",
        "wizard.step1": "预览",
        "wizard.step2": "选择",
        "wizard.step3": "执行",
        "wizard.step4": "完成",
        "wizard.previewing": "正在预览…",
        "wizard.selectHint": "勾选要迁移的分类；MCP 与技能可在下方分类卡片中细化勾选。",
        "wizard.running": "正在执行 {label}…",
        "wizard.done": "全量迁移完成",
        "wizard.summary": "成功 {ok} · 跳过 {skip} · 警告 {warn}",
        "wizard.next": "下一步",
        "wizard.back": "上一步",
        "wizard.cancel": "取消",
        "cat.title": "分类迁移",
        "cat.mcp": "MCP 服务器",
        "cat.skills": "技能",
        "cat.instructions": "全局指令",
        "cat.memory": "记忆",
        "cat.config": "配置建议",
        "cat.sessions": "会话导入",
        "cat.doctor": "迁移体检",
        "cat.tools": "本地工具",
        "select.all": "全选",
        "select.none": "清空",
        "select.keep": "已选 {n} 项",
        "action.preview": "预览",
        "action.apply": "执行",
        "action.confirm": "确定要执行「{label}」吗？将写入迁移产物；源文件不会被修改。",
        "action.busy": "执行中…",
        "result.title": "最近结果",
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
        "kind.tool": "工具",
        "kind.instruction": "指令",
        "kind.memory": "记忆",
        "kind.session": "会话",
        "kind.config": "配置",
        "kind.secret": "凭据",
        "kind.other": "其他",
        "tip": "提示：MCP/配置只生成待审阅片段，不会自动修改 profile；密钥默认按原样迁移，输出文件请勿提交公开仓库。",
      },
      en: {
        "settings.tab": "Codex Migration",
        "status.title": "Codex → DSH migration",
        "status.codexHome": "Source root",
        "status.ledger": "Migration ledger",
        "status.secrets": "Credential files (never read/migrated)",
        "status.refresh": "Refresh",
        "status.loadError": "Load failed: {msg}",
        "option.title": "Options",
        "option.maskSecrets": "Mask secrets (****)",
        "option.maskSecrets.desc": "Off = migrate secrets as-is (default); On = replace sensitive values with ****",
        "option.migrateTools": "Migrate local tool dirs (mcp-toolbox etc.)",
        "option.migrateTools.desc": "Copy referenced ~/.codex/tools dirs and rewrite mirror paths",
        "wizard.title": "Full migration wizard",
        "wizard.start": "Start full migration",
        "wizard.step1": "Preview",
        "wizard.step2": "Select",
        "wizard.step3": "Run",
        "wizard.step4": "Done",
        "wizard.previewing": "Previewing…",
        "wizard.selectHint": "Check categories to migrate; refine MCP/skills below.",
        "wizard.running": "Running {label}…",
        "wizard.done": "Full migration finished",
        "wizard.summary": "ok {ok} · skipped {skip} · warnings {warn}",
        "wizard.next": "Next",
        "wizard.back": "Back",
        "wizard.cancel": "Cancel",
        "cat.title": "Per-category migration",
        "cat.mcp": "MCP servers",
        "cat.skills": "Skills",
        "cat.instructions": "Instructions",
        "cat.memory": "Memory",
        "cat.config": "Config suggestions",
        "cat.sessions": "Sessions",
        "cat.doctor": "Doctor",
        "cat.tools": "Local tools",
        "select.all": "All",
        "select.none": "None",
        "select.keep": "{n} selected",
        "action.preview": "Preview",
        "action.apply": "Apply",
        "action.confirm": "Run \"{label}\"? Artifacts will be written; sources are never modified.",
        "action.busy": "Working…",
        "result.title": "Latest result",
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
        "kind.tool": "Tool",
        "kind.instruction": "Instruction",
        "kind.memory": "Memory",
        "kind.session": "Session",
        "kind.config": "Config",
        "kind.secret": "Credential",
        "kind.other": "Other",
        "tip": "MCP/config only produce reviewable snippets; nothing auto-applies. Secrets migrate as-is by default — keep outputs out of public repos.",
      },
    };

    const CATEGORIES = [
      { id: "mcp", labelKey: "cat.mcp" },
      { id: "skills", labelKey: "cat.skills" },
      { id: "instructions", labelKey: "cat.instructions" },
      { id: "memory", labelKey: "cat.memory" },
      { id: "config", labelKey: "cat.config" },
      { id: "sessions", labelKey: "cat.sessions" },
      { id: "doctor", labelKey: "cat.doctor" },
    ];
    // 全量向导默认执行顺序（sessions 委托可能未装，不勾）
    const WIZARD_DEFAULT = ["mcp", "skills", "instructions", "memory", "config"];

    const KIND_LABEL = {
      mcp: "kind.mcp", skill: "kind.skill", tool: "kind.tool", instruction: "kind.instruction",
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
    function toList(setOrArray) {
      return Array.isArray(setOrArray) ? setOrArray : Array.from(setOrArray || []);
    }

    const S = {
      section: { marginBottom: 16 },
      title: { fontSize: 15, fontWeight: 600, marginBottom: 8 },
      card: { border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 10, background: "#fff" },
      cardTitle: { fontSize: 14, fontWeight: 600, marginBottom: 6 },
      row: { display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13, lineHeight: 1.5 },
      badge: (status) => ({
        display: "inline-block", padding: "0 8px", borderRadius: 10,
        fontSize: 12, color: "#fff", background: BADGE_COLOR[status] || "#8792a2",
      }),
      tag: { color: "#5c6b7a", minWidth: 40, fontSize: 12 },
      btn: { padding: "4px 12px", borderRadius: 6, border: "1px solid #cbd5e0", background: "#fff", cursor: "pointer", fontSize: 13 },
      btnPrimary: { padding: "4px 12px", borderRadius: 6, border: "1px solid #2b6cb0", background: "#2b6cb0", color: "#fff", cursor: "pointer", fontSize: 13 },
      btnGhost: { padding: "2px 8px", borderRadius: 6, border: "1px solid #cbd5e0", background: "#f7fafc", cursor: "pointer", fontSize: 12 },
      disabled: { opacity: 0.5, cursor: "not-allowed" },
      warn: { color: "#b7791f" },
      err: { color: "#d64545", fontSize: 13 },
      note: { color: "#5c6b7a", fontSize: 12 },
      tip: { color: "#5c6b7a", fontSize: 12, marginTop: 12 },
      check: { marginRight: 6 },
      step: (active, done) => ({
        display: "inline-flex", alignItems: "center", gap: 6, marginRight: 14,
        fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "#2b6cb0" : (done ? "#1f9d55" : "#8792a2"),
      }),
      stepDot: (active, done) => ({
        display: "inline-flex", width: 20, height: 20, borderRadius: 10,
        alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff",
        background: done ? "#1f9d55" : (active ? "#2b6cb0" : "#cbd5e0"),
      }),
      progress: { width: "100%", height: 6, borderRadius: 3, background: "#edf2f7", margin: "6px 0" },
      progressBar: { width: "60%", height: 6, borderRadius: 3, background: "#2b6cb0", transition: "width .3s" },
    };

    // ── 主组件 ─────────────────────────────────────────────────────────
    function MigrateTab({ t }) {
      const [status, setStatus] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(null);
      const [result, setResult] = useState(null);
      const [maskSecrets, setMaskSecrets] = useState(false);
      const [migrateTools, setMigrateTools] = useState(true);
      const [selMCP, setSelMCP] = useState(null);
      const [selSkills, setSelSkills] = useState(null);
      const [wizard, setWizard] = useState(null);

      const load = useCallback(async () => {
        try {
          setError(null);
          const s = await api("/codex2dsh/status");
          setStatus(s);
          setSelMCP((prev) => prev || new Set(s.selectable && s.selectable.mcp ? s.selectable.mcp : []));
          setSelSkills((prev) => prev || new Set(s.selectable && s.selectable.skills ? s.selectable.skills : []));
        } catch (err) {
          setError(fmt(t("status.loadError"), { msg: String((err && err.message) || err) }));
        }
      }, [t]);

      useEffect(() => { load(); }, [load]);

      const toggleSet = (setter, name) => {
        setter((prev) => {
          const next = new Set(prev || []);
          if (next.has(name)) next.delete(name); else next.add(name);
          return next;
        });
      };

      const run = useCallback(async (action, opts) => {
        const apply = opts && opts.apply === true;
        const cat = CATEGORIES.find((c) => c.id === action);
        const label = t((cat || {}).labelKey || action);
        if (apply && !window.confirm(fmt(t("action.confirm"), { label }))) return null;
        setBusy(action);
        setError(null);
        try {
          const body = {
            action,
            apply: apply === true,
            maskSecrets,
            migrateTools,
            ...(action === "mcp" ? { include: toList(selMCP) } : {}),
            ...(action === "skills" ? { include: toList(selSkills) } : {}),
          };
          const report = await api("/codex2dsh/migrate", body);
          setResult(report);
          return report;
        } catch (err) {
          setError(fmt(t("status.loadError"), { msg: String((err && err.message) || err) }));
          return null;
        } finally {
          setBusy(null);
          load();
        }
      }, [t, maskSecrets, migrateTools, selMCP, selSkills, load]);

      // 全量向导：逐步执行
      const wizardRun = useCallback(async (chosen) => {
        const results = [];
        setWizard((w) => ({ ...w, step: 3, chosen }));
        for (const action of chosen) {
          const cat = CATEGORIES.find((c) => c.id === action);
          const label = t((cat || {}).labelKey || action);
          setBusy(action);
          setWizard((w) => ({ ...w, running: label }));
          const body = {
            action,
            apply: true,
            maskSecrets,
            migrateTools,
            ...(action === "mcp" ? { include: toList(selMCP) } : {}),
            ...(action === "skills" ? { include: toList(selSkills) } : {}),
          };
          try {
            const report = await api("/codex2dsh/migrate", body);
            results.push({ action, report });
          } catch (err) {
            results.push({ action, report: { ok: false, items: [], warnings: [String((err && err.message) || err)] } });
          }
        }
        setBusy(null);
        setWizard((w) => ({ ...w, step: 4, results }));
        setResult(results[results.length - 1] && results[results.length - 1].report);
        load();
      }, [t, maskSecrets, migrateTools, selMCP, selSkills, load]);

      const mcpNames = (status && status.selectable && status.selectable.mcp) || [];
      const skillNames = (status && status.selectable && status.selectable.skills) || [];
      const toolNames = (status && status.selectable && status.selectable.tools) || [];

      return h("div", null, [
        // 头部
        h("div", { key: "head", style: S.section },
          h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, [
            h("span", { style: S.title }, t("status.title")),
            h("button", { style: S.btnGhost, onClick: load }, t("status.refresh")),
          ]),
          status && h("div", { key: "meta", style: S.row }, [
            h("span", { style: S.tag }, t("status.codexHome")),
            h("span", { style: { fontWeight: 600 } }, status.codexHome),
            h("span", { style: { ...S.tag, marginLeft: 14 } }, t("status.ledger")),
            h("span", null, String(status.ledgerCount) + " 条"),
            toolNames.length > 0 && h("span", { style: { ...S.tag, marginLeft: 14 } }, t("cat.tools")),
            toolNames.length > 0 && h("span", null, toolNames.join(", ")),
          ]),
          status && status.secrets && status.secrets.length > 0 &&
            h("div", { key: "secrets", style: { ...S.row, ...S.warn } },
              h("span", null, t("status.secrets") + ": " + status.secrets.map((s) => s.name).join(", "))),
          error && h("div", { key: "err", style: S.err }, error),
        ),

        // 全局选项
        h("div", { key: "opts", style: S.card }, [
          h("div", { style: S.cardTitle }, t("option.title")),
          h("label", { key: "mask", style: { ...S.row, cursor: "pointer" } }, [
            h("input", { type: "checkbox", checked: maskSecrets, onChange: (e) => setMaskSecrets(e.target.checked), style: S.check }),
            h("span", null, t("option.maskSecrets")),
            h("span", { style: S.note }, t("option.maskSecrets.desc")),
          ]),
          h("label", { key: "tools", style: { ...S.row, cursor: "pointer" } }, [
            h("input", { type: "checkbox", checked: migrateTools, onChange: (e) => setMigrateTools(e.target.checked), style: S.check }),
            h("span", null, t("option.migrateTools")),
            h("span", { style: S.note }, t("option.migrateTools.desc")),
          ]),
        ]),

        // 全量迁移向导
        h("div", { key: "wizard", style: S.card }, [
          h("div", { style: S.cardTitle }, t("wizard.title")),
          !wizard &&
            h("div", { style: S.row }, [
              h("button", {
                style: S.btnPrimary,
                onClick: async () => {
                  setBusy("wizard-preview");
                  const preview = await api("/codex2dsh/preview", {});
                  setBusy(null);
                  setWizard({ step: 1, chosen: [...WIZARD_DEFAULT], preview, results: [] });
                },
              }, busy === "wizard-preview" ? t("wizard.previewing") : t("wizard.start")),
            ]),
          wizard && h("div", { key: "wizard-body" }, [
            h("div", { key: "steps", style: { ...S.row, marginBottom: 8 } },
              [1, 2, 3, 4].map((n) =>
                h("span", { key: n, style: S.step(wizard.step === n, wizard.step > n) }, [
                  h("span", { style: S.stepDot(wizard.step === n, wizard.step > n) }, String(n)),
                  h("span", null, t("wizard.step" + n)),
                ]))),
            wizard.step === 1 && h("div", { key: "s1" }, [
              h("div", { style: S.note }, "预览结果（零副作用）："),
              (wizard.preview.items || []).slice(0, 20).map((it, i) =>
                h("div", { key: i, style: S.row }, [
                  h("span", { style: S.tag }, t(KIND_LABEL[it.kind] || "kind.other")),
                  h("span", { style: { fontWeight: 600 } }, it.name),
                  h("span", { style: S.note }, it.note || ""),
                ])),
              h("div", { key: "nav", style: { ...S.row, marginTop: 8 } }, [
                h("button", { style: S.btn, onClick: () => setWizard(null) }, t("wizard.cancel")),
                h("button", { style: S.btnPrimary, onClick: () => setWizard((w) => ({ ...w, step: 2 })) }, t("wizard.next")),
              ]),
            ]),
            wizard.step === 2 && h("div", { key: "s2" }, [
              h("div", { style: S.note }, t("wizard.selectHint")),
              CATEGORIES.filter((c) => c.id !== "doctor" && c.id !== "sessions").map((c) => {
                const checked = wizard.chosen.includes(c.id);
                return h("label", { key: c.id, style: { ...S.row, cursor: "pointer" } }, [
                  h("input", {
                    type: "checkbox", checked,
                    onChange: (e) => {
                      const next = new Set(wizard.chosen);
                      if (e.target.checked) next.add(c.id); else next.delete(c.id);
                      setWizard((w) => ({ ...w, chosen: [...next] }));
                    },
                    style: S.check,
                  }),
                  h("span", null, t(c.labelKey)),
                ]);
              }),
              h("div", { key: "counts", style: { ...S.row, ...S.note } },
                "MCP：" + (selMCP ? selMCP.size : 0) + " / " + mcpNames.length +
                " · 技能：" + (selSkills ? selSkills.size : 0) + " / " + skillNames.length +
                "（在下方分类卡片中细化勾选）"),
              h("div", { key: "nav", style: { ...S.row, marginTop: 8 } }, [
                h("button", { style: S.btn, onClick: () => setWizard((w) => ({ ...w, step: 1 })) }, t("wizard.back")),
                h("button", { style: S.btnPrimary, onClick: () => wizardRun(wizard.chosen) }, t("wizard.next")),
              ]),
            ]),
            wizard.step === 3 && h("div", { key: "s3" }, [
              h("div", { style: S.row }, h("span", null, t("wizard.running", { label: wizard.running || "" }))),
              h("div", { style: S.progress }, h("div", { style: S.progressBar })),
            ]),
            wizard.step === 4 && h("div", { key: "s4" }, [
              h("div", { style: { ...S.row, fontWeight: 600 } }, t("wizard.done")),
              (wizard.results || []).map((r, i) => {
                const rep = r.report || {};
                const sum = rep.summary || {};
                const cat = CATEGORIES.find((c) => c.id === r.action);
                return h("div", { key: i, style: S.row }, [
                  h("span", { style: { fontWeight: 600, minWidth: 90 } }, t((cat || {}).labelKey || r.action)),
                  h("span", { style: S.badge(rep.ok === false ? "invalid" : "migrated") }, rep.ok === false ? "失败" : "完成"),
                  h("span", { style: S.note }, fmt(t("wizard.summary"), { ok: sum.migrated ?? 0, skip: sum.skipped ?? 0, warn: sum.warnings ?? 0 })),
                ]);
              }),
              h("div", { key: "nav", style: { ...S.row, marginTop: 8 } }, [
                h("button", { style: S.btn, onClick: () => setWizard(null) }, t("wizard.cancel")),
                h("button", { style: S.btnPrimary, onClick: () => setWizard(null) }, t("wizard.done")),
              ]),
            ]),
          ]),
        ]),

        // 分类迁移
        h("div", { key: "cats", style: S.section },
          h("div", { style: S.title }, t("cat.title")),
          CATEGORIES.map((c) => {
            const isBusy = busy === c.id;
            return h("div", { key: c.id, style: S.card }, [
              h("div", { key: "head", style: { display: "flex", alignItems: "center", justifyContent: "space-between" } }, [
                h("span", { style: S.cardTitle }, t(c.labelKey)),
                h("div", { key: "btns", style: { display: "flex", gap: 6 } }, [
                  h("button", { style: { ...S.btn, ...(isBusy ? S.disabled : {}) }, disabled: isBusy, onClick: () => run(c.id, { apply: false }) },
                    isBusy ? t("action.busy") : t("action.preview")),
                  h("button", { style: { ...S.btnPrimary, ...(isBusy ? S.disabled : {}) }, disabled: isBusy, onClick: () => run(c.id, { apply: true }) },
                    t("action.apply")),
                ]),
              ]),
              c.id === "mcp" && h("div", { key: "mcp-list", style: { marginTop: 4 } }, [
                h("div", { style: { ...S.row, gap: 10 } }, [
                  h("button", { style: S.btnGhost, onClick: () => setSelMCP(new Set(mcpNames)) }, t("select.all")),
                  h("button", { style: S.btnGhost, onClick: () => setSelMCP(new Set()) }, t("select.none")),
                  h("span", { style: S.note }, fmt(t("select.keep"), { n: selMCP ? selMCP.size : 0 })),
                ]),
                mcpNames.map((name) =>
                  h("label", { key: name, style: { ...S.row, cursor: "pointer", paddingLeft: 4 } }, [
                    h("input", { type: "checkbox", checked: selMCP && selMCP.has(name), onChange: () => toggleSet(setSelMCP, name), style: S.check }),
                    h("span", { style: { fontFamily: "monospace", fontSize: 12 } }, name),
                  ])),
                toolNames.length > 0 &&
                  h("div", { key: "tools-note", style: { ...S.row, ...S.note } },
                    t("cat.tools") + "：" + toolNames.join(", ") + "（随 MCP 迁移复制并重写路径）"),
              ]),
              c.id === "skills" && h("div", { key: "skills-list", style: { marginTop: 4 } }, [
                h("div", { style: { ...S.row, gap: 10 } }, [
                  h("button", { style: S.btnGhost, onClick: () => setSelSkills(new Set(skillNames)) }, t("select.all")),
                  h("button", { style: S.btnGhost, onClick: () => setSelSkills(new Set()) }, t("select.none")),
                  h("button", {
                    style: S.btnGhost,
                    onClick: () => setSelSkills(new Set(skillNames.filter((n) => !n.startsWith("ccpanes-")))),
                  }, "仅非 ccpanes"),
                  h("span", { style: S.note }, fmt(t("select.keep"), { n: selSkills ? selSkills.size : 0 })),
                ]),
                skillNames.map((name) =>
                  h("label", { key: name, style: { ...S.row, cursor: "pointer", paddingLeft: 4 } }, [
                    h("input", { type: "checkbox", checked: selSkills && selSkills.has(name), onChange: () => toggleSet(setSelSkills, name), style: S.check }),
                    h("span", { style: { fontFamily: "monospace", fontSize: 12 } }, name),
                  ])),
              ]),
            ]);
          }),
        ),

        // 最近结果
        h("div", { key: "result", style: S.section }, [
          h("div", { style: S.title }, t("result.title")),
          result
            ? [
                h("div", { key: "summary", style: S.row },
                  h("span", null,
                    "ok=" + String(result.ok) + " · migrated=" + (result.summary ? result.summary.migrated : 0) +
                    " · skipped=" + (result.summary ? result.summary.skipped : 0) +
                    " · warnings=" + (result.summary ? result.summary.warnings : 0))),
                (result.items || []).slice(0, 40).map((it, i) =>
                  h("div", { key: "item" + i, style: S.row }, [
                    h("span", { style: S.badge(it.status) }, t("badge." + it.status) || it.status),
                    h("span", { style: S.tag }, t(KIND_LABEL[it.kind] || "kind.other")),
                    h("span", { style: { fontWeight: 600 } }, it.name),
                    h("span", { style: S.note }, it.note || ""),
                  ])),
                (result.warnings || []).map((w, i) =>
                  h("div", { key: "warn" + i, style: { ...S.row, ...S.warn } },
                    h("span", null, "⚠ " + w))),
              ]
            : h("div", { key: "empty", style: S.note }, t("result.empty")),
        ]),

        h("div", { key: "tip", style: S.tip }, t("tip")),
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
          () => h(MigrateTab, { t }),
        );
      });
    }

    module.exports = { name, inject, apply };
    return module.exports;
  },
});
