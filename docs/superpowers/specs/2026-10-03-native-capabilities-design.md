# 原生技能、命令、模型与上下文

继续 M4 的 F2.4/F2.7/F2.8/F2.9，基线为49db632。用户已授权合理决定、持续实施和阶段提交。保留现有双 Agent 原生会话、访问控制、审批、同步和目录布局，不另建上下文引擎。

## 已核对的原生行为

- Codex app-server 0.156.1 的 `skills/list` 按 cwd 返回 skills/errors，禁用项仍返回 `enabled: false`，同名不同路径并列；`forceReload: true` 才重新发现新文件。`turn/start` 会静默忽略未知/禁用 skill 路径，因此产品必须自行用原生目录重新校验。
- Codex `model/list` 的目录默认项不等于用户配置模型，目录未必包含自定义中转型号。模型和推理强度仅作选择建议，留空仍不覆盖原配置。
- Codex 当前上下文取 `thread/tokenUsage/updated.tokenUsage.last.totalTokens` 和通知中的 `modelContextWindow`；`total` 是累计计量，不能作为上下文占用。last 在压缩后可能是原生估算；不根据配置窗口或缺失字段拼出比例。
- Codex 手动压缩须先在本次进程 `thread/resume`，再 `thread/compact/start`。返回 `{}` 仅表示接受；完成由当前 turn 的 contextCompaction/turn 通知确认，失败和中断不能标成功。
- Claude SDK 0.3.286 / CLI 2.1.286 的空输入流可读取 `supportedCommands()`、`supportedModels()` 和 summary 上下文，无需模型回复；初始化可能产生服务探测，不声称完全无网络。
- Claude 字符串 prompt 的 query 在 result 时已关闭。改为一条消息的 AsyncIterable：先检查所选能力，发唯一消息，收到本轮 result 后限时读取 summary，然后关闭输入和 query；仍每轮独立进程。
- Claude `getContextUsage({detail:'summary'})` 返回原生估计，不发逐分类 token-count；上下文查询用此控制接口。`/compact` 须在同一 Query 发送前确认唯一精确名称、`builtin: true`，拒绝同名/别名歧义；项目 skill 可以覆盖它。
- Claude 压缩成败依据当前 status 和 manual compact_boundary；顶层 result success 不能证明压缩成功，历史 assistant 失败文本也不能覆盖当前成功事件。

资料依据为官方 [app-server 文档](https://developers.openai.com/codex/app-server/)、本机协议与 SDK 类型，以及本阶段临时合成工作区/回环协议实验。没有为探查调用真实模型。

## 能力目录与输入

- 新增按工作区和 Agent 读取的能力接口，返回模型建议、技能/命令项与匿名警告；不把原始配置、account 或初始化整包转给网页。
- 每项有稳定 ID、kind、name、description、来源提示、aliases、是否可用、限制原因、是否要求已有会话、是否支持参数。Codex ID 包含原生 path 身份；Claude 依据命令/技能名称和来源种类区分。
- 后端保留内部 invocation 映射，网页只提交 ID，不能指定任意 skill 路径。发送前重新发现并解析；适配器再在实际运行实例验证原生 skill/name/path/enabled 或 Claude 命令来源，过期、歧义或禁用时明确拒绝。
- 显式选择 skill 后，可带任务文本或只调用技能。Codex 使用官方 `{type:'skill',name,path}` 输入；Claude 使用经过同一 Query 校验的原生 `/name 参数`。
- 本阶段命令映射：两类手动 compact，Claude context(summary RPC)。Codex context 在稳定 app-server 中没有独立查询接口，标明使用本机 CLI；其余 Claude 发现的 builtin 标“尚未接入网页”，不凭返回模型文本宣称支持。
- 用户直接输入 `/name 参数` 时后端按精确名称、再 aliases 解析当前目录；未知、歧义或未接入的命令拒绝，不静默当普通模型提示词。包含后续斜杠的绝对路径文本不当作命令。
- compact/context 要求已有会话，沿用对话轮次锁与停止能力。Codex compact 不支持附加参数；Claude 可传原生命令支持的压缩说明。上下文查询不触发模型分析，手动压缩由用户明确调用。
- 纯上下文查询/压缩不编辑项目文件，不触发轮次后的服务器同步；普通消息和技能继续沿用结束同步。

## 界面与状态

- 输入区增加可搜索的“技能与命令”入口，分辨可调用技能、已接入命令与限制项。选择后显示可移除标签，发送成功才清空输入和选择，失败保留。
- 模型与推理强度输入保留手动填写，使用原生目录作为候选。不能把 isDefault、历史实际模型或默认 effort 自动写成覆盖参数；配置保存后仅失效能力目录缓存。
- 当前工作区/Agent 共用能力查询，按需加载并允许刷新；切换后不显示旧来源，单个目录分支失败不抹掉另一分支，错误不阻止普通对话。
- 上下文卡显示“Claude 原生估计”或“Codex 原生统计/估算”、token 数和原生窗口。仅 Claude 原生直接给出的 percentage 可显示；缺失值显示不可用。
- 压缩展示进行中、已完成、失败/已中断及已知的手动/自动来源。只根据专门原生事件更新，不靠普通回复文本。历史中的原生压缩边界可展示；不为旧记录捏造用量。
- 工作区、Agent、会话切换重置所选能力与上下文状态；迟到目录/历史/轮次结果不能覆盖新选择。管理操作期间仍禁止对同目标发送。

## 工程与验收

能力读取和查询有超时/取消及子进程退出清理；轮次开始前的发现取消不启动模型。Codex 继续现有令牌隔离、required MCP、审批与中断语义；Claude 单消息流结束必须关闭输入/进程。

先实现并 review 核心目标，再补核心测试：未知/禁用/冲突 skill 和 slash 命令、目录隔离、模型不自动覆盖、单消息生命周期、summary 不可用、压缩失败顶层成功与中断、跨会话迟到状态。只验关联范围。

用真实运行时与合成回环模型协议验证技能展开、上下文及压缩成功/失败/中断；浏览器验证选择、手动模型、可用性、状态与桌面宽度。真实 Codex 模型验收仍只用用户指定 config_bq.toml 的隔离副本，正式产品读 config.toml；不以受控协议替代尚未完成的真实 SSH 验收。
