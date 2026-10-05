# 本轮改动与行内反馈实施计划

**Goal：** 真实轮次快照、改动视图、成熟diff渲染、待发送行反馈及有确认的单文件放弃。
**Spec：** [C01–C09](../specs/2026-10-05-conversation-changes-design.md)
**方式：** Native，用户授权自主记录；一次阶段核心Review后补最少回归。

## 全局约束

中文UTF-8/LF；不调用astra、不续接旧代理；不写真实目标。Git快照不提交、不动HEAD/index；复用既有过滤、同步串行、活动租约及恢复原子性。快照失败不阻断Agent；纯命令不采集/同步。最多20轮、反馈20条/每条3000/总12000字符、diff512KiB。代码和正式文档随阶段提交，两级--no-ff。

## Review Focus

- 同期外部编辑、预存脏内容、暂存内容和改后复原，净diff与比较范围不误归因。
- 准备取消/采集失败/同步失败/进程重启、首次原生id，租约收尾且状态不假成功。
- 目录/过滤变化、私有引用被外部改写、20轮淘汰和不安全路径，不能读取或删除别的对象。
- diff旧/新侧行号、二进制/截断/解析失败、键盘与窄窗，反馈不伪造行锚点。
- 反馈添加后选择变化/断线/能力选择、陈旧放弃预览与未保存缓冲，不串会话、不丢输入、不自动发送/提交。

## Task 1：版本快照和单文件放弃基础

Files：shared/versions.ts与turn-changes.ts；vcs/{service,history,index,restore}.ts；新增vcs/turn-snapshots.ts。
Interfaces：VersionsService.captureTurn(ws,turnId,edge:'base'|'result')返回TurnSnapshot；diffTurn(ws,base,result,path?)返回TurnDiff；releaseTurn(ws,snapshots)只处理本功能refs；previewDiscard(ws,path)、discard(ws,{path,revision,confirmed})复用恢复基础。

- [ ] 临时索引生成树，assertFresh后写绑定范围的专用引用；只在已有仓库采集，失败保留原因。
- [ ] 两快照比较返回文件/增删行/二进制及有界patch；校验当前范围和私有引用，拒绝任意OID读取。
- [ ] 单文件放弃预览包含未跟踪新增删除；使用当前HEAD/空树、实际指纹与既有原子恢复，不动用户提交史。
- [ ] 类型/相关lint和既有版本回归；真实临时Git核对净diff、HEAD/index、暂存及放弃。提交feat(changes)。

## Task 2：轮次生命周期与HTTP

Files：新增chat/turn-changes.ts、http/turn-changes.routes.ts；修改turn-manager、main、shared/protocol、versions.routes与web/lib/api。
Interfaces：TurnChanges.begin(ws,turnId,{agent,sessionId?})、finish(ws,turnId,{sessionId?,interrupted})、list(ws,{agent,sessionId?})、diff(ws,turnId,path?)；记录状态preparing/running/complete/incomplete/unavailable。TurnManagerDeps.changes为可选。

- [ ] 有界元数据原子保存、20轮保留，重启未完成记录标不完整，查询验证会话和目录/规则身份。
- [ ] 普通runner前开始、既有同步后结束；纯上下文命令跳过，错误/取消不影响原有Agent/同步结果，租约最后释放。
- [ ] HTTP只开放绑定工作区/会话的记录和diff；放弃复用已有同步transaction；完成事件只通知所属网页刷新。
- [ ] 类型/相关lint及既有turn/session/HTTP回归；受控轮次验证准备取消、失败和同步收尾。提交feat(chat)。

## Task 3：改动面板与行反馈

Files：新增web/features/changes；修改FilePanel/视图、ChatView/Timeline聚合入口、Composer、chat-store、VersionDiffView、package/lock。
Interfaces：ChangesPanel接收固定workspace/会话身份；DiffView({patch,source,onFeedback})用@pierre/diffs；useChat.addFeedback/removeFeedback仅内存、绑定conversationVersion，send普通消息时合并成功才清空。

- [ ] 安装固定diff组件；按需单文件加载/主题、增删行/二进制、错误/截断及有界原文本降级；文件三视图保持原子树。
- [ ] 所属轮次聚合卡片/入口及相对上次保存视图，异步目标校验与取消，旧结果不替换新会话。
- [ ] 行点击与键盘等价入口、待发反馈列表/移除，正文保留、连接失败保留、普通发送成功消费；能力选择与目标切换门禁。
- [ ] 单文件放弃预览与显式确认，反馈本地结果和同步待确认，不自动提交/覆盖编辑缓冲。
- [ ] 类型/相关lint、构建及相关回归；Edge两主题三宽度、同编辑DOM/草稿、反馈与放弃入口。提交feat(changes)。

## Task 4：核心Review与整合

- [ ] 一次新独立Reviewer完整分支，逐项裁定与记录；Important/Critical一轮修复且RED→GREEN，不复审。
- [ ] Review后补最少核心：真实Git前后快照/保留、生命周期取消、行反馈身份与成功消费、陈旧/未跟踪放弃；测试不写绝对路径。
- [ ] 正式需求/架构/决策/进度/验收同步；最终既有门禁、中文提交与PR，双平台CI后两级--no-ff，核对树并推送main。
- [ ] main CI与小分支合入/占用核对，安全清理小分支；继续真实SSH、原生长负载与多活动完整M6。
