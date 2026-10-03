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

- [ ] 实现路径/根/链接保护、身份与对象绑定的预检、默认不覆盖语义和能力检查。
- [ ] 实现新建目录、重命名、同服务器移动/复制/删除及独立持久任务状态；按相交路径排队，重复提交不重复执行。
- [ ] 实现跨文件系统复制、核对、移除源的阶段状态；取消和断线保留部分结果并可核对。
- [ ] 实现显式 SFTP→HTTP 流式下载、取消和浏览器保存；不进入同步/Git，不缓冲完整大文件。
- [ ] 接入按钮、菜单、目标选择、键盘与拖动预检；审查后补最少核心回归与对应浏览器/SSH 验收。

## Task 4: 同步路径协调与完整验收

- [ ] 按 SSH 实际身份计算所有受影响工作区，对混合目录显式扫描并显示不完整结果。
- [ ] 按工作区 ID 固定顺序获取同步事务，检查冲突和编辑缓冲，建立稳定映射与执行前基线。
- [ ] 远端变更后调整受控镜像、基线和本地映射，避免旧路径上传；并发外部编辑保留为冲突。
- [ ] 区分远端结果和同步结果，持久化恢复状态；同步重试不得重复远端写操作。
- [ ] 核心审查后覆盖移入/移出、跨已配置工作区、混合目录、取消、陈旧预检与同步失败恢复。
- [ ] 在指定真实 SSH 测试目录验收 A20–A23，更新全部实现状态和证据后整合阶段。缺少真实目标时明确保留未验收项，不伪称 F10 已全部完成。
