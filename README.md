# ssh-server

一个只在本机运行的网页：在浏览器里和本机的 Claude Code 或 Codex 对话，让它们修改和运行 SSH 服务器上的项目。

适用场景：

- 服务器访问不了 LLM 服务，只能和本地电脑通信；
- 服务器多人共用、没有 root、没有 git，不希望在上面放任何 LLM 配置、密钥或对话记录；
- 服务器上的项目数据很大（几百 GB 到 TB），只想把代码同步到本地。

## 工作方式

```text
浏览器（127.0.0.1）
   │
本地后端（Node.js）
   ├─ Claude Agent SDK / Codex ──► 本机 Claude Code / Codex（沿用本机配置）
   │        │
   │        ├─ 改代码 ──► 本地副本（本地 git，手动保存）
   │        └─ 运行命令 ──► 远程执行工具 ──► SSH ──► 服务器
   ├─ rclone bisync ◄──► 服务器项目目录（只同步代码和小文件）
   └─ 网页终端 ──► SSH 交互 shell（sinfo、nvitop 等）
```

- 模型、服务商、密钥全部沿用本机 `~/.claude`、`~/.codex` 的配置，用 cc-switch 切换后新对话自动生效。
- 服务器上不安装任何东西，只需要已有的 SSH 账号。
- 大文件（数据、模型权重、输出）只留在服务器上，Agent 需要时通过远程工具查看。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/product/requirements.md](docs/product/requirements.md) | 需求、约束、验收标准 |
| [docs/product/ui-layout.md](docs/product/ui-layout.md) | 界面布局与交互 |
| [docs/engineering/architecture.md](docs/engineering/architecture.md) | 技术栈、仓库结构、模块设计、关键流程、设计决策 |
| [docs/guides/dev-environment.md](docs/guides/dev-environment.md) | 开发环境、代码规范、项目 skill、已知问题 |
| [docs/roadmap.md](docs/roadmap.md) | 里程碑与当前进度 |

## 环境要求

- Windows 10/11（首要支持平台）
- Node.js 22+、git
- 本机已安装并配置好 Claude Code 和/或 Codex CLI
- rclone（同步用，开发到对应阶段时说明安装方式）
- `~/.ssh/config` 中已配置好服务器，且可以用密钥免密登录

## 安全说明

- 后端只监听 `127.0.0.1`，并校验访问令牌和请求来源，不要把端口暴露到局域网或公网。
- 这个工具能在服务器上执行命令。Agent 的远程命令经过黑名单过滤，但黑名单只能防误操作，挡不住有意绕过；网页终端是你本人操作，不受黑名单限制。
- 不要用 root 账号连接服务器。

## 状态

开发中，当前进度见 [docs/roadmap.md](docs/roadmap.md)。
