# 开发环境

本文档说明开发这个仓库所需的本机环境、代码规范、项目 skill 的管理方式，以及已经发现并处理的问题。

需求与实现进度更新于 2026-10-05，见 [需求](../product/requirements.md)、[设计决策](../engineering/decisions.md) 和 [路线图](../roadmap.md)。认证同步、Claude/Codex 对话与原生能力、原生配置、文件编辑、本地版本记录、远端文件管理、终端、资源、布局与本轮改动已接入。真实SSH/rclone、双Agent编辑、原生长负载和多活动组合已验，原生界面缺口与工具限制见[完整链路验收](real-workflow-acceptance.md)。

## 1. 本机环境

| 组件 | 说明 |
|---|---|
| Node.js | 22+，运行本地 TypeScript + Fastify 后端，沿用现有 tsx 启动方式 |
| Git | 2.43+，本地版本恢复需要 `GIT_ATTR_SOURCE` 支持目标提交属性 |
| Claude Code、Codex CLI | 已安装并配置好，产品沿用本机原生配置；Codex app-server 本阶段验证版本为 0.156.1，验收使用指定配置的隔离副本 |
| 本机 Python | 3.x，仅部分开发 skill 的脚本按需使用（用 `python` 调用，见 4.3）；网页后端不依赖 Python |
| rclone | 本机固定 1.75.1；通过 PATH 或 `SSH_SERVER_RCLONE` 指定，服务器无需安装 |

### 1.1 代码规范

- 编码与换行：UTF-8、LF；`.ps1` 使用带 BOM 的 UTF-8（原因见 4.5）。由 `.editorconfig`、`.gitattributes` 约束。
- 保持简洁可读，必要处写注释；拆分小函数，避免重复代码和过度设计。
- 依赖固定到具体版本。
- Windows 调用 Python 显式启用 UTF-8，使用 `python -X utf8`；由程序启动的子进程设置 `PYTHONUTF8=1`，文本 I/O 指定 `encoding='utf-8'`。远程分析沿用服务器已有解释器或项目环境。
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
| Codex 对话与历史 | 已安装的官方 app-server 0.156.1，stdio JSON-RPC | 复用原生配置、会话、审批与上下文；每轮及历史读取独立启动，不增加模型协议转换层 |
| 前端接口数据（加载、错误、刷新） | `@tanstack/react-query` | 替代手写的 loading / error 状态与刷新逻辑 |
| 前端 WebSocket 断线重连 | `partysocket` | 自带退避重连与发送缓冲 |
| 对话长列表与贴底 | `react-virtuoso` 4.18.16（MIT） | 动态高度虚拟列表、流式贴底与用户上翻停止，取代早期use-stick-to-bottom；采用官方跟随/定位API，展开状态保存在列表外 |
| Git差异与行反馈 | `@pierre/diffs` 1.5.1（Apache-2.0） | React19兼容，官方patch解析与侧别行号、按需加载；GitHub高对比双主题实测，失败保留有界原文本 |
| Markdown 流式渲染 | `streamdown` | 处理未闭合的 Markdown |
| 原生配置语法校验 | `smol-toml` 1.9.0（BSD-3-Clause）与原生 JSON 解析 | 校验语法后保存原文，保留未知字段、注释和格式，不自行实现 TOML |
| 轻量编辑组件 | `@uiw/react-codemirror` 4.25.12、CodeMirror 6 JSON / TOML / 脚本语言扩展、`@codemirror/lang-markdown` 6.5.2（MIT） | 按需加载，原生配置与项目文件共用；支持 Python、JS/TS、Shell、YAML、Markdown 高亮及搜索 |
| 前端全局状态 | `zustand` | — |
| 输入命令补全 | `@ariakit/react` 0.4.40（MIT） | 复用 combobox 的焦点、键盘与浮层定位，支持 textarea；仅从 combobox 子入口导入，保持现有视觉样式 |
| 图标、字体 | `lucide-react`、fontsource | — |
| 代码检查与复杂度 | ESLint、typescript-eslint、`eslint-plugin-sonarjs`（LGPL，仅开发时使用） | 见 1.3 |
| 格式 | Prettier | — |
| 重复率 | jscpd | — |
| 覆盖率 | `@vitest/coverage-v8` | 与 Vitest 同版本 |

待引入能力不作为已安装依赖记录：终端已选 xterm.js，正式接入时固定版本并验证许可与按需加载。Pebrel 仅参考界面和交互，不引入其 GPL 实现。

### 1.3 质量检查

`.superpowers/` 保存本机执行记录与临时验收材料，不属于产品源码；Git、ESLint 和 Prettier 均排除该目录。

按变更影响范围执行相关检查；跨包测试布局或全局配置变更统一执行完整检查，后续只复验受影响部分。`npm run check` 提供完整门禁，CI（`.github/workflows/check.yml`，Windows 与 Linux）运行同一命令。它依次执行：

| 步骤 | 命令 | 门槛 |
|---|---|---|
| 类型检查 | `npm run typecheck` | shared、server、web、scripts 全部通过 |
| 代码检查 | `npm run lint` | 0 error。圈复杂度 ≤ 10（`complexity`），认知复杂度 ≤ 15（`sonarjs/cognitive-complexity`），嵌套深度 ≤ 4，参数 ≤ 4 |
| 格式 | `npm run format:check` | Prettier 无差异；修复用 `npm run format`。Markdown 不自动排版 |
| 重复率 | `npm run dup` | ≤ 3%（50 个 token 以上算重复，不统计测试文件） |
| 测试与覆盖率 | `npm run coverage` | 全局行 / 语句 / 函数 ≥ 85%，分支 ≥ 75%；`policy/` 与 `http/security.ts` 行 ≥ 95%；`packages/shared` ≥ 90% |

- 覆盖率不统计：进程入口（`main.ts`）、需要真实 SSH 的 `ssh/pool.ts`、界面组件（`.tsx`，由浏览器验收覆盖，组件测试在 M6 引入）、`features/ssh/use-ssh-connection.ts`（从原 SSH `.tsx` 组件抽出的交互 Hook，沿用同一浏览器验收范围）、`lib/ws.ts`（逻辑由 partysocket 提供，状态处理在 `chat-store.test.ts` 中测试）。排除项写在根目录 `vitest.config.ts`，新增排除要写明原因；目录拆分不改变既有覆盖率门槛。
- 超过门槛时先拆分函数、补测试；确实需要例外时用行内 `// eslint-disable-next-line <规则> -- 原因`，不放宽全局门槛。
- 报告输出到 `coverage/`（已忽略），打开 `coverage/index.html` 查看未覆盖的行。
- 认证同步基础的基准为 39 个测试文件、334 项测试及完整工程门禁通过。本轮迁移后统一验证基准，再针对路径、SSH 和接口变更增量检查；最终结果见 [M2 验收记录](m2-acceptance.md)。

测试放各包独立的 `tests/`，与 `src/` 的模块路径对应；新增测试只覆盖核心行为和实际回归，复用现有路径，避免重复断言。需要绝对路径的本机 fixture 用 `path.resolve` / 临时目录生成，不写死开发机路径；协议和安全边界的路径字面量保留其测试意义。执行相关测试示例：`npm test -- apps/server/tests/ssh apps/server/tests/http/ssh.routes.test.ts`。目录总览见 [架构第 3 节](../engineering/architecture.md#3-仓库结构)。

向导Hook生命周期回归使用固定版本Testing Library React 16.3.3、DOM 10.4.2及jsdom 27.4.0，在单个测试文件指定jsdom；其他纯函数仍使用node环境。选择27.4.0是为兼容现有Node 22.20，更新版本30.1.2要求22.22.2以上；不提高项目运行时要求，不排除新增Hook覆盖率。实际网页交互继续由浏览器验收补充。

### 1.4 当前接入状态与后续验证

| 能力 | 当前状态（2026-10-05） | 证据与剩余边界 |
|---|---|---|
| SSH 认证 | 私钥/密码、Windows加密保存、断开暂停、显式复用和取消保存已接入；向导及密码后端重建组合通过 | 密码采用本机网关透传真实远端通道，不代表更改服务器认证设置 |
| 同步 | rclone过滤、删除确认、冲突保留、执行前后同步与多活动串行通过 | 较长Windows配置路径的状态文件名限制见4.13 |
| Claude 会话 | SDK 0.3.286 / CLI 2.1.286 已接入；真实编辑、SSH/rclone执行通过 | A8独立客户端刷新仍待验 |
| Codex | app-server 0.160.0真实MCP单次审批、编辑/执行、原ID续接及长负载压缩通过 | A8独立客户端刷新仍待验；只支持本产品空字段工具确认 |
| 文件编辑 / 本地版本 | CodeMirror保存、原生Git历史与单文件恢复、真实两端同步通过 | 保留未保存编辑缓冲、HEAD/index和删除确认边界 |
| 远端文件管理 | 双视图、分页、直接操作、同/跨FS大文件、实际混合迁移及Firefox磁盘下载通过 | Edge系统选择器未验；真实断线未扩大受控故障范围 |
| 终端 / 资源面板 | 独立PTY、全屏htop/nvitop、资源两帧及实际Agent/文件任务组合通过 | 原生OS输入法未验；隐藏状态沿用受控网页证据 |

这里的接口核对与此前测试记录不能替代真实模型 / SSH 验收；详细事项见 [架构第 8 节](../engineering/architecture.md#8-待验证事项)。

Codex 对话的真实模型证据、受控审批/中断及浏览器范围见 [对话验收记录](codex-conversation-acceptance.md)。每次调用重读配置，但新 thread 才采用新默认模型；原生 resume 保留历史模型，显式选择才覆盖。A5/A13/A7已补齐[实际服务器复验](real-workflow-acceptance.md)，早期受控证据仍保留原范围。

原生会话管理使用临时合成记录完成真实 SDK/app-server 与网页验收，未调用模型、SSH 或操作用户历史，见 [会话管理验收](session-management-acceptance.md)。本机 Codex 0.156.1 不支持直接重命名归档记录，需先恢复；A8 仅确认网页和原生存储/API 更新，插件界面及 CLI 交互列表仍待独立验证。

能力目录按需读取且只缓存公开元数据，配置保存失效对应 Agent 的目录；技能/命令在实际原生实例发送前再次验证。目录和 summary 查询无需模型回复，但原生初始化可能探测服务，不能称为完全无网络。命令范围、原生统计/压缩语义及定向工程结果见 [原生能力验收](native-capabilities-acceptance.md)。

### 1.5 后端职责、远程 Python 与并发

后端继续采用 Node.js + TypeScript + Fastify，负责访问控制、Agent 适配、SSH、同步、文件 / 版本操作及状态转发。服务器项目使用 Python 不要求网页后端采用 Python；统计、绘图和结果处理默认通过 SSH 使用项目已有环境。新分析脚本先同步，再执行，只回传必要统计或小文件；缺少环境 / 依赖时明确报告，不在服务器安装。

Agent 流、SSH 通道、子进程输出和文件操作使用异步接口，避免在请求处理路径使用阻塞式命令和重计算。同一会话只运行一轮；同一工作区同步串行，执行前必须等待自身同步成功；终端和资源采样可独立进行。实际Agent SSH执行期间双PTY、资源采样、远端任务响应及同步排队通过[完整链路验收](real-workflow-acceptance.md)；超时和输出缓冲边界沿用相关核心回归，不据此承诺多用户吞吐量。

当前按 Node.js 本地启动，不增加 Go 工具链、独立 `.exe` 或安装器开发。Go 的编译分发和 goroutine 只属于选型比较，外部 Agent CLI、git、rclone 仍有各自依赖。详细约定见 [架构第 2 节](../engineering/architecture.md#2-技术栈) 与 [设计决策第 8 节](../engineering/decisions.md#8-后端选型分析位置与运行边界)。

### 1.6 本仓库的 Git 分支与提交

采用 `main`、保留的大功能分支和短期小功能分支，不设置额外的长期 `develop`。这些规则管理本仓库开发；产品里用户工作区的“保存版本”是另一套操作，不自动套用或更改用户项目分支。

| 分支 | 用途 | 生命周期 |
|---|---|---|
| `main` | 已完成检查、可继续开发的阶段基线 | 长期保留；仍未实现或未验收的功能明确记录在路线图，合入不等于正式发布 |
| 大功能分支 | 承接一个完整功能域；保留现有 `feat/ssh-workflow`，Codex 新建时用 `codex/<功能域>` | 从 `main` 创建，阶段合入 `main` 后仍保留；归档或删除须用户另行明确要求 |
| 小功能分支 | 大功能内的一项子功能、修复或成组文档变更，例如 `codex/ssh-workflow-remote-files` | 从所属大分支创建；使用简短小写英文和连字符，合入该大分支并核验后删除 |

- 开始前检查 `git status`、`git branch -vv` 与 `git worktree list`，确认所在分支、已有修改和其他工作树占用。保留不属于当前任务的未跟踪文件，不用 `git clean` 作为分支整理步骤。
- 提交按一个可审阅的阶段组织，代码与对应文档一起更新；使用 `type(scope): 中文摘要` 和必要中文要点。一个大功能可以包含多个小分支，小分支可以包含多条 commit，不为每处小改动单独开分支或提交。
- 小分支完成并验证后，经授权用 `git merge --no-ff <小分支>` 合入所属大分支；大功能达到可整合阶段后，经授权用 `git merge --no-ff <大分支>` 合入 `main`。保留每条原始 commit，并用 merge commit 记录整合边界；不采用快进、squash 或 rebase 代替该流程。发生冲突时先核对双方变更、解决后验证，不重置主分支或改写已有历史。
- `main` 上的新改动需要进入仍在开发的大分支时，同样使用 merge；先确认需要同步的范围，不为制造合并图而反复互相合并。大分支留存是持续集成和历史定位的需要，不表示全部功能已经完成。
- 合并后的功能代码树与已验证内容一致时沿用可靠基准，只检查新增文档及合并完整性；有冲突解决或代码变化才复验受影响部分，无可靠基准时扩大验证。新增 merge commit 本身不要求重复未变化的全量测试。
- 仅清理小分支：确认其 tip 已被所属大分支包含、没有关联工作树占用，再在目标大分支上使用 `git branch -d <小分支>`。未合并小分支保留，不使用 `-D`；大功能分支即使已合入 `main` 也保留，不按“已合并”状态自动批量删除。
- 本地提交/合并与远端发布分别处理：仅获本地整理授权时不推送、不删除远端分支。远端操作前刷新并核对真实分支；网络失败时不能把旧 `origin/*` 当作最新状态。用户明确要求推送时正常推送，禁止默认强推。
- 小功能收尾后回到所属大分支；阶段已合入主分支且暂停开发时回到 `main`。报告保留的大分支、已清理的小分支、提交及推送状态，下一项子功能从所属大分支创建。

2026-10-03 整理：`feat/ssh-workflow` 已恢复并作为大功能分支保留。此前完成的快进记录不重写；从此次规范调整开始使用 `--no-ff`，同时保留原始提交与合并节点。

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

- 输入补全接入后的 `vite build` 主包 1,070.48 kB（gzip 331.21 kB），仍有大于 500 kB 的 chunk 提示。Ariakit 复用完整的焦点与浮层处理，使 gzip 较原生能力阶段增加约 42 kB；构建通过，现有编辑器和面板的按需加载边界保留，后续随实际性能需求评估拆包。

### 4.9 jscpd 只报告精确重复

- jscpd 按 token 序列匹配：整段复制会被发现（自检：复制 `shell.ts` 后报 23% 重复并失败），但改了类名或几行代码的"近似重复"不一定能发现。它只是底线检查，代码评审时仍要留意相似逻辑。
- 在 PowerShell 中 `npx jscpd` 会把 "Using config" 提示写到 stderr，不影响退出码；以 `$LASTEXITCODE` 判断结果。

### 4.10 真实验收与外部同步工具

- 已有 `scripts/dev/e2e-m1.ts` 和 `e2e-m2.ts`；网页联动、双Agent编辑/SSH/rclone、版本恢复和多活动组合已补齐[完整链路验收](real-workflow-acceptance.md)。单元测试不代替真实传输或模型证据。
- rclone 要求 1.75.1；驱动拒绝其他版本或缺失的可执行文件，并暂停远端执行。从官方版本目录下载并核对 SHA-256；不自动安装到服务器。
- rclone 的 obscure 仅是传输编码；明文密码不落盘，可选保存使用 Windows 当前用户系统加密，与 rclone 的传输编码分开。

### 4.11 SSH fixture 的随机密钥生成

- ssh2 的 Ed25519 生成器会裁剪公钥前导零，偶发生成无法被自身解析的畸形密钥；已在独立生成/解析中复现。
- SSH fixture 使用 ECDSA 256 位临时密钥，避免不相关的随机失败；产品继续支持现有私钥和主机密钥算法，未修改依赖源码或放宽校验。

### 4.12 Windows 系统加密子进程的模块环境

- Windows CI 中，原环境白名单使 PowerShell 停在 `Add-Type -AssemblyName System.Security`，达到 10 秒限制后保存密码失败。同一虚拟机补充 `USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`PSModulePath` 后，对照探针在约 460 毫秒内完成加解密；尚不能归因到某一个变量。
- 加密子进程保留显式环境白名单，只补齐上述四项路径。凭据仍经标准输入传递，保留 10 秒超时和输出上限，不继承其他服务凭据；临时 CI 诊断步骤和脚本已移除。

### 4.13 Windows bisync 状态文件名过长

真实rclone 1.75.1验收在较长配置目录下出现状态锁文件名错误。其[固定版本源码](https://github.com/rclone/rclone/blob/v1.75.1/cmd/bisync/bilib/canonical.go)把两端规范化完整路径拼成一个文件名，再添加清单/锁后缀；alias会展开真实路径，实际实验不能解决此限制。

可使用较短的本机 `SSH_SERVER_CONFIG_DIR` 减少镜像绝对路径长度；远端目录自身过长时仍可能触发文件名限制。调整已有配置位置前保留完整配置与同步状态，不能删除基线来规避。验收采用短独立根继续其他链路，没有把该规避说成产品修复，也没有修改同步签名。真实触发与证据边界见[完整链路验收](real-workflow-acceptance.md)。

## 5. 开发运行与验收说明

- Windows PowerShell 可用 `npm.cmd run dev` 启动后端与 Vite，或用 `npm.cmd start` 构建前端后启动本地服务；访问控制和启动参数见 [M1 设计](../superpowers/specs/2026-10-01-m1-minimal-chain-design.md)。
- 设置 `SSH_SERVER_RCLONE` 后，真实验收用 `npm.cmd run e2e:m1 -- --host my-server --remote-dir ~/projects/test --local-dir C:\Projects\test --report <私有报告路径>`；M2 将脚本名换为 `e2e:m2`，要求两端专用测试根目录为空，创建并清理自身随机子目录。
- 认证读取本机 Host 与 known_hosts。私钥模式需要可读私钥，密码模式不回退私钥或 SSH Agent；临时密码不进入工作区 JSON、浏览器缓存、Agent、日志或 argv。
- 同步元数据、信任副本、缓存与临时目录在后端配置目录，`.git` 永不传输；只同步代码和小文件，排除范围变化需确认重建基线。
- `/` 命令、压缩和资源状态按官方接口 / 服务器实际能力验证。终端测试使用服务器已有工具，不为了 `nvitop` 或监控而在服务器安装软件。
- Codex 正式启动使用原生 `CODEX_HOME/config.toml`，可通过 `SSH_SERVER_CODEX` 指定已安装的可执行入口。真实模型验收复制运行时指定配置到隔离目录，结束后核对源摘要并清理自身副本；本轮8个早期ignored副本因自动审批拒绝保留，不改用其他工具删除。原生 MCP 的内部令牌仅通过进程环境传递，轮次结束撤销。
- 远程分析验证使用已有 Python / 项目环境，不为网页版安装科学计算依赖；对话、终端、资源采样与同步的并发验证按相关里程碑进行，参照架构 V16、V17。
- 文档修改只检查链接、编号、编码、冲突表述与变更范围；代码改动再按受影响范围运行相关测试及工程检查，不重复未受影响的全量测试。
- 远端文件管理验收复用指定 SSH 目标的专用目录，覆盖未同步大文件、混合目录、同名冲突、链接、跨文件系统及取消；不可用的文件系统/权限场景单独标为未验证。核对本机未出现隐式文件副本、无模型调用，显式下载不进入工作区同步/Git；参照 A20–A23 和架构 V18，不能用文档布局图替代实际浏览器与 SSH 验收。
