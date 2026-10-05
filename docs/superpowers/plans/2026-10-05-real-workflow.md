# 完整真实链路验收实施计划

**Goal：** 完成尚欠的真实SSH/rclone、文件/版本/原生能力和多活动并发证据，按真实结果更新正式文档。
**方式：** Native；如有产品修复，末尾一次新独立核心Reviewer，禁止astra及旧代理。
**Spec：** 本阶段设计R01–R07及requirements/architecture剩余验收编号。

## 全局约束

中文UTF-8/LF，ps1 BOM；不提交真实目标、密钥或配置。每次独立临时Git先init。优先既有成熟服务和库，不更换技术栈，不安装远端环境。测试仅随机专用根；原始日志ignored，正式证据匿名化。修复只验证实际关联范围，既有门槛不变；双平台CI后两级--no-ff。

## Review Focus

- 真实rclone反向结果/冲突和删确认，保存与恢复不会上传旧缓冲。
- 仅远端大文件/跨FS/取消与断线，不经本地中转、不重复执行，部分结果如实报告。
- 文件操作涉及同步路径或离线编辑器，任务和同步串行，保留双方内容。
- 对话、多PTY、资源和同步并发，各通道独立响应、失败/输出限制不误杀共享连接。
- 当前原生版本/真实会话/OS和独立客户端证据，不能把替身或存储检查说成界面通过。

## Task 1：文件/版本及真实Agent串联

Files：scripts/dev现有e2e与新增运行时参数化入口；docs/guides真实工作流验收、roadmap和remaining-scope-audit。
Interfaces：createSshPool/createRcloneDriver/createSyncManager、生产files/vcs/TurnChanges及HTTP/Edge；运行时target文件，不写连接值。
- [x] 创建独立临时Git与SSH随机根，实际rclone初始化后网页保存中文脚本，在服务器执行并拉回小JSON，校验磁盘及缓冲。
- [x] 保存版本/恢复单文件与本轮净diff，校验远端内容、HEAD/index及删确认；A5/A13。
- [x] 隔离Codex0.160.0协议复验及真实MCP remote_exec/remote_peek，首次id和历史续接；A7/V17。
- [x] 问题记录及两项关联修复；Review后新增11项最少回归，旧基线6项RED、修复后23项GREEN；正式证据同步，进入最终提交。

## Task 2：真实服务器文件管理

Files：生产remote-files与HTTP/网页按发现修改；脱敏验收记录。
- [x] 远端大文件同FS移动/复制、同名冲突、链接/不安全路径、明确取消，核对源/目标与本机未中转。
- [x] 在device不同的随机根之间移动/复制，记录部分状态和取消后的实际结果。
- [x] 同步目录/混合目录迁移与实际rclone串联，保留未保存缓冲/双端改动，不重新生成旧路径。
- [x] Firefox生产下载管理器入口将64MiB真实SSH流保存到独立磁盘，大小/SHA256一致，未入同步/Git；R09调整已记录。
- [ ] Edge系统保存选择器：实际Windows界面读取被策略检查中止，不绕过、不标通过。

## Task 3：并发与原生组合

- [x] 对话流、多PTY（含已有全屏工具）、资源两帧以上、实际同步和文件任务同时运行，核对响应、独立取消及串行边界；V16。
- [x] 保存密码重启/重新认证组合沿用真实DPAPI和生产池；本机随机密码网关透传实际远端rclone/SFTP/Python/PTY，不改服务器认证。
- [x] 真实原生长会话自动/手动压缩及续接，官方事件/历史是依据；A14–A16，隔离阈值14000。
- [x] 已实际初始化computer-use并尝试Windows界面读取，策略检查拒绝后中止并清理专用浏览器；A8/原生OS输入法仍保留未验，不夸大通过。

## Task 4：最终整合

- [x] 一次新核心Review无Critical/Important/需修Minor；Declined逐项裁定，最少核心回归RED→GREEN，不复审。
- [ ] 正式需求/架构/决策/路线图/验收一致，门禁按实际代码范围执行；PR与双平台CI后两级合并、核树推main及安全清理。
- [ ] 审计全部需求与遗留能力限制；只有所有要求满足才结束Goal。被政策拒绝的旧Temp残留保留，最终如实单独说明。
