# 开发环境

本文档说明开发这个仓库所需的本机环境、代码规范、项目 skill 的管理方式，以及已经发现并处理的问题。

## 1. 本机环境

| 组件 | 说明 |
|---|---|
| Node.js | 22+ |
| git | 任意近期版本 |
| Claude Code、Codex CLI | 已安装并配置好，开发和测试都使用本机配置 |
| Python | 3.x，部分 skill 的脚本需要（用 `python` 调用，见 4.3） |

### 1.1 代码规范

- 编码与换行：UTF-8、LF；`.ps1` 使用带 BOM 的 UTF-8（原因见 4.5）。由 `.editorconfig`、`.gitattributes` 约束。
- 保持简洁可读，必要处写注释；拆分小函数，避免重复代码和过度设计。
- 依赖固定到具体版本。
- 调用 Python 脚本用 `python`，不用 `python3`（原因见 4.3）。
- 涉及认证、命令执行、文件删除的改动，说明验证了什么、没验证什么。
- 优先复用成熟的库和组件，不全部手写。选用标准：近一年内有发布、许可兼容（MIT / Apache-2.0 / BSD 等，不用 AGPL）、有类型定义、版本固定；不为几行代码就能完成的功能引入大依赖。黑名单、访问控制等安全边界逻辑，库的行为必须先用现有测试验证，不满足时保留手写并在 1.2 记录原因。新增或替换依赖时同步更新 1.2。

### 1.2 依赖选用记录

| 功能 | 选择 | 理由 |
|---|---|---|
| `~/.ssh/config` 解析与 Host 匹配 | `ssh-config`（MIT） | 按 OpenSSH 规则处理引号、`Key=value`、通配符、`!` 取反和先出现优先；本项目只额外去掉 `Match` 块并标记不支持的选项 |
| 命令黑名单分词（`policy/shell.ts`） | 手写 | `shell-quote` 把换行当作空白而不是命令分隔，`echo x` 换行后接 `sudo ...` 会被当成一条命令，绕过黑名单 |
| known_hosts 校验（`ssh/known-hosts.ts`） | 手写 | ssh2 不提供 known_hosts 解析；逻辑约 100 行，含哈希条目与 `@revoked`，已有测试覆盖 |
| 远程命令拼装、工作区存储、访问控制 | 手写 | 项目特有逻辑，代码量小 |
| SSH 连接、HTTP、WebSocket、MCP、Agent | ssh2、Fastify、@fastify/websocket、@modelcontextprotocol/sdk、Claude Agent SDK | — |
| 前端接口数据（加载、错误、刷新） | `@tanstack/react-query` | 替代手写的 loading / error 状态与刷新逻辑 |
| 前端 WebSocket 断线重连 | `partysocket` | 自带退避重连与发送缓冲 |
| 对话区贴底滚动 | `use-stick-to-bottom` | 流式输出时贴底、用户上翻时停止，提供"回到底部"状态 |
| Markdown 流式渲染 | `streamdown` | 处理未闭合的 Markdown |
| 前端全局状态 | `zustand` | — |
| 图标、字体 | `lucide-react`、fontsource | — |

## 2. 项目 skill

开发本仓库时，Agent 使用的 skill 只安装在项目内，不安装到全局，也不提交到仓库。

### 2.1 安装

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev\install-skills.ps1
```

脚本使用 [vercel-labs/skills](https://github.com/vercel-labs/skills)（`npx skills`，固定为 1.7.0），同时为 Claude Code 和 Codex 安装，并关闭它的匿名统计（`DISABLE_TELEMETRY=1`）。

### 2.2 安装内容

| 来源 | skill | 许可证 |
|---|---|---|
| obra/superpowers | 全部 15 个（brainstorming、writing-plans、executing-plans、test-driven-development、systematic-debugging、requesting-code-review、receiving-code-review、verification-before-completion 等） | MIT |
| vercel-labs/agent-skills | vercel-react-best-practices | MIT |
| anthropics/skills | webapp-testing | Apache-2.0 |
| anthropics/claude-plugins-official | build-mcp-server | Apache-2.0 |
| nextlevelbuilder/ui-ux-pro-max-skill | ui-ux-pro-max | MIT |

### 2.3 文件布局

```text
.agents/skills/<名称>/        # 真实文件，Codex 从这里读取
.claude/skills/<名称>         # 目录链接（junction），指向上面的目录，Claude Code 从这里读取
skills-lock.json              # 记录每个 skill 的来源和内容哈希
```

以上三项都在 `.gitignore` 中。目录链接由 `npx skills` 自动创建，不需要管理员权限。

### 2.4 日常管理

| 操作 | 命令 |
|---|---|
| 查看 | `npx skills@1.7.0 ls -a claude-code -a codex` |
| 更新 | `npx skills@1.7.0 update -p` |
| 删除 | `npx skills@1.7.0 remove <名称>` |
| 新增 | 把来源加进 `scripts/dev/install-skills.ps1`，再运行一次脚本 |

注意：`update` 会更新到上游最新版本。`skills-lock.json` 只记录来源和内容哈希，不记录提交号。

## 3. 验证记录

2026-10-01 安装后验证：

- `.agents/skills/` 下 19 个目录，`.claude/skills/` 下 19 个目录链接，没有失效链接；全局目录 `~/.claude/skills`、`~/.codex/skills`、`~/.agents/skills` 没有新增内容。
- Claude Code：`claude -p ... --output-format stream-json --verbose` 的 init 事件中列出了全部 19 个项目 skill。直接问模型"有哪些 skill"时它可能回答"没有"，这是模型的自我描述，不代表 skill 未加载。
- Codex：`codex exec --sandbox read-only` 列出的项目 skill 正好是这 19 个。

## 4. 已知问题与处理

### 4.1 superpowers 不会自动启用

- 现象：superpowers 原本通过插件的 SessionStart 钩子，在每个会话开头注入 `using-superpowers`。项目以 skill 文件方式安装，没有这个钩子。
- 处理：在 `AGENTS.md`（`CLAUDE.md` 引用它）中要求开始任务前先阅读 `using-superpowers`。
- 验证（2026-10-01）：Codex 和 Claude Code 执行任务时，第一个动作都是读取 `.agents/skills/using-superpowers/SKILL.md`。

### 4.2 ui-ux-pro-max 的脚本路径

- 现象：它的 SKILL.md 中脚本路径写作 `${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py`。这个变量只在插件方式安装时才有值，项目级安装下为空，路径不成立。
- 实测（2026-10-01）：
  - Codex：自行解析为 `.agents/skills/ui-ux-pro-max/scripts/search.py`，第一次执行就成功。
  - Claude Code：第一次猜成 `.claude/skills/...` 下的路径并在命令中引用 `$CLAUDE_PLUGIN_ROOT`，被权限检查拦下；之后重新读取 SKILL.md、搜索文件，改用 `.agents/skills/...` 路径后成功。能完成，但多走了几步。
- 处理：不修改第三方文件（否则每次 `update` 都会被覆盖），改为在 `AGENTS.md` 和 `CLAUDE.md` 中写明路径映射：`${CLAUDE_PLUGIN_ROOT}/.claude/skills/<名称>/...` 对应 `.agents/skills/<名称>/...`。
- 复测（2026-10-01，规则加入后）：Claude Code 依次读取 `using-superpowers`、`ui-ux-pro-max` 的 SKILL.md，第一次就执行 `python .agents/skills/ui-ux-pro-max/scripts/search.py ...` 并成功，不再引用 `$CLAUDE_PLUGIN_ROOT`，问题已解决。

### 4.3 `python3` 不可用

- 现象：本机 `python3` 指向 Windows 应用商店占位程序，执行无输出。
- 处理：`AGENTS.md` 中规定 Python 脚本统一用 `python` 调用。

### 4.4 `npx.ps1` 无法正确传递数组参数

- 现象：在 PowerShell 脚本中用 `& npx @args` 调用时，npm 收到的命令变成 `px ...`，报 `could not determine executable to run`。
- 处理：`scripts/dev/install-skills.ps1` 改为调用 `npx.cmd`。

### 4.5 PowerShell 脚本中文乱码

- 现象：Windows PowerShell 5.1 按系统代码页读取不带 BOM 的 `.ps1` 文件，中文字符串会乱码。
- 处理：`.ps1` 文件保存为带 BOM 的 UTF-8，`.editorconfig` 中单独设置。

### 4.6 webapp-testing 依赖未安装

- webapp-testing 需要 Python 版 Playwright（`pip install playwright` 并安装浏览器），开始写端到端测试时再安装，并在本文档补充步骤。
