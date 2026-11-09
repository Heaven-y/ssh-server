# 原生配置与启动环境

以各 CLI 的原生文件与加载规则为准。常用模型设置通过表单直接修改用户原生文件，完整文件仍可从高级入口编辑；是否信任项目、是否启动 MCP、如何合并规则和权限仍由 CLI 决定。

## 配置入口

| CLI | 设置 | 规则与技能 | MCP 和原生插件 |
|---|---|---|---|
| Claude Code | 用户 settings.json；项目 .claude/settings.json 与 settings.local.json | CLAUDE.md、CLAUDE.local.md、条件回退 AGENTS.md；原生 rules/skills 目录 | 项目 .mcp.json；用户及个人项目 MCP 使用原生命令，避免编辑混合状态文件；插件管理使用原生入口 |
| Codex | 用户 config.toml 和受信任项目 .codex/config.toml | AGENTS.md/AGENTS.override.md、Starlark .rules、.agents/skills | MCP 保留在对应 TOML；插件由原生管理器维护 |
| Antigravity | 全局 .gemini/antigravity-cli/settings.json | AGENTS.md/GEMINI.md、.agents/rules/skills 及官方共享目录 | 全局与项目独立 mcp_config.json、hooks.json 和定制发现清单；不制造项目 settings 层 |

用户配置根尊重 Claude 的 CLAUDE_CONFIG_DIR 和 Codex 的 CODEX_HOME；Codex 共享 Skills 的用户目录仍是 ~/.agents/skills。项目与子目录按真实来源标注，列表不会把工作台当前选择解释成原生最终生效顺序。

原生插件不同于工作台插件。配置页显示原生路径、作用域和相应命令说明，不直接改写安装缓存，也不把需要交互的 TUI 命令当作普通模型消息。

## 模型与服务连接

设置左侧分别提供 Claude Code、Codex、Antigravity，右侧按服务连接、模型、运行参数排列。常用字段使用同一套输入控件，认证变量和原始文件收进高级设置；只有表单内容滚动，保存按钮固定。表单仍修改原生配置，不另存模型默认，也不读取 CC Switch 数据库。

| CLI | 表单写入 | 认证与地址 |
|---|---|---|
| Claude | model、modelPicker.options 中选中模型的 label、effortLevel；别名映射收进高级设置 | 原生 env 中的 ANTHROPIC_BASE_URL 与 API Key/Auth Token；账号登录由 CLI 管理 |
| Codex | model、model_provider、服务商 name、model_reasoning_effort、整数 model_context_window、model_auto_compact_token_limit | 自定义 provider 的 base_url 与 Responses 协议；直接填写 Key 使用 experimental_bearer_token，原生高级认证保留 |
| Antigravity | model、modelProvider、自定义模型的 label/modelName/maxTokens | 同页配置 Gemini API URL 与 Key，分别映射 GOOGLE_GEMINI_BASE_URL、GEMINI_API_KEY，经加密启动环境交给新进程 |

三者共用模型输入、缓存候选和“获取模型”操作。工作台分开保留 CLI 选择值、显示名称和底层真实型号；模型入口显示具体型号，名称仍可用于搜索，发送时使用原始选择值。Claude 的 `[1m]` 后缀在匹配模型能力时单独处理，不会从发送值中删除。推理强度优先采用模型目录报告，未报告时只按已核对的精确型号补全；未手动选择时省略覆盖参数，有适用的默认值则显示其档位，否则仅保留强度图标；这不等于原生 `auto`。Claude、Codex 与 Antigravity 的档位不能互相套用，详细表见[模型身份与推理强度](model-capabilities.md)。 Claude 的名称仍是 picker label，Codex 的名称仍是服务商名称；Claude 持久默认可写 low/medium/high/xhigh，max 仅用于会话。Antigravity 默认强度仍通过模型变体表示，不写不存在的顶层 effort 字段。

上下文窗口按实际语义显示：Codex 可写数字 token 上限，自动压缩阈值独立填写 token 数并写入原生 model_auto_compact_token_limit，留空移除该覆盖；Antigravity 自定义模型写 maxTokens；Claude 默认显示“由模型决定”。Claude 的条件性网关窗口覆盖与压缩阈值继续留在原始配置，不自动关闭压缩，也不将压缩阈值冒充模型窗口。

Codex 的 provider、端点与认证放在用户配置。当前原生版本会忽略项目 .codex/config.toml 中的这些字段，不能把项目表单当作有效服务商切换。已有高级认证命令、认证请求头、云认证以及内置服务商保持原生配置；简单 Key 表单不能覆盖。TOML 使用 AST 范围修改指定字段，保留注释、未知表、换行和 BOM；不能安全修改的结构转原文编辑，不整体重新序列化。JSON 表单保留未知字段、缩进与换行习惯。

`/api/settings/models/:agent` 返回允许的字段及密钥存在状态；界面用圆点占位，输入新值替换、清除按钮删除。秘密值不回填或进入模型缓存，空输入保留旧值。Claude/Codex 遵循原生文件格式；Antigravity URL/Key 从同一表单保存到启动环境，使用原生文件与环境的复合 revision，原生写入冲突时恢复本次连接改动。

保存后，新的 CLI 进程读取更新文件；当前会话显式模型、托管规则或原生更高优先级配置仍可能覆盖默认值，运行中的进程不会被强制切换。服务端与前端同时清理对应 CLI 的模型能力缓存，并拒绝旧刷新结果回填；下一次打开菜单按原生接口重新发现。

Antigravity 的 `customModelsConfig.customModels` 是对象映射，每个条目使用稳定键、裸 `modelName`、`label` 和可选 `maxTokens`。原生默认 `model` 保存 label，条目键也可用于显式 `--model`。保存模型选择时复用隔离的原生目录，把内置 ID 转成 label；未知服务型号自动登记自定义条目，不要求先填显示名或窗口。目录读取失败时保留用户输入，有明确自定义连接时仍可登记。

本机 agy 1.5.1 的 headless 默认选择自定义模型时可能返回空模型；工作台仅在未显式选择且原生默认命中自定义条目时补充 `--model` 键。读取采用本轮启动环境与原生配置，准备期间可取消；显式模型保持优先。此适配不修改外部 CLI 程序，也不表示其独立 headless 默认选择问题已修复。

服务地址唯一写入启动环境 `GOOGLE_GEMINI_BASE_URL`，不会再把地址拼进 `modelName`；读取旧的 `gemini-api://.../models/...` 条目时提取模型 ID，保存时标准化。提交的地址去掉末尾 `/v1beta`，由原生 CLI 添加版本路径，避免重复。已有环境地址优先，旧 URI 的地址只在环境没有显式值时迁移，用户明确停用时不恢复。仅 Gemini 模式使用这些条目，不能把 OpenAI Responses 地址当作 Gemini 地址。旧数组形式的说明已纠正，历史可从 `5d5d0c6` 追溯。

模型目录按 CLI 与实际目录持久缓存，成功结果在应用重启后继续使用；用户可点击重新获取，填写过配置时明确显示“保存并获取模型”。设置 GET `/api/settings/models/:agent/catalog` 只读缓存，POST 使用原生接口获取；不会探测任意服务的 /v1/models 或发送对话。Claude 使用 supportedModels，Codex 使用 model/list 并补入原生当前自定义 ID。模型列表是否列全由原生协议决定，始终允许手输。

窗口和 token 阈值文本框接受整数或十进制简写，例如 `128K`、`1M`、`1.5m`；K 为 1,000，M 为 1,000,000。保存时精确转换成原生整数，读取仍回显原生数值；空白恢复默认，负数、溢出或换算后不是整数的值拒绝保存。这里是输入格式便利，不改变各 CLI 对窗口、压缩和 maxTokens 的定义。

Codex 的自动压缩计数口径 `model_auto_compact_token_limit_scope` 和较新版本的轮末压缩百分比 `model_post_turn_compact_threshold_percent` 仍可从原始配置编辑；前者不等于窗口大小，后者不是普通自动压缩阈值的替代。常用表单不改写这些未选择字段。依据为[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)和本机 app-server 的 ConfigReadResponse schema。

## 读取与编辑边界

`GET /api/native-resources/:agent?projectId=...` 只返回已知文件与有界目录的元数据。显式打开使用 `POST /api/native-resources/:agent/:resourceId/open`，此时可能返回文件中的敏感字段；正文只在编辑器局部状态保存，不进入公共查询缓存或浏览器持久存储。

文件保存使用同一资源路径的 PUT，请求携带原文和 revision。接口按真实文件格式检查 JSON/TOML；Markdown 和 Starlark 文本只检查有效 UTF-8 与大小，后者的语义交给原生 CLI。固定资源根内可以创建规则文件或 SKILL.md，不接受任意文件路径。

正文上限 256 KiB；目录扫描总预算 4096 项、深度上限 6 层。拒绝符号链接、路径越界和已被外部修改的文件；读取失败和不存在分别显示。兼容的两文件配置接口与新接口共用路径写入队列，防止并发覆盖。

## 启动环境

`/api/settings/launch-environment/:agent` 只显示变量来源与状态，写入不回显已有值。每种 CLI 的白名单单独定义；禁止 PATH、NODE_OPTIONS、PYTHONPATH 等改变加载行为的变量。所有显式值以当前 Windows 用户的 DPAPI 密文保存，无法使用系统加密时不退回明文。

| CLI | 允许的变量 |
|---|---|
| Claude | ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN、ANTHROPIC_BASE_URL |
| Codex | OPENAI_API_KEY、OPENAI_BASE_URL |
| Antigravity | GEMINI_API_KEY、GOOGLE_GEMINI_BASE_URL、AGY_ADC_AUTH、GOOGLE_CLOUD_QUOTA_PROJECT、GOOGLE_CLOUD_LOCATION |

Antigravity 的 Gemini 密钥还需要原生 `modelProvider: "gemini"`；ADC 使用 `AGY_ADC_AUTH=true`。不把 GOOGLE_API_KEY、.env 或 SDK 专用变量当作 CLI 的同等接口。

高级启动环境仍保留继承、设置和停用的原生语义，常用模型页面不要求用户操作这些状态。保存不修改全局进程环境或打断回合；新会话使用新的启动快照，已有会话可在空闲时通过高级入口重新启动 CLI。

这些变量只传给工作台新启动的进程。用户在另一个终端直接执行 CLI 时，仍使用那个终端的环境；工作台不会修改系统环境变量。设置页会标明已有工作台覆盖，避免把原生文件中的值误当作最终有效值。

## Antigravity MCP 工具加载

默认按原生方式加载 MCP。AGY 1.5.1 的通用工具包装未限制 Arguments 的类型；部分模型服务会返回 JSON 字符串，标准 MCP 服务要求对象而拒绝执行。可以在设置的 MCP 配置文件中，对确实需要的工具启用原生 `eager`：在已有服务器项内添加 `tools: { "read_notes": { "eager": true } }`，保留原来的 command、args、env 或地址。这会让模型直接看到该工具的完整参数定义，可能增加请求长度；不需要把所有工具改为 eager。

此选项与 `permissions.allow` 是不同配置：直接加载不代表允许执行。工作台不会自动写入用户的允许规则，也不会把返回的错误参数改成猜测值。真实工具执行仍由 CLI 按用户选择的权限处理。依据为[官方加载方式](https://antigravity.google/docs/mcp/#tool-loading-lazy-vs-eager)以及本机原生 CLI 与标准 MCP SDK 对照验收。

## 依据与验证

2026-11-05 复核了本机帮助、官方配置文档和 CC Switch 当前 Direct 实现；版本升级后按真实协议调整。

- Claude：[设置](https://code.claude.com/docs/en/settings)、[规则](https://code.claude.com/docs/en/memory)、[Skills](https://code.claude.com/docs/en/skills)、[MCP](https://code.claude.com/docs/en/mcp)。
- Codex：[配置参考](https://developers.openai.com/codex/config-reference/)、[认证](https://developers.openai.com/codex/auth/)、[规则](https://developers.openai.com/codex/rules/)、[Skills](https://developers.openai.com/codex/skills/)、[插件](https://developers.openai.com/codex/plugins/)。
- Antigravity：[设置](https://antigravity.google/docs/settings/)、[定制发现](https://antigravity.google/docs/customization-discovery/)、[MCP](https://antigravity.google/docs/mcp/)、[启动认证](https://antigravity.google/docs/install/)。
- CC Switch：[Direct 原生写入](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/live/project/codex.rs)、[agy 启动配置](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/agy_config.rs)。Direct 与代理模式不同；agy 也使用子进程环境提供 Key，不能概括为所有配置都修改真实原生文件。

使用临时目录和合成 CLI 验证读写与启动接线；真实账号、模型端点和 MCP 服务的结果仍须单独记录。当前完成程度见[路线图](../roadmap.md)。
