# 架构

更新于 2026-11-04。本文记录稳定技术基础、正在实施的 M2 接线以及仍在使用的 SSH 模块约束。原生对话的本轮设计见[接入说明](native-dialogue.md)，完成情况见[路线图](../roadmap.md)。重整前的实现说明保存在 `c686ef2:docs/engineering/architecture.md`。

## 1. 分层与职责

```text
Electron 主进程（apps/desktop）
  └─ 本机 Fastify（apps/server）
       ├─ HTTP + WebSocket → React 页面（apps/web）
       ├─ 项目、原生会话、CLI 适配、配置与能力目录
       └─ 现有 SSH 池、终端、资源、Slurm、服务器文件
共享协议与校验（packages/shared）
```

Electron 只负责入口和生命周期；业务服务与浏览器调试共用一份实现。CLI 在本地项目目录执行，模型请求由 CLI 发起。服务器操作经 SSH 由用户触发，服务器不运行 Agent 或本产品常驻服务。

当前会话主线和 SSH 工具分别工作。工作台插件是 M4 目标，尚无可安装的插件宿主；不得把现有模块化目录等同于插件系统，也不建立 DSH 插件兼容层。

## 2. 技术栈

| 层 | 当前选型与职责 |
|---|---|
| 运行环境 | Node.js 22+、TypeScript 5.9，开发服务使用 tsx |
| 桌面 | Electron、electron-vite；前端页面保持隔离的渲染进程 |
| 后端 | Fastify 5、WebSocket、zod 参数和配置校验 |
| Claude | Agent SDK 作为协议客户端；本机可执行程序作为驱动目标 |
| Codex | 本机 `codex app-server`，stdio JSON-RPC |
| Antigravity | 本机 `agy`，摘要库使用 Node 内置 SQLite；M2 增加流式子进程适配 |
| SSH | `ssh2`，exec、SFTP 和远端 PTY 共用连接但独占通道 |
| 前端 | React 19、Vite 8、Tailwind 4、Ariakit、cmdk、react-resizable-panels |
| 状态与通信 | zustand、TanStack Query、partysocket |
| 消息与编辑 | streamdown、react-virtuoso、CodeMirror 6 |
| 终端与字体 | xterm.js/fit、随包分发的 IBM Plex Sans 与 JetBrains Mono |

精确依赖版本由各 `package.json` 和锁文件维护，选用理由见[现行决策](decisions.md)。不因服务器使用 Python 而改写本地后端；涉及统计或分析时使用服务器已有环境，不自动安装依赖。

## 3. 仓库结构

| 路径 | 负责内容 |
|---|---|
| `apps/desktop/src` | 窗口、preload、单实例与退出编排 |
| `apps/server/src/agents` | 本机程序探测、各 CLI 协议映射、会话读取与运行时 |
| `apps/server/src/chat`、`sessions` | 回合、能力缓存、原生会话管理与归属 |
| `apps/server/src/workspaces`、`settings` | 项目、迁移、产品偏好、原生配置 |
| `apps/server/src/http`、`process` | 访问控制、路由、子进程通用执行 |
| `apps/server/src/ssh`、`terminal` | SSH 档案、信任、凭据、通道与 PTY 生命周期 |
| `apps/server/src/resources`、`slurm`、`remote-files` | 当前资源采样、作业查询及服务器文件业务 |
| `apps/web/src/app` | 入口、导航、布局和对话主区组合 |
| `apps/web/src/features` | 会话、对话、设置与 SSH 界面 |
| `apps/web/src/lib`、`ui` | API、查询缓存和可复用界面组件 |
| `packages/shared/src` | 前后端消息、模型和 zod schema |
| `apps/*/tests`、`packages/*/tests` | 按功能镜像的单元与组件/模块测试 |
| `scripts/dev` | 文档检查、受控夹具和显式真实链路验证入口 |

按功能划分模块，通用能力才进入公共目录；不额外增加控制器/仓储等重复层。旧同步、版本、本地镜像、MCP 桥和命令黑名单目录已删除。

## 4. 项目、会话与回合

### 4.1 项目及归属

项目存储串行读写，保存时校验 schema 与唯一 id，再用临时文件原子替换。新增或修改目录必须确认存在；更新其他字段和导入离线目录不能丢掉有效记录。现有服务器别名与远端目录须成对，目标别名由服务器档案验证。

`ownership.ts` 只比较规范化路径，不访问磁盘。Windows 盘符/UNC 使用 Windows 语义，POSIX 路径保留大小写；Antigravity URI 只接受 `file://`，支持 JSON 数组、单值及换行/分号列表。归属顺序和无归属行为定义在需求 F2。

会话列表先读取 provider，再投影 `projectId`，路由保留当前项目和无归属条目；前端按 CLI+原生 id 去重无归属记录。单条读取或操作再次验证目录和身份，避免仅靠列表筛选保护正文。

### 4.2 CLI 接入

| CLI | 稳定基础 | M2 实施重点 |
|---|---|---|
| Claude | SDK 会话列表、历史、改名/删除/分叉与既有回合适配 | 探测和驱动共用本机程序；SDK 不再静默选择平台附带程序；接通界面控制 |
| Codex | app-server 原生会话、工具与审批适配 | 使用原生默认，能力发现改成显式刷新，保持正确身份和回合终态 |
| Antigravity | SQLite 摘要、时间和 `workspace_uris`，历史不可回放 | 新建、`--conversation` 续接、流式事件、中断及软拒提示 |

探测运行本地版本/帮助命令，Codex 另检查生成的协议 schema；每个 CLI 单次探测超时为 5 秒，输出有独立上限。stdout 与 stderr 一起核对，四态结果不意味着登录成功或真实模型请求已通过。

`runProcess` 用 `shell: false` 和隐藏窗口启动，支持 stdin、独立环境、AbortSignal、输出上限和超时。长期对话管道由各适配器管理，prompt 不写进命令行参数。

### 4.3 回合控制与原生参数

`TurnManager` 在准备前建立轮次，用 Agent+原生会话 id 占用会话；改名、删除、归档与分叉复用同一占用边界。停止取消准备或交给运行器中断，错误和结束都必须释放资源。

本轮前端在运行期间阻止切项目、切会话和新建，保持停止/审批控制可达；后端保留会话隔离基础，但不把后台多会话界面当成本轮交付。断线按本轮设计中断所属回合，不自动重发；跨连接事件续传尚未承诺。

Claude/Codex 的既有运行时按会话复用，空闲回收预算为 5 分钟。缓存身份含项目、原生 id 与启动参数；关键输入变化后重新启动，崩溃实例不得再次复用，关闭应用统一 dispose。Antigravity 的具体进程实现以本轮适配器为准，不套用未经核实的相同生命周期。

模型/强度未选则省略参数。原生权限配置决定是否请求审批，宿主只承接答复。Antigravity 没有同等审批通道，软拒输出独立显示。能力 GET 仅返回缓存，显式 POST 刷新；发送普通文字不依赖目录，调用 slash 使用已刷新能力。

### 4.4 历史与前端状态

zustand 持有当前项目、CLI、会话和回合状态，TanStack Query 管项目、历史、设置等服务数据。选择变化取消旧请求，并用会话身份/代次防止迟到结果串线；历史失败禁止在未知上下文上续聊，Antigravity 501 则单独表达能力限制。

实时视图复用 ChatView、Composer、审批和工具组件。既有时间线采用 react-virtuoso，读取工具白名单分组每段最多 40 项；审批、执行与错误独立成卡。原生只读历史与实时界面的验证不能互相替代。

partysocket 退避从 1 秒到 15 秒，关闭发送缓冲，防止断开时积压消息在重连后发送。历史与事件只在前端/进程内暂存，服务器没有正文数据库。

## 5. 存储与配置

### 5.1 工作台数据

默认目录为 `%LOCALAPPDATA%\AgentDeck`，可由 `AGENTDECK_CONFIG_DIR` 指定。非 Windows 的默认位置回退到用户 `.local/share`。现有文件包括项目 `workspaces.json`、服务器档案 `servers.json`、产品偏好 `product-settings.json`、`credentials/` 密文与 `remote-file-tasks/` 任务记录。

迁移先复制旧 `ssh-server` 目录的配置，再转换 `localDir`/`sshHost` 等旧字段。新目录已有文件不覆盖；转换前保留 `.bak`，旧目录不删，异常明确报告。当前格式只保留有效业务字段，不恢复同步与策略域。

产品偏好只含默认 CLI 与当前资源设置；退休字段在磁盘读取边界定点剔除，公开写入仍严格校验。坏配置保留并返回错误，不用空对象掩盖损坏。

### 5.2 原生配置

当前编辑器覆盖 `CLAUDE_CONFIG_DIR/settings.json` 与 `CODEX_HOME/config.toml`，缺省从对应用户目录读取。`safe-file.ts` 检查路径逐层身份，拒绝符号链接和非常规文件；UTF-8 内容上限 256 KiB，revision 使用 SHA-256，保存校验冲突和语法并在同目录原子替换。当前未实现自动备份目录。

M3 按 CLI 实际支持补齐作用域和入口，不预定义统一用户/项目配置树；原生文件内容编辑与启动密钥状态接口分开。原生历史、规则和认证文件不并入工作台数据迁移。

### 5.3 启动配置

| 变量或参数 | 用途 |
|---|---|
| `AGENTDECK_HOST`、`AGENTDECK_PORT` | 本机监听，默认 `127.0.0.1:4317`；端口可用 0 申请系统分配 |
| `AGENTDECK_CONFIG_DIR` | 工作台配置目录 |
| `AGENTDECK_TOKEN` | 进程内部会话秘密；缺省随机生成 |
| `AGENTDECK_DEV_ORIGIN`、`--dev-origin` | 显式允许 Vite 开发来源 |
| `AGENTDECK_CODEX`、`CLAUDE_CODE_EXECUTABLE` | 选择本机已有 CLI 程序 |
| `CLAUDE_CONFIG_DIR`、`CODEX_HOME` | 原生数据和配置根；不把文件复制到工作台 |

可执行文件覆盖口用于寻找已有程序，不自动安装或升级 CLI。新增 Antigravity 覆盖项应由适配器与开发指南同步说明。

## 6. HTTP、安全与桌面生命周期

启动拒绝非回环 host。前端先调用 `POST /api/local-session`，校验本机 Host、精确允许的 Origin 与 Fetch Metadata 后获得 `AGENTDECK_session` Cookie；HttpOnly、SameSite=Strict，秘密比较使用常量时间。业务组件在握手成功后才挂载，握手等待上限 10 秒。

API 和 WebSocket 继续校验会话及来源；禁止 iframe 嵌入，开发来源必须显式放行。HTTP body 和对话 WS 载荷上限均为 1 MiB。日志只输出必要状态与版本，原生诊断按上下文清理，避免泄露凭据或完整用户配置。

| 接口域 | 当前路径与作用 |
|---|---|
| 项目 | `/api/projects` 与 `/:id`，列表/新增/修改/移除 |
| 会话 | `/api/projects/:id/sessions` 与 `/:agent/:sessionId`，原生读取 |
| 原生管理 | `/api/projects/:id/sessions/:agent/:sessionId/actions`、`/fork`，来源及项目均在路径中 |
| 探测与能力 | `/api/agents/probes`；项目下 `agent-capabilities` 缓存与显式刷新 |
| 设置 | `/api/settings/product`、`/environment`、`/api/agent-config/:agent` |
| 对话 | `/ws`，发送、停止、审批答复及回合事件 |
| SSH 档案 | `/api/ssh-targets`、`/api/ssh/*`，档案、认证、信任 |
| 现有服务器工具 | `/api/workspaces/:id/terminal*`、`/resources`、`/slurm`、`/remote-files/*` |

会话读写只使用项目路径；旧工作区会话别名返回 404，服务器工具路径暂时保持。会话接口在进入解析前设置 no-store，写入确认和原生会话锁仍由服务层维护。前端构建由 Fastify 托管，接口路径不回退为 HTML。

Electron 主进程用端口 0 启动服务后加载实际地址；preload 仅暴露窄系统信息，`nodeIntegration: false`、`contextIsolation: true`。单实例锁让第二次启动聚焦已有窗口，关窗和退出都先释放服务，最长关闭等待 8 秒。后端清理终端、资源/Slurm、SSH、轮次和 HTTP；进程退出不留下后台业务实例。

## 7. 现有 SSH 模块约束

本节约束当前仍在用的实现。它是 M1 保留的服务，不代表 M4 插件的最终契约；本轮对话接入不修改这些业务。

### 7.1 档案、连接与凭据

服务器档案最多 128 条，hostname+端口+账号去重，alias 为产品生成的稳定 id。连接只接受 `{ alias }`，目标与认证材料来自档案；修改和移除前核对项目引用。`~/.ssh/config` 当前仅显式导入，未支持选项保留提示，不自动改写。

连接按真实身份与认证材料、信任记录复用。断开、改凭据或重连增加认证代次，迟到结果不能回填新身份；exec、SFTP 和 PTY 独立通道，单通道错误只释放自己。

未知主机先做不带凭据的握手，返回 SHA256 指纹和一次性挑战；挑战有效 2 分钟，最多 32 个，确认后记入 known_hosts。变更或吊销主机直接拒绝。密码仅内存或 Windows 当前用户 DPAPI 密文，编辑时按需读取并 `no-store`；凭据目录/文件保持相应访问权限。加密子进程使用环境白名单、stdin 传值，10 秒超时。

### 7.2 终端

打开终端前生成 5 分钟 HMAC 绑定票，绑定项目、服务器、目录、主机身份和认证代次。当前每项目最多 8 个会话、全局 32 个，单标签最多 4 个窗格。

终端独立升级通道复用 HTTP 服务，base64 输入单帧 32 KiB，控制帧 64 KiB，输出缓冲 1 MiB。输入输出分别背压，排空后报告退出；EOF 不是可靠退出码，未知退出码保持 null。

xterm 实例与布局槽位分离，切视图或收起不销毁 PTY；关闭窗格才结束对应 shell，多行粘贴先确认。断线保留输出并停止输入，新连接创建新 shell，不宣称恢复原进程。

### 7.3 资源与 Slurm

当前资源间隔默认 5 秒、可设 2–60 秒；超时默认 8 秒、可设 2–30 秒。只在面板和页面可见、连接就绪时请求，隐藏立即取消在途采样。命令使用 `/proc`、`df`、`ps` 与 `nvidia-smi` 等只读接口，不安装采集器。

GPU 与 GPU 进程查询各有 3 秒预算；系统进程取前 50 项。缺值为 null，失败保留最近值并标过期。缓存按真实身份共享主机读数，磁盘按目录分开；成功保留 5 秒，失败指数退避不超过 30 秒，空闲 60 秒淘汰。

Slurm 单一路径为 `LC_ALL=C squeue --noheader --user="$(id -un)" --format=...`。总预算 8 秒，合计输出上限 512 KiB，最多 200 行；未安装、空输出、失败分别处理。仅首次或手动查询，不管理作业、不轮询调度器；成功缓存 2 秒，最多 32 项，认证变化取消查询并清理旧缓存。

### 7.4 服务器文件与任务

浏览绑定当前项目和真实 SSH 身份；每项目最多 32 个浏览会话，空闲 15 分钟过期。单层最多 10000 项或 4 MiB 元数据，每页 200 项，目录优先并自然排序。只浏览元数据，不向本机下载文件。

现有写操作生成有效 2 分钟的预检方案，派发前复核目标，以已有 Python 标准库和 `renameat2(RENAME_NOREPLACE)` 执行，不覆盖同名目标、不跟随链接；项目根及祖先受保护。同身份相交路径排队，最多 4 项并行。

任务记录原子落盘后派发；损坏记录保留并阻断，重启不自动重放。派发后断线或取消可能已改变远端，结果不确定用 `needs_check`，读取核对后处理，不能把取消写成回滚。`sync-scope.ts` 仅为当前文件列表过滤，不恢复已删除同步域。

## 8. 扩展演进和验证

M3 先核实各 CLI 原生配置面，再实现编辑和启动环境。M4 再划定工作台插件生命周期与展示入口，SSH Console 迁移要明确现有档案、凭据、Slurm 和文件写能力的去留；未经该阶段设计不删除用户数据。

架构测试分单元、组件、受控进程和真实链路。M2 当前实施，真实模型调用、Antigravity 协议完整性、真实集群 Slurm、系统输入法和安装包都不能用模拟结果替代。代码存在与文档目标均不构成已通过证明，阶段状态统一在路线图维护。
