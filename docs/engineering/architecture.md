# 架构

## 1. 总览

```text
┌─────────────────────────── 本机 ───────────────────────────┐
│  浏览器 http://127.0.0.1:<端口>/?token=…                    │
│      │ HTTP + WebSocket                                     │
│  后端（Node.js）                                             │
│   ├─ agents     ──► Claude Agent SDK ──► 本机 Claude Code    │
│   │               └► Codex app-server ──► 本机 Codex         │
│   │                    │ 调用 MCP 工具                        │
│   ├─ remote-tools（stdio MCP，转发给后端内部接口）            │
│   ├─ ssh        ──► ssh2 连接池（执行命令、目录浏览、终端）    │
│   ├─ sync       ──► rclone bisync（SFTP）                    │
│   ├─ vcs        ──► 本机 git（工作区本地文件夹）              │
│   ├─ sessions   ──► SDK 会话接口 / Codex thread 接口          │
│   └─ workspaces ──► 本地 JSON 配置                            │
└─────────────────────────────┬──────────────────────────────┘
                              │ SSH（已有账号与密钥）
┌──────────────── 服务器（不安装任何东西）────────────────────┐
│  ~/projects/demo  ← 代码与小文件双向同步；大文件只在这里      │
└────────────────────────────────────────────────────────────┘
```

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 运行环境 | Node.js 22 + TypeScript | |
| 后端 | Fastify + `@fastify/websocket` | HTTP 接口与流式消息 |
| 参数校验 | zod | 接口入参、配置文件 |
| Claude | `@anthropic-ai/claude-agent-sdk` | 调用本机 Claude Code |
| Codex | Codex app-server（JSON-RPC over stdio），可选 `@openai/codex-sdk` | 需要 `thread/delete` 等会话接口，SDK 未必全部暴露，见 5.1 与待验证 V3 |
| MCP | `@modelcontextprotocol/sdk` | 远程工具服务 |
| SSH | `ssh2` | 读取 `~/.ssh/config`，长连接，支持交互 shell |
| 同步 | rclone（外部可执行文件） | `rclone bisync` 走 SFTP |
| 版本记录 | 本机 git（外部命令） | |
| 前端 | React + Vite + Tailwind CSS | |
| 终端 | xterm.js | |
| 存储 | JSON 文件 | 只存工作区配置，不存对话 |

依赖版本在开始实现时固定，并与本机 codex CLI 版本对齐。

## 3. 仓库结构

使用 npm workspaces，前后端各自管理依赖、TypeScript 配置和测试，前后端共用的类型放在 `packages/shared`。

```text
ssh-server/
├─ apps/
│  ├─ server/                  # 本地后端（Node + Fastify）
│  │  └─ src/
│  │     ├─ main.ts            # 启动入口：监听 127.0.0.1、生成访问令牌
│  │     ├─ http/              # 路由、令牌与来源校验
│  │     ├─ agents/            # Claude / Codex 适配器，统一事件格式
│  │     ├─ remote-tools/      # stdio MCP 服务（单独入口，由 Agent 启动）
│  │     ├─ ssh/               # ssh config 解析、连接池、exec、shell、目录浏览
│  │     ├─ sync/              # rclone 调用、过滤规则、删除检查
│  │     ├─ vcs/               # git 状态、保存、历史、恢复
│  │     ├─ sessions/          # 会话列表、删除、归档
│  │     ├─ policy/            # 命令黑名单
│  │     └─ workspaces/        # 工作区配置读写
│  └─ web/                     # 前端（React + Vite）
│     └─ src/
│        ├─ app/               # 外壳、路由、全局状态
│        ├─ features/          # chat、workspaces、sync、terminal、history、settings
│        ├─ components/        # 通用界面组件
│        └─ lib/               # 接口客户端、工具函数
├─ packages/
│  └─ shared/                  # 前后端共用类型与数据结构（AgentEvent、接口参数）
├─ tests/
│  └─ e2e/                     # 端到端测试（Playwright）
├─ scripts/
│  └─ dev/                     # 开发辅助脚本
└─ docs/
   ├─ product/                 # 做什么：需求、界面布局
   ├─ engineering/             # 怎么做：架构与设计决策
   ├─ guides/                  # 怎么用：开发环境
   ├─ superpowers/             # brainstorming / writing-plans 产出的 specs、plans
   └─ roadmap.md               # 里程碑与进度
```

约定：

- 后端、前端都按功能划分模块，不按"控制器 / 服务 / 数据"分层；模块之间只通过模块入口文件引用。
- 单元测试与源码放在一起（`*.test.ts`），端到端测试放在 `tests/e2e/`。
- `remote-tools` 与后端共用内部接口约定，放在 server 内部，不单独成包。
- 根目录只放仓库入口文档、Agent 规则、工作区与编辑器配置。
- 目录在实际用到时再创建，不建空目录占位。

## 4. 本地数据存放

```text
%LOCALAPPDATA%\ssh-server\
├─ config.json                    # 全局设置（端口、默认阈值、默认黑名单）
├─ workspaces.json                # 工作区列表
└─ workspaces\<工作区ID>\
   ├─ filters.txt                 # rclone 过滤规则（由排除规则生成）
   ├─ bisync\                     # rclone bisync 状态（文件清单，每次覆盖）
   └─ instructions.md             # 注入给 Agent 的工作区指令
```

- git 数据在工作区的本地文件夹内（`.git`），不放在这里。
- 对话记录不在这里，由 Claude Code（`~/.claude`）和 Codex（`~/.codex`）自己保存。

## 5. 模块设计

### 5.1 agents：Agent 适配器

两个适配器实现同一接口，对外输出统一的事件流：

```ts
interface AgentAdapter {
  startTurn(input: TurnInput): AsyncIterable<AgentEvent>;
  interrupt(sessionId: string): Promise<void>;
}

type AgentEvent =
  | { type: 'session'; sessionId: string; model: string }
  | { type: 'text' | 'reasoning'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'permission_request'; id: string; description: string }
  | { type: 'turn_end'; usage?: unknown }
  | { type: 'error'; message: string };
```

Claude（Agent SDK `query()`）：

- `cwd` 为工作区本地文件夹；继续会话时传 `resume`。
- `settingSources: ['user', 'project', 'local']`：读取本机配置，cc-switch 写入的地址和密钥才能生效。
- "跟随本地配置"时不传 `model`、`env`；手动选择模型时只传 `model`。
- `mcpServers` 注入远程工具服务；`appendSystemPrompt` 注入工作区指令（见 5.3）。
- `canUseTool` 把权限请求转成 `permission_request` 事件，等待网页答复。

Codex（app-server）：

- `thread/start` 传 `cwd`、`sandbox`、`approvalPolicy`、`developerInstructions`（工作区指令），通过 `config` 注入 `mcp_servers`。
- "跟随本地配置"时不传 `model`、`modelProvider`；不传 `env`、`baseUrl`、`apiKey`，否则会覆盖本地配置或不再继承环境变量。
- 继续会话用 `thread/resume`。
- Codex 无法关闭本地命令执行，只能用指令约束；沙箱设为 `workspace-write`，限制在工作区文件夹内。

### 5.2 remote-tools：远程工具

stdio MCP 服务，由 Claude Code / Codex 按会话启动。它不直接连 SSH，而是把请求转发到后端内部接口（带会话令牌），由后端统一处理连接、黑名单、同步和日志。

| 工具 | 作用 |
|---|---|
| `remote_exec` | 在服务器工作区目录执行命令。执行前推送本地改动，执行后拉回结果，返回 stdout、stderr、退出码。支持超时 |
| `remote_peek` | 查看服务器文件或目录：大小、`du`、头尾若干行。用于未同步的大文件 |
| `sync_now` | 立即同步一次，返回结果和待确认事项 |

长时间任务（训练）建议用 `nohup` 或 Slurm 提交，由工具说明引导 Agent 这样做。

### 5.3 工作区指令注入

指令只在本地生成，按会话注入，不写入工作区文件夹（避免同步到服务器）：

- Claude：`appendSystemPrompt`；Codex：`developerInstructions`。
- 内容：服务器名和目录；本地文件夹是同步副本；运行、训练、测试、查看数据必须用 `remote_exec`；哪些文件因体积未同步、需要用 `remote_peek` 查看。

### 5.4 ssh

- 解析 `~/.ssh/config` 得到 Host 列表及 HostName、Port、User、IdentityFile；不支持的选项（如 ProxyJump）在界面上提示。
- 每个工作区一条长连接，exec、目录浏览、终端复用。
- 终端：`shell()` 打开 PTY，数据经 WebSocket 与 xterm.js 双向转发，支持窗口尺寸变化。

### 5.5 sync

- 使用 `rclone bisync`，远端用连接参数临时定义的 SFTP 远程（不写入 rclone 全局配置），状态目录用 `--workdir` 指向该工作区的 `bisync\`。
- 过滤规则：固定排除 `.git/**`，加上扩展名列表；`--max-size` 实现大小阈值。
- 首次同步：本地文件夹为空时先从服务器单向拷贝，再 `--resync` 建立基线；本地文件夹非空时提示用户确认。
- 删除检查（F5.6）：每次同步前，后端用本地当前文件列表对比上次同步的清单，找出本地删除的文件。
  - 没有删除：直接同步。
  - 有删除：把这些路径临时加入排除，其余照常同步；网页列出待删除文件。用户确认后删除服务器上的文件并移出排除；用户拒绝则从服务器拷回本地。
  - 不依赖解析 rclone 输出，也不使用需要在服务器放标记文件的 `--check-access`。
- 冲突：使用 bisync 的冲突处理，保留双方版本并在界面提示。
- 不使用 `--backup-dir` 等备份选项。

### 5.6 vcs

- 打开工作区时，本地文件夹不是 git 仓库则 `git init`；已是仓库则直接使用。
- "保存"：`git add` 同步范围内的改动，过滤超过阈值的文件后提交；没有改动不提交。
- 历史、diff、恢复都基于 git 命令；恢复后触发一次同步。

### 5.7 sessions

- 列表：Claude 用 SDK `listSessions`，Codex 用 `thread/list`，按工作区本地文件夹筛选。
- 删除：Claude 用 SDK `deleteSession`；Codex 用 `thread/delete`。删除前确认会话不在运行。
- 归档：Codex `thread/archive` / `thread/unarchive`。

### 5.8 policy：命令黑名单

- 对 `remote_exec` 的命令做规则匹配，命中即拒绝，返回原因。默认规则见需求 F3.4，可按工作区追加或停用。
- 只是防误操作的字符串匹配，不能防有意绕过（编码、写进脚本再执行等）。
- 网页终端不经过黑名单。

### 5.9 http：访问控制

- 只监听 `127.0.0.1`。
- 启动时生成随机访问令牌，打开浏览器时带在地址里，之后保存在会话 Cookie（HttpOnly、SameSite=Strict）。
- 校验 `Host` 为本机地址，校验 WebSocket 与修改类请求的 `Origin`，防止其他网页借浏览器调用本地后端（DNS 重绑定、跨站请求）。
- remote-tools 调后端内部接口时使用单独的会话令牌。

## 6. 关键流程

### 6.1 一轮对话

1. 网页发送消息 → 后端按工作区与会话选择适配器。
2. 适配器启动或继续会话，注入远程工具与工作区指令。
3. Agent 在本地副本改代码；需要运行时调用 `remote_exec`。
4. `remote_exec`：黑名单检查 → 同步（含删除检查）→ SSH 执行 → 同步拉回 → 返回结果。
5. 回复结束后再同步一次；界面更新未保存改动数。

### 6.2 保存与恢复

保存：用户点"保存" → 过滤大文件 → git 提交。恢复：选择提交或文件 → git 恢复 → 同步到服务器。

## 7. 设计决策

| 决策 | 理由 | 代价 / 注意 |
|---|---|---|
| 自行实现精简版，不裁剪 CloudCLI | CloudCLI 规模大（1200+ 文件）、耦合深，且为 AGPL-3.0；核心对话能力本就来自官方 SDK | 聊天渲染、流式、权限交互要自己写 |
| Agent 在本地运行，服务器零安装 | 服务器访问不了 LLM 服务、多人共用；密钥与记录留在本地，也不需要反向隧道 | 需要专门的远程执行工具 |
| 同步代码到本地，而不是纯远程读写 | Agent 可用自带工具，速度和效果更好；本地 git 弥补服务器没有 git | 有同步延迟，需排除大文件、防误删 |
| 同步用 rclone bisync | 走 SFTP，服务器零安装；按次调用，时机可控；状态在本地，同账号多人不冲突；维护活跃。Mutagen 一年多无新版且要在服务器放代理程序，Syncthing 需常驻进程，Unison 需两端同版本 | bisync 属高级命令，需严格测试（V7） |
| 防误删用删除确认，不做服务器快照 | 快照越存越多，同账号多人有同名冲突；确认在误删前拦住 | 合法删除也要多点一次；依赖 bisync 清单格式（V8） |
| git 放在工作区本地文件夹，只手动保存 | 可直接用 VS Code 看历史；提交时机由用户掌握 | `.git` 固定不同步；未保存改动无版本记录 |
| 会话删除用官方接口 | Codex 还在内部 sqlite 中存会话数据，`thread/delete` 会一并清理；直接删文件会留残余 | app-server 协议为实验性，需固定 codex 版本 |
| 模型与服务商跟随本地配置 | 与 cc-switch 配合，网页不接触密钥 | Claude 须设 `settingSources`（V1）；中途换服务商建议新开会话 |
| 工作区指令按会话注入，不写文件 | 写进工作区会被同步到服务器 | 与用户项目自带的 `AGENTS.md` 合并行为待验证（V5） |

新增或推翻决策时直接更新本表；决策多到一张表放不下时，再拆成单独的决策记录。

## 8. 待验证事项

| 编号 | 事项 |
|---|---|
| V1 | Claude SDK `settingSources` 设置后能否读到 cc-switch 写入的 `env`（地址、令牌） |
| V2 | Claude SDK `listSessions` / `deleteSession` 的参数与行为，删除后 VS Code 插件是否同步不可见 |
| V3 | `@openai/codex-sdk` 是否暴露 `thread/list`、`thread/delete`；否则直接使用 app-server |
| V4 | Codex 通过 `config` 注入 `mcp_servers` 是否生效 |
| V5 | Codex `developerInstructions` 与项目 `AGENTS.md` 同时存在时的合并行为 |
| V6 | Codex app-server 的审批请求如何转给网页 |
| V7 | rclone bisync 在 Windows 上、配合 `--max-size` 与临时排除的行为；首次同步的耗时 |
| V8 | 删除检查对比的清单格式（bisync 清单文件）在版本更新后是否稳定 |
| V9 | ssh2 交互 shell 下 `nvitop`、`htop` 的显示与窗口尺寸同步 |
| V10 | 后端令牌与来源校验能否挡住跨站请求和 DNS 重绑定 |
