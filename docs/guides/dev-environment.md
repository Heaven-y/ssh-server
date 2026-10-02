# 开发环境

本文档说明开发这个仓库所需的本机环境、代码规范、项目 skill 的管理方式，以及已经发现并处理的问题。

需求、后端选型与接入边界更新于 2026-10-02，见 [需求](../product/requirements.md)、[设计决策](../engineering/decisions.md) 和 [路线图](../roadmap.md)。本轮更新文档，未安装编辑器、终端或监控依赖。

## 1. 本机环境

| 组件 | 说明 |
|---|---|
| Node.js | 22+，运行本地 TypeScript + Fastify 后端，沿用现有 tsx 启动方式 |
| git | 任意近期版本 |
| Claude Code、Codex CLI | 已安装并配置好，开发和测试都使用本机配置 |
| 本机 Python | 3.x，仅部分开发 skill 的脚本按需使用（用 `python` 调用，见 4.3）；网页后端不依赖 Python |
| rclone | M2 同步使用的本地可执行文件，接入时固定版本；服务器无需安装 |

### 1.1 代码规范

- 编码与换行：UTF-8、LF；`.ps1` 使用带 BOM 的 UTF-8（原因见 4.5）。由 `.editorconfig`、`.gitattributes` 约束。
- 保持简洁可读，必要处写注释；拆分小函数，避免重复代码和过度设计。
- 依赖固定到具体版本。
- 本机调用 Python 脚本用 `python`，不用 `python3`（原因见 4.3）；远程分析按服务器已有解释器或项目环境启动，不将本机命令限制套用到服务器。
- 涉及认证、命令执行、文件删除的改动，说明验证了什么、没验证什么。
- 优先复用成熟的库和组件，不全部手写。选用标准：
  - 社区广泛使用（star 多、下载量大），最新的库也可以；已归档或安全问题长期无人处理的不用。
  - 许可兼容：运行时依赖用 MIT / Apache-2.0 / BSD / ISC 等宽松许可，不用 GPL / AGPL；只在开发时使用、不打进产物的工具（如 lint 插件）可以是 LGPL。GPL 项目只参考设计，不复制代码。
  - 有类型定义，版本固定；不为几行代码就能完成的功能引入大依赖。
  - 黑名单、访问控制等安全边界逻辑，库的行为必须先用现有测试验证，不满足时保留手写并在 1.2 记录原因。
  - 新增或替换依赖时同步更新 1.2。

### 1.2 依赖选用记录

| 功能 | 选择 | 理由 |
|---|---|---|
| 本地后端 | Node.js + TypeScript + Fastify | 协调异步 Agent / SSH / 子进程和流式消息，复用官方 TypeScript SDK 与前后端共享类型；选型比较见设计决策 D19 |
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
| 代码检查与复杂度 | ESLint、typescript-eslint、`eslint-plugin-sonarjs`（LGPL，仅开发时使用） | 见 1.3 |
| 格式 | Prettier | — |
| 重复率 | jscpd | — |
| 覆盖率 | `@vitest/coverage-v8` | 与 Vitest 同版本 |

待引入能力不作为已安装依赖记录：终端已选 xterm.js；轻量编辑器尚未最终选型，Monaco / CodeMirror 的 React 集成为候选。具体引入时固定版本、评估许可与按需加载，并更新本表。Pebrel 仅参考界面和交互，不引入其 GPL 实现。

### 1.3 质量检查

提交前执行 `npm run check`，CI（`.github/workflows/check.yml`，Windows 与 Linux）运行同一命令。它依次执行：

| 步骤 | 命令 | 门槛 |
|---|---|---|
| 类型检查 | `npm run typecheck` | shared、server、web、scripts 全部通过 |
| 代码检查 | `npm run lint` | 0 error。圈复杂度 ≤ 10（`complexity`），认知复杂度 ≤ 15（`sonarjs/cognitive-complexity`），嵌套深度 ≤ 4，参数 ≤ 4 |
| 格式 | `npm run format:check` | Prettier 无差异；修复用 `npm run format`。Markdown 不自动排版 |
| 重复率 | `npm run dup` | ≤ 3%（50 个 token 以上算重复，不统计测试文件） |
| 测试与覆盖率 | `npm run coverage` | 全局行 / 语句 / 函数 ≥ 85%，分支 ≥ 75%；`policy/` 与 `http/security.ts` 行 ≥ 95%；`packages/shared` ≥ 90% |

- 覆盖率不统计：进程入口（`main.ts`）、需要真实 SSH 的 `ssh/pool.ts`、界面组件（`.tsx`，M1 由浏览器冒烟检查覆盖，组件测试在 M6 引入）、`lib/ws.ts`（逻辑由 partysocket 提供，状态处理在 `chat-store.test.ts` 中测试）。排除项写在根目录 `vitest.config.ts`，新增排除要写明原因。
- 超过门槛时先拆分函数、补测试；确实需要例外时用行内 `// eslint-disable-next-line <规则> -- 原因`，不放宽全局门槛。
- 报告输出到 `coverage/`（已忽略），打开 `coverage/index.html` 查看未覆盖的行。
- 当前结果（2026-10-01）：226 个测试，行覆盖 92.2%，分支 82.3%，重复 0%。

### 1.4 当前接入状态与后续验证

| 能力 | 当前状态（2026-10-02） | 后续验证 |
|---|---|---|
| SSH 认证 | 只读取 `~/.ssh/config` 与本机私钥，不支持网页密码输入 | 账号密码贯通连接测试、命令、目录、同步和终端；密码生命周期及主机密钥校验 |
| 同步 | 未接入，Agent 注入指令明确提示本地改动不会自动到服务器 | rclone 基线、过滤、删除确认、冲突，以及执行前失败阻断 |
| Claude 会话 | SDK 原生续接、列表和消息显示已接入 | 真实模型链路、skills / 命令选择、上下文 / 压缩状态 |
| Codex | 本机 CLI 0.156.1 协议已核对，网页适配器未接入 | 固定 Agent、官方 skills / 控制接口、审批和历史一致性 |
| 编辑器 / 终端 / 资源面板 | 未接入 | 轻量编辑与同步、PTY 全屏显示、SSH 指标与采样开销 |

这里的接口核对与此前测试记录不能替代真实模型 / SSH 验收；详细事项见 [架构第 8 节](../engineering/architecture.md#8-待验证事项)。

### 1.5 后端职责、远程 Python 与并发

后端继续采用 Node.js + TypeScript + Fastify，负责访问控制、Agent 适配、SSH、同步、文件 / 版本操作及状态转发。服务器项目使用 Python 不要求网页后端采用 Python；统计、绘图和结果处理默认通过 SSH 使用项目已有环境。新分析脚本先同步，再执行，只回传必要统计或小文件；缺少环境 / 依赖时明确报告，不在服务器安装。

Agent 流、SSH 通道、子进程输出和文件操作使用异步接口，避免在请求处理路径使用阻塞式命令和重计算。同一会话只运行一轮；同一工作区同步串行，执行前必须等待自身同步成功；终端和资源采样可独立进行。对话 / 终端 / 采样 / 同步同时运行时的响应、超时及输出缓冲需在相关功能接入后验证，当前尚不能宣称完整并发链路通过。

当前按 Node.js 本地启动，不增加 Go 工具链、独立 `.exe` 或安装器开发。Go 的编译分发和 goroutine 只属于选型比较，外部 Agent CLI、git、rclone 仍有各自依赖。详细约定见 [架构第 2 节](../engineering/architecture.md#2-技术栈) 与 [设计决策第 8 节](../engineering/decisions.md#8-后端选型分析位置与运行边界)。

## 2. 项目 skill

开发本仓库时，Agent 使用的 skill 只安装在项目内，不安装到全局，也不提交到仓库。

本节限制的是开发本仓库所安装的 skills。产品内的聊天能力另按所选 Claude / Codex 官方运行时发现用户本机和工作区已有 skills / 命令，不要求用户重新安装，不修改全局配置，不复制到服务器。

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
- M1 前端验收暂用会话临时目录中的 `playwright-core` 驱动本机 Edge（`executablePath` 指向 `msedge.exe`，不下载浏览器、不进仓库）。PI-Desktop 内置浏览器面板不可用时用这种方式。

### 4.7 Bash 工具结束时会结束后台进程

- 在一次命令里用 `Start-Process` 启动的后端和 Vite，会在该命令返回后被结束。需要先启动服务再验收时，把启动、验收、`Stop-Process` 写在同一条命令里（用 `try/finally` 保证关闭）。

### 4.8 前端打包体积

- `vite build` 提示主包约 890 kB（gzip 约 270 kB，主要来自 streamdown 的 Markdown 解析）。本机使用影响很小，暂不拆包；后续引入代码高亮等再评估按需加载。

### 4.9 jscpd 只报告精确重复

- jscpd 按 token 序列匹配：整段复制会被发现（自检：复制 `shell.ts` 后报 23% 重复并失败），但改了类名或几行代码的"近似重复"不一定能发现。它只是底线检查，代码评审时仍要留意相似逻辑。
- 在 PowerShell 中 `npx jscpd` 会把 "Using config" 提示写到 stderr，不影响退出码；以 `$LASTEXITCODE` 判断结果。

### 4.10 M1 真实验收脚本缺失

- 2026-10-02 核对：`package.json` 中有 `e2e:m1` 脚本，但 `scripts/dev/e2e-m1.ts` 尚未创建，因此目前不能直接运行它完成验收。
- `scripts/dev/ssh-smoke.ts` 只能验证直接 SSH 执行，不能证明 Claude → MCP → 后端 → SSH 的完整链路。
- Task 11 仍需补脚本，在可用 SSH Host 上执行真实 Agent 验收和浏览器端到端，再记录结论；不能仅凭单元测试通过将 M1 标为完成。

## 5. 开发运行与验收说明

- Windows PowerShell 可用 `npm.cmd run dev` 启动后端与 Vite，或用 `npm.cmd start` 构建前端后启动本地服务；访问控制和启动参数见 [M1 设计](../superpowers/specs/2026-10-01-m1-minimal-chain-design.md)。
- 当前 M1 的真实 SSH 检查可使用 `node --import tsx scripts/dev/ssh-smoke.ts my-server`，需已有本机 Host、可读私钥和 `known_hosts` 条目。此处是命令用法，不表示本轮已执行远程检查。
- 产品目标支持账号密码，无须先设置私钥；当前代码尚未具备该入口，实施时不得把“必须免密”延续为最终使用前提。
- 开发密码认证时不读取或提交真实凭据，不将密码传给 Agent、日志、命令行参数或磁盘临时文件。rclone 与 ssh2 的认证方式、主机密钥校验和重连行为一并验证。
- `/` 命令、压缩和资源状态按官方接口 / 服务器实际能力验证。终端测试使用服务器已有工具，不为了 `nvitop` 或监控而在服务器安装软件。
- 远程分析验证使用已有 Python / 项目环境，不为网页版安装科学计算依赖；对话、终端、资源采样与同步的并发验证按相关里程碑进行，参照架构 V16、V17。
- 文档修改只检查链接、编号、编码、冲突表述与变更范围；代码改动再按受影响范围运行相关测试及工程检查，不重复未受影响的全量测试。
