# 工作区布局与导航实施计划

> 使用executing-plans在本会话Native实施，用户授权自主决策、核心完成后一次独立Review再补最少回归；不用重复确认或逐步TDD，不调用astra，不续接历史代理。

目标：可折叠/可调工作区布局、亮色主题、网页命令面板和持续资源概览。
架构：浏览器UI偏好与官方分栏用户交互回调、有界像素持久化；cmdk+原生dialog复用已有动作ref；顶栏与资源详情共用单一controller。
技术：React19、zustand、TanStack Query、react-resizable-panels4.14.2、cmdk1.1.1、现有CodeMirror/xterm。
设计：docs/superpowers/specs/2026-10-05-workspace-navigation-design.md。

## 全局约束与Review Focus

中文UTF-8/LF；默认暗色、非敏感偏好版本1；侧栏240/200–320px、文件420/360–520px，断点1280px；资源沿用动态参数与固定目标；不额外模型/服务器安装/调度；两级--no-ff。

1. 文件/PTY/草稿在折叠、断点、主题和窗口缩放后保持实例、身份和焦点。
2. 坏/不可用浏览器存储和极端历史宽度不会让主区消失或阻止使用。
3. 模态、IME及xterm不被Ctrl+K劫持，命令的陈旧目标/历史请求不能误作用新工作区。
4. 持续概览与详情不叠加采样，隐藏/断线/设置失败暂停，null/失败/过期不伪造正常数值。
5. 同步动作沿用忙/待确认门禁，保存版本仍需用户原有说明与确认，不通过快捷操作自动提交。

## 任务1：布局和主题

文件：web/app/{App,TopBar,WorkspaceLayout}.tsx、ui/ui-preferences.ts、styles.css、ui/CodeEditor.tsx、features/files/FilePanelFrame.tsx、features/workspaces/WorkspaceSidebar.tsx。
接口：useUiPreferences持有theme/sidebarCollapsed和版本化存储；WorkspaceLayout包裹导航与主区；Workspace文件分栏同子树；FilePanelFrame宽窗适配父panel，窄窗保留modal。

- [x] UI偏好、主题语义变量及CodeMirror主题，存储失败可继续。
- [x] 官方Panel侧栏折叠/拖动持久、文件分栏与覆盖层、保留终端/编辑子树。
- [x] 相关类型/lint/build及既有文件/终端/生命周期回归通过，提交。

## 任务2：持续资源概览

文件：features/resources/{ResourcesPanel,ResourceOverview}.tsx、use-resources.ts；TopBar/App。
接口：useResources(workspace)单controller供概览和详情；ResourcesActions.open()通过ref打开，目标变化使用固定key重建目标controller。

- [x] 持续概览、实际目标/时间/过期/空值；同一controller打开详情。
- [x] 可见性/网页连接/参数读取门禁和恢复检查，无重复timer/请求。
- [x] 相关静态检查及既有资源回归通过，提交。

## 任务3：网页命令面板

文件：app/{CommandPalette,use-command-palette}.tsx/ts；SyncPanel、VersionsPanel类型化动作ref；package.json/package-lock.json。
接口：CommandPalette接收workspaces/current及既有UI动作；cmdk1.1.1；SyncActions.run()与VersionActions.open()复用原动作，ResourcesActions来自T2。

- [x] 依赖固定，工作区/当前两Agent会话与常用操作分组、错误独立反馈。
- [x] 全局快捷键门禁、模态焦点/恢复及提交时目标复验，版本/同步原有边界。
- [x] 相关类型/lint/build与既有会话/同步回归通过，提交。

## 任务4：一次Review、核心与全局视觉验收

- [ ] 新gpt-6.1-sol一次阶段核心Review，逐项裁定，不重复派审。
- [ ] 最少核心回归偏好/快捷键/目标/共享资源/隐藏断线/动作边界，重要问题RED→GREEN。
- [ ] 两主题三宽度全局视觉、布局持久与编辑/PTY保留、真实资源增量；正式需求/架构/决策/路线图/验收同步。
- [ ] 工程门禁、PR双平台CI，两级--no-ff/main CI，继续长会话/diff和完整M6。

自查：T1主题/布局由T2/T3复用；T3通过T2资源ref而不新建查询；同步/版本ref只委托已有流程；T4扩大验证公共样式，不重复已通过未受影响后端逻辑。
