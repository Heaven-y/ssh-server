# 架构

更新日期：2026-11-04。本文按当前工作树描述 AgentDeck（原 `ssh-server`）的真实分层。产品已从「本地改代码、rclone 同步、服务器上运行」转向「本机统一管理 Claude Code / Codex / Antigravity 的原生会话」；同步、版本、本地文件镜像、旧工作区向导、命令黑名单与 MCP 桥都已从代码中删除。M1 是网页形态的只读工作台，Electron 壳尚未创建（M1.5）。需求见[需求](../product/requirements.md)，取舍见[设计](../superpowers/specs/2026-11-03-native-cli-workbench-design.md)与[设计决策](decisions.md)，进度见[路线图](../roadmap.md)。

## 1. 总览

```text
┌────────────────────── 本机（AgentDeck）──────────────────────┐
│ 浏览器界面 apps/web（React + Vite；Electron 壳属 M1.5）        │
│   │ HTTP + WebSocket /ws                                        │
│ 后端 apps/server（Fastify，只监听回环地址）                     │
│   ├─ projects     项目存储、旧字段导入、目录迁移、活动计数        │
│   ├─ sessions     三个 CLI 的会话归属裁决                        │
│   ├─ agents       Claude / Codex / Antigravity 读取与探测        │
│   ├─ chat         轮次管理、能力目录（M2 才接入界面）            │
│   ├─ settings     产品偏好与原生配置（原生配置仅局部）            │
│   ├─ process      中立子进程运行器                              │
│   ├─ ssh          档案、连接池、主机信任、SFTP、执行              │
│   ├─ terminal     服务器 SSH 的 PTY 通道                        │
│   ├─ resources    资源采样                                     │
│   ├─ slurm        当前账号作业查询                               │
│   └─ remote-files 服务器文件浏览与操作                           │
└───────────────────────────┬──────────────────────────────────┘
                            │ SSH（密码或已有私钥）
┌───────────────────────────服务器─────────────────────────────┐
│ 只承载人的操作：PTY、只读采样、squeue、文件增删改移              │
│ 不安装 Agent、不驻留服务、不存放本产品的数据                     │
└──────────────────────────────────────────────────────────────┘
```

- 会话正文与原生配置的唯一来源是各 CLI 自己的存储（`~/.claude`、`~/.codex`、`~/.gemini/antigravity-cli`）。本产品落盘的只有项目、服务器档案、产品偏好、加密凭据与文件任务记录。
- 当前开发入口是 `npm run dev`：Vite 跑 5173，后端默认 4317，浏览器访问 Vite；`--dev-origin` 或 `AGENTDECK_DEV_ORIGIN` 才允许该来源。`npm start` 构建前端后由后端静态托管。
- M1 的主区只读：`SessionPane` 只挂 `SessionHistory`，没有输入框。后端已有的对话轮次代码（`chat/`、`/ws`）保留给 M2，不构成 M1 的界面能力。
- 服务器面板在 M1 仍以「绑定了服务器的项目」为入口；改成以服务器档案为身份是 M3，代码里终端、资源、Slurm 与文件仍按 `workspaceId` 取目标。
- `workspaces/setup`、`workspaces/removal.ts`、`remote-tools/`、`policy/` 都已删除，不在现行模块表中。

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 运行环境 | Node.js ≥22 + TypeScript 5.9 | 用 `tsx` 直接运行，尚无打包产物 |
| 后端 | Fastify 5 + `@fastify/websocket` 11 | 回环 HTTP、WebSocket 升级与静态托管 |
| 参数校验 | zod 4 | 接口入参、配置文件、共享协议 |
| Claude | `@anthropic-ai/claude-agent-sdk` 0.3.286 | 只作协议客户端；会话读取走 SDK，历史与轮次共用平台包里的原生程序 |
| Codex | 本机 `codex app-server` | JSON-RPC over stdio，不打包、不锁定版本 |
| SSH | `ssh2` 1.17 | 密码或已有私钥，主机密钥校验，SFTP 与 PTY |
| 前端 | React 19 + Vite 8 + Tailwind CSS 4 | |
| 前端组件 | Ariakit、react-resizable-panels、cmdk、lucide-react | 弹层、停靠分栏、命令面板与图标 |
| 时间线渲染 | streamdown、react-virtuoso | 历史 Markdown 与长列表虚拟滚动 |
| 状态与数据 | zustand、`@tanstack/react-query`、partysocket | 会话选择、接口缓存、WebSocket 重连 |
| 终端 | `@xterm/xterm` + `@xterm/addon-fit` | |
| 配置与文件编辑 | `@uiw/react-codemirror` + CodeMirror 6 | JSON、TOML、Markdown 语言包 |
| 字体 | `@fontsource/ibm-plex-sans`、`@fontsource/jetbrains-mono` | 本地打包，不访问外部字体服务 |
| 存储 | 本机 JSON + Windows 当前用户加密 | 配置明文，密码与密钥值只存密文 |

依赖版本固定在根与各包的 `package.json`。rclone、本机 git 与 `@pierre/diffs` 已随三个域删除；外部命令不再经过 shell，统一走 `process/run.ts` 或 SSH 通道。

### 2.1 本机协调与远程计算

后端负责启动与回收 CLI 子进程、把原生事件转成统一事件、维护会话锁，并转发网页指令。模型调用发生在 CLI 进程内部，后端自己不请求任何模型端点，也不保存密钥值。

服务器侧只执行人点出来的操作：只读资源采样、Slurm 文本查询、终端命令、服务器文件管理。Agent 不持有服务器工具，服务器上也不运行 Agent。

本地目录不再有镜像与副本：CLI 的工作目录就是项目目录本身，没有前置或后置传输，也没有版本快照。

### 2.2 异步处理与并发边界

- 请求路径上不跑阻塞命令。子进程由 `runProcess` 异步执行，带超时、输出上限与取消信号；SSH 操作同样带本机截止时间。
- 同一会话同一时刻只允许一轮：`TurnManager` 用 `${agent}:${sessionId}` 记占用，重复发送立刻回错误，不同会话互不阻塞。
- 改名、删除、归档与分叉由 `withIdleSession` 占用同一把会话锁，忙时返回 409；M1 界面没有这些入口，但接口和测试仍在。
- 轮次启动前向 `workspaces/activity` 取活动计数，结束释放；文件任务也复用同一计数。旧「移除工作区前必须清空租约」的链条已删除，计数只用于活动登记。
- 回合事件只发给发起该轮的 WebSocket；连接断开时，待审批请求按拒绝收尾，不做服务端缓冲或跨连接续传（设计要求按会话缓冲，尚未实现）。
- SSH 连接按 alias 复用，exec、SFTP、PTY 各自独占通道；单通道失败只释放自己，不断开共享连接。
- 资源与 Slurm 共用固定目标上下文，同身份的并发读取合并为一次采样；认证代次或连接 `cacheKey` 变化后，旧结果不能回填新身份。
- 服务器文件任务按同目标的相交路径排队，最多四项并行；任务记录先原子落盘再派发。
- 终端每项目最多 8 个会话、全局 32 个，单标签最多 4 个窗格。
- 这是单用户、多活动的并发模型，不引入多用户服务，也不承诺未测量的吞吐指标。

## 3. 仓库结构

使用 npm workspaces，前后端各自持有依赖、TypeScript 配置与测试。

```text
agentdeck/
├─ apps/
│  ├─ server/
│  │  ├─ src/
│  │  │  ├─ main.ts               # 组装依赖、启动、优雅退出
│  │  │  ├─ config.ts             # 环境变量与命令行参数
│  │  │  ├─ agents/               # 14 个根文件 + antigravity/ 2 + codex/ 12
│  │  │  ├─ chat/                 # 3 个：turn-manager、sessions、capabilities
│  │  │  ├─ http/                 # 19 个：路由、访问控制、终端升级
│  │  │  ├─ process/              # 1 个：run.ts
│  │  │  ├─ remote-files/         # 15 个 TypeScript + remote-helper.py
│  │  │  ├─ resources/            # 6 个：采样命令、解析、缓存、目标与服务
│  │  │  ├─ sessions/             # 1 个：ownership.ts（归属裁决）
│  │  │  ├─ settings/             # 4 个：safe-file、native-config、product-settings、errors
│  │  │  ├─ slurm/                # 4 个：commands、parse、service、abort
│  │  │  ├─ ssh/                  # 18 个：档案、连接池、凭据、主机信任、SFTP、执行与保护
│  │  │  ├─ terminal/             # 8 个：binding、manager、session、initialization、input、output 等
│  │  │  └─ workspaces/           # 5 个：store、activity、bound、import、migrate-legacy
│  │  └─ tests/                   # 按 src 模块镜像
│  └─ web/
│     ├─ src/
│     │  ├─ app/                  # 外壳、顶栏、三段布局、命令面板、服务器停靠区
│     │  ├─ features/             # chat、sessions、ssh、terminal、resources、remote-files、settings
│     │  ├─ ui/                   # 通用弹层、CodeMirror、列表导航、界面偏好
│     │  ├─ lib/                  # api、query-client、ws、可取消请求
│     │  └─ main.tsx、styles.css
│     └─ tests/                   # 与 lib、features、app 对应
├─ packages/shared/src/           # 前后端共享协议与类型
├─ scripts/dev/                   # check-docs、e2e-*、夹具与安装脚本
└─ docs/                          # 需求、界面、架构、决策、路线图、设计与验收记录
```

已从工作树删除、不要再按现行架构阅读：`apps/server/src/{sync,vcs,files,remote-tools,policy}`、`workspaces/setup`、`workspaces/removal.ts` 与 `removal-resources.ts`、对应的 HTTP 路由，以及 `apps/web/src/features/{sync,versions,changes,files,workspaces/setup}`。`@pierre/diffs`、`@modelcontextprotocol/sdk`、rclone 与 `AGENTDECK_RCLONE` 也一并消失。

约定：

- 前后端按功能分目录，通用部分才放 `lib` / `ui`；不额外造控制器、服务或仓储层。
- 单元与模块集成测试统一放所属包的 `tests/`，路径镜像 `src/`，保留 `*.test.ts` 命名；Vitest 只发现这些目录。
- 真实链路验收仍用 `scripts/dev/e2e-*.ts` 与 `ssh-smoke.ts`；没有 Playwright 端到端目录。
- 根目录只放仓库入口文档与工具需要的配置。

## 4. 本地数据存放

```text
%LOCALAPPDATA%\AgentDeck\
├─ workspaces.json          # 项目列表，不含密码
├─ servers.json             # 服务器档案，最多 128 条
├─ product-settings.json    # 产品偏好：默认 CLI、资源间隔与超时
├─ credentials\             # <sha256>.json，Windows 当前用户加密后的密文
└─ remote-file-tasks\       # 服务器文件任务：<uuid>.json 与临时文件
```

- 目录名来自 `config.ts` 的 `CONFIG_DIR_NAME = 'AgentDeck'`；`AGENTDECK_CONFIG_DIR` 可改到别处，非 Windows 平台退到 `~/.local/share`。
- 会话历史不在本产品目录：Claude 在 `~/.claude`（`CLAUDE_CONFIG_DIR` 可改），Codex 在 `~/.codex`（`CODEX_HOME` 可改）。本产品按原生 id 读取，不复制正文。
- **两层旧数据迁移**：`migrate-legacy.ts` 先把 `%LOCALAPPDATA%\ssh-server` 的 `servers.json` 与 `workspaces.json` 复制到新目录；随后 `import.ts` 把旧字段 `localDir` / `sshHost` 改写为 `dir` / `server`，丢弃 `sync`、`policy` 等键，坏行跳过，原文件备份为 `.bak`。新目录已有同名文件不覆盖，旧目录原样保留。
- 凭据：`credentials\` 下每个文件按目标摘要命名，内容是 DPAPI 密文；目录 0700、文件 0600。明文密码不进 JSON、日志、命令行或对话。
- 原生配置保存不做备份：`settings/safe-file.ts` 只在同目录写临时文件再原子替换，设计里的 `backups\` 尚未实现。
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
| `CLAUDE_CODE_EXECUTABLE` | Claude 探测时的可执行文件覆盖口 |
| `CLAUDE_CONFIG_DIR` / `CODEX_HOME` | 原生配置的读取位置 |

## 5. 模块设计

### 5.1 workspaces：项目存储、导入与迁移

- `store.ts`：读写 `workspaces.json`。落盘 schema 为 `name`、`dir`（绝对路径）、`server`、`remoteDir`，`id` 唯一；另校验 `dir` 为绝对路径、`server` 与 `remoteDir` 同进同退。读取串行，写入用临时文件加 rename。
- `validate()`：`dir` 必须绝对且真实存在；带 `server` 时该别名必须已在 `servers.json` 登记；`server` 与 `remoteDir` 缺一即抛带 `field` 的 `WorkspaceValidationError`。
- `bound.ts`：`boundWorkspace()` 只把同时有服务器与默认目录的项目交给服务器面板；未绑定时各域按自己的错误码拒绝。
- `activity.ts`：按项目计数的活动登记；`acquire()` 覆盖异步等待，释放幂等。旧 closing 门禁与工作区移除链已删除。
- `migrate-legacy.ts`：只复制 `servers.json` 与 `workspaces.json`，不覆盖，旧目录保留，单个失败记入报告继续。
- `import.ts`：字段级转换。显式重建记录，不展开原对象；目录不是绝对路径、不存在、`server`/`remoteDir` 只出现一半或 id 重复时只跳过该条；原文件先改名为 `.bak` 再原子写新文件。

### 5.2 sessions：会话归属裁决

- `ownership.ts` 是同步纯函数，不访问磁盘。`normalizeDirectory()` 只接受 Windows 盘符/UNC 与 POSIX 绝对路径：Windows 统一小写，POSIX 保留大小写。
- `parseWorkspaceUris()` 接受 JSON 字符串数组、单个值或换行/分号分隔；`localPathFromUri()` 只认 `file://`，支持 `file://server/share` 的 UNC 形式，其余返回 `null`。
- `resolveProjectId()` 把 `cwd` 与 `workspace_uris` 都作为候选，按项目配置顺序找第一个「等于项目目录或位于其下」的项目；候选全部解析不出时返回 `null`，绝不回退到第一个项目。
- `chat/sessions.ts` 的 `list()` 对 Claude/Codex 传入当前项目目录，对 Antigravity 不传 `cwd` 兜底；列表结果再按投影出的 `projectId` 裁掉不属于当前项目的行。

### 5.3 agents：适配器与本机探测

- `agents/probe.ts` 是第一层本机探测（`createAgentProbes({ run, env? })`）。每个 Agent 声明可执行文件名、版本正则、`--help` 必须具备的选项与必需环境变量；Codex 另加 `app-server generate-json-schema`。
- 判定顺序：找不到可执行文件 → `missing`；版本号解析不出 → `changed` 且 `missing: ['--version']`；关键选项缺失 → `changed` 并列出缺项；必需环境变量缺失 → `credential-missing`；否则 `available`。全程只用 `--version`、`--help` 与本地 schema 生成，5 秒超时、输出有上限，不读能力目录、不检查登录态、不向模型端点发请求。
- 实测 `agy` 把 `--help` 写到 stderr，能力核对合并 stdout 与 stderr 两路输出；版本解析也同时看两路。
- `createLocalRunner()` 把 `claude` / `codex` / `agy` 解析成本机真实程序：优先显式环境变量（`CLAUDE_CODE_EXECUTABLE`、`AGENTDECK_CODEX`），其次 PATH（Windows 上解析 `.cmd` / `.ps1` 包装脚本指向的真实 `.exe` 或 `.js` 入口），Antigravity 另认 `%LOCALAPPDATA%\agy\bin\agy.exe`。
- Claude 会话读取走 `claude-sessions.ts`（SDK 的 list/info/messages/rename/delete/fork），列表按 `cwd` 复核；对话轮次仍由 SDK 平台包内的 Claude 程序驱动，探测显示的是 PATH 上那份 `claude` 的版本，两者只在版本相同时才一致。
- Codex 会话读取与操作走 `agents/codex/sessions.ts` 的 app-server `thread/*` 接口，不直接解析 `~/.codex` 的 JSONL 或 SQLite；启动依次找 `AGENTDECK_CODEX`、PATH 上的 `codex.exe`、官方 npm 包的 vendor 可执行文件与 `bin/codex.js`。
- Antigravity 只有只读会话枚举：`agents/antigravity/summaries.ts` 用 Node 22 内置 `node:sqlite` 读 `conversation_summaries` 表，过滤内部子代理与 battle 行；损坏、缺列或锁冲突按空列表处理。`sessions.ts` 不提供对话适配器，`read()` 固定返回 501 `session_not_replayable`。

### 5.4 chat：轮次、会话与能力

- `turn-manager.ts`：建立轮次、取活动计数、串行准备、把事件投给发起连接、路由审批答复、收尾并释放锁。M1 界面不发送 `chat.send`，这条链路留给 M2。
- `sessions.ts`：按 Agent 注册 provider，提供列表、读取、归属校验、分叉与原生操作；读取时复核原生 `cwd` 与项目目录（`sameSessionDirectory`），失败匿名化为 503。
- `capabilities.ts`：读取原生目录并解析选择；未知、禁用、歧义直接报错，不降级成普通文本；要求会话的命令在无 id 时拒绝。能力目录只在第二档动作时读取。
- `ws.routes.ts`：`/ws` 只处理已握手连接；M1 没有输入框，因此实际不会从这里发出回合。

### 5.5 process：中立子进程运行器

`runProcess(executable, args, options)` 返回 `{ stdout, stderr, exitCode }`。`shell: false`、`windowsHide: true`，支持 stdin 输入、独立环境、超时、输出总上限与 `AbortSignal`；超限、超时、取消与启动失败统一抛 `ProcessError`。依赖它的只有 `agents/probe.ts` 与 `ssh/windows-protection.ts`；CLI 适配器自己管理长驻管道。

### 5.6 settings：产品偏好与原生配置

- `safe-file.ts`：逐层 `lstat` 检查目录、拒绝符号链接与非常规文件、上限 256 KiB，`revision` 取内容 sha256；读取前后核对身份，写入走同目录临时文件再 rename。
- `native-config.ts`：当前只覆盖 Claude `settings.json`（JSON 对象）与 Codex `config.toml`（TOML）。路径取 `CLAUDE_CONFIG_DIR` / `CODEX_HOME` 或 `~/.claude`、`~/.codex`；保存要求 revision 未变，冲突拒绝；按 Agent 串行。
- 需求 F4 里的 `CLAUDE.md`、`AGENTS.md`、项目级配置与 Antigravity 配置都还没有实现，接口只接受 `claude` 与 `codex` 两个固定 Agent。
- `product-settings.ts`：字段为 `defaultAgent` 与 `resources.{intervalSeconds,timeoutSeconds}`；读取时定点剔除已退休的 `defaultModels`、`syncDefaults`、`syncIntervalSeconds`，其他未知字段仍拒绝；坏文件返回 503，版本冲突按 409 语义处理。
- 环境报告不再单独探测 git/rclone，只调用 `agents/probe.ts` 的三 CLI 结果。

### 5.7 http：访问控制与路由

- 只监听回环。`config.ts` 在启动时拒绝其他 host。
- `security.ts` 的 `onRequest` 钩子依次校验：Host 必须是本机地址且端口匹配实际监听值（含开发来源），挡住 DNS 重绑定；修改类请求与 WebSocket 校验 Origin，`Sec-Fetch-Site: cross-site` 直接拒绝；`/api/*` 与 `/ws` 需要有效会话 Cookie。
- 会话 Cookie 名为 `AGENTDECK_session`，HttpOnly、SameSite=Strict，比较用常量时间。唯一免登录入口是 `POST /api/local-session`：同源握手成功后写 Cookie 并返回 204；业务组件与 WebSocket 在握手成功前不挂载。
- 所有响应带 `X-Frame-Options: DENY` 与 `frame-ancestors 'none'`；请求体上限 1 MiB，对话 WebSocket 载荷上限同为 1 MiB，终端另有独立上限。
- 静态托管 `apps/web/dist`，非接口的 GET 回退到 `index.html`。

M1 的公开接口面：

| 模块 | 主要接口 |
|---|---|
| 本机会话 | `POST /api/local-session` |
| 项目 | `GET /api/projects`、`POST /api/projects`、`PATCH /api/projects/:id`、`DELETE /api/projects/:id` |
| 会话 | `GET /api/projects/:id/sessions?agent=`、`GET /api/projects/:id/sessions/:agent/:sessionId` |
| 探测 | `GET /api/agents/probes` |

仍存在但属于兼容或后续里程碑的接口：

| 模块 | 接口 | 状态 |
|---|---|---|
| 会话读取别名 | `GET /api/workspaces/:id/sessions`、`GET /api/workspaces/:id/sessions/:sessionId/events?agent=` | 与项目路径同实现，前端 M1 仍走别名 |
| 会话动作 | `POST /api/workspaces/:id/sessions/:sessionId/actions`、`POST .../fork` | 接口可用，M1 界面不使用 |
| 能力目录 | `GET /api/workspaces/:id/agent-capabilities` | M2 的「刷新能力」使用 |
| 产品设置与环境 | `GET/PUT /api/settings/product`、`GET/POST /api/settings/environment` | 部分设置界面使用 |
| 原生配置 | `GET/PUT /api/agent-config/:agent` | 仅 Claude/Codex 两个文件 |
| 服务器档案 | `GET/POST /api/ssh-targets`、`GET /import-options`、`PUT/DELETE /:alias`、密码读写子路径 | 按工作区引用保护 |
| 主机信任 | `POST /api/ssh/host-key`、`POST /api/ssh/host-key/confirm` | |
| 连接与凭据 | `POST /api/ssh/connect`、`GET/PUT /api/ssh/credentials`、`POST /api/ssh/disconnect` | |
| 终端 | `POST /api/workspaces/:id/terminal-binding`、`GET /api/workspaces/:id/terminal`（WebSocket） | 按项目绑定目标 |
| 资源与作业 | `GET /api/workspaces/:id/resources`、`GET /api/workspaces/:id/slurm` | 按项目绑定目标 |
| 服务器文件 | `/api/workspaces/:id/remote-files/` 下的 bindings、sessions、preflights、tasks 与 download | 下载仍在，移除未落地 |
| 对话 | `GET /ws`（WebSocket） | M2 使用 |

### 5.8 ssh：档案、连接与信任

- 档案存 `servers.json`，alias 为 `managed-ssh-<uuid>`；同 hostname、端口、账号不允许重复，最多 128 条。删除或修改地址、端口、账号、私钥前检查项目引用。
- `~/.ssh/config` 只做显式导入（HostName、Port、User、IdentityFile）；不支持的选项保留提示，不改写用户配置。
- 认证二选一：密码或已有私钥。私钥按档案指定路径读取，缺省在 `~/.ssh` 找 `id_ed25519`、`id_ecdsa`、`id_rsa`。
- 连接解析入参只有 `SshTarget = { alias }`，认证方式从档案解析。`cacheKey` 覆盖真实身份、认证方式、私钥摘要与目标的 `known_hosts` 记录，任一变化即换新连接。
- 认证代次：断开、凭据改写或重新连接都会递增 `pool.generation(alias)`；长任务在返回前复核代次，迟到结果不能回填新身份。
- 主机信任：读用户 `~/.ssh/known_hosts` 校验。未知主机先做独立握手，返回 `SHA256:` 指纹和一次性挑战（两分钟、最多 32 个、一次消费）；确认后追加公钥。不匹配或已吊销直接拒绝。
- 凭据：密码只存在内存与 DPAPI 密文中；`GET /api/ssh/credentials` 只返回状态布尔值；编辑时按需解密回填，响应 `no-store`，明文不进入列表、日志或查询缓存。

### 5.9 terminal：网页终端通道

- 绑定：`POST terminal-binding` 签发五分钟有效的 HMAC 票，绑定固定目标（项目、服务器、目录）、目标指纹与认证代次；过期只能换新票，不能直接开 PTY。
- 通道：独立 `WebSocketServer` 复用 Fastify 的升级入口，只接管终端路径，避免降低对话帧上限；输入为 base64 控制帧，单帧 32 KiB、控制帧 64 KiB、输出缓冲上限 1 MiB。
- 生命周期：打开 PTY 后立即监听 EOF 与退出，EOF 只算半关闭，退出码未知时保持 `null`；`preClose` 终止全部终端连接。
- 背压：待发送与未确认输出分别计数，输入输出队列独立，排空后再发退出。
- 前端：xterm 实例放在稳定运行时，分栏树只放槽位；每标签最多 4 窗格；多行粘贴先确认，按当前 bracketed-paste 模式封装。

### 5.10 resources 与 slurm：只读采样

- 采样命令固定且只读：hostname、`/proc/stat`、`/proc/loadavg`、`/proc/meminfo`、`nvidia-smi`（GPU 与计算进程各 3 秒）、`ps` 前 50 个进程；磁盘用 `df -Pk` 取项目目录所在文件系统。
- 缺失值保留 `null`，不显示为零；失败时保留最近读数并标记过期。缓存按实际目标共享宿主读数，磁盘再按远端目录隔离；成功 5 秒、失败按间隔指数退避（上限 30 秒）、空闲 60 秒淘汰。
- 前端只在面板可见、页面可见、网页已连接且设置就绪时按间隔请求；隐藏即取消在途请求并停表，`gcTime: 0` 避免复用旧身份数据。
- Slurm 的唯一命令是 `LC_ALL=C squeue --noheader --user="$(id -un)" --format=...`，8 秒、512 KiB、最多 200 行；退出码 127 记为未安装。结果短缓存 2 秒、最多 32 项，错误不缓存；认证变化清缓存并取消旧查询。
- 前端只展示固定文本表格，首次或手动查询，不定时刷新；Slurm 在资源视图内。

### 5.11 remote-files：服务器文件

- `binding.ts`：打开面板时把项目配置、实际 SSH 身份与信任记录做成签名，创建或复用浏览会话都复验。
- `service.ts` + `directory.ts`：浏览会话每项目最多 32 个、空闲 15 分钟过期；按层读取元数据，单层 10000 项或 4 MiB，每页 200 项；排序在 `directory-order.ts`（目录、文件、链接、其他，中文数字序，同序用原文兜底）。
- 操作：`preflight.ts` 生成两分钟有效的方案，`tasks.ts` 先把记录原子落盘再派发，`executor.ts` 用服务器已有 Python 标准库与 `renameat2(RENAME_NOREPLACE)` 执行，不覆盖、不跟随链接；`path-locks.ts` 按同身份相交路径排队，最多四项并行。
- 任务记录：`remote-file-tasks/<uuid>.json` 原子写入；损坏记录保留并阻断；后端重启不重放；派发后断线或取消标 `needs_check`。
- 下载（`downloads.ts` 与前端 `RemoteDownloadDialog.tsx`）仍在代码里，已决定移除但尚未落地；删除后接口与界面才不再有下载入口。
- `sync-scope.ts` 仍为条目的 `scope` 字段提供展示判定，是同步域遗留；它不参与会话主路径，随工作区模型彻底收敛一并删除。

### 5.12 web：界面与状态

- 启动：`LocalSessionGate` 先 `POST /api/local-session`，10 秒超时，失败显示原因与重试按钮；成功后才启动 WebSocket 并挂载业务组件。
- 外壳：`App` 组合 `TopBar`、`Sidebar`、`SessionPane`、`ServerDock`、`AddProjectDialog`、服务器管理、设置与命令面板。`WorkspaceLayout` 管左栏（200–320px，<1280px 自动收起）；`WorkspaceColumns` 管右侧单停靠区（360–720px）。
- 主区：`SessionPane` 只按状态选择加载、错误、空项目、选中会话；选中后挂 `SessionHistory`，再拆成 `SessionHeader` 与 `SessionTimeline`。没有 `ChatView` 或 `Composer` 的挂载点。
- 左栏：`Sidebar` 展示项目树、三个 CLI 分组、当前选择与「显示其他目录的会话」；`NewSessionMenu` 与行内管理入口仍在，但 M1 不承担发送与会话管理验收。
- 状态：zustand 的 `chat-store` 管连接、当前项目、Agent、会话选择与历史状态；react-query 管项目、会话、历史、设置、资源与 Slurm；partysocket 负责 `/ws` 重连（1 秒起翻倍，上限 15 秒，禁用发送缓冲）。
- 命令面板：`Ctrl+K`，包含新会话、打开终端、查看资源、设置、主题、侧栏与项目/会话搜索。
- 当前完成度：三段式外壳、项目添加、会话列表与只读历史已接入；服务器面板的终端、资源、文件三视图可用，但要求项目绑定服务器，而界面还没有绑定表单，因此只有迁移过来的已绑定项目能打开它们。原生配置界面只覆盖两个文件，启动环境与服务器面板档案化尚未开始。

### 5.13 desktop：桌面壳（待新增，M1.5）

计划在 `apps/desktop` 放 Electron 主进程与 preload：主进程拉起本机 Fastify 服务后创建窗口加载其地址，preload 只经 `contextBridge` 暴露少量系统能力，关窗与退出时一并结束后端。开发循环用 `electron-vite`，安装包与签名留到 M4。目录尚未创建，当前入口仍只有浏览器。

### 5.14 错误文案与日志

- 对外错误只给分类与可操作提示（如「项目不存在」「会话正在运行」「主机密钥已变化」），原始 stderr、绝对路径、凭据与协议诊断留在后端。
- 启动日志只有数据迁移结果、监听地址与三个 CLI 的探测摘要；探测只报四态与版本号，不回显工具输出、路径或凭据。
- 原生配置的错误固定在 `settings/errors.ts`：格式或 Agent 不合法为 400，超限为 413，路径不安全与 revision 冲突为 409，读写失败为 500，未知异常统一折算成 500 的通用文案。产品设置文件损坏返回 503。
- 迁移与文件任务的异常不会中止启动，但会逐条打印，便于用户自行核对旧目录。

## 6. 关键流程

### 6.1 项目创建与旧数据迁移

1. `main` 读取配置，拒绝非回环监听与非法端口；调用 `migrate-legacy.ts` 复制旧目录的两个配置文件。
2. 创建数据目录，初始化 `createProductSettings`、`createAgentProbes`、`createServerTargets` 与 `createWorkspaceStore`。
3. 调用 `importLegacyWorkspaces()` 做字段级转换；没有文件或已是新结构时为空报告，坏文件保留原样。
4. 前端 `POST /api/projects`，store 校验绝对路径、目录存在与服务器别名，写入 `workspaces.json`；`PATCH` 只改请求里出现的键，`DELETE` 只删记录。

### 6.2 会话发现与历史

1. 左栏对每个项目、每个 Agent 调 `GET /api/projects/:id/sessions?agent=`，响应 `no-store`。
2. `SessionsService.list()` 调对应 provider；Claude/Codex 的 provider 已按目录过滤，Antigravity 返回全量元数据。
3. 服务层用 `resolveProjectId()` 按 `cwd` / `workspace_uris` 投影 `projectId`，路由再裁掉不属于当前项目的行。
4. 点会话后 `GET /api/projects/:id/sessions/:agent/:sessionId`；读取原生记录后复核 id 与 `cwd`，返回统一事件数组。
5. Antigravity 的 `read()` 直接抛 501；前端按错误码走「不可回放」说明页，不降级成普通加载失败。

### 6.3 本机探测

启动时 `probeAll()` 并发跑三个 CLI，每个独立判定四态并打印摘要；`GET /api/agents/probes` 每次重新真实探测，逐次声明 `no-store`。探测只跑本地命令，不读能力目录，也不向模型端点发请求。

### 6.4 服务器面板

面板入口在左栏与顶栏：只有同时有 `server` 与 `remoteDir` 的项目才算绑定（`boundWorkspace()`）。打开终端时用项目与绑定目录生成目标，复验 SSH 身份与信任记录后建立 PTY；资源与文件同样按项目 id 取目标。M1 没有绑定表单，新建项目一律未绑定；改成以服务器档案为身份是 M3。

### 6.5 启动与退出

`main` 依次：读取配置（拒绝非回环监听与非法端口）→ 迁移旧数据目录 → 字段导入 → 创建数据目录 → 组装项目存储、服务器档案、连接池、终端、资源、Slurm、文件服务与轮次管理 → 构建 Fastify 并注册路由 → 监听 → 打印访问地址与三个 CLI 的探测结果。收到 SIGINT 或 SIGTERM 时依次释放终端、资源、Slurm、连接池，再停止轮次并关闭 HTTP。

## 7. 设计决策

取舍集中在[设计决策](decisions.md)。D1 记录产品转向，D3 记录三个域的删除，D26 记录服务器面板的目标形态。以下原则与代码一致：

- 会话固定 Agent，沿用原生上下文与原生会话 id。
- 会话正文只来自 CLI 存储，本产品不落库、不导出、不做事件投影缓存。
- 项目目录必填且存在；服务器与默认目录同进同退。
- 会话归属只按 `cwd` / `workspace_uris` 裁决，解析不出就为 `null`。
- 服务器是人的工具：终端、资源、Slurm、文件管理都不经过 Agent。
- 服务器凭据只用 Windows 当前用户加密保存，明文不进入配置与日志。
- 删除的域不保留开关或兼容路径；改名迁移只有一次，且不覆盖新目录。

## 8. 验证依据与边界

- M1 验收编号 A1–A14 见[需求](../product/requirements.md)，是条件而不是现状；代码存在不等于条目通过。
- M1 已交付并有测试或真实运行记录的部分：项目存储与两层旧数据迁移、三个 CLI 的归属裁决、Claude/Codex/Antigravity 会话枚举与读取、四态本机探测、三段式外壳、项目添加、只读历史、服务器面板三视图（仅对已绑定服务器的项目可用）。
- 明确未完成：Electron 桌面壳（M1.5）；输入框、流式回合与审批（M2）；原生配置完整编辑、启动环境注入、服务器面板以档案为键（M3）；目录监听、安装包与自动更新（M4）；服务器文件下载移除。
- 测试在各包 `tests/` 下按模块镜像；真实链路用 `scripts/dev/e2e-*.ts` 与 `ssh-smoke.ts`；没有 Playwright 端到端测试。
- 未验证项：真实 Antigravity 摘要库上的会话枚举（现有证据来自夹具与单元测试）、真实集群上的 Slurm 成功输出、操作系统输入法、安装包与自动更新。Antigravity 的历史正文不是「待验证」，它按设计不可读（D36）。
- 浏览器访问同一地址仍可用，但按设计它不是最终产品入口；桌面壳落地前不应把它写成已交付形态。
