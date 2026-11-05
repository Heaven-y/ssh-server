# AGENTS.md

开发本仓库时 Agent（Codex、Claude Code）必须遵守的规则。

- 回复、文档、注释和提交信息使用中文。
- 开始任务前阅读 `.agents/skills/using-superpowers/SKILL.md`；本项目未安装启动钩子。
- skill 中 `${CLAUDE_PLUGIN_ROOT}/.claude/skills/<名称>/...` 改用仓库根目录下的 `.agents/skills/<名称>/...`。
- 仓库公开：不写入真实服务器地址、端口、用户名、密钥或会话正文，示例使用 `my-server`、`~/projects/demo`。
- 优先成熟组件，方案保持简单；技术栈沿用 Node.js + TypeScript + Fastify、React 与 Electron。服务器脚本只用已有环境，缺依赖不自动安装。
- 主线是各 CLI 原生会话与能力。先完成对话，再补原生配置，之后实现工作台插件；具体状态看路线图。
- 配置作用域、权限、Skills、MCP 与原生插件按各 CLI 实际支持处理，不自行强造用户/项目两层或覆盖原生默认。
- 工作台扩展采用自有插件接口，不建设 DSH 插件包兼容层；SSH Console 的目标以现有插件体验为基准，未迁移前不要把旧固定面板描述成已插件化。
- 未经用户明确要求不提交、不推送；当前会话的明确授权优先。分支与合并遵循开发指南：大功能分支保留、小分支完成后删除，合并使用 `git merge --no-ff`。
- 按改动影响范围验证，不无故重复全量测试；新增测试覆盖核心行为与真实回归，测试不写死开发机绝对路径。实现与文档不一致时先校正事实或说明待实现范围。
- 日常修改不自动递增版本号或重打安装包；拟升版本、制作新版本安装包或发布前，先说明本轮范围并取得用户确认。Git 提交与推送授权不等于版本发布授权。

## 文档入口

| 内容 | 位置 |
|---|---|
| 导航和历史追溯入口 | `docs/README.md` |
| 功能与验收要求 | `docs/product/requirements.md` |
| 界面与交互 | `docs/product/ui-layout.md` |
| 架构与实现约束 | `docs/engineering/architecture.md` |
| 当前取舍与理由 | `docs/engineering/decisions.md` |
| 开发环境、质量检查与 Git 规则 | `docs/guides/dev-environment.md` |
| 交付状态与开发顺序 | `docs/roadmap.md` |

新决策按主题重新排序，不再引用旧编号。移除过时文档前迁移仍有效的理由与约束，在文档头或追溯表留下稳定提交锚点；历史事实不覆盖，失败与未验证项不追认成通过。
