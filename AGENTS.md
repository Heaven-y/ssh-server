# AGENTS.md

开发本仓库时 Agent（Codex、Claude Code）必须遵守的规则。细节见 `docs/`。

- 回复、文档、注释、提交信息使用中文。
- 开始任何任务前，先阅读并遵循 `.agents/skills/using-superpowers/SKILL.md`（项目未安装 superpowers 的启动钩子，靠这一步代替）。
- skill 内出现的 `${CLAUDE_PLUGIN_ROOT}/.claude/skills/<名称>/...` 一律改用 `.agents/skills/<名称>/...`（仓库根目录相对路径），不要依赖该变量。
- 文件使用 UTF-8、LF 换行；`.ps1` 例外，使用带 BOM 的 UTF-8。
- 仓库公开：不写入真实服务器地址、端口、用户名、密钥，示例用 `my-server`、`~/projects/demo`。
- 有成熟的库或组件就直接使用，不全部手写；选用标准与记录见 `docs/guides/dev-environment.md` 1.1、1.2。
- 未经用户明确要求不提交、不推送。

## 文档

| 内容 | 位置 |
|---|---|
| 需求与验收标准 | `docs/product/requirements.md` |
| 界面布局 | `docs/product/ui-layout.md` |
| 架构与设计决策 | `docs/engineering/architecture.md` |
| 开发环境、代码规范、项目 skill、已知问题 | `docs/guides/dev-environment.md` |
| 里程碑与进度 | `docs/roadmap.md` |
| superpowers 产出的设计与计划 | `docs/superpowers/specs/`、`docs/superpowers/plans/` |

实现与文档不一致时，先更新文档或向用户确认。
