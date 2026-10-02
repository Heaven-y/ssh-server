# 架构

更新日期：2026-10-02。本文是目标架构，当前仅实现 M1 的主要链路，完成状态见 [路线图](../roadmap.md)。已确认的取舍集中在 [设计决策](decisions.md)，本轮新增功能不能视为已经实现。

## 1. 总览

```text
┌─────────────────────────── 本机 ───────────────────────────┐
│  浏览器 http://127.0.0.1:<端口>/?token=…                    │
│      │ HTTP + WebSocket                                     │
│  后端（Node.js + TypeScript + Fastify）                     │
│   ├─ agents     ──► Claude Agent SDK ──► 本机 Claude Code    │
│   │               └► Codex app-server ──► 本机 Codex         │
│   │                    │ 调用 MCP 工具                        │
│   ├─ remote-tools（stdio MCP，转发给后端内部接口）            │
│   ├─ ssh        ──► ssh2（认证、执行、目录浏览、终端）         │
│   ├─ sync       ──► rclone bisync（SFTP）                    │
│   ├─ metrics    ──► SSH 只读采样 ──► 网页资源状态            │
│   ├─ files      ──► 本地小文件浏览与编辑                     │
│   ├─ vcs        ──► 本机 git（工作区本地文件夹）              │
│   ├─ sessions   ──► SDK 会话接口 / Codex thread 接口          │
│   └─ workspaces ──► 本地 JSON 配置                            │
└─────────────────────────────┬──────────────────────────────┘
                              │ SSH（账号密码 / 已有私钥）
┌──────────────── 服务器（不安装任何东西）────────────────────┐
│  ~/projects/demo  ← 代码与小文件双向同步；大文件只在这里      │
└────────────────────────────────────────────────────────────┘
```

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 运行环境 | Node.js 22 + TypeScript | 本机异步协调服务，沿用官方 TypeScript SDK 与前后端共享类型 |
| 后端 | Fastify + `@fastify/websocket` | HTTP、访问控制和流式消息，继续现有实现 |
| 参数校验 | zod | 接口入参、配置文件 |
| Claude | `@anthropic-ai/claude-agent-sdk` | 调用本机 Claude Code |
| Codex | 本机 Codex app-server（JSON-RPC over stdio） | 会话、skills、权限和上下文操作直接接入官方协议，与本机 CLI 版本对齐 |
| MCP | `@modelcontextprotocol/sdk` | 远程工具服务 |
| SSH | `ssh2` | 支持账号密码与已有私钥，导入 `~/.ssh/config` 或手动配置；凭据在本地处理 |
| 同步 | rclone（外部可执行文件） | `rclone bisync` 走 SFTP |
| Python 分析 | 通过 SSH 调用服务器已有 Python / 项目环境 | 统计、绘图和结果处理留在数据所在服务器；本地后端收集输出和必要小文件 |
| 版本记录 | 本机 git（外部命令） | |
| 前端 | React 19 + Vite + Tailwind CSS 4 | |
| 前端组件 | Base UI（无样式组件）、react-resizable-panels（分栏）、cmdk（命令面板）、lucide-react（图标）、sonner（提示） | 选型参考 t3code、vibe-kanban 等项目，见 ui-layout 第 0 节 |
| 消息渲染 | streamdown（流式 Markdown）+ shiki（代码高亮）、@pierre/diffs（diff）、@tanstack/react-virtual（长列表） | |
| 前端状态与接口数据 | zustand、`@tanstack/react-query`、partysocket | zustand 管流式状态，react-query 管接口加载与刷新，partysocket 管 WebSocket 重连 |
| 终端 | @xterm/xterm + @xterm/addon-fit | |
| 文件编辑 | 成熟 React 编辑组件，具体选型待定 | 轻量脚本编辑；Monaco / CodeMirror 为候选，不引入完整 IDE |
| 资源状态 | SSH 采样 + WebSocket + 网页指标面板 | 使用服务器已有工具，不依赖 `nvitop` 或服务器采集服务 |
| 字体 | @fontsource/ibm-plex-sans、@fontsource/jetbrains-mono | 本地打包，不访问外部字体服务 |
| 存储 | JSON 文件 | 只存工作区配置，不存对话 |

依赖版本在开始实现时固定，并与本机 Codex CLI 版本对齐。已确认继续 Node.js + TypeScript + Fastify；与 Python + FastAPI、NestJS、Go 的比较及打包边界见 [设计决策第 8 节](decisions.md#8-后端选型分析位置与运行边界)。当前沿用 Node.js 本地启动方式，尚无独立 `.exe`、安装器或 Go 迁移要求。

### 2.1 本地协调与远程计算

本地后端负责启动 / 续接官方 Agent、校验网页访问、管理 SSH 认证、调度同步与外部命令，以及向网页转发输出和状态。对话运行时负责模型调用与上下文；服务器现有环境负责项目运行、训练、测试和数据分析。

Python 分析默认通过 SSH 在服务器已有解释器或项目环境内执行，不把大数据下载到本地后端计算。需要新脚本时由 Agent 编辑本地同步范围内文件，完成执行前同步后远程运行；仅返回必要统计、日志、结果表或小图文件。缺少环境或依赖时报告缺失，不在服务器安装软件。本机 Python 可供开发 skill 按需使用，不是网页后端运行时。

后端语言影响本机协调和分发方式，不直接改变服务器的训练速度；耗时由远程算法、数据、依赖和计算资源决定。

### 2.2 异步处理与并发边界

- Agent 消息、HTTP / WebSocket、SSH、文件和子进程使用异步接口；不在请求路径使用阻塞式外部命令或执行大规模 Python / 数据计算。Node.js 的事件循环负责协调多个进行中的 I/O，不要求每项活动占用一个线程。
- 同一会话同时只允许一轮对话，重复发送时返回运行中状态；不同会话的流和权限请求分别管理。对话、终端、资源采样与同步不共用全局等待锁。
- 同一工作区同步串行，手动、定时、保存文件、执行前后和轮次结束请求进入同一同步调度。远程执行须等待自身前置同步成功及相关待确认事项处理完毕，不能用另一轮同步的旧结果跳过检查。
- SSH 使用独立执行 / PTY 通道；连接复用不意味着所有命令全局串行。远程命令保留超时和输出上限，子进程以异步输出处理；网页消费者变慢时控制缓冲，避免持续输出阻塞其他消息或无限增长。
- 同一目标的资源采样共享结果，同一次采样未结束时不重复启动，失败后超时 / 退避；采样不等待 Agent 回复，也不唤起 Agent。长训练提交后返回启动信息或任务 ID，后端不一直等待训练结束。

以上是单用户工具的并发设计，真实同时运行时的响应与串行性仍需验收，不增加多用户服务或未经测量的吞吐量指标。

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
│  │     ├─ files/              # 本地文件列表、读取与保存、修改冲突检查
│  │     ├─ metrics/            # SSH 指标采样、按目标复用、资源状态推送
│  │     ├─ vcs/               # git 状态、保存、历史、恢复
│  │     ├─ sessions/          # 会话列表、删除、归档
│  │     ├─ policy/            # 命令黑名单
│  │     └─ workspaces/        # 工作区配置读写
│  └─ web/                     # 前端（React + Vite）
│     └─ src/
│        ├─ app/               # 外壳、路由、全局状态
│        ├─ features/          # chat、workspaces、sync、files、metrics、terminal、history、settings
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
- 连接地址、端口、账号、认证方式和私钥路径可以保存到本地配置；密码只保留在本地后端内存，断开 / 退出时清除，后端重启后重新输入。
- 密码不进入 JSON 文件、临时磁盘配置、浏览器持久存储、日志、命令行参数或 Agent 上下文。

## 5. 模块设计

### 5.1 agents：Agent 适配器

创建会话时选择适配器，历史会话按原 Agent 与官方会话 ID 继续；一个会话不能中途切换 Agent。两个适配器对外输出统一事件流。下列类型仅为目标接口示意，实际 M1 协议以 `packages/shared/src/events.ts` 为准：

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

目标事件流还需覆盖能力清单、原生上下文用量 / 压缩状态；资源采样和文件同步状态使用独立的工作区事件，不触发新的 Agent 轮次。

Claude（Agent SDK `query()`）：

- `cwd` 为工作区本地文件夹；继续会话时传 `resume`。
- `settingSources: ['user', 'project', 'local']`：读取本机配置，cc-switch 写入的地址和密钥才能生效。
- "跟随本地配置"时不传 `model`、`env`；手动选择模型时只传 `model`。
- `mcpServers` 注入远程工具服务；`systemPrompt` 的 preset `append` 注入工作区指令（见 5.3）。
- `canUseTool` 把权限请求转成 `permission_request` 事件，等待网页答复。

Codex（app-server）：

- `thread/start` 传 `cwd`、`sandbox`、`approvalPolicy`、`developerInstructions`（工作区指令），通过 `config` 注入 `mcp_servers`。
- "跟随本地配置"时不传 `model`、`modelProvider`；不传 `env`、`baseUrl`、`apiKey`，否则会覆盖本地配置或不再继承环境变量。
- 继续会话用 `thread/resume`。
- Codex 无法关闭本地命令执行，只能用指令约束；沙箱设为 `workspace-write`，限制在工作区文件夹内。

上下文与原生能力：

- Claude 用官方 `resume`，Codex 用 `thread/resume`；历史接口供网页显示消息，不把显示历史重新拼成全量提示词。
- 上下文管理和自动压缩由官方运行时负责。Claude 映射 `compact_boundary` 及其手动 / 自动触发信息；Codex 映射原生 token 用量与压缩通知。未提供的状态显示不可用。
- Claude 从 init 元数据和 `supportedCommands()` 等 SDK 接口取得 skills / 命令能力，区分可接入命令与 terminal-only 命令；Codex 使用 `skills/list`（工作区本地 `cwd`）及官方 `{ type: 'skill', name, path }` 输入。
- 手动压缩、会话控制等 `/` 命令映射到实际官方动作，Codex 压缩用 `thread/compact/start`。未被官方接入接口支持的 CLI 命令明确标注限制，不靠普通文本转发冒充支持。
- 能力列表按 Agent 与工作区发现，不修改本机全局配置，不把本机配置和凭据复制到服务器。

### 5.2 remote-tools：远程工具

stdio MCP 服务，由 Claude Code / Codex 按会话启动。它不直接连 SSH，而是把请求转发到后端内部接口（带会话令牌），由后端统一处理连接、黑名单、同步和日志。

| 工具 | 作用 |
|---|---|
| `remote_exec` | 在服务器工作区目录执行命令。执行前推送本地改动，成功且相关待确认事项已处理后才执行；执行后拉回同步范围内的小文件，返回 stdout、stderr、退出码。Python 分析使用服务器已有环境，支持超时 |
| `remote_peek` | 查看服务器文件或目录：大小、`du`、头尾若干行。用于未同步的大文件 |
| `sync_now` | 立即同步一次，返回结果和待确认事项 |

长时间任务（训练）使用服务器已有的 `nohup` 或 Slurm 提交，工具返回启动信息或任务 ID，不一直等待训练结束。用户手动发消息后才查询进度、完成情况或读取结果；不部署任务完成检测或自动 AI 分析。执行后的同步只反映该次命令结束时可见的文件。

### 5.3 工作区指令注入

指令只在本地生成，按会话注入，不写入工作区文件夹（避免同步到服务器）：

- Claude：`systemPrompt: { type: 'preset', preset: 'claude_code', append: <指令> }`；Codex：`developerInstructions`。
- 内容：服务器名和目录；本地文件夹是同步副本；运行、训练、测试、查看数据必须用 `remote_exec`；哪些文件因体积未同步、需要用 `remote_peek` 查看；长任务结果由用户手动要求检查。SSH 密码不注入指令。

### 5.4 ssh

- 连接入口支持从 `~/.ssh/config` 导入 HostName、Port、User、IdentityFile，也支持手动配置地址、端口、账号。不支持的选项（如 ProxyJump）在界面上提示，不静默忽略后宣称连接成功。
- 认证支持账号密码和已有私钥；密码通过受本机访问控制保护的接口进入后端内存，主动断开 / 退出后清除。认证失效时要求重新输入，不回显密码、不交给 Agent。
- 保持 `known_hosts` 校验。未知主机在网页提示指纹与确认入口，已登记主机密钥变化时拒绝连接；确认与写入记录的具体交互在实现时验证。
- 连接按目标地址、端口、账号及当前认证周期复用，exec、目录浏览、终端和资源采样共享；认证信息变化时不能复用旧连接。各命令的工作目录由所属工作区决定。当前 M1 连接池仅按 Host 别名复用私钥连接。
- 终端：`shell()` 打开 PTY，数据经 WebSocket 与 xterm.js 双向转发，支持窗口尺寸变化、多标签和可调整布局。视觉与分屏交互参考 Pebrel，仅参考设计。

### 5.5 sync

- 使用 `rclone bisync`，远端用连接参数临时定义的 SFTP 远程（不写入 rclone 全局配置），状态目录用 `--workdir` 指向该工作区的 `bisync\`。
- ssh2 与 rclone 采用同一组连接参数和认证方式，均须校验服务器主机密钥。密码模式不能写磁盘配置或命令行参数；本地内存 / 子进程凭据传递方式在 M2 验证，不把 rclone 密码混淆视为加密存储。
- 过滤规则：固定排除 `.git/**`，加上扩展名列表；`--max-size` 实现大小阈值。
- 首次同步：本地文件夹为空时先从服务器单向拷贝，再 `--resync` 建立基线；本地文件夹非空时提示用户确认。
- 删除检查（F5.6）：每次同步前，后端用本地当前文件列表对比上次同步的清单，找出本地删除的文件。
  - 没有删除：直接同步。
  - 有删除：把这些路径临时加入排除，其余照常同步；网页列出待删除文件。用户确认后删除服务器上的文件并移出排除；用户拒绝则从服务器拷回本地。
  - 不依赖解析 rclone 输出，也不使用需要在服务器放标记文件的 `--check-access`。
- 冲突：使用 bisync 的冲突处理，保留双方版本并在界面提示。
- 不使用 `--backup-dir` 等备份选项。
- 同一工作区的同步任务串行处理，避免定时拉取、编辑器保存和执行前同步互相重叠；同步不依赖 git 提交。
- 执行前同步失败或相关删除 / 冲突待处理时，返回阻断原因，不调用 SSH 执行旧代码。执行后拉回失败时，保留命令的输出 / 退出码并另报同步错误。
- 定时拉取只更新同步范围内文件，不监视训练完成，不产生 Agent 消息。

### 5.6 vcs

- 打开工作区时，本地文件夹不是 git 仓库则 `git init`；已是仓库则直接使用。
- “保存版本”：`git add` 同步范围内的改动，过滤超过阈值的文件后提交；没有改动不提交。
- 历史、diff、恢复都基于 git 命令；恢复后触发一次同步。
- 编辑器“保存文件”只写入本地副本并触发同步，不创建提交；界面分别显示文件未保存、未记录版本和同步状态。

### 5.7 sessions

- 列表：Claude 用 SDK `listSessions`，Codex 用 `thread/list`，按工作区本地文件夹筛选。
- 删除：Claude 用 SDK `deleteSession`；Codex 用 `thread/delete`。删除前确认会话不在运行。
- 归档：Codex `thread/archive` / `thread/unarchive`。
- 列表保留所属 Agent 标识与官方 ID；打开历史后始终路由回原适配器，不执行跨 Agent 历史转换。

### 5.8 policy：命令黑名单

- 对 `remote_exec` 的命令做规则匹配，命中即拒绝，返回原因。默认规则见需求 F3.4，可按工作区追加或停用。
- 只是防误操作的字符串匹配，不能防有意绕过（编码、写进脚本再执行等）。
- 网页终端不经过黑名单。

### 5.9 http：访问控制

- 只监听 `127.0.0.1`。
- 启动时生成随机访问令牌，打开浏览器时带在地址里，之后保存在会话 Cookie（HttpOnly、SameSite=Strict）。
- 校验 `Host` 为本机地址，校验 WebSocket 与修改类请求的 `Origin`，防止其他网页借浏览器调用本地后端（DNS 重绑定、跨站请求）。
- remote-tools 调后端内部接口时使用单独的会话令牌。

### 5.10 files：轻量文件编辑

- 浏览同步范围内的本地文件，复用成熟编辑组件，提供语法高亮、搜索、修改标记和文件保存，不建设完整 IDE。
- 本地读取 / 写入受工作区路径与大小限制，不能越出本地工作区；远程大型结果由远程工具按需读取。
- 保存文件 → 写入本地 → 同步 → 回报结果；服务器同步未成功时不能显示“已到达服务器”。
- 通过文件版本 / 修改时间检测外部改动；未保存的编辑缓冲与 Agent 或同步修改冲突时提示处理，不自动覆盖。

### 5.11 metrics：服务器资源采样

本地后端复用 SSH 连接执行固定的只读采样命令，解析为结构化状态，通过工作区 WebSocket 事件推送前端；不经 Agent，不调用模型，不触发对话。

| 指标 | 数据来源 | 边界 |
|---|---|---|
| GPU 型号、利用率、显存、温度、功耗 | `nvidia-smi --query-gpu=… --format=csv,noheader,nounits` | 不同驱动与设备字段可能不可用，按 GPU 标识展示 |
| GPU 计算进程与显存用量 | `nvidia-smi --query-compute-apps=… --format=csv,noheader,nounits` | 不保证覆盖所有进程类型或提供每进程 GPU 利用率 |
| CPU、负载、内存、进程 | `/proc/stat`、`/proc/meminfo`、系统负载、`ps` 等已有来源 | CPU 使用率由相邻样本差值计算，字段与权限缺失时标注不可用 |
| 项目磁盘可用空间 | 项目所在文件系统的 `df` 等 | 不以递归 `du` 大项目目录作为定时采样 |

- 默认采集当前 SSH 目标，响应包含采集主机、采样时间与字段可用性。当前节点的指标不能标成另一个 Slurm 计算节点的指标。
- 按目标连接共享采样，资源概览或详情可见时秒级刷新，页面隐藏 / 断线后暂停或降频；设置超时与退避，避免重叠和重复查询。具体间隔需真实测量。
- 共享账号下展示进程信息但不推断属于本人；只有已知 PID / 任务信息且能可靠关联时才标注当前工作区。
- 采样失败保留最近值并标为过期，缺少指标显示不可用，不能显示为零。服务器不安装采集器、不运行常驻监控服务，不要求 `nvitop`。
- Slurm 状态由用户按需查询，不增加任务完成检测器或高频 `squeue` / `sstat` 轮询。

## 6. 关键流程

### 6.1 一轮对话

1. 网页发送消息 → 新会话使用创建时选择的适配器，已有会话使用其原 Agent 与官方 ID。
2. 适配器通过官方接口启动或继续会话，注入远程工具与工作区指令；上下文和压缩由运行时负责。
3. Agent 在本地副本改代码；需要运行时调用 `remote_exec`。
4. `remote_exec`：黑名单检查 → 执行前同步（含删除 / 冲突检查）→ 成功后 SSH 执行 → 拉回小文件 → 返回命令结果与同步状态。前置同步未成功则不执行。
5. 回复结束后再同步一次，界面更新待记录版本的改动数；不创建 git 提交，也不等待后台训练完成。

### 6.2 保存与恢复

保存文件：用户在编辑器点击“保存文件” → 写入本地副本 → 同步，不提交 git。保存版本：用户点“保存版本” → 过滤大文件 → git 提交。恢复：选择提交或文件 → git 恢复 → 同步到服务器。

### 6.3 用户手动查看训练结果

用户发送“查看这次训练的结果” → 原会话 Agent 继续 → 通过远程工具查询任务 / 日志 / 结果 → 如需统计或绘图，使用服务器已有 Python / 项目环境；新脚本先在本地编辑并同步 → 返回必要统计、日志或小图文件，未同步的大数据按需远程读取 → 在对话中分析。后台训练期间没有完成检测或自动 Agent 续跑。

### 6.4 资源显示

用户打开资源面板 → 后端订阅对应 SSH 目标的采样 → 推送结构化指标 → 前端更新图表 / 数值与时间戳。该流程不进入对话适配器，也不推断训练任务是否完成。

## 7. 设计决策

完整记录已移至 [设计决策](decisions.md)，集中维护 D01–D20，避免在多个文档重复保存取舍结论。主要新增约定包括：

- 会话固定 Agent，沿用原生上下文、skills 与可接入的 `/` 命令。
- 账号密码和私钥均支持，密码仅用于本地内存中的连接周期。
- 自动同步连接本地编辑与远程运行，执行前同步失败时阻断。
- 轻量文件编辑与本地版本记录区分“保存文件”和“保存版本”。
- 终端参考 Pebrel，资源面板独立 SSH 采样，结果分析只由用户发消息触发。
- 本地后端继续 Node.js + TypeScript + Fastify，Python 分析默认在远端现有环境执行；打包与语言迁移未加入交付范围。
- 以异步 I/O 协调对话、终端、同步和资源刷新，同一会话单轮、同一工作区同步串行。

## 8. 待验证事项

| 编号 | 事项 |
|---|---|
| V1 | Claude SDK `settingSources` 设置后能否读到 cc-switch 写入的 `env`（地址、令牌） |
| V2 | Claude SDK `listSessions` / `deleteSession` 的参数与行为，删除后 VS Code 插件是否同步不可见 |
| V3 | 已选 Codex app-server；本机 CLI 0.156.1 生成的协议含会话列表 / 删除等接口，真实集成与删除后各客户端一致性仍待验证 |
| V4 | Codex 通过 `config` 注入 `mcp_servers` 是否生效 |
| V5 | Codex `developerInstructions` 与项目 `AGENTS.md` 同时存在时的合并行为 |
| V6 | Codex app-server 的审批请求如何转给网页 |
| V7 | rclone bisync 在 Windows 上、配合 `--max-size` 与临时排除的行为；首次同步的耗时 |
| V8 | 删除检查对比的清单格式（bisync 清单文件）在版本更新后是否稳定 |
| V9 | ssh2 交互 shell、窗口尺寸同步与服务器已有全屏工具的显示；`nvitop` / `htop` 仅在已有时验证，不作为安装前提 |
| V10 | 后端令牌与来源校验能否挡住跨站请求和 DNS 重绑定 |
| V11 | 账号密码与私钥在测试连接、远程执行、目录浏览、rclone 同步和终端中贯通；密码不落盘、不泄露，认证失效与主机指纹确认交互 |
| V12 | Claude / Codex 的 skills 发现与调用、可执行 `/` 命令清单，以及 terminal-only 命令的限制提示 |
| V13 | 官方上下文用量、自动 / 手动压缩事件与长会话续接的网页呈现；不自行重建上下文 |
| V14 | 轻量编辑器选型、按需加载、保存后同步、未保存内容与 AI / 同步改动的冲突处理 |
| V15 | 真实服务器已有工具与权限、GPU / CPU / 内存 / 进程指标解析、采样开销、同目标复用及断线 / 不可用状态；资源刷新不调用模型 |
| V16 | 对话流、SSH PTY、资源采样及同步同时运行时的消息响应；同一会话禁止重叠轮次、同一工作区同步不重叠，超时 / 输出限制不影响其他活动 |
| V17 | 使用服务器已有 Python / 项目环境执行用户要求的统计、绘图和结果处理；分析脚本先同步，必要小文件按需返回，不整份下载大数据或自动触发分析 |

2026-10-02 状态核对：当前 M1 仅私钥认证，未接入同步、Codex、网页编辑器、终端和资源面板；Claude 原生续接已接入，skills / 命令选择及压缩状态展示未接入。`e2e:m1` 指向的验收脚本尚未创建，真实模型 / SSH 链路仍未验收。
