# CLI 用量与执行轨迹

更新于 2026-11-06。本文记录当前实现和验证边界；实施前的评估保留在 `3c8d0ac`，当时的未实现与未验证结论不追改。本轮完成界面和接线，并在用户授权后进行了隔离的小请求测试，未读取用户真实会话正文。

## 对齐的 DSH 体验

本机 DSH 0.2.2-rc.1 的 Trajectory 是按轮次和步骤组织的事件表、时间概览及记录检查器，覆盖消息、工具、子调用、压缩、输入输出、用量和耗时。它不是单纯的会话分支树。

DSH 的生成速度同时依赖提供方输出 token 数与首个 token 至完成的计时；另有首 token 延迟、模型时间、工具时间和全日志汇总。其数据来自自己维护的会话日志。工作台应复用各 CLI 的原生记录，不能为了照齐统计补造一份完整 transcript。

本项目采用“执行过程”作为轨迹主线：一轮消息下按顺序展示工具调用、文件操作、命令、状态和耗时；可取得的输入、输出、错误、审批和子调用作为步骤详情。会话归档、分支和父子关系仍属于会话管理信息，放在轨迹之外的辅助区域，不把分支树冒充执行时间线。

依据为安装包中的 `@deepseek-ai/dsh-client-ui-trajectory/README.zh.md`、`@deepseek-ai/dsh-session-stats/README.zh.md`，以及 chat 客户端的计时投影。本次只参考交互和指标定义，不复制插件实现。

当前输入框外下方显示上下文和最新一轮耗时、平均 tok/s；点击统计可展开 token 分项。开始新轮或本轮未报告时不借用旧速度，完整历史统计保留在轨迹视图。Antigravity 使用官方彩色标识。

## 能力对照

| 内容 | Claude Code | Codex | Antigravity |
|---|---|---|---|
| 当前上下文 | summary 原生估计、窗口及百分比 | 最近 tokenUsage.last 与窗口计算占比 | 打开历史时取最新完整生成记录中的估计；headless 暂无实时上下文字段 |
| 输入、输出、缓存 token | 已接 result 主循环本轮统计 | 已接 total 累计快照的可靠本轮差分 | 已接 step_update 和历史模型回复的步骤用量，不混用累计 result |
| tok/s | 已接本轮输出 / 宿主记录的整轮耗时 | 已接可靠增量 / 原生整轮耗时 | 已接公开步骤输出 / 同步骤耗时；历史用量不强配执行时间 |
| 工具耗时 | 实时调用至结果的单调时钟，标记工作台计时；原生 progress 保留 | 原生 durationMs 或同条目的完整起止时间 | 实时 duration_seconds；历史步骤起止时间 |
| 实时执行轨迹 | 主线程工具、审批、公开思考、压缩与工具进度 | 命令、文件、MCP、搜索、计划、动态工具、协作活动及图片读取 | 工具、文字、步骤统计和压缩；未知原生活动保留类型与状态 |
| 原生历史轨迹 | 官方 SDK 主线程消息与工具；完整子代理历史仍未接 | 官方 thread/turn/item，保留已有原生时间 | 已接内部轨迹 RPC；隔离合成与真实短回复历史均成功读回 |
| 旧会话精确速度 | 历史不含完整流计时/result，不能保证恢复 | 当前 thread/read 不含每轮 tokenUsage，不能保证恢复 | 取决轨迹是否实际保存相匹配的用量与计时；未证明普遍可恢复 |

## 计量规则

- 输出 token、输入 token、缓存 token 与上下文占用是不同指标，不能把它们混成一个数。累计使用量不能除以模型窗口冒充上下文占比。
- “回合平均输出速度”按本轮输出 token 与整轮耗时计算，包含工具、审批和等待；与 DSH 的生成阶段速度分开。只有输出计数范围和计时范围一致时显示。
- 实时接收时间受缓冲、网络和 CLI 转发影响。没有可靠 token 计数时隐藏速度，不用字符数或 delta 包数代替 token。若使用 tokenizer，应明确标记估算。
- 同一原生响应的累计 usage 只更新最新值；会话累计量取差前核对基线、恢复和重置。无法取得基线时不追认本轮增量。
- 公开推理与输出总量可能存在包含关系，不能简单相加。费用只在原生报告且范围明确时显示，不为自定义服务套用固定价格表。
- 工具、模型和子代理可并行，时间线应保留重叠，不能将各项耗时相加当作墙钟总时长。历史没有时间戳时保留步骤顺序，不生成虚构时间条。
- 本机计时属于当前运行的遥测；旧会话能恢复多少以原生历史为准。若以后保存补充计时，也只能保存关联 ID 与指标，不复制对话和工具正文。
- 工具原生 ID 与界面 ID 分开，回填仅匹配当前轮次；跨轮复用 ID 不覆盖旧记录。重复结束不复制统计或抹除失败状态；缺数据隐藏，不显示占位警告。

## Claude 的接入点与限制

本机 CLI 2.1.317、SDK 0.3.286。`result.usage` 表示本回合主循环用量；`modelUsage` 与 `total_cost_usd` 是会话累计，可能包含子代理、压缩和辅助请求。思考 token 若报告通常属于输出量的子集。

`stream_event.message_delta.usage.output_tokens` 按单个 API 响应累计；`assistant.message.usage` 可保留早期占位值，且同一消息会分块重复出现，不能逐条相加。`duration_api_ms` 含 API 等待，不能直接当纯解码时长。首条完整助手消息、message_start 与首个可见文字的计时含义也不同。

当前上下文使用 `getContextUsage({detail: 'summary'})`，结果是原生估计；`rawMaxTokens` 按原生压缩策略解释。full 模式可能调用 token-count API，不作为每帧自动采样。当前在发送至原生 result 到达间使用单调时钟计时，随后读取上下文，控制查询不计入回合。

当前 [事件映射](../../apps/server/src/agents/claude/mapper.ts) 已接 usage、工具进度及公开 thinking，全文快照与流式增量分别去重；签名和 redacted 块不展示。子代理 result 不结束父回合，中断后淘汰旧运行时再按原生 ID 恢复，防止迟到结果串轮。完整子代理历史尚未接入。本机 SDK 历史投影未保留部分顶层 system 压缩字段，合成压缩测试仍不能替代真实历史验证。

## Codex 的接入点与限制

本机 CLI 0.166.0，已生成协议 schema 并与已有隔离 schema 核对一致。`thread/tokenUsage/updated` 提供 total、last 和可空 modelContextWindow；分项有 inputTokens、cachedInputTokens、cacheWriteInputTokens、outputTokens、reasoningOutputTokens、totalTokens。last 不能默认解释为整个用户回合的用量。

Turn 提供 durationMs 和起止时间；ThreadItem 有可选 startedAtMs/completedAtMs，命令/MCP 等也可提供耗时。文本 delta 不含 token 计数或逐 token 时间戳；tokenUsage 通知也没有 itemId，因此不能直接得到每条助手消息的精确生成速度。

当前 [Codex mapper](../../apps/server/src/agents/codex/mapper.ts) 已扩展 plan、webSearch、dynamicToolCall、collabAgentToolCall、subAgentActivity、imageView 及 MCP 进度。工具存在 status 时须有明确终态；中断及未确认完成的历史不标成功。原生公开 summary/content 可以展示，不表示完整隐藏推理。

新线程从零建立用量基线，恢复线程先观察可靠累计快照。缺报告、重置、压缩、失败、中断和迟到通知均使不可靠增量失效；不能从 last 或旧回合中途快照补造整轮统计。

当前 Thread/Turn 历史结构没有 tokenUsage，不能靠 thread/read 重建旧轮次速度。account/usage/read 依赖账单路由可用，不是通用离线历史来源；Internal-only 的原始响应通知不能当稳定公开接口使用。历史分页接入也需与现有全量读取区分。

## Antigravity 的接入点与限制

本机 CLI 1.5.1。公开 headless result.usage 有 input_tokens、output_tokens、thinking_tokens、cache_read_tokens、total_tokens，另有 duration_seconds。step_update 在已知时可带 usage 和 duration_seconds，step_index 和状态可用于步骤归属。

官方说明同进程多条 stream 输入时结果累计；当前工作台每轮新进程并用 conversation 续接，这一路径是否含旧会话用量尚未验证。因此当前只采用确认范围的步骤统计，不将 result 用量、耗时当本轮或直接相加。

历史读取 generatorMetadata 最后一条 chatModel.chatStartMetadata.contextWindowMetadata，采用原生生成前估计。已用真实隔离回复验证数值存在；元数据不完整或缺字段时隐藏。内部实时 StreamAgentStateUpdates 和 TUI statusLine 尚未接入，不为每轮更新反复打开管理进程。

内部 chatModel 还定义了 usage、timeToFirstToken 和 streamingDuration，可能支持生成完成后的速度与首 token 延迟。仍需核对各提供方实际是否填充、是否包含思考和重试，以及用量与计时是否对应同一次生成，不能仅凭字段存在宣称精确速度已经可用。

正式历史读取已复用目录、身份和空闲校验，白名单映射文字、命令、文件、MCP、通用工具、公开错误、压缩及未知活动。分页受 32 MiB、50,000 步、64 页、30 秒预算约束，缺页明确失败。历史工具的模型用量可能来自生成调用的模型请求，不与工具执行时间配对计算速度。该入口仍是内部协议。

原生结果成功与进程退出分开：结果后等待超时只触发清理，收到真实 close 才释放会话；未成功发出清理信号后的异常退出、协议错误和主动停止继续标失败。

本机固定响应服务还验证了自定义模型的请求路径：当前 CLI 把包含地址的 modelName 当成模型 ID，造成错误路由。表单将模型 ID、显示名称和原生选择项分别处理，URL 单独走启动环境，末尾重复版本段规范化；旧配置的读取与迁移规则见[模型连接说明](native-configuration.md#模型与服务连接)。

## 界面与验证

已提供“对话 / 轨迹”切换、按轮虚拟步骤表和点击打开的右栏详情，复用同一会话条目。回合或步骤完成后显示对应 token、耗时及平均速度，输入区显示上下文占比。审批与停止在轨迹中仍可操作，视图切换保留草稿。

关联回归覆盖统计去重、跨轮 ID、基线、历史归属、分页、失败和取消。隔离浏览器核对 800/960/1280/1440 宽度、侧栏、草稿和停止；800 轮历史只渲染可见步骤，默认未连接 SSH。

用户授权后，测试使用独立临时 profile/cwd，本机代理限制请求数和输出并裁剪系统上下文、工具，源配置摘要前后相同。凭据只经内存传递；代理裁剪只属于本轮低额度验收，不进入产品路径，也不代表完整工具循环或服务配置兼容。

- Claude：模型目录可读；一次连接超时，之后短请求返回 HTTP 200，但 CLI 未成功完成流式结果，重试被本地预算拦截。真实生成不记为通过。
- Codex：过大的原始测试请求在本地拦截，裁剪后的 Responses 请求返回 HTTP 404。保留失败路径结论，真实生成不记为通过。
- Antigravity：指定 Gemini 模型短回复返回，步骤输入 12、输出 70（原生报告思考 69）、耗时约 2.93 秒；内部历史回复为 DONE，读取到上下文估计 10,054 / 32,768。估计包含裁剪前上下文，不能等同计费输入。结果后清理误报已用受控进程回归修复，未为复验再耗费额度。

真实工具执行、所有账号模式和 CLI 版本兼容仍需分别验证；精确逐 token 速度、首 token 延迟以及 Claude 完整子代理历史不属于本轮已交付能力。

## 证据入口

- Claude：[SDK 用量](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)、[类型参考](https://platform.claude.com/docs/en/agent-sdk/typescript)、[流事件](https://platform.claude.com/docs/en/build-with-claude/streaming)，以及本机 SDK 类型与实现。
- Codex：本机 `app-server generate-json-schema` 的 0.166.0 schema；官方 app-server 页面本次返回 403，未用该页面证明字段含义。
- Antigravity：[headless](https://antigravity.google/docs/cli/headless/)、[statusLine](https://antigravity.google/docs/cli/statusline)、本机 protobuf 描述和隔离 GetCascadeTrajectory 读取。
- 当前数据入口：[Claude 上下文](../../apps/server/src/agents/claude/query.ts)、[Antigravity 映射](../../apps/server/src/agents/antigravity/mapper.ts)、[前端上下文状态](../../apps/web/src/features/chat/ContextStatus.tsx)、[事件归并](../../apps/web/src/features/chat/chat-reducer.ts)。

## 本轮短对话补充验证

2026-11-06 用户授权使用当前 Claude/Codex 连接和指定 Gemini 模型做一句话正常问答。Claude 取到本轮输入 99、输出 71、耗时约 3.85 秒与 1M 上下文报告；Antigravity 取到步骤输入 37、输出 144、耗时约 2.74 秒。Codex 当前服务返回 403，未取得回复或用量。为控制额度，隔离验收关闭工具并限制输出，Codex/Antigravity 额外裁剪原生前置上下文；不据此宣称完整工具回合或所有模型可用。原配置文件摘要不变，完整结果边界见[路线图](../roadmap.md#模型身份推理强度与输入框统计)。

用户后续授权的 Codex 再次尝试也未得到有效回复；现存记录的超时结果已补充至[当前阶段](../roadmap.md#当前阶段与后续顺序)，上述早期失败结果不改写为通过。
