# AGENTS.md

开发本仓库时 Agent（Codex、Claude Code）必须遵守的规则。细节见 `docs/`。

- 回复、文档、注释、提交信息使用中文。
- 开始任何任务前，先阅读并遵循 `.agents/skills/using-superpowers/SKILL.md`（项目未安装 superpowers 的启动钩子，靠这一步代替）。
- skill 内出现的 `${CLAUDE_PLUGIN_ROOT}/.claude/skills/<名称>/...` 一律改用 `.agents/skills/<名称>/...`（仓库根目录相对路径），不要依赖该变量。
- 文件使用 UTF-8、LF 换行；`.ps1` 例外，使用带 BOM 的 UTF-8。
- 仓库公开：不写入真实服务器地址、端口、用户名、密钥，示例用 `my-server`、`~/projects/demo`。
- 有成熟的库或组件就直接使用，不全部手写；选用标准与记录见 `docs/guides/dev-environment.md` 1.1、1.2。
- 后端沿用 Node.js + TypeScript + Fastify；Python 分析默认通过 SSH 在服务器已有环境执行。技术栈、并发与打包范围遵循 `docs/engineering/decisions.md` D19、D20 和 `docs/engineering/architecture.md`，不因讨论备选语言而自动迁移或增加打包任务。
- 未经用户明确要求不提交、不推送。
- 分支采用 `main` + 短期 `codex/<主题>`：`main` 保存已验证的阶段基线，新功能或修复从它创建工作分支；用户授权归并后优先快进合并，确认提交已保留且无工作树占用，再删除已合并分支。不得强制删除未合并分支或改写已发布历史，细则见 `docs/guides/dev-environment.md` 1.6。

## 文档

| 内容 | 位置 |
|---|---|
| 需求与验收标准 | `docs/product/requirements.md` |
| 界面布局 | `docs/product/ui-layout.md` |
| 架构与模块设计 | `docs/engineering/architecture.md` |
| 已确认的设计决策与取舍 | `docs/engineering/decisions.md` |
| 开发环境、代码规范、项目 skill、已知问题 | `docs/guides/dev-environment.md` |
| 里程碑与进度 | `docs/roadmap.md` |
| superpowers 产出的设计与计划 | `docs/superpowers/specs/`、`docs/superpowers/plans/` |

实现与文档不一致时，先更新文档或向用户确认。
