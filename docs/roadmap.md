# 路线图

更新日期：2026-10-05。验收编号见 [需求](product/requirements.md) 第 6 节，已确认的取舍见 [设计决策](engineering/decisions.md)。按已验证阶段提交，真实目标和模型配置只通过运行时参数使用。

| 里程碑 | 内容 | 验收 | 状态 |
|---|---|---|---|
| M0 | 文档、仓库规范、项目 skill | — | 完成，持续更新文档 |
| M1 | 最小链路：后端 + 访问控制 + 手动配置的工作区 + Claude 对话（流式）+ `remote_exec` + 命令黑名单 | A1、A11 | Task 1–10 已实现；真实模型/SSH 脚本通过，接入同步后的复验及浏览器收尾中 |
| M2 | SSH 密码接入；rclone bisync、过滤、删除确认、冲突保留、执行门禁；远程 Python 结果读取 | A2、A3、A4、A9、A12（执行 / 同步部分）、A17、A19 | 认证同步基础与保存密码入口完成；真实传输和网页同步记录保留，完整向导与终端已接入，A12完整组合待M6 |
| M3 | 轻量文件浏览 / 编辑、保存文件后同步；本地保存版本、历史、diff、恢复 | A5、A13 | 文件编辑与本地版本功能已接入，真实 Git / HTTP / 受控浏览器流程通过；A5、A13 实际 SSH 串联复验待办 |
| M4 | Codex 适配器、会话固定 Agent、模型选择、会话列表 / 重命名 / 删除 / 归档、原生 skills / 命令、上下文及压缩状态 | A6、A7、A8、A14、A15、A16 | 对话、原生会话管理、技能/命令选择与补全、模型候选及上下文/压缩已接入；A7 真实 SSH、A8 独立客户端刷新及长会话负载验收仍待完成 |
| M5 | 完整向导；服务器文件浏览与直接管理；参考 Pebrel 的网页终端；资源面板 | A10、A12（向导 / 终端部分）、A18、A20–A23 | 向导、文件管理、终端及资源详情已接入；真实向导/rclone、全屏工具和资源service通过，真实文件管理完整验收待完成 |
| M6 | 设置页、错误与空状态、端到端测试 | 全部复测 | 原生配置编辑、Codex 网页与远程工具主链路已有证据；真实 SSH 串联及多活动并发未完成 |

技术方向已确认：本地后端继续 Node.js + TypeScript + Fastify，异步协调 Agent、SSH、子进程、同步和网页状态；Python 分析默认在服务器已有环境执行。独立 `.exe` / 安装器、Go 迁移与外部工具打包只属于比较话题，不增加相应里程碑。并发与远端分析验证分别见架构 V16、V17。

2026-10-04 已按当前源码补充[剩余范围核对](engineering/remaining-scope-audit.md)：完整向导、终端、资源之外，工作区删除网页入口、追加黑名单规则、产品设置和原界面目标仍有实施缺口；已有后端接口或原生配置编辑不等于这些入口已经完成。

用户新增界面优化优先项：已核对 UI UX Pro Max 与三个开源项目，以 T3 Code 的简洁对话工作区为主完成中性深色改版。SSH/同步收为状态摘要，详情与新建表单按需展开，导航、对话、输入和审批层级统一；24 项前端测试及受控浏览器回归通过，见 [界面验收](guides/workspace-ui-acceptance.md) 和 [参考依据](product/ui-reference-review.md)。

## M0 待办

- [x] 项目 skill 安装与验证（见 [开发环境](guides/dev-environment.md)）
- [x] README、AGENTS.md、CLAUDE.md
- [x] 需求、架构、界面布局、路线图
- [x] 复测 ui-ux-pro-max 脚本路径（开发环境 4.2）
- [x] 目录按用途划分（docs 分 product / engineering / guides，脚本移到 scripts/dev）
- [x] 测试统一迁移到各包 tests；SSH 界面按交互状态、密码表单和展示拆到 features/ssh，工具配置及目录规范同步
- [x] 首次提交
- [x] 分支规范：`main` 保存已验证阶段，保留 `feat/ssh-workflow` 等大功能分支；小分支合入大分支后清理，两级归并均用 `merge --no-ff` 保留提交和合并节点。本地归并不等同于远端发布，见 [开发规范](guides/dev-environment.md#16-本仓库的-git-分支与提交)

## M1 进度

计划见 [M1 实施计划](superpowers/plans/2026-10-01-m1-minimal-chain.md)。

- [x] Task 1–9：workspaces 骨架、共享协议、命令黑名单、ssh config 与 known_hosts、远程执行与连接池、工作区存储、访问控制、远程工具 MCP、Claude 适配器与对话 WebSocket
- [x] Task 10：前端（工作区、会话、对话界面）；此前已记录 `npm test`、`npm run typecheck`、`npm run build -w @ssh-server/web` 通过，浏览器冒烟检查通过（登录、空状态、表单校验、连接状态、控制台无错误）
- [x] 复用成熟库：规范写入开发环境 1.1、1.2；`ssh-config.ts` 改用 `ssh-config` 库；前端使用 react-query、partysocket、use-stick-to-bottom
- [x] 工程检查：接入 `npm run check`（类型、ESLint 与复杂度、Prettier、jscpd 重复率、Vitest 覆盖率）与 GitHub Actions；此前记录补测试后的行覆盖率约 92%（见开发环境 1.3）
- [x] 创建 `scripts/dev/e2e-m1.ts`：真实 Claude → MCP → SSH hostname 比对和原生历史可见性通过
- [ ] 接入同步后的模型复验、浏览器工具卡/黑名单/续接/审批/中断验证与收尾记录

当前实现边界：Claude/Codex 对话及原生会话管理、原生配置、网页文件编辑与本地版本记录已接入；原生能力目录、按钮选择、输入 `/` 自动补全、模型候选与上下文/压缩均已接入。服务器文件视图已支持分页浏览、操作任务、下载与同步协调；终端、资源详情和完整向导已接入。产品设置、删除生命周期、界面收尾和完整M6继续实施。

## M2–M6 实施范围

### M2：认证、同步与远程工作流

计划见 [M2 实施计划](superpowers/plans/2026-10-02-m2-ssh-sync.md)。

- [x] 密码与私钥共用连接解析，网页连接测试、重新认证与断开，保留 known_hosts 校验
- [x] 密码只经过内存、stdin 和受限子进程环境；受控 SSH fixture 验证错误密码、复用及主机密钥拒绝
- [x] rclone 1.75.1 双向小文件同步：10 MiB 默认上限，排除 `.git`、权重和归档等格式；状态与缓存仅在本机
- [x] 空基线、非空初始化、恢复确认、删除拒绝/确认、双方冲突保留，同工作区同步与执行串行
- [x] 前同步 → SSH → 后同步门禁；前同步失败不执行，后同步失败保留已执行命令输出
- [x] 可见页 15 秒同步、隐藏暂停、手动与轮次结束同步，无自动 Agent 轮次或结果分析
- [x] 修复后的真实六项同步验收：首次/单文件更新、远程 Python 结果、中文与过滤（含普通 `.git` 文件）、删除、同大小冲突及最后文件删除
- [x] 真实网页同步联动：连接创建、删除恢复、过滤重建、可见性调度、三种宽度与控制台检查；认证同步基础按阶段提交，记录见[验收记录](guides/m2-acceptance.md)
- [x] Windows 当前用户加密保存密码：主动断开保留保存项并暂停自动重连，重新连接复用，取消保存勾选时清除并断开，不设独立忘记入口
- [x] 独立加密存储与连接生命周期：真实 DPAPI、目标绑定、原子密文写入、重启复用、跨别名旧认证失效、取消保存失败可重试、关闭请求撤销迟到保存

保存凭据、浏览器与工程检查见 [认证同步验收记录](guides/m2-acceptance.md)。原生配置编辑与 GLM 真实调用通过，详见 [配置验收记录](guides/agent-config-acceptance.md)。Codex 使用运行时指定配置的隔离副本验收，产品仍读取原生 `config.toml`，沿用官方 Responses 路线。

用户要求查看训练进度或结果时才运行 Agent。资源刷新、同步及后台任务完成均不自动触发分析。

### M3：轻量编辑与版本记录

- [x] CodeMirror 文件面板、逐级浏览、脚本编辑、原子保存及外部改动冲突提示
- [x] 区分本地保存与服务器同步结果；保存后调用已有同步入口，不创建 git 提交
- [ ] A13 实际 SSH 端到端复验；本阶段已通过真实文件服务、HTTP 路由及受控同步的浏览器验证
- [x] 本地 Git 初始化、保存、分页历史、diff、单文件/整区恢复预览与确认；保留工作区外及排除文件的暂存内容
- [x] 恢复只改变工作树，HEAD/索引保持不变；未跟踪覆盖、陈旧确认、部分失败明确反馈，成功后进入已有同步流程
- [ ] A5 实际 SSH 端到端复验；真实 Git 与网页流程已通过，同步结果分支使用受控替身

实施与边界见 [文件编辑设计](superpowers/specs/2026-10-03-workspace-files-design.md)、[实施计划](superpowers/plans/2026-10-03-workspace-files.md) 和 [文件验收记录](guides/workspace-files-acceptance.md)。

版本实现与验证见 [版本设计](superpowers/specs/2026-10-03-local-versions-design.md)、[版本计划](superpowers/plans/2026-10-03-local-versions.md) 和 [版本验收记录](guides/local-versions-acceptance.md)。真实目标与允许创建临时子目录的位置已恢复到本机ignored配置，后续串联使用该目标；A5/A13仍待实际验收。

### M4：两类原生 Agent 能力

- [x] Codex app-server 0.156.1 接入：流式文本/工具结果、单次审批、准备及运行阶段停止、无响应时 5 秒强停
- [x] 会话按原 Agent 与官方 ID 继续；两类原生列表独立加载，历史限定当前工作区，不做跨 Agent 上下文转换
- [x] 手动模型与 Codex 推理强度；默认不传覆盖参数，实际模型仅展示。新 thread 采用新默认模型，resume 保留历史模型，显式选择才覆盖
- [x] 真实网页与 GLM 两轮：原生 MCP `remote_peek` 读取受控服务随机标记，原生列表/读取及网页原 ID 续接通过
- [x] Claude/Codex 原生重命名/删除及 Codex 归档列表/归档/恢复；运行与管理按 Agent/ID 互斥，锁覆盖同步收尾
- [x] 临时合成记录的真实 SDK/app-server 与网页管理链路通过；删除明确勾选，等待/失败/重试、后台运行锁及三种宽度完成验收
- [ ] A8 独立客户端刷新：已验证网页与原生存储/API，尚未观察 VS Code 插件界面及 CLI 交互列表，不标整项完成
- [ ] A7 实际SSH重复A1/A2；目标已恢复，按ignored运行时参数继续验收，不把受控替身视为真实链路
- [x] 按工作区/Agent 发现 skills、模型和命令；按钮搜索选择及直接 `/name` 解析，同一原生实例调用前复验，禁用/过期/歧义项明确拒绝
- [x] 两类 compact、Claude context 与 CLI-only 限制提示；纯上下文/压缩命令不触发轮次后同步，普通消息及技能仍沿用同步
- [x] 原生模型/推理强度候选并保留手动输入；目录默认项和历史实际模型不自动变为覆盖参数
- [x] Claude 原生估计、Codex last/window 状态与原生压缩边界映射；不推算缺失比例，完成必须由官方事件确认
- [x] 真实 CLI/SDK 与合成模型协议验证技能、上下文、压缩成功/失败/取消和同步边界；两类网页能力选择、状态与三种宽度通过
- [x] GLM 增量两次原生适配器运行：技能返回仅存在于 SKILL 正文的随机标记，原生上下文及手动压缩完成确认通过；源配置摘要不变，临时密钥副本清理
- [x] 输入 `/` 自动展开当前 Agent 候选；键盘选择保留焦点和参数，首次 Enter 只选择，路径/参数区/中文输入法不误触发；见[补全验收](guides/slash-completion-acceptance.md)
- [ ] 长会话在实际负载下的自动压缩与续接体验；本阶段不将合成协议及短程手动压缩视为完整长会话验收

对话阶段见 [Codex 对话设计](superpowers/specs/2026-10-03-codex-conversation-design.md)、[实施计划](superpowers/plans/2026-10-03-codex-conversation.md) 和 [Codex 对话验收](guides/codex-conversation-acceptance.md)。会话管理阶段见 [管理设计](superpowers/specs/2026-10-03-session-management-design.md) 与 [会话管理验收](guides/session-management-acceptance.md)；Codex 0.156.1 的归档记录需先恢复才能重命名。上述阶段完成不代表整个 M4 完成。

本轮原生能力的实现、证据及尚未完成项见 [原生能力设计](superpowers/specs/2026-10-03-native-capabilities-design.md) 和 [原生能力验收](guides/native-capabilities-acceptance.md)，保留 A7/A8 与 M5/M6 原有待办。

### M5：向导、远端文件管理、终端与资源状态

- [x] 完整连接向导：导入 Host / 独立手动目标、账号密码 / 私钥、实际主机指纹、草稿目录分页、按需同步预览、一次性验证创建与首次初始化；真实SSH/rclone与网页证据见[验收](guides/workspace-setup-acceptance.md)
- [x] 文件区“本地代码 / 服务器文件”双视图；SSH/SFTP 逐级分页、目录外导航、返回工作区、元数据与同步范围标记，浏览不改变同步根或自动下载；本机合成 SSH 与网页范围见[浏览验收](guides/remote-files-browser-acceptance.md)
- [x] 同服务器新建目录、重命名、移动、复制、删除的预检与任务后端，显式下载流及网页入口；右键菜单、目标选择、拖动和键盘入口，默认不覆盖同名目标，证据与阶段限制见[操作验收](guides/remote-file-operations-acceptance.md)
- [x] 同/跨文件系统操作的独立持久任务状态与结果核对机制；移动/复制在服务器完成，下载不自动纳入 Git/同步；真实跨文件系统及浏览器保存验收仍列于 M6
- [x] 与同步范围内源/目标及混合目录协调，保留编辑缓冲和冲突，防止旧路径重新生成；仅服务器操作不依赖无关同步或模型。本机受控传输与网页证据见[同步协调验收](guides/remote-file-sync-acceptance.md)，实际 rclone 与真实 SSH 保留在 M6
- [x] xterm.js SSH终端基础：固定目标、目录确认、独立PTY、复制粘贴、稳定多标签/分屏和可调主区；一次核心Review及本机真实ssh2/Chrome验收完成，见[记录](guides/web-terminal-acceptance.md)。真实htop/nvitop PTY已复验，原生OS输入法与密码串联仍待验，A10/A12保持部分完成
- [x] 基于已有 `nvidia-smi` / Linux 信息的 GPU、CPU、内存、磁盘与进程详情，标注采集主机、独立时间和不可用状态；真实SSH和网页证据见[资源验收](guides/resources-acceptance.md)
- [x] 资源采样与 AI 对话独立，按实际认证身份共享并控制刷新开销；不依赖 `nvitop` 或服务器新装软件；顶栏概览和可调参数继续收尾
- [ ] 对话、终端、资源采样和同步分别反馈状态；对话 / 终端运行期间资源仍刷新，不以整页加载阻塞其他入口

### M6：设置、完整链路与并发验收

- [ ] 产品默认设置与环境检测入口：新会话 Agent/模型、同步默认值、可调同步间隔和资源刷新参数；“跟随本地配置”不被隐式改为模型覆盖
- [ ] 工作区默认黑名单的网页停用/恢复与自定义规则追加，规则存储、校验和执行贯通；现有实现只有默认规则及配置中的停用项
- [x] 工作区配置删除的网页入口及活动资源收尾：配置确认、活动/持久任务/离线编辑器阻断、所属PTY/SFTP关闭和迟到收尾；真实SSH与Edge三宽度通过，见[验收](guides/workspace-removal-acceptance.md)
- [ ] 原界面目标收尾：侧栏折叠、可调分栏、亮色切换、网页命令面板、长会话虚拟列表/工具分组、本轮改动与 diff 行内反馈
- [x] Claude/Codex 固定原生文件编辑、语法校验、外部修改检测、原子保存与关闭清理
- [x] Claude 真实 SDK 的两次 query 读取新配置；Codex 官方 config/read 重读隔离配置
- [x] Codex 隔离原生运行时真实下一次调用：更新后的 GLM 配置通过，源配置保持不变
- [x] Codex 网页适配器重读配置、原生 MCP 与受控内部接口、原生历史续接；源配置摘要不变，临时密钥副本清理，内部令牌不落盘且结束撤销
- [x] 受控客户端/进程与浏览器：审批等待后端确认、禁止重复、单次批准/拒绝，准备阶段停止及 5 秒强停，未返回的工具结果不标完成，单来源列表失败不遮蔽另一来源
- [x] Codex 对话在 960/1280/1920 宽度无横向溢出，实际截图见 Codex 对话验收
- [ ] A5/A13/A7 新入口的真实 SSH 与同步完整串联；可信私钥目标已从本机恢复，连接参数只在ignored运行时文件中使用
- [ ] A20–A23 真实 SSH 文件管理与下载验收：大文件只在远端操作、跨文件系统移动、同步目录迁移、目标冲突及取消结果；验证过程只使用指定测试目录
- [ ] 验证对话、终端、资源采样与同步同时运行的响应，单会话单轮、同工作区同步串行、超时和输出限制，记录架构 V16、V17 的真实结论

尚未完成的项目按相应里程碑继续设计、实施和验证，不把需求归档当作实施完成。详细待验证事项见 [架构第 8 节](engineering/architecture.md#8-待验证事项)。

连接向导[PR #8](https://github.com/Heaven-y/ssh-server/pull/8)双平台CI37234735439成功，随后以两级--no-ff合入feat（5147dc0）与main（7845821）并推送；[main CI37235267430](https://github.com/Heaven-y/ssh-server/actions/runs/37235267430)双平台成功。工作区删除生命周期从最新feat创建codex/workspace-lifecycle继续实施。

2026-10-05 状态核对：浏览和操作阶段已整合；Task 4 同步路径协调及编辑保护已接入，本机核心回归与网页证据见同步协调验收。A20–A23 的真实 SSH、实际 rclone 迁移、跨文件系统和浏览器磁盘保存仍不能标记为完整通过；终端本机基础及真实PTY全屏工具、资源详情与真实只读指标完成。五步连接向导已实现，一次Review的两项问题先复现后修复；真实SSH创建/初始化、三宽度网页、手动目标与Windows保存密码验收通过。产品设置/删除/界面和完整M6继续实施。

Task 4阶段已使用两级 `--no-ff` 合入 `feat/ssh-workflow` 和 `main`；[此前main CI](https://github.com/Heaven-y/ssh-server/actions/runs/37190899240)双平台成功。终端[PR#5](https://github.com/Heaven-y/ssh-server/pull/5)的[双平台CI](https://github.com/Heaven-y/ssh-server/actions/runs/37224820671)成功；随后Linux暴露的同步恢复收尾竞态已修复，[PR#6](https://github.com/Heaven-y/ssh-server/pull/6)与[main d0547e8 CI](https://github.com/Heaven-y/ssh-server/actions/runs/37226825812)双平台成功。资源详情一次Review及最少核心回归完成；真实工具浏览器画面、原生OS输入法和密码重启串联仍在A10/A12，整项目目标保持进行中。
