# AgentDeck 设计

日期：2026-11-03。状态：待确认。产品名 **AgentDeck**，包作用域 `@agentdeck/*`，仓库目录 `agentdeck`。

> 本轮相对上一版的变更：产品形态由「本机网页」改为「Windows 桌面应用（Electron 壳）」；仓库与包改名 AgentDeck；服务器面板的**文件下载**移除，其余与现有 ssh console 保持一致。改动点在 §1.1、§9、§11、§12、§15。

## 1. 意图

这个仓库原来（名为 `ssh-server`）的主线是「本地改代码 → rclone 双向同步 → 在服务器上跑」。同步、版本、本地文件镜像、改动视图这一整套占了产品一半的重量，而每天真正要用的那件事被压在下面：**在一个窗口里，把本机几个 CLI 的会话管起来**。

新主线只有一句话：**本机桌面端的会话工作台**，管的是本机真实存在的 CLI 会话，界面只负责把它们摆整齐、画出来、能接着聊。

对标的是 Codex 桌面端、DSH 桌面端那种东西：打开就是项目列表，点项目看会话，点会话进对话。底下跑的仍然是 `claude`、`codex`、`agy`，会话是它们自己的会话，配置是它们自己的配置，程序不含引擎、不存对话正文、不另造一套模型设置。

SSH 降级成旁边的一件工具：连服务器、开终端、看进程与文件、看资源、查 Slurm。它不再和对话耦合，也不再需要同步。

## 1.1 形态：桌面应用，不是浏览器网页

产品形态是一个 Windows 桌面应用（Electron 壳），不是「打开浏览器访问某个端口」。

内核仍然是本机 Fastify 服务，主进程在启动时把它拉起来、监听回环地址，窗口加载它。这样划分的好处是：**所有业务代码与运行环境无关**，今天写成什么样，桌面壳里就是什么样；浏览器访问同一个地址仍然可用，但那是调试手段，不是产品形态。

改这个形态的实际收益：

- 不用记端口、不用管浏览器标签，双击就开。
- 不会因为误配而把服务暴露到局域网。
- 需要系统能力（托盘、开机自启、通知、原生文件对话框）时有地方放。
- 与用户日常已经在用的 Codex 桌面端、DSH 桌面端是同一个形态，心智一致。

**为什么加壳而不换技术栈。** 这个仓库没有原生模块：`ssh2` 是纯 JS，SQLite 走 Node 22 内置的 `node:sqlite`，终端是 SSH 远程 PTY 而非本机 `node-pty`。Electron 最麻烦的「原生模块重编译」在这里不存在，加壳接近零成本。换成 Tauri 之类意味着用 Rust 重写 ssh2、SQLite、PTY、三个 CLI 适配层与上千个测试，收益只是安装包小一点，不划算。

**三个已知代价，如实记录：**

- 安装包 150–200 MB，未签名时 Windows SmartScreen 会警告一次。自己用无所谓，对外分发需要签名。
- **PATH 继承**：从开始菜单启动时拿到的是登录会话的 PATH。若装完某个 CLI 后没重启过，可能找不到它。缓解：设置里给每个 CLI 提供「可执行文件路径」覆盖项，探测失败时界面直接给出这一提示。
- 打包与自动更新是一条新的维护线。开发期用 `electron-vite dev` 直接起壳，安装包留到 M4。

## 2. 目标

- G1 一个窗口管住多个 CLI 的会话，不需要开多个终端、记多个目录。
- G2 每条会话明确归属：属于哪个 CLI、哪个项目目录。
- G3 会话正文来自原生存储，网页里聊完的内容在原生端能看到，原生端的新内容网页也能看到。**Claude 与 Codex 完整适用；Antigravity 受限于其轨迹格式，只保证列表与「继续对话」，不保证历史可回放（见 §12.1 与 R1）。**
- G4 能直接编辑各 CLI 的原生配置，不另建配置体系。
- G5 服务器面板保持现有 ssh console 的能力。
- G6 新 CLI 只要有无界面接口（打印一段 prompt、输出结构化事件），就能接进来；没有接口的 CLI 不接入，直接用 CLI 本身。

## 3. 非目标与反目标

非目标（明确不做）：多用户、局域网或公网访问、多 Agent 编排、内置 IDE、看板、内置浏览器、把 CLI 的 TUI 逐像素复刻。

反目标（做了就算失败）：网页里出现第二份对话正文；网页成为会话的唯一存放地；为了「看起来统一」而丢掉 CLI 自己的行为；把同步能力换个名字留下来。

## 4. 关键决策

**D1 单一真相。** 会话正文只存在于 CLI 自己的存储里。网页不落库、不做事件投影缓存、不做导入导出。网页允许保存的只有会话索引（原生 id、所属 CLI、cwd、标题、最近活动时间）和界面偏好。

**D2 只有一条接入路径：结构化事件，不嵌 CLI 的终端界面。** 网页接的是各 CLI 的无界面接口，收到的是一条条结构化事件（谁说了什么、要读哪个文件、哪一步要批准），再自己画成界面。不提供「把 CLI 的 TUI 塞进网页」这种模式：想用 TUI 就直接用 CLI，把它塞进网页只会得到一块网页看不懂的画面，既没有审批按钮也没有工具卡片，等于多写一套东西换取一个更差的终端。

这条决定要求每个接入的 CLI 都得有无界面接口：

| CLI | 接入方式 | 状态 |
|---|---|---|
| Claude | `claude --print --input-format stream-json --output-format stream-json`，由 SDK 作协议客户端驱动 | 已在用 |
| Codex | `codex app-server`（JSON-RPC over stdio） | 已在用 |
| Antigravity | `agy --print --input-format stream-json --output-format stream-json` | 接口参数已确认，未跑过真实会话 |

代价要说清楚：CLI 的 TUI 里属于界面层的功能（斜杠补全、状态栏、计划模式排版）需要网页自己实现，实现不了的就不提供，不会用终端画面兜底。

**D3 同一会话单写者，但只承诺网页自己能控住的部分。** 同一份原生会话不能同时被两个进程驱动。网页发起回合期间该会话在网页内锁定，禁止分叉、删除、重命名。至于原生端（终端里的 CLI、Codex 桌面端）是否正在驱动同一会话，网页无法可靠探测：既没有锁文件，也没有官方接口。所以界面只呈现「本网页正在运行」这一种确定状态，不用「已锁定」暗示外部已被阻止，同时在界面上说明同时驱动同一会话的风险。这是能力边界，不是待补的漏洞。

**D4 在原仓库上重写，不新建仓库。** 要保留的 SSH 池、主机指纹、加密凭据、服务器 SSH 终端、资源采样、Slurm、远端文件浏览，是这套产品的另一半地基，已有 118 个测试文件覆盖；Claude/Codex 的会话读写、分叉点、上下文压缩、能力目录也都调通了。新建仓库等于把这些重造一遍，而「干净」可以用分支加物理删除目录达到同样效果。仓库名与包名可以改，与代码搬迁无关。

**D5 删除三个域。** 同步（rclone bisync、状态机、冲突与待确认）、版本（本地 git 快照、历史、恢复）、本地文件镜像（只读浏览、改动视图）整体移除，不保留开关和兼容路径。

**D6 删除 Agent→SSH 的 MCP 桥。** 网页不再给 CLI 注入服务器操作工具，CLI 只在自己的项目目录里干活。服务器面板是人的工具，不是 Agent 的工具。以后若需要再作为独立插件加回。

**D7 技术栈不变。** Node.js 22 + TypeScript + Fastify + zod；前端 React 19 + Vite + Tailwind 4；终端 xterm；编辑器 CodeMirror。理由沿用既有选型记录，不再重新比较。

**D8 版本以本机安装为准，不打包、不锁定、不假设稳定。** 三个 CLI 都在自升级，网页必须把它们当成持续变化的外部程序：

- 驱动的是本机 PATH 上那个可执行文件（`claude`、`codex`、`agy`），不用包内附带的私有运行时，也不锁定版本。用户升到哪一版，网页就用哪一版。
- **按能力探测，不按版本号判断。** 启动时跑 `--version` 与 `--help`，解析出实际支持哪些选项，据此决定界面提供哪些功能。不写 `if (version >= x)` 这种判断——版本号会骗人，能力不会。
- 界面常驻显示当前驱动的版本号；CLI 自己升级后，下次探测发现版本变了就重新探测能力。
- 探测失败或能力缺失时，该 CLI 标记为不可用并说明原因，其余两个照常工作。
- 副作用：本项目永远跟着 CLI 的变动走，适配层是长期维护点，不是一次性工作。

**D9 绝不自动发请求。** 任何会消耗额度、打到用户配置端点的动作，都必须由用户明确点击触发。为了说得可执行，把动作分成三档：

| 档 | 动作 | 触网 | 何时发生 |
|---|---|---|---|
| 一 | `--version`、`--help`、`codex app-server generate-json-schema`、读会话与配置文件、`fs.watch` | 否 | 启动、开页面、刷新列表，随时 |
| 二 | 启动 CLI 检查账号与能力（斜杠命令、模型清单），Claude 的 `supportedCommands()/supportedModels()`、agy 的 `models/agents` | 是（鉴权与权益检查，**不消耗 token**） | **只由用户点「刷新能力」触发**，结果缓存 |
| 三 | 真正发一轮 prompt | 是（消耗额度、打到用户端点） | 只有用户点发送 |

规则：

- 第一档随便跑，不设限。
- 第二档**不自动触发**：不进启动流程、不进定时任务，**打开「新建会话」也不算授权**。按钮旁写明「会启动 CLI 检查账号与模型清单」。失败就降级为「能力未知」，不重试。
- 第三档只有用户点发送才发生。
- 用户的自定义端点与密钥只在**启动子进程时作为环境变量传入**，网页后端自己不发起任何模型 HTTP 请求；密钥不写日志、不回传前端明文、不进错误信息。
- 不读取 cc-switch 等其他工具的数据库。它们怎么存是它们的事，我们只认原生配置文件和启动环境。

**D10 一次性导入，不做持续兼容。** 首次启动读取旧 `workspaces.json`、`servers.json` 中仍成立的字段（服务器档案、工作区名称与本地目录）写成新格式，旧文件改名为 `.bak` 保留；同步相关字段直接丢弃。

## 5. 领域模型

```ts
// 项目目录，可选绑定一台服务器用于面板
type Workspace = {
  id: string;
  name: string;
  dir: string;              // 本地绝对路径，必填
  server?: string;          // 服务器档案别名，可选
  remoteDir?: string;       // 面板默认浏览目录，可选
};

// 会话身份 = CLI + 该 CLI 自己的会话 id
type SessionRef = { agent: AgentId; sessionId: string };

type SessionSummary = {
  agent: AgentId;
  sessionId: string;
  workspaceId: string;
  title: string;
  updatedAt: string;
  running: boolean;         // 本网页正在驱动该会话
};
```

工作区归属由会话的原生 `cwd` 判定，不按目录名字符串猜：与工作区 `dir` 规范化比较（沿用现有 `sameSessionDirectory` 的规则）。一个会话只属于一个工作区，不能跨 CLI 转换。

### 5.1 各 CLI 的归属字段不一样

| CLI | 归属依据 | 备注 |
|---|---|---|
| Claude | 会话记录的 `cwd` | 现有 `sameSessionDirectory` 直接用 |
| Codex | thread 的 `cwd`（app-server 返回） | 同上 |
| Antigravity | `conversation_summaries.workspace_uris` | **没有 cwd 列**，必须解析这个字段 |

`workspace_uris` 的解析规则：

1. 按换行或分隔符拆成多个 URI；`file://` 前缀剥掉并做 Windows 路径规范化（盘符大小写、分隔符统一）。
2. 与会话所属项目的 `dir` 比较，命中即归属该项目。
3. 命中多个项目时，归给配置顺序最靠前的那个，条目上标「多目录」；不做一条会话重复出现在多个项目下。
4. 解析不出来（空值、非 `file://` 协议、路径不存在）时，标为「未归属」，默认不显示，由 §10.1 的开关决定是否露出。

同一个字段在别的 CLI 上不存在时，一律按「未归属」处理，不允许因为缺字段就把会话丢掉或塞进第一个项目。

## 6. Agent 适配层

### 6.1 接口

```ts
type AgentAdapter = {
  id: AgentId;
  label: string;                     // Claude / Codex / Antigravity
  probe(): Promise<AgentProbe>;      // 是否安装、版本、支持哪些选项（不联网）
  listSessions(dir, signal): Promise<NativeSessionSummary[]>;
  readSession(id, dir, signal): Promise<SessionHistory>;
  startTurn(input, signal): AsyncIterable<TurnEvent>;
  control(turnId, action): Promise<void>;               // 中断、切模型
  approvals: 'interactive' | 'configured' | 'soft-deny'; // 见下方说明
  mutate?(id, dir, action): Promise<void>;              // 重命名、删除、归档
  fork?(id, dir, point): Promise<NativeSessionFork>;
  configSurfaces(workspaceDir?): ConfigSurface[];       // 原生可编辑项
  watchTargets(): string[];                             // 变更监听的目录
};
```

现有 `SessionProvider` 的 `list/read/assertBelongs/mutate/fork` 保留为实现基础，新增 `probe`、`configSurfaces`、`watchTargets` 与 `approvals`。

`approvals` 区分三种权限模型：`interactive` 表示回合中途可以把「要执行这条命令」推给网页、等用户点批准（Claude 与 Codex）；`configured` 表示权限在开跑前由规则文件定好、中途没有批准通道；`soft-deny` 表示没有批准通道且被拒的工具会被静默跳过，只在标准错误里留一条说明（Antigravity，见 6.4）。这不是降级，是各 CLI 本身的设计，界面按这个字段决定画审批卡片、权限模式条，还是软拒提示。

**哪些工具会弹审批卡片：由 CLI 自己的原生配置决定，网页不加自己的规则。**

上一版没写清楚，这一条必须明确。现有代码用 `allowedTools` 预放行 Read/Glob/Grep/TodoWrite 并自动放行工作区内写文件——那是网页自带的一层策略。本次删除该层（与删除 `policy/` 一致），改为：

| CLI | 审批面从哪来 | 网页做什么 |
|---|---|---|
| Claude | `~/.claude/settings.json` 的 `permissions`（allow / deny / ask）+ `--permission-mode` | 只把 CLI 决定要问的东西弹出来；`--permission-prompts host` 保证问的是网页 |
| Codex | `~/.codex/config.toml` 的 approval / sandbox 策略 | 沿用，不覆盖 |
| Antigravity | `permissions.allow` 规则，无回合内批准 | 只展示，不介入 |

「始终允许」= 写进原生配置文件（是一次显式操作，有确认），不是网页内存里的临时规则。这样三个 CLI 的行为都只有一个真相来源，也避免了「网页上点了允许，换个客户端就不生效」的困惑。

### 6.2 Claude

**驱动哪个二进制。** `claude-agent-sdk` 只当**协议客户端**（类型、消息编解码、审批回调），实际驱动的必须是本机安装的那份：

```text
1. 环境变量 CLAUDE_CODE_EXECUTABLE 显式指定（唯一的手动覆盖口）
2. PATH 上的 claude：
   - 若解析到 .cmd / .ps1 shim（npm 全局安装就是这样），读 shim 找到它调用的真实 .exe
   - 实测：C:\nvm4w\nodejs\claude.cmd → node_modules\@anthropic-ai\claude-code\bin\claude.exe
3. npm 全局根 + @anthropic-ai/claude-code/bin/claude.exe
4. 以上都失败 → Claude 标记为「未找到本机安装」，界面给出安装指引
```

**没有包内兜底。** 上一版写的「切换失败时退回包内版本」违反 D8，已删除。理由：界面显示的版本必须等于实际驱动的版本，静默回退会让这两个数对不上，而用户看的就是这个数字。

**协议风险要说清楚。** 固定版本的 SDK 客户端对上持续升级的本机 CLI，可能出现控制协议不匹配。处理方式：探针阶段用一次轻量握手验证，失败就把 Claude 标成「接口变化」并显示双方版本号，不静默降级。

本机 `claude` 2.1.317 已确认支持：`--print`、`--input-format stream-json`（实时流式输入）、`--output-format stream-json`、`--include-partial-messages`（逐字增量）、`--permission-prompts host`（权限提示交给宿主，即网页）、`--replay-user-messages`、`--json-schema`。审批走的就是 `host` 这条路。

**历史与会话操作**仍用 SDK 的 `listSessions` / `getSessionInfo` / `getSessionMessages` / `renameSession` / `deleteSession` / `forkSession`：它们直接读写 `~/.claude`，与二进制版本无关。若某次升级后磁盘格式变了，降级为「会话不可读」而不是崩溃。

配置面：`~/.claude/settings.json`、`~/.claude/CLAUDE.md`、`.claude/agents`、`.claude/skills`、`.claude/commands`、`.mcp.json`。

### 6.3 Codex

- 引擎：`codex app-server`（JSON-RPC over stdio），与本机 Codex CLI 共用 `~/.codex`（或 `CODEX_HOME`）。本机实测版本 **0.166.0**（此前文档写的 0.160.0 已过时）。
- 注意 `app-server` 在 CLI 里标着 `[experimental]`，接口可能随版本变动；升级 Codex 后要跑一次探测。
- 会话：thread 列表、读取、`thread/resume`、`turn/start`、`turn/interrupt`、审批回执，已经接入。原生存储除 `~/.codex/sessions` 外还有 `session_index.jsonl` 与 SQLite（`thread_history_1.sqlite`），以 app-server 为准，不直接读这些文件。
- 配置面：`~/.codex/config.toml`、`~/.codex/AGENTS.md`、`~/.codex/skills`、MCP 段。

### 6.4 Antigravity

本机实测（2026-11-03）：可执行文件是 `%LOCALAPPDATA%\agy\bin\agy.exe`，命令名不是 `antigravity`，安装脚本默认只把该目录加进 PATH；当前未签名登录。

已确认的接口（`agy.exe --help`）：

| 用途 | 参数 |
|---|---|
| 非交互单轮 | `--print` / `-p` |
| 输出格式 | `--output-format stream-json`（另有 text、json） |
| 从 stdin 连续驱动 | `--input-format stream-json`，每行一条 NDJSON，逐条跑一个回合，要求与上一项同时使用 |
| 续接会话 | `--conversation <id>`；`-c` / `--continue` 接最近一次 |
| 会话参数 | `--model`、`--effort`（low/medium/high/xhigh/max）、`--agent`、`--mode`（accept-edits/auto/plan） |
| 项目 | `--project`、`--new-project` |
| 权限 | `--dangerously-skip-permissions`、`--sandbox` |
| 结构化输出约束 | `--json-schema` |

这套接口与 Claude Code 的 `--print --output-format stream-json` 同构：后端以子进程驱动，逐条读写 NDJSON，关闭 stdin 即结束会话。

**关于 `--print` 的准确说法**（上一版写错，已更正）：`agy --help` 原文是 `--input-format ... Input format for print mode ... it requires --output-format stream-json`，说明 `--input-format` 本身就是 print mode 的选项，**没有说不能带 `--print`**。官方「常见错误」指的是**用 `-p` 传入具体 prompt 文本**——流式模式下 prompt 只能从 stdin 进。所以启动形态是：带 `--print` 进入 print mode，但**不跟 prompt 参数**，prompt 全部走 stdin。首次真跑时再确认这个组合。

**进程生命周期**

- **每会话一个常驻进程，stdin 跨回合保持打开**。这是 `--input-format stream-json` 的设计用途：官方示例就是拿着 stdin 管道、读一行 `result` 再写下一行，以便根据模型回答决定下一句。
- 回合结束时进程不退出，`running` 置回空闲；空闲超过 10 分钟或会话被关闭时关闭 stdin 让进程自然退出。
- 下一个回合如果进程已经没了，用 `--conversation <id>` 重新拉起，会话身份不变。
- 新会话第一轮不传 `--conversation`，从 `init` 或 `result` 事件里拿到 `conversation_id` 后再登记到索引。

**事件流结构（官方文档已给全）**

```text
init        一次     conversation_id、cwd、tools[]、permission_mode、model?、agent?
step_update 多次     step_index、state(ACTIVE|DONE)、step_type、text_delta?、tool_name?、
                     tool_info?、subagent_info?、duration_seconds?、usage?
result      一次     conversation_id、status、response、num_turns、usage
```

- `step_type` 已知取值：`user_input`、`agent_response`、`tool`、`checkpoint`。
- `agent_response` 流式时先发若干条 `ACTIVE`（带 `text_delta` 片段），最后一条 `DONE`；短回复直接一条 `DONE`。所以正文能逐字渲染。
- `tool` 步骤带 `tool_info`：`name`、`parameters`、`output`，失败时多一个 `error{type,message}`。所以工具卡片能画，能显示命令、参数和输出。
- 子代理步骤带 `subagent_info.subagents[]`（`type_name`、`role`、`conversation_id`、`log_uri`、`workspace_uris`）。

表达力足够：正文、工具调用、工具输出、用量都拿得到，与 Claude 的流式结构不同但能映射到同一套时间线。

**权限：只有开跑前生效的规则，没有回合内批准**

- 无交互环境下，需要确认的工具会被**软拒绝**：回合继续跑，进程以 0 退出，只在 `stderr` 打一条说明（哪个工具、怎么放行）。
- 工作区内读写自动允许；shell 命令默认是 `Ask`，在 headless 下等同于被拒。
- 提前放行写在 `~/.gemini/antigravity-cli/settings.json` 的 `permissions.allow`，规则形如 `command(git)`、`command(regex:npm run (build|lint|test))`、`write_file(src/)`。
- 全放行用 `--dangerously-skip-permissions`。

对界面的三条直接后果：

1. 不画审批卡片，改在输入区常驻显示当前权限模式。
2. **`stderr` 的软拒说明必须当一等公民展示。** 否则用户看到「任务完成」，实际命令根本没执行——这是最容易踩的坑。软拒通知解析成提示卡，附「去改 `permissions.allow`」入口。
3. `--dangerously-skip-permissions` 要显式勾选、按会话记忆、在会话头常驻标记，不能默认开。

**存储位置（实测）**

```text
~/.gemini/antigravity-cli/
├─ settings.json                 CLI 设置（含 permissions.allow）
├─ conversations/                会话轨迹（protobuf 轨迹存储，未公开格式）
├─ conversation_summaries.db     SQLite：会话列表元数据
├─ builtin/skills/               内置技能与说明文档
└─ log/、crashes/、updater/
~/.gemini/config/
├─ config.json                   共享配置
├─ mcp_config.json               MCP 服务器
└─ projects/<项目>.json           项目定义（id、name、projectResources）
```

`conversation_summaries.db` 的表结构（实测，21 列）含 `conversation_id`、`title`、`preview`、`step_count`、`last_modified_time`、`workspace_uris`、`status`、`source`、`project_id`、`agent_name`、`parent_conversation_id`、`nesting_depth`、`last_user_input_time`、`raw_summary`(BLOB)、`group_id`。

**注意：这张表没有 `cwd` 列。** 会话归属只能用 `workspace_uris`（TEXT，可能是 URI 列表）解析后与项目目录比对，规则见 §5.1。

**项目级配置：有，证据来自 `agy` 自带的内置技能文档**（`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/`，这是 CLI 自己读取的权威说明，比官网页面更准）。

Antigravity 有一套完整的「定制系统」，发现位置分三层：

```text
项目级（.agents/，也接受 .agent/、_agents/、_agent/，位于仓库根）
├─ rules/*.md                   目录规则
├─ skills/<名称>/SKILL.md        技能（frontmatter 必须有 name + description）
├─ plugins/<名称>/plugin.json    插件包：可含 rules/、skills/、hooks.json、mcp_config.json
├─ hooks.json                   生命周期钩子
├─ skills.json                  显式声明的技能路径与继承
└─ plugins.json                 显式声明的插件路径与继承

目录级规则（任意目录，从当前工作目录向上走到仓库根）
├─ GEMINI.md
└─ AGENTS.md

全局（~/.gemini/config/）
├─ mcp_config.json              MCP 服务器
└─ 全局定制根
```

加载优先级从高到低：项目内逐级发现 → 项目内 `skills.json`/`plugins.json` 显式声明 → 全局 `~/.gemini/config/` → 内置定制 → 全局 JSON 声明。重名时高优先级覆盖低优先级。

三条要注意的细节：

- **项目级 MCP 只能通过插件提供**（`plugins/<名称>/mcp_config.json`）。没有裸露的 `.agents/mcp_config.json` 这个位置，全局的才是 `~/.gemini/config/mcp_config.json`。
- 子目录里的会话也能用上仓库根的 `.agents/`，因为它从当前工作目录向上找到仓库根。
- `GEMINI.md` 和 `AGENTS.md` 都认，都是纯 Markdown、不支持 frontmatter、按目录作用域生效。

配置面：`~/.gemini/antigravity-cli/settings.json`（CLI 设置，只有全局，没有项目级对应物）、`~/.gemini/config/mcp_config.json`、`~/.gemini/config/config.json`，以及官方的 `agy mcp`、`agy plugin`、`agy agents`、`agy models` 只读子命令。

**未确认**：`conversations/` 里的轨迹是 protobuf 轨迹存储（日志原话 "trajectory store manager with proto store and SQLite store"），没有公开 schema。因此「读出一条 Antigravity 会话的完整历史」目前没有把握，见 §14 R1。

配置面：`~/.gemini/antigravity-cli/settings.json`、`~/.gemini/config/mcp_config.json`、`~/.gemini/config/config.json`，以及官方的 `agy mcp`、`agy plugin`、`agy agents`、`agy models` 只读子命令。

**端点与密钥：必须走启动环境，见 §8.1。** antegravity 自己不读配置文件里的端点，只认进程环境变量。

### 6.5 接入新 CLI 的条件

不设「通用兜底适配器」。一个 CLI 能被接进来，必须满足两条：

1. 有非交互的驱动方式（一条命令就能喂 prompt，能输出逐条事件）。
2. 会话能按 id 续接，或者它的存储能被读出。

满足两条就写一个适配器；不满足就不接，用户继续用那个 CLI 自己的界面。判断标准写在这里，是为了以后不因为「想让列表整齐点」而塞进一个半成品接入。

### 6.6 探测与能力

两个层次，别混。

**第一层：本机探测（随时可跑，不触网）**

白名单只有这些，全部是本地操作、不建立任何到模型端点的连接：

```text
claude  : --version、--help
codex   : --version、codex app-server --help、codex app-server generate-json-schema
agy     : --version、--help
```

`codex app-server generate-json-schema` 明确属于本地生成（输出的是协议 schema，文档说 generate-ts/generate-json-schema 都是本地操作），用它才能真正判断 app-server 的 RPC 接口有没有变——只看 `--help` 看不到 RPC 方法名。这条要写进白名单，否则「接口变化」这个状态无从触发。

探测结果四态：

| 状态 | 判定依据 |
|---|---|
| 可用 | 命令能跑、版本能解析、schema/flag 里关键能力齐全 |
| 未安装 | 找不到可执行文件 |
| 接口变化 | 能跑，但关键 flag 或 RPC 方法缺失；界面列出缺了哪一项，并显示双方版本 |
| 凭据未配置 | **只按启动环境的解析结果判断**：该 CLI 需要的变量在「继承 + 显式配置」里都没有。不联网、不推断登录态 |

**关于「未登录」**：这不是探测能得出的结论。CLI 可能有自己的 OAuth 登录态，我们不去检查也不会去检查。所以探测不说「未登录」，只说「凭据未配置」；真正的登录失败由第一次真实回合报出来，界面原样展示 CLI 的报错。

**第二层：能力目录（用户触发，可能触网）**

斜杠命令、可用模型、账号状态。这些必须让 CLI 自己检查，现有实现走 `supportedCommands()` / `supportedModels()`，agy 则对应 `agy models` / `agy agents`（实测未登录时会提示需要登录，说明它确实触网）。

因此：

- **不设自动触发。** 页面加载、切换项目、刷新列表都不读能力目录，界面先显示基础输入框。
- 只在用户点「刷新能力」时读，按钮旁写明「会启动 CLI 检查账号与模型清单」。**打开「新建会话」不算授权**，只显示上次缓存，没有缓存就显示自由文本输入。
- 结果按 `(agent, 项目目录, CLI 版本, 启动环境指纹)` 缓存；任一变化即作废。加入启动环境指纹是为了避免改了端点还沿用旧模型清单。
- 读取失败降级成「能力未知」：输入框照常可用，没有斜杠补全和模型下拉，不重试、不阻塞。

适配器内部抛错不拖垮整个列表，单条失败只影响该 Agent 分组。

## 7. 会话列表的实时性

- 监听每个适配器声明的 `watchTargets()`：Claude 是 `~/.claude/projects`；Codex 是 `~/.codex/sessions` 与 `~/.codex/session_index.jsonl`；Antigravity 是 `~/.gemini/antigravity-cli/conversation_summaries.db` 与 `conversations/`。`fs.watch` 加 500ms 去抖，合并成一次 `sessions:changed` 推给网页，前端按工作区失效重取。
- 网页自身发起的回合直接推送流事件，不依赖目录监听。
- 监听失败（目录不存在、权限不足）时退回手动刷新，不报警告弹窗。
- 配置文件的变更**不监听**：改动只在网页里改，改完由后端返回新的 revision。外部编辑器改了同一个文件，保存时会因为 revision 冲突被拒——这是有意的，避免两个进程互相覆盖。

## 8. 原生配置编辑

复用现有 `native-config` 的做法：读时带 revision（内容摘要），保存时校验 revision 未变、格式合法、原子写入，冲突则拒绝并提示重读。

覆盖两层，界面按「用户级」与「当前项目」分组：

| 层 | 文件 |
|---|---|
| 用户级 | Claude `~/.claude/settings.json`、`~/.claude/CLAUDE.md`；Codex `~/.codex/config.toml`、`~/.codex/AGENTS.md`；Antigravity `~/.gemini/antigravity-cli/settings.json`、`~/.gemini/config/mcp_config.json`、`~/.gemini/config/config.json` |
| 项目级 | Claude `CLAUDE.md`、`.mcp.json`、`.claude/skills`、`.claude/agents`、`.claude/commands`；Codex `AGENTS.md`；Antigravity `GEMINI.md`、`AGENTS.md`、`.agents/rules/*.md`、`.agents/skills.json`、`.agents/plugins.json`、`.agents/hooks.json`、`.agents/skills/<名称>/SKILL.md`、`.agents/plugins/<名称>/plugin.json` |

Antigravity 的项目级定制根同时接受 `.agents/`、`.agent/`、`_agents/`、`_agent/` 四种写法（CLI 自己会全部认）。编辑器优先展示 `.agents/`：存在就用它，四种都不存在时新建也建 `.agents/`。

`~/.gemini/config/projects/<项目>.json` 是 Antigravity 自己的「项目」概念（id、name、projectResources），存在用户目录下而不在代码目录里，归到**用户级**，与「当前项目的配置」不是一回事。

项目级条目跟着当前打开的项目走，接口带可选的项目参数；同一个文件在不同项目下是不同条目。

**凭据要遮。** 原生配置文件里可能直接写着 API key 或 token（实测 `~/.claude/settings.json` 的 `env` 块里有 `ANTHROPIC_AUTH_TOKEN`，`~/.codex/config.toml` 里有明文的实验性 bearer token）。编辑器对名字像 key / token / secret / password 的字段默认折叠成掩码，点「显示」才展开；日志、错误信息、接口响应里一律不出现明文。

不提供「网页侧配置覆盖」层：要么改原生文件，要么不改。

## 8.1 启动环境

配置文件不是全部。三个 CLI 的凭据落地方式不一样，实测如下：

| CLI | 自定义端点与密钥落在哪 | 网页要做什么 |
|---|---|---|
| Claude | `~/.claude/settings.json` 的 `env` 块（`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、各档模型名），CLI 自己读 | 什么都不用做，继承即生效 |
| Codex | `~/.codex/config.toml` 的 `[model_providers.*]`（`base_url`、`experimental_bearer_token`），CLI 自己读 | 什么都不用做，继承即生效 |
| Antigravity | **不写进 CLI 自己的设置**。cc-switch 这类工具只在「打开终端」时注入环境变量：`GOOGLE_GEMINI_BASE_URL`、`GEMINI_API_KEY`、`GEMINI_MODEL` | **必须由网页在启动 `agy` 时把这几个环境变量传进去**，否则会用默认身份，不是你配的端点 |

所以「启动环境」是一个独立的产品面，不能只靠配置编辑器：

- 每个 CLI 一组可选的环境变量，保存后在该 CLI 的子进程启动时注入。
- 值默认用 Windows 加密保存（沿用现有凭据存储），界面一律掩码，只显示变量名与「已设置」。
- 默认继承后端进程自己的环境变量；用户不配也能用（从已经注入好的终端启动后端时，一切照旧生效）。
- 设置页显示每个 CLI 的启动环境状态：哪些变量已设置、来自继承还是显式配置，**不显示值**。
- 变量名与来源可以出现在界面和日志里，值不可以。

这条是 Antigravity 能不能真正跑起来的前提：不配这个，网页里发一轮对话会用错身份，而且不会有明显报错。

### 8.2 启动环境的增删改

用户完全掌控，四条操作对应四个不同后果：

| 操作 | 语义 | 后果 |
|---|---|---|
| 新增 / 修改 | 写入或替换一个变量的值 | 覆盖同名的继承值；**下一次启动该 CLI 时生效**，正在跑的回合不受影响 |
| 停用 | 保留密文，但不注入 | **同样只在下次启动生效**；已启动的进程按老环境继续跑到该回合结束。界面上显示「已停用（下次启动起退回继承）」 |
| 删除 | 抹掉密文并停止注入 | 不可恢复。删除前弹确认，写明会被删的是哪个变量、之后会退回继承值还是变成未设置 |
| 恢复继承 | 清掉所有显式配置 | 回到「什么都不配、全跟后端进程环境」的初始状态 |

「立即生效」只提供一个出口：设置页的「重启该 CLI 进程」按钮，点了才会杀掉当前进程并按新环境重拉；正在进行的回合会被明确提示并中断，不静默执行。

几条约束：

- **删除必须真的删掉密文**，不是标记位。删完之后磁盘上不该再有那个值，界面上也不再显示「已设置」。
- 删除和停用要分开：想临时切回官方身份，用停用；确认不再需要，才用删除。
- 每个变量标注当前状态：`继承中` / `已显式配置` / `已停用（继承）` / `未设置`。这四种必须能一眼分清。
- **只允许白名单变量名。** 不接受 `PATH`、`NODE_OPTIONS`、`PYTHONPATH` 这类会改变进程加载行为的变量，避免把「配个密钥」变成「注入任意代码」。白名单按 CLI 各自列出，用户不能自己加变量名（只能改值、停用、删除）。
- 密钥永远不回填到输入框。要改就重新填一个，而不是在遮住的旧值上编辑。
- 与 Antigravity 直接相关的一点：`GEMINI_API_KEY` 被删除后，`agy` 在 headless 下会以「未登录」或默认身份运行，该 CLI 的探测结果要跟着变成「凭据未配置」，而不是报一个看不懂的网络错误。

### 8.3 密钥掩码的作用范围

上一版把「密钥不显示」写成全局规则，和 §8 配置编辑器的「点显示才展开」冲突。分清两件事：

| 对象 | 规则 |
|---|---|
| 启动环境的值 | **永不回传前端**。接口只返回变量名与状态，没有「显示」这个功能。要改就重填 |
| 原生配置文件的内容 | 编辑器要能完整编辑，否则改不了东西。默认把名字像 key / token / secret / password 的字段折叠成掩码，**点「显示」可以展开并完整显示**——这是用户自己的文件，他有权限看 |

日志、错误信息、接口响应里一律不出现任何明文密钥，这一条不分对象。

## 9. 服务器控制台

保持现有 ssh console 的能力，作为独立面板：多标签与分屏 SSH 终端、资源采样（GPU / CPU / 内存 / 磁盘 / 负载）、Slurm 作业查询、服务器文件浏览、服务器档案管理（密码 / 私钥、主机指纹确认、Windows 加密保存）。

**相对现有实现唯一的能力收缩：移除文件下载。** 上一版设计里有「文件下载」与配套的保存对话框（浏览器 `showSaveFilePicker`），本轮决定去掉：用户不用这个功能，而它带进来的是一整套导出链路（下载任务、进度、取消、落盘位置选择）。移除范围：`remote-files/downloads.ts`、前端 `RemoteDownloadDialog.tsx` 及其 `showSaveFilePicker` 用法、相关路由与测试。**文件的新建、重命名、移动、复制、删除保留**——那些是 ssh console 本来就有的。

与主线的关系：**面板以服务器档案为身份，不以工作区为身份。** 不绑定项目的服务器也能直接用；切换项目不会打断已开的终端、文件浏览和资源采样；同一个停靠区可以开多台服务器，标签上显示主机别名。项目只提供默认服务器与默认目录。

未绑定项目时，文件浏览与资源采样的默认目录是登录用户的 home（`~`），不是根目录，也不是上次某个项目的目录。

顶栏的「终端」按钮是**右侧面板终端标签的快捷入口**，不是独立的按工作区终端；面板收起时点它会展开并切到终端标签。

这是一次实打实的迁移：现有 terminal、resources、slurm、remote-files 四类路由都以 `workspaceId` 为键，要改成以服务器档案为键；终端与文件绑定的签名键、前端的面板状态模型都要跟着改。这是本次改动里工作量最大的一块。

`agent-capabilities` 路由**不在迁移范围内**：它读的是某个项目目录下 CLI 能提供哪些斜杠命令和模型，天然属于项目，继续以项目为键。

## 10. 前端

### 10.1 信息架构

```text
┌──────────────────────────────────────────────────────────────┐
│ 工作台 · 项目名      [搜索与操作]     终端 服务器 主题 设置    │
├──────────────┬───────────────────────────────┬───────────────┤
│ 项目          │ 会话标题 · Claude · ~/proj     │ 服务器面板     │
│  ▸ 项目 A     │                               │  终端 / 资源   │
│    Claude 3   │  …对话正文与工具卡片…          │  文件 / Slurm  │
│    Codex 2    │                               │               │
│    Anti 1     │ ╭ 输入框 + 模型/强度 发送 ╮    │               │
│  ▸ 项目 B     │                               │               │
└──────────────┴───────────────────────────────┴───────────────┘
```

- 左栏：项目列表，展开后按 CLI 分组列会话，每条带 CLI 徽标与最近活动时间；顶部有「新建会话」，选择 CLI 与项目。
- 主区：会话头（CLI、实际驱动版本、模型、cwd、运行状态）、正文时间线、输入区。没有回合内审批的 CLI（Antigravity）在输入区上方常驻权限模式条，而不是审批卡片。
- 右侧：服务器面板，与服务器终端共用停靠区，可收起。
- 空态：没有项目时引导添加项目目录；没有会话时引导新建。
- **不显示改动视图。** 对话里没有「本轮改动」卡片、没有 diff 渲染、没有行内反馈。工具卡片照常显示原生工具事件里的「写入/编辑了哪个文件」，点开只看路径，不算差异。`@pierre/diffs`、`features/changes`、`vcs` 一并移除。
- 不属于任何项目的会话默认不进列表，避免噪音；每个项目内提供一个「显示其他目录的会话」开关。

  **范围定义**：开关打开后，列出该 CLI 存储中 `cwd` 不属于任何已配置项目的全部会话，按目录分组；不是只显示子目录，也不是全机扫描。分组标题显示规范化后的绝对路径，点一下可以「加为项目」。

### 10.2 视觉方向

沿用 DSH 网页那种语气：中性灰阶打底、细边框、克制的高亮、等宽字体用于路径与代码、紧凑但留白的密度、深浅双主题默认跟随系统。CLI 归属用一个字母或色点区分，不用大色块，避免界面变成调色板。

### 10.3 会话级设置

每个会话可调的东西，分两类：

| 类别 | 内容 | 存哪 |
|---|---|---|
| 原生参数 | Claude 的 model / effort / permission-mode；Codex 的 model / approval 策略；agy 的 `--model`、`--effort`、`--agent`、`--mode`、`--project` | 只对本次运行生效，不写回原生配置；下次打开会话时按原生配置的默认值重新开始 |
| 危险开关 | agy 的 `--dangerously-skip-permissions` | 按会话记忆，存在界面偏好里（不含密钥），会话头常驻红色标记，默认关 |

「按会话记忆」只记这个布尔值，不记任何密钥。改原生参数要长期生效，走 §8 的配置编辑器，不在会话里偷偷写文件。

### 10.4 命令面板

`Ctrl+K` 打开，命令清单按本次产品范围重列（旧的同步、版本、本地文件相关命令全部删除）：

| 命令 | 说明 |
|---|---|
| 新建会话 | 选 CLI 与项目 |
| 切换项目 | 列出全部项目 |
| 切换会话 | 当前项目的会话 |
| 打开终端 | 打开右侧服务器面板的终端标签，等价于顶栏「终端」按钮 |
| 打开资源 / 打开文件 | 打开右侧面板对应标签 |
| 服务器 | 打开服务器档案管理 |
| 刷新会话列表 | 手动触发，替代目录监听失效时的兜底 |
| 刷新能力 | 触发第二层能力目录读取（会启动 CLI 检查，明确提示） |
| 设置 | 打开设置，含原生配置与启动环境 |
| 切换主题 | 浅色 / 深色 / 跟随系统 |

## 11. 后端结构

```text
apps/
├─ desktop/              Electron 壳：起服务、开窗口、原生能力桥
│  ├─ main.ts            启动 Fastify → BrowserWindow 加载它
│  └─ preload.ts         contextBridge：另存为等少量系统能力
├─ server/src/
│  ├─ main.ts            组装依赖
│  ├─ http/              路由、鉴权、WebSocket
│  ├─ agents/            适配层：claude/、codex/、antigravity/
│  ├─ chat/              回合管理、按会话的事件缓冲、能力查询
│  ├─ workspaces/        项目存储、旧数据迁移
│  ├─ settings/          原生配置、启动环境与产品偏好
│  ├─ process/           中立的子进程运行器（探测与 CLI 启动共用）
│  ├─ ssh/               连接池、认证、主机信任、SFTP
│  ├─ terminal/          服务器 SSH 的 PTY
│  ├─ resources/         资源采样
│  ├─ slurm/             作业查询
│  └─ remote-files/      服务器文件浏览与操作（下载已移除）
└─ web/src/              界面
```

移除：`sync/`、`vcs/`、`files/`、`remote-tools/`、`policy/`，以及 `http/` 下对应的路由文件与 `workspaces/setup/` 的双端向导。

## 12. 数据存放

```text
%LOCALAPPDATA%\AgentDeck\
├─ workspaces.json        项目列表（本地目录 + 可选服务器绑定）
├─ servers.json           服务器档案
├─ launch-env.json        每个 CLI 的启动环境：只存变量名、启用状态、来源与凭据引用，不存明文值
├─ credentials\           Windows 当前用户加密凭据（服务器密码、CLI 环境变量值）
├─ session-index.json     网页发起的会话簿记：id、属于哪个 CLI、标题、时间、归属目录（见 §12.1）
└─ backups\               原生配置保存前的备份
```

对话正文不在这里：Claude 在 `~/.claude`，Codex 在 `~/.codex`，Antigravity 在 `~/.gemini/antigravity-cli`。

目录名已随项目改名为 `AgentDeck`。旧目录 `%LOCALAPPDATA%\ssh-server` 由启动时的**一次性迁移**读取（`workspaces/migrate-legacy.ts`）：只复制 `servers.json` 与 `workspaces.json` 中仍成立的内容，新目录已有同名文件时不覆盖，旧目录原样保留不删。已删除功能留下的 `sync/` 与 `file-editors.json` 不迁移。

### 12.1 session-index.json 与 Antigravity 的历史问题

审查指出了一处真实矛盾：上一版 R1 写「正文仅网页发起的会话可见」，但事件缓冲只在内存、进程退出即丢、索引又不存正文——重启之后「可见」不成立。

**决定：不引入 transcript 存储，改为如实说明能力。**

理由：一旦为了 Antigravity 存网页侧正文，就等于承认「网页可以是会话的唯一存放地」，与反目标直接冲突；而且只对三个 CLI 里的一个特殊处理，会让数据模型长期分裂。

因此 `session-index.json` 的定位收窄为**簿记**，不是内容副本：

- 存：`conversation_id`、`agent`、`projectId`、标题、创建/更新时间、归属目录。用于补齐原生元数据缺失的字段（例如刚创建、`conversation_summaries` 还没落库的那几秒）。
- 不存：任何消息正文、工具调用、附件。
- 界面表述：Antigravity 会话如果轨迹读不出，标题栏照常显示，正文区显示明确文案「此会话的历史记录由 Antigravity 保存在本机，当前无法读取；可以继续对话」。不是假装空白，也不是编造。
- 网页发起的回合在**本次进程存活期间**能回看（内存缓冲）；重启后同样落到上面那句话。

如果以后确实需要「网页发起过的 Antigravity 会话可回放」，那是一个新功能（本地 transcript 缓存），要单独评审它和 D1 的冲突，不放进 M1–M4。

## 13. 并发与失败

- 同一会话同时只允许一个回合，重复发送返回运行中状态；不同会话互不阻塞。
- 回合进行中，该会话的分叉、删除、重命名全部拒绝，并给出原因。
- **回合按会话持有，不按 WebSocket 持有。** 事件在服务端内存里按会话缓冲，页面刷新或断线后重新挂载到该会话继续收流；缓冲只在内存，进程退出即丢，不落盘——这不违反 D1，因为它不是第二份对话存储，只是传输缓冲。
- 适配器崩溃或超时：结束该回合并标记会话为空闲，已缓冲的事件保留到进程退出，不静默重试。
- `stderr` 不当垃圾丢掉：Antigravity 的软拒通知、诊断信息都从这条通道来，必须转成界面上的提示。
- 原生存储格式异常：该会话标记为不可读，不阻塞其他会话。
- 目录监听失效：退回手动刷新。

## 14. 风险

- **R1 Antigravity 的会话正文读不出来。** 列表、标题、时间、所属目录有 SQLite 元数据支撑，有把握；但完整历史是 protobuf 轨迹存储，没有公开 schema。「原生端的新内容网页也能看到」这条只对 Claude 与 Codex 成立。**已按如实说明处理**（§12.1）：不存副本、不伪造历史，界面明说不可回放，可以继续对话。
- **R2 Antigravity 没有跑过真实会话。** 结论都来自官方文档、`--help` 输出与本地数据目录观察。按用户的明确要求，在获得同意之前不代发任何请求，因此 `--print` 组合、事件映射、续接行为都只能等用户自己发起一次会话后再验证。
- **R3 原生存储格式随版本变化。** 长期维护成本，缓解是把解析全部关在适配器内，失败降级为不可读。
- **R4 跨进程单写者无法探测。** 见 D3，只能靠用户自己避免同时驱动。
- **R5 删除同步域不可逆。** 用户已确认不再需要；旧配置保留 `.bak`，从产品中去掉后不再恢复该能力。
- **R6 放弃终端兜底后，接口变了的 CLI 会直接不可用。** 宁可显示「该 CLI 暂不可用」，也不引入一套网页看不懂的终端画面。缓解：适配器隔离，单个失效不影响其他两个。
- **R7 三个 CLI 都在自升级，接口随时会变。** 这是 D8 的代价：`codex app-server` 标着 experimental，`agy` 是 1.4.x，`claude` 每周都在动。不锁定版本的代价就是要长期跟。缓解：能力探测而非版本判断、界面显示实际驱动版本、适配器互相隔离、失败降级为不可读。
- **R8 配置编辑器会把人看不到的密钥摊到屏幕上。** 缓解见 §8 的掩码规则，但这是真实风险：屏幕被录屏或共享时等于泄漏。
- **R9 用户配了自定义端点与密钥，网页一旦代发就是花真钱。** 缓解是 D9：绝不自动发请求，只有明确点击才发。
- **R10 Antigravity 的凭据只在环境变量里，不在配置文件里。** 不配启动环境就用错身份，而且不会明显报错。缓解见 §8.1：显式配置 + 状态可见。同时这意味着密钥必须以可解密形式存在本机（Windows 当前用户加密），与「网页不存敏感数据」的理想状态有冲突，只能靠加密与掩码缓解。
- **R11 Claude 的固定 SDK 客户端对上持续升级的本机 CLI。** 这是 D8 的直接代价：客户端协议由 SDK 版本决定，本机 CLI 由用户决定，两者可能不匹配。缓解：探针阶段做一次握手验证，失败就标「接口变化」并显示双方版本，不静默降级、不回退到包内二进制。

## 15. 分期与验收

**M1 外壳**：删除三个域与旧向导，移除文件下载，新项目模型与旧数据迁移，三个 Agent 的本机探测与会话枚举，DSH 风格外壳，只读浏览历史。验收：

- 能列出本机真实会话；Claude 与 Codex 的正文可读。
- Antigravity 能列出会话标题、时间并按 `workspace_uris` 归属；正文区显示「不可回放」的明确文案而不是空白。
- 整个 M1 只跑第一层探测（`--version` / `--help` / `generate-json-schema`），不触发能力目录，不发起任何模型请求。
- 服务器面板的终端、资源、Slurm、文件浏览（新建/重命名/移动/复制/删除）与现有 ssh console 一致，**下载入口不存在**。

**M1.5 桌面壳**：`apps/desktop` 加入 Electron 主进程与 preload，`electron-vite` 起开发循环，主进程拉起 Fastify 并用 `BrowserWindow` 加载；打包与签名留到 M4。验收：

- `npm run dev` 直接打开桌面窗口，不需要手动开浏览器或记端口。
- 窗口关掉后后端进程随之退出，不留孤儿进程。
- 浏览器访问同一地址仍可用（调试用），但不再是产品入口。
- 探针找不到某个 CLI 时，界面给出「可执行文件路径」覆盖提示，而不是只说不可用。

**M2 对话**：Claude 与 Codex 的回合（流式、工具卡片、按原生配置弹审批、中断、会话级参数），Antigravity 的回合（正文流式、工具卡片、软拒提示、权限模式条、`--print` 组合的实测校准）。验收：在桌面应用里完成一轮对话，回原生端可见同一会话；Antigravity 的命令软拒在界面上可见原因；同一会话在回合进行中再次发送被拒绝。

**M3 配置与服务器**：原生配置编辑（用户级 + 项目级、掩码可展开）、启动环境配置与增删改停用、服务器面板改以服务器档案为键、命令面板。验收：

- 改一次 `settings.json` 与 `config.toml` 后 CLI 生效。
- 项目级条目能正确列出并编辑：Claude 的 `CLAUDE.md`、Codex 的 `AGENTS.md`、Antigravity 的 `GEMINI.md` 与 `.agents/` 下的技能/规则/插件声明，切项目时内容跟着换。
- 给 agy 配好 `GEMINI_API_KEY` 与 `GOOGLE_GEMINI_BASE_URL` 后，探测从「凭据未配置」变为「可用」。
- 删掉 `GEMINI_API_KEY` 后探测回到「凭据未配置」，且磁盘上不再有该值。
- 停用某个变量后，不重启进程的回合行为不变，重启后退出继承。
- 不绑定项目也能用服务器面板，默认目录是 `~`；切项目不打断已开终端。

**M4 打磨**：目录监听实时刷新、运行状态与只读展示、键盘操作、空态与错误态、CLI 升级后重新探测、安装包与自动更新、验收记录。

每期结束都要 `npm run check` 通过（类型、ESLint、格式、重复率、覆盖率），并更新 `docs/` 下的需求、界面、架构与决策记录。
