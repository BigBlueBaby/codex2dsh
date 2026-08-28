<div align="center">

# 🔁 Codex2DSH

**Migrate your Codex (OpenAI Codex CLI / Desktop) MCP servers, skills, global instructions, memories and session history into DeepSeek Harness (DSH) — fully visual, no CLI required.**

[![npm version](https://img.shields.io/npm/v/codex2dsh?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/codex2dsh)
[![npm downloads](https://img.shields.io/npm/dm/codex2dsh?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/codex2dsh)
[![CI](https://img.shields.io/github/actions/workflow/status/BigBlueBaby/codex2dsh/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/BigBlueBaby/codex2dsh/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Node.js >= 22.19](https://img.shields.io/badge/Node.js-%3E%3D22.19-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)

[简体中文](README.md) · **English**

</div>

> **One-liner**: Your Codex configuration is an asset, not a cage. `codex2dsh` "translates" your accumulated MCP servers, skills, global rules, memories and session history into native DSH form — with **read-only sources, secrets migrated as-is by default, dry-run previews, and human confirmation**.

## ✨ Features

| Capability | Entry point | What it does |
| --- | --- | --- |
| 🖥️ **Visual migration panel** | Settings → Plugins → Codex Migration | Status overview + migration options + 4-step guided wizard + per-category cards + result badges |
| **MCP mirror** | Panel MCP card / `migrate_codex_mcp` | Parse `[mcp_servers.*]` from `config.toml` → mergeable DSH MCP client YAML; **secrets migrated as-is by default** (optional masking); `include/exclude` filters; **local tool directories (e.g. mcp-toolbox) moved along and paths rewritten** |
| **Skills conversion** | Panel skills card / `migrate_codex_skills` | `~/.codex/skills/<name>/SKILL.md` → DSH skill assets (frontmatter adapted, `kind: dsh`), scripts co-migrated, idempotent with conflict disambiguation; **prefix-based bulk exclusion** (e.g. `ccpanes-`) |
| **Global instructions** | Panel instructions card / `migrate_codex_instructions` | `AGENTS.md` / `instructions.md` → `$DSH_HOME/AGENTS.md` (the only user-global instructions file DSH reads); **Codex-specific references auto-adapted** (tool paths rewritten, MCP prefix normalized, unconfigured MCP references warned) |
| **Migration verification** | Panel checkup card / `codex2dsh_verify` | Read-only "is it actually usable in DSH" check: mirror merged into profile? commands/config paths exist? AGENTS.md references hold up? |
| **Memory migration** | Panel memory card / `migrate_codex_memory` | Codex memories (incl. read-only sqlite probe) → DSH memory assets |
| **Memory import to dsh-mnemon** | `codex2dsh_import_memory` / CLI `memory-import` | Import migrated Codex memories into **dsh-mnemon** (global memory engine, `~/.mnemon`): Runtime layer distills `memory_summary.md` into per-turn injected USER/MEMORY entries; Documents layer imports the full memory files (searchable) |
| **Config suggestions** | Panel config card / `migrate_codex_config` | Model / Provider / permissions / project trust → read-only suggestion snippet (never touches `settings.yaml` automatically) |
| **Session import** | Panel sessions card / `migrate_codex_sessions` | Delegates to **dsh-chat-import** (`import_chat`, `format: 'codex'`) for continuable sessions |
| **Session title backfill** | Panel "Fix titles" / `codex2dsh_fix_titles` | Chinese titles lost after import (shown as workspace names): backfill from `~/.codex/session_index.jsonl` `thread_name` or the first real question in the rollout (append-only, idempotent, live sessions skipped) |
| **Bad title repair** | CLI `codex2dsh repair-titles` | Fix 0.1.1-era broken `session/title` events (`SessionPersistenceCorruptionError`); truncation-style fix, zero data loss |
| **Workspace regrouping** | Panel "Organize workspaces" / `codex2dsh_regroup_sessions` | Codex non-workspace sessions each got their own workspace after import: unify `header.cwd` and move log dirs into a single DSH workspace (authoritative via `projectless-thread-ids`) |
| **Migration doctor** | Panel checkup card / `codex2dsh_doctor` | Per-asset status: migrated / pending / unmigratable / secret residue |
| **CLI** | `codex2dsh` | Same capabilities without a GUI: `preview / mcp / skills / instructions / memory / config / sessions / titles / repair-titles / regroup / doctor / ledger` |

## 📥 Install

**Requirements**: Node.js ≥ 22.19 · DeepSeek Harness ≥ 0.1.x · an existing Codex config (`~/.codex/`)

```bash
# DSH Desktop users (desktop profile):
dsh plugin --profile desktop add codex2dsh

# dsh CLI / Web profile users:
dsh plugin --profile web add codex2dsh
```

Restart DSH, then open **Settings → Plugins → Codex Migration**.

> Uninstall: `dsh plugin --profile <name> remove codex2dsh` — migrated assets are never deleted.

## 🚀 Quick start

1. Open the panel, check the **status overview** (source root, asset list, secret warnings).
2. Click **Start full migration** → the 4-step wizard runs **preview → select → execute → done**.
3. Review generated artifacts (e.g. `mcp-mirror.cordis.yml`) and merge the `- insert:` blocks into your profile's `cordis.patch.yml` (see [FAQ](#-faq)), then restart DSH.
4. Optional: use the per-category cards for fine-grained selection (e.g. keep only `google-mcp-toolbox`; exclude skills by prefix like `ccpanes-`).

CLI equivalent:

```bash
codex2dsh preview                      # read-only preview of all assets
codex2dsh mcp --apply                  # generate MCP mirror (secrets as-is; --mask-secrets to mask)
codex2dsh skills --apply --exclude ccpanes-*
codex2dsh titles                       # preview title backfill
codex2dsh repair-titles --apply        # fix broken title events (restart DSH after)
codex2dsh regroup --apply              # regroup non-workspace sessions (restart DSH after)
codex2dsh doctor                       # migration health check
codex2dsh ledger                       # migration ledger
```

## 🔒 Security

- **Read-only sources**: files under `~/.codex/**` are never written, moved or deleted.
- **Secrets migrated as-is by default** so migrated configs work immediately — artifacts contain real credentials, **never commit them to a public repo**; the panel can switch to masking (`****`) in one click.
- **Credential files untouched**: `auth.json` etc. are only reported as existing, never read or migrated.
- **Dry-run first**: every write operation defaults to preview until you confirm.
- **No automatic profile edits**: MCP / config generate reviewable snippets only; merging is always manual.
- **Idempotent, no overwrite**: existing targets with different content are refused unless `force`.

## ❓ FAQ

**How do I actually get the migrated MCP servers working in DSH?**
Migration produces a review snippet (`~/.dsh/codex2dsh/mcp-mirror.cordis.yml`). Merge the `- insert:` block into your profile's `cordis.patch.yml` (`~/.dsh/profiles/<profile>/cordis.patch.yml`), then restart DSH.

**Which profile should I install to?**
The **currently active profile** shown in DSH Desktop settings (usually `desktop` or `web`). `dsh plugin --profile <active> add codex2dsh`.

**Where do migrated assets land?**
Skills → `~/.agents/skills/<name>/` · instructions → `$DSH_HOME/AGENTS.md` · memories → `~/.dsh/memories/codex/` (+ `~/.mnemon` via dsh-mnemon import) · MCP mirror & ledger → `~/.dsh/codex2dsh/`.

**Imported session titles lost / shown as workspace names?**
`import_chat` writes no `session/title` event, so DSH falls back to the first user message — which in Codex rollouts is usually a harness injection. Fix: panel **Sessions → Fix titles** (or `codex2dsh_fix_titles`), titles taken from `thread_name` or the first real question; append-only and idempotent.

**Session won't open, `SessionPersistenceCorruptionError: ... is not surface-eligible ...`?**
A 0.1.1-era backfill bug wrote `session/title` with a `surfaceOp`. Run `codex2dsh repair-titles --apply` outside DSH, restart DSH, then re-run "Fix titles".

## 📚 Docs

| Doc | Content |
| --- | --- |
| [01-Architecture](docs/01-总体架构.md) | Goals, DSH plugin system, tech stack |
| [02-Codex Anatomy](docs/02-Codex配置解剖.md) | Codex config anatomy (config.toml / skills / memory / credentials) |
| [03-Mapping Spec](docs/03-映射规范.md) | Per-asset mapping rules |
| [06-Tests & Acceptance](docs/06-测试与验收.md) | Test strategy & acceptance matrix |
| [09-Security Boundary](docs/09-安全边界.md) | Security promises & secret policy |

## 🤝 Contributing & Thanks

- Bugs / ideas → [Issues](https://github.com/BigBlueBaby/codex2dsh/issues) · development → [CONTRIBUTING.md](CONTRIBUTING.md) · changelog → [CHANGELOG.md](CHANGELOG.md)
- Open-source projects referenced by this plugin (no runtime deps, optional cooperation / target platform / format contracts):
  - [**dsh-chat-import**](https://github.com/Nwflower/dsh-chat-import) — session import delegation (`import_chat`)
  - [**dsh-mnemon**](https://github.com/omdsh-dev/dsh-mnemon) — global memory engine for memory import
  - [**DeepSeek Harness**](https://github.com/deepseek-ai/deepseek-harness) — plugin host platform & `@deepseek-ai/dsh-mcp-client` contract

## 📄 License

MIT — see [LICENSE](LICENSE).

> ⚠️ Disclaimer: this plugin only "translates" configuration. It does not assume responsibility for target servers, credentials or access-policy compliance. Read [docs/09-安全边界.md](docs/09-安全边界.md) before migrating MCP configs that contain secrets.
