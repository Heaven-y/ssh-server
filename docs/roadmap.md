# 路线图

验收编号见 [product/requirements.md](product/requirements.md) 第 6 节。

| 里程碑 | 内容 | 验收 | 状态 |
|---|---|---|---|
| M0 | 文档、仓库规范、项目 skill | — | 完成 |
| M1 | 最小链路：后端 + 访问控制 + 手动配置的工作区 + Claude 对话（流式）+ `remote_exec` + 命令黑名单 | A1、A11 | 进行中 |
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
- [x] 首次提交

## M1 进度

计划见 [superpowers/plans/2026-10-01-m1-minimal-chain.md](superpowers/plans/2026-10-01-m1-minimal-chain.md)。

- [x] Task 1–9：workspaces 骨架、共享协议、命令黑名单、ssh config 与 known_hosts、远程执行与连接池、工作区存储、访问控制、远程工具 MCP、Claude 适配器与对话 WebSocket
- [x] Task 10：前端（工作区、会话、对话界面）；`npm test`、`npm run typecheck`、`npm run build -w @ssh-server/web` 通过，浏览器冒烟检查通过（登录、空状态、表单校验、连接状态、控制台无错误）
- [x] 复用成熟库：规范写入 [guides/dev-environment.md](guides/dev-environment.md) 1.1、1.2；`ssh-config.ts` 改用 `ssh-config` 库；前端使用 react-query、partysocket、use-stick-to-bottom
- [x] 工程检查：`npm run check`（类型、ESLint 与复杂度、Prettier、jscpd 重复率、Vitest 覆盖率）与 GitHub Actions；超标的 7 个函数已拆分，补测试后行覆盖 92%（见 [guides/dev-environment.md](guides/dev-environment.md) 1.3）
- [ ] Task 11：真实服务器验收（`npm run e2e:m1`、浏览器端到端）与文档收尾——需要用户提供可用的 SSH Host
