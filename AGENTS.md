# AGENTS.md

开发本仓库时 Agent（Codex、Claude Code）必须遵守的规则。细节见 `docs/`。

- 回复、文档、注释、提交信息使用中文。
- 开始任何任务前，先阅读并遵循 `.agents/skills/using-superpowers/SKILL.md`（项目未安装 superpowers 的启动钩子，靠这一步代替）。
- skill 内出现的 `${CLAUDE_PLUGIN_ROOT}/.claude/skills/<名称>/...` 一律改用 `.agents/skills/<名称>/...`（仓库根目录相对路径），不要依赖该变量。
- 仓库公开：不写入真实服务器地址、端口、用户名、密钥，示例用 `my-server`、`~/projects/demo`。
- 有成熟的库或组件就直接使用，不全部手写；选用标准与记录见 `docs/guides/dev-environment.md` 1.1、1.2。
- 后端沿用 Node.js + TypeScript + Fastify；Python 分析默认通过 SSH 在服务器已有环境执行。技术栈与打包范围以 `docs/engineering/decisions.md` D19、D20 和 `docs/engineering/architecture.md` 为准。
- 未经用户明确要求不提交、不推送。
- Git 分支与提交遵循 `docs/guides/dev-environment.md` 1.6：大功能分支负责一个完整功能域、合入 `main` 后保留，小分支负责一项子功能、合入后删除，合并统一使用 `git merge --no-ff`，本地与远端保持同步。

## 文档

| 内容 | 位置 |
|---|---|
| 需求与验收标准 | `docs/product/requirements.md` |
| 界面布局 | `docs/product/ui-layout.md` |
| 架构与模块设计 | `docs/engineering/architecture.md` |
| 已确认的设计决策与取舍 | `docs/engineering/decisions.md` |
| 开发环境、代码规范、项目 skill、已知问题 | `docs/guides/dev-environment.md` |
| 里程碑与进度 | `docs/roadmap.md` |
| 最新交付验收与精选截图 | `docs/guides/ui-usability-optimization-acceptance.md` |

实现与文档不一致时，先更新文档或向用户确认。

文档入口与适用规则见 `docs/README.md`。决策记录属于长期追溯资料：保留 `docs/engineering/decisions.md` 中的背景、理由、约束和替代关系，不因资料精简删除决策或覆盖历史事实；删除重复过程稿前，把独有的有效取舍迁入现行说明并保留提交锚点。
