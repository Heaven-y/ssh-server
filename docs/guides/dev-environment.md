# 开发环境

本文档说明开发这个仓库所需的本机环境、代码规范、项目 skill 的管理方式，以及已经发现并处理的问题。

当前规范更新于2026-10-09，见[需求](../product/requirements.md)、[设计决策](../engineering/decisions.md)和[路线图](../roadmap.md)。只维护当前正式实现；旧协议、迁移和重复入口不保留。资料入口见[文档索引](../README.md)，最终验证范围统一见[最新验收](ui-usability-optimization-acceptance.md)，不在开发指南重复阶段验收流水。

## 1. 本机环境

| 组件 | 说明 |
|---|---|
| Node.js | 22+，运行本地 TypeScript + Fastify 后端，沿用现有 tsx 启动方式 |
| Git | 2.43+，本地版本恢复需要 `GIT_ATTR_SOURCE` 支持目标提交属性 |
| Claude Code、Codex CLI | Claude通过SDK随包平台程序运行，Codex通过本机CLI；使用模型时沿用已配置的原生设置。缺少Agent不妨碍服务器管理，历史Codex真实验收版本为0.160.0 |
| 本机 Python | 3.x，仅部分开发 skill 的脚本按需使用（用 `python` 调用，见 3.3）；网页后端不依赖 Python |
| rclone | 本机固定 1.75.1；通过 PATH 或 `SSH_SERVER_RCLONE` 指定，服务器无需安装 |

### 1.1 代码规范

- 编码与换行：UTF-8、LF；`.ps1` 使用带 BOM 的 UTF-8（Windows PowerShell 5.1 按系统代码页读取无 BOM 文件会乱码）。由 `.editorconfig`、`.gitattributes` 约束。
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
| Codex 对话与历史 | 已验官方 app-server 0.160.0，stdio JSON-RPC | 复用原生配置、会话、审批与上下文；每轮及历史读取独立启动，不增加模型协议转换层 |
| 前端接口数据（加载、错误、刷新） | `@tanstack/react-query` | 替代手写的 loading / error 状态与刷新逻辑 |
| 前端 WebSocket 断线重连 | `partysocket` | 自带退避重连与发送缓冲 |
| 对话长列表与贴底 | `react-virtuoso` 4.18.16（MIT） | 动态高度虚拟列表、流式贴底与用户上翻停止，取代早期use-stick-to-bottom；采用官方跟随/定位API，展开状态保存在列表外 |
| Git差异与行反馈 | `@pierre/diffs` 1.5.1（Apache-2.0） | React19兼容，官方patch解析与侧别行号、按需加载；GitHub高对比双主题实测，失败保留有界原文本 |
| Markdown 流式渲染 | `streamdown` | 处理未闭合的 Markdown |
| 原生配置语法校验 | `smol-toml` 1.9.0（BSD-3-Clause）与原生 JSON 解析 | 校验语法后保存原文，保留未知字段、注释和格式，不自行实现 TOML |
| 代码组件 | `@uiw/react-codemirror` 4.25.12、CodeMirror 6 JSON / TOML / 脚本语言扩展、`@codemirror/lang-markdown` 6.5.2（MIT） | 按需加载，原生配置编辑与本地文件只读查看共用；支持 Python、JS/TS、Shell、YAML、Markdown 高亮及搜索 |
| 前端全局状态 | `zustand` | — |
| 输入命令补全 | `@ariakit/react` 0.4.40（MIT） | 复用 combobox 的焦点、键盘与浮层定位，支持 textarea；仅从 combobox 子入口导入，保持现有视觉样式 |
| 图标、字体 | `lucide-react`、fontsource | — |
| 代码检查与复杂度 | ESLint、typescript-eslint、`eslint-plugin-sonarjs`（LGPL，仅开发时使用） | 见 1.3 |
| 格式 | Prettier | — |
| 重复率 | jscpd | — |
| 覆盖率 | `@vitest/coverage-v8` | 与 Vitest 同版本 |

终端已接入固定 `@xterm/xterm` 6.0.0 与 `@xterm/addon-fit` 0.11.0，按入口加载并通过核心与实际网页/SSH验收；Pebrel 仅参考界面和交互，不引入其 GPL 实现。未安装的未来能力不写成已有依赖。

### 1.3 质量检查

`.superpowers/` 保存本机执行记录与临时验收材料，不属于产品源码；Git、ESLint 和 Prettier 均排除该目录。

按变更影响范围执行相关检查；跨包测试布局或全局配置变更统一执行完整检查，后续只复验受影响部分。`npm run check` 提供完整门禁，CI（`.github/workflows/check.yml`，Windows 与 Linux）运行同一命令。它依次执行：

| 步骤 | 命令 | 门槛 |
|---|---|---|
| 类型检查 | `npm run typecheck` | shared、server、web、scripts 全部通过 |
| 代码检查 | `npm run lint` | 0 error。圈复杂度 ≤ 10（`complexity`），认知复杂度 ≤ 15（`sonarjs/cognitive-complexity`），嵌套深度 ≤ 4，参数 ≤ 4 |
| 格式 | `npm run format:check` | Prettier 无差异；修复用 `npm run format`。Markdown 不自动排版 |
| 文档一致性 | `npm run docs:check` | git 跟踪的 Markdown：相对链接与锚点有效、无跨文档重复长句（≥ 40 字符）、`docs/` 下每个文档都在导航中登记；单文档超过 600 行只预警不失败 |
| 重复率 | `npm run dup` | ≤ 3%（50 个 token 以上算重复，不统计测试文件） |
| 测试与覆盖率 | `npm run coverage` | 全局行 / 语句 / 函数 ≥ 85%，分支 ≥ 75%；`policy/` 与 `http/security.ts` 行 ≥ 95%；`packages/shared` ≥ 90% |

- 覆盖率不统计：进程入口、需要真实SSH的`ssh/pool.ts`、界面组件（`.tsx`，由行为组件测试和浏览器验收验证）、`features/ssh/use-ssh-connection.ts`（沿用所属组件的浏览器范围）、`lib/ws.ts`（逻辑由partysocket提供，状态在chat-store测试）。完整排除项见根`vitest.config.ts`；新增排除须说明原因，目录拆分不改变门槛。
- 超过门槛时先拆分函数、补测试；确实需要例外时用行内 `// eslint-disable-next-line <规则> -- 原因`，不放宽全局门槛。
- 报告输出到 `coverage/`（已忽略），打开 `coverage/index.html` 查看未覆盖的行。
- 测试、构建与验收基准记在[最新验收](ui-usability-optimization-acceptance.md)；纯文档变更跑 `npm run docs:check` 与 `npm run format:check`，不重复全量代码门禁。
- 文档不设硬性行数上限：长度本身不是缺陷，重复定义、混入过程流水和坏锚点才是。超长时先按[文档导航](../README.md)的参数归属规则查重复，再考虑拆分；拆分后须保留原锚点或同步全部入链。

测试放各包独立的 `tests/`，与 `src/` 的模块路径对应；新增测试只覆盖核心行为和实际回归，复用现有路径，避免重复断言。需要绝对路径的本机 fixture 用 `path.resolve` / 临时目录生成，不写死开发机路径；协议和安全边界的路径字面量保留其测试意义。执行相关测试示例：`npm test -- apps/server/tests/ssh apps/server/tests/http/ssh.routes.test.ts`。目录总览见 [架构第 3 节](../engineering/architecture.md#3-仓库结构)。

任务重启或取消的回归使用确定的生命周期屏障，不因固定轮询窗口超时放宽全局超时或改变产品状态。

向导 Hook 生命周期回归使用 Testing Library React 16.3.3、DOM 10.4.2 及 jsdom 27.4.0（为兼容现有 Node 22.20），在单个测试文件指定 jsdom；其他纯函数使用 node 环境。

### 1.4 当前接入状态

功能状态见[路线图](../roadmap.md)，验收条件见[需求](../product/requirements.md#6-验收标准)。真实模型、实际SSH/rclone、受控服务和OS控件分别记录；Linux CI检验代码与路径/协议。

- 模型与能力：原生配置为唯一默认来源，`defaultModels` 只在磁盘读取边界剔除；能力目录只缓存公开元数据，技能/命令在实际原生实例发送前复验，目录与 summary 查询不发送模型消息（初始化可能探测服务）。
- 会话与链接：分叉走官方 inclusive 接口，源会话与项目文件不回滚；链接是含工作区/Agent/原生ID的本网页 hash。
- 密码：只在明确编辑时按需读取并回显，默认掩码、可查看修改，确认保存不自动连接；验收只用合成凭据，明文不进入日志、URL、普通列表或浏览器持久存储。
- 布局与隔离：D42 停靠 Group 与已打开文件/PTY 生命周期按[最新验收](ui-usability-optimization-acceptance.md)记录；原生配置与真实目标只用已授权隔离副本或专用测试根。

### 1.5 后端职责、远程 Python 与并发

后端继续采用 Node.js + TypeScript + Fastify，负责访问控制、Agent 适配、SSH、同步、文件 / 版本操作及状态转发。服务器项目使用 Python 不要求网页后端采用 Python；统计、绘图和结果处理默认通过 SSH 使用项目已有环境。新分析脚本先同步，再执行，只回传必要统计或小文件；缺少环境 / 依赖时明确报告，不在服务器安装。

Agent流、SSH通道、子进程输出和文件操作使用异步接口，避免阻塞请求或在后端重计算。同一会话只运行一轮，同一工作区同步串行，执行前等待自身同步成功；终端与资源独立。

当前按 Node.js 本地启动，不增加 Go 工具链、独立 `.exe` 或安装器。详细约定见 [架构第 2 节](../engineering/architecture.md#2-技术栈) 与 [设计决策第 8 节](../engineering/decisions.md#8-后端选型分析位置与运行边界)。

### 1.6 本仓库的 Git 分支与提交

采用 `main`、大功能分支和短期小功能分支，不设置额外的长期 `develop`。这些规则管理仓库开发；产品里用户工作区的“保存版本”是另一套操作，不套用或更改用户项目分支。

| 分支 | 命名 | 用途 | 生命周期 |
|---|---|---|---|
| `main` | `main` | 已完成检查、可继续开发的基线 | 长期保留；未实现或未验收的功能记录在路线图，合入不等于发布 |
| 大功能分支 | `feat/<功能域>`，如现有 `feat/ssh-workflow` | 一个完整功能域，可包含多个子功能 | 从 `main` 创建；阶段合入 `main` 后仍保留，归档或删除须用户明确要求 |
| 小功能分支 | `<类型>/<主题>`，类型用 `feat`、`fix`、`docs`、`chore`、`test`、`refactor`，如 `fix/password-refresh` | 一项子功能、修复或成组文档变更 | 从所属大分支创建，没有对应大分支时从 `main` 创建；合入后删除 |

- 分支名只用小写英文与连字符，体现主题；不使用 `codex/` 一类工具前缀、`wip`、日期或人名。一个主题一个分支，不混入无关改动。
- 开始前检查 `git status`、`git branch -vv` 与 `git worktree list`，确认所在分支、已有修改和工作树占用。保留不属于当前任务的未跟踪文件，不用 `git clean` 整理分支。
- 提交按一个可审阅的阶段组织，代码与对应文档一起更新，使用 `type(scope): 中文摘要` 与必要要点；一个大功能可以由多条提交组成，不为每处小改动单独开分支或提交。
- 小分支完成并验证后，经授权用 `git merge --no-ff <小分支>` 合入所属大分支；大功能达到可整合阶段后，经授权用 `git merge --no-ff <大分支>` 合入 `main`。保留每条原始提交并用 merge commit 记录整合边界，不用快进、squash 或 rebase 代替；冲突解决后验证，不重置主分支或改写已有历史。
- `main` 的新改动需要进入仍在开发的大分支时同样使用 merge，先确认同步范围，不为凑合并图反复互合。
- 合并后的代码树与已验证内容一致时沿用可靠基准，只检查新增文档与合并完整性；有冲突解决或代码变化才复验受影响部分。
- 仅清理小分支：确认其 tip 已被目标分支包含、没有工作树占用后，用 `git branch -d` 删除；未合并小分支保留，不使用 `-D`。大功能分支即使已合入 `main` 也保留，不按“已合并”批量删除。
- 本地与远端保持一致：`main` 与保留的大功能分支都有对应的 `origin` 分支且没有领先或落后；小分支合并后在本地和远端一起删除。推送前先取回并核对真实分支，网络失败时不把旧 `origin/*` 当作最新状态。用户要求推送时正常推送，禁止强推或改写已推送历史。
- 小功能收尾后回到所属大分支；阶段已合入 `main` 且暂停开发时回到 `main`。报告说明保留的大分支、已清理的小分支与推送状态。

2026-10-03 起合并统一使用 `--no-ff`；此前的快进记录不重写，`feat/ssh-workflow` 从那时起作为大功能分支保留。

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

注意：`update` 会更新到上游最新版本。`skills-lock.json` 只记录来源和内容哈希，不记录提交号。核对启用状态时只检查本项目目录与 Claude 目录链接有效（Claude 用初始化事件清单、Codex 用实际发现结果），不新增全局 skill。

## 3. 已知问题与处理

### 3.1 superpowers 不会自动启用

- 现象：superpowers 原本通过插件的 SessionStart 钩子，在每个会话开头注入 `using-superpowers`。项目以 skill 文件方式安装，没有这个钩子。
- 处理：在 `AGENTS.md`（`CLAUDE.md` 引用它）中要求开始任务前先阅读 `using-superpowers`。
- 验证（2026-10-01）：Codex 和 Claude Code 执行任务时，第一个动作都是读取 `.agents/skills/using-superpowers/SKILL.md`。

### 3.2 ui-ux-pro-max 的脚本路径

- 现象：它的 SKILL.md 中脚本路径写作 `${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py`。这个变量只在插件方式安装时才有值，项目级安装下为空，路径不成立。
- 处理：不改第三方文件；按AGENTS中的映射使用`.agents/skills/<名称>/...`，需要Python时显式`python -X utf8`，不依赖插件专用环境变量。

### 3.3 `python3` 不可用

- 现象：本机 `python3` 指向 Windows 应用商店占位程序，执行无输出。
- 处理：`AGENTS.md` 中规定 Python 脚本统一用 `python` 调用。

### 3.4 Bash 工具结束时会结束后台进程

- 在一次命令里用 `Start-Process` 启动的后端和 Vite，会在该命令返回后被结束。需要先启动服务再验收时，把启动、验收、`Stop-Process` 写在同一条命令里（用 `try/finally` 保证关闭）。

### 3.5 前端打包体积

- 生产构建仍有大于500 kB的chunk提示；按需加载编辑器、终端与重型面板，不通过抬高阈值掩盖警告。

### 3.6 jscpd 只报告精确重复

- jscpd 按 token 序列匹配：整段复制会被发现（自检：复制 `shell.ts` 后报 23% 重复并失败），但改了类名或几行代码的"近似重复"不一定能发现。它只是底线检查，代码评审时仍要留意相似逻辑。
- 在 PowerShell 中 `npx jscpd` 会把 "Using config" 提示写到 stderr，不影响退出码；以 `$LASTEXITCODE` 判断结果。

### 3.7 真实验收与外部同步工具

- `scripts/dev/e2e-m1.ts`和`e2e-m2.ts`用于相关真实Agent/SSH/同步检查；按变更影响选择范围。终端夹具入口为`node --import tsx scripts/dev/e2e-terminal.ts`。
- rclone 要求 1.75.1；驱动拒绝其他版本或缺失的可执行文件，并暂停远端执行。从官方版本目录下载并核对 SHA-256；不自动安装到服务器。
- rclone 的 obscure 仅是传输编码；明文密码不落盘，可选保存使用 Windows 当前用户系统加密，与 rclone 的传输编码分开。
- 前端验收用会话临时目录中的 `playwright-core` 驱动本机 Edge（`executablePath` 指向 `msedge.exe`，不下载浏览器、不进仓库）。

### 3.8 Windows 系统加密子进程环境

- 加密子进程使用显式环境白名单，只补齐 `USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`PSModulePath` 四项路径；凭据仍经标准输入传递，保留 10 秒超时与输出上限，不继承其他服务凭据。

### 3.9 Windows bisync 状态文件名过长

真实rclone 1.75.1验收在较长配置目录下出现状态锁文件名错误。其[固定版本源码](https://github.com/rclone/rclone/blob/v1.75.1/cmd/bisync/bilib/canonical.go)把两端规范化完整路径拼成一个文件名，再添加清单/锁后缀；alias会展开真实路径，实际实验不能解决此限制。

当前使用固定版本自带combine单上游映射，仅bisync使用短逻辑根，其他命令仍指向实际目录；取舍见[D31](../engineering/decisions.md#d31-同步清单短名称与兼容升级2026-10-05)。不靠搬配置根或alias掩盖产品问题。

只维护version=1、mirror-v1、combine-v1。非空基线缺签名，或已有签名但布局缺失/不匹配时停止，不提供升级或自动重建；确认初始化也不能覆盖旧数据。当前格式未完成任务仍走结果核对/恢复，不重放服务器写操作。坏配置/任务不视为空，不删除状态或搬配置根规避；D31的兼容升级已由D36取消。

Windows rclone会把远端根的反斜杠转换为斜杠，产品在同步/预览数据命令前拒绝，应重新选择已核对的实际兼容目录。服务器文件浏览与本人终端不套用此限制。`pwd`只去掉一个终止LF，保留尾随空格，截断/异常输出拒绝，见[D35](../engineering/decisions.md#d35-rclone-远端根的精确绑定2026-10-06)。

## 4. 开发运行与验收说明

- Windows PowerShell用`npm.cmd start`构建并启动，直接打开`http://127.0.0.1:4317/`；开发热更新用`npm.cmd run dev`并打开5173端口。无需令牌链接，同源握手后才启动业务查询；后端重启后刷新重新握手。安全契约见[D37](../engineering/decisions.md#d37-本机入口与统一服务器档案2026-10-07)。
- 设置`SSH_SERVER_RCLONE`后，真实验收用`npm.cmd run e2e:m1 -- --host my-server --remote-dir ~/projects/demo --local-dir C:\Projects\demo --report <私有报告路径>`；M2将脚本名换为`e2e:m2`。两端必须是专用空测试根；M1保留原生验收会话，M2只创建/清理自身随机子目录，均不能在已有项目上运行。
- 先在顶栏“服务器”保存连接档案并认证；SSH config只作为显式导入来源，生产工作区不直接使用未登记Host。私钥模式需要可读私钥，密码模式不回退私钥或SSH Agent；认证保存在服务器层，工作区只选目录和档案。已引用或有活动的服务器变更受保护，密码不进入工作区JSON、浏览器缓存、Agent、日志或argv。
- 同步元数据、信任副本、缓存与临时目录在后端配置目录，`.git` 永不传输；只同步代码和小文件，排除范围变化需确认重建基线。
- `/` 命令、压缩和资源状态按官方接口 / 服务器实际能力验证。终端测试使用服务器已有工具，不为了 `nvitop` 或监控而在服务器安装软件。
- Codex正式启动使用`CODEX_HOME/config.toml`，`SSH_SERVER_CODEX`指定已有入口。真实模型检查须有明确授权，使用隔离配置并核对源摘要；只清理自身副本，不绕过策略拒绝。原生MCP内部令牌只经进程环境传递，轮次结束撤销。
- 远程分析验证使用已有Python/项目环境，不为网页版安装科学计算依赖；对话、终端、资源、任务与同步的并发按实际影响范围核对，不能由独立通道成功推断所有组合。
- 文档修改只检查链接、编号、编码、冲突表述与变更范围；代码改动再按受影响范围运行相关测试及工程检查，不重复未受影响的全量测试。
- 远端文件验收复用授权目标的专用目录，按A20–A23核对大文件、混合目录、同名冲突、链接、跨文件系统与取消；先确认跨文件系统device确实不同。核实本机无隐式副本且不调用模型，显式下载不纳入同步/Git。终端全屏程序先等待进入与重绘再测试退出。
- 每项能力只有当前实现。测试替身和开发脚本必须跟随必填Agent、对象SshTarget、runners注册表等正式契约，不能为旧替身恢复兼容分支。外部客户端只是可选检查工具。
- 启动检测Node.js、Claude实际入口、Codex、Git、rclone能否执行；每项5秒、输出2KiB，命令成功但版本未知仍可用。产品设置“本机运行环境”复用报告并提供重新检测和安装指引。Git2.43+/rclone1.75.1为业务要求。
- 默认配置目录为`%LOCALAPPDATA%\ssh-server`，`SSH_SERVER_CONFIG_DIR`可指定隔离目录；`SSH_SERVER_PORT`更改监听端口，`SSH_SERVER_HOST`仅允许本机地址。开发来源用`SSH_SERVER_DEV_ORIGIN`或`--dev-origin`显式设置；`SSH_SERVER_CODEX`和`SSH_SERVER_RCLONE`只选择已有程序。开发skills与其锁文件不属于产品启动依赖，不在启动时安装或检测。
- 仅维护新档案和工作区格式，不自动迁移。若配置不合法，保留原文并拒绝；不要用删除配置的方法掩盖错误。隔离验收使用临时目录和合成SSH，不读取或清理用户真实服务器配置。

### 4.1 原生配置与复验入口

- 原生编辑固定为`CLAUDE_CONFIG_DIR/settings.json`、`CODEX_HOME/config.toml`，未设置时使用用户目录的`.claude/settings.json`、`.codex/config.toml`；不编辑认证文件或任意路径。最多256 KiB普通UTF-8，校验JSON根对象/TOML、revision与文件身份，保留未知字段及原格式；409先核对外部修改，不覆盖草稿或原文件。
- 缺失或空白文件可插入最小模板，仅改变草稿，显式保存才写盘。原生登录可能不依赖配置文件，保存不证明已登录或模型可用。Codex新会话默认high，自动仅省略强度覆盖，不替用户选档。
- 不调用真实模型的配置接线复验入口：`node --import tsx scripts/dev/e2e-claude-config.ts`；Codex入口：`node --import tsx scripts/dev/e2e-agent-config.ts --config <隔离配置来源> --codex <已有程序路径>`。仅获真实模型授权时追加`--with-model`；`--api-prefix /v1`只在确认服务前缀需要时使用，`--auth-file`只复制指定认证文件，不回写源文件。不能由某服务通过推断其他服务兼容。

### 4.2 遇到阻断时的处理

- 文件面板“收起”只隐藏；本地文件只读，不登记编辑状态。移除工作区前先处理运行轮次、同步收尾和未解决任务；不强停其他工作区或外部训练。
- `needs_check`先读取源/目标核对结果；纯远端任务只用结果核对，不调用同步恢复。`sync_pending`将远端完成与同步待恢复分开；涉及同步范围时核对实际结果并明确确认恢复，恢复只协调同步，不重新移动/复制/删除。取消不等于回滚，哈希相同也不能补造原任务verified证明。
- 读取失败或快照失配时保留原查询结果并提示重新读取；坏配置/任务保留原文并停止，不清空或跳过坏记录。
- 自定义命令规则最多20条，模式1–256字符、原因1–160字符；程序名只填基本名，`contains`按区分大小写的字面串匹配，不支持正则。通常无需自定义，不能把它当终端安全沙箱。

### 4.3 面板与隔离构建

资源和文件各自开关/收起，可同时显示；拖动分隔线或用方向键调整尺寸，标题栏“复位”恢复该模式的默认尺寸。文件默认420px（360–960）、资源默认320px（280–640）、窄右区420px（360–720）、宽双工具760px（646–1400），横纵比例默认43%/40%（20%–80%）；只记录用户调整，其他几何仅当前页面记忆。隐藏不释放已打开文件或PTY；文件打开不停止资源采样。

已有非watch实例仍在使用时，不重启用户服务，也不把新前端覆盖到其默认dist。生产验证构建可用`npm.cmd run build -w @ssh-server/web -- --outDir <会话临时目录>/panels-dist --emptyOutDir`，输出必须是专用临时目录；以匹配版本的隔离后端验证，避免前后端混版。
