# 长会话与工具分组实施计划

**Goal：** 在现有对话中提供动态高度虚拟列表和保留原始状态的工具分组。
**Spec：** [设计与L01–L06](../specs/2026-10-05-conversation-timeline-design.md)
**方式：** Native；用户授权自主执行，设计与决策落盘；一次阶段核心Review后补最少核心回归。

## 全局约束

中文、UTF-8/LF；仅网页展示变化，不改Agent/审批/同步协议；不调用astra，不续接旧代理。核心测试不写绝对路径。既有选择代次和turnId门禁保持；不将受控长历史标为实际原生压缩。从feat8a18738创建codex/conversation-timeline。

## Review Focus

- 同一assistant条目持续增高、上翻及窗口缩放，不抢用户阅读位置。
- 连续读取中有失败/运行/未返回，摘要不能显示全部成功；未知工具或审批不会并入读取组。
- 一个工具后来成为组、滚出视口再回来，展开状态不丢且key不串条目。
- 首次原生sessionId、重开同一历史和快速切换，列表身份正确，迟到事件不污染。
- 2000轮、代码块和工具长输出两主题三宽度，DOM有界、键盘入口及布局不溢出。

## Task 1：条目投影与可保留展开

Files：新增features/chat/timeline-model.ts、ToolGroup.tsx；修改MessageItem.tsx、ToolCard.tsx。
Interfaces：projectTimeline(items: ChatItem[]): TimelineRow[]；TimelineRow为message(item)/read-group(items)，均有id。ExpandedProps提供expanded:boolean及onExpandedChange(open:boolean)。

- [ ] 按L02白名单投影，组至少两项、保持顺序与原状态，禁止shell推断；摘要分别显示进行中/失败/未返回数量。
- [ ] 工具/思考可接收受控展开参数，未传时保持现有默认折叠；组内复用原ToolCard。
- [ ] 验证类型/相关lint与既有chat-reducer、message、tool、permission回归；提交feat(chat)中文记录。

## Task 2：动态虚拟列表与会话身份

Files：新增ChatTimeline.tsx；修改ChatView.tsx、chat-store.ts、web/package.json和lock。
Interfaces：ChatTimeline({items,running})使用Task1投影；conversationVersion:number沿用changeSelection返回值。

- [ ] 安装react-virtuoso4.18.16；去除use-stick-to-bottom。动态高度、首屏LAST、上下300px、估计120px、即时followOutput。
- [ ] 在时间线父层按条目id保留展开状态；同条目增高仅贴底调用官方autoscrollToBottom；回底按钮走scrollToIndex。
- [ ] selectWorkspace/newSession/setAgent/openSession更新conversationVersion，原生session事件不更新；Messages使用版本key。
- [ ] 类型/相关lint/网页构建与既有会话回归通过；受控Edge10000条目负载、流式/上翻/折叠/身份/两主题三宽度增量；提交perf(chat)。

## Task 3：核心Review、最少回归与整合

Files：核心tests/features/chat；正式验收、ui-layout、architecture、decisions、roadmap及剩余核对。

- [ ] 一次新独立Reviewer覆盖完整分支，按实际影响裁定，每项决定记录；Important/Critical一轮修复且RED→GREEN，不重复复审。
- [ ] Review后补核心投影与身份回归；必要虚拟滚动使用实际浏览器验证，不通过mock声称实际DOM性能。
- [ ] 正式文档只记录实际证据，执行既有最终门禁与构建；中文提交和PR，双平台CI成功后两级--no-ff、核对树再推送。
- [ ] 核对已合并且无工作树占用后删除小分支，保留feat。继续本轮改动/diff及完整M6。
