# 完整工作区连接向导实施计划

> Native执行；用户已授权自主实施和整合，决策记入设计和台账。核心完成后一次新上下文Review，再补最少核心回归；禁止astra。

目标：实现导入/手动服务器、创建前目录浏览与预览、主机指纹和绑定目标的验证创建。设计：[工作区向导](../specs/2026-10-05-workspace-setup-design.md)。分支：从最新feat/ssh-workflow创建codex/ssh-workflow-setup，两级--no-ff。

## 全局约束与接口

- 中文、UTF-8/LF；真实连接仅本机servers.json或ignored验收参数，密码使用现有Hook/加密存储。
- 工作区、rclone、SFTP、PTY和资源继续使用sshHost并统一resolver；不能写用户SSH config或先保存临时工作区。
- 目标表128项；指纹挑战2分钟/32项；草稿浏览15分钟/32组；验证票5分钟/64项；目录每页200、预览例子20、遍历20000项/30秒。
- 阶段仅跑类型、相关lint/格式/build；Review后核心回归；阶段一次覆盖率门禁，不降低门槛。

## Review Focus

1. 手动目标在认证、保存密码、rclone、固定SFTP/PTY和资源中解析为同一个实际目标，配置变化不能沿用旧身份。
2. 指纹令牌过期、重复、换目标、换公钥、known_hosts外部修改及吊销；追加不能替换信任或发送认证凭据。
3. 验证过程中修改/删除目录、凭据代次改变与重复创建，生产POST不能跳过认证验证。
4. 预览只读元数据、无bisync/正文读取/旧基线写入，超限/断开/取消有界，服务器工具缺失不伪造总量。
5. 快速返回/关闭/改Host/StrictMode，迟到响应不写新步骤，DOM密码与草稿SFTP收尾；首次同步失败不丢配置或误报成功。

## 任务1：本机手动目标与统一resolver

文件：shared/src/setup.ts；server/src/ssh/targets.ts、connection.ts、main.ts；http/ssh-targets.routes.ts；shared/workspace.ts与index.ts。
产生接口：ManualServerInputSchema；ManagedServer={alias,name,hostname,port,username,keyFile?}；createServerTargets({configDir}).list()/get(alias)/save(input)。ConnectionDeps.lookupHost?(alias):Promise<SshHostConfig|undefined>；SshHostInfo可选source/name。GET/POST /api/ssh-targets，列表合并已有Host。

- [x] 定义严格协议、目标表串行原子保存及字段校验；内部别名managed-ssh-UUID，完全相同连接复用。
- [x] resolver的loadHost接入lookupHost，keyFile规范化后沿用loadKey；main统一目标列表及workspaceStore/pool依赖。
- [x] shared/server类型、相关ESLint/Prettier预期exit0；提交本阶段和设计。

## 任务2：实际主机指纹与显式信任

文件：ssh/host-trust.ts、known-hosts.ts；http/ssh-host-trust.routes.ts；web/features/ssh/HostKeyConfirmation.tsx及api.ts。
接口：HostTrustStatus={status:'trusted'|'unknown',alias,algorithm,fingerprint,challenge?}；createHostTrust({pool,homeDir?,readFile?,append?,probe?}).probe(alias,signal)/confirm({challenge,fingerprint,confirmed:true},signal)/dispose()。probeSshHostKey(identity,knownHosts,signal)返回SSH线格式Buffer。

- [x] 实现无认证8秒握手、已登记算法、SHA256指纹、unknown挑战与有界存储；变化/吊销保持拒绝。
- [x] 确认前重新读取身份/信任并握手，拒绝旧挑战；只追加具体公钥，不重写known_hosts；HTTP沿用Cookie/Host/Origin。
- [x] 指纹组件复用至新建及已有SSH详情，明确勾选；类型/相关静态检查预期exit0，提交。

## 任务3：草稿目录、预览与创建服务

文件：workspaces/setup/{local,remote,preview,verification,service}.ts；http/workspace-setup.routes.ts、workspaces.routes.ts/app.ts；sync/inventory.ts；main.ts。
接口：createWorkspaceSetup({store,pool,sync,configDir}).localDirectory({path?,cursor?},signal)/openRemote(target,signal)/readRemote(sessionId,{path?,cursor?},signal)/closeRemote(sessionId)/remoteSize(target,path,signal)/preview(input,signal)/verify(input,signal)/create({input,verification,initializationConfirmed:true},signal)/dispose()。
verify返回{verification,expiresAt,local:{empty,git},target}；create返回{workspace,sync}。旧生产POST工作区创建回调也强制验证；测试/夹具可显式提供仅存储依赖，不冒充完整生产。

- [x] 本地元数据浏览与普通根校验；远端内存草稿接入现有RemoteFilesService，只开放浏览/关闭；按需du20秒上限、独立通道。
- [x] localInventory可选signal/maxEntries；预览使用独立临时rclone状态和既有过滤，只读取清单，30秒取消、20000项限制和20例子，不运行bisync。
- [x] 验证票固定规范化创建快照、cacheKey/代次/根身份，创建时重验且一次消费；保存后初始化，失败结果与配置分别返回。
- [x] 注册严格HTTP、请求关闭/服务退出取消；类型、相关静态检查预期exit0，提交。

## 任务4：五步网页向导

文件：web/features/workspaces/WorkspaceForm.tsx及setup/{LocalStep,ServerStep,RemoteStep,SyncStep,ConfirmStep,DirectoryPicker,use-workspace-setup}.tsx/ts；api.ts与既有SSH反馈/同步表单。
消费：任务1–3的协议与API。onCreated(workspace)保留现有列表接线；显示初始化结果后完成选择，不改变历史会话。

- [ ] 名称与本地逐级目录、导入/保存手动目标、认证和指纹、远端分页/手动路径/按需大小、同步规则/预览。
- [ ] 汇总双方非空与合并保留冲突说明；最后验证票成功才允许勾选创建/初始化，字段变化撤销，创建不可重复。
- [ ] 取消中断请求/关闭草稿/清DOM密码；迟到结果不改新目标或切换已关闭页面；web类型、相关lint/format及build预期exit0，提交。

## 任务5：一次Review、核心回归与整合

文件：server/tests/ssh/targets/host-trust、workspaces/setup及HTTP关联测试；scripts/dev/setup-fixture.ts；guides/workspace-setup-acceptance.md及正式需求/架构/决策/路线图。

- [ ] 一次独立Review，五项Focus逐条裁定；核心问题先用回归复现再修复，不重复派审。
- [ ] 最少核心：手动目标重启/别名统一/字段与密码不落盘；实际握手unknown/匹配/变更/吊销、过期/陈旧/重放确认；草稿关闭和只读分页；预览过滤/取消/上限不改基线；创建旧票/代次/目录变化拒绝、一次创建与初始化失败保留配置。
- [ ] 真实ssh2 fixture及Edge三种宽度核对步骤、键盘、修改/关闭/失败与迟到；已有真实目标使用独立临时目录完成浏览/预览/创建和清理，不输出真实参数。
- [ ] 同步正式文档与决策，阶段门禁、PR双平台CI及两级--no-ff整合，继续产品设置/删除/界面/M6。

自查：任务接口逐级一致；任务1统一身份，任务2信任，任务3只读草稿与绑定创建，任务4全部用户步骤，任务5覆盖五项关键失败边界；用户授权覆盖技能中的重复阶段确认。
