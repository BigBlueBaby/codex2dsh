# awesome-dsh-plugin 收录提交说明

> 状态：**材料已备齐，等待仓库创建满 1 天后提交**（CI 硬性门槛：仓库年龄 ≥ 1 天 + 提交数 ≥ 10，见 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)）。
> 目标仓库：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin

## 已完成的前置准备

- [x] 截图入库：`assets/screenshot-panel-top.png`、`assets/screenshot-panel-bottom.png`（已推送，raw URL 验证 200；底页截图已于 2026-08-25 刷新，含会话导入「修复标题」等新功能）
- [x] 仓库添加 `dsh-plugin` topic
- [x] npm 包 `codex2dsh@0.1.0` 已发布（repository 字段指向本仓库，自动关联下载量）
- [x] `package.json` 声明 `dsh.bundle.patch` + 仓库根 `cordis.patch.yml`（可安装性校验通过）
- [x] `peerDependencies` 使用带预发布分支的语义化范围（`^0.1.0-rc.6` 可匹配 0.1.0-rc.x）

## 待提交内容（3 个文件）

### 1. 新增 `data/plugins/BigBlueBaby__codex2dsh.yml`

```yaml
url: https://github.com/BigBlueBaby/codex2dsh
name: BigBlueBaby/codex2dsh
category: dev
description:
  en: "Migrate Codex MCP servers, skills, global instructions, memories and configuration into DeepSeek Harness with a visual migration panel and a four-step wizard."
  zh: "把 Codex 的 MCP、技能、全局指令、记忆与配置可视化迁移进 DeepSeek Harness，带全量迁移向导。"
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

## 提交流程（等满 1 天后执行）

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

## CI 校验点（提交前自查）

| 检查项 | 状态 |
| --- | --- |
| 仓库年龄 ≥ 1 天 | ⏳ 待满 1 天（创建于 2026-08-24） |
| 提交数 ≥ 10 | ✅ 已远超 |
| `dsh.bundle` manifest | ✅ 已声明 |
| 仓库含真实可用代码 | ✅ 83+ 测试、可视化面板、CI 全绿 |
| 描述属实（无夸大） | ✅ 描述只述功能 |
| `dsh-plugin` topic | ✅ 已添加 |
| 截图 URL 为 GitHub 托管 https | ✅ raw.githubusercontent.com |

> 若 CI 报错：按提示修改后 push 到同一分支即可，无需重开 PR。
