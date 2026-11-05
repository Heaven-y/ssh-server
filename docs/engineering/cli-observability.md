# CLI 用量与执行轨迹能力评估

核对于 2026-11-06，代码基线 `bd8f617`。这是能力与实现缺口评估，不表示新增界面已经交付。本次只读本机程序、协议和隔离夹具，没有发送模型请求或读取用户会话正文。

## 对齐的 DSH 体验

本机 DSH 0.2.2-rc.1 的 Trajectory 是按轮次和步骤组织的事件表、时间概览及记录检查器，覆盖消息、工具、子调用、压缩、输入输出、用量和耗时。它不是单纯的会话分支树。

DSH 的生成速度同时依赖提供方输出 token 数与首个 token 至完成的计时；另有首 token 延迟、模型时间、工具时间和全日志汇总。其数据来自自己维护的会话日志。工作台应复用各 CLI 的原生记录，不能为了照齐统计补造一份完整 transcript。

依据为安装包中的 `@deepseek-ai/dsh-client-ui-trajectory/README.zh.md`、`@deepseek-ai/dsh-session-stats/README.zh.md`，以及 chat 客户端的计时投影。本次只参考交互和指标定义，不复制插件实现。

## 能力对照

| 内容 | Claude Code | Codex | Antigravity |
|---|---|---|---|
| 当前上下文 | 已接原生 summary 估计，可展示用量、窗口和百分比 | 已接最近 tokenUsage 与窗口，可计算最近报告的占比 | stream-json 没有等价字段；内部上下文 RPC 有字段契约，尚待生成数据验证 |
| 输入、输出、缓存 token | result/流事件可取得；当前 mapper 未保留 | tokenUsage 提供分项；当前只保留最近总量 | result 和 step_update 可报告 usage；当前未接 |
| tok/s | 可做回合平均；流式生成速度只能按接收时间近似 | 计数连续时可做回合平均；公共事件不足以直接取得精确解码速度 | 可评估步骤均速；续接结果的累计范围需先核实 |
| 首段文字延迟 | 可由本机发送与首个文字 delta 计时 | 可由首次 agentMessage delta 计时 | 可由首次 agent_response.text_delta 计时 |
| 实时执行轨迹 | 已有主线程工具、审批、公开思考与压缩事件，可补进度与子代理 | 已有部分工具与公开推理，可扩计划、搜索和子代理等类型 | 已有工具与文字步骤，可补步骤用量、耗时和子代理字段 |
| 原生历史轨迹 | 官方历史接口可读主线程消息与工具；子代理有独立读取接口 | 官方 thread/turn/item 接口可读，有可选原生时间 | 内部 GetCascadeTrajectory 已读出隔离合成历史；应用回放仍未实现 |
| 旧会话精确速度 | 历史不含完整流计时/result，不能保证恢复 | 当前 thread/read 不含每轮 tokenUsage，不能保证恢复 | 取决轨迹是否实际保存相匹配的用量与计时；未证明普遍可恢复 |

## 计量规则

- 输出 token、输入 token、缓存 token 与上下文占用是不同指标，不能把它们混成一个数。累计使用量不能除以模型窗口冒充上下文占比。
- “回合平均输出速度”按本轮输出 token 与整轮耗时计算，包含工具、审批和等待；与 DSH 的生成阶段速度分开。只有输出计数范围和计时范围一致时显示。
- 实时接收时间受缓冲、网络和 CLI 转发影响。没有可靠 token 计数时隐藏速度，不用字符数或 delta 包数代替 token。若使用 tokenizer，应明确标记估算。
- 同一原生响应的累计 usage 只更新最新值；会话累计量取差前核对基线、恢复和重置。无法取得基线时不追认本轮增量。
- 公开推理与输出总量可能存在包含关系，不能简单相加。费用只在原生报告且范围明确时显示，不为自定义服务套用固定价格表。
- 工具、模型和子代理可并行，时间线应保留重叠，不能将各项耗时相加当作墙钟总时长。历史没有时间戳时保留步骤顺序，不生成虚构时间条。
- 本机计时属于当前运行的遥测；旧会话能恢复多少以原生历史为准。若以后保存补充计时，也只能保存关联 ID 与指标，不复制对话和工具正文。

## Claude 的接入点与限制

本机 CLI 2.1.317、SDK 0.3.286。`result.usage` 表示本回合主循环用量；`modelUsage` 与 `total_cost_usd` 是会话累计，可能包含子代理、压缩和辅助请求。思考 token 若报告通常属于输出量的子集。

`stream_event.message_delta.usage.output_tokens` 按单个 API 响应累计；`assistant.message.usage` 可保留早期占位值，且同一消息会分块重复出现，不能逐条相加。`duration_api_ms` 含 API 等待，不能直接当纯解码时长。首条完整助手消息、message_start 与首个可见文字的计时含义也不同。

当前上下文使用 `getContextUsage({detail: 'summary'})`，结果是原生估计；`rawMaxTokens` 还需按原生策略解释。full 模式可能调用 token-count API，不作为每帧自动采样。原生 result 到达时应先截止本轮计时，再读取上下文，避免把控制查询额外耗时算入回合。

当前 [事件映射](../../apps/server/src/agents/claude-mapper.ts) 丢弃 usage、工具进度、任务通知和子代理。历史公开 thinking 块也没有映射。本机 SDK 历史投影未保留部分顶层 system 压缩字段，既有合成压缩回放测试不能替代真实历史验证。

## Codex 的接入点与限制

本机 CLI 0.166.0，已生成协议 schema 并与已有隔离 schema 核对一致。`thread/tokenUsage/updated` 提供 total、last 和可空 modelContextWindow；分项有 inputTokens、cachedInputTokens、cacheWriteInputTokens、outputTokens、reasoningOutputTokens、totalTokens。last 不能默认解释为整个用户回合的用量。

Turn 提供 durationMs 和起止时间；ThreadItem 有可选 startedAtMs/completedAtMs，命令/MCP 等也可提供耗时。文本 delta 不含 token 计数或逐 token 时间戳；tokenUsage 通知也没有 itemId，因此不能直接得到每条助手消息的精确生成速度。

当前 [Codex mapper](../../apps/server/src/agents/codex/mapper.ts) 只映射命令、文件改动、MCP 三类工具。可按原生类型扩展 plan、webSearch、dynamicToolCall、collabAgentToolCall、subAgentActivity 等；父线程与 forkedFromId 可另用于关系视图。原生公开 summary/content 可以展示，不表示完整隐藏推理。

当前 Thread/Turn 历史结构没有 tokenUsage，不能靠 thread/read 重建旧轮次速度。account/usage/read 依赖账单路由可用，不是通用离线历史来源；Internal-only 的原始响应通知不能当稳定公开接口使用。历史分页接入也需与现有全量读取区分。

## Antigravity 的接入点与限制

本机 CLI 1.5.1。公开 headless result.usage 有 input_tokens、output_tokens、thinking_tokens、cache_read_tokens、total_tokens，另有 duration_seconds。step_update 在已知时可带 usage 和 duration_seconds，step_index 和状态可用于步骤归属。

官方说明同进程多条 stream 输入时结果累计；当前工作台每轮新进程并用 conversation 续接，这一路径是否含旧会话用量尚未验证。实现前应先证明统计范围，不能把每次 result 的值直接相加。

内部轨迹的 generatorMetadata 可包含 chatModel.chatStartMetadata.contextWindowMetadata；StreamAgentStateUpdates 的 contextWindowUsage 也定义了 estimatedTokensUsed、maxContextTokens、tokenGroups 和压缩后的估计。字段契约已经找到，真实生成时的存在性与更新仍待验证。TUI statusLine 的上下文字段不能直接认定在 headless 中触发。

内部 chatModel 还定义了 usage、timeToFirstToken 和 streamingDuration，可能支持生成完成后的速度与首 token 延迟。仍需核对各提供方实际是否填充、是否包含思考和重试，以及用量与计时是否对应同一次生成，不能仅凭字段存在宣称精确速度已经可用。

本轮复制既有合成数据库到隔离目录，用 GetCascadeTrajectory 读到已完成的 USER_INPUT 与 PLANNER_RESPONSE，源数据库摘要未变。这证明历史存在可用入口，不能再归结为“原生完全无法读取”；但该夹具没有用量、上下文及完整工具元数据，尚不足以宣称完整回放。正式适配需复用现有目录和身份校验，只读映射已核验步骤，未知类型保留明确边界。该入口仍是内部协议。

## 建议顺序

1. 统一当前上下文条与回合统计；保留数字来源、采样时间和统计范围，无数据隐藏字段。优先接 Claude/Codex 的原生分项，Antigravity 先接能够确认归属的步骤数据。
2. 增加“对话 / 轨迹”切换，主区按轮次展示工具步骤；右侧按需打开记录详情。两种视图共享会话身份与事件，不另建会话副本。
3. 扩展原生历史、子代理和步骤时间线；单独验证 Antigravity 内部历史/上下文适配。精确历史速度只在原生证据完整时出现。

这三步是根据本次核对给出的建议，尚未实施，也未把尚未验证的内部字段作为产品承诺。

## 证据入口

- Claude：[SDK 用量](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)、[类型参考](https://platform.claude.com/docs/en/agent-sdk/typescript)、[流事件](https://platform.claude.com/docs/en/build-with-claude/streaming)，以及本机 SDK 类型与实现。
- Codex：本机 `app-server generate-json-schema` 的 0.166.0 schema；官方 app-server 页面本次返回 403，未用该页面证明字段含义。
- Antigravity：[headless](https://antigravity.google/docs/cli/headless/)、[statusLine](https://antigravity.google/docs/cli/statusline)、本机 protobuf 描述和隔离 GetCascadeTrajectory 读取。
- 当前数据入口：[Claude 上下文](../../apps/server/src/agents/claude-query.ts)、[Antigravity 映射](../../apps/server/src/agents/antigravity/mapper.ts)、[前端上下文状态](../../apps/web/src/features/chat/ContextStatus.tsx)、[事件归并](../../apps/web/src/features/chat/chat-reducer.ts)。
