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
   ├─ 服务器文件 ──► SSH/SFTP 浏览、移动与复制（不经本机中转）
   ├─ 网页终端 ──► SSH 交互 shell（服务器已有工具）
   └─ 资源面板 ──► SSH 只读采样（GPU / CPU / 内存等，不调用模型）
```

- Claude/Codex 对话沿用本机原生配置，网页可编辑对应原生配置文件。后续调用重读配置，运行中的轮次保留启动时设置；Codex 新会话采用新默认模型，历史续接保留原生会话模型，显式填写模型才覆盖。
- 一个会话固定 Claude 或 Codex，支持流式回复、工具结果、网页审批、中断、原生列表与续接；两类会话可重命名和删除，Codex 另支持归档与恢复。已接入技能/命令搜索选择、原生模型候选、上下文状态和手动压缩；上下文仍由官方运行时管理。
- SSH 已支持账号密码、已有私钥及 Windows 当前用户加密保存。断开后保留已保存密码并暂停自动连接；重新连接可复用，取消保存勾选会清除保存项并断开，不设独立“忘记密码”入口。
- 服务器上不安装任何东西，只需要已有的 SSH 账号。
- 大文件（数据、模型权重、输出）默认只留在服务器上，Agent 需要时通过远程工具查看；“服务器文件”视图已支持直接移动、复制、重命名和删除，只有显式下载才传回本机。
- Python 统计、绘图和结果处理默认在服务器已有环境执行，返回必要摘要或小文件；本地后端负责协调，不需要因项目使用 Python 而更换后端。
- 本地编辑后自动同步，执行前同步失败则暂停运行；不要求手动 git 提交或服务器拉取。编辑器“保存文件”和 git“保存版本”分别处理。
- 训练结果由用户手动发消息要求查看，Agent 再读取远程结果；不自动检测完成、不自动续跑分析。资源面板独立刷新，不依赖 `nvitop`。
- 终端视觉与交互参考 Pebrel，手动编辑复用 CodeMirror，支持常用脚本与配置文件。
- 对话、终端、资源刷新与同步通过异步 I/O 协调；同一会话单轮运行，同一工作区同步串行。当前沿用 Node.js 本地启动，独立 `.exe` 打包或 Go 迁移未加入交付范围。

当前已接入 Claude/Codex 对话、SSH 认证、rclone 双向同步、原生配置编辑、网页文件编辑和本地版本记录。版本保存、历史、差异与恢复按工作区限定范围；恢复保留 HEAD 和暂存区，再进入同步流程。删除确认、冲突保留与执行前后同步已实现；网页终端及原生Agent能力已接入；终端本机验收见[记录](docs/guides/web-terminal-acceptance.md)，资源面板、完整向导和多活动真实链路已完成核心范围，见[完整链路验收](docs/guides/real-workflow-acceptance.md)。

远端文件管理已提供“本地代码 / 服务器文件”双视图、右键菜单、目标选择和拖动操作；涉及已同步代码时协调两端路径，仅服务器文件不要求先同步到本机，也不调用模型。实际同/跨文件系统、混合目录和Firefox下载见[完整链路](docs/guides/real-workflow-acceptance.md)，真实失败与持久核对见[失败验收](docs/guides/remote-file-failure-acceptance.md)。范围与验收见 [需求 F10](docs/product/requirements.md#f10-远端文件管理) 和 [文件区布局](docs/product/ui-layout.md#54-服务器文件视图操作下载与同步协调已接入)。

技能与命令可通过按钮搜索，或在消息开头输入 `/` 自动补全；上下方向键选择、Enter 确认，保留附加参数，再次 Enter 发送。路径和参数区保持普通编辑，详见[补全验收](docs/guides/slash-completion-acceptance.md)。模型候选保留手动输入，目录失败不阻断普通消息。上下文只显示原生字段，压缩须由官方事件确认完成，见[原生能力验收](docs/guides/native-capabilities-acceptance.md)。

界面采用中性深色的对话工作区，SSH/同步显示紧凑摘要，详情和新建表单按需展开；参考依据、实际截图与验证范围见 [界面验收](docs/guides/workspace-ui-acceptance.md)。

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
- Node.js 22+、Git 2.43+（版本恢复使用目标提交的属性规则）
- 本机已安装并配置好 Claude Code 和/或 Codex CLI
- rclone **1.75.1**（本机运行，服务器不需要安装）；从 [官方版本下载](https://downloads.rclone.org/v1.75.1/) 安装并核对 SHA-256。放入 PATH，或将环境变量 `SSH_SERVER_RCLONE` 指向可执行文件。
- SSH 服务器的账号及可用认证方式：本机 `~/.ssh/config` Host、已登记的 `known_hosts`，以及可读私钥或网页输入的密码
- Python：本机仅在开发 skill 需要时使用；远程分析使用服务器已有 Python / 项目环境，不在服务器安装软件

## 开发检查

提交前按影响范围验证类型、ESLint（含圈复杂度）、格式及相关测试；`npm run check` 提供完整检查入口，适用于无可靠基准或全局改动。门槛见 [docs/guides/dev-environment.md](docs/guides/dev-environment.md) 1.3。

分支采用 `main`、保留的大功能分支与短期小功能分支。小分支合入所属大分支后可删除，大分支阶段合入 `main` 后仍保留；统一使用 `git merge --no-ff` 保存原始 commit 和合并节点。现有 `feat/ssh-workflow` 作为大分支保留，Codex 新建分支使用 `codex/` 前缀。本地归并与远端推送分别授权，完整流程见 [分支与提交规范](docs/guides/dev-environment.md#16-本仓库的-git-分支与提交)。

## 安全说明

- 后端只监听 `127.0.0.1`，并校验访问令牌和请求来源，不要把端口暴露到局域网或公网。
- 这个工具能在服务器上执行命令。Agent 的远程命令经过黑名单过滤，但黑名单只能防误操作，挡不住有意绕过；网页终端是你本人操作，不受黑名单限制。
- 不要用 root 账号连接服务器。

## 状态

开发中：M1 已有真实 Claude → MCP → SSH 验收脚本，M2 认证同步基础已完成；此前真实传输 6 项与网页同步 5 项通过，见[认证同步验收](docs/guides/m2-acceptance.md)。Codex app-server 0.156.1 已完成真实网页与 GLM 两轮对话、原生 MCP 工具调用、列表/历史读取和原 ID 续接，见[Codex 对话验收](docs/guides/codex-conversation-acceptance.md)及[配置验收](docs/guides/agent-config-acceptance.md)。

原生会话管理已接入，并使用临时合成记录通过真实 SDK/app-server 与网页验收，见[会话管理验收](docs/guides/session-management-acceptance.md)。A8 已验证网页及原生存储/API，VS Code 插件界面与 CLI 交互列表的刷新仍待独立验证。

[文件编辑](docs/guides/workspace-files-acceptance.md)与[本地版本记录](docs/guides/local-versions-acceptance.md)已有受控验收。本阶段 Codex 的 SSH/同步也使用受控替身；A5、A13、A7 实际 SSH 串联仍待指定 Host 与允许测试的目录，终端本机基础已验收，实际全屏工具、资源面板和完整并发验证仍待完成，见[路线图](docs/roadmap.md)。
