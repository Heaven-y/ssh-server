# 原生 CLI 会话工作台 M1（外壳）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有「同步 + 版本 + 双端镜像」的产品剥掉，换成一个能列出并读取本机三套 CLI 原生会话的只读工作台外壳。

**Architecture:** 保留 SSH、终端、资源、Slurm、远端文件这半边地基，删除同步、版本、本地文件镜像与 Agent→SSH 的 MCP 桥。领域模型从「本地目录 + 远端目录 + 同步策略」收敛为「项目目录 + 可选服务器绑定」。会话层引入统一的 `AgentAdapter` 探测与会话枚举，Antigravity 通过只读打开它的 SQLite 元数据表拿会话列表。前端外壳按项目/会话/服务器面板三段重写。

**Tech Stack:** Node.js 22（内置 `node:sqlite`）、TypeScript、Fastify、zod、React 19、Vite、Tailwind 4、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-03-native-cli-workbench-design.md`

## Global Constraints

- 版本策略：驱动本机 PATH 上的 `claude`、`codex`、`agy`，不打包、不锁定、不做包内兜底；按能力探测而非版本号判断。
- 请求策略：M1 全程只允许「第一层探测」——`--version`、`--help`、`codex app-server generate-json-schema`、读文件、`fs.watch`。不读能力目录，不发任何模型请求。
- 单一真相：网页不存会话正文。`session-index.json` 只存簿记字段（id、agent、projectId、标题、时间、归属目录）。
- 删除即删除：同步、版本、本地文件镜像、MCP 桥、`policy/` 不留开关与兼容路径。
- 回复、文档、注释、提交信息使用中文；提交使用 `type(scope): 中文摘要`。
- 分支：全部任务在 `feat/native-cli-workbench` 上以独立提交推进，不为单个任务另开小分支。合并 `main` 需用户授权。
- 每个任务结束时 `npm.cmd test` 中与本任务相关的用例必须通过；全部任务结束后 `npm.cmd run check` 必须整体通过。
- 仓库公开：测试与文档中不出现真实服务器地址、端口、用户名、密钥；示例用 `my-server`、`~/projects/demo`。

## Review Focus

以下五类输入/失败模式是规格隐含、但容易被实现者忽略的，各自在对应任务的测试中钉死：

1. **旧配置里带 `sync` / `policy` / `localDir` 字段的工作区** —— 一次性导入后必须能正常打开并显示，不能因字段缺失或改名而报错或丢项目。
2. **CLI 从未安装或会话目录不存在**（新机器、`~/.gemini` 尚未生成）—— 列表显示「未安装 / 无会话」，页面不崩、不抛未捕获异常。
3. **Antigravity 的 `workspace_uris` 为空、非 `file://`、或指向不存在的路径** —— 标为「未归属」，绝不塞进第一个项目。
4. **会话标题为空字符串或只有空白** —— 界面显示占位文案，不出现 `undefined` 或空白行。
5. **某个 CLI 升级后 `--help` 缺了关键 flag** —— 该 CLI 单独标记「接口变化」并说明缺哪项，其余两个照常可用。

---

## File Structure

```text
packages/shared/src/
├─ workspace.ts          改：Workspace 收敛为 { id, name, dir, server?, remoteDir? }
├─ session.ts            新建：SessionSummary / SessionRef / 探测状态类型
├─ index.ts              改：删掉 sync、policy、files、versions、turn-changes 导出
└─ （删）sync.ts、policy.ts、files.ts、versions.ts、turn-changes.ts、turn-files.ts

apps/server/src/
├─ main.ts               改：删掉同步、版本、文件、MCP 桥的装配
├─ agents/
│  ├─ types.ts           改：加入 AgentProbe 类型
│  ├─ probe.ts           新建：统一探测（版本 + flag 能力 + 凭据状态）
│  ├─ claude/、codex/    保留，仅调整会话枚举的归属字段
│  └─ antigravity/
│     ├─ summaries.ts    新建：只读打开 conversation_summaries.db
│     └─ sessions.ts     新建：SessionProvider 实现，列表走 SQLite
├─ sessions/
│  └─ ownership.ts       新建：三个 CLI 统一的隶属裁决（cwd / workspace_uris）
├─ workspaces/
│  ├─ store.ts           改：按新 Workspace 校验
│  └─ import.ts          新建：一次性导入旧配置
└─ http/
   ├─ projects.routes.ts 新建：项目增删改查
   ├─ sessions.routes.ts 改：按项目列会话
   └─ probe.routes.ts    新建：只读探测结果

apps/web/src/
├─ app/
│  ├─ App.tsx            改：三段布局
│  ├─ TopBar.tsx         改：项目名 + 服务器 + 主题 + 设置
│  ├─ Sidebar.tsx        新建：项目树与按 CLI 分组的会话
│  ├─ SessionPane.tsx    新建：会话头 + 只读时间线
│  └─ ServerDock.tsx     新建：右侧服务器面板容器
└─ features/
   └─ sessions/          新建：列表、只读时间线、CLI 徽标
```

---

## Task 1: 删除同步、版本、本地文件三个域

**Files:**
- Delete: `apps/server/src/sync/`（整个目录）、`apps/server/src/vcs/`、`apps/server/src/files/`
- Delete: `apps/server/src/workspaces/setup/`（双端向导，依赖同步）、`apps/server/src/workspaces/removal.ts`、`removal-resources.ts`（删项目的阻断逻辑全部由同步与待恢复文件任务推导而来，新模型下删项目只是删一条配置）
- Delete: `apps/server/src/http/sync.routes.ts`、`versions.routes.ts`、`files.routes.ts`、`workspace-setup.routes.ts`
- Delete: `apps/web/src/features/sync/`、`versions/`、`changes/`、`files/`、`workspaces/setup/`、`workspaces/WorkspaceForm.tsx`、`workspaces/WorkspaceSidebar.tsx`、`workspaces/WorkspaceRemoveDialog.tsx`、`workspaces/removal-client.ts`
- Delete: `apps/server/tests/sync/`、`vcs/`、`files/`；`apps/server/tests/workspaces/setup.test.ts`、`setup-review.test.ts`、`removal.test.ts`、`removal-review.test.ts`、`directory-order.test.ts`
- Delete: `apps/web/tests/features/sync/`、`versions/`、`changes/`、`files/`、`workspaces/setup.test.tsx`、`setup-directory.test.tsx`、`removal.test.tsx`
- Keep untouched: `apps/web/src/features/workspaces/` 下的会话相关文件（`session-fork.ts`、`session-links.ts`、`session-preferences.ts`、`SessionList.tsx`、`SessionGroup.tsx`、`SessionMenu.tsx`、`SessionActionsDialog.tsx`、`SessionForkDialog.tsx`、`use-session-link-copy.tsx`）——它们与同步无关，Task 10 会迁到 `features/sessions/`
- Modify: `apps/server/src/main.ts`、`apps/web/src/app/*.tsx`（移除对上述模块的引用）
- Modify: `apps/server/package.json`、`apps/web/package.json`（移除无用依赖）

**Interfaces:**
- Consumes: 无
- Produces: 后端不再有 `sync`/`versions`/`files` 服务实例；后续任务可以直接假设这四处不存在

- [ ] **Step 1: 记录删除前的基线**

Run: `npm.cmd run typecheck`
Expected: 通过。若不通过，先解决基线问题再动手。

- [ ] **Step 2: 删除后端三个域的目录与路由**

删除上述 `apps/server/src/` 下的目录与四个路由文件，然后从 `main.ts` 中移除对应 import 与装配代码（`createSyncManager`、`createVersionsService`、`createWorkspaceFilesService`、`createWorkspaceSetup`、`createWorkspaceRemoval`、`createWorkspaceRemovalResources`、`registerSyncRoutes`、`registerVersionRoutes`、`registerDiscardRoutes`、`registerFileRoutes`、`registerWorkspaceSetupRoutes`，以及 `removal` 传给 `buildApp` 的参数）。

- [ ] **Step 3: 修复被牵连的调用点**

`chat/turn-manager.ts` 里对 `sync`、`changedPaths` 的依赖一并删除（对应构造参数、调用与类型）。`ssh/profiles.ts` 里对 `activity`/`removal` 的引用删除——服务器档案管理不再需要「共享工作区影响」检查。`http/app.ts` 里删掉 `removal` 依赖。`workspaces.routes.ts` 里删掉 setup 与 removal 相关分支——这个文件在 Task 9 会被 `projects.routes.ts` 取代，此处只需让它编译通过。

- [ ] **Step 4: 删除前端 feature 目录与引用**

删除上面列出的前端目录与文件，移除 `app/` 下 `App.tsx`、`TopBar.tsx`、`CommandPalette.tsx`、`WorkspacePanels.tsx`、`WorkspaceTools.tsx` 中对它们的引用。这一步骤只求编译通过，布局的正式重写在 Task 12（原文中的 Task 10）。

- [ ] **Step 5: 移除无用依赖**

从 `apps/web/package.json` 删除 `@pierre/diffs`。Run: `npm.cmd install`

- [ ] **Step 6: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过。若报「找不到模块」，说明还有引用没清干净，按报错逐个删除。

- [ ] **Step 7: 全量测试**

Run: `npm.cmd test`
Expected: 通过（被删目录的用例随之消失）。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "refactor(server): 删除同步、版本与本地文件镜像三个域" -m "- 移除 sync、vcs、files 目录与其路由
- 移除前端对应的 feature 与 @pierre/diffs 依赖
- 保留 SSH、终端、资源、Slurm、远端文件"
```

## Task 2: 删除 MCP 桥与 policy 域

**Files:**
- Delete: `apps/server/src/remote-tools/`、`apps/server/src/policy/`
- Delete: `apps/server/src/http/internal.routes.ts`、`apps/server/src/http/workspace-policy.routes.ts`
- Delete: `apps/server/tests/remote-tools/`、`apps/server/tests/policy/`、`apps/web/tests/features/workspaces/policy.test.tsx`、`apps/server/tests/workspaces/policy.test.ts`
- Modify: `apps/server/src/main.ts`、`apps/server/src/workspaces/policy.ts`（删除）
- Modify: `apps/web/src/features/workspaces/WorkspacePolicyDialog.tsx`、`WorkspacePolicyForm.tsx`、`use-workspace-policy.ts`（删除）
- Modify: `packages/shared/src/policy.ts`（删除）、`packages/shared/src/index.ts`（移除 policy 导出）

**已完成，不要再做**：`sync_now` 工具、`formatExecResult` 的 `r.sync` 分支、`agents/instructions.ts` 里「执行前同步 / 使用 sync_now」两句、`claude-runtime.ts` 工具白名单里的 `sync_now`，均在 Task 1 的修复轮中删除。`scripts/dev/e2e-m1.ts` 也已删除——它的重写属于 Task 9 之后的新工作，**不要还原**。

**Interfaces:**
- Consumes: Task 1 的清理结果
- Produces: 后端没有 `/internal/*` 路由，没有命令黑名单；`WorkspacePolicy` 类型不复存在

- [ ] **Step 1: 删除目录与路由**

删除 `remote-tools/`、`policy/` 两个目录，删除 `internal.routes.ts`、`workspace-policy.routes.ts`、`workspaces/policy.ts`，从 `main.ts` 移除 `registerInternalRoutes`、`registerWorkspacePolicyRoutes` 与相关装配。

- [ ] **Step 2: 删除前端策略编辑入口**

删除 `WorkspacePolicyDialog.tsx`、`WorkspacePolicyForm.tsx`、`use-workspace-policy.ts`，以及 `WorkspaceSidebar.tsx` 等处对它们的引用。

- [ ] **Step 2b: 清理 shared 的 policy 协议**

删除 `packages/shared/src/policy.ts`，从 `index.ts` 移除 policy 相关导出。`apps/server/src/workspaces/store.ts` 与 `WorkspaceInputSchema` 若仍引用 `WorkspacePolicySchema`，一并删除该字段（Task 4 会彻底改写校验，此处只求不引用）。

- [ ] **Step 2c: 清掉 tasks.ts 的 removal 残留**

`apps/server/src/remote-files/tasks.ts:217` 的 `blockers()` 已无调用方，且仍 import `WorkspaceRemovalBlocker`。删除 `blockers()`、它的 import，以及 `sync_pending`/`syncRequired` 的判断分支；`packages/shared/src/workspace-removal.ts` 一并删除并从 `index.ts` 移除导出。

- [ ] **Step 2d: 删除网页自带的工具策略层**

设计 §6.1（`design.md:174-184`）要求：审批面由 CLI 自己的原生配置决定，网页不加自己的规则。现有代码有两处网页自带策略，一并删除：

- `apps/server/src/agents/claude-runtime.ts` 的 `ALLOWED_TOOLS`（预放行 Read/Glob/Grep/TodoWrite）与 `allowedTools` 选项。
- 同文件 `permission()` 里对工作区内 Edit/Write 的自动放行分支，以及随之失效的 `EDIT_TOOLS`、`editTarget`、`isInsideDir`。

`canUseTool` 保留——它仍是「把 CLI 决定要问的东西弹给网页」的通道，只是不再含网页自己的判断。审批、超时、中断逻辑不变。

- [ ] **Step 2e: 一并删除 MCP 桥的令牌租约链**

这条在计划初稿里漏了，但删路由而不删它等于留一条指向 404 的注入链。删除：`chat/registry.ts`、`AgentTurnInput.acquireEnv` / `TurnEnv`、`TurnManagerDeps.registry` / `internalUrl`、`ClaudeRuntime` / `CodexRuntime` 的 env 租约、Codex 的 `mcp_servers.*` 与 `shell_environment_policy.*` 注入与 MCP 确认分支、`instructions.ts` 的 remote_exec / remote_peek 指令、`http/{app,security}.ts` 的 `/internal` 残留、`vitest.config.ts` 里 `remote-tools/main.ts` 排除项与 `policy/**` 覆盖率阈值。前端 `ToolCard.tsx` 的 `remote_exec` 分支与 `timeline-model.ts` 的 `remote_peek` 一并删除。

- [ ] **Step 3: 类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过。

- [ ] **Step 4: 测试**

Run: `npm.cmd test`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor(server): 删除 Agent→SSH 的 MCP 桥与命令黑名单" -m "- 服务器面板是人的工具，不再向 CLI 注入操作工具
- 移除 /internal 路由与 policy 域"
```

## Task 3: 精简 shared 协议并按新模型定义 Workspace

**Files:**
- Modify: `packages/shared/src/workspace.ts`、`packages/shared/src/index.ts`
- Modify: `packages/shared/src/setup.ts`（**只删向导部分，不要整文件删**）
- Delete: `packages/shared/src/sync.ts`、`files.ts`、`versions.ts`、`turn-changes.ts`、`turn-files.ts`
- Create: `packages/shared/src/session.ts`
- Test: `packages/shared/tests/workspace.test.ts`（新建）、`packages/shared/tests/session.test.ts`（新建）

> **不要删 `setup.ts` 整个文件。** 它同时装着两类东西：
>
> - **已死（删）**：`WorkspaceSetupInputSchema`、`WorkspaceSetupVerifySchema`、`WorkspaceSetupCreateSchema`、`WorkspaceSetupCreate`、`LocalDirectory`、`SetupDirectoryInfo`、`WorkspaceSetupVerification`、`SetupInventory`、`WorkspaceSetupPreview`、`WorkspaceSetupResult`。
> - **仍在用（留）**：`ManualServerInputSchema`、`ManagedServerSchema`、`HostTrustConfirmationSchema` 与对应类型 `ManualServerInput`、`ManagedServer`、`HostTrustStatus`、`HostTrustConfirmation`。它们被 `ssh/targets.ts`、`ssh/pool.ts`、`ssh/profiles.ts`、`http/ssh-targets.routes.ts`、`features/ssh/ServerManagerDialog.tsx` 等大量引用。
>
> `policy.ts` 与 `workspace-removal.ts` 已由 Task 2 删除，本任务不要重复处理。

**Interfaces:**
- Consumes: 无
- Produces:
  - `WorkspaceSchema` / `Workspace` / `WorkspaceInput`：`{ id?: string; name: string; dir: string; server?: string; remoteDir?: string }`
  - `ProbeStatusSchema`：`'available' | 'missing' | 'changed' | 'credential-missing'`
  - `AgentProbe`：`{ agent: AgentKind; status: ProbeStatus; version?: string; missing?: string[]; message?: string }`
  - `SessionSummary`：`{ agent: AgentKind; sessionId: string; projectId: string | null; title: string; updatedAt: string; running: boolean }`

- [ ] **Step 1: 写失败测试 —— 新 Workspace 模型**

`packages/shared/tests/workspace.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { WorkspaceInputSchema } from '../src/workspace';

describe('WorkspaceInputSchema', () => {
  it('接受只有名称和目录的最小工作区', () => {
    const parsed = WorkspaceInputSchema.parse({ name: '示例项目', dir: 'E:\\web\\demo' });
    expect(parsed).toEqual({ name: '示例项目', dir: 'E:\\web\\demo' });
  });

  it('接受可选的服务器绑定', () => {
    const parsed = WorkspaceInputSchema.parse({ name: '示例项目', dir: '/home/dev/demo', server: 'my-server', remoteDir: '~/projects/demo' });
    expect(parsed.server).toBe('my-server');
    expect(parsed.remoteDir).toBe('~/projects/demo');
  });

  it('拒绝空名称与空目录', () => {
    expect(WorkspaceInputSchema.safeParse({ name: '  ', dir: '/tmp' }).success).toBe(false);
    expect(WorkspaceInputSchema.safeParse({ name: 'x', dir: '' }).success).toBe(false);
  });

  it('丢弃旧格式的 sync、policy、sshHost、localDir 字段', () => {
    const parsed = WorkspaceInputSchema.parse({
      name: '旧项目', dir: '/tmp/demo', sshHost: 'my-server', localDir: '/tmp/demo',
      sync: { mode: 'bisync' }, policy: { disabledRules: ['privilege'] },
    });
    expect(parsed).toEqual({ name: '旧项目', dir: '/tmp/demo' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run packages/shared/tests/workspace.test.ts`
Expected: FAIL —— `WorkspaceInputSchema` 仍是旧字段，第四个用例与第一个用例失败。

- [ ] **Step 3: 改写 `packages/shared/src/workspace.ts`**

新 schema 为 `z.strictObject({ name, dir, server?, remoteDir? })`，但**要允许旧字段被丢弃而不是报错**：用 `z.object(...)。strip()`（zod 默认行为是 strip 未知键，strictObject 会报错）。`dir` 校验为非空字符串，绝对路径由后端校验。`remoteDir` 沿用原有「以 `/` 或 `~` 开头、不含换行与 NUL」的规则。保留 `SshAuthModeSchema`、`SshHostInfo` 不动。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run packages/shared/tests/workspace.test.ts`
Expected: PASS

- [ ] **Step 5: 写失败测试 —— 探测与会话类型**

`packages/shared/tests/session.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { AgentProbeSchema, SessionSummarySchema } from '../src/session';

describe('AgentProbeSchema', () => {
  it('接受可用状态', () => {
    expect(AgentProbeSchema.parse({ agent: 'claude', status: 'available', version: '2.1.317' }).status).toBe('available');
  });
  it('接受接口变化状态并列出缺失能力', () => {
    const parsed = AgentProbeSchema.parse({ agent: 'codex', status: 'changed', version: '0.166.0', missing: ['turn/interrupt'] });
    expect(parsed.missing).toEqual(['turn/interrupt']);
  });
  it('拒绝未知 agent', () => {
    expect(AgentProbeSchema.safeParse({ agent: 'gemini', status: 'available' }).success).toBe(false);
  });
});

describe('SessionSummarySchema', () => {
  it('未归属会话的 projectId 是 null', () => {
    const parsed = SessionSummarySchema.parse({
      agent: 'antigravity', sessionId: 'abc', projectId: null, title: '示例', updatedAt: '2026-11-03T12:00:00.000Z', running: false,
    });
    expect(parsed.projectId).toBeNull();
  });
});
```

- [ ] **Step 6: 运行测试确认失败**

Run: `npx vitest run packages/shared/tests/session.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 7: 新建 `packages/shared/src/session.ts`**

导出 `ProbeStatusSchema`（四态）、`AgentProbeSchema`、`SessionSummarySchema` 与对应类型。`AgentProbeSchema` 里 `missing` 是可选字符串数组、`message` 可选字符串。

- [ ] **Step 8: 运行测试确认通过**

Run: `npx vitest run packages/shared/tests/session.test.ts`
Expected: PASS

- [ ] **Step 9: 精简 `packages/shared/src/index.ts`**

删除 `sync`、`policy`、`files`、`versions`、`turn-changes`、`turn-files` 的导出；新增 `session.ts` 的导出；`Workspace` 相关导出保持同名。

- [ ] **Step 10: 全量类型检查与测试**

Run: `npm.cmd run typecheck && npm.cmd test`
Expected: 通过。若报错，说明还有代码引用已删类型，就地删除引用。

- [ ] **Step 11: 提交**

```bash
git add -A
git commit -m "feat(shared): 收敛工作区模型并新增探测与会话类型" -m "- Workspace 改为项目目录 + 可选服务器绑定
- 新增 AgentProbe 四态与 SessionSummary
- 删除同步、策略、版本、文件相关协议"
```

## Task 4: 新工作区存储与校验

**Files:**
- Modify: `apps/server/src/workspaces/store.ts`
- Modify: `apps/server/src/ssh/profiles.ts`（`workspace.sshHost` → `workspace.server`）
- Modify: `apps/server/src/workspaces/activity.ts`（见 Step 6）
- Modify: `apps/server/src/chat/turn-manager.ts`（见 Step 6）
- Test: `apps/server/tests/workspaces/store.test.ts`
- Modify: `apps/server/src/main.ts`（`createWorkspaceStore` 的 `knownHosts` 依赖改为可选校验）

**Interfaces:**
- Consumes: Task 3 的 `WorkspaceInputSchema`
- Produces: `WorkspaceStore` 签名不变（`list/get/withSnapshot/create/update/remove`），但校验规则变为：`dir` 必须存在且为绝对路径；`server` 若提供必须已登记

- [ ] **Step 1: 写失败测试 —— 目录校验与可选服务器**

`apps/server/tests/workspaces/store.test.ts`：

```ts
it('拒绝不存在的项目目录', async () => {
  await expect(store.create({ name: '不存在', dir: 'E:\\web\\no-such-dir' })).rejects.toThrow(/不存在/);
});

it('不绑定服务器也能创建项目', async () => {
  const ws = await store.create({ name: '本地项目', dir: tempDir });
  expect(ws.server).toBeUndefined();
});

it('绑定未登记的服务器时报错', async () => {
  await expect(store.create({ name: 'x', dir: tempDir, server: 'unknown-host' }))
    .rejects.toThrow(/服务器未登记/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/server/tests/workspaces/store.test.ts`
Expected: FAIL —— 旧实现要求 `sshHost`，第一个与第二个用例失败。

- [ ] **Step 3: 改 `store.ts`**

把 `StoredWorkspacesSchema` 改为新 `WorkspaceInputSchema.extend({ id })`；`validate()` 里把 `localDir` 换成 `dir`，`sshHost` 校验改为「`server` 存在时才校验已登记」；错误信息改为「项目目录不存在」「服务器未登记，请先保存服务器档案」。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/tests/workspaces/store.test.ts`
Expected: PASS

- [ ] **Step 5: 修 `main.ts` 调用点并类型检查**

Run: `npm.cmd run typecheck`
Expected: 通过。`apps/server/src/ssh/profiles.ts:21` 的 `workspace.sshHost === alias` 必须改成 `workspace.server`，否则编译会断——`target_referenced` 这条业务规则保留，只改字段名。

- [ ] **Step 6: 清理随 removal 一起失效的活动租赁**

Task 1 删掉 `workspaces/removal` 后，`apps/server/src/workspaces/activity.ts` 的 `active()`/`exclusive()`/`close()` 在生产代码里已无调用方（只剩测试与 `turn-manager` 引用），`closing` 集合再无写入者；`apps/server/src/chat/turn-manager.ts:8` 仍 import `WorkspaceRemovalError` 只为区分两种错误。

删除 `activity.ts` 里的 `active()`、`exclusive()`、`closing` 相关代码，只保留仍被 `terminal`/`resources` 用到的部分；删除 `turn-manager.ts` 对 `WorkspaceRemovalError` 的 import 与分类，错误统一按普通错误处理。删完跑 `npm.cmd test`，把因此失效的测试用例一并删除，**不要把断言改成空断言**。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(workspaces): 项目改为本地目录加可选服务器绑定" -m "- 目录必填且必须存在，服务器改为可选
- 同步策略相关校验随域删除"
```

## Task 5: 字段级转换旧配置

**Files:**
- Create: `apps/server/src/workspaces/import.ts`
- Test: `apps/server/tests/workspaces/import.test.ts`
- Modify: `apps/server/src/main.ts`（启动时调用一次）

**已完成的前置，不要重做**：**目录级**迁移已经落地在 `apps/server/src/workspaces/migrate-legacy.ts`（测试 `tests/workspaces/migrate-legacy.test.ts`），由 `main.ts` 在 `mkdir(configDir)` 之前调用。它只负责把旧目录 `%LOCALAPPDATA%\ssh-server\` 里的 `servers.json` 与 `workspaces.json` **原样复制**到 `%LOCALAPPDATA%\AgentDeck\`：不覆盖已有文件、不删除旧目录、不转换字段。

本任务做的是**字段级**转换——把已经位于新目录里的 `workspaces.json` 从旧结构改写成新结构。两者不要合并，也不要让 `import.ts` 再去找旧路径，那是 `migrate-legacy.ts` 的职责。

**Interfaces:**
- Consumes: Task 3 的 `WorkspaceInputSchema`、`migrate-legacy.ts` 已放好的 `workspaces.json`
- Produces: `importLegacyWorkspaces(deps: { configDir: string; store: WorkspaceStore }): Promise<ImportReport>`，`ImportReport = { imported: number; skipped: number; backupFiles: string[]; message?: string }`

注意：导入**不经过** `store.create()`，因为要保留旧 `id`；它直接写文件，与 `store.ts` 的 `save()` 用同一套原子写法。

- [ ] **Step 1: 写失败测试 —— 旧字段被丢弃、文件改名为 .bak**

`apps/server/tests/workspaces/import.test.ts`：

```ts
it('把旧的 localDir/sshHost 迁成新的 dir/server', async () => {
  await writeFile(path.join(configDir, 'workspaces.json'), JSON.stringify([
    { id: 'w1', name: '旧项目', localDir: tempDir, sshHost: 'my-server', remoteDir: '~/projects/demo', sync: { mode: 'bisync' } },
  ]));
  const report = await importLegacyWorkspaces({ configDir, store });
  expect(report.imported).toBe(1);
  const list = await store.list();
  expect(list[0]).toMatchObject({ id: 'w1', name: '旧项目', dir: tempDir, server: 'my-server' });
  expect(list[0]).not.toHaveProperty('sync');
  expect(report.backupFiles).toContain(path.join(configDir, 'workspaces.json.bak'));
  await expect(readFile(path.join(configDir, 'workspaces.json.bak'), 'utf8')).resolves.toContain('旧项目');
});

it('目录已不存在的旧项目跳过并计数', async () => {
  await writeFile(path.join(configDir, 'workspaces.json'), JSON.stringify([
    { id: 'w2', name: '已删项目', localDir: 'E:\\web\\gone', sshHost: 'my-server' },
  ]));
  const report = await importLegacyWorkspaces({ configDir, store });
  expect(report.imported).toBe(0);
  expect(report.skipped).toBe(1);
});

it('没有旧文件时什么都不做', async () => {
  const report = await importLegacyWorkspaces({ configDir, store });
  expect(report).toMatchObject({ imported: 0, skipped: 0, backupFiles: [] });
});

it('旧文件不是合法 JSON 时保留原文件不迁移', async () => {
  await writeFile(path.join(configDir, 'workspaces.json'), '{ 坏掉的 json');
  const report = await importLegacyWorkspaces({ configDir, store });
  expect(report.imported).toBe(0);
  expect(report.message).toMatch(/无法解析/);
  await expect(readFile(path.join(configDir, 'workspaces.json'), 'utf8')).resolves.toBe('{ 坏掉的 json');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/server/tests/workspaces/import.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `import.ts`**

顺序必须是这样，否则会自己覆盖自己：

1. 读 `<configDir>/workspaces.json` 原始内容；`ENOENT` 直接返回空报告 `{ imported: 0, skipped: 0, backupFiles: [] }`。
2. 解析失败（不是合法 JSON 或不是数组）也返回空报告，并把原文件原样留在原地，只在 `message` 里说明「旧配置无法解析，未迁移」。
3. **先把旧文件 `rename` 成 `workspaces.json.bak`**，路径记入 `backupFiles`。不删除旧文件。
4. 再逐条把 `localDir`→`dir`、`sshHost`→`server`、其余未知字段丢弃；用 `path.isAbsolute` + `stat` 校验目录存在。目录不存在或不合法该条计入 `skipped`，不中断整体。
5. **保留原 `id`**（不要调 `store.create`，那会生成新 UUID），把结果数组直接原子写入 `workspaces.json`（写临时文件再 `rename`，与 `store.ts` 的 `save()` 同一套做法）。
6. 返回 `{ imported, skipped, backupFiles }`。

单条失败只跳过该条，绝不因为一条坏数据丢掉整个列表。

> **必须丢弃的旧字段清单（Task 2 实测提醒）**：`sync`、**`policy`**、以及任何未在新 schema 中声明的键。
>
> 这一点很关键：`StoredWorkspacesSchema` 是 strict 继承，`store.load()` 遇到任何未声明字段会抛 `WorkspaceStorageError`，表现为**整个项目列表读不出来**，而不是跳过那一条。Task 2 已把 `policy` 从 `WorkspaceInputSchema` 删除，所以旧文件里只要有一条带 `policy` 就会触发。转换时必须显式重建对象（只挑 `id`/`name`/`dir`/`server`/`remoteDir` 五个键），**不要用展开运算符保留原对象**。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/tests/workspaces/import.test.ts`
Expected: PASS

- [ ] **Step 5: 接入启动流程**

在 `main.ts` 里 `createWorkspaceStore` 之后、注册路由之前调用一次。**只有当新 `workspaces.json` 不存在时才调用**（避免每次启动都重复迁移把用户的 .bak 冲掉），并把 `ImportReport` 打进启动日志（中文，只报数量与是否有备份，不打印项目清单）。

- [ ] **Step 6: 类型检查与全量测试**

Run: `npm.cmd run typecheck && npm.cmd test`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(workspaces): 启动时一次性导入旧工作区配置" -m "- 旧 localDir/sshHost 映射为 dir/server，同步字段丢弃
- 旧文件改名为 .bak 保留，不删除
- 目录已不存在的条目跳过并计数"
```

## Task 6: Agent 探测层

**Files:**
- Create: `apps/server/src/agents/probe.ts`
- Test: `apps/server/tests/agents/probe.test.ts`
- Delete: `apps/server/src/settings/environment.ts` 及其测试（被 probe 取代）
- Modify: `apps/server/src/http/product-settings.routes.ts`（环境报告改为读 probe）

**Interfaces:**
- Consumes: Task 3 的 `AgentProbe`、`ProbeStatus`
- Produces: `createAgentProbes(deps): { probe(agent: AgentKind): Promise<AgentProbe>; probeAll(): Promise<AgentProbe[]> }`；deps 为 `{ run: ProcessRunner }`

规格 §6.1 的完整 `AgentAdapter`（含 `startTurn`、`control`、`configSurfaces`、`watchTargets`）**不在 M1 引入**：M1 只需要「探测 + 列会话 + 读历史」，其余方法等到 M2、M3 真正需要时再加，避免先写一堆空实现。M1 沿用现有 `SessionProvider`，另加 `probe`。

- [ ] **Step 1: 写失败测试 —— 四态判定**

`apps/server/tests/agents/probe.test.ts` 用假 `run` 实现：

```ts
it('版本能解析时为 available', async () => {
  const probes = createAgentProbes({ run: fakeRun({ 'claude --version': { code: 0, stdout: '2.1.317 (Claude Code)' } }) });
  await expect(probes.probe('claude')).resolves.toMatchObject({ status: 'available', version: '2.1.317' });
});

it('可执行文件找不到时为 missing', async () => {
  const probes = createAgentProbes({ run: fakeRun({}, { enoent: ['codex'] }) });
  await expect(probes.probe('codex')).resolves.toMatchObject({ status: 'missing' });
});

it('--help 缺关键 flag 时为 changed 并列出缺项', async () => {
  const probes = createAgentProbes({ run: fakeRun({
    'claude --version': { code: 0, stdout: '2.1.317 (Claude Code)' },
    'claude --help': { code: 0, stdout: '--print --output-format' },
  }) });
  const result = await probes.probe('claude');
  expect(result.status).toBe('changed');
  expect(result.missing).toContain('--permission-prompts');
});

it('启动环境缺必需变量时为 credential-missing', async () => {
  const probes = createAgentProbes({ run: fakeRun({
    'agy --version': { code: 0, stdout: '1.4.12' },
    'agy --help': { code: 0, stdout: '--print --input-format --output-format --conversation' },
  }), env: () => ({}) });
  await expect(probes.probe('antigravity')).resolves.toMatchObject({ status: 'credential-missing' });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/server/tests/agents/probe.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `probe.ts`**

- 每个 agent 声明：可执行文件名、版本号正则、**必须具备的 flag 列表**、必需的环境变量列表。
  - `claude`：`claude`，正则 `/^(\d+\.\d+\.\d+)\s+\(Claude Code\)/m`，必需 flag `--print`、`--input-format`、`--output-format`、`--permission-prompts`，无必需环境变量（它读 `~/.claude/settings.json`）。
  - `codex`：`codex`，正则 `/codex-cli (\d+\.\d+\.\d+)/`，必需 capability 为 `codex app-server generate-json-schema` 能成功输出 JSON，无必需环境变量。
  - `antigravity`：`agy`，正则 `/^(\d+\.\d+\.\d+)/m`，必需 flag `--print`、`--input-format`、`--output-format`、`--conversation`，必需环境变量 `GEMINI_API_KEY`。
- 判定顺序：找不到可执行文件 → `missing`；版本解析失败 → `changed`（`missing: ['--version']`）；必需 flag 缺失 → `changed` 并列出缺项；必需环境变量缺失 → `credential-missing`；否则 `available`。
- 全部使用短超时（5 秒）与输出上限，超时按 `missing` 处理。
- **不读能力目录，不发任何模型请求。**

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/tests/agents/probe.test.ts`
Expected: PASS

- [ ] **Step 5: 用 probe 替换 `settings/environment.ts`**

删除 `environment.ts` 与其测试，把 `product-settings.routes.ts` 的环境报告改为调用 `probeAll()`。

- [ ] **Step 6: 类型检查与全量测试**

Run: `npm.cmd run typecheck && npm.cmd test`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(agents): 统一三个 CLI 的本机探测" -m "- 只跑 --version、--help 与 codex 的 schema 生成，不触网
- 判定 available/missing/changed/credential-missing 四态
- 取代旧的运行环境检测"
```

## Task 7: Antigravity 会话枚举

**Files:**
- Create: `apps/server/src/agents/antigravity/summaries.ts`、`apps/server/src/agents/antigravity/sessions.ts`
- Test: `apps/server/tests/agents/antigravity/summaries.test.ts`
- Modify: `apps/server/src/agents/types.ts`（`NativeSessionSummary` 增加可选 `workspaceUris`）

**Interfaces:**
- Consumes: Task 3 的 `SessionSummary`
- Produces:
  - `readSummaries(dbPath: string): SummaryRow[]`，`SummaryRow = { conversationId: string; title: string; workspaceUris: string; lastModified: string; preview: string }`
  - `createAntigravitySessions(): SessionProvider`，`list()` 返回 `{ sessionId, summary, lastModified, workspaceUris }`

- [ ] **Step 1: 写失败测试 —— 只读打开与字段映射**

`apps/server/tests/agents/antigravity/summaries.test.ts` 用 `node:sqlite` 在临时目录造一个最小库：

```ts
it('读出会话 id、标题、时间与 workspace_uris', async () => {
  const dbPath = await makeFixtureDb([
    { id: 'c1', title: '示例会话', uris: 'file:///E:/web/demo', time: '2026-11-03 12:00:00' },
  ]);
  const rows = readSummaries(dbPath);
  expect(rows).toEqual([{ conversationId: 'c1', title: '示例会话', workspaceUris: 'file:///E:/web/demo', lastModified: '2026-11-03 12:00:00', preview: '' }]);
});

it('库文件不存在时返回空数组而不抛错', () => {
  expect(readSummaries(path.join(tmpdir(), 'no-such.db'))).toEqual([]);
});

it('表结构不符时返回空数组', async () => {
  const dbPath = await makeEmptyDb();
  expect(readSummaries(dbPath)).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/server/tests/agents/antigravity/summaries.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `summaries.ts`**

用 `node:sqlite` 的 `DatabaseSync`，连接串为 `file:<path>?mode=ro`（`readonly: true`），查询 `select conversation_id, title, preview, last_modified_time, workspace_uris from conversation_summaries order by last_modified_time desc`。任何异常（文件不存在、表不存在、锁冲突）都返回 `[]`，不抛。**只读，绝不写。**

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/tests/agents/antigravity/summaries.test.ts`
Expected: PASS

- [ ] **Step 5: 写失败测试 —— SessionProvider 形态**

```ts
it('空标题替换为占位文案', async () => {
  const provider = createAntigravitySessions({ readSummaries: () => [{ conversationId: 'c1', title: '   ', workspaceUris: '', lastModified: '2026-11-03 12:00:00', preview: '' }] });
  const [item] = await provider.list(tempDir);
  expect(item.summary).toBe('未命名会话');
});

it('read 明确报告历史不可读', async () => {
  const provider = createAntigravitySessions({ readSummaries: () => [] });
  await expect(provider.read('c1', tempDir)).rejects.toThrow(/无法读取/);
});
```

- [ ] **Step 6: 运行确认失败**

Run: `npx vitest run apps/server/tests/agents/antigravity/summaries.test.ts`
Expected: FAIL

- [ ] **Step 7: 实现 `sessions.ts`**

`list()` 读 summaries 并映射为 `NativeSessionSummary`（`sessionId`←`conversation_id`，`summary`←标题或「未命名会话」，`lastModified`←时间，`workspaceUris` 原样带出）。`read()` 抛 `SessionError(501, 'session_not_replayable', 'Antigravity 的会话历史以私有轨迹格式保存在本机，当前无法读取；可以继续对话。')`。`mutate()`、`fork()` 抛 `unsupported_action`。

- [ ] **Step 8: 运行确认通过**

Run: `npx vitest run apps/server/tests/agents/antigravity`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat(agents): 接入 Antigravity 的会话列表" -m "- 只读打开 conversation_summaries.db 取元数据
- 历史轨迹不可读，明确返回不可回放错误而非伪造内容
- 空标题显示占位文案"
```

## Task 8: 三个 CLI 统一的会话归属

**Files:**
- Create: `apps/server/src/sessions/ownership.ts`
- Test: `apps/server/tests/sessions/ownership.test.ts`
- Modify: `apps/server/src/chat/sessions.ts`（会话列表带上 `projectId`）

**Interfaces:**
- Consumes: Task 3 的 `SessionSummary`、Task 7 的 `workspaceUris`
- Produces:
  - `parseWorkspaceUris(raw: string): string[]`
  - `resolveProjectId(input: { cwd?: string; workspaceUris?: string; projects: Workspace[] }): string | null`

- [ ] **Step 1: 写失败测试 —— 归属裁决**

```ts
it('按 cwd 命中项目', () => {
  expect(resolveProjectId({ cwd: 'E:\\web\\demo\\src', projects: [{ id: 'p1', dir: 'E:\\web\\demo' } as Workspace] })).toBe('p1');
});

it('按 workspace_uris 命中项目', () => {
  expect(resolveProjectId({ workspaceUris: 'file:///E:/web/demo', projects: [{ id: 'p1', dir: 'E:\\web\\demo' } as Workspace] })).toBe('p1');
});

it('命中多个项目时取配置顺序靠前者', () => {
  const projects = [{ id: 'p1', dir: 'E:\\web\\demo' }, { id: 'p2', dir: 'E:\\web' }] as Workspace[];
  expect(resolveProjectId({ cwd: 'E:\\web\\demo', projects })).toBe('p1');
});

it('解析不出时为 null，不落到第一个项目', () => {
  expect(resolveProjectId({ workspaceUris: '', projects: [{ id: 'p1', dir: 'E:\\web\\demo' } as Workspace] })).toBeNull();
  expect(resolveProjectId({ workspaceUris: 'https://example.com/x', projects: [{ id: 'p1', dir: 'E:\\web\\demo' } as Workspace] })).toBeNull();
});

it('parseWorkspaceUris 兼容 JSON 数组、换行与单值', () => {
  expect(parseWorkspaceUris('["file:///a","file:///b"]')).toEqual(['file:///a', 'file:///b']);
  expect(parseWorkspaceUris('file:///a\nfile:///b')).toEqual(['file:///a', 'file:///b']);
  expect(parseWorkspaceUris('file:///a')).toEqual(['file:///a']);
  expect(parseWorkspaceUris('')).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/server/tests/sessions/ownership.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `ownership.ts`**

`parseWorkspaceUris`：先试 `JSON.parse`，结果是字符串数组就用；否则按换行/分号切分；再不行当单值；过滤空白。`resolveProjectId`：把 `cwd` 与每个 URI 转成规范化绝对路径（剥 `file://`、`decodeURIComponent`、`path.resolve`、Windows 盘符与分隔符统一、尾斜杠去掉），用「相等或以 `path.sep` 结尾前缀之外不相邻」的规则比较（复用现有 `sameSessionDirectory` 的语义），按 `projects` 顺序返回第一个命中。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/tests/sessions/ownership.test.ts`
Expected: PASS

- [ ] **Step 5: 接入会话列表**

`chat/sessions.ts` 的 `list()` 在映射为 `SessionSummary` 时调用 `resolveProjectId`，结果写入 `projectId`（未命中为 `null`）。

- [ ] **Step 6: 类型检查与全量测试**

Run: `npm.cmd run typecheck && npm.cmd test`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(sessions): 三个 CLI 统一的会话归属裁决" -m "- Claude/Codex 用 cwd，Antigravity 用 workspace_uris
- 多项目命中取配置顺序靠前者
- 解析失败标为未归属，不塞进第一个项目"
```

## Task 9: 后端项目与会话路由

**Files:**
- Create: `apps/server/src/http/projects.routes.ts`、`apps/server/src/http/probe.routes.ts`
- Delete: `apps/server/src/http/workspaces.routes.ts`（被 `projects.routes.ts` 取代，不同时保留两套）
- Modify: `apps/server/src/http/sessions.routes.ts`、`apps/server/src/http/app.ts`（`buildApp` 不再接收 `setup`/`removal`）
- Test: `apps/server/tests/http/projects.routes.test.ts`、`apps/server/tests/http/sessions.routes.test.ts`

**Interfaces:**
- Consumes: Task 4 的 store、Task 6 的 probes、Task 8 的归属
- Produces:
  - `GET /api/projects` → `Workspace[]`
  - `POST /api/projects` `{ name, dir, server?, remoteDir? }` → `Workspace`
  - `PATCH /api/projects/:id`、`DELETE /api/projects/:id`
  - `GET /api/projects/:id/sessions?agent=claude|codex|antigravity` → `SessionSummary[]`
  - `GET /api/projects/:id/sessions/:agent/:sessionId` → `SessionHistory`
  - `GET /api/agents/probes` → `AgentProbe[]`

> **PATCH 的解绑语义必须明确，否则「退回纯本地项目」在 HTTP 上不可达。**
>
> `store.update()` 用 JS 的 `undefined` 表示「清除这个字段」，但 JSON body 里没有 `undefined`——`{"server": null}` 与「没传这个键」是两件不同的事，而后者必须表示「不要动它」。
>
> 采用 **`null` 表示清除**：
>
> | 请求体 | 语义 |
> |---|---|
> | `{ "name": "新名字" }` | 只改名字，绑定与目录都不动 |
> | `{ "server": null, "remoteDir": null }` | 同时解绑两半，退回纯本地项目 |
> | `{ "server": null }` 只给一半 | **拒绝**（400），沿用 Task 4 的「同进同退」规则 |
> | `{ "server": "my-server", "remoteDir": "~/x" }` | 绑定或改绑到指定服务器 |
>
> 实现上用 `z.object({ name?, dir?, server?: z.string().nullable(), remoteDir?: z.string().nullable() })`，用 `key in body` 判断是否要更新该字段，`null` 转成 `undefined` 再交给 store。**不要**把 `undefined` 直接塞进 `Partial` 透传——那样「没传」和「传了 null」会变成同一件事，只改名字会把绑定抹掉。

- [ ] **Step 1: 写失败测试 —— 路由契约**

```ts
it('列出项目', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects' });
  expect(res.statusCode).toBe(200);
  expect(Array.isArray(res.json())).toBe(true);
});

it('创建项目后能查到', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '示例项目', dir: tempDir } });
  expect(created.statusCode).toBe(200);
  const id = created.json().id;
  const list = await app.inject({ method: 'GET', url: '/api/projects' });
  expect(list.json().some((p: { id: string }) => p.id === id)).toBe(true);
});

it('非法的 agent 参数被拒绝', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects/x/sessions?agent=gemini' });
  expect(res.statusCode).toBe(400);
});

it('探测接口在 M1 不触发能力目录', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/agents/probes' });
  expect(res.statusCode).toBe(200);
  for (const probe of res.json()) expect(['available', 'missing', 'changed', 'credential-missing']).toContain(probe.status);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/server/tests/http/projects.routes.test.ts`
Expected: FAIL —— 路由不存在。

- [ ] **Step 3: 实现路由**

按上面契约实现。项目路由复用 store 的校验错误映射（400 + 字段信息）。会话路由按项目 `dir` 调用对应适配器。探测路由调用 `probeAll()`，`Cache-Control: no-store`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/tests/http`
Expected: PASS

- [ ] **Step 5: 在 `main.ts` 注册新路由并删除旧的 `workspaces.routes.ts`**

保留服务器档案、SSH、终端、资源、Slurm、远端文件的路由不动。`buildApp` 的 `setup`、`removal` 参数随之删除，`app.ts` 里对应分支一并清掉。

- [ ] **Step 6: 类型检查与全量测试**

Run: `npm.cmd run typecheck && npm.cmd test`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(http): 项目、会话与探测路由" -m "- /api/projects 取代旧工作区接口
- 会话按项目列取，agent 参数受校验
- 探测接口只返回第一层结果"
```

## Task 10: 前端外壳骨架

**Files:**
- Create: `apps/web/src/app/Sidebar.tsx`、`apps/web/src/app/SessionPane.tsx`、`apps/web/src/app/ServerDock.tsx`
- Move: `apps/web/src/features/workspaces/` 下的会话相关文件 → `apps/web/src/features/sessions/`（`session-fork.ts`、`session-links.ts`、`session-preferences.ts`、`SessionList.tsx`、`SessionGroup.tsx`、`SessionMenu.tsx`、`SessionActionsDialog.tsx`、`SessionForkDialog.tsx`、`use-session-link-copy.tsx`），并同步移动对应测试
- Modify: `apps/web/src/app/App.tsx`、`TopBar.tsx`、`WorkspaceLayout.tsx`、`WorkspaceColumns.tsx`
- Delete: `apps/web/src/app/WorkspacePanels.tsx`、`WorkspaceTools.tsx`、`WorkspacePanelFrame.tsx`、`WorkspaceArea.tsx`、`use-workspace-navigation.ts`
- Test: `apps/web/tests/app/Sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 9 的接口
- Produces: `<Sidebar />`、`<SessionPane />`、`<ServerDock />` 三个组件；`App` 组装为「顶栏 / 左栏 / 主区 / 右侧服务器面板」

- [ ] **Step 1: 写失败测试 —— 空态与分组**

```tsx
it('没有项目时显示引导添加项目', () => {
  render(<Sidebar projects={[]} sessionsByProject={{}} onAddProject={vi.fn()} />);
  expect(screen.getByText('添加项目目录')).toBeInTheDocument();
});

it('按 CLI 分组显示会话并带徽标', () => {
  render(<Sidebar projects={[project]} sessionsByProject={{ p1: [claudeSession, codexSession] }} onAddProject={vi.fn()} />);
  expect(screen.getByText('Claude')).toBeInTheDocument();
  expect(screen.getByText('Codex')).toBeInTheDocument();
});

it('未归属会话默认不显示', () => {
  render(<Sidebar projects={[project]} sessionsByProject={{ p1: [orphan] }} onAddProject={vi.fn()} />);
  expect(screen.queryByText('孤儿会话')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/web/tests/app/Sidebar.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现 Sidebar**

项目列表 + 展开后按 `agent` 分组列会话；每条带 CLI 徽标（字母或色点）与最近活动时间；顶部「新建会话」与「添加项目」；底部「显示其他目录的会话」开关（默认关，打开后显示 `projectId === null` 的会话并按目录分组）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/web/tests/app/Sidebar.test.tsx`
Expected: PASS

- [ ] **Step 5: 实现 SessionPane 与 ServerDock，重写 App 布局**

三段式：左栏可收起（200–320px）、主区最小 480px、右侧服务器面板可收起。样式沿用现有 Tailwind 语义变量，浅色默认、深浅可切。

- [ ] **Step 6: 视觉与样式不出现回退**

Run: `npm.cmd run typecheck && npx vitest run apps/web`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(web): 重写三段式外壳与项目会话侧栏" -m "- 左栏项目树按 CLI 分组，未归属会话默认隐藏
- 右侧改为服务器面板停靠区
- 移除旧的工作区面板与工具组件"
```

## Task 11: 会话只读历史视图

**Files:**
- Create: `apps/web/src/features/sessions/SessionTimeline.tsx`、`SessionHeader.tsx`、`AgentBadge.tsx`、`use-sessions.ts`
- Test: `apps/web/tests/features/sessions/SessionTimeline.test.tsx`

**Interfaces:**
- Consumes: Task 9 的会话接口、Task 7 的「不可回放」错误
- Produces: `SessionTimeline` 渲染 `SessionHistory.events`；`SessionHeader` 显示 CLI、版本、项目路径、运行状态

- [ ] **Step 1: 写失败测试 —— 只读渲染与不可回放文案**

```tsx
it('渲染用户与助手消息', () => {
  render(<SessionTimeline events={[userEvent, assistantEvent]} />);
  expect(screen.getByText('检查这个脚本')).toBeInTheDocument();
  expect(screen.getByText('已检查')).toBeInTheDocument();
});

it('Antigravity 不可回放时显示说明而不是空白', () => {
  render(<SessionTimeline events={[]} notReplayable />);
  expect(screen.getByText(/无法读取/)).toBeInTheDocument();
});

it('空标题显示占位', () => {
  render(<SessionHeader agent="claude" title="" version="2.1.317" projectDir="~/projects/demo" />);
  expect(screen.getByText('未命名会话')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run apps/web/tests/features/sessions/SessionTimeline.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现组件**

复用现有的 Markdown 渲染（`streamdown`）与工具卡片样式；`SessionHeader` 显示实际驱动版本（来自 probe 结果）。M1 不提供输入框，底部显示「M2 接入对话」的占位说明。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/web/tests/features/sessions`
Expected: PASS

- [ ] **Step 5: 接通数据层**

`use-sessions.ts` 用 `@tanstack/react-query` 拉项目会话列表与单条历史；`notReplayable` 由接口返回的错误码 `session_not_replayable` 推导。

- [ ] **Step 6: 全量检查**

Run: `npm.cmd run typecheck && npx vitest run apps/web`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(web): 会话只读历史视图" -m "- 时间线复用既有 Markdown 与工具卡片
- 不可回放的会话显示明确说明而非空白
- 会话头显示实际驱动的 CLI 版本"
```

## Task 12: 收尾——文档、截图与全量门禁

**Files:**
- Modify: `README.md`、`docs/product/requirements.md`、`docs/product/ui-layout.md`、`docs/engineering/architecture.md`、`docs/roadmap.md`
- Modify: `docs/engineering/decisions.md`（追加本轮取舍）
- Delete: `docs/guides/ui-usability-optimization-acceptance.md` 中已失效的章节

**Interfaces:**
- Consumes: 前 11 个任务的全部产物
- Produces: 文档与实现一致；`npm run check` 通过

- [ ] **Step 1: 更新 README**

功能表按新范围重写：项目与 CLI 会话、原生配置（M3 才落地，标注阶段）、服务器面板；删掉同步、版本、本地文件的相关条目与 rclone 依赖说明。

- [ ] **Step 2: 更新架构与需求**

`architecture.md` 的总览图与模块表按新结构改写，删除 sync/vcs/files/remote-tools/policy。**必须点名改掉这三处仍在描述已删功能的正文**（Task 1 审查发现，原文未覆盖）：

- `docs/engineering/architecture.md:350-358`：仍把 `workspaces/setup` 的双端向导与绑定票据写成现行架构。
- `docs/engineering/architecture.md:429`：仍描述 `workspaces/removal` 的 SHA256 与阻断语义。
- `docs/guides/dev-environment.md:205`：仍让人运行已删除的 `e2e-m1` / `e2e-m2` 脚本。

`requirements.md` 按 M1 实际交付的功能与边界改写；`ui-layout.md` 按新三段式布局改写。

- [ ] **Step 2b: 清掉前端外壳的空槽位**

Task 1 为保住 `docked-layout.test.tsx` 暂时留下了 `files` 槽位：`apps/web/src/app/WorkspaceLayout.tsx`、`WorkspaceTools.tsx`、`WorkspacePanels.tsx` 里的 `files` 槽位、`files-column` 面板、`filesOpen` 分支与 `toolSizing` 的 files 尺寸规则。本步骤把它们和对应测试一起删掉，确保外壳里不再有任何文件面板的残留引用。

- [ ] **Step 3: 追加决策记录**

在 `decisions.md` 追加一条：本轮用「原生 CLI 会话工作台」取代「同步 + 版本」主线，记录被删能力、保留能力与替代关系，并链接设计文档。

- [ ] **Step 4: 运行完整门禁**

Run: `npm.cmd run check`
Expected: typecheck、eslint、format、docs:check、jcpd、coverage 全部通过。失败就修到通过。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "docs: 按原生 CLI 工作台重构文档" -m "- README、需求、界面、架构、路线图对齐 M1 实际范围
- 决策记录追加本轮取舍与被删能力的替代关系"
```

---

## Task 13: 移除服务器文件下载

**前置说明**：这是本轮唯一的能力收缩。用户明确不用下载，其余 SSH 能力保持与现有 ssh console 一致。**只删下载，不要顺手改动新建/重命名/移动/复制/删除**——那些要保留。

**Files:**
- Delete: `apps/server/src/remote-files/downloads.ts`
- Delete: `apps/web/src/features/remote-files/RemoteDownloadDialog.tsx`
- Modify: `apps/server/src/remote-files/service.ts`、`apps/server/src/remote-files/tasks.ts`（去掉下载任务类型与分支）
- Modify: `apps/server/src/http/remote-files.routes.ts`、`remote-file-actions.routes.ts`（删除下载路由）
- Modify: `packages/shared/src/remote-files.ts`（删除下载相关的类型与 `RemoteDownload*`）
- Modify: `apps/web/src/features/remote-files/RemoteActionToolbar.tsx`、`RemoteFilesPanel.tsx`（去掉下载入口）
- Test: `apps/server/tests/remote-files/`、`apps/web/tests/features/remote-files/` 下与下载相关的用例一并删除

**Interfaces:**
- Consumes: 无
- Produces: 后端没有任何下载路由；前端没有任何下载入口与 `showSaveFilePicker` 调用

- [ ] **Step 1: 先找全引用**

```powershell
# 服务端
Select-String -Path apps/server/src -Include *.ts -Recurse -Pattern 'download|Download' | Select-Object Path,LineNumber,Line
# 前端
Select-String -Path apps/web/src -Include *.ts,*.tsx -Recurse -Pattern 'download|Download|showSaveFilePicker' | Select-Object Path,LineNumber,Line
# 共享协议
Select-String -Path packages/shared/src -Include *.ts -Recurse -Pattern 'download|Download' | Select-Object Path,LineNumber,Line
```

把结果记进报告，确认没有漏掉的路由或界面入口。

- [ ] **Step 2: 删服务端**

删除 `downloads.ts`，从 `service.ts` 与 `tasks.ts` 移除下载任务类型、分支与校验；从两个路由文件移除下载端点。**注意保留** `operation.ts` 的其它操作类型、`path-locks.ts`、`preflight.ts`——它们服务文件增删改，不是下载专用。

- [ ] **Step 3: 删前端**

删除 `RemoteDownloadDialog.tsx`，从工具栏与面板移除下载入口，删掉 `showSaveFilePicker` 的全部用法（`RemoteDownloadDialog.tsx` 是全仓唯一一处，删完应该零处）。

验证：`Select-String -Path apps/web/src -Include *.ts,*.tsx -Recurse -Pattern 'showSaveFilePicker'` 应无结果。

- [ ] **Step 4: 删协议与测试**

从 `packages/shared/src/remote-files.ts` 删除下载相关类型与导出；删除两侧对应的测试文件/用例。

- [ ] **Step 5: 全量门禁**

Run: `npm.cmd run typecheck && npm.cmd test`
Expected: 通过。若某个测试因下载移除而失效，**删除该用例**，不要把断言改成空断言。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor(remote-files): 移除服务器文件下载" -m "- 用户明确不用下载；新建、重命名、移动、复制、删除保留
- 删除 downloads.ts、RemoteDownloadDialog 与 showSaveFilePicker 用法
- 同步精简 shared 协议与两侧测试"
```

---

## Task 14: Electron 桌面壳

**前置说明**：本任务让产品从「浏览器访问端口」变成「双击打开的应用」。**不要改动任何业务代码**——Fastify 服务原样复用，只是换个启动方式与加载方式。浏览器访问同一地址仍然可用，那是调试手段。

**Files:**
- Create: `apps/desktop/package.json`、`apps/desktop/tsconfig.json`、`apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/src/main.ts`、`apps/desktop/src/preload.ts`
- Modify: `package.json`（workspaces 已含 `apps/*`，无需改；新增 `dev:desktop` 脚本与 `electron`、`electron-vite` 依赖）
- Test: `apps/desktop/tests/main.test.ts`（启动编排的单元测试，不真的开窗口）

**Interfaces:**
- Consumes: `apps/server/src/config.ts` 的 `loadConfig` 与 `apps/server/src/main.ts` 的启动函数（若现在是 `main()` 自执行，抽出一个可复用的 `startServer(config)`）
- Produces: `npm run dev:desktop` 打开桌面窗口；窗口关闭时后端随之退出

- [ ] **Step 1: 先确认后端可被程序化启动**

读 `apps/server/src/main.ts`。当前是 `void main()` 自执行。需要把它拆成：

```ts
export async function startServer(config: ServerConfig): Promise<{ url: string; close: () => Promise<void> }>
```

`close()` 要能真正释放端口并断开 SSH 池（现有代码里应该已有 `app.close()` 与 pool 的清理路径，复用即可）。**不要改业务逻辑**，只做「把自执行的 main 拆成可调用函数 + 保留 CLI 入口」。

先写测试：调用 `startServer({ port: 0, ... })` 应返回一个能连上的 `url`，`close()` 后端口不再监听。

- [ ] **Step 2: 建 desktop 包**

`apps/desktop/package.json`：

```json
{
  "name": "@agentdeck/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "out/main.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build"
  }
}
```

依赖：`electron`、`electron-vite`（devDependencies）。根 `package.json` 加脚本：

```json
"dev:desktop": "npm run dev:desktop -w @agentdeck/desktop"
```

- [ ] **Step 3: 写主进程**

`apps/desktop/src/main.ts` 要点：

- `app.whenReady()` 里先 `startServer(...)`，拿到实际 `url`（端口用 `0` 让系统分配，避免和工作中的后端抢 4317）。
- 再 `new BrowserWindow({ webPreferences: { preload, contextIsolation: true, nodeIntegration: false } })`，`loadURL(url)`。
- `window-all-closed` 与 `before-quit` 里调用 `close()`，**确保不留孤儿进程**。
- 单实例：`app.requestSingleInstanceLock()`，拿不到锁就退出；第二次启动时聚焦已有窗口。
- 开发模式加载 Vite dev server 的地址，生产模式加载打包后的静态文件。用 `process.env.ELECTRON_RENDERER_URL` 判断（`electron-vite` 的约定）。
- **不要**在渲染层暴露 Node：`nodeIntegration: false`、`contextIsolation: true`。

- [ ] **Step 4: 写 preload**

`apps/desktop/src/preload.ts` 只暴露窄接口，本期先只留一个占位与未来扩展点：

```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('agentDeck', {
  platform: process.platform,
});
```

**不要**暴露 `ipcRenderer` 整体或 `require`。将来需要系统对话框时再逐个加具名方法。

- [ ] **Step 5: 补 CLI 路径覆盖的提示（只做后端准备，不做界面）**

设计 §1.1 承诺：PATH 继承可能让从开始菜单启动的应用找不到 CLI。本步骤只做最小准备——确认 `agents/probe.ts`（Task 6 产物）在探测失败时返回的错误里**包含可执行文件名**，界面将来据此提示。不加新的设置项。

- [ ] **Step 6: 手工验证**

Run: `npm.cmd run dev:desktop`
Expected: 打开一个窗口，看到 AgentDeck 界面；关掉窗口后任务管理器里没有残留的 node 进程。

同时验证浏览器仍可访问（`npm.cmd run dev` 起的那个地址）。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(desktop): 加入 Electron 桌面壳" -m "- 主进程启动本机服务并用窗口加载它，关窗即退出、单实例
- preload 只暴露窄接口，渲染层不开 Node 集成
- 后端 main 拆出可编程的 startServer，CLI 入口保留"
```

---

## 后续计划（不在本计划内）

M1 与 M1.5 完成后另行编写：

- **M2 对话**：回合管理按会话持有、事件缓冲与重连挂载、三个 CLI 的流式回合、审批卡片（Claude/Codex）与权限模式条（Antigravity）、软拒提示、会话级参数。
- **M3 配置与服务器**：原生配置编辑（用户级 + 项目级、掩码可展开）、启动环境增删改停用、服务器面板改以服务器档案为键、命令面板。
- **M4 打磨**：目录监听实时刷新、运行状态展示、键盘操作、CLI 升级后重新探测、安装包与自动更新、验收记录。
