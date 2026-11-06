# 开发指南

更新于 2026-11-06。按当前工程组织环境、质量、Git 和验证规则。产品优先级见[路线图](../roadmap.md)，协议边界见[原生对话接入](../engineering/native-dialogue.md)，本地成包见[安装指南](local-installation.md)；旧验收数据及已退役问题通过 `c686ef2` 查询。

## 1. 本机环境

Windows 10/11、Node.js 22+ 与 Git 是开发基础。按需安装 `claude`、`codex`、`agy`；缺少某个 CLI 应只影响对应功能。SQLite 摘要读取使用 Node 内置模块，不要求额外原生绑定；rclone 已不属于依赖。

本机 Python 仅供部分开发技能脚本使用，命令为 `python -X utf8`。服务器分析使用已有解释器和项目环境；本机后端主要协调异步 I/O。

### 1.1 代码规范

- 文件默认 UTF-8/LF；PowerShell 脚本按 `.editorconfig` 使用 UTF-8 BOM，以兼容 Windows PowerShell 5.1；`.slurm` 必须 LF。
- 中文说明与必要注释，函数保持小而可复用，消除重复；不为简单业务堆叠抽象层。
- 外部命令使用参数数组和明确超时/输出限制，避免拼接 shell；涉及敏感值时通过受控 stdin 或环境注入。
- Python 文本 I/O 指定 UTF-8，子进程按需设置 `PYTHONUTF8=1`，不复用系统保留变量名。
- 依赖固定具体版本，优先维护活跃、类型完整、许可兼容的成熟库。运行时使用 MIT/Apache/BSD/ISC 等宽松许可，GPL/AGPL 项目只参考设计；开发工具许可单独记录。
- 安全边界先验证库的真实行为，不满足时保留明确的小范围实现并记录理由。涉及认证、执行或删除时报告验证范围与未知边界。

### 1.2 依赖选用记录

| 功能 | 当前选择 | 主要理由 |
|---|---|---|
| 后端与协议 | Fastify、WebSocket、zod、TypeScript | 协调 CLI 与 SSH，复用前后端类型，见[技术选择](../engineering/decisions.md#d2-electron-加壳沿用-node-与-react) |
| 桌面 | Electron、electron-vite、electron-builder | 业务服务保持一份实现；本地构建 NSIS/portable，不执行发布 |
| CLI | Claude Agent SDK、Codex app-server、Antigravity 本机接口 | 保留原生会话与行为，不重建模型引擎 |
| SSH | ssh2、ssh-config | 连接/PTY/SFTP 与 OpenSSH Host 解析；known_hosts 小型校验保留本地实现，覆盖哈希和吊销条目 |
| 数据与连接 | TanStack Query、zustand、partysocket | 分离服务缓存和交互状态；关闭 WS 发送缓冲避免重发 |
| 消息 | streamdown、react-virtuoso | 流式 Markdown、动态高度列表和滚动跟随 |
| 配置 | CodeMirror 6、smol-toml、toml-eslint-parser | 原文高亮与校验，模型表单通过 TOML AST 定点编辑并保留注释与未知配置 |
| 终端 | xterm.js、addon-fit、addon-search | 处理真实 PTY 画面、尺寸和本机回滚查找，不自造终端解析器 |
| 交互 | Ariakit、cmdk、react-resizable-panels | 弹层、补全、命令面板与分栏的键盘行为 |
| 图标与字体 | lucide-react、fontsource | 随包分发，避免外部字体请求 |
| 质量 | ESLint/typescript-eslint/sonarjs、Prettier、jscpd、Vitest | 类型/复杂度、格式、精确重复和行为测试；sonarjs 仅开发期使用 |

精确版本和许可证声明以包文件与锁文件为准。新增依赖须更新本表的职责和选择理由；没有安装的候选工具不写成现有技术栈。

### 1.3 质量检查

按直接和间接影响范围验证；新产物、全局布局或影响不明时扩大范围。验证通过后，只有新改动、新问题或未解决风险才复验。阶段整合的完整门禁为 `npm run check`，Windows/Linux CI 运行同一入口。

| 检查 | 命令 | 约束 |
|---|---|---|
| 类型 | `npm run typecheck` | shared、server、web、desktop、scripts 全部通过 |
| ESLint | `npm run lint` | 零错误；圈复杂度 ≤10、认知复杂度 ≤15、嵌套 ≤4、参数 ≤4 |
| 格式 | `npm run format:check` | Prettier 无差异；Markdown 保留人工排版 |
| 文档 | `npm run docs:check` | 当前存在的跟踪文档及未忽略新文档；相对链接、锚点、导航与跨文档重复长句检查 |
| 重复率 | `npm run dup` | 50 token 起检测，非测试代码重复率 ≤3% |
| 桌面构建 | `npm run build:desktop` | 构建入口可用，不替代真实窗口验收 |
| 测试覆盖 | `npm run coverage` | 全局行/语句/函数 ≥85%、分支 ≥75%；shared 各项 ≥90%；安全模块行/语句/函数 ≥95%、分支 ≥90% |

文档检查采用 NUL 分隔枚举，保留中文和空格路径；开发技能与过程目录即使意外跟踪也不纳入检查，已删除文件跳过。相同长句跨文件达到 40 字符会报告，单篇超过 600 行只预警。新文档须登记在导航，不为通过检查重复定义参数。

定向覆盖率可在仓库根目录用测试文件路径筛选，并用 `--coverage.include` 限定生产模块。Vitest 5 使用 `--project` 时会将覆盖匹配根改为对应包；此时不能直接沿用根目录前缀，否则可能得到 0/0 空报告。空报告不作为覆盖验证通过依据。

测试放各包 `tests/`，路径与模块相呼应。只补核心行为和实际回归，用临时目录生成绝对路径，不写开发机固定路径；脚本枚举回归复用服务端 `tests/dev` 发现范围。生命周期测试用明确屏障，不凭放宽超时掩盖竞争。

重构后按目录增加独立聚合门槛（行/语句/函数/分支）：platform、Claude、Codex、chat/sessions 为 90/90/90/80；Antigravity、agents/common、plugins 宿主、web/cli 为 85/85/85/75。shared 与 HTTP 安全模块继续使用原更高门槛，总体门槛仍保留。目录分组能防止一个高覆盖模块掩盖另一个适配器退步，不要求复制相同测试到每一层。

jscpd 递归扫描 server/web/desktop 的 src、shared/src、scripts/dev 与 scripts/packaging，新 CLI、platform、内置插件无需额外登记单文件。仍检查跨目录重复，限制 3%；合理的协议差异不强行抽象成全能基类。构建产物、依赖和测试不计入生产重复率。

覆盖率排除项由根 Vitest 配置统一维护：进程入口、需要真实 SSH 的池、前端组件及特定浏览器封装分别由相应验证覆盖。不得放宽全局门槛；必要的局部 lint 例外写明原因。jsdom 放根开发依赖，组件测试用 Testing Library，普通逻辑使用 Node 环境。

### 1.4 进度与证据

三 CLI 对话、原生资源设置和工作台插件已有实现，项目管理、操作后列表更新、终端查找及本地打包在当前交付中接线。功能条件见[需求验收](../product/requirements.md#4-验收与证据)，实际通过范围仍以路线图中的证据为准；有组件或包文件不代表真实环境验收完成。

分别记录类型检查、受控子进程、界面行为、真实模型、真实 SSH 与系统交互。不能从单个模型服务可用推断所有服务兼容，也不能从模拟消息推断真实 Antigravity 协议完整。

### 1.5 后端与远程环境

本地 Fastify 负责访问控制、原生适配、轮次、SSH 和文件任务；长时间操作必须异步、可取消且有界。并发边界、资源预算、主机信任和凭据规则见[架构](../engineering/architecture.md)。

服务器使用已有工具和 Python 环境，不为监控安装 `nvitop` 或常驻采集器。远端操作、资源观察和对话互不代替，独立成功不能证明所有组合都通过。

### 1.6 本仓库的 Git 分支与提交

保留 `main`、大功能分支与短期小分支，不增加长期 develop。

| 分支 | 命名 | 生命周期 |
|---|---|---|
| 主线 | `main` | 已整合基线，长期保留；合入不等于发布 |
| 大功能 | `feat/<功能域>` | 一个完整功能域，阶段合入后保留；删除须明确授权 |
| 小功能 | `<类型>/<主题>` | 单项子功能或文档阶段，合入所属大分支后清理 |

- 名称用小写英文和连字符，体现主题，不用工具前缀、日期、人名或 wip。
- 开始前检查状态、分支和 worktree 占用；保留别人的未跟踪文件，不用 `git clean` 清理工作区。
- 提交按可审阅阶段组织，使用 `type(scope): 中文摘要`，代码与对应文档一起；未经明确要求不提交、不推送，当前会话授权持续有效。
- 合并统一 `git merge --no-ff`，保留原提交及整合边界；不以快进、squash、rebase 或重写主线代替。冲突解决后复验受影响范围。
- 没有冲突或新代码的整合沿用可靠验证基线，不重复跑无关全量测试。
- 小分支确认已被目标包含且没有工作树占用后用 `git branch -d` 删除，不用 `-D`；大功能分支不按“已合并”批量清理。
- 只有获推送授权才同步远端，先 fetch 核对真实状态，不把离线的 origin 引用当最新结果；正常推送，禁止强推。
- 日常任务先留在功能分支；此前某轮的合入 main 和推送授权不自动用于后续修复，按用户本轮明确指令执行。
- 小阶段结束回到所属大功能分支；合入 main 后暂停开发时回到 main。报告保留分支、已清理小分支与是否推送。

2026-10-03 之前的旧合并记录不改写。

## 2. 开发技能

开发技能只安装到项目目录，不写全局配置、不提交技能本体。产品使用的 CLI 原生 Skills/MCP/插件是另一回事，按所选 CLI 的发现规则接入。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev\install-skills.ps1
```

脚本使用固定 `skills@1.7.0`，设置 `DISABLE_TELEMETRY=1`，为 Claude Code 与 Codex 建立入口。真实文件放 `.agents/skills/`，`.claude/skills/` 为目录链接；`skills-lock.json` 记录来源与内容哈希，三者都忽略。

| 来源 | 能力 | 许可 |
|---|---|---|
| obra/superpowers | 需求梳理、计划、执行、调试与评审 | MIT |
| vercel-labs/agent-skills | React 实践 | MIT |
| anthropics/skills | Web 应用验证 | Apache-2.0 |
| anthropics/claude-plugins-official | MCP 开发 | Apache-2.0 |
| nextlevelbuilder/ui-ux-pro-max-skill | UI/UX 辅助 | MIT |

查看用 `npx skills@1.7.0 ls -a claude-code -a codex`，项目更新用 `npx skills@1.7.0 update -p`；新增来源先改安装脚本。更新取上游最新内容，锁文件不是提交号。技能中的插件根路径按 AGENTS 映射到本地；没有启动钩子，因此任务开始必须主动读取 using-superpowers。

## 3. 启动与隔离验证

| 场景 | 命令 |
|---|---|
| 桌面开发与热更新 | `npm.cmd run dev:desktop` |
| 浏览器热更新 | `npm.cmd run dev` |
| 本机静态托管 | `npm.cmd start` |
| 指定关联测试 | `npm.cmd test -- apps/server/tests/chat/turn-manager.test.ts` |
| 终端受控夹具 | `node --import tsx scripts/dev/e2e-terminal.ts` |
| Windows 本地包 | `npm.cmd run package:desktop` |
| 解包目录与冒烟 | `npm.cmd run package:desktop:dir`，再按本地安装指南运行冒烟检查 |

开发服务地址和环境覆盖项统一见[启动配置](../engineering/architecture.md#53-启动配置)。前端先同源握手，服务重启后需重新取得会话。不要把测试页面指向正在使用的真实配置。

后台验收进程的 stdout/stderr 写入本轮独立日志文件或设为 ignore，不继承可能先退出的工具输出管道。验收结束后关闭自己创建的窗口、进程与端口；桌面日志已处理异步 EPIPE，但这不能代替验收脚本的退出清理。

桌面 `dev` 和 `start` 在运行 electron-vite 前执行 Electron 官方安装器：文件完整时立即返回，缺失时从缓存恢复或下载锁定版本。仅安装 npm 包不一定已包含桌面运行文件，跳过安装脚本或下载中断会使 electron-vite 报 `Electron uninstall`。已有依赖时可在仓库根目录运行 `node node_modules/electron/install.js` 修复，再执行 `npm.cmd run dev:desktop`；无需删除整套 node_modules。首次下载需要网络，未完成下载不能只创建 path.txt 充当成功。

桌面开发使用 electron-vite 的 renderer 服务和监听构建。前端入口复用 web 的 Vite/React/Tailwind 配置，默认页面地址为 `http://127.0.0.1:5173`，API 与 WebSocket 代理到本机后端；Host、Origin、Cookie 和插件 iframe 限制继续生效。

| 保存的内容 | 开发窗口行为 |
|---|---|
| React 页面、组件与 CSS | Vite HMR/Fast Refresh，通常保持当前页面与可保留的组件状态；不重启后端 |
| Electron preload | 重新构建并刷新页面，页面内临时状态可能重置 |
| 后端、桌面主进程及其共享源码、远端辅助脚本 | 重新构建并自动启动新 Electron 进程 |
| 依赖或启动/构建配置 | 按变更安装依赖后停止并重新执行开发命令 |

后端重启会中断本次运行中的模型回合、SSH 通道和终端。不要在真实任务运行时编辑会触发重启的文件；原生历史与工作台已保存数据继续按各自存储规则保留。热更新只适用于源码开发，已生成的安装包和便携包不会随源码变化。

开发代理要求固定后端端口，使用 `AGENTDECK_HOST` 和 `AGENTDECK_PORT`，默认回环端口 4317；桌面热更新不接受端口 0。5173 被占用时明确启动失败，不自动连接其他开发服务，因此不要同时运行浏览器开发与桌面开发。安装版和静态预览仍使用系统分配的端口。

原生配置接线脚本为 `e2e-claude-config.ts` 与 `e2e-agent-config.ts`。Codex 可通过 `--config` 与 `--codex` 指定隔离来源；只有已授权真实模型验证才追加 `--with-model`。复制认证材料必须明确指定、核对源摘要，清理只触及自身副本，不绕过策略拒绝。

原生资源、插件与独立控制台的组件和服务测试使用临时目录、合成运行器或假 SSH 通道。浏览器验证覆盖真实组件布局和键盘操作；终端搜索用本机输出缓冲，不需要连接真实服务器。外部静态插件的样例与权限边界见[插件契约](../engineering/workbench-plugins.md)。

版本递增与新安装包制作必须先取得用户确认，日常修复不自动执行；提交或推送代码不代表发布版本。打包命令只生成本地 Windows x64 产物，不签名或推送版本。CLI 仍由用户自行安装，工作台数据不进入包；安装、卸载与配置保留按[本地安装指南](local-installation.md)逐项验收。包内服务可启动、安装器生成和安装操作是不同证据，不能互相替代。

SSH 验证使用专用授权目录或合成服务；真实写操作先预检。服务器文件取消不代表回滚，断开后结果不明先读源与目标核对，不自动重发。现有主机/凭据行为不得因测试方便而跳过。

## 4. 已知开发约束

- Windows 调 npm 使用 `npm.cmd`，避免 PowerShell shim 行为；`python3` 可能指向商店占位程序，脚本用 `python`。
- 后台服务可能随命令宿主退出。验收脚本在同一进程生命周期内启动、检查并用 `try/finally` 清理；`Start-Process` 后台窗口设为 Hidden。
- 已有非 watch 服务正在使用时，不重启它、不覆盖其默认前端产物。使用专用临时 outDir 和匹配版本的隔离后端，避免混版。
- 大于 500 kB 的构建 chunk 提示通过按需加载和实际分析处理，不抬阈值隐藏；jscpd 只发现精确 token 重复，近似逻辑仍需评审。
- Markdown 没有自动排版；纯文档改动检查链接、编号、事实、编码与差异即可，不为文档内容新增单元测试。
- 当前没有独立 Playwright E2E 目录；界面验收用可用浏览器与隔离服务，临时截图和执行记录放 `.superpowers/` 或任务临时目录。

旧 rclone 路径问题、上一代停靠截图及阶段测试数字不再作为当前开发说明；必要时按[历史追溯](../engineering/decisions.md#历史追溯)读取原始记录。
