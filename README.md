# ssh-server

一个只在本机运行的网页：在浏览器里和本机的 Claude Code 或 Codex 对话，让它们修改和运行 SSH 服务器上的项目。

适用场景：

- 服务器访问不了 LLM 服务，只能和本地电脑通信；
- 服务器多人共用、没有 root、没有 git，不希望在上面放任何 LLM 配置、密钥或对话记录；
- 服务器上的项目数据很大（几百 GB 到 TB），只想把代码同步到本地。

## 目标工作方式

```text
浏览器（127.0.0.1）
   │
本地后端（Node.js + TypeScript + Fastify）
   ├─ Claude Agent SDK / Codex ──► 本机 Claude Code / Codex（沿用本机配置）
   │        │
   │        ├─ 改代码 ──► 本地副本（本地 git，手动保存版本）
   │        └─ 运行命令 ──► 远程执行工具 ──► SSH ──► 服务器
   ├─ rclone bisync ◄──► 服务器项目目录（只同步代码和小文件）
   ├─ 网页文件编辑 ──► 本地脚本保存 ──► 自动同步
   ├─ 网页终端 ──► SSH 交互 shell（服务器已有工具）
   └─ 资源面板 ──► SSH 只读采样（GPU / CPU / 内存等，不调用模型）
```

- 模型、服务商、密钥全部沿用本机 `~/.claude`、`~/.codex` 的配置，用 cc-switch 切换后新对话自动生效。
- 一个会话固定 Claude 或 Codex；上下文、续接、压缩和 skills / 命令沿用对应官方运行时。
- SSH 支持账号密码和已有私钥，密码仅用于本地内存中的当前连接周期，不持久化；当前 M1 尚只有私钥认证。
- 服务器上不安装任何东西，只需要已有的 SSH 账号。
- 大文件（数据、模型权重、输出）只留在服务器上，Agent 需要时通过远程工具查看。
- Python 统计、绘图和结果处理默认在服务器已有环境执行，返回必要摘要或小文件；本地后端负责协调，不需要因项目使用 Python 而更换后端。
- 本地编辑后自动同步，执行前同步失败则暂停运行；不要求手动 git 提交或服务器拉取。编辑器“保存文件”和 git“保存版本”分别处理。
- 训练结果由用户手动发消息要求查看，Agent 再读取远程结果；不自动检测完成、不自动续跑分析。资源面板独立刷新，不依赖 `nvitop`。
- 终端视觉与交互参考 Pebrel，手动编辑使用成熟轻量组件；具体编辑器组件仍待选定。
- 对话、终端、资源刷新与同步通过异步 I/O 协调；同一会话单轮运行，同一工作区同步串行。当前沿用 Node.js 本地启动，独立 `.exe` 打包或 Go 迁移未加入交付范围。

以上是目标行为。当前 M1 已有 Claude 对话和 SSH 远程工具，同步、密码输入、Codex、网页编辑器、终端及资源面板尚未实现，详见路线图。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/product/requirements.md](docs/product/requirements.md) | 需求、约束、验收标准 |
| [docs/product/ui-layout.md](docs/product/ui-layout.md) | 界面布局与交互 |
| [docs/engineering/architecture.md](docs/engineering/architecture.md) | 技术栈、本地协调与远程计算、并发、模块设计和关键流程 |
| [docs/engineering/decisions.md](docs/engineering/decisions.md) | 已确认的取舍、后端选型比较、Python 分析位置、打包与接入边界 |
| [docs/guides/dev-environment.md](docs/guides/dev-environment.md) | 开发环境、代码规范、项目 skill、已知问题 |
| [docs/roadmap.md](docs/roadmap.md) | 里程碑与当前进度 |

## 环境要求

- Windows 10/11（首要支持平台）
- Node.js 22+、git
- 本机已安装并配置好 Claude Code 和/或 Codex CLI
- rclone（同步用，开发到对应阶段时说明安装方式）
- SSH 服务器的账号及可用认证方式：目标支持账号密码 / 私钥；当前 M1 需要 `~/.ssh/config` Host、可读私钥和已登记的 `known_hosts`
- Python：本机仅在开发 skill 需要时使用；远程分析使用服务器已有 Python / 项目环境，不在服务器安装软件

## 开发检查

提交前运行 `npm run check`：类型检查、ESLint（含圈复杂度）、Prettier、重复率、测试与覆盖率。门槛见 [docs/guides/dev-environment.md](docs/guides/dev-environment.md) 1.3。

## 安全说明

- 后端只监听 `127.0.0.1`，并校验访问令牌和请求来源，不要把端口暴露到局域网或公网。
- 这个工具能在服务器上执行命令。Agent 的远程命令经过黑名单过滤，但黑名单只能防误操作，挡不住有意绕过；网页终端是你本人操作，不受黑名单限制。
- 不要用 root 账号连接服务器。

## 状态

开发中：M1 Task 1–10 已实现，真实模型 / SSH 端到端验收未完成；`e2e:m1` 对应脚本尚未创建。需求及后端选型已更新于 2026-10-02，新增功能仍待相应里程碑实施，见 [路线图](docs/roadmap.md)。
