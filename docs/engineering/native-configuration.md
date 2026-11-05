# 原生配置与启动环境

以各 CLI 的原生文件与加载规则为准。界面负责定位、读取和保留原文的编辑；是否信任项目、是否启动 MCP、如何合并规则和权限仍由 CLI 决定。

## 配置入口

| CLI | 设置 | 规则与技能 | MCP 和原生插件 |
|---|---|---|---|
| Claude Code | 用户 settings.json；项目 .claude/settings.json 与 settings.local.json | CLAUDE.md、CLAUDE.local.md、条件回退 AGENTS.md；原生 rules/skills 目录 | 项目 .mcp.json；用户及个人项目 MCP 使用原生命令，避免编辑混合状态文件；插件管理使用原生入口 |
| Codex | 用户 config.toml 和受信任项目 .codex/config.toml | AGENTS.md/AGENTS.override.md、Starlark .rules、.agents/skills | MCP 保留在对应 TOML；插件由原生管理器维护 |
| Antigravity | 全局 .gemini/antigravity-cli/settings.json | AGENTS.md/GEMINI.md、.agents/rules/skills 及官方共享目录 | 全局与项目独立 mcp_config.json、hooks.json 和定制发现清单；不制造项目 settings 层 |

用户配置根尊重 Claude 的 CLAUDE_CONFIG_DIR 和 Codex 的 CODEX_HOME；Codex 共享 Skills 的用户目录仍是 ~/.agents/skills。项目与子目录按真实来源标注，列表不会把工作台当前选择解释成原生最终生效顺序。

原生插件不同于工作台插件。配置页显示原生路径、作用域和相应命令说明，不直接改写安装缓存，也不把需要交互的 TUI 命令当作普通模型消息。

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

## 依据与验证

2026-11-04 核对了本机帮助和官方文档；路径及作用域依据以下来源，升级后按实际协议调整。

- Claude：[设置](https://code.claude.com/docs/en/settings)、[规则](https://code.claude.com/docs/en/memory)、[Skills](https://code.claude.com/docs/en/skills)、[MCP](https://code.claude.com/docs/en/mcp)。
- Codex：[配置](https://developers.openai.com/codex/config-basic/)、[规则](https://developers.openai.com/codex/rules/)、[Skills](https://developers.openai.com/codex/skills/)、[插件](https://developers.openai.com/codex/plugins/)。
- Antigravity：[设置](https://antigravity.google/docs/settings/)、[定制发现](https://antigravity.google/docs/customization-discovery/)、[MCP](https://antigravity.google/docs/mcp/)、[启动认证](https://antigravity.google/docs/install/)。

使用临时目录和合成 CLI 验证读写与启动接线；真实账号、模型端点和 MCP 服务的结果仍须单独记录。当前完成程度见[路线图](../roadmap.md)。
