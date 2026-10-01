# 路线图

验收编号见 [product/requirements.md](product/requirements.md) 第 6 节。

| 里程碑 | 内容 | 验收 | 状态 |
|---|---|---|---|
| M0 | 文档、仓库规范、项目 skill | — | 进行中 |
| M1 | 最小链路：后端 + 访问控制 + 手动配置的工作区 + Claude 对话（流式）+ `remote_exec` + 命令黑名单 | A1、A11 | 未开始 |
| M2 | 同步：rclone bisync、过滤规则、删除检查与确认、冲突提示 | A2、A3、A4、A9 | 未开始 |
| M3 | 版本记录：保存、历史、diff、恢复 | A5 | 未开始 |
| M4 | Codex 适配器、模型选择、会话列表 / 删除 / 归档 | A6、A7、A8 | 未开始 |
| M5 | 新建工作区向导（本地与服务器目录浏览、同步预览）、网页终端 | A10 | 未开始 |
| M6 | 设置页、错误与空状态、端到端测试 | 全部复测 | 未开始 |

## M0 待办

- [x] 项目 skill 安装与验证（见 [guides/dev-environment.md](guides/dev-environment.md)）
- [x] README、AGENTS.md、CLAUDE.md
- [x] 需求、架构、界面布局、路线图
- [x] 复测 ui-ux-pro-max 脚本路径（guides/dev-environment.md 4.2）
- [x] 目录按用途划分（docs 分 product / engineering / guides，脚本移到 scripts/dev）
- [ ] 首次提交（等用户确认）
