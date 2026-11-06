# 原生 CLI 对话接入

更新日期：2026-11-06。本文记录已确认的产品方向与当前接入边界。旧设计、M1 计划及上一代验收原文通过提交 `c686ef2` 追溯，不将历史测试结果当成本轮证据。

## 1. 意图与顺序

核心工作是让用户按项目找到原生会话并继续工作。Claude Code、Codex、Antigravity 都属于主线。先完成三者的对话流程，再完善各自原生配置；AgentDeck 自有插件及 SSH Console 接入后置，不建设 DSH 插件兼容层。

保持现有 Electron、React、Fastify 与 TypeScript 架构。本文说明对话协议，SSH 入口与生命周期见[工作台插件](workbench-plugins.md)。对话正文只保存在各 CLI 的原生存储中；界面与传输过程可以持有内存状态，不能新增正文数据库。

## 2. 本轮交付

- 在已有项目中选择三个 CLI，显式发送才新建会话；点击列表中的原生会话可以继续。
- Claude/Codex 展示历史、流式文本和工具事件，接住原生决定发出的审批，支持停止。
- Antigravity 读取摘要与目录归属，并通过原生服务回放已适配的文本、工具与活动步骤。新回合仍使用原生 id 续接，不把界面内容复制成另一个会话库。
- Antigravity 没有交互审批通道：实际发生软拒时显示说明；不伪造允许按钮，不默认绕过权限，也不常驻权限提醒。
- 模型和强度默认留空，参数省略表示继承 CLI。只显示本机能力报告的可选项；用户可显式填写模型标识。
- 模型目录可跨应用重启复用；首次无缓存时打开菜单获取，也可手动重新获取。技能与命令不写入模型缓存，显式打开技能入口后按实际目录获取；斜杠补全只读取已有目录。
- Claude 的探测与实际驱动采用同一份本机程序；找不到时明确失败，不回退到 SDK 自带程序。SDK 仅作为协议客户端。
- 对话与执行轨迹共用事件归并；原生用量、步骤耗时和上下文进入统一展示，平均速度按回合或步骤分别计算。完整字段及计量边界见[CLI 用量与执行轨迹](cli-observability.md)。

## 3. 运行边界

本轮先完成当前会话的可靠控制。回合运行或准备期间阻止本窗口切项目、新建或切会话，并说明先结束当前回合；已存在的多会话后台运行架构不作完成承诺。原生会话仍固定 CLI，不能切换引擎。

WebSocket 断开时后端取消准备、拒绝未处理审批并请求中断所属回合。前端保留已收到内容并说明结果可能不完整；恢复连接后由用户重新读取原生历史，不自动重发消息。跨连接事件缓冲与后台多会话是后续明确任务。

历史加载失败时不得在未知上下文上继续发送；提供重读动作。旧适配器的不可回放响应仍有兼容处理，但当前 Antigravity 不再固定返回该状态。CLI 返回的会话身份须与当前项目和预期原生 id 一致。

## 4. 接口与实现选择

既有 `ChatView`、`Composer`、工具卡片、审批卡片及 `TurnManager` 继续复用。`SessionPane` 将当前项目接入对话视图；新建按钮列出三个 CLI，未选会话时提供新建输入。

能力接口保持 `/api/workspaces/:id/agent-capabilities`：GET 仅读缓存，并通过 discovered 区分尚未获取和已获取的空结果；POST 用于首次打开模型菜单或手动刷新。既有会话传可选 `sessionId`，服务核实其原生目录后读取该目录能力，前端缓存区分会话；普通文本无需能力目录。

模型持久缓存按实际 cwd 与 CLI 区分，项目记录 id 变化不导致重复发现；命令就绪使用独立 commandsDiscovered 标记。配置保存立即作废同 CLI 的内存、磁盘和在途发现。失败保留已有可用模型，不让新响应之外的旧结果重新落盘。

三种来源先枚举全局摘要，再按项目路径规则确定归属。`GET /api/sessions?agent=...` 专供显式查看其他目录，仅返回无归属摘要，零项目也能使用。共享在途枚举不缓存正文，取消一个查询不终止其他订阅者。

读取、续接、管理及分叉都复核原生目录。会话位于项目子目录时使用原生 cwd 执行，项目根只用于归属；多目录摘要无法唯一归属时拒绝操作。启动环境解析后重新核对实例容量，原生配置写入与项目换目录通过活动租约互斥。

`/ws` 沿用 `chat.send`、`chat.interrupt` 和 `permission.respond`。非法发送请求若带有效 `clientTurnId`，错误须回传该关联字段，避免界面永久处于等待状态。

Antigravity 使用本机 `agy --input-format stream-json --output-format stream-json`，输入为 `{"event":"user","message":{"content":"…"}}`。依据是本机帮助和[官方 headless 协议](https://antigravity.google/docs/cli/headless/)。每轮关闭 stdin，下一轮用 `--conversation` 续接；不依赖猜测的常驻控制接口。输出按 `event` 与嵌套载荷解码，处理 `init`、`step_update`、`result` 和 stderr。续接用摘要验证目录，成功结果仍等待真实进程退出；超时请求停止并保持占用，不能伪造退出成功。

Antigravity 账号模式仅读取原生配置的模型，不把未进行账号检查解释成未登录。Gemini 模式在临时 home/cwd 中执行原生 models，只复制模型白名单，不加载用户 MCP、Hooks 或插件；临时更新检查标记避免原生后台更新器闪出终端。当前 1.5.1 两列 TSV 已隔离验证，严格按 ID 与名称读取，格式变化时保留配置模型。真实对话的原生规则与插件继续由 CLI 加载。

历史读取复用 Antigravity 原生服务的 `GetCascadeTrajectory` 和步骤分页接口，并沿用会话 ID、唯一目录、非内部子代理及空闲检查。用户输入与公开助手文本、已知工具、压缩和原生活动按白名单映射，内部签名、隐藏载荷及诊断正文不直接暴露；读取预算见[架构](architecture.md#44-历史与前端状态)。此入口属于内部协议，隔离合成数据验证不等于所有 CLI 版本或真实生成记录兼容。

Claude 上下文沿用 summary 查询，回合用量取原生结果；计时在结果到达时截止，排除之后的上下文查询。Codex 总量仅在基线连续时计算回合增量，恢复但缺基线时不补造首轮用量。Antigravity 先保留已知步骤统计，不将不确定的 result 累计值当单轮结果。历史只展示能够读到的原生数据，Claude 完整子代理历史与旧会话精确生成速度尚未交付。

上述“运行中不切会话”和“断线中断”是本轮为可靠控制所作的实施取舍，后续多会话任务可替代；不是 CLI 本身的限制。

## 5. 验证

仅用受控运行器和合成原生事件验证发送、续接、审批、停止、错误、权限软拒及进程清理；本机 `--help` / `--version` 可运行。自动验收不得向真实模型端点发送 prompt，也不修改用户原生配置或 SSH 数据。

前端验证须覆盖三个 CLI 可选、历史失败禁发、原生步骤回放、目录缓存复用、默认参数省略、输入法与停止及运行中导航保护。执行轨迹另核对跨轮 ID 复用、右栏详情、审批、缺失统计与速度口径；使用隔离的本机服务检查页面，不把受控测试写成真实模型验收。

类型、代码质量、构建及相关回归通过后记录命令与证据；原生 CLI 升级后协议仍可能变化，失败只影响对应适配器。

对话与下节列出的管理入口已完成受控验证，证据以[当前路线图](../roadmap.md)为准。真实模型请求、真实原生记录写入及后台多会话仍不在已验证范围。

## 6. 会话管理接入

会话菜单在应用内提供已接入的管理操作，使用同一项目归属校验、空闲锁、确认与分支对话框。Claude 使用 SDK，Codex 使用 app-server；Antigravity 借助本机 agy 启动的原生会话服务完成操作，不要求打开终端，也不手动复制轨迹或删摘要行。

会话列表仍为 `GET /api/projects/:id/sessions?agent=...`，归档查询追加 `archived=true`。读取和写入统一以 `/api/projects/:id/sessions/:agent/:sessionId` 定位，写入分别追加 `/actions`、`/fork`；旧 `/api/workspaces` 下的会话路由删除，SSH 的旧路径不在本轮迁移范围。动作、历史和分叉不接受查询字段，响应统一禁止缓存。

归档页同时查询三个来源。Codex 仍按原生归档/恢复执行；Claude、Antigravity 使用工作台身份标记，不改 CLI 历史。归档会话必须恢复后续聊或创建分支。删除需确认实际范围；会话忙时拒绝管理。分支成功只在原选择代次仍有效时打开新记录，其他情况刷新来源列表。

Antigravity 的公开 ACP 初始化目前没有 fork/delete 能力，本机 1.5.1 的原生服务则包含 `ForkConversation`、`DeleteCascadeTrajectory`、`UpdateConversationAnnotations`。适配器通过自己启动的 `agy acp` 引导本地服务，只接受该进程日志中匹配 PID 的 HTTP 回环端口。管理请求限固定方法，不发模型 prompt，不连接其他进程或用户提供的地址；内部协议升级失配时返回操作失败，不尝试修改 SQLite 兜底。

写入前用原生轨迹核实会话 ID、唯一工作目录、空闲状态和非内部子代理身份。创建分支按已完成原生步骤执行，再核对新 ID、目录、父引用和摘要落库；删除轨迹后以 `JetboxDeleteSummary` 清原生索引，确认两者均已移除。若轨迹已删而摘要清理中断，重试必须重新验证摘要身份与目录，且只有明确的原生 not_found 响应才进入补清理；接口不存在或通信错误不能当作会话缺失。

管理器关闭自己的进程、请求和临时日志，应用退出时统一取消待启动操作。隔离验证用原生空会话与合成已完成步骤，不能代替真实账号模型回合验收。

## 原生权限模式

输入区权限菜单只覆盖当前会话后续轮次，运行/准备/管理期间禁用；换会话、工作区或新建恢复“原生权限”。未选择权限时省略参数，由 CLI 决定新建默认或恢复原生会话的已保存权限；这不表示默认完全访问，也不替用户开启自动审查。选择不写 CLI 的原生文件；持久默认仍由原始配置入口管理。

| CLI | 菜单选择 | 原生映射 |
|---|---|---|
| Claude | 手动审批、接受编辑、自动审查、计划模式、不询问、跳过权限检查 | SDK permissionMode: default、acceptEdits、auto、plan、dontAsk、bypassPermissions |
| Codex | 请求批准 | workspace-write + on-request + user |
| Codex | 帮我批准 | workspace-write + on-request + auto_review |
| Codex | 完全访问 | danger-full-access + never；不创建自动批准回调 |
| Antigravity | 接受编辑、自动模式、计划模式 | --mode accept-edits / auto / plan |
| Antigravity | 跳过权限检查 | 显式 --dangerously-skip-permissions |

Claude 仅显式 bypass 时设置 SDK 的 allowDangerouslySkipPermissions。auto 使用 Claude 原生分类器；Codex 自动审查也由原生执行，不在网页静默回答权限请求。Antigravity headless 仍没有交互批准通道，不把软拒伪装成已允许。

Codex 已有会话会恢复历史权限，所以用户显式选择“沿用原生配置”使用单独的 native 动作：先创建不持久化的空线程，让原生解析当前有效配置，读取审批策略、审查对象及权限 profile/沙箱后取消订阅，再显式用于正式会话续接。空线程不发送 turn/start 或模型 prompt。必要字段缺失就停止，不能省略字段后误回到历史的完全访问。无选择的普通续接仍尊重原生会话，不强改其权限。

菜单列出已核对协议支持的模式；组织策略、账号/模型可用性与 CLI 版本仍由原生校验，不能把菜单可见当成账号已获权限。原生拒绝时本轮停止并显示错误，不降级策略、不换模式重发。Codex 权限字段拒绝使用固定说明，不泄漏原始 RPC 错误中的路径、配置或凭据。高级自定义 permission profiles、Claude rules 和其他原生细项仍走原生配置，常用预设不覆盖未显式选择的值。

依据：[Claude 权限](https://code.claude.com/docs/en/permissions)、[Agent SDK 权限](https://platform.claude.com/docs/en/agent-sdk/permissions)、[Codex 权限模式](https://learn.chatgpt.com/docs/permission-modes)、[Codex 自动审查](https://learn.chatgpt.com/docs/sandboxing/auto-review)、[app-server](https://learn.chatgpt.com/docs/app-server)。本机 SDK 类型、Claude/agy --help 和 Codex 生成 schema 已核对；这不等于真实模型回合验证。
