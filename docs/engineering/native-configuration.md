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

设置左侧分别提供 Claude Code、Codex、Antigravity，右侧显示模型和连接字段。表单不另存一份模型默认，不读取 CC Switch 的私有数据库，也不代理模型请求。

| CLI | 表单写入 | 认证与地址 |
|---|---|---|
| Claude | 用户 settings.json 的 model，以及 env 中的 Sonnet/Opus/Haiku 模型映射 | ANTHROPIC_BASE_URL、ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN 写原生 env；账号登录继续由 CLI 管理 |
| Codex | 用户 config.toml 的 model、model_provider 与所选 model_providers 表 | 自定义服务的 base_url 与 Responses 协议；Key 可写 experimental_bearer_token，或用 env_key 引用原生推荐的环境变量；OpenAI 登录凭据不改写 |
| Antigravity | 全局 settings.json 的 model、modelProvider | 默认模型按原生显示名称填写；Gemini 模式同时需要 GEMINI_API_KEY，地址为 GOOGLE_GEMINI_BASE_URL；两者在启动环境入口配置 |

Codex 的 provider、端点与认证放在用户配置。当前原生版本会忽略项目 .codex/config.toml 中的这些字段，不能把项目表单当作有效服务商切换。已有高级认证命令、认证请求头、云认证以及内置服务商保持原生配置；简单 Key 表单不能覆盖。TOML 使用 AST 范围修改指定字段，保留注释、未知表、换行和 BOM；不能安全修改的结构转原文编辑，不整体重新序列化。JSON 表单保留未知字段、缩进与换行习惯。

`/api/settings/models/:agent` 返回允许的表单字段及密钥是否存在，秘密值不回填、不进入查询缓存；保存只提交字段变化与 revision。密码输入留空表示保留，清除必须单独操作。直接写入 Claude/Codex 原生文件的 Key 遵循其明文文件格式；与工作台启动环境的 DPAPI 密文存储不同。保存复用资源服务的路径核对、文件锁与原子替换。

保存后，新的 CLI 进程读取更新文件；当前会话显式模型、托管规则或原生更高优先级配置仍可能覆盖默认值，运行中的进程不会被强制切换。服务端与前端同时清理对应 CLI 的模型能力缓存，并拒绝旧刷新结果回填；下一次打开菜单按原生接口重新发现。

Antigravity 的自定义 Gemini 模型位于 `customModelsConfig.customModels`，每项使用原生 `gemini-api://<base_url>/models/<model>` 与可选 label；可从原始配置编辑。它仅在 Gemini 模式且 Key 存在时启用，账号模式不读取。工作台没有从 `agy models` 的人读清单猜测稳定 ID。

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

配置区分继承、显式配置、停用与未设置。保存不修改当前进程的全局环境，不打断正在运行的回合；新会话使用新的启动快照，已有会话在空闲回收或用户点击「重新启动 CLI」后重新加载。重启入口不发送消息，忙时返回 409。

这些变量只传给工作台新启动的进程。用户在另一个终端直接执行 CLI 时，仍使用那个终端的环境；工作台不会修改系统环境变量。设置页会标明已有工作台覆盖，避免把原生文件中的值误当作最终有效值。

## 依据与验证

2026-11-05 复核了本机帮助、官方配置文档和 CC Switch 当前 Direct 实现；版本升级后按真实协议调整。

- Claude：[设置](https://code.claude.com/docs/en/settings)、[规则](https://code.claude.com/docs/en/memory)、[Skills](https://code.claude.com/docs/en/skills)、[MCP](https://code.claude.com/docs/en/mcp)。
- Codex：[配置参考](https://developers.openai.com/codex/config-reference/)、[认证](https://developers.openai.com/codex/auth/)、[规则](https://developers.openai.com/codex/rules/)、[Skills](https://developers.openai.com/codex/skills/)、[插件](https://developers.openai.com/codex/plugins/)。
- Antigravity：[设置](https://antigravity.google/docs/settings/)、[定制发现](https://antigravity.google/docs/customization-discovery/)、[MCP](https://antigravity.google/docs/mcp/)、[启动认证](https://antigravity.google/docs/install/)。
- CC Switch：[Direct 原生写入](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/live/project/codex.rs)、[agy 启动配置](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/agy_config.rs)。Direct 与代理模式不同；agy 也使用子进程环境提供 Key，不能概括为所有配置都修改真实原生文件。

使用临时目录和合成 CLI 验证读写与启动接线；真实账号、模型端点和 MCP 服务的结果仍须单独记录。当前完成程度见[路线图](../roadmap.md)。
