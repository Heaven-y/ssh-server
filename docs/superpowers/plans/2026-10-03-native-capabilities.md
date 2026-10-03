# 原生能力接入实施计划

使用 subagent-driven-development 在本会话分工、review 与集成，用户已授权合理决定与阶段提交。

目标：接入技能/命令选择、原生模型建议、上下文状态和手动压缩。
架构：公共能力契约 + 短生命周期目录发现 + 同实例验证调用 + 原生事件映射；沿用 TurnManager 和现有界面。
技术栈：现有 TypeScript、Fastify、React、Claude SDK、Codex app-server。
设计：[原生能力设计](../specs/2026-10-03-native-capabilities-design.md)。

## 全局约束与 review 重点

- 中文、UTF-8/LF；功能分支继续，不动 .pi/、不推送，不清理此前被拒的目录。
- 前端只传能力ID；原生实例发送前重新验证 skill/命令，拒绝过期、禁用与歧义，不静默降级。
- 默认模型/effort不覆盖；仅使用原生上下文统计，Codex不用累计total或配置窗口推比例。
- compact要已有会话，成功必须原生确认；Claude result success/历史失败文本都不是成败依据。
- 普通输入仍可用；目录部分失败不抹掉可用数据；发现、消息流、RPC均有退出/取消边界。
- 按核心review后补必要测试，保留既有126项验证基准，只复验实际影响范围。

## 任务与所有权

1. 主线程先固定 shared capabilities/context/compaction/selection 类型，agents/capability-types.ts 私有目录与Invocation契约，AgentTurnInput.invocation；chat.send增加selection并允许仅技能输入。完成跨任务接口检查。
2. Codex实现者仅 agents/codex/ 与相应tests：discoverCodexCapabilities、同实例技能校验、显式skill输入、compact轮次生命周期、usage/compaction映射；维持已有历史/普通轮次行为。
3. Claude实现者仅 agents/claude-* 及辅助模块/相应tests：discoverClaudeCapabilities、单消息输入流、同Query前置校验、summary控制查询、手动/自动压缩事件；queryFn测试注入兼容按实际新契约更新。
4. 前端实现者负责features/chat、lib/api、SettingsDialog缓存失效与对应tests：能力搜索/选择、模型候选、上下文卡、压缩状态，完整选择代次与管理pending保护。不改shared与后端。
5. 主线程负责能力service/HTTP、TurnManager解析准备、main接线；各实现核心完成后独立review，再补核心测试。执行定向检查、真实受控协议/网页验收，必要真实GLM仅用指定隔离配置；同步主文档与验收记录，阶段提交。

## 固定接口

- shared `CapabilitySelection={id}`、`AgentCapabilities={agent,entries,models,warnings}`、`AgentCapability`、`AgentModel`、`ContextUsage`、`CompactionState`；AgentEvent增加 context/compaction。
- 私有 `NativeInvocation = {kind:'skill',name,path?} | {kind:'command',name:'compact'|'context'}`；`NativeCapabilityCatalog.entries`在公共项上增加可选invocation，HTTP必须剥离。
- 各 discover 返回 NativeCapabilityCatalog；Codex签名 `(dir, options?:CodexRuntimeOptions)`，Claude签名 `(dir, options?:{signal?})`；实际调用再验证而不是只信目录读取。
- `GET /api/workspaces/:id/agent-capabilities?agent=`；网页 `api.agentCapabilities(ws,agent,signal?)`，queryKey为 `['agent-capabilities',ws,agent]`。
- `chat.send.selection?`；后端prepare解析ID或原生slash前缀，返回text/NativeInvocation，传给原适配器；普通文本无选择且无slash前缀不做额外目录发现。
- context事件 `{type:'context',usage:ContextUsage|null}`；compaction事件 `{type:'compaction',state:CompactionState}`。读取历史沿用原生边界，不生成旧token占用。
