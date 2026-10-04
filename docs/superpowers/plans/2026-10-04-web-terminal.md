# 网页 SSH 终端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:executing-plans` 自行逐项实施，或按用户选择使用 `superpowers:subagent-driven-development`。以下复选框用于记录实际完成状态；用户禁止调用 `gpt-6-astra`。

**Goal:** 交付绑定工作区的网页 SSH PTY 终端，支持可靠进入目录、交互、独立释放、多标签、分屏和可调整布局。

**Architecture:** 每窗格使用独立原生 WebSocket 和 PTY，复用现有 SSH 连接池及访问控制。后端隔离目标绑定、目录初始化和有界流量管理；前端把终端实例与布局树分开，使呈现变化不重建连接。终端协议独立于聊天，不调用模型或同步调度。

**Tech Stack:** Node.js ≥22、TypeScript、Fastify、ssh2、ws、Zod、React 19；实施时精确锁定 `@xterm/xterm@6.0.0`、`@xterm/addon-fit@0.11.0`、`react-resizable-panels@4.14.2`。

**Spec:** [已确认的网页终端设计](../specs/2026-10-04-web-terminal-design.md)。设计于 2026-10-04 经用户“确认 继续”认可；本计划已自查，待书面审阅，尚未实施产品代码或安装依赖。

## Global Constraints

- 中文界面、文档、注释和提交信息；UTF-8、LF，`.ps1` 使用 UTF-8 BOM。公开文件不含真实连接信息，测试目录由临时目录生成。
- 每标签最多 4 窗格，每工作区最多 8 个活动/启动中 PTY，后端合计最多 32 个；预留名额必须在异步启动前完成。
- 绑定有效期 5 分钟；初始尺寸实测，无法测量时 80 列、24 行；接受行列均为 2–500 的整数，`setWindow(rows, cols, 0, 0)`。
- 启动总时限 30 秒，PTY 目录确认最多 10 秒；初始化输出最多 128 KiB；不以命令运行时长结束终端。
- 单次输入及二进制输出帧最多 32 KiB；输入队列最多 256 KiB；待发与未确认输出合计最多 1 MiB。
- 未确认输出达到 256 KiB 或 WebSocket `bufferedAmount` 达到 64 KiB 时暂停 stdout/stderr；全部降至 64 KiB 以下恢复。
- 有未消费输出且连续 60 秒无有效消费确认时结束；ping 间隔 20 秒，60 秒无 pong 结束；空闲无输出不触发慢消费者超时。
- 浏览器发送缓冲达到 64 KiB 或收到后端暂停通知时停用新输入；xterm 回滚 2,000 行，正文不进入 React/zustand 或持久存储。
- 默认终端高度为主区 40%，终端和上方对话各至少 240px；空间不足时使用覆盖层或仅显示活动窗格，隐藏实例保持挂载和最后有效尺寸。
- WebSocket/SSH 断开后结束本次 shell；用户明确新建连接才再开启，不重放旧输入、不承诺恢复进程。单窗格关闭不能调用共享池 `disconnect()`。
- 先实现并 Review 核心，再补最少核心回归；改动期间只验证关联部分。阶段整合执行既有完整门禁和双平台 CI，不降低覆盖率或增加排除项。

## Review Focus

1. 工作区/SSH 配置在异步启动中变化：拒绝旧绑定，不能让目录解析和 PTY 接到不同目标；任务 1、2，回归 `rejectsChangedTargetDuringOpen`。
2. 初始化命令回显、确认帧跨 chunk、确认后立即出现中文输出：只有实际成功帧开放输入，保留成功帧之后的原始字节；任务 2，回归 `ignoresEchoAndPreservesTrailingBytes`。
3. 高速 stderr、伪造消费确认和 send 回调失败：与 stdout 同样受限，错误不能伪装为完整输出或正常退出；任务 3，回归 `boundsBothStreamsAndRejectsOverAck`。
4. 已自然退出后触发 WebSocket close，或粘贴发送一半时断线：保留真实终态、清空尚未发送输入，新连接不会执行旧队列；任务 4，回归 `preservesExitAndDropsPendingPaste`。
5. 为已有窗格新增嵌套分屏、关闭相邻窗格或跨断点：原实例、通道和焦点不被重建，隐藏时不发送零尺寸；任务 5，回归 `keepsPaneIdentityAcrossLayoutChanges`。

## 文件职责与接口约定

| 文件 | 职责 |
|---|---|
| `packages/shared/src/terminal.ts`、`index.ts` | 控制消息 schema、状态类型、跨端限制值与导出 |
| `apps/server/src/terminal/{binding,errors}.ts` | 有时限的目标绑定、可公开的中文错误分类 |
| `apps/server/src/ssh/pool.ts` | 受连接标识/认证代次保护的 SFTP、PTY 通道开启 |
| `apps/server/src/terminal/{directory,initialization}.ts` | 只读目录解析、POSIX 初始化和跨 chunk 确认 |
| `apps/server/src/terminal/{input,output,session,manager}.ts` | 有界输入/输出、单会话生命周期、名额管理 |
| `apps/server/src/http/terminal.routes.ts`、`main.ts` | 独立 HTTP/WS 协议入口、依赖组装与退出收尾 |
| `apps/web/src/features/terminal/{connection,paste}.ts` | 原生 WS、发送门禁、粘贴确认后的分块与取消 |
| `apps/web/src/features/terminal/{layout,terminal-store}.ts` | 纯布局树操作、内存标签与固定目标，不持有输出正文 |
| `apps/web/src/features/terminal/{TerminalDock,TerminalFrame,TerminalLayout,TerminalPane,TerminalDialogs}.tsx` | 操作区、呈现容器、可拖动布局、稳定 xterm 宿主、确认对话框 |
| `apps/web/src/app/{App,TopBar}.tsx`、`lib/api.ts`、`index.css` | 顶栏入口、主区接线、绑定 API、限定终端样式 |
| `scripts/dev/{terminal-fixture,e2e-terminal}.ts` | 本机 ssh2 PTY fixture、终端实际网页验收准备及收尾 |
| `docs/guides/web-terminal-acceptance.md` | 实际运行证据、限制和未完成的真实 SSH 验收 |

以上均为实施时的路径，不预建空产品目录。可复用现有 `ssh/sftp.ts`、`ssh/remote-command.ts` 的 `sq()`、`remote-files/paths.ts` 的 `remotePath()` 和 Ariakit/原生对话框；不复制浏览服务的生命周期到终端。

```ts
type TerminalTarget = { workspaceId: string; sshHost: string; authMode: SshAuthMode; remoteDir: string };
type TerminalSize = { cols: number; rows: number };
type TerminalBinding = { binding: string; expiresAt: number; target: TerminalTarget };
type TerminalClientMessage =
  | { type: 'open'; target: TerminalTarget; binding: string; size: TerminalSize }
  | { type: 'input'; data: string } // 严格 base64，解码后最多 32 KiB
  | { type: 'resize'; size: TerminalSize }
  | { type: 'ack'; bytes: number } // 正整数，不能超过已发送未确认字节
  | { type: 'close' };
type TerminalServerMessage =
  | { type: 'ready'; sessionId: string; target: TerminalTarget; startDir: string }
  | { type: 'input-flow'; paused: boolean }
  | { type: 'exit'; exitCode: number | null; signal: string | null; outputComplete: boolean }
  | { type: 'error'; code: string; message: string };
```

输出正文仅使用服务端二进制帧。输入统一 base64 保留 `onBinary` 字节；UTF-8 在前端编码后分块，控制消息不混入聊天协议。控制 JSON 总帧上限 64 KiB，WS `maxPayload` 与此一致；输入大小按解码后字节校验。协议使用严格对象校验，拒绝未知字段与消息类型，类型/schema 同一文件维护。

### 任务 1：终端协议与有时限的固定目标绑定

**文件：** 新增 shared `terminal.ts`、server `terminal/binding.ts`、`errors.ts`；修改 shared `index.ts`。核心回归路径：`packages/shared/tests/terminal.test.ts`、`apps/server/tests/terminal/binding.test.ts`，任务 6 再补。

**接口：** `TerminalTargetSchema`、`TerminalSizeSchema`、`TerminalClientMessageSchema`、`TerminalServerMessageSchema` 产生上述类型。`createTerminalBindings({ store, pool })` 返回 `issue(target: TerminalTarget, options: { signal: AbortSignal; previousBinding?: string }): Promise<TerminalBinding>` 与 `verify(target: TerminalTarget, binding: string, signal: AbortSignal): Promise<{ workspace: Workspace; generation: number; fingerprint: string }>`；issue 只读取工作区、配置指纹和代次，不读凭据或连接服务器。

- [ ] 实现共享协议与限制常量；规范化未声明的工作区 `authMode` 为 `key`，目标相等只比较工作区 ID、Host、认证方式和远端目录。
- [ ] 实现进程内随机密钥签名的版本/随机值/到期时间令牌，签名绑定固定目标、配置指纹和认证代次；校验到期时间与常量时间签名，不用无界令牌 Map。令牌只携带版本、随机值、到期时间和 MAC，不嵌入目标/配置指纹或实际连接配置。
- [ ] 为既有标签签发新令牌时要求 previousBinding；可忽略旧令牌的到期时间，但须核对其签名仍绑定当前固定目标、指纹和代次。只有身份未变化才刷新，不能用“重新 issue 当前配置”让旧标签悄然连到新服务器；verify 开启 PTY 时仍严格检查 5 分钟期限。
- [ ] 自查已删除工作区、目标变化、代次变化、过期、篡改及重启后旧令牌的拒绝路径；错误使用固定中文分类，不回显原始异常中的配置或正文。
- [ ] 运行 `npx tsc -p packages/shared/tsconfig.json` 及相关文件 ESLint/Prettier、`git diff --check`，通过后提交协议与绑定阶段；本阶段不安装前端依赖。

### 任务 2：受保护的 PTY 开启与目录确认

**文件：** 修改 `ssh/pool.ts`，新增 `terminal/directory.ts`、`initialization.ts`。核心回归路径：既有 `apps/server/tests/ssh/pool.test.ts`，新增 `apps/server/tests/terminal/initialization.test.ts`，任务 6 再补。

**接口：** 池导出 `SshChannelGuard = { generation: number; cacheKey: string; signal: AbortSignal }`；`openSftp(target: SshTarget, guard?: SshChannelGuard): Promise<SFTPWrapper>` 保持旧调用兼容；新增 `openShell(target: SshTarget, options: TerminalSize & { guard: SshChannelGuard }): Promise<ClientChannel>`。`resolveTerminalDirectory({ workspace, pool, guard }): Promise<string>`；`initializeTerminal({ channel, startDir, signal }): Promise<{ trailing: Buffer[] }>`。

- [ ] 在池的实际连接解析处比较 guard 的 `cacheKey` 与代次，再复验取消状态；SFTP/PTY 回调晚到时关闭通道。PTY 使用 `term: 'xterm-256color'`；不使用 `exec()` 的运行时限，不创建第二套连接池。
- [ ] 用受 guard 保护的 SFTP 解析 `.` 为 home，再以 `remotePath()` 解析工作区目录并 realpath/lstat；绝对路径必须以 `/` 开头且无 CR/LF/NUL，结果须为目录，`finally` 释放 reader。启动取消后才返回的 SFTP 同样释放。
- [ ] 用 `sq(startDir)` 和随机确认标记生成唯一 POSIX 初始化语句，成功/失败标记通过 `printf` 输出；匹配实际控制字节，不能把 shell 回显中的转义文本当成功。解析器最多保留 128 KiB，10 秒或父级 30 秒超时关闭通道，失败绝不开放家目录输入。
- [ ] 跨 chunk 找到成功标记后保留其后所有原始字节；初始化期间输入不进入通道，stdout/stderr 的监听交接无丢失窗口。错误、自然退出、abort 的收尾幂等。
- [ ] 自查 guard 与通道取消路径，运行 server 类型检查和相关文件静态检查，增量运行既有 `npm test -- apps/server/tests/ssh/pool.test.ts apps/server/tests/ssh/sftp.test.ts`；通过后提交通道初始化阶段。

### 任务 3：独立终端会话、流量控制与 HTTP/WS 接线

**文件：** 新增 `terminal/input.ts`、`output.ts`、`session.ts`、`manager.ts`、`http/terminal.routes.ts`；修改 `main.ts`。核心回归路径：`apps/server/tests/terminal/session.test.ts`、`apps/server/tests/http/terminal.routes.test.ts`，任务 6 再补。

**接口：** `createTerminalManager({ store, pool, bindings })` 返回 `attach(workspaceId: string, socket: WebSocket): void`、`dispose(): void`。`createTerminalInput({ channel, notify, fail })` 返回 `enqueue(bytes: Buffer): void`、`dispose(): void`；`createTerminalOutput({ channel, socket, fail })` 返回 `push(bytes: Buffer): void`、`ack(bytes: number): void`、`finish(result: { exitCode: number | null; signal: string | null }): void`、`dispose(): void`。`registerTerminalRoutes(app, { terminals, bindings }): void`。

- [ ] 实现输入队列及 drain 门禁，32 KiB 解码限制、256 KiB 待写上限和暂停通知；超限结束本窗格，不截断后继续执行。所有关闭路径清理输入和 drain 监听。
- [ ] 实现 stdout/stderr 的统一输出队列、32 KiB 分帧、消费确认与共享限制；维护待发、未确认、send 进行中的字节计数，达到阈值暂停两种流。定时复查 WS 缓冲下降以恢复，send 失败和过量 ack 明确结束；1 MiB 上限只描述应用队列。
- [ ] 实现会话状态 `waiting-open → starting → ready → draining → ended`，首帧前禁止其他输入，重复 open 拒绝；30 秒覆盖等待首帧和启动。预留工作区/全局名额后才 await，凭据变更、取消及后端 dispose 释放名额和监听。验证绑定后捕获连接 `cacheKey`，SFTP/PTY 都用同一 guard，ready 前复验目标与指纹。
- [ ] 实现 20 秒 ping/60 秒无 pong、60 秒慢消费者检查；自然退出先排空待发输出及 send 回调，再发实际 exit（未知值为 null）。draining 仍受队列/消费时限约束，发送失败时 `outputComplete: false`；不能生成假 exit 0。
- [ ] 注册 `POST /api/workspaces/:id/terminal-binding`（body 为 `{ target: TerminalTarget; previousBinding?: string }`）、`GET /api/workspaces/:id/terminal` WS，URL ID 必须与目标一致，返回 `no-store`；沿用现有 Cookie/Host/Origin。仅协议错误/状态可记录，禁记令牌、输入输出及凭据；后端退出先 dispose 终端再 dispose 池。
- [ ] 自查无启动/收尾竞态、单窗格关闭不 disconnect 池；运行 server 类型/相关文件静态检查和既有 `npm test -- apps/server/tests/http/security.test.ts apps/server/tests/ssh/pool.test.ts`，通过后提交后端阶段。

### 任务 4：浏览器连接、xterm 与复制粘贴

**文件：** 精确增加 web 三项依赖及 lockfile；新增 `features/terminal/connection.ts`、`paste.ts`、`TerminalPane.tsx`、`TerminalDialogs.tsx`；修改 `lib/api.ts`。核心回归路径：`apps/web/tests/features/terminal/connection.test.ts`，任务 6 再补。

**接口：** API 新增 `bindTerminalTarget(target: TerminalTarget, options?: { signal?: AbortSignal; previousBinding?: string }): Promise<TerminalBinding>`。`createTerminalConnection({ target, binding, size, callbacks })` 返回 `input(bytes: Uint8Array): boolean`、`resize(size: TerminalSize): void`、`ack(bytes: number): void`、`close(): void`；callbacks 为 `output(bytes)`、`message(TerminalServerMessage)`、`closed()`，内部不自动重连。`TerminalPane({ paneId, target, binding, visible, active, onState }): ReactNode`。

- [ ] 安装锁定依赖；连接用原生 WebSocket、`binaryType = 'arraybuffer'`，open 首帧后等待 ready。严格校验服务端控制消息，结束状态单向转换；明确新建连接创建新连接对象，旧关闭事件不能覆盖新实例状态。
- [ ] xterm 每窗格只创建一次，加载 FitAddon、UTF-8 onData/原始 onBinary、输出 write 回调 ack；首次可见布局测量后才发送 open，未能测量用80列/24行。ResizeObserver/rAF 仅在可见且行列变更时发送最新有效尺寸，所有 disposer 随实际窗格关闭执行。
- [ ] OSC 52 注册消费处理器禁止写剪贴板，不加载自动链接插件，不使用远端标题覆盖目标；设置语义色、JetBrains Mono、2,000 回滚行、屏幕阅读器模式。
- [ ] 统一键盘和菜单粘贴入口：CR/LF 均弹出预览确认，确认后按原始字节分块且不追加 Enter；至多持有 256 KiB 未发送粘贴，超出时说明限制并要求缩小，不截断执行。暂停等待 drain/发送缓冲恢复；断线、新连接和取消清空未发送部分，说明已发送部分无法撤回。
- [ ] 复制只取选择文本，`Ctrl+Shift+C/V` 及菜单触发权限调用；`Ctrl+C` 保留中断，输入法组字时不触发应用快捷键。粘贴事件先阻止 xterm 默认直传，避免跳过多行确认；权限失败显示普通粘贴提示。
- [ ] 自查断线不重放、exit 不被 close 覆盖和浏览器发送缓冲门禁；运行 web 类型/相关文件静态检查、`npm run build -w @ssh-server/web`，通过后提交前端通道阶段。

### 任务 5：稳定实例的多标签、分屏和可调主区

**文件：** 新增 `layout.ts`、`terminal-store.ts`、`TerminalDock.tsx`、`TerminalFrame.tsx`、`TerminalLayout.tsx`；修改 `App.tsx`、`TopBar.tsx`、`index.css`。核心回归路径：`apps/web/tests/features/terminal/layout.test.ts`，任务 6 再补；视觉由任务 6 实际网页验收。

**接口：** `TerminalLayoutNode = { kind: 'pane'; paneId: string } | { kind: 'split'; id: string; orientation: 'horizontal' | 'vertical'; children: [TerminalLayoutNode, TerminalLayoutNode] }`。`splitPane(tree, paneId, nextPaneId, orientation): TerminalLayoutNode`、`removePane(tree, paneId): TerminalLayoutNode | undefined`、`paneIds(tree): string[]`。`TerminalDock({ workspace, visible, onHide }): ReactNode` 只在明确创建入口使用当前 workspace；标签保存固定 target/binding，不订阅当前聊天来改写已有标签。

- [ ] 内存 store 管理标签、树、活动 paneId、打开时的工作区名称与状态；新标签请求绑定，新增分屏及“新建连接”用标签原目标和 previousBinding 刷新，目标/配置变化则拒绝沿用标签。已有窗格冻结开启时的 binding，刷新不修改它们的连接；新 shell 使用新 paneId，旧回调不能改写新实例。
- [ ] 用 4.x `Group`、`Panel`、`Separator` 渲染布局槽位，行列方向分别为 horizontal/vertical；尺寸百分比写显式字符串，数值为像素。布局树只管理槽位，全部 `TerminalPane` 在稳定宿主下按 paneId 渲染为同级元素，根据槽位测量定位；新增/折叠嵌套 Group 不重挂原 xterm。
- [ ] 标签/窗格关闭使用明确 shell 断开确认，已结束窗格直接关闭；叶子删除折叠树，恢复相邻窗格焦点。标签、操作菜单及分隔线键盘可用，控制区不截获终端普通按键。
- [ ] App 左侧栏外的主区使用垂直分栏，上方保留聊天/文件，下方默认 40% 终端；至少各 240px，空间不足用覆盖层。收起、最大化与跨断点只改同一内容子树的样式/布局；顶栏首次打开才 lazy 加载，已开启 Dock 不随隐藏/聊天变化卸载。
- [ ] 宽度不足时只显示活动窗格，其余保持挂载；隐藏时忽略零尺寸，恢复后 fit；标题固定显示工作区、Host、认证方式、“起始目录”和文字状态，`cd` 不伪造当前目录。
- [ ] 自查 stable paneId/宿主、4 窗格限制及默认目录/焦点语义；运行 web 类型/相关文件静态检查和 web build，通过后提交布局及正式文档接线阶段，仍不标完整验收。

### 任务 6：核心 Review、最少回归与网页验收

**文件：** 上述明确测试路径、`scripts/dev/terminal-fixture.ts`、`scripts/dev/e2e-terminal.ts`、`docs/guides/web-terminal-acceptance.md`；同步 requirements、architecture、decisions、ui-layout、roadmap 和剩余范围核对。fixture 使用随机本机端口、临时密钥/known_hosts/工作区，不读取真实凭据。

**接口：** `startTerminalFixture({ configDir, workspaceDir }): Promise<{ pool: SshPool; workspace: Workspace; close(): Promise<void> }>` 提供真实 ssh2 握手、SFTP 元数据和 PTY 通道；受控远端实现识别初始化及测试命令、回显字节并模拟备用屏幕/鼠标/窗口事件。实际 POSIX 全屏工具依赖真实服务器另验，不把合成终端模拟标为 `htop` 实测。

- [ ] 按已选择的执行方式完成全分支核心 Review，覆盖设计目标、五项 Review Focus、异步收尾和访问边界；不使用 astra，不续接历史代理。先处理实际问题，再确定最少回归断言。
- [ ] 补共享协议与 binding 核心回归：`rejectsInvalidControl` 断言 1/501 行列、未知字段、非法 base64 被拒绝；`rejectsChangedTargetDuringOpen` 断言到期/篡改/工作区删除/配置或代次变化不开 PTY，有效绑定不回传连接配置。
- [ ] 补 pool/初始化核心回归：`closesLateChannels` 断言 abort 后晚到的 SFTP/PTY close 且不登记；`ignoresEchoAndPreservesTrailingBytes` 断言逐字节成功帧、回显假标记、成功后中文 bytes 完整；目录失败/128 KiB 超限/10 秒与30 秒超时均不开放输入。
- [ ] 补会话/HTTP核心回归：`boundsBothStreamsAndRejectsOverAck` 断言 32 KiB 分帧、256 KiB 暂停、64 KiB 以下恢复、1 MiB 终止及非法 ack；`isolatesPaneAndDrainsExit` 断言单窗格关闭不 disconnect、真实 exit 排在输出后、send 失败不报完整；名额 8/32、慢消费60秒、pong60秒与无权限 WS 的拒绝只覆盖各一条核心路径。
- [ ] 补 web 核心回归：`preservesExitAndDropsPendingPaste` 断言 exit 不被 close 覆盖，32 KiB 分块、确认前不发送、背压暂停、断线后新连接无旧输入；`keepsPaneIdentityAcrossLayoutChanges` 断言分屏/相邻关闭保持 paneId、超过4拒绝、隐藏不发送零尺寸，实例保留再由浏览器核对。
- [ ] 执行一次关联回归：`npm test -- packages/shared/tests/terminal.test.ts apps/server/tests/terminal apps/server/tests/http/terminal.routes.test.ts apps/server/tests/http/security.test.ts apps/server/tests/ssh/pool.test.ts apps/server/tests/ssh/sftp.test.ts apps/web/tests/features/terminal`；修复后只复跑受影响文件。fixture 的 TS/静态检查纳入 scripts 现有配置。
- [ ] 启动真实 ssh2 fixture 和网页，实际检查 960/1280/1920 渲染、中文/IME、复制/单行与多行粘贴、ANSI/备用屏幕/鼠标、resize、上下/左右嵌套分屏、收起/最大化/切换聊天的实例保留；用随机标记证明输入只进入选定通道，关闭单窗格后其他 PTY、SFTP、聊天可继续。检查目录失败、断线/拥塞状态、收尾所有通道及计时器；截图和完整验收结论写入文档。
- [ ] 正式文档仅标实际通过范围；真实 A10/A12 仍需待答的 SSH 授权，A18/V16 待资源面板与完整并发。最终核心回归/修复/验收与文档分成可审阅提交，未执行事项保持未勾选。

### 任务 7：阶段验证与两级 Git 整合

- [ ] 核心实现、Review、网页证据完成后执行一次 `npm run check` 和 web build；若覆盖率暴露核心路径缺口，补对应断言，不为了过门禁写镜像实现的测试、不降低门槛。记录结果，通过后提交完整阶段。
- [ ] 刷新远端与工作树状态，推送 `codex/ssh-workflow-terminal`，核对 Windows/Linux CI 终态；失败仅复验相关变更，未通过不合并。
- [ ] 从无冲突且无他人改动的大分支用 `git merge --no-ff codex/ssh-workflow-terminal` 整合并正常推送；达到可用终端阶段基线后，在占用 main 的工作树以 `--no-ff` 合入 `feat/ssh-workflow`，正常推送并核对双平台 CI。合并树相同沿用已通过基准，有冲突解决则验证实际受影响部分，不反复跑相同全量测试。
- [ ] 若采用 PR，标题/正文描述最终交付行为与验证范围，使用普通 merge 保留历史，创建后附加到当前任务。核对小分支 tip 被大分支和 main 包含且无工作树占用后，才清理已合并小分支；保留 `feat/ssh-workflow`，不 squash/rebase/强推。
- [ ] 更新路线图的终端实施状态和真实验收边界；接着推进整项目剩余范围中的向导、资源面板、设置及 M6，不能将本计划完成视为整项目 goal 完成。

## 自查结论

2026-10-04：设计 1–8 节分别覆盖任务 1–7；目标/协议类型、池 guard 与前端布局接口已对照现有源码核对。五项 Review Focus 均有明确所属实现任务和任务 6 的核心断言；固定参数已逐项列出。测试顺序遵循用户要求，计划本身不派代理、不预建产品空目录、不安装依赖。书面计划审阅通过后再进入实施。
