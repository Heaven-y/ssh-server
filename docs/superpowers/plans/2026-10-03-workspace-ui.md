# 工作区界面改版实施计划

设计见 [工作区界面](../specs/2026-10-03-workspace-ui-design.md)。在当前功能分支继续，按完整界面阶段提交，不推送。

状态：已完成实现、审核修复与受控验收。24 项前端测试、相关工程检查以及主要视图浏览器回归通过；详见 [界面验收](../../guides/workspace-ui-acceptance.md)。恢复了新建工作区连接测试期间取消，并修复详情弹窗关闭后的焦点恢复。

1. 主线程：确定中性深色语义色与通用控件；实现 DetailDialog、顶栏、紧凑 SSH/同步状态与 App 布局。
2. 子任务：调整工作区/会话导航与新建工作区模态表单，保留状态、校验及取消行为。
3. 子任务：优化对话正文、工具/审批卡片与输入框；保持流式与发送逻辑。
4. 集成与审查：检查详情隐藏时的同步调度、认证生命周期、焦点和草稿；按实际缺陷修复。
5. 验证所有受全局样式影响的主要视图和三个宽度，运行关联工程测试，更新参考文档/界面文档/路线图并提交。

共享约定：主线程拥有 styles.css、ui/styles.ts、ui/DetailDialog.tsx、App/TopBar、features/ssh/SshConnectionPanel.tsx、features/sync/SyncPanel.tsx；导航子任务只改 features/workspaces；对话子任务只改 features/chat 的展示组件。新语义色 success 用于成功，accent 用于蓝色主操作和焦点，warning 用于待确认。后端与协议不改。
