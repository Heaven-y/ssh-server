# Codex 对话接入实施计划

执行使用 subagent-driven-development：本会话分工实现、独立审核、主线程集成。用户已授权合理决定并继续，无需重新确认既定方向。

目标：网页可选 Claude/Codex，使用各自原生会话完成流式回复、工具、审批、中断及续接。
架构：保留 Claude SDK；新增每轮独立的 Codex app-server stdio 客户端；原生会话读取共用身份契约。
技术栈：Node.js、TypeScript、Fastify、React、现有官方运行时。
设计：[Codex 对话设计](../specs/2026-10-03-codex-conversation-design.md)。

## 约束与审核重点

- 中文、UTF-8/LF；保持现有功能分支，不动 .pi/，不推送。
- 不改本机配置，测试仅使用指定替代配置的隔离副本，不输出凭据；产品仍用原生 config.toml。
- 会话身份包含 Agent，Codex 使用 thread.id；工作区验证、异步选择代次、审批归属必须完整。
- 必须有 RPC 容量/超时/退出清理，不能因子进程死亡留下运行中界面或待审批请求。
- 模型默认不覆盖；临时 MCP 令牌只通过环境转发；消息文本、工具结果和本机配置诊断分别处理。
- 验证依据本机 0.156.1 schema，线上文档作为补充；新源码按职责组织，测试放所属包 tests。

## 任务与所有权

1. 主线程固定 shared 身份/事件/历史契约与 agents/types.ts。协议枚举、字段和后续所有权先统一，不各自猜接口。
2. 后端子任务仅修改 agents/codex/ 与对应 tests：异步进程客户端、可执行文件解析、原生事件映射、runCodexTurn，以及列表/历史读取。返回公共 TurnHandle，消费通用 TurnInput。
3. 前端子任务仅修改 chat-store/reducer/ChatView/Composer/PermissionCard、SessionList 与对应 web tests：Agent 选择、模型隔离、原生列表、历史请求取消、审批服务器确认和提前中断。lib/api由主线程负责。
4. 主线程实现 chat/sessions.ts、HTTP 会话路由、TurnManager/WS/main 集成与 API 客户端；Claude 只做公共类型与审批结束事件适配，保持原生 query 行为。
5. 审核核心目标后补上述边界测试，修复实际问题；验证关联类型、lint、格式、测试及构建。
6. 原生受控接口/真实 GLM 与浏览器串联；记录真实 SSH 未验边界，更新架构、路线图和验收文档，阶段提交。

检查点：Task 1 的 SessionHistory 和错误关联字段为 Task 2/3/4 的共同输入；Task 2 的 native read返回cwd供Task 4验证，不能只信浏览器声明的Agent/目录；Task 3只显示官方实际模型，不把它写成覆盖参数。每项完成后审核契约与实际行为，再合成提交。
