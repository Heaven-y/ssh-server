# 架构

更新日期：2026-11-03。本文按当前工作树描述 AgentDeck（原 `ssh-server`）的真实分层。产品已从「本地改代码、rclone 同步、服务器上运行」转向「本机桌面端统一管理 Claude Code / Codex / Antigravity 的原生会话」，同步、版本与本地文件镜像三个域已从代码里删除；改名与旧数据迁移已完成，迁移仍在收尾。文中「待移除」标记已确定删除但尚未落地的模块，「待新增」标记尚未创建的部分。需求见[需求](../product/requirements.md)，取舍见[设计](../superpowers/specs/2026-11-03-native-cli-workbench-design.md)与[设计决策](decisions.md)，进度见[路线图](../roadmap.md)。

## 1. 总览

```text
┌────────────────────── 本机（AgentDeck）──────────────────────┐
│ 桌面壳 apps/desktop（待新增，M1.5）                            │
│   └─ 拉起后端并用窗口加载前端                                  │
│ 前端 apps/web（React + Vite）                                 │
│   │ HTTP 接口 + WebSocket（对话 /ws、终端）                     │
│ 后端 apps/server（Fastify，只监听回环地址）                     │
│   ├─ chat        TurnManager、会话服务、能力目录                 │
│   ├─ agents      Claude（Agent SDK）· Codex（app-server）       │
│   ├─ workspaces  工作区存储、旧数据迁移、活动租约                 │
│   ├─ settings    原生配置、产品偏好、环境探测                    │
│   ├─ process     中立子进程运行器                              │
│   ├─ ssh         档案、连接池、主机信任、SFTP、执行               │
│   ├─ terminal    服务器 SSH 的 PTY 通道                        │
│   ├─ resources   资源采样                                     │
│   ├─ slurm       当前账号作业查询                               │
│   ├─ remote-files 服务器文件浏览与操作                          │
│   └─ policy / remote-tools（待移除）                           │
└───────────────────────────┬──────────────────────────────────┘
                            │ SSH（密码或已有私钥）
┌───────────────────────────服务器─────────────────────────────┐
│ 只承载人的操作：PTY 命令、只读采样、squeue、文件增删改移          │
│ 不安装 Agent、不驻留服务、不存放本产品的数据                     │
└──────────────────────────────────────────────────────────────┘
```

- 会话正文与原生配置的唯一来源是各 CLI 自己的存储（`~/.claude`、`~/.codex`）。本产品落盘的只有工作区、服务器档案、产品偏好、加密凭据与文件任务记录。
- 桌面壳尚未存在。开发期 `npm run dev` 同时起 Vite（5173）与后端（默认 4317），浏览器访问后端地址；`--dev-origin` 或 `AGENTDECK_DEV_ORIGIN` 才允许这个开发来源。
- 三个 CLI 里只接了 Claude 与 Codex。Antigravity 的适配器、事件映射与 `agy` 启动都不在代码中，`AgentKind` 也只枚举这两者。
- 服务器面板的终端、资源、Slurm、文件操作目前仍以工作区（含其绑定服务器）为入口；改为以服务器档案为键属于 M3，尚未发生。

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 运行环境 | Node.js ≥22 + TypeScript 5.9 | 用 `tsx` 直接运行，尚无打包产物 |
| 后端 | Fastify 5 + `@fastify/websocket` 11 | 回环 HTTP、WebSocket 升级与静态托管 |
| 参数校验 | zod 4 | 接口入参、配置文件、共享协议 |
| Claude | `@anthropic-ai/claude-agent-sdk` 0.3.286 | 只作协议客户端，实际驱动 SDK 平台包里的原生程序 |
| Codex | 本机 `codex app-server` | JSON-RPC over stdio，不打包、不锁定版本 |
| SSH | `ssh2` 1.17 | 密码或已有私钥，主机密钥校验，SFTP 与 PTY |
| 前端 | React 19 + Vite 8 + Tailwind CSS 4 | |
| 前端组件 | Ariakit、react-resizable-panels、cmdk、lucide-react | 弹层、停靠分栏、命令面板与图标 |
| 时间线渲染 | streamdown、react-virtuoso | 流式 Markdown 与长列表虚拟滚动 |
| 状态与数据 | zustand、`@tanstack/react-query`、partysocket | 会话状态、接口缓存、WebSocket 重连 |
| 终端 | `@xterm/xterm` + `@xterm/addon-fit` | |
| 配置与文件编辑 | `@uiw/react-codemirror` + CodeMirror 6 | JSON、Markdown 语言包 |
| 字体 | `@fontsource/ibm-plex-sans`、`@fontsource/jetbrains-mono` | 本地打包，不访问外部字体服务 |
| 存储 | 本机 JSON + Windows 当前用户加密 | 配置明文，密码与密钥值只存密文 |

依赖版本固定在根与各包的 `package.json`。rclone、本机 git 与 `@pierre/diffs` 已随三个域一起从依赖中消失；外部命令不再经过 shell，统一走 `process/run.ts` 或 SSH 通道。

### 2.1 本机协调与远程计算

后端负责启动与回收 CLI 子进程、把原生事件转成统一事件、维护会话锁与工作区租约，并转发网页指令。模型调用发生在 CLI 进程内部，后端自己不请求任何模型端点，也不保存密钥值。

服务器侧只执行人点出来的操作：只读资源采样、Slurm 文本查询、终端命令、服务器文件管理。旧产品里「把工作搬到服务器执行」的约束仍以指令形式残留（见 5.1 与 5.9），删除 MCP 桥之后才完全消失。

本地目录不再有镜像与副本：CLI 的工作目录就是工作区目录本身，没有前置或后置传输，也没有版本快照。

### 2.2 异步处理与并发边界

- 请求路径上不跑阻塞命令。子进程由 `runProcess` 异步执行，带超时、输出上限与取消信号；SSH 操作同样带本机截止时间。
- 同一会话同一时刻只允许一轮：`TurnManager` 用 `${agent}:${sessionId}` 记占用，重复发送立刻回错误，不同会话互不阻塞。
- 改名、删除、归档、分叉与运行互斥：`withIdleSession` 在原生操作期间占用同一把会话锁，忙时返回 409。
- 轮次启动前向 `workspaces/activity` 取工作区租约，轮次结束时释放；租约存在期间该工作区不能进入移除流程。
- 回合事件只发给发起该轮的 WebSocket。连接断开时，待审批请求按拒绝收尾，不做服务端缓冲或跨连接续传（设计要求按会话缓冲，尚未实现）。
- SSH 连接按 alias 复用，exec、SFTP、PTY 各自独占通道；单通道失败只释放自己，不断开共享连接。
- 资源与 Slurm 共用固定目标上下文，同身份的并发读取合并为一次采样；认证代次或连接 `cacheKey` 变化后，旧结果不能回填新身份。
- 服务器文件任务按同目标的相交路径排队，最多四项并行；任务记录先原子落盘再派发。
- 终端每工作区最多 8 个会话、全局 32 个，单标签最多 4 个窗格。
- 这是单用户、多活动的并发模型，不引入多用户服务，也不承诺未测量的吞吐指标。

## 3. 仓库结构

使用 npm workspaces，前后端各自持有依赖、TypeScript 配置与测试。

```text
agentdeck/
├─ apps/
│  ├─ desktop/                    # 待新增（M1.5）：Electron 主进程与 preload
│  ├─ server/
│  │  ├─ src/
│  │  │  ├─ main.ts               # 组装依赖、启动、优雅退出
│  │  │  ├─ config.ts             # 环境变量与命令行参数
│  │  │  ├─ agents/               # 适配层：14 个文件 + codex/ 下 12 个文件
│  │  │  ├─ chat/                 # 5 个：turn-manager、sessions、capabilities、registry、turn-files
│  │  │  ├─ http/                 # 20 个：路由、访问控制、终端升级
│  │  │  ├─ process/              # 1 个：run.ts
│  │  │  ├─ remote-files/         # 15 个 TypeScript 文件 + remote-helper.py
│  │  │  ├─ resources/            # 6 个：采样命令、解析、缓存、目标与服务
│  │  │  ├─ settings/             # 5 个：safe-file、native-config、product-settings、environment、errors
│  │  │  ├─ slurm/                # 4 个：commands、parse、service、abort
│  │  │  ├─ ssh/                  # 18 个：档案、连接池、凭据、主机信任、SFTP、执行与保护
│  │  │  ├─ terminal/             # 8 个：binding、manager、session、initialization、input、output 等
│  │  │  ├─ workspaces/           # 4 个：store、activity、migrate-legacy、policy
│  │  │  ├─ policy/               # 3 个，待移除
│  │  │  └─ remote-tools/         # 3 个，待移除
│  │  └─ tests/                   # 按 src 模块镜像
│  └─ web/
│     ├─ src/
│     │  ├─ app/                  # 外壳、顶栏、停靠布局、命令面板、本机会话闸门
│     │  ├─ features/             # chat、workspaces、ssh、terminal、resources、remote-files、settings
│     │  ├─ ui/                   # 通用弹层、CodeMirror 组件、列表导航、界面偏好
│     │  ├─ lib/                  # api、query-client、ws、可取消请求
│     │  ├─ main.tsx、styles.css
│     └─ tests/                   # 与 lib、features、app 对应
├─ packages/shared/src/           # 前后端共享协议与类型（含待移除文件）
├─ scripts/dev/                   # check-docs、e2e-*、夹具与安装脚本
└─ docs/                          # 需求、界面、架构、决策、路线图、设计与验收记录
```

已从工作树删除、不要再按现行架构阅读：`apps/server/src/{sync,vcs,files,workspaces/setup}`、`workspaces/removal.ts` 与 `removal-resources.ts`、`http/{sync,versions,files,workspace-setup,workspace-activity}.routes.ts`、`apps/web/src/features/{sync,versions,changes,files,workspaces/setup}`，以及 `@pierre/diffs` 依赖。

待移除（下一轮落地，删除要成组进行）：

- `apps/server/src/remote-tools/`、`apps/server/src/policy/`，以及 `http/internal.routes.ts`、`http/workspace-policy.routes.ts`、`workspaces/policy.ts`。
- 只服务 MCP 桥的部分：`chat/registry.ts`、`agents/types.ts` 的 `TurnEnv`/`acquireEnv`、`agents/instructions.ts` 的远程工具指令、`chat/turn-files.ts` 与 `turn.finished.changes`。
- `remote-files/downloads.ts`、`remote-files/sync-scope.ts`，以及前端 `RemoteDownloadDialog.tsx` 与 `shared` 的 `RemoteFileScope`。
- `packages/shared/src/{policy,sync,versions,files,setup,workspace-removal,turn-changes,turn-files}.ts`。它们仍被工作区模型、产品设置与文件浏览引用（例如 `WorkspaceInputSchema` 依赖 `SyncSettingsSchema`），要先收敛模型再删文件。

约定：

- 前后端按功能分目录，通用部分才放 `lib` / `ui`；不额外造控制器、服务或仓储层。
- 单元与模块集成测试统一放所属包的 `tests/`，路径镜像 `src/`，保留 `*.test.ts` 命名；Vitest 只发现这些目录。
- 真实链路验收仍用 `scripts/dev/e2e-*.ts`；还没有 Playwright 端到端目录。
- `remote-tools` 是后端内部的子进程入口，不单独拆包（待删）。
- 根目录只放仓库入口文档与工具需要的配置。

## 4. 本地数据存放

```text
%LOCALAPPDATA%\AgentDeck\
├─ workspaces.json          # 工作区列表，不含密码
├─ servers.json             # 服务器档案，最多 128 条
├─ product-settings.json    # 产品偏好：默认 Agent、资源间隔与超时
├─ credentials\             # <sha256>.json，Windows 当前用户加密后的密文
└─ remote-file-tasks\       # 服务器文件任务：<uuid>.json 与临时文件
```

- 目录名来自 `config.ts` 的 `CONFIG_DIR_NAME = 'AgentDeck'`；`AGENTDECK_CONFIG_DIR` 可改到别处，非 Windows 平台退到 `~/.local/share`。
- 会话历史不在本产品目录：Claude 在 `~/.claude`（`CLAUDE_CONFIG_DIR` 可改），Codex 在 `~/.codex`（`CODEX_HOME` 可改）。本产品按原生 id 读取，不复制正文。
- **旧目录一次性迁移**：`main` 启动时先调用 `workspaces/migrate-legacy.ts`，把 `%LOCALAPPDATA%\ssh-server` 下的 `servers.json` 与 `workspaces.json` 复制到新目录。新目录已有同名文件时不覆盖并写日志，旧目录原样保留不删；已删功能留下的 `sync/` 目录与 `file-editors.json` 不在迁移清单里；单个文件失败只记错误，启动继续。
- 凭据：`credentials\` 下每个文件按目标摘要命名，内容是 DPAPI 密文；目录 0700、文件 0600。明文密码不进 JSON、日志、命令行或对话。
- 原生配置保存不做备份：`settings/safe-file.ts` 只在同目录写临时文件再原子替换，设计里写的 `backups\` 尚未实现。
- `remote-file-tasks\` 只在任务派发前写入。后端重启不重放，结果不确定的任务保持 `needs_check`。

环境变量：

| 变量 | 作用 |
|---|---|
| `AGENTDECK_PORT` | 监听端口，默认 4317 |
| `AGENTDECK_HOST` | 监听地址，只接受 127.0.0.1、::1、localhost |
| `AGENTDECK_CONFIG_DIR` | 覆盖数据目录 |
| `AGENTDECK_TOKEN` | 覆盖进程内会话秘密，默认启动随机生成 |
| `AGENTDECK_DEV_ORIGIN` / `--dev-origin` | 允许的 Vite 开发来源 |
| `AGENTDECK_CODEX` | Codex 可执行文件或官方 JS 入口 |
| `AGENTDECK_RCLONE` | 仅环境探测残留，随同步域删除 |
| `AGENTDECK_INTERNAL_URL`、`AGENTDECK_SESSION_TOKEN` | 注入 MCP 子进程的内部地址与短期令牌（待移除） |

## 5. 模块设计

### 5.1 agents：Agent 适配器

`agents/types.ts` 定义适配器契约：`AgentTurnInput`（工作区、会话 id、模型、推理强度、正文、能力调用、环境租约、事件投递、权限请求）、`TurnHandle`（`interrupt()` 与 `done`）、`TurnRunner`（可选 `dispose()`），以及 `NativeSessionSummary`、`NativeSessionRead`、`NativeSessionFork`。统一事件类型在 `packages/shared/src/events.ts`，含文本增量、思考、工具调用与结果、审批请求与结果、上下文用量、压缩状态、轮次结束与错误。

会话身份是 `(agent, sessionId)`，一个会话不能中途换 Agent；Codex 的 id 取 `thread.id`，不用分叉树根。`AgentKind` 目前只有 `claude` 与 `codex`。

Claude（Agent SDK）：

- `query()` 驱动，`cwd` 为工作区本地目录，续接传 `resume`；`settingSources` 取 `user`、`project`、`local`，本机 Claude 配置因此生效。
- `systemPrompt` 用 `claude_code` preset 加 `append` 注入 `buildInstructions()`；`includePartialMessages` 打开逐字增量。
- 推理强度经 `claudeEffort()` 映射到 SDK `effort`，未显式选择则省略；模型同样只在显式选择时传入。
- 审批经 `canUseTool` 转成 `permission_request`，网页答复后回 `permission_resolved`；等待上限 300 秒，超时、断线或中断按拒绝处理。
- `createClaudeRunner` 按「工作区 + 会话 + 模型 + 强度」复用同一 Query 与消费循环，空闲 5 分钟回收；同一运行时一次只接一轮，进程退出或崩溃后下一轮重建；中断被原生确认后本轮直接以错误收尾。
- 仍保留网页侧策略：`allowedTools` 预置 Read、Glob、Grep、TodoWrite 与两个 MCP 工具，`edit-scope.ts` 自动放行工作区内编辑。设计要求随 `policy/` 一起删除这层策略，尚未执行。
- 可执行文件由 `claude-launch.ts` 的 `resolveClaudeExecutable()` 从 SDK 平台包解析，Windows 上即包内 `claude.exe`，与 PATH 上的 `claude` 无关。设计要求改为驱动本机安装并支持显式覆盖，尚未实现。

Codex（app-server）：

- `agents/codex/` 分工：`client`（JSON-RPC 行协议）、`launch`（启动解析）、`config`（线程参数）、`mapper`（事件）、`permissions`（审批）、`runtime`（长驻会话）、`sessions`（列表、读取、改名、删除、归档、分叉）、`capabilities`（技能与模型目录）、`compaction`、`types`。
- 启动顺序：`AGENTDECK_CODEX` 显式指定；Windows 上依次找 PATH 里的 `codex.exe` 与官方 npm 包的 vendor 可执行文件；非 Windows 直接调用 `codex`。随后 spawn `codex app-server --listen stdio://`，不经 shell。
- 协议约束：逐行 JSON-RPC，单条上限 8 MiB，待处理请求上限 128，普通请求超时 30 秒；stderr 持续排空，不回显原始诊断。
- 首次使用依次 `initialize`、`config/read(cwd)`，然后 `thread/start` 或 `thread/resume`。线程参数固定 `sandbox: workspace-write`、`approvalPolicy: on-request`、`approvalsReviewer: user`，模型只在显式选择时覆盖；原生 `developer_instructions` 与工作区指令拼接后传入。
- 当前仍通过线程 config 注入 remote-tools MCP，并把相关环境变量加入 shell 过滤（待删）。
- 长驻 runtime 按会话复用进程与 thread，空闲 5 分钟回收；进行中的改名、删除、归档由会话锁挡住。
- 会话读取与操作全部走 app-server 的 thread 接口，不直接解析 `~/.codex` 的 JSONL 或 SQLite。

Antigravity：尚未接入。代码里没有对应的目录、`AgentKind`、事件映射或 `agy` 启动逻辑，`workspace_uris` 归属与软拒提示都未实现，不能按已支持描述。

### 5.2 chat：轮次、会话与能力

- `turn-manager.ts`：建立轮次、取工作区租约、串行准备、把事件投给发起连接、路由审批答复、收尾并释放锁。错误按 `SessionError` 文案或通用提示回给网页。
- `sessions.ts`：按 Agent 注册 provider，提供列表、读取、归属校验、分叉与原生操作。读取时复核原生 `cwd` 与工作区目录（`sameSessionDirectory`），失败匿名化为 503；归档只对 Codex 开放。
- `capabilities.ts`：读取原生目录并解析选择。`prepare()` 只接受服务端目录里的 ID 或精确 slash 名称，未知、禁用、歧义直接报错，不降级成普通文本；要求会话的命令在无 id 时拒绝。
- `registry.ts`：进程内随机令牌到工作区 id 的映射，只给 MCP 子进程用（待移除）。
- `turn-files.ts`：从工具调用事件累积文件变更，写进 `turn.finished.changes`。改动视图删除后前端已无消费方，属待清理残留。

### 5.3 process：中立子进程运行器

`runProcess(executable, args, options)` 返回 `{ stdout, stderr, exitCode }`。`shell: false`、`windowsHide: true`，支持 stdin 输入、独立环境、超时、输出总上限与 `AbortSignal`；超限、超时、取消与启动失败统一抛 `ProcessError`，`code` 为 `output_limit`、`timeout`、`aborted` 或 `executable_missing`，错误信息不含参数与原始 stderr。

依赖它的只有 `settings/environment.ts`（版本探测）与 `ssh/windows-protection.ts`（DPAPI 脚本）。CLI 适配器自己管理长驻管道，不走这条路径。

### 5.4 workspaces：存储、活动与迁移

- `store.ts`：读写 `workspaces.json`。schema 为 `name`、`localDir`（绝对路径）、`sshHost`、`remoteDir`，另有可选 `sync` 与 `policy`；所有读写串行，写盘用临时文件加 rename。`ENOENT` 视为空列表，其他读取或解析错误抛 `WorkspaceStorageError` 并保留原文件。
- 校验：`localDir` 必须绝对且目录存在，`sshHost` 必须已在 `servers.json` 登记，否则抛带 `field` 的 `WorkspaceValidationError`。`withSnapshot()` 供跨档案事务使用，锁序为工作区、服务器档案。
- 当前模型仍要求每个工作区绑定一台服务器，并保留 `sync` 字段；设计要的「本地目录必填、服务器可选」尚未落地。
- `activity.ts`：按工作区计数的租约与 closing 门禁。`acquire()` 在关闭中抛错，`exclusive()` 目前没有调用方（移除服务已删）。
- `migrate-legacy.ts`：只复制 `servers.json` 与 `workspaces.json`，不覆盖新目录已有文件，旧目录保留；两个目录相同或源目录不存在时安全跳过，单个失败记入报告继续。
- `policy.ts`：工作区命令规则的读写服务，与 HTTP 路由一起待移除。

### 5.5 settings：配置、偏好与环境

- `safe-file.ts`：逐层 `lstat` 检查目录、拒绝符号链接与非常规文件、上限 256 KiB，`revision` 取内容 sha256；读取前后核对 inode、大小与时间，写入走同目录临时文件再 rename，提交前后复核目录身份。
- `native-config.ts`：只覆盖两个文件——Claude `settings.json`（按 JSON 校验）与 Codex `config.toml`（按 TOML 校验）。路径取 `CLAUDE_CONFIG_DIR` / `CODEX_HOME` 或 `~/.claude`、`~/.codex`；保存要求 revision 未变，冲突拒绝；按 Agent 串行。
- 需求里的 `CLAUDE.md`、`AGENTS.md`、项目级配置与 Antigravity 配置都还没有实现，接口只接受 `claude` 与 `codex` 两个固定 Agent。
- `product-settings.ts`：字段为 `defaultAgent`、`syncDefaults`、`syncIntervalSeconds`、`resources.{intervalSeconds,timeoutSeconds}`；读取时定点剔除已退休的 `defaultModels`，其他未知字段仍拒绝；坏文件返回 503，版本冲突按 409 语义处理。
- `syncDefaults` 与 `syncIntervalSeconds` 是同步域残留，随 `shared/sync.ts` 一起删除。
- `environment.ts`：并行探测 Node.js（当前进程）、Claude Code、Codex、git、rclone，每项 5 秒、2 KiB，只提取版本号；共享一份报告，并发刷新返回 409。git 与 rclone 属遗留，Antigravity 尚未纳入。

### 5.6 http：访问控制与路由

- 只监听回环。`config.ts` 在启动时拒绝其他 host。
- `security.ts` 的 `onRequest` 钩子依次校验：Host 必须是本机地址且端口匹配实际监听值（含开发来源），挡住 DNS 重绑定；修改类请求与 WebSocket 校验 Origin，`Sec-Fetch-Site: cross-site` 直接拒绝；`/api/*` 与 `/ws` 需要有效会话 Cookie。
- 会话 Cookie 名为 `AGENTDECK_session`，HttpOnly、SameSite=Strict，比较用常量时间。唯一免登录入口是 `POST /api/local-session`：同源握手成功后写 Cookie 并返回 204；业务组件与 WebSocket 在握手成功前不挂载。
- `/internal/*` 跳过 Origin 校验，改由路由自己校验 Bearer 会话令牌（待移除）。
- 所有响应带 `X-Frame-Options: DENY` 与 `frame-ancestors 'none'`；请求体上限 1 MiB，对话 WebSocket 载荷上限同为 1 MiB，终端另有独立上限（见 5.15）。
- 静态托管 `apps/web/dist`，非接口的 GET 回退到 `index.html`。

| 模块 | 主要接口 |
|---|---|
| 本机会话 | `POST /api/local-session` |
| 工作区 | `GET /api/workspaces`（仅列表，创建与修改接口尚未重写） |
| 会话 | `GET /api/workspaces/:id/sessions`、`GET .../sessions/:sessionId/events`、`POST .../actions`、`POST .../fork` |
| 能力 | `GET /api/workspaces/:id/agent-capabilities` |
| 产品设置与环境 | `GET /api/settings/product`、`PUT /api/settings/product`、`GET /api/settings/environment`、`POST /api/settings/environment` |
| 原生配置 | `GET /api/agent-config/:agent`、`PUT /api/agent-config/:agent` |
| 服务器档案 | `GET /api/ssh-targets`、`GET /api/ssh-targets/import-options`、`POST /api/ssh-targets`、`PUT /api/ssh-targets/:alias`、`DELETE /api/ssh-targets/:alias`、密码读写子路径 |
| 主机信任 | `POST /api/ssh/host-key`、`POST /api/ssh/host-key/confirm` |
| 连接与凭据 | `POST /api/ssh/connect`、`GET /api/ssh/credentials`、`PUT /api/ssh/credentials`、`POST /api/ssh/disconnect` |
| 终端 | `POST /api/workspaces/:id/terminal-binding`、`GET /api/workspaces/:id/terminal`（WebSocket） |
| 资源与作业 | `GET /api/workspaces/:id/resources`、`GET /api/workspaces/:id/slurm` |
| 服务器文件 | `/api/workspaces/:id/remote-files/` 下的 bindings、sessions、tasks 与 download |
| 对话 | `GET /ws`（WebSocket） |
| 命令规则 | `GET /api/workspaces/:id/policy`、`PUT /api/workspaces/:id/policy`（待移除） |
| 内部接口 | `POST /internal/remote-exec`、`POST /internal/remote-peek`（待移除） |

### 5.7 ssh：档案、连接与信任

- 档案存 `servers.json`，alias 为 `managed-ssh-<uuid>`；同 hostname、端口、账号不允许重复，最多 128 条。删除或修改地址、端口、账号、私钥前检查工作区引用。
- `~/.ssh/config` 只做显式导入（HostName、Port、User、IdentityFile）；不支持的选项保留提示，不改写用户配置。
- 认证二选一：密码或已有私钥。私钥按档案指定路径读取，缺省在 `~/.ssh` 找 `id_ed25519`、`id_ecdsa`、`id_rsa`。
- 连接解析入参只有 `SshTarget = { alias }`，认证方式从档案解析。`cacheKey` 覆盖真实身份、认证方式、私钥摘要与目标的 known_hosts 记录，任一变化即换新连接。
- 认证代次：断开、凭据改写或重新连接都会递增 `pool.generation(alias)`；长任务在返回前复核代次，迟到结果不能回填新身份。
- 主机信任：读用户 `~/.ssh/known_hosts` 校验。未知主机先做独立握手，返回 `SHA256:` 指纹和一次性挑战（两分钟、最多 32 个、一次消费）；确认后把公钥追加到 `~/.ssh/known_hosts`。不匹配或已吊销直接拒绝。
- 凭据：密码只存在内存与 DPAPI 密文中；`GET /api/ssh/credentials` 只返回状态布尔值；编辑时按需解密回填，响应 `no-store`，明文不进入列表、日志或查询缓存。
- 通道：`exec` 带超时与输出上限，`sftp` 与 `shell` 各自独占通道；单通道错误不影响连接池里的其他用途。

### 5.8 remote-files：服务器文件

- `binding.ts`：打开面板时把工作区配置、实际 SSH 身份与信任记录做成签名，创建或复用浏览会话都复验。
- `service.ts` + `directory.ts`：浏览会话每工作区最多 32 个、空闲 15 分钟过期；按层读取元数据，单层 10000 项或 4 MiB，每页 200 项；排序规则在 `directory-order.ts`（目录、文件、链接、其他，中文数字序，同序用原文兜底）。
- 操作：`preflight.ts` 生成两分钟有效的方案，`tasks.ts` 先把记录原子落盘再派发，`executor.ts` 用服务器已有 Python 标准库与 `renameat2(RENAME_NOREPLACE)` 执行，不覆盖、不跟随链接；`path-locks.ts` 按同身份相交路径排队，最多四项并行。
- 任务记录：`remote-file-tasks/<uuid>.json` 原子写入；损坏记录保留并阻断；后端重启不重放；派发后断线或取消标 `needs_check`，需重新核对源与目标才能确认。
- 下载（`downloads.ts` 与前端 `RemoteDownloadDialog.tsx`）仍在，但已决定移除，属待移除范围；删除后接口与界面都不再有下载入口。
- `sync-scope.ts` 只为条目的 `scope` 字段提供「是否在同步范围」的展示判定，随工作区模型收敛一并删除。同步协调与影响扫描的文件已不存在，旧文档里的双端协调描述不再适用。

### 5.9 remote-tools：MCP 桥（待移除）

stdio MCP 服务，由 Claude 与 Codex 按会话启动，只转发到后端内部接口：

| 工具 | 作用 |
|---|---|
| `remote_exec` | 在工作区服务器目录执行命令，返回 stdout、stderr 与退出码 |
| `remote_peek` | 只读查看服务器文件或目录：stat、head、tail、du |

`launch.ts` 用当前 Node 加 `tsx` 加载入口文件；工具名与 MCP 服务器名仍是旧前缀 `ssh-server`。`internal.routes.ts` 用会话令牌换出工作区，先过 `policy` 再执行 SSH，当前已没有任何同步前置或后置步骤。

设计 D6 与决策 D25 决定删除这条桥：删除后 Agent 只在自己的项目目录里工作，服务器面板回到纯人工工具，`chat/registry.ts`、`TurnEnv`/`acquireEnv`、`instructions.ts` 的远程指令与两个 CLI 的 MCP 注入一并消失。

### 5.10 policy：命令规则（待移除）

对 `remote_exec` 的字符串匹配：默认规则加每个工作区最多 20 条自定义字面规则，命中即拒绝并返回规则说明。它只是防误操作，不防有意绕过；终端与文件操作不经它。规则存在工作区记录的 `policy` 字段，读写走独立路由与完整工作区摘要。

### 5.11 metrics：服务器资源采样

- 采样命令固定且只读：hostname、`/proc/stat`、`/proc/loadavg`、`/proc/meminfo`、`nvidia-smi`（GPU 与计算进程各 3 秒）、`ps` 前 50 个进程；磁盘用 `df -Pk` 取项目目录所在文件系统。
- 缺失值保留 `null`，不显示为零；失败时保留最近读数并标记过期。
- 缓存按实际目标共享宿主读数，磁盘再按远端目录隔离；成功 5 秒、失败按间隔指数退避（上限 30 秒）、空闲 60 秒淘汰，最多 64 个宿主与 128 个目录。
- 前端 `useResources` 只在面板可见、页面可见、网页已连接且设置就绪时按间隔请求；隐藏即取消在途请求并停表，`gcTime: 0` 避免复用旧身份数据。
- 界面上的间隔（2–60 秒，默认 5）与超时（2–30 秒，默认 8）来自产品设置，页面隐藏时暂停。

#### 5.11.1 slurm：当前账号只读作业

- 唯一命令是 `LC_ALL=C squeue --noheader --user="$(id -un)" --format=...`，8 秒、512 KiB、最多 200 行；退出码 127 记为未安装，其他失败记为错误，成功但 stderr 非空只给通用警告。
- 结果短缓存 2 秒、最多 32 项，错误不缓存；认证变化清缓存并取消旧查询。
- 前端只展示固定文本表格，首次或手动查询，不定时刷新。

### 5.12 web：界面与状态

- 启动：`LocalSessionGate` 先 `POST /api/local-session`，10 秒超时，失败显示原因与重试按钮；成功后才启动 WebSocket 并挂载业务组件。
- 外壳：`App` 组合顶栏、环境摘要、服务器管理、设置、命令面板与 `WorkspacePanels`。`WorkspaceLayout` 管左栏与右区（导航 200–320px，≥1600px 横排，<1280px 自动收起），`WorkspaceArea` 用垂直分栏承载终端，终端首次打开后保持挂载。
- 状态：zustand 的 `chat-store` 管连接、当前工作区、Agent、草稿、轮次、审批与 `sessionOperations`；react-query 管工作区、会话、能力、设置、资源与 Slurm；partysocket 负责 `/ws` 重连（1 秒起翻倍，上限 15 秒，禁用发送缓冲以免重发对话）。
- 命令面板：`Ctrl+K`，包含新会话、打开终端、查看资源、设置、主题、侧栏，以及工作区与会话搜索。
- 当前完成度：左栏是占位文案「项目列表将在后续任务接入」，没有新建项目或新建会话入口；`SessionList`、`SessionGroup`、`SessionActionsDialog` 等已写好但未挂载；`RemoteFilesPanel` 与 `WorkspaceTools` 的 files 槽位都没有调用方。今天可用的路径是切换已有工作区、对话、资源、终端、服务器档案与密码、设置与命令面板。
- 顶栏标题、`LocalSessionGate` 标题与部分诊断文案仍写着 `ssh-server`，改名没有覆盖到界面。

### 5.13 desktop：桌面壳（待新增）

计划在 `apps/desktop` 放 Electron 主进程与 preload：主进程拉起本机 Fastify 服务后创建窗口加载其地址，preload 只经 `contextBridge` 暴露少量系统能力，关窗与退出时一并结束后端。开发循环用 `electron-vite`，安装包与签名留到 M4。目录尚未创建，当前入口仍只有浏览器。

### 5.14 错误文案与日志

- 对外错误只给分类与可操作提示（如「工作区不存在」「会话正在运行」「主机密钥已变化」），原始 stderr、绝对路径、凭据与协议诊断留在后端。
- 启动日志只有数据迁移结果、监听地址与环境探测摘要；环境探测只提取版本号，不回显工具输出。
- 原生配置的错误固定在 `settings/errors.ts`：格式或 Agent 不合法为 400，超限为 413，路径不安全与 revision 冲突为 409，读写失败为 500，未知异常统一折算成 500 的通用文案。产品设置文件损坏返回 503，工作区规则不可用同样返回 503。
- 迁移与文件任务的异常不会中止启动，但会逐条打印，便于用户自行核对旧目录。

### 5.15 terminal：网页终端通道

- 绑定：`POST terminal-binding` 签发五分钟有效的 HMAC 票，绑定固定目标（工作区、服务器、目录）、目标指纹与认证代次；过期只能换新票，不能直接开 PTY。
- 通道：独立 `WebSocketServer` 复用 Fastify 的升级入口，只接管终端路径，避免降低对话帧上限；输入为 base64 控制帧，单帧 32 KiB、控制帧 64 KiB、输出缓冲上限 1 MiB。
- 生命周期：打开 PTY 后立即监听 EOF 与退出，EOF 只算半关闭，退出码未知时保持 `null`；`preClose` 终止全部终端连接。
- 背压：待发送与未确认输出分别计数，输入输出队列独立，排空后再发退出。
- 前端：xterm 实例放在稳定运行时，分栏树只放槽位；每标签最多 4 窗格；多行粘贴先确认，按当前 bracketed-paste 模式封装。

## 6. 关键流程

### 6.1 一轮对话

1. 网页在 `/ws` 发送 `chat.send`，显式带 `agent`、`workspaceId`、`clientTurnId`，可选 `sessionId`、`model`、`reasoningEffort` 与能力选择。
2. `TurnManager` 检查该会话是否在运行，在运行则回错误；取工作区租约后回 `turn.started`。
3. 准备阶段读取工作区、复核会话归属、按选择或 `/` 名称解析能力、取对应 runner；任一步失败都以 `error` 收尾并释放租约。
4. runner 启动或复用原生进程，事件经 `agent.event` 转发；审批事件挂起等待网页答复，答复必须同时匹配连接、轮次与请求 id。
5. 轮次结束发 `turn.finished`；`changes` 只在原生工具事件报告过文件改动时出现，前端已不渲染。
6. 全程没有同步、提交或快照动作，CLI 直接写工作区目录。

### 6.2 会话发现与历史

- 列表：`GET /api/workspaces/:id/sessions?agent=` 按工作区目录筛选（Claude 用 SDK 会话接口，Codex 用 `thread/list`，可带 `archived`），响应 `no-store`。
- 历史：读原生记录后复核 id 与 `cwd`，返回事件数组；前端按选择代次丢弃迟到结果。
- 管理：改名、删除、归档、分叉都调原生接口，并在会话锁内执行；删除要求 `confirmed`，标题 1–200 字符；分叉只接受服务端给出的可信点。
- 归属只按原生 `cwd` 判定；不属于任何工作区目录的会话不会出现在列表里，「显示其他目录的会话」开关尚未实现。

### 6.3 资源显示

打开资源面板 → 固定目标（工作区、服务器、目录）→ `GET /resources` → 后端复验目标后命中缓存或采样 → 前端按设置间隔（默认 5 秒）刷新，面板隐藏、页面隐藏或断线即停。Slurm 独立首次或手动查询，两者都不进入对话，也不推断任务完成。

### 6.4 直接管理服务器文件

打开服务器文件视图 → 绑定并建立浏览会话 → 逐层读取元数据 → 选择源与目标 → 预检并确认影响 → 提交任务 → 服务器侧执行 → 查询结果并刷新目录。仅服务器内操作，不经本机中转，不触发对话或模型。

当前后端与接口齐备，但面板尚未挂载到界面；下载链路仍在代码里，属待移除范围。

### 6.5 启动与旧数据迁移

`main` 依次执行：读取配置（拒绝非回环监听与非法端口）→ 迁移旧数据目录 → 创建数据目录 → 组装工作区存储、服务器档案、连接池、终端、资源、Slurm、文件服务与轮次管理 → 构建 Fastify 并注册路由 → 监听 → 打印访问地址与环境探测结果。收到 SIGINT 或 SIGTERM 时依次释放终端、资源、Slurm、连接池，再停止轮次并关闭 HTTP。

## 7. 设计决策

取舍集中在[设计决策](decisions.md)。D1 记录本次产品转向，取代上一代关于同步、版本、本地文件与网页形态的部分；SSH 认证、终端、资源与 Slurm 的既有判断继续有效。以下原则与代码一致：

- 会话固定 Agent，沿用原生上下文与原生会话 id。
- 会话正文只来自 CLI 存储，本产品不落库、不导出、不做事件投影缓存。
- 服务器是人的工具：终端、资源、Slurm、文件管理都不经过 Agent。
- 服务器凭据只用 Windows 当前用户加密保存，明文不进入配置与日志。
- 同名目标只允许一条档案，连接按真实身份与认证代次复用。
- 删除的域不保留开关或兼容路径；改名迁移只有一次，且不覆盖新目录。

## 8. 验证依据与边界

- 验收编号 A1–A29 见[需求](../product/requirements.md)，是条件而不是现状；代码存在不等于条目通过。
- 当前明确未满足的部分：桌面壳、Antigravity 接入、项目列表与新建入口、服务器面板以档案为键、原生配置覆盖面、启动环境注入、下载移除、会话实时监听。
- 已有实现并有测试覆盖的部分：两个适配器的会话读取与轮次协议、审批、工作区与设置存储、SSH 档案与凭据、主机信任、终端、资源采样、Slurm 文本查询、服务器文件操作、环境探测。
- 测试在各包 `tests/` 下按模块镜像；真实链路用 `scripts/dev/e2e-*.ts`；没有 Playwright 端到端测试。
- 浏览器访问同一地址仍然可用，但按设计它不是产品入口；桌面壳落地前不应把它写成已交付形态。
- 未验证项：真实 Antigravity 会话、真实集群上的 Slurm 成功输出、操作系统输入法、安装包与自动更新。
