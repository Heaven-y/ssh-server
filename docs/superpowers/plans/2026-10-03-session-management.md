# 原生会话管理实施计划

执行使用 subagent-driven-development。用户已授权合理决定、持续实施与阶段提交；不重复询问既定方案。

目标：通过官方接口完成会话重命名、删除和 Codex 归档恢复。
架构：复用原生 provider、HTTP 会话路由及 TurnManager 身份锁，前端按需管理对话记录。
技术栈：现有 Node.js/TypeScript/Fastify/React 与官方 SDK/app-server。
设计：[原生会话管理](../specs/2026-10-03-session-management-design.md)。

## 全局约束

- 中文、UTF-8/LF，沿用功能分支；不动 .pi/，不推送。
- 只用官方会话接口；真实测试仅操作本次合成临时记录，不读取/删除用户历史，不调用模型。
- 身份为 `(agent, sessionId)`，先校验目录再管理；删除确认必须为 true，标题 1–200 字符。
- 运行与管理操作互斥，失败释放锁；前端迟到响应不能清空别的会话。
- 测试集中放在各包 tests，只补核心边界；保留前阶段100项可靠基准，不机械全仓复测。

## 任务

1. 主线程确定 shared `SessionActionSchema` / `SessionActionInput`；`delete` 带 confirmed:true，`rename` 带 title，另有 archive/unarchive。统一 provider.mutate 与接口契约。
2. 原生实现者：仅 agents/codex/sessions.ts、index.ts、claude-sessions.ts 与相应测试。导出 `mutateCodexSession(id, dir, input, options?)`；`listCodexSessions` options 增加 archived；Claude provider增加 mutate。先验证合成原生记录可读取归档和执行官方操作，保留真实实验边界。
3. 前端实现者：SessionList、独立管理dialog组件、chat-store、lib/api及对应测试。`api.sessionAction(ws,id,agent,input)` POST `.../sessions/:id/actions?agent=`；`api.listSessions(ws,agent,archived=false)`；queryKeys归档key为普通key追加 archived，普通key可失效全部来源列表。实现状态互斥、迟到成功隔离与无障碍确认。
4. 主线程：TurnManager.withIdleSession(ref, action) 复用 sessions锁；SessionProvider.mutate(id,dir,input)，list追加第四个 archived 参数（provider为第三个）；service.mutate在withIdleSession中调用provider；HTTP校验/响应/main接线。
5. 实现后独立review并补核心测试；定向检查与真实合成原生/浏览器验证。同步需求、架构、路线图与验收，按完整阶段提交。

## 交叉接口

- Task 1输出供Task 2/3/4共用，避免客户端与原生操作另造 action 字符串。
- Task 2 provider.mutate 接收已验证的 SessionActionInput，但原生身份验证仍由 provider执行。
- Task 4构造 `createSessionsService(providers, { withIdleSession })`；在main用闭包引用随后构造的TurnManager，调用时初始化已完成。
- 保留现有read/list/assertBelongs签名，list末尾追加可选 archived，既有调用不变；服务拒绝Claude archived查询。
- Task 3在管理目标待处理期间禁止对同目标发送，服务端仍负责跨窗口和后台轮次的真正互斥。
