# 原生会话管理实施计划

> 使用 subagent-driven-development 分配不重叠任务，主控整合并审查。用户已授权延续主线开发、分支与本地提交；模型及推理强度继承当前会话，不推送。

**目标：** 在现有项目侧栏接通各 CLI 已支持的原生管理操作，完成会话浏览、继续、整理的主流程。

**架构：** 复用原生 provider、会话锁、确认与分叉对话框；当前项目树保持不变，Codex 已归档列表按需展开。接口统一到 `/api/projects`，不保留无人使用的会话路由别名。

**技术栈：** React、Ariakit、TanStack Query、Fastify、zod、现有 CLI SDK/RPC 与 Vitest。

**设计依据：** [产品需求 F2/F3](../../product/requirements.md)、[原生对话边界](../../engineering/native-dialogue.md)。

## 全局约束

- 仍以原生 CLI 为核心，插件和 SSH 不在本轮范围。
- Claude 支持重命名、删除、分叉；Codex 另支持归档和恢复；Antigravity 没有已接入的管理接口，不伪造实现。
- 删除必须单独确认，运行或管理期间禁止对同一会话再次操作；原生写入发出后不能把网络取消说成回滚。
- 项目/CLI/原生 id 全程一起定位，未知参数拒绝；复制历史或直接改原生文件都不作为替代路径。
- 验证仅用临时数据、合成 SDK/RPC 和隔离服务，不删除真实会话，不发送真实模型请求。

## 审查重点

1. 非当前项目行的动作是否仍作用于该行自己的项目。
2. 归档列表是否错误露出继续/重命名/分叉入口，恢复后是否刷新两类列表。
3. 运行中或等待原生响应时是否可能重复删除、分叉或丢失当前控制。
4. 切项目后的迟到操作是否会错误切回原项目；同名不同 CLI 的会话是否混淆。
5. Antigravity 是否被当作 Claude/Codex 展示不支持的管理动作。

## 任务 1：统一原生会话接口

文件：`apps/server/src/http/sessions.routes.ts`、对应 sessions/session-fork 路由测试、`scripts/dev/e2e-terminal.ts`。

接口：GET 列表 `/api/projects/:id/sessions?agent=...&archived=true`；GET 历史 `/api/projects/:id/sessions/:agent/:sessionId`；POST 动作与分叉在同一历史路径下追加 `/actions`、`/fork`。

- [x] 先更新路由行为测试验证新路径、归属、删除确认、未知参数和失败 no-store；观察旧实现失败。
- [x] 将动作的 agent 从查询迁入路径，拒绝未知查询参数；删除旧 `/api/workspaces/.../sessions` 别名。
- [x] 保留既有互斥与不确定写入语义，更新使用旧列表路径的受控脚本；运行相关测试。

## 任务 2：接通侧栏管理

文件：`apps/web/src/app/Sidebar.tsx`、`features/sessions` 的菜单/管理/分叉/归档界面、`features/chat/chat-store.ts`、`lib/api.ts`、关联行为测试。

接口：API 动作/分叉调用任务 1 的新路径，现有 `manageSession` 与 `forkSession` 继续管理占用、结果核验与列表失效。

- [x] 在实际侧栏复用原生菜单与对话框，按 CLI 和归档状态仅展示支持的动作；不引入另一套平行会话列表或无需求的本地置顶功能。
- [x] 每项目按需打开 Codex 已归档会话，显示加载/错误/空态；归档条目仅恢复或确认删除，恢复后可在正常列表继续。
- [x] 覆盖真实调用载荷、删除确认、分叉选中、归档恢复、Antigravity 无无效入口及忙时禁止操作；只补核心回归。
- [x] 删除/归档当前会话时清除模型和强度覆盖；分叉仅在源项目仍为当前项目且选择代次不变时选中新记录，其他情况只刷新来源。
- [x] 更新相关旧路径断言，运行关联前端测试与类型/代码检查。

## 任务 3：整合记录与验证

- [x] 独立审查接口与界面交叉点，修复发现的问题并定向复验。
- [x] 使用合成后端验证页面操作、焦点和不串项目；不触碰原生会话。
- [x] 更新需求/交互/路线图实际状态，归档已经完成的旧计划到 Git 追溯，检查链接和格式。
- [x] 按可审阅阶段提交，并 `--no-ff` 合回 `feat/native-cli-workbench`，清理合入的小分支。

## 交付记录

实现提交为 `bd503b1`，通过 `a3e29ab` 合入 `feat/native-cli-workbench`，合并后代码与已验证版本一致。小分支 `feat/native-session-management` 已删除；大功能分支保留，未推送远端。验证范围见[路线图](../../roadmap.md#m2-验证重点)。
