# 服务器文件管理实施计划

> **For agentic workers:** 使用 `executing-plans` 或 `subagent-driven-development` 按任务推进。用户已明确要求更新文档并开始实施；不再为常规实现安排重复确认。遵循用户“核心实现与审查后补最少测试”的顺序。

**Goal:** 在现有文件面板提供服务器实际目录与直接操作，浏览位置独立于固定同步根。

**Architecture:** 复用连接池的认证和主机校验，为文件浏览建立独立 SFTP 通道；面板上下文绑定打开时的配置及 SSH 认证代次。目录浏览不依赖同步，后续写操作按路径接入同步协调。

**Tech Stack:** Node.js 22、TypeScript、Fastify、ssh2、React、既有 Tailwind 与 Ariakit。

**Spec:** `docs/superpowers/specs/2026-10-03-remote-files-design.md`。

## Global Constraints

- 保持公开仓库的合成示例、中文文案、UTF-8/LF；不写真实连接信息或密钥。
- 不调用模型、不安装服务器程序；目录读取只取当前层元数据。
- 浏览范围为同一 SSH 账号可访问目录；浏览位置不修改工作区同步配置，不触发同步或下载。
- 新增测试放在对应包 `tests/`，仅覆盖核心边界与关联回归，不重复未受影响的全量测试。
- 在当前小分支实施；可验收阶段成组提交。仅全部相关检查通过后按既定 `--no-ff` 流程整合。

## Review Focus

- Host/config/认证代次在请求期间变化时，旧面板不得读取另一目标。
- 同一分页请求重试、响应丢失或并发导航时，不跳项、不无限累积句柄和缓存。
- 超时、断线、关闭和 React 开发模式重新挂载时，不泄漏 SFTP 通道或保留后台请求。
- 远端合法而 Windows 无法表示的文件名仍能浏览，但不得错误标为可同步。
- 切换服务器视图或聊天工作区时，本地未保存缓冲和已打开面板目标保持正确。

## Task 1: 目录浏览后端与共享接口

**Files:** 新增 `packages/shared/src/remote-files.ts`、`apps/server/src/ssh/sftp.ts`、`apps/server/src/remote-files/{errors,paths,directory,service}.ts`、`apps/server/src/http/remote-files.routes.ts`；修改共享入口、连接池与 `main.ts`。

**Interfaces:**
- `SshPool.openSftp(target: SshTarget): Promise<SFTPWrapper>` 只打开独立通道，不断开共享连接。
- `POST /api/workspaces/:id/remote-files/bindings` 接受 `RemoteBrowseTarget`（面板打开时的 sshHost、authMode、remoteDir、localDir），返回 `{ binding }`，只登记身份与信任配置，不打开 SSH。`POST /api/workspaces/:id/remote-files/sessions` 接受 `{ ...target, binding }`，返回 `RemoteBrowseSession`（id、workspaceId、sshHost、root、home）；首次浏览及重连均复验同一绑定。
- `GET /api/workspaces/:id/remote-files/sessions/:sessionId?path=...&cursor=...` 返回 `RemoteDirectory`。空 path 表示固定工作区根，其他相对路径从根解析；绝对路径和 `~` 可浏览目录外。
- `DELETE` 同一 session URL 释放该面板独立资源，返回 204；不存在时仍可安全关闭。
- 每页最多 200 项，句柄闲置 60 秒失效；最多 32 个面板会话，会话闲置 15 分钟结束。同 session 的读取串行，独立面板不共用目录游标。

- [x] 实现共享结构、SFTP 超时/关闭、固定目标与路径解析。
- [x] 实现按句柄读取和可重试游标，仅保留当前及重试所需的一页；过期明确返回错误。
- [x] 实现严格路由校验、固定错误文案、`no-store` 与退出清理。
- [x] 核心审查后补目录分页、目标变化、资源关闭、无同步依赖及路径分类测试；覆盖路由拒绝未知字段和错工作区 session。
- [x] 执行 server/shared 类型检查及新增代码 lint/格式，运行上述测试和连接池直接相关回归。

## Task 2: 文件双视图与导航

**Files:** 新增 `apps/web/src/features/remote-files/{RemoteFilesPanel,use-remote-directory,RemoteDirectoryList}.tsx/ts`（按职责使用实际扩展名）；修改 `features/files/FilesPanel.tsx` 与 `lib/api.ts`。

**Interfaces:** 复用 Task 1 共享结构；`RemoteFilesPanel` 接受打开时的 `Workspace` 和 `active: boolean`。挂载即登记 binding，只在首次选择服务器视图时创建 session，重连保留原 binding；卸载时关闭，隐藏保留路径与当前页，不继续轮询。

- [x] 将既有本地编辑内容封装为保持挂载的区域；切换视图不调用放弃编辑确认、不覆盖缓冲。
- [x] 新增服务器 Host、固定同步根、实际路径、工作区外标记、返回工作区、上级、路径输入和面包屑。
- [x] 列表显示类型、大小、修改时间、相对当前工作区的同步范围；显示隐藏项开关、逐页导航和元数据详情，不伪装存在未实现的写操作。
- [x] 处理加载、取消旧导航、失败重试、过期重连及目标变化；不把未知同步状态显示为已一致。
- [x] 用浏览器核对同服务器目录外浏览、不改变 workspace、重试、缓冲保留、焦点键盘及 960/1280/1920 布局。
- [x] 整体审查后执行相关类型/lint/格式与网页构建，更新需求、路线图和验收边界，成组提交浏览阶段。

## Task 3: 操作预检、任务与显式下载

依赖前两项的 SFTP 通道与固定目标结构；接口与实际服务器能力在本阶段开始时进一步核对，不用浏览阶段的通过代替本阶段验收。

2026-10-04 接续细化：在 `codex/ssh-workflow-file-operations` 实施。浏览阶段已单独验证与提交，保留其可靠基准，不在每个操作改动后重跑全仓测试。

**Files:** 新增 `remote-files/{remote-helper.py,executor,preflight,tasks,path-locks,downloads}.ts/py`、`http/remote-file-actions.routes.ts` 和网页操作控件；修改共享类型、浏览服务的固定上下文接口、连接池的独立执行通道与 `main.ts`。按实际职责拆分文件，不建立空模块。

**Interfaces:**
- 浏览服务 `context(workspaceId, sessionId, signal?)` 复验原绑定并返回固定工作区、规范化根及 SSH 身份。文件任务独立于浏览会话，关闭面板不取消已提交任务。
- `POST .../remote-files/sessions/:sessionId/preflights` 接受 `{ kind, source?, destination? }`，返回两分钟有效的 `RemoteFilePreflight`；`POST .../remote-files/tasks` 只接受 `{ preflightId, confirmed: true }`，重复提交返回同一任务。
- `GET .../remote-files/tasks`、`GET .../tasks/:taskId` 查询状态，`POST .../tasks/:taskId/cancel` 请求取消，`POST .../tasks/:taskId/check` 核对不确定结果。任务先原子持久化，再开始远端变更；重启不自动重放写操作。
- 固定远端处理器通过已有 Python 3 标准库执行，不安装程序、不接收任意命令。操作能力要求 Linux 的目录描述符和 `renameat2(RENAME_NOREPLACE)`，预检验证缺失能力；通过不跟随链接的目录描述符管理路径，复制核对在服务器完成。缺失时保留浏览/下载，明确拒绝不具备保证的操作。
- 新建目标只使用原子不覆盖原语；同文件系统移动原子重命名，跨文件系统移动依次复制、校验和移除源。树扫描有条目、深度与时间上限，不完整扫描阻止提交，不声称没有同步影响。
- `GET .../sessions/:sessionId/download?path=...` 只下载确认的普通文件，独立 SFTP 通道以有界缓冲流至 HTTP。浏览器取消只关闭该流，保存结果不进入工作区镜像。
- Task 4 提供同步协调接口；其接入前涉及同步范围的写操作明确不可提交，不能先改远端再运行普通双向同步。该临时阶段限制不会作为 F10 完成条件。

**Verification:** 核心实现与审查后，只补不覆盖、根/链接保护、陈旧预检、重复提交、任务重启/取消及下载背压的关键测试；先运行指定测试和 server/web 类型检查，再对新增代码执行 lint/格式与网页构建。真实 SSH 仅在确认的临时目录进行，不以协议替身代替完整验收。

- [x] 实现路径/根/链接保护、身份与对象绑定的预检、默认不覆盖语义和能力检查。
- [x] 实现新建目录、重命名、同服务器移动/复制/删除及独立持久任务状态；按相交路径排队，重复提交不重复执行。
- [x] 实现跨文件系统复制、核对、移除源的阶段状态；取消和断线保留部分结果并可核对。
- [x] 实现显式 SFTP→HTTP 流式下载、取消及浏览器保存入口；不进入同步/Git，不缓冲完整大文件。真实浏览器磁盘保存仍待验收。
- [x] 接入按钮、菜单、目标选择、键盘与拖动预检；审查后补最少核心回归并完成合成 SSH 网页交互验收，见[验收记录](../../guides/remote-file-operations-acceptance.md)。
- [x] Linux helper 的 5 项实际文件系统回归及双平台 CI 门禁通过，见操作验收。
- [ ] 在指定真实 SSH 临时目录验收操作和下载。

## Task 4: 同步路径协调与完整验收

2026-10-04 接续细化：从已整合的 `feat/ssh-workflow` 创建 `codex/ssh-workflow-file-sync`。复用现有工作区事务和稳定镜像，不将服务器变更塞入普通 `execute()` 前后同步。

**Files / Interfaces:**
- `sync/snapshot` 为任务创建独立镜像与可恢复的原始文件身份/摘要清单，清单不保存正文；普通同步仍使用原有镜像。恢复只使用与工作区配置、过滤规则一致的快照。
- `sync/state` 持久保存待协调任务 ID；存在该 ID 时，普通同步、初始化与远程执行均暂停。相关工作区按 ID 固定顺序进入事务，建立快照与阻断记录后才派发远端写操作。
- `sync/remote-changes` 提供准备、完成和派发前撤销；远端完成后单向拉取小文件到任务镜像，以远端优先的 resync 重建 bisync 基线，再比较原始文件身份回写。外部本地编辑保留为冲突，Git 索引与历史不参与重建。
- `rclone` 增加仅向受控镜像拉取和远端优先重建的接口；恢复不得使用当前旧路径镜像向远端上传。仅服务器操作不进入这些事务，也不依赖无关工作区同步。
- `remote-files/sync-coordinator` 组装跨工作区事务；`tasks` 区分远端已完成、同步待恢复和部分结果，确认后的同步恢复只读取实际远端状态，不重新执行写操作。重启仍保留工作区阻断记录。
- 预检补充有界目录元数据清单，按各工作区过滤规则计算移入/移出与混合目录影响；网页登记已知编辑缓冲，相关未保存修改先保存或明确放弃。全部接口接通前保持现有提交门槛。
- `file-editors` 使用独立 WebSocket 登记路径及 dirty/busy 元数据，不传编辑正文。操作时先锁客户端并等待最新状态确认；因执行前同步影响整个工作区，保守检查相关工作区全部已知编辑器。登记存在性持久化，断线或重启后状态未知则阻止操作；重连原页面或显式确认放弃断开的登记后才能继续。开发代理必须同时转发 `/api` 的 WebSocket。
- 恢复接口仅接受严格的 `{ confirmed: true }`，后台独立运行并支持取消。网页确认说明按实际远端结果重建同步，不重放写操作，部分产物与本地冲突需继续核对。

**Verification:** 核心实现和独立审查后，集中覆盖移出后旧路径不上传、移入小文件/排除大文件、跨工作区固定锁序、同步失败/重启恢复不重放、外部编辑冲突与已知缓冲门槛。不为每个内部函数补镜像测试；直接受影响的同步/文件/任务回归增量运行，阶段整合再执行现有 CI 门禁。

- [x] 按 SSH 实际身份计算所有受影响工作区，对混合目录显式扫描并显示不完整结果。
- [x] 按工作区 ID 固定顺序获取同步事务，检查冲突和编辑缓冲，建立稳定映射与执行前基线。
- [x] 远端变更后调整受控镜像、基线和本地映射，避免旧路径上传；并发外部编辑保留为冲突。
- [x] 区分远端结果和同步结果，持久化恢复状态；同步重试不得重复远端写操作。
- [x] 核心审查后覆盖移入/移出、跨已配置工作区、混合目录、取消、陈旧预检与同步失败恢复；本机与网页范围见[协调验收](../../guides/remote-file-sync-acceptance.md)。
- [ ] 在指定真实 SSH 测试目录验收 A20–A23，更新全部实现状态和证据后整合阶段。缺少真实目标时明确保留未验收项，不伪称 F10 已全部完成。
