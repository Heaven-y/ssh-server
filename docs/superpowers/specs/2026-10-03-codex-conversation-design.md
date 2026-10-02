# Codex 对话与原生会话接入

用户已授权持续实施、合理决定和阶段提交。本阶段落实 M4 的双 Agent 主对话链路：创建时选择 Agent、流式回复、工具结果、审批、中断、历史列表和原生续接。后续同 M4 继续实现删除/归档、skills/命令、上下文与压缩；不把本阶段完成等同全部需求完成。

## 已确认的方案

沿用官方 Codex app-server，通过 stdio JSON-RPC 与本机运行时通信；不增加 Responses/Chat Completions 转换层。已验证用户更新后的 GLM 测试配置支持真实 Responses 调用。相比直接启动交互 CLI，app-server 提供结构化通知、审批和原生线程操作；本项目继续使用现有 Node.js/Fastify/React 技术栈。

资料依据：[官方 app-server 文档](https://developers.openai.com/codex/app-server/) 与本机 Codex CLI 0.156.1 导出的协议。官方在线文档持续更新，实际字段以这次导出和运行验证为准，例如本版 sandbox 使用 `workspace-write`，推理强度为字符串。

## 会话身份与界面

- 统一 `AgentKind = 'claude' | 'codex'`；会话引用为 `(agent, sessionId)`。Codex 的共享 sessionId 必须使用可用于 `thread/resume` 的 `thread.id`，不能使用原生分叉树根 `thread.sessionId`。
- 新会话允许选择 Agent；已有会话和发送中的新会话禁止切换。模型覆盖按 Agent 分别保存在内存；默认不传 model/modelProvider/baseUrl/apiKey，实际模型只用于展示。Codex 提供可选推理强度，留空沿用配置。
- 会话列表分两类独立读取再展示，某个运行时不可用不能抹掉另一类历史。标题旁显示 Agent，选中项与 React key 均包含 Agent 身份。
- 历史加载绑定工作区、Agent、官方 ID 及选择代次；切换取消旧请求，迟到成功和错误均忽略。读取历史期间禁止发送，历史实际模型不得变成用户模型覆盖。
- 启动前错误绑定 clientTurnId；后台轮次结束仍刷新它对应的工作区/Agent 查询。前端在 turn.started 前点击停止时记住停止意图，收到轮次 ID 后立即中断。
- 审批在服务器确认后才显示已处理；超时、中断或原生请求取消后关闭按钮，不把发送请求等同执行成功。

## 运行时与配置

- 每个 Codex 对话轮次独立启动 app-server，完成后关闭并等待退出；读取原生列表/历史使用短生命周期进程。运行中的轮次使用启动时配置，下一次调用重读原生配置，不常驻缓存模型配置。新 thread 跟随新默认模型，原生 resume 保留历史模型，只有用户显式选择才覆盖；重启进程不能被描述为历史自动换模型。
- 正式环境继承用户原生 CODEX_HOME/config.toml；可通过 SSH_SERVER_CODEX 指定可执行文件。Windows 直接运行 exe 或已安装官方 npm 包的 JS 入口，不把 codex.cmd 交给 shell、不在产品中硬编码开发机路径。
- JSON-RPC 客户端区分响应、通知与服务器请求，原生 ID 支持数字和字符串。限制单行 8 MiB、待处理请求 128 个；普通 RPC 超时 30 秒，关闭时拒绝所有等待者。stderr 持续读取但不输出原始配置诊断；错误映射为可操作的中文分类。
- 先 initialize/initialized，再 config/read(cwd) 读取生效的 developer_instructions 并追加已有工作区约束。只在本次 start/resume 的 config 中添加自己的 MCP 配置；不改写原配置、不覆盖其他 MCP 服务。
- remote-tools 使用现有入口，配置仅列 env_vars 名称；内部地址与短期令牌只存在 app-server 子进程环境，不放命令行、配置覆盖值或 Agent 输入。限制本地 shell 继承这些内部变量，但不影响 MCP 显式转发。
- 固定工作区 cwd、workspace-write 沙箱与 on-request 审批，沿用本机模型/服务商配置。远程工具标记 required，无法启动时拒绝本轮，不能静默改为本地运行项目。
- thread/start 或 thread/resume 后开启 turn/start；恢复已有会话前验证原生会话属于当前本地目录。模型与推理强度只在用户显式选择时覆盖。
- 中断同时覆盖准备阶段和运行阶段：准备阶段取消启动；已获得原生 turnId 后调用 turn/interrupt，等待完成通知，5 秒无响应则结束本次进程。网页断线后运行继续，但立即拒绝已有待审批项，不等待审批超时，不自动启动新轮次。

## 事件、审批与同步

- 适配器输出统一 session、text、reasoning、tool_call、tool_result、permission_request/resolved、turn_end 和 error。根据 item ID 去重已流式输出的最终文本；真实错误、中断与正常完成分别处理，不能重复结束轮次。
- 命令、文件改动、MCP 工具映射为现有工具卡，输出保持有界。文件改动展示原生 diff；不把历史消息重新拼为提示词。
- commandExecution/fileChange 审批仅允许单次 accept/decline；权限请求只按本次明确请求内容返回 turn 级授权。未知服务器请求返回不支持错误并提示，不挂起、不中途扩大权限。
- Codex 请求 ID 转成应用 UUID；后端校验 socket、turnId、requestId 的归属，其他连接不能批准或中断本轮。请求完成、超时与中断必须清理等待状态。
- 沿用现有 MCP → 内部接口 → 同步门禁 → SSH；本轮结束仍通过已有同步入口同步，不绕过删除/冲突确认，不自动分析训练结果。

## 接口与模块

- shared 增加 AgentKind、SessionRef、SessionSummary、SessionHistory；历史响应包含 session、events 和可选 actualModel。
- chat.send 增加可选 agent（旧调用默认 Claude）和 reasoningEffort；session 事件可携带 Agent；turn.started/finished 带 workspaceId/agent，启动错误带 clientTurnId；permission.respond 增加 turnId。
- GET `/api/workspaces/:id/sessions?agent=` 返回指定原生来源的列表；GET `.../:sessionId/events?agent=` 返回 SessionHistory。只接受 claude/codex 与合法原生 ID；读取和续接均验证工作区范围。
- agents/types.ts 定义公共 TurnInput/TurnHandle/PermissionAnswer；agents/codex/ 集中客户端、启动解析、事件转换和适配器；chat/sessions.ts 统一原生会话读取；HTTP 只负责校验与转发。
- 前端沿用当前深色布局、消息工具卡与审批区域，按需拆分模型/Agent 控件，不新增无关页面或手写新的编辑器。

## 验证与交付

先完成实现并 review 核心目标，再补最少核心测试：RPC 分片/结束/超时，流式去重与审批，启动中断、配置覆盖仅传必要字段；跨 Agent 同 ID、历史加载代次、错误关联、审批归属与原 Agent 续接。仅复验关联模块，保留其他已验证基准。

真实 Codex 验收使用用户指定 config_bq.toml 的隔离副本，不改写源文件；核对原生会话可读/续接、配置重读及实际工具调用。受控内部服务只能证明 MCP 接入，真实 SSH 仍需已请求的测试目标，不能混写结论。浏览器检查两种 Agent、新建/历史、模型显示、审批、中断与运行时失败状态。代码、文档和验收结论按完整阶段提交，不推送。
