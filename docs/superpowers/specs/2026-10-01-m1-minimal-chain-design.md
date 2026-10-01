# M1 最小链路设计

- 日期：2026-10-01
- 对应：`docs/roadmap.md` M1；验收 A1、A11（`docs/product/requirements.md` 第 6 节）
- 前提：需求、架构、界面文档已确认；本文只写 M1 的具体决定，不重复架构文档。

## 1. 目标

在本机网页里和本机 Claude Code 对话，Claude 通过 `remote_exec` 在 SSH 服务器上执行命令并流式显示结果；命令黑名单在执行前拦截危险命令。

## 2. 范围

包含：

- npm workspaces 骨架：`packages/shared`、`apps/server`、`apps/web`。
- 访问控制：只监听 127.0.0.1、访问令牌、Host / Origin 校验。
- 工作区：在网页上手动填写名称、本地文件夹、SSH Host、服务器目录（不做目录浏览）。
- Claude 对话：流式文本、工具调用卡片、权限请求批准 / 拒绝、中断、会话列表与历史、继续会话。
- 远程工具：`remote_exec`、`remote_peek`；命令黑名单；`~/.ssh/config` 解析与 `known_hosts` 校验。

不包含（后续里程碑）：同步（M2）、保存与历史（M3）、Codex（M4）、目录浏览与终端（M5）、设置页与命令面板（M6）、右侧面板。

M1 没有同步：Agent 在本地文件夹改的文件不会到服务器，`remote_exec` 只作用于服务器上已有的文件。注入给 Agent 的指令要写明这一点。

## 3. 结构与运行方式

```text
packages/shared/src/   events.ts、protocol.ts、workspace.ts、index.ts
apps/server/src/
  main.ts              读取配置、组装依赖、启动
  config.ts            环境变量 → ServerConfig
  http/                app.ts、security.ts、auth.ts、workspaces.routes.ts、sessions.routes.ts、ws.routes.ts、internal.routes.ts
  policy/              policy.ts、shell.ts、default-rules.ts
  ssh/                 ssh-config.ts、known-hosts.ts、remote-command.ts、exec.ts、pool.ts
  workspaces/          store.ts
  remote-tools/        main.ts（stdio MCP 入口）、tools.ts
  agents/              instructions.ts、claude-mapper.ts、claude-adapter.ts、edit-scope.ts
  chat/                registry.ts、turn-manager.ts
apps/web/src/          app/、features/workspaces/、features/chat/、lib/、styles.css
scripts/dev/e2e-m1.ts  真实服务器验收脚本
```

- 服务端和 MCP 子进程都用 `node --import tsx` 直接运行 TS，不单独编译；`tsc --noEmit` 只做类型检查；测试用 Vitest，测试文件与源码放在一起。
- 共享包直接导出 TS 源码，server（tsx）和 web（Vite）都能直接引用。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `SSH_SERVER_PORT` | `4317` | 监听端口，`0` 表示随机 |
| `SSH_SERVER_HOST` | `127.0.0.1` | 只允许 `127.0.0.1`、`::1`、`localhost`，其他值拒绝启动 |
| `SSH_SERVER_CONFIG_DIR` | `%LOCALAPPDATA%\ssh-server` | 配置目录 |
| `SSH_SERVER_TOKEN` | 随机 32 字节 base64url | 访问令牌；测试时可指定 |
| `SSH_SERVER_DEV_ORIGIN` | 无 | 开发时 Vite 的来源，如 `http://127.0.0.1:5173` |

启动后打印访问地址：`http://127.0.0.1:<端口>/auth?token=<令牌>`（开发模式打印 Vite 地址）。

## 4. 访问控制

- 允许的 Host：`127.0.0.1:<端口>`、`localhost:<端口>`、`[::1]:<端口>`，加上 `SSH_SERVER_DEV_ORIGIN` 的 host。其他 Host 一律 403。
- 非 GET 请求和 WebSocket 升级必须带 `Origin`，且等于允许的来源之一，否则 403。
- `GET /auth?token=` 令牌正确时设置 Cookie `ssh_server_session`（HttpOnly、SameSite=Strict、Path=/），302 到 `/`；令牌错误 401。令牌比较用常量时间比较。
- `/api/*`、`/ws` 必须带有效 Cookie，否则 401。静态资源和 `/auth` 不需要。
- `/internal/*` 不认 Cookie，只认 `Authorization: Bearer <会话令牌>`（见第 8 节）。

## 5. 工作区

```ts
type Workspace = {
  id: string;            // crypto.randomUUID()
  name: string;
  localDir: string;      // 已存在的绝对路径
  sshHost: string;       // ~/.ssh/config 中的 Host
  remoteDir: string;     // 以 / 或 ~ 开头，不含换行和 NUL
  policy?: { disabledRules?: string[] };
};
```

- 保存在 `<配置目录>/workspaces.json`，先写临时文件再改名。文件损坏时备份为 `workspaces.json.bak-<时间>`，从空列表开始。
- 接口：`GET/POST /api/workspaces`、`PATCH/DELETE /api/workspaces/:id`、`GET /api/ssh-hosts`。删除只删配置。

## 6. SSH

- `~/.ssh/config`：支持 `Host`（多个模式、`*` `?` 通配、带引号的别名，包括中文）和 `HostName`、`Port`、`User`、`IdentityFile`；`Match` 块整体跳过；`Include`、`ProxyJump`、`ProxyCommand` 记为不支持并在界面提示。按 OpenSSH 规则，各匹配块中先出现的值优先。文件可能带 BOM、CRLF。
- 认证：依次尝试 `IdentityFile`，未配置时尝试 `~/.ssh/id_ed25519`、`id_ecdsa`、`id_rsa`。M1 不支持带密码的私钥（报错说明）。
- 主机密钥：读 `~/.ssh/known_hosts`，支持普通条目、`[host]:port`、哈希条目（`|1|salt|hash`），`@revoked` 视为拒绝。找不到主机时拒绝，并提示先在终端执行一次 `ssh <Host>`；密钥不一致拒绝。
- 每个 Host 一条长连接，断开后下次使用时重连。
- 远程命令：`cd <目录> && exec timeout <秒> bash -lc <命令>`。所有参数用 POSIX 单引号转义；`~` 开头的目录写成 `"$HOME"/'<其余部分>'`。
- `remote_exec`：超时默认 600 秒，最大 3600 秒；本地另设超时（远端超时 + 30 秒）后关闭通道。stdout、stderr 各最多保留 200 000 字节，超出时保留末尾并注明已截断。返回 `{ stdout, stderr, exitCode, timedOut, truncated, durationMs }`。
- `remote_peek`：`stat`、`head`、`tail`、`du`。路径可相对服务器目录或绝对路径；行数最多 200；`du` 超时 30 秒。命令由后端拼装，不经过黑名单。

## 7. 命令黑名单

`checkCommand(command, { remoteRoot, disabledRules }) → { allowed: true } | { allowed: false; ruleId; reason }`

- 按未加引号的 `;`、`&&`、`||`、`|`、`&`、换行拆成片段，逐段检查，识别引号。
- 跳过前置的 `VAR=值`，以及 `nohup`、`time`、`nice`、`env`、`exec`、`command` 等包装命令，找到真正执行的程序。
- `bash -c`、`sh -c`、`eval` 的参数递归检查。
- 默认规则：

| ruleId | 拦截 |
|---|---|
| `privilege` | `sudo`、`su`、`doas` |
| `rm-dangerous` | `rm` 带递归选项，且目标是 `/`、`/*`、`~`、`~/`、`~/*`、`$HOME`、`${HOME}`、`*`、`.`、`./`、`./*`、`..`、`../` 或工作区服务器目录本身 |
| `mkfs` | `mkfs`、`mkfs.*` |
| `dd-device` | `dd` 带 `of=/dev/` |
| `power` | `shutdown`、`reboot`、`poweroff`、`halt` |
| `kill-all` | `kill` / `pkill` 的目标为 `-1` |
| `chmod-777-recursive` | `chmod` 递归且权限为 `777` |
| `authorized-keys` | 写入、移动、删除或修改 `authorized_keys` |
| `fork-bomb` | `:(){ :|:& };:` 形式 |
| `crontab-remove` | `crontab -r` |

- 工作区可按 ruleId 停用默认规则；自定义规则放到 M6。

## 8. 远程工具与内部接口

- 每次 Agent 会话开始时，后端生成一个随机会话令牌并登记到所属工作区，会话结束时注销。
- MCP 子进程环境变量：`SSH_SERVER_INTERNAL_URL`、`SSH_SERVER_SESSION_TOKEN`，在 `process.env` 基础上合并（Windows 上缺少 `PATH`、`SystemRoot` 会导致子进程起不来）。
- 内部接口：`POST /internal/remote-exec`、`POST /internal/remote-peek`。令牌无效 401；`remote-exec` 先过黑名单，拒绝时不调用 SSH，返回 `{ denied: { ruleId, reason } }`。
- MCP 工具返回文本：退出码、stdout、stderr、超时 / 截断说明；被拒绝时 `isError: true`，文本为 `命令被拒绝：<原因>（规则 <ruleId>）`。

## 9. Claude 适配器

调用 `query({ prompt, options })`：

- `cwd` = 工作区本地文件夹；继续会话时传 `resume`。
- `settingSources: ['user', 'project', 'local']`；"跟随本地配置"时不传 `model`；不传 `env`、`pathToClaudeCodeExecutable`（使用 SDK 自带的 Claude Code）。
- `systemPrompt: { type: 'preset', preset: 'claude_code', append: <工作区指令> }`。
- `mcpServers: { 'ssh-server': { type: 'stdio', command: process.execPath, args: ['--import', 'tsx', <remote-tools/main.ts 绝对路径>], env } }`。
- `allowedTools`：`mcp__ssh-server__remote_exec`、`mcp__ssh-server__remote_peek`、`Read`、`Glob`、`Grep`、`TodoWrite`。
- `canUseTool`：`Edit`、`Write`、`NotebookEdit` 的目标路径在本地文件夹内时直接允许；其余（含 `Bash`）发出 `permission_request`，等待网页答复，5 分钟无答复或中断时拒绝。
- `includePartialMessages: true`；中断用 `query.interrupt()`。

事件映射（SDK 消息 → `AgentEvent`）：

| SDK 消息 | 事件 |
|---|---|
| `system` / `init` | `session { sessionId, model, cwd }` |
| `stream_event` 中的 text_delta / thinking_delta | `text` / `reasoning` |
| `assistant` 中的 tool_use | `tool_call { id, name, input }` |
| `assistant` 中的 text | 本轮没有收到过 text_delta 时才输出为 `text`，避免重复 |
| `user` 中的 tool_result | `tool_result { id, output, isError }`，output 截断到 20 000 字符 |
| `result` | `turn_end { isError, durationMs, costUsd }` |

历史：`getSessionMessages(id, { dir })`，用户文本映射为 `user_message`，其余复用同一映射。会话列表：`listSessions({ dir })`，保留 SDK 默认的 `includeProgrammatic: true`（本工具创建的会话就是 SDK 会话）。

工作区指令（M1）：

```text
你在操作 SSH 服务器 <sshHost> 上的目录 <remoteDir>。
- 运行、训练、测试、查看数据：使用 remote_exec，在该目录下执行。
- 查看大文件、目录占用：使用 remote_peek。
- 当前版本尚未实现同步：你在本地文件夹中修改的文件不会出现在服务器上，不要假设已同步。
- 长时间任务用 nohup 或 Slurm 提交，再用 remote_exec 查看进度。
```

## 10. 对话协议

- 客户端 → 服务端：`chat.send { workspaceId, sessionId?, text, model?, clientTurnId }`、`chat.interrupt { turnId }`、`permission.respond { requestId, allow, message? }`。
- 服务端 → 客户端：`turn.started { turnId, clientTurnId }`、`agent.event { turnId, event }`、`turn.finished { turnId }`、`error { turnId?, message }`。
- 同一会话同一时间只允许一轮；WebSocket 断开时该轮继续运行，待答复的权限请求到时拒绝。
- REST：`GET /api/workspaces/:id/sessions`、`GET /api/workspaces/:id/sessions/:sessionId/events`。

## 11. 前端（M1）

- 两栏：左侧工作区与会话列表（含新建工作区表单、新会话按钮）；中间对话区。右侧面板在 M2 加入。
- 顶栏：应用名、当前工作区、WebSocket 连接状态。
- 对话区：streamdown 渲染文本；工具卡片默认折叠，`remote_exec` 显示命令与退出码；权限卡片；错误横幅；输入框 Enter 发送、Shift+Enter 换行，运行中变为"停止"。
- 纯函数 `reduceChat(items, event)` 把事件转成界面条目，实时和历史共用；对话状态放在 zustand（`chat-store.ts`），只接收当前界面这一轮的事件。
- 现成库：接口数据用 `@tanstack/react-query`（加载、错误、创建工作区后刷新列表、每轮结束后刷新会话列表）；WebSocket 用 `partysocket` 重连（1 秒起、翻倍、上限 15 秒，发送缓冲为 0，断线时不重发对话）；对话区贴底滚动与"回到底部"用 `use-stick-to-bottom`。选用记录见 `docs/guides/dev-environment.md` 1.2。
- 断线时若本轮正在运行：结束运行状态并提示"本轮输出可能不完整"，重新打开会话可从历史中查看完整内容（后端轮次继续运行）。
- 模型输入框：留空表示跟随本地配置；收到 `session` 事件后显示实际模型。
- 视觉：Tailwind 4 `@theme` 定义 ui-layout 第 0 节的颜色，另加 `destructive-foreground`（`#FCA5A5`，卡片上的错误文字，对 card 约 5.6:1；`destructive` 本身只用于图标和边框）；fontsource 字体，lucide 图标。
- 推迟：可调分栏、命令面板、Base UI、虚拟列表、diff、终端、代码高亮（streamdown 的代码插件），按需在后续里程碑引入。

## 12. 错误处理

- SSH 连接失败、认证失败、主机密钥问题：作为工具结果的错误文本返回给 Agent，并在卡片中显示。
- Claude 启动失败或 API 错误：`error` 事件，结束本轮，界面显示横幅。
- WebSocket 断开：顶栏显示"已断开"，指数退避重连。

## 13. 测试与验收

| 层次 | 内容 |
|---|---|
| 单元 | 黑名单（每条规则 + 不应误拦的命令）、ssh config、known_hosts、远程命令拼装、exec 截断与超时、工作区存储、访问控制、事件映射、编辑范围、`reduceChat` |
| 集成 | 内部接口（拒绝时不调用 SSH）、MCP stdio 冒烟（假后端）、WebSocket 来源校验 |
| 验收 | `scripts/dev/e2e-m1.ts`：真实服务器上让 Claude 执行 `hostname` 并与直接 SSH 结果比对；浏览器中完成同一操作 |

验收时服务器上只执行只读命令。

## 14. 风险

- SDK 消息的实际结构可能与类型定义有出入：映射测试使用真实采集的样例。
- Windows 上 tsx 启动 MCP 子进程较慢：验收时记录耗时。
- 本地 `Bash` 每次都需要确认，体验偏繁琐；M2 有同步后再评估放宽。
