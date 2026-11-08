# 模型身份、上下文与推理强度

更新于 2026-11-08。本页只记录已核对的模型元数据和工作台的匹配规则。原生 CLI 返回的目录优先；官方资料只补全原生没有报告的、且能精确匹配的型号。未知强度保留图标入口，不按模型家族猜测。

## 工作台显示规则

- 模型选择值、显示名称和底层真实型号是三个字段。输入区使用 CLI 图标和具体型号，目录标签仅保留作搜索信息，发送时保留 CLI 选择值原样。
- 没有显式覆盖时按原生会话配置、最近会话报告和原生默认依次显示已有型号；全都未知时仅显示模型入口图标。这些显示值不会被写入下一轮请求，最近实际运行的型号也在菜单中独立标注。
- Claude 的 `sonnet[1m]`、`opus[1m]`、`opusplan[1m]` 等后缀属于原生选择值。匹配能力时可去掉后缀，发送时必须保留后缀；显示上下文型号时也保留 `[1m]`，按钮独立显示 1M 标记。后缀表示原生选择，实际窗口仍以 CLI 报告为准；没有后缀不等于只有 200K，部分新型号原生就是 1M，禁用扩展上下文等原生设置也会影响窗口。
- 推理强度先显示会话中的显式选择，其次显示适用于当前型号的已知配置档位；未确定时只显示强度图标。旧会话没有报告强度时不套用新会话的默认值。未选择或重置后不添加请求覆盖；仅原生报告支持的 `auto` 才作为“自动”档位列出并发送。Claude 自适应思考不属于此档位。
- 原生目录明确返回空数组时隐藏强度入口，并在当前回合空闲时清除旧强度选择，不会用文档或常用档位覆盖。目录没有报告时才允许精确的文档规则生效。

Claude 模型菜单提供“默认窗口 / 1M”。只有点击 1M 才生成对应 `[1m]` 选择，打开菜单不更改模型；已有原生后缀继续继承。切回默认窗口移除显式后缀；别名自身绑定后缀时改用去掉后缀的明确型号，不改原生别名配置。切换保留当前推理强度，不将“默认窗口”固定解释为 200K。

## 已核对的精确规则

| 来源或型号 | 可显示的档位 | 上下文或其他限制 |
|---|---|---|
| GPT-6 Astra | low、medium、high、xhigh、max | 官方模型页报告约 1.05M context；仅在 Codex 目录没有档位时按精确型号补全 |
| GPT-6.1 Sol | low、medium、high、xhigh、max | 官方模型页报告约 1.05M context，medium 为文档默认；仅作说明，不覆盖原生默认 |
| Claude Opus/Sonnet/Haiku 5.5、Opus 5、Sonnet 5、Opus 4.8/4.7、Fable 5.1/5 | low、medium、high、xhigh、max | Claude Code 目录可针对组织限制返回更窄集合 |
| Claude Opus 4.6、Sonnet 4.6 | low、medium、high、max | `xhigh` 不发送；`[1m]` 可能是开启百万上下文的选择后缀 |
| DeepSeek V4 Flash、V4 Pro、V4.1 Flash | low、high、max | 具体服务商可能使用 `deepseek-flash` 等新 ID；未精确匹配时跟随配置 |
| Kimi K3、K3.1 Pro、K3.1 Pro Highspeed | low、high、max | K3 系列始终思考；K2.6、K2.7-code 没有 reasoning effort 档位 |
| GLM-5.2 | high、max（服务商可接受更宽输入并映射） | 只对明确的 GLM-5.2 精确 ID 补全 |
| GLM-5.3 | low、high、max | reasoning_effort 只在思考开启时有效 |
| Qwen3.8 Max/Flash 及列出的同系列 ID | none、low、medium、xhigh | 官方兼容 Responses 页记录其余档位映射到这四档 |
| Antigravity 原生模型变体 | 由同族 `-low/-medium/-high/-xhigh/-max` 目录项决定 | 自定义配置键不从底层 Gemini 名称猜档位；`--effort` 仅发送用户选择的原生档位 |

DeepSeek、Kimi、GLM、Qwen 的兼容协议字段并不相同。当前文档补全不冒充提供方完整握手：Claude 使用 SDK effort，Codex 使用 turn/start effort 与原生 Responses 映射，Antigravity 使用原生变体。未核实 Messages 映射的 GLM/Qwen 不为 Claude 补档；提供方额外别名、快照或未知版本只采用原生报告。工作台只负责 CLI 能接收的字符串；`thinking` 开关、`thinking_budget` 和 `reasoning.effort` 不在没有适配证据时互相转换。

## 各 CLI 的窗口设置

| CLI | 窗口与压缩控制 | 当前入口 |
|---|---|---|
| Claude | `[1m]` 是模型选择后缀，模型本身也可能原生支持 1M；压缩控制按 Claude 原生字段处理 | 对话模型菜单选择默认窗口/1M；其他原生压缩参数在原始配置编辑 |
| Codex | `model_context_window` 声明窗口，`model_auto_compact_token_limit` 设置自动压缩 token 阈值 | 模型设置中分别填写，留空使用原生默认；计数范围和轮末百分比仍在原始配置编辑 |
| Antigravity | 自定义模型的 `maxTokens`，内置型号沿用原生元数据 | Gemini 自定义模型设置；没有经核实的通用压缩阈值表单 |

配置声明和原生统计分开：用户填大数不会扩大服务端模型的真实容量，页脚始终展示 CLI 实际报告。

## 缓存与刷新

模型目录按 CLI 和规范化工作区目录落盘，v2 格式保存默认值与底层型号；旧 v1 的候选先显示，首次打开菜单补取一次元数据。应用重新打开时优先读取缓存。输入区挂载后会先读取缓存；首次打开模型或推理菜单且缓存标记为未发现时才触发一次原生发现。菜单中的“刷新模型列表”才会主动重新读取，配置保存会清除相应 CLI 的缓存代次。缓存只保存模型元数据、底层型号和默认值，不保存技能正文、路径、诊断或密钥。

## 资料来源

- [OpenAI GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [OpenAI GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [Claude Code model configuration](https://code.claude.com/docs/en/model-config.md)
- [Claude API effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [DeepSeek API](https://api-docs.deepseek.com/)
- [Kimi reasoning effort](https://platform.kimi.ai/docs/guide/use-reasoning-effort)
- [GLM core parameters](https://docs.z.ai/guides/overview/concept-param)
- [Qwen Responses compatibility](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)
- [Antigravity effort](https://antigravity.google/docs/cli/commands/effort) 与 [headless](https://antigravity.google/docs/cli/headless/)；本机 `agy --help` 确认 `--effort` 参数枚举。

以上资料用于候选菜单提示，不替代本机 CLI 的实际能力报告。真实账号和模型请求仍按路线图中的受控验证边界执行。
