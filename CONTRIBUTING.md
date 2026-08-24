# 贡献指南

欢迎参与 codex2dsh！本项目按里程碑推进（见 [docs/08-路线图.md](docs/08-路线图.md)），所有工作以文档为基线。

## 快速开始

```bash
git clone <你的仓库地址> && cd codex2dsh
npm install          # 安装 @deepseek-ai/dsh-tools（devDependency）
npm test             # 运行 node:test 套件
npm run check:fixtures   # 夹具敏感词检查
node bin/codex2dsh.mjs preview --codex-home C:\Users\<你>\.codex   # 体验预览
```

## 开发流程

1. **先读文档**：`docs/01`–`docs/09`；改行为先改映射规范（`docs/03`），再改代码，最后同步测试与 CHANGELOG。
2. **模块约定**：`lib/` 中除 `tools.mjs/panel.mjs/command.mjs/index.mjs` 外都是纯函数（不依赖 `@deepseek-ai/*`），可独立单测。
3. **安全红线**（见 [docs/09-安全边界.md](docs/09-安全边界.md)）：
   - 永不写入 `~/.codex/**`；
   - 输出必须脱敏（`****`）；
   - 涉及 profile 的改动只产建议片段；
   - fixture 只放脱敏虚构数据（CI 有敏感词检查）。
4. **测试门槛**：新增功能必须带单测；`npm test` 全绿 + `check:fixtures` 通过。
5. **提交规范**：中文描述，遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `test:` / `chore:`），关联 REQ 编号（如 `feat(mcp): REQ-05 镜像写入幂等`）。

## 里程碑认领

| 里程碑 | 工作项 | 对应文档 |
| --- | --- | --- |
| M2 | `migrate_codex_skills` 落盘实现 | docs/03-映射规范 §4 · docs/05-实现方案 §1 |
| M3 | 指令/记忆/配置建议/doctor | docs/03-映射规范 §5–7 · §10 |
| M4 | 会话委托 / CLI 补齐 / 面板 | docs/03-映射规范 §8 · docs/04-插件API参考 |
| M5 | 发布与分享 | docs/07-发布与分享 |

认领前先在 Issue 说明方案；实现时保持与文档"状态行"同步更新。

## 安全披露

见 [SECURITY.md](SECURITY.md)。
