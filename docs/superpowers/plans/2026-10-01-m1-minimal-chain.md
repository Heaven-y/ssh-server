# M1 最小链路实施计划

> 实施此计划时使用项目的 `subagent-driven-development` 或 `executing-plans` 技能。本文保留 M1 的原步骤供追溯，当前状态以以下注记和路线图为准。

**状态（2026-10-02）：** Task 1–10 的功能代码已实现，Task 11 尚未完成，`scripts/dev/e2e-m1.ts` 未创建，真实模型 / SSH 链路未验收。原步骤中的勾选不是本轮重新执行测试或提交的证明；后续新增功能以 [需求](../../product/requirements.md)、[设计决策](../../engineering/decisions.md) 和 [路线图](../../roadmap.md) 为准。

**范围更新：** 密码认证与同步在 M2，轻量编辑与版本记录在 M3，Codex / 固定 Agent / skills / 命令 / 上下文状态在 M4，完整向导 / Pebrel 终端参考 / 资源面板在 M5。本计划仅覆盖 M1；不增加任务完成自动检测，训练结果由用户手动要求查看。

**Goal:** 在本机网页里和本机 Claude Code 对话，Claude 通过 `remote_exec` 在 SSH 服务器上执行命令并流式显示，危险命令被黑名单拦截。

**Architecture:** npm workspaces 分为 `packages/shared`（协议类型）、`apps/server`（Node.js + TypeScript + Fastify 本地后端，只监听 127.0.0.1）、`apps/web`（React 前端）。后端用 Claude Agent SDK 驱动对话，把远程工具作为 stdio MCP 服务注入；MCP 服务把请求转发给后端内部接口，后端过黑名单后用 ssh2 执行。

**Tech Stack:** Node 22、TypeScript 5.9.3（仅类型检查）、tsx 4（运行 TS）、Vitest 5、Fastify 5、zod 4、ssh2、@anthropic-ai/claude-agent-sdk 0.3.286、@modelcontextprotocol/sdk 1.31、React 19、Vite 8、Tailwind 4、streamdown。

**技术方向确认（2026-10-02）：** 继续上述后端技术栈，使用异步接口协调 Agent、SSH、子进程与网页消息。Python 分析默认使用服务器已有环境，不为 Python 项目替换网页后端；新脚本先同步后远程分析属于 M2。同会话单轮、同工作区同步串行及终端 / 资源刷新独立按最新架构实施；完整并发验收进入 M6。独立 `.exe` / 安装器和 Go 迁移未增加为计划任务。

**设计：** [M1 最小链路设计](../specs/2026-10-01-m1-minimal-chain-design.md)

## Global Constraints

- 所有命令在仓库根目录执行；依赖只装在项目内，版本写成精确版本（不带 `^`），提交 `package-lock.json`。
- 文件 UTF-8、LF；注释、日志、界面文字、提交信息用中文。
- 仓库公开：代码、测试、提交中不出现真实服务器地址、端口、用户名；真实 Host 只通过命令行参数传给验收脚本。
- 后端只监听 `127.0.0.1` / `::1` / `localhost`。
- 不修改 `~/.claude`、`~/.codex`、`~/.ssh` 下任何文件（只读）。
- 服务器上只执行只读命令（`hostname`、`pwd`、`ls`、`uname`）。
- 本地后端与 MCP 保持 Node.js / TypeScript；远程计算使用已有环境，服务器零安装。耗时 I/O 使用异步接口，不在后端请求中执行项目重计算。
- 代码任务结束前验证 `npm test` 与 `npm run typecheck`；纯文档变更按实际影响范围检查。所有“提交”及“推送”步骤都以用户明确要求为前提，否则不执行，遵循仓库 AGENTS.md。

## Review Focus

1. Windows 路径：`localDir` 写成 `E:/a/b`、`e:\a\b` 时，编辑范围判断、会话目录筛选都应视为同一目录。→ 任务 6（存储时 `path.resolve`）、任务 9（`isInsideDir` 测试）。
2. 引号与链式命令：`echo "sudo rm -rf /"` 不应被拦；`cd x && rm -rf ~` 必须被拦。→ 任务 3。
3. `~/.ssh/config` 带 BOM、CRLF，且 Host 是带引号的中文别名时能正确解析。→ 任务 4。
4. SDK 某轮没有发出 text_delta、只在最终 assistant 消息里给出文本时，界面仍要显示全文。→ 任务 9（mapper 回退测试）。
5. 权限请求待答复时 WebSocket 断开：请求应在超时后被拒绝，本轮正常结束，服务不崩溃。→ 任务 9（适配器超时测试、turn-manager 断开测试）。

---

### Task 1: npm workspaces 骨架

**Files:**
- Create: `package.json`、`tsconfig.base.json`、`vitest.config.ts`
- Create: `packages/shared/package.json`、`packages/shared/tsconfig.json`、`packages/shared/src/index.ts`、`packages/shared/src/index.test.ts`
- Create: `apps/server/package.json`、`apps/server/tsconfig.json`
- Create: `apps/web/package.json`、`apps/web/tsconfig.json`

**Interfaces:**
- Produces: 包名 `@ssh-server/shared`（`exports: { ".": "./src/index.ts" }`）、`@ssh-server/server`、`@ssh-server/web`；根脚本 `test`、`typecheck`、`dev`、`start`、`e2e:m1`。

- [ ] **Step 1: 写配置文件**
  - `tsconfig.base.json`：`target ES2023`、`module ESNext`、`moduleResolution Bundler`、`strict`、`noUncheckedIndexedAccess`、`isolatedModules`、`noEmit`、`skipLibCheck`。server、shared 加 `types: ["node"]`；web 加 `lib: ["ES2023","DOM","DOM.Iterable"]`、`jsx: "react-jsx"`。
  - 根 `package.json`：`private`、`"type": "module"`、`workspaces: ["packages/*","apps/*"]`；脚本：`test` = `vitest run`，`typecheck` = 依次对三个包执行 `tsc -p <包>/tsconfig.json`，`dev` = `concurrently` 同时启动 server（`node --import tsx --watch apps/server/src/main.ts`，并设置 `SSH_SERVER_DEV_ORIGIN=http://127.0.0.1:5173`）和 web（`vite`），`start` = 先构建 web 再 `node --import tsx apps/server/src/main.ts`，`e2e:m1` = `node --import tsx scripts/dev/e2e-m1.ts`。
  - `vitest.config.ts`：`test.projects: ["packages/*", "apps/*"]`。若 Vitest 不能直接加载 `@ssh-server/shared` 的 TS 源码，在各项目配置中把它加入 `server.deps.inline`。

- [ ] **Step 2: 安装依赖（精确版本）**

```powershell
npm i -D -E typescript@5.9.3 vitest@5.0.3 tsx@4.23.15 @types/node@22 ws@8.22.0 concurrently
npm i -E -w @ssh-server/shared zod@4.6.5
npm i -E -w @ssh-server/server fastify@5.12.5 @fastify/websocket@11.3.1 @fastify/static@10.1.5 ssh2@1.17.0 @modelcontextprotocol/sdk@1.31.0 @anthropic-ai/claude-agent-sdk@0.3.286 zod@4.6.5
npm i -D -E -w @ssh-server/server @types/ssh2@1.15.6
npm i -E -w @ssh-server/web react@19.3.0 react-dom@19.3.0 streamdown@2.7.0 lucide-react@1.49.0 zustand@5.0.15 @fontsource/ibm-plex-sans@5.3.0 @fontsource/jetbrains-mono@5.3.0
npm i -D -E -w @ssh-server/web vite@8.3.1 @vitejs/plugin-react@6.1.1 tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 @types/react@19.3.0 @types/react-dom@19.3.0
```

`@types/node` 选 22.x 最新、`concurrently` 选当前最新，安装后在 package.json 中确认为精确版本；Agent SDK 的 peer 依赖 `@anthropic-ai/sdk` 若被自动安装，也在 server 的 package.json 中固定为安装到的版本。

- [ ] **Step 3: 写冒烟测试** `packages/shared/src/index.test.ts`：`expect(PROTOCOL_VERSION).toBe(1)`；`index.ts` 导出 `export const PROTOCOL_VERSION = 1;`。

- [ ] **Step 4: 验证**

Run: `npm test` → 1 passed；`npm run typecheck` → 无错误。

- [ ] **Step 5: 提交** `build: 搭建 npm workspaces 骨架`

---

### Task 2: 共享协议类型

**Files:**
- Create: `packages/shared/src/events.ts`、`protocol.ts`、`workspace.ts`
- Modify: `packages/shared/src/index.ts`（重新导出三者）
- Test: `packages/shared/src/protocol.test.ts`

**Interfaces:**
- Produces:

```ts
// events.ts
export type AgentEvent =
  | { type: 'session'; sessionId: string; model: string; cwd: string }
  | { type: 'user_message'; text: string }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'permission_request'; requestId: string; toolName: string; input: unknown; description?: string }
  | { type: 'turn_end'; isError: boolean; durationMs?: number; costUsd?: number }
  | { type: 'error'; message: string };

// protocol.ts
export const ClientMessageSchema: z.ZodType<ClientMessage>; // discriminatedUnion('type')
export type ClientMessage =
  | { type: 'chat.send'; workspaceId: string; sessionId?: string; text: string; model?: string; clientTurnId: string }
  | { type: 'chat.interrupt'; turnId: string }
  | { type: 'permission.respond'; requestId: string; allow: boolean; message?: string };
export type ServerMessage =
  | { type: 'turn.started'; turnId: string; clientTurnId: string }
  | { type: 'agent.event'; turnId: string; event: AgentEvent }
  | { type: 'turn.finished'; turnId: string }
  | { type: 'error'; turnId?: string; message: string };

// workspace.ts
export const WorkspaceInputSchema; // name 1..100、localDir 非空、sshHost 非空、remoteDir 见下、policy?.disabledRules?: string[]
export type WorkspaceInput = z.infer<typeof WorkspaceInputSchema>;
export type Workspace = WorkspaceInput & { id: string };
export type SshHostInfo = { alias: string; hostname?: string; user?: string; port?: number; unsupported: string[] };
```

`remoteDir` 规则：以 `/` 或 `~` 开头，不含 `\n`、`\r`、`\0`。

- [ ] **Step 1: 写失败测试**（`protocol.test.ts`）
  - `chat.send` 含 workspaceId、text、clientTurnId 时解析成功；`text: ''` 失败；缺 `workspaceId` 失败。
  - `permission.respond { requestId:'r1', allow:false, message:'不允许' }` 成功。
  - `{ type: 'unknown' }` 失败。
  - `WorkspaceInputSchema`：`remoteDir: '~/projects/demo'`、`'/data/项目 a'` 成功；`'projects'`、`'~/a\nb'` 失败。

- [ ] **Step 2: 运行确认失败** `npx vitest run packages/shared` → FAIL（模块不存在）。
- [ ] **Step 3: 实现三个文件。**
- [ ] **Step 4: 运行确认通过** `npm test`、`npm run typecheck`。
- [ ] **Step 5: 提交** `feat(shared): 定义 Agent 事件、对话协议与工作区结构`

---

### Task 3: 命令黑名单

**Files:**
- Create: `apps/server/src/policy/shell.ts`、`default-rules.ts`、`policy.ts`
- Test: `apps/server/src/policy/shell.test.ts`、`policy.test.ts`

**Interfaces:**
- Produces:

```ts
// shell.ts
export function splitSegments(command: string): string[][]; // 按未加引号的 ; && || | & 换行 拆分，每段为去引号后的参数
// policy.ts
export type PolicyContext = { remoteRoot: string; disabledRules?: string[] };
export type PolicyDecision = { allowed: true } | { allowed: false; ruleId: string; reason: string };
export function checkCommand(command: string, ctx: PolicyContext): PolicyDecision;
// default-rules.ts
export type Rule = { id: string; reason: string; match(argv: string[], ctx: PolicyContext): boolean };
export const DEFAULT_RULES: Rule[]; // id 见设计文档第 7 节
```

- [ ] **Step 1: 写失败测试**
  - `splitSegments('echo "a; b" && ls | wc -l')` → `[['echo','a; b'],['ls'],['wc','-l']]`。
  - 拒绝（断言 `ruleId`），`remoteRoot: '~/projects/demo'`：
    `sudo ls`、`FOO=1 sudo ls`、`nohup sudo ls` → privilege；`su -`、`doas id` → privilege；
    `rm -rf /`、`rm -fr ~`、`rm -r -f $HOME`、`rm --recursive --force ~/*`、`rm -rf .`、`rm -rf *`、`rm -rf ..`、`rm -r ~`、`rm -rf ~/projects/demo`、`cd x && rm -rf ~`、`bash -c "rm -rf /"` → rm-dangerous；
    `mkfs.ext4 /dev/sdb1` → mkfs；`dd if=/dev/zero of=/dev/sda` → dd-device；`shutdown -h now`、`reboot` → power；`kill -9 -1`、`pkill -9 -1` → kill-all；`chmod -R 777 .` → chmod-777-recursive；`echo k >> ~/.ssh/authorized_keys`、`rm ~/.ssh/authorized_keys` → authorized-keys；`:(){ :|:& };:` → fork-bomb；`crontab -r` → crontab-remove；`bash -c "sudo ls"` → privilege。
  - 放行：`ls -la`、`python train.py --lr 1e-4`、`rm -rf build/`、`rm -rf ./outputs/tmp`、`echo "sudo rm -rf /"`、`grep -r "rm -rf /" .`、`kill -9 12345`、`git status`、`conda activate env && python a.py`、`cat ~/.ssh/authorized_keys`。
  - `checkCommand('sudo ls', { remoteRoot: '~', disabledRules: ['privilege'] })` → allowed。

- [ ] **Step 2: 运行确认失败** `npx vitest run apps/server/src/policy`。
- [ ] **Step 3: 实现**：分段后对每段剥离前置 `VAR=值` 与包装命令（`nohup time nice env exec command builtin`），取 basename 作为程序名；`bash|sh|zsh -c <s>` 与 `eval <s>` 递归 `checkCommand`；`fork-bomb` 对原始命令去空白后匹配 `:(){:|:&};:`。
- [ ] **Step 4: 运行确认通过** `npm test`、`npm run typecheck`。
- [ ] **Step 5: 提交** `feat(server): 新增远程命令黑名单`

---

### Task 4: ssh config 与 known_hosts

**Files:**
- Create: `apps/server/src/ssh/ssh-config.ts`、`known-hosts.ts`
- Test: `apps/server/src/ssh/ssh-config.test.ts`、`known-hosts.test.ts`

**Interfaces:**
- Produces:

```ts
export type SshHostConfig = { alias: string; hostname: string; port: number; user?: string; identityFiles: string[]; unsupported: string[] };
export function parseSshConfig(text: string, homeDir: string): ParsedSshConfig; // 不透明类型
export function resolveHost(cfg: ParsedSshConfig, alias: string): SshHostConfig | undefined; // 未匹配任何 Host 时 undefined；hostname 缺省为 alias，port 缺省 22
export function listHosts(cfg: ParsedSshConfig): SshHostInfo[]; // 只列出不含通配符的别名
export type HostKeyCheck = 'match' | 'unknown' | 'mismatch' | 'revoked';
export function verifyHostKey(knownHostsText: string, host: string, port: number, key: Buffer): HostKeyCheck;
```

- [ ] **Step 1: 写失败测试**
  - 配置文本以 `\uFEFF` 开头、使用 `\r\n`，含 `Host "测试 服务器"` + `HostName 10.0.0.1` + `Port 2222` + `User demo`：`resolveHost(cfg,'测试 服务器')` → `{ hostname:'10.0.0.1', port:2222, user:'demo' }`。
  - `Host *` + `User fallback` 位于末尾：其他块未设 User 时取 `fallback`；块内已设时以先出现者为准。
  - `IdentityFile ~/.ssh/k` → `identityFiles: ['<homeDir>/.ssh/k']`（用 `path.join`）。
  - `Match host x` 块中的设置不生效；`ProxyJump j` → `unsupported` 含 `ProxyJump`。
  - `listHosts` 不含 `*`、`dev-*`。
  - known_hosts：随机 32 字节作为 key，`'h1 ssh-ed25519 ' + key.toString('base64')` → `verifyHostKey(t,'h1',22,key)` 为 `match`；`[h1]:2222 ...` 仅在 port 2222 时 `match`；哈希条目 `|1|<salt>|<HMAC-SHA1(salt,'[h1]:2222')>` → `match`；`@revoked h1 ...` → `revoked`；主机存在但 key 不同 → `mismatch`；无条目 → `unknown`。

- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**：key 比较对象是 known_hosts 中 base64 解码后的公钥 blob 与 ssh2 `hostVerifier` 收到的原始 key Buffer。
- [ ] **Step 4: 运行确认通过** `npm test`、`npm run typecheck`。
- [ ] **Step 5: 提交** `feat(server): 解析 ssh config 并校验 known_hosts`

---

### Task 5: 远程命令拼装、执行与连接池

**Files:**
- Create: `apps/server/src/ssh/remote-command.ts`、`exec.ts`、`pool.ts`、`scripts/dev/ssh-smoke.ts`
- Test: `apps/server/src/ssh/remote-command.test.ts`、`exec.test.ts`

**Interfaces:**
- Consumes: 任务 4 的 `resolveHost`、`verifyHostKey`。
- Produces:

```ts
// remote-command.ts
export const EXEC_DEFAULT_TIMEOUT_SEC = 600, EXEC_MAX_TIMEOUT_SEC = 3600, EXEC_GRACE_SEC = 30, OUTPUT_CAP_BYTES = 200_000;
export function sq(s: string): string; // POSIX 单引号
export function buildRemoteCommand(remoteRoot: string, command: string, timeoutSec: number): string;
export type PeekAction = 'stat' | 'head' | 'tail' | 'du';
export function buildPeekCommand(remoteRoot: string, path: string, action: PeekAction, lines?: number): string;
// exec.ts
export type ExecResult = { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; truncated: boolean; durationMs: number };
export type ChannelLike = NodeJS.EventEmitter & { stderr: NodeJS.EventEmitter; close(): void };
export function runExec(open: (cmd: string) => Promise<ChannelLike>, cmd: string, opts: { localTimeoutMs: number; outputCap: number }): Promise<ExecResult>;
// pool.ts
export type SshPool = { exec(alias: string, cmd: string, opts: { localTimeoutMs: number; outputCap: number }): Promise<ExecResult>; dispose(): void };
export function createSshPool(deps?: { homeDir?: string; readFile?: (p: string) => Promise<Buffer> }): SshPool;
```

- [ ] **Step 1: 写失败测试**
  - `sq("it's")` → `'it'\''s'`。
  - `buildRemoteCommand('/data/a b', 'ls -la', 600)` → `cd '/data/a b' && exec timeout 600 bash -lc 'ls -la'`。
  - `buildRemoteCommand('~/p q', "echo 'x'", 60)` → `cd "$HOME"/'p q' && exec timeout 60 bash -lc 'echo '\''x'\'''`；`remoteRoot` 为 `~` 时 → `cd "$HOME" && ...`。
  - `buildRemoteCommand('/a', 'ls\nrm', 60)` 不抛错（换行属于命令内容，由 bash 处理）；`remoteRoot` 含 `\n` 时抛错。
  - `buildPeekCommand('~/p', 'logs/a.txt', 'head', 50)` 包含 `head -n 50 -- 'logs/a.txt'`；`lines: 201` 抛错；`du` 包含 `timeout 30 du -sh --`。
  - `runExec`（假通道）：stdout 写入 300 字节、`outputCap: 100` → `stdout.length <= 100 + 截断说明长度`，`truncated: true`，保留的是末尾内容；`close(2)` → `exitCode: 2`；`vi.useFakeTimers()`，不关闭通道，推进 `localTimeoutMs` → `timedOut: true` 且调用了 `close()`。

- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**：连接池每个别名缓存一个 `ssh2.Client`，`close` / `error` 时移除；私钥依次读取 `identityFiles`，为空时尝试 `id_ed25519`、`id_ecdsa`、`id_rsa`；`hostVerifier` 读取 `~/.ssh/known_hosts` 调用 `verifyHostKey`，非 `match` 时拒绝，并给出中文错误（`unknown` 时提示先执行一次 `ssh <Host>`）。`ssh-smoke.ts` 用法：`node --import tsx scripts/dev/ssh-smoke.ts <Host>`，执行 `hostname` 并打印结果。
- [ ] **Step 4: 运行确认通过** `npm test`、`npm run typecheck`；再执行 `node --import tsx scripts/dev/ssh-smoke.ts <真实 Host>`，输出服务器主机名（只读）。
- [ ] **Step 5: 提交** `feat(server): 实现远程命令拼装、执行与 SSH 连接池`

---

### Task 6: 工作区存储与接口

**Files:**
- Create: `apps/server/src/workspaces/store.ts`、`apps/server/src/http/workspaces.routes.ts`
- Test: `apps/server/src/workspaces/store.test.ts`

**Interfaces:**
- Consumes: 任务 2 的 `WorkspaceInputSchema`、`Workspace`、`SshHostInfo`。
- Produces:

```ts
export class WorkspaceValidationError extends Error { constructor(public field: string, message: string) }
export type WorkspaceStore = {
  list(): Promise<Workspace[]>;
  get(id: string): Promise<Workspace | undefined>;
  create(input: WorkspaceInput): Promise<Workspace>;
  update(id: string, patch: Partial<WorkspaceInput>): Promise<Workspace | undefined>;
  remove(id: string): Promise<boolean>;
};
export function createWorkspaceStore(deps: { configDir: string; dirExists(p: string): Promise<boolean>; knownHosts(): Promise<string[]> }): WorkspaceStore;
export function registerWorkspaceRoutes(app: FastifyInstance, deps: { store: WorkspaceStore; listSshHosts(): Promise<SshHostInfo[]> }): void;
```

- [ ] **Step 1: 写失败测试**（临时目录作为 configDir）
  - `create` 返回 UUID `id`；新建另一个 store 实例后 `list()` 仍含该工作区。
  - `localDir: 'E:/x/y'`（在 Windows 上）保存为 `path.resolve` 后的值。
  - `dirExists` 返回 false → 抛 `WorkspaceValidationError`，`field: 'localDir'`；`sshHost` 不在 `knownHosts()` 中 → `field: 'sshHost'`。
  - `workspaces.json` 内容为 `{坏`：`list()` 返回 `[]`，目录中出现 `workspaces.json.bak-*`。
  - `update` 只改 name 时 id 不变；`remove` 后 `get` 为 undefined，且 `localDir` 目录仍存在。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**：写入用"临时文件 + rename"。路由：`GET /api/workspaces`、`POST /api/workspaces`（201）、`PATCH /api/workspaces/:id`、`DELETE /api/workspaces/:id`（204）、`GET /api/ssh-hosts`；校验失败 400 `{ field, message }`，不存在 404。路由测试放在任务 7。
- [ ] **Step 4: 运行确认通过** `npm test`、`npm run typecheck`。
- [ ] **Step 5: 提交** `feat(server): 新增工作区配置存储与接口`

---

### Task 7: 访问控制与启动配置

**Files:**
- Create: `apps/server/src/config.ts`、`apps/server/src/http/security.ts`、`auth.ts`、`app.ts`、`apps/server/src/main.ts`
- Test: `apps/server/src/config.test.ts`、`apps/server/src/http/app.test.ts`

**Interfaces:**
- Consumes: 任务 6 的 `WorkspaceStore`、`registerWorkspaceRoutes`。
- Produces:

```ts
export type ServerConfig = { port: number; host: string; configDir: string; token: string; devOrigin?: string };
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig; // host 非 loopback 时抛错
export const SESSION_COOKIE = 'ssh_server_session';
export type AppDeps = {
  token: string; port: number; devOrigin?: string;
  store: WorkspaceStore; listSshHosts(): Promise<SshHostInfo[]>;
  webDir?: string;                                   // 存在时托管静态文件（SPA 回退到 index.html）
  routes?: (app: FastifyInstance) => void;           // 任务 8、9 用来注册内部接口、会话接口、/ws
};
export function buildApp(deps: AppDeps): Promise<FastifyInstance>; // 注册 @fastify/websocket、安全钩子、/auth、工作区路由，再调用 deps.routes
```

- [ ] **Step 1: 写失败测试**
  - `loadConfig({})` → `port 4317`、`host '127.0.0.1'`、`configDir` 以 `ssh-server` 结尾、`token` 长度 ≥ 43；`SSH_SERVER_HOST=0.0.0.0` 抛错；`SSH_SERVER_TOKEN=t` 时 `token === 't'`。
  - `app.inject`（默认 `Host: 127.0.0.1:4317`）：
    - `Host: evil.com` → 403。
    - 无 Cookie `GET /api/workspaces` → 401。
    - `GET /auth?token=<正确>` → 302，`set-cookie` 含 `ssh_server_session=`、`HttpOnly`、`SameSite=Strict`；错误令牌 → 401。
    - 带 Cookie 的 `POST /api/workspaces`：`Origin: http://evil.com` → 403；无 Origin → 403；`Origin: http://127.0.0.1:4317` 且输入合法 → 201。
    - 测试中通过 `routes` 注册 `GET /internal/ping`（要求 Bearer）：只带 Cookie → 401。
  - 真实监听（`listen({ host: '127.0.0.1', port: 0 })`），`routes` 中注册一个测试用 `/ws`：用 `ws` 客户端带 Cookie、`Origin: http://evil.com` 连接 → 失败；Origin 正确 → 连接成功。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**：安全检查放在 `onRequest` 钩子（WebSocket 升级请求同样经过）；令牌比较用 `crypto.timingSafeEqual`（长度不同直接失败）。`main.ts`：`loadConfig(process.env)` → 组装 store、ssh config 读取 → `buildApp` → `listen` → 用实际端口打印 `访问地址：http://127.0.0.1:<端口>/auth?token=<令牌>`（有 `devOrigin` 时打印 `<devOrigin>/auth?token=...`）。
- [ ] **Step 4: 运行确认通过** `npm test`、`npm run typecheck`；`$env:SSH_SERVER_CONFIG_DIR="<临时目录>"; node --import tsx apps/server/src/main.ts` 能启动并打印访问地址，Ctrl+C 退出。
- [ ] **Step 5: 提交** `feat(server): 实现访问控制与服务启动配置`

---

### Task 8: 内部接口与远程工具 MCP

**Files:**
- Create: `apps/server/src/chat/registry.ts`、`apps/server/src/http/internal.routes.ts`、`apps/server/src/remote-tools/tools.ts`、`main.ts`、`launch.ts`
- Test: `apps/server/src/http/internal.routes.test.ts`、`apps/server/src/remote-tools/tools.test.ts`、`launch.test.ts`、`mcp.smoke.test.ts`

**Interfaces:**
- Consumes: 任务 3 `checkCommand`；任务 5 `buildRemoteCommand`、`buildPeekCommand`、`SshPool`、常量；任务 7 `buildApp({ routes })`。
- Produces:

```ts
// registry.ts
export type SessionRegistry = { register(workspaceId: string): string; resolve(token: string): string | undefined; unregister(token: string): void };
export function createSessionRegistry(): SessionRegistry; // 令牌 = randomBytes(32).toString('base64url')
// internal.routes.ts
export function registerInternalRoutes(app: FastifyInstance, deps: { registry: SessionRegistry; getWorkspace(id: string): Promise<Workspace | undefined>; pool: Pick<SshPool, 'exec'> }): void;
//   POST /internal/remote-exec { command, timeoutSec? } → ExecResult | { denied: { ruleId, reason } }
//   POST /internal/remote-peek { path, action, lines? } → ExecResult
// tools.ts
export function formatExecResult(r: ExecResult): string;
export function formatDenied(d: { ruleId: string; reason: string }): string; // `命令被拒绝：${reason}（规则 ${ruleId}）`
export function createRemoteToolsServer(opts: { internalUrl: string; token: string; fetch?: typeof fetch }): McpServer;
// launch.ts
export const MCP_SERVER_NAME = 'ssh-server';
export function resolveRemoteToolsCommand(): { command: string; args: string[] }; // command = process.execPath，args = ['--import', <tsx/esm 的 file URL>, <remote-tools/main.ts 绝对路径>]
```

- [ ] **Step 1: 写失败测试**
  - 内部接口（假 registry、假 pool 记录调用）：无 Authorization → 401；未知令牌 → 401；`{ command: 'sudo ls' }` → 200 `{ denied: { ruleId: 'privilege' } }` 且 pool 未被调用；`{ command: 'hostname' }` → 调用 pool，命令以 `cd ` 开头、含 `bash -lc 'hostname'`，`localTimeoutMs = (600 + 30) * 1000`；`timeoutSec: 99999` 被限制为 3600；工作区 `disabledRules: ['privilege']` 时 `sudo ls` 放行；peek `lines: 500` → 400。
  - `formatExecResult({ exitCode: 0, stdout: 'h1\n', stderr: '', ... })` 含 `退出码：0` 与 `h1`；`timedOut: true` 时含 `已超时`；`formatDenied` 文本与接口说明一致。
  - `resolveRemoteToolsCommand()`：`command === process.execPath`，`args[1]` 以 `file:` 开头，`args[2]` 为绝对路径且以 `remote-tools/main.ts`（或 `\` 分隔）结尾。
  - MCP 冒烟（超时 30 秒）：启动假后端 HTTP 服务（端口 0）响应 `/internal/remote-exec`；用 `@modelcontextprotocol/sdk` 的 `Client` + `StdioClientTransport`（`command/args` 来自 `resolveRemoteToolsCommand()`，`env` = `process.env` + 内部地址和令牌）连接；`listTools()` 含 `remote_exec`、`remote_peek`；`callTool('remote_exec', { command: 'hostname' })` 的文本含假后端返回的 stdout，且假后端收到 `Authorization: Bearer <令牌>`。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**：tsx loader 用 `import.meta.resolve('tsx/esm')`，不可用时用 `pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm'))`；工具参数用 zod：`remote_exec { command: string, timeoutSec?: int 1..3600 }`、`remote_peek { path: string, action: enum, lines?: int 1..200 }`；工具说明用中文，写明用途与长任务用 nohup / Slurm。
- [ ] **Step 4: 运行确认通过** `npm test`、`npm run typecheck`。
- [ ] **Step 5: 提交** `feat(server): 新增远程工具 MCP 服务与内部接口`

---

### Task 9: Claude 适配器、对话管理与会话接口

**Files:**
- Create: `apps/server/src/agents/instructions.ts`、`edit-scope.ts`、`claude-mapper.ts`、`claude-adapter.ts`、`apps/server/src/chat/turn-manager.ts`、`apps/server/src/http/sessions.routes.ts`、`ws.routes.ts`
- Modify: `apps/server/src/main.ts`（组装全部依赖）
- Test: `apps/server/src/agents/*.test.ts`、`apps/server/src/chat/turn-manager.test.ts`、`apps/server/src/http/sessions.routes.test.ts`

**Interfaces:**
- Consumes: 任务 2 事件与协议；任务 8 `SessionRegistry`、`resolveRemoteToolsCommand`、`MCP_SERVER_NAME`；任务 7 `buildApp({ routes })`。
- Produces:

```ts
export function buildInstructions(ws: Workspace): string;               // 文本见设计文档第 9 节
export function isInsideDir(dir: string, filePath: string): boolean;     // 相对路径按 dir 解析；Windows 不区分大小写
export class ClaudeEventMapper { map(msg: unknown): AgentEvent[]; mapHistory(msg: unknown): AgentEvent[] }
export type TurnHandle = { interrupt(): Promise<void>; done: Promise<void> };
export type ClaudeTurnInput = {
  workspace: Workspace; sessionId?: string; model?: string; text: string;
  mcpEnv: Record<string, string>;                                        // 内部地址与会话令牌
  emit(e: AgentEvent): void;
  requestPermission(req: { requestId: string; toolName: string; input: unknown }): Promise<{ allow: boolean; message?: string }>;
  queryFn?: typeof query;                                                // 测试注入
};
export const PERMISSION_TIMEOUT_MS = 300_000;
export function runClaudeTurn(input: ClaudeTurnInput): TurnHandle;
export type Socket = { send(msg: ServerMessage): void; isOpen(): boolean };
export class TurnManager {
  constructor(deps: { getWorkspace(id: string): Promise<Workspace | undefined>; registry: SessionRegistry; internalUrl(): string; runTurn?: typeof runClaudeTurn });
  handle(socket: Socket, msg: ClientMessage): Promise<void>;
  socketClosed(socket: Socket): void;
}
export type SessionsApi = { list(dir: string): Promise<SDKSessionInfo[]>; messages(id: string, dir: string): Promise<SessionMessage[]> };
export function registerSessionRoutes(app: FastifyInstance, deps: { store: WorkspaceStore; api?: SessionsApi }): void;
export function registerWsRoutes(app: FastifyInstance, deps: { turns: TurnManager }): void; // 消息用 ClientMessageSchema 解析，失败回 error
```

- [ ] **Step 1: 写失败测试**
  - `buildInstructions` 含 `sshHost`、`remoteDir` 与 `尚未实现同步`。
  - `isInsideDir('E:\\w\\p', 'e:/w/p/a.ts')` → true；`'E:\\w\\p2\\a.ts'` → false；`'..\\..\\x'` → false；`'src/a.ts'` → true；目录本身 → true。
  - 映射（样例按 SDK 类型手写；Step 4 后用真实采集样例补一条）：init → `session`；`stream_event` text_delta → `text`，thinking_delta → `reasoning`；assistant tool_use → `tool_call`；本轮无 text_delta 时 assistant text → `text`（全文），有 text_delta 时不再输出；user tool_result（含 `is_error: true`）→ `tool_result`，超过 20 000 字符被截断；result（`is_error`、`duration_ms`、`total_cost_usd`）→ `turn_end`；`mapHistory` 中用户纯文本 → `user_message`，tool_result 不产生 `user_message`。
  - 适配器（假 `queryFn` 记录 options 并产出脚本化消息）：`cwd === workspace.localDir`；`settingSources` 为 `['user','project','local']`；`systemPrompt` 为 preset `claude_code` 且 `append` 含工作区指令；`mcpServers['ssh-server'].command === process.execPath`，其 `env` 同时包含 `process.env` 中的 `PATH`（Windows 上可能是 `Path`）与 `SSH_SERVER_INTERNAL_URL`、`SSH_SERVER_SESSION_TOKEN`；`allowedTools` 等于设计文档第 9 节列表；未传 model 时 options 中没有 `model`，顶层也没有 `env`；传入 `sessionId` 时 `resume` 等于它。
  - `canUseTool('Edit', { file_path: <localDir 内> })` → allow 且未调用 `requestPermission`；`canUseTool('Bash', { command: 'ls' })` → 调用 `requestPermission`，按答复返回 allow / deny；`vi.useFakeTimers()`，`requestPermission` 永不返回时推进 `PERMISSION_TIMEOUT_MS` → deny。
  - `handle.interrupt()` 调用 query 的 `interrupt()`。
  - TurnManager（假 `runTurn`、假 socket）：首次 `chat.send` → 先发 `turn.started`（带 `clientTurnId`），再转发 `agent.event`，最后 `turn.finished`；运行中同一 `sessionId` 再次发送 → `error`，消息为 `该会话正在运行`；未知 workspaceId → `error`；轮次开始前登记会话令牌、结束后注销；`socketClosed` 后不再调用 `send`，轮次继续完成且不抛错。
  - 会话接口（假 `SessionsApi`）：`GET /api/workspaces/:id/sessions` 以工作区 `localDir` 调用 `list` 并返回 `{ sessionId, summary, lastModified }[]`；`.../sessions/:sid/events` 返回 `mapHistory` 后的事件数组。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**；`main.ts` 组装：store、`createSshPool()`、`createSessionRegistry()`、`TurnManager`（`internalUrl` 取实际监听地址）、`buildApp({ routes: app => { registerInternalRoutes; registerSessionRoutes; registerWsRoutes } , webDir: apps/web/dist })`。
- [ ] **Step 4: 运行确认通过** `npm test`、`npm run typecheck`；临时 configDir 启动后，用正确 Cookie 访问 `GET /api/workspaces` 返回 `[]`。
- [ ] **Step 5: 提交** `feat(server): 接入 Claude Agent SDK、对话 WebSocket 与会话接口`

---

### Task 10: 前端（M1）

**Files:**
- Create: `apps/web/index.html`、`vite.config.ts`、`vitest.config.ts`、`src/main.tsx`、`src/styles.css`、`src/app/App.tsx`、`src/app/TopBar.tsx`、`src/ui/styles.ts`（共用按钮、输入框样式）
- Create: `src/features/workspaces/WorkspaceSidebar.tsx`、`WorkspaceForm.tsx`、`SessionList.tsx`
- Create: `src/features/chat/chat-reducer.ts`、`chat-store.ts`、`ChatView.tsx`、`MessageItem.tsx`、`ToolCard.tsx`、`PermissionCard.tsx`、`Composer.tsx`
- Create: `src/lib/api.ts`、`src/lib/ws.ts`、`src/lib/query-client.ts`
- Test: `src/features/chat/chat-reducer.test.ts`
- 依赖（复用成熟库，见 `docs/guides/dev-environment.md` 1.2）：`@tanstack/react-query`、`partysocket`、`use-stick-to-bottom`

**Interfaces:**
- Consumes: 任务 2 `AgentEvent`、`ClientMessage`、`ServerMessage`、`Workspace`；任务 6–9 的 REST 与 `/ws`。
- Produces:

```ts
export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; output?: string; isError?: boolean; status: 'running' | 'done' }
  | { kind: 'permission'; id: string; toolName: string; input: unknown; resolved?: 'allow' | 'deny' }
  | { kind: 'error'; id: string; message: string };
export function reduceChat(items: ChatItem[], e: AgentEvent): ChatItem[]; // 纯函数，不修改入参
export function resolvePermission(items: ChatItem[], requestId: string, allow: boolean): ChatItem[];
```

- [x] **Step 1: 写失败测试**（`chat-reducer.test.ts`，web 的 vitest 用 node 环境）
  - 连续两个 `text` → 一个 assistant 条目，文本拼接，`streaming: true`。
  - `text` → `tool_call` → `text` → 两个 assistant 条目，中间一个 tool 条目。
  - `tool_call{id:'t1'}` → `tool_result{id:'t1', output:'ok'}` → tool 条目 `status: 'done'`、`output: 'ok'`；`isError: true` 时保留。
  - `permission_request{requestId:'p1'}` → permission 条目；`resolvePermission(items,'p1',true)` → `resolved: 'allow'`。
  - `turn_end` → 所有 assistant 条目 `streaming: false`；`error` → error 条目；`user_message` → user 条目。
  - 入参数组在调用后保持不变。
- [x] **Step 2: 运行确认失败。**
- [x] **Step 3: 实现**
  - `vite.config.ts`：react、tailwind 插件；`server.host '127.0.0.1'`、`port 5173`、`proxy` 把 `/api`、`/auth`、`/ws`（`ws: true`）转发到 `http://127.0.0.1:4317`。
  - `styles.css`：`@import "tailwindcss"`；`@theme` 定义 ui-layout 第 0 节的颜色变量（含 `border-strong`）与字体；引入 fontsource。
  - `ws.ts`：用 `partysocket` 重连（1、2、4、8 秒……上限 15 秒）；状态 `connecting | open | closed`。
  - 界面按设计文档第 11 节；所有图标按钮有 `aria-label`；消息区 `aria-live="polite"`；工作区表单错误显示在对应字段下方。
- [x] **Step 4: 运行确认通过** `npm test`、`npm run typecheck`（已加入 web）、`npm run build -w @ssh-server/web`；`npm run dev` 后用浏览器打开打印的访问地址，页面显示工作区列表，控制台无报错。（内置浏览器不可用，改用 playwright-core + 本机 Edge，见开发环境文档 4.6）
- [x] **Step 5: 提交** `feat(web): 实现工作区与对话界面（M1）`

---

### Task 11: M1 验收与文档

2026-10-02 状态：本任务仍未完成。必须先补下列脚本，再执行真实模型 / SSH 和浏览器验收；直接 SSH 冒烟、已有单元测试和文档更新均不能代替它。

**Files:**
- Create: `scripts/dev/e2e-m1.ts`
- Modify: `docs/roadmap.md`、`docs/engineering/architecture.md`（第 8 节）、`docs/guides/dev-environment.md`、`README.md`

- [ ] **Step 1: 写验收脚本** `e2e-m1.ts --host <Host> --remote-dir <目录>`：
  - 以临时 configDir、随机端口（`SSH_SERVER_PORT=0`）、指定令牌启动 `main.ts` 子进程，从输出读取访问地址；`/auth` 取得 Cookie。
  - 在临时目录下建本地文件夹，`POST /api/workspaces` 创建工作区。
  - WebSocket 发送 `chat.send`：`请使用 remote_exec 工具执行 hostname，并原样告诉我输出。`；收集事件直到 `turn.finished`（超时 180 秒）。
  - 断言：存在 `tool_call` 且 `name` 以 `remote_exec` 结尾；对应 `tool_result` 含 `createSshPool().exec(host, 'hostname')` 的输出（去首尾空白）；`session.model` 非空。
  - 打印 `PASS` / `FAIL`、首个事件耗时、总耗时；结束时关闭子进程、删除临时目录。
- [ ] **Step 2: 运行验收** `npm run e2e:m1 -- --host <真实 Host> --remote-dir "~"` → `PASS`；记录耗时与模型名。
- [ ] **Step 3: 浏览器验收**（webapp-testing 或内置浏览器）：`npm start` 后打开访问地址，在界面中创建工作区，发送同一句话，确认出现 `remote_exec` 卡片且结果为服务器主机名；再发送 `请用 remote_exec 执行 sudo whoami`，确认卡片显示 `命令被拒绝`（规则 privilege）。截图保存到会话临时目录，不进仓库。
- [ ] **Step 4: 更新文档**：真实验收通过后将路线图 M1 标记完成并写验收记录；架构文档第 8 节写入 V1（本地配置是否生效）、V2（会话列表与历史）、V10（访问控制）的结论；开发环境文档补充运行用法和新发现的问题；README 更新当前实现范围。保留 2026-10-02 已确认的 M2–M5 需求，不把待实现能力标为完成。
- [ ] **Step 5: 验证** `npm test`、`npm run typecheck`；文档链接与敏感信息检查（同首次提交时的检查）。
- [ ] **Step 6: 用户明确要求时提交 / 推送**：提交信息 `docs: 记录 M1 验收结果并更新文档`；推送另按用户明确指令执行，不因本计划出现 `git push` 就自动推送。
