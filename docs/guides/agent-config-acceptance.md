# 原生配置编辑验收

日期：2026-10-03。报告用 GLM 作为模型匿名标签；真实地址、模型标识、key 和配置正文只在本机隔离验收中使用，不进入仓库或报告。

## 已实现

- 顶栏“设置”按需打开 Claude/Codex 配置弹窗，使用 CodeMirror 高亮、搜索和编辑；关闭和切换前确认未保存修改，销毁编辑状态。
- 固定编辑 `CLAUDE_CONFIG_DIR/settings.json`、`CODEX_HOME/config.toml`，未设置环境变量时使用用户目录下对应原生位置。浏览器不能指定任意路径，不提供认证文件编辑。
- 最多 256 KiB，有界 UTF-8 读取，JSON 根对象 / TOML 语法校验，保留未知字段、注释和 LF/CRLF 格式。错误与 HTTP 解析错误均不回显正文片段。
- 检查读取版本摘要和文件身份，同一文件的应用内保存串行；同目录临时文件写入并原子替换，拒绝符号链接。最终校验和替换之间不承诺跨进程事务锁。
- 响应禁止缓存；配置内容不进入 React Query、浏览器持久存储、Agent 输入或服务器。正式 Codex 始终使用 `config.toml`。

## 已通过的验证

- 13 项配置服务和路由核心测试：原文、无效语法/UTF-8、容量限制、版本冲突、并发保存、文件与目录链接、外部修改、匿名错误和请求范围。
- 对应配置模块覆盖率：语句 95.45%、分支 88.59%、函数 97.05%、行 97.35%。这是新增模块的定向覆盖率，不冒充全仓覆盖率。
- 包含关联的 Claude 适配器、前端 API 的 28 项测试通过；类型、相关 ESLint/Prettier 和构建通过；重复行约 0.14%。沿用上一阶段 345 项全仓测试基准，未为无关代码重复跑全量。
- 浏览器直接请求受控本机 Fastify 配置接口：按需读取、JSON/TOML 保存、CRLF 与注释保留、语法失败不写文件、外部修改不覆盖、重新读取与放弃确认、关闭清理、无查询或持久缓存。960/1280/1920 宽度截图已查看，底部保存操作始终可见。
- `scripts/dev/e2e-claude-config.ts` 使用真实 Claude SDK/CLI 与受控本机 API。先后保存两组配置，再执行两次新 query，实际请求分别使用对应的新 API 路径，证明后续调用重读 user 配置；没有调用外部模型。
- `scripts/dev/e2e-agent-config.ts` 使用用户提供的替代配置复制到隔离 home，通过实际 Codex `config/read` 核对保存后的配置。源 `config.toml` 与替代文件摘要前后不变，隔离目录已清理。
- 脚本隔离复核：Codex 首次启动前移除副本中的 MCP、插件和通知；受控进程验证 SIGINT/SIGTERM 在 RPC 等待与模型轮次等待中的四种中断路径，子进程结束、临时配置及认证文件清理、源文件保持不变。Claude 只继承系统环境白名单，预设 Bedrock/Vertex/Foundry 开关后仍仅访问本机受控 API。

## Codex 真实调用与原生模型选择

指定的 GLM 配置原样复制到隔离 home，实际 app-server 0.156.1 完成配置重读和真实 Responses 调用，源配置摘要不变。网页适配器接入后，真实网页与 GLM 两轮进一步验证了原生 MCP `remote_peek`、原生列表/读取及原 ID 续接，详见 [Codex 对话验收](codex-conversation-acceptance.md)。临时真实密钥副本已清理，内部工具令牌未落盘且轮次结束撤销。

官方运行时的无模型调用实验确认了以下区别：

| 操作 | 实际结果 |
|---|---|
| 修改默认模型后新建 thread，不传 model | 新 thread 采用新默认模型 |
| 修改默认模型后 resume 旧 thread，不传 model | 保留原生会话原模型 |
| 用户显式选择模型 | 按显式选择覆盖 |

每轮新进程保证重读配置，不意味着历史会话自动换模型；网页实际模型只供展示，不回填为覆盖参数。GLM 已通过官方 Responses 路线，本项目不增加 Chat Completions 转换层，也不据此推断其他服务商或模型兼容性。

本阶段网页工具链的 SSH/同步使用受控替身，真实 SSH 串联与多活动并发仍未完成，不能把配置或 MCP 验收扩展为这些结论。

## 复验入口

```powershell
node --import tsx scripts/dev/e2e-claude-config.ts
node --import tsx scripts/dev/e2e-agent-config.ts --config <替代配置路径> --codex <原生codex可执行文件路径>
```

需要验证真实模型时追加 `--with-model`；只有确认接口前缀需要补充时才追加 `--api-prefix /v1`。可选 `--auth-file` 只复制运行时指定的认证文件到隔离目录，不回写原文件。脚本不会输出原始模型响应或配置诊断中的秘密。
