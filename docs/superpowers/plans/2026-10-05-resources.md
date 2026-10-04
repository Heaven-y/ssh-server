# SSH资源面板实施计划

> 执行者：使用executing-plans逐项Native实施。用户已授权不再确认；核心实现完成后一次新上下文Review，禁止astra，随后补最少核心回归。

**目标：** 网页独立查看结构化节点资源，复用SSH并共享有限采样。
**架构：** 请求驱动的有界singleflight缓存，宿主和目录分开；React Query仅可见面板5秒轮询。
**技术栈：** Node.js、TypeScript、Fastify、ssh2、React、React Query、csv-parse。
**设计：** docs/superpowers/specs/2026-10-05-resources-design.md。

## 全局约束

- 沿用现有后端，不安装服务器软件、不调用模型、不添加训练监控。
- 宿主5秒缓存、失败5/10/20/30秒退避、60秒空闲清理、64连接/128目录上限。
- 总时限8秒、每流128KiB、nvidia-smi3秒、节点进程50条/GPU进程100条。
- 缺失指标null；CPU首帧null；固定目标前后复验；隐藏和关闭暂停。
- 中文、UTF-8/LF、仅使用公开示例；代码/文档同阶段提交，两级--no-ff。

## Review Focus

1. 采样中换Host/凭据/目录或删除工作区：迟到结果不转向新目标，不缓存旧身份。
2. 不同工作区映射同解析连接但不同磁盘：宿主共享，目录结果不混用。
3. 无GPU工具、部分N/A、非Linux或缺失MemAvailable：不可用，不伪造零值。
4. SSH阻塞/输出超限/单请求断开：有界收尾，其他PTY与聊天继续。
5. 面板关闭、页面隐藏、StrictMode或快速切换：无叠加轮询，不改既有面板目标。

## 任务1：指标协议与只读采样

文件：新增shared/src/resources.ts、server/src/resources/{commands,parse,sample}.ts；修改shared/index.ts及server依赖/lockfile。
接口：ResourceSnapshot（workspaceId/sshHost/remoteDir/host/disk）；sampleHost(pool,target,signal)和sampleDisk(pool,target,remoteDir,signal)；parseHost(text,previousCpu)返回指标与累计CPU；所有字段缺失用null。

- [ ] 定义结构化指标与公开限制；CSV使用csv-parse/sync，不手写CSV库。
- [ ] 实现固定分节命令、独立通道8秒取消与输出上限，复用runExec/sq和目录展开。
- [ ] 实现/proc、GPU/进程及df解析，CPU连续差分和合理数值范围；运行shared/server类型与相关静态检查，预期exit0；提交该阶段。

## 任务2：共享缓存与安全HTTP

文件：新增server/src/resources/service.ts、http/resources.routes.ts；修改main.ts。
接口：createResourcesService({store,pool}).get(workspaceId):Promise<ResourceSnapshot>和dispose():void；GET /api/workspaces/:id/resources沿用Cookie/Host/Origin并no-store。

- [ ] 实现连接cacheKey共享与目录隔离、singleflight/退避/空闲淘汰；身份前后复验，取消不影响共享池。
- [ ] 路由结构化固定中文失败；主入口注册并在退出取消资源请求。类型、相关ESLint/格式与现有安全回归通过后提交。

## 任务3：资源入口与详情

文件：新增web/src/features/resources/{ResourcesPanel,ResourceMetrics}.tsx；修改lib/api.ts和App.tsx。
接口：api.readResources(id,signal)，ResourcesPanel({workspace})打开时绑定目标；详情关闭释放轮询。

- [ ] 展示主机/时间/目录、缺失与过期、手动刷新、GPU卡片和最多50条节点进程，复用DetailDialog。
- [ ] visibilitychange关闭轮询，目标变化不得改写已有详情，失败保留旧结果；web类型、相关静态检查及build预期exit0后提交。

## 任务4：Review、核心回归与本机验收

文件：server/tests/resources/{parse,service}.test.ts、http/resources.routes.test.ts；scripts/dev资源fixture；docs/guides/resources-acceptance.md及正式需求/架构/决策/路线图。

- [ ] 一次独立Review，逐条裁定Review Focus并修复核心问题，不重复派审。
- [ ] 最少核心回归：CPU首帧/差分/重启、CSV含逗号/N/A、缺失工具；同连接同时请求只采样一次、不同目录隔离、失败保留及退避、变更/删除丢迟到结果、dispose取消。
- [ ] 核心测试预期通过；真实ssh2夹具和Chrome检查960/1280/1920、隐藏暂停、过期与刷新、并发独立，记录实际范围。必要时扩大关联检查，已通过且未受影响的不重跑。
- [ ] 一次阶段门禁、同步正式文档、提交/推送/双平台CI与两级--no-ff整合；继续向导/设置/删除及M6，不标整项目完成。

自查：设计每节均有任务；共享协议/采样/service/网页接口逐级一致，五项Review Focus由任务4验证。测试顺序遵循用户要求，实施计划不再引入待确认门槛。
