# 工作区删除生命周期实施计划

> Native执行，使用executing-plans逐项实施；用户授权核心实现后一次Review再补核心测试，覆盖技能的每步TDD和重复确认。禁止astra，不续接旧代理。

目标：安全移除工作区配置，保留项目文件/原生历史，并处理所属网页和通道生命周期。
设计：[工作区生命周期](../specs/2026-10-05-workspace-lifecycle-design.md)。分支：最新feat/ssh-workflow → codex/workspace-lifecycle，使用已有隔离工作树。

## 全局约束

- 中文、UTF-8/LF，真实参数仅本机ignored文件；不改技术栈、不删除项目/会话/凭据。
- 活动门禁按工作区，无全局等待；删除确认必须绑定当前配置，存储回调不能重入store。
- 阶段仅相关类型/lint/build，核心Review后补少量核心回归，阶段门禁不降覆盖率门槛。
- 双平台PR CI后两级merge --no-ff，保留feat分支；仅删除已合并且无工作树占用的小分支。

## Review Focus

1. 删除标记与新对话、创建初始化、编辑器登记、HTTP/WS升级同时发生时，不能继续使用已移除目标写文件。
2. 跨工作区任务、needs_check/sync_pending和离线编辑器阻止删除，不因列表或当前选择变化丢失阻断。
3. 异常/断开/迟到响应释放正确租约，删除失败不永久锁定，普通读请求不造成共享连接断开。
4. 存储快照复验、重复DELETE和保存失败不能删除不同记录或错误回显成功；原生历史与两端文件保留。
5. 仅所属终端/浏览关闭，其他工作区PTY继续交互；网页当前选择、独立文件面板和资源订阅正确收尾。

## 任务1：活动门禁、删除服务与HTTP契约

文件：shared/src/workspace-removal.ts/index.ts；server/src/workspaces/{activity,removal,store}.ts；http/workspace-activity.ts、workspaces.routes.ts/app.ts。
接口：WorkspaceRemovalInput={configuration:string,confirmed:true}；WorkspaceRemovalPreview={workspace,configuration,blockers:Array<{code,message}>}；activity.acquire(id):()=>void、assertOpen(id)、exclusive<T>(id,operation):Promise<T>；removal.preview(id)/remove(id,input)。store.remove(id,beforeRemove?:current=>Promise<void>)。

- [x] 实现幂等租约和closing边界；删除服务先阻断检查，再存储队列内快照与活动复验，成功后调用所属清理。
- [x] 严格DELETE与预览，接入HTTP请求生命周期；无注入的纯存储夹具保持已有接口，生产必须注入完整服务。
- [x] shared/server类型及相关lint/格式通过，提交任务1与设计/计划。

## 任务2：活动与通道接线

文件：chat/turn-manager.ts、sync/manager.ts、files/editors.ts、remote-files/{tasks,service,preflight}.ts、terminal/manager.ts、http/file-editors.routes.ts、workspaces/setup/verification.ts、main.ts。
接口：sync.busy(id)、tasks.blockers(id)、editors.hasWorkspace(id)；terminal/browse/preflights.closeWorkspace(id)。TurnManagerDeps.acquireWorkspace?(id):release；创建提交点获得租约，初始化收尾后释放。

- [ ] 对话租约覆盖准备、模型运行与同步收尾；编辑器登记覆盖串行保存；初始化从创建写盘前到结果完成都属于同一活动。
- [ ] 阻断查询包含持久未解决状态及所有affectedWorkspaces；所属终端/SFTP关闭和预检撤销复用既有清理，池不全局断开。
- [ ] main完整生产接线，类型/相关静态检查通过，提交。

## 任务3：网页移除与选择收尾

文件：features/workspaces/WorkspaceRemoveDialog.tsx/WorkspaceSidebar.tsx；app/App.tsx；features/chat/chat-store.ts；features/terminal/terminal-store.ts；lib/api.ts。

- [ ] 每行移除按钮、配置预览、保留内容、阻断原因、默认未确认及单次提交；失败保持目标和重试。
- [ ] 成功刷新/清理查询及所属布局；当前项移除后选择下一项或空，独立文件/资源面板关闭，外部卸载不切换其他目标。
- [ ] web类型、相关lint/格式/build通过，提交。

## 任务4：一次Review、核心回归、验收和整合

- [ ] 一次独立Review，Focus逐项裁定；核心问题先RED再GREEN，不重复派审。
- [ ] 核心回归：租约与删除互斥/异常释放；陈旧确认/写盘失败/重复删除；对话与初始化活动；跨工作区持久任务/离线编辑器；所属通道关闭、其他通道保留；网页确认/失败/最后一项与迟到。
- [ ] 真实ssh2和Edge三宽度验证项目文件保留、PTY/SFTP隔离、选择/弹窗与无pageerror；正式需求、架构、决策、路线图及验收同步更新。
- [ ] 工程门禁、PR双平台CI、两级--no-ff与main CI，继续产品设置/界面/完整M6。

自查：T1定义契约，T2提供所有阻断与清理，T3完成用户入口，T4核对核心目标和实际证据；不新增自动磁盘清理或原生会话删除。
