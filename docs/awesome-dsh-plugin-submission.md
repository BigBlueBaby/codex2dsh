# awesome-dsh-plugin 收录提交说明

> 状态：**PR 已提交** ✅ — https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/3178（分支 `BigBlueBaby:add-codex2dsh`，2026-08-25），等待 CI 与维护者评审；合并后网站自动重建。
> 目标仓库：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin

## 已完成的前置准备

- [x] 截图入库：`assets/screenshot-panel-top.png`、`assets/screenshot-panel-bottom.png`（已推送，raw URL 验证 200；底页截图已于 2026-08-25 刷新，含会话导入「修复标题」等新功能）
- [x] 仓库添加 `dsh-plugin` topic
- [x] npm 包 `codex2dsh@0.1.0` 已发布（repository 字段指向本仓库，自动关联下载量）
- [x] `package.json` 声明 `dsh.bundle.patch` + 仓库根 `cordis.patch.yml`（可安装性校验通过）
- [x] `peerDependencies` 使用带预发布分支的语义化范围（`^0.1.0-rc.6` 可匹配 0.1.0-rc.x）

## 已提交内容（PR #3178，4 个文件）

### 1. 新增 `data/plugins/BigBlueBaby__codex2dsh.yml`

```yaml
url: https://github.com/BigBlueBaby/codex2dsh
name: BigBlueBaby/codex2dsh
category: dev
description:
  en: "Migrate Codex (OpenAI Codex CLI / Desktop) MCP servers, skills, instructions, memory and session history into DeepSeek Harness with a visual panel or CLI, with dry-run previews and secrets migrated as-is."
  zh: "把 Codex（OpenAI Codex CLI / Desktop）的 MCP 服务器、技能、全局指令、记忆与会话历史迁移进 DeepSeek Harness（DSH），支持可视化面板与命令行，带 dry-run 预览。"
```

> 分类说明：类别取 `dev`（开发工具）。维护者如觉得更贴切（如 `usage`）会自行调整，不会因此打回。

### 2. 更新 `data/screenshots.json`（新增 key）

```jsonc
"https://github.com/BigBlueBaby/codex2dsh": [
  "https://raw.githubusercontent.com/BigBlueBaby/codex2dsh/main/assets/screenshot-panel-top.png",
  "https://raw.githubusercontent.com/BigBlueBaby/codex2dsh/main/assets/screenshot-panel-bottom.png"
]
```

### 3. 重新生成两个 README（勿手改）

```sh
npm ci
node scripts/generate-readme.mjs
```

## 提交流程（已执行 ✅，2026-08-25）

```bash
# 1. fork 目标仓库并 clone
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin

# 2. 新建分支，添加上述 3 处修改
git checkout -b add-codex2dsh
#   - 新增 data/plugins/BigBlueBaby__codex2dsh.yml
#   - 编辑 data/screenshots.json（新增 codex2dsh key，1-8 张图）
#   - 编辑 data/added-dates.json（若 CI 要求，格式见文件内现有条目）

# 3. 重新生成 README
npm ci
node scripts/generate-readme.mjs

# 4. 提交推送并建 PR
git add -A
git commit -m "Add BigBlueBaby/codex2dsh"
git push origin add-codex2dsh
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "Add BigBlueBaby/codex2dsh" \
  --body "Codex → DSH migration plugin with visual panel (see contributing.md). Screenshots included in data/screenshots.json."
```

> ✅ 已实际执行：PR #3178（2026-08-25）。README 重新生成后仅新增本条目 1 行 × 2 份（en/zh），无邻居条目被改动；`data/added-dates.json` 本次 CI 未要求（按提示处理即可）。

## CI 校验点（提交前自查）

| 检查项 | 状态 |
| --- | --- |
| 仓库年龄 ≥ 1 天 | ✅ 已满（创建于 2026-08-24，提交于 08-25） |
| 提交数 ≥ 10 | ✅ 已远超 |
| `dsh.bundle` manifest | ✅ 已声明 |
| 仓库含真实可用代码 | ✅ 105+ 测试、可视化面板、CI 全绿 |
| 描述属实（无夸大） | ✅ 描述只述功能 |
| `dsh-plugin` topic | ✅ 已添加 |
| 截图 URL 为 GitHub 托管 https | ✅ raw.githubusercontent.com |

> 若 CI 报错：按提示修改后 push 到同一分支即可，无需重开 PR。
