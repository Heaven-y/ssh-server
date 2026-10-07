# 本机入口与服务器档案实施计划

> 执行：用户已明确要求直接全部实施，主执行者整合；两部分有固定接口的后端与网页工作并行，不交叉写文件。全程只安排一次集中审查。

**目标：** 直接打开本机端口，服务器集中认证，工作区选择目录，浅色默认与明确主题按钮，启动基础依赖提示。
**架构：** 唯一服务器档案和现有连接池；同源本机会话握手；复用主题和环境探测，不新增依赖。
**技术栈：** 现有Node22、TypeScript、Fastify、React19、Zod、ssh2和固定工具。
**设计：** [设计规范](../specs/2026-10-07-local-entry-server-profiles-design.md)

## 约束与接口分工

UTF-8/LF，ps1保持BOM。不处理真实配置/凭据，不迁移旧结构，不新增安装器或版本兼容矩阵。保留数据、身份、取消和并发保护。main.ts、scripts及docs由主执行者独占；后端分工与网页分工只读对方文件。

## 1. 后端服务器档案与认证（分工A）

文件：shared/{workspace,setup,terminal}及tests；server/{ssh,workspaces,sync,terminal,resources,remote-files}及相关HTTP路由和全部关联server测试。不得编辑server/main.ts、http/{app,auth,security,product-settings.routes}、settings/*、web、scripts、docs。
接口按设计：ManagedServer.authMode必填，Workspace与TerminalTarget无authMode，SshTarget仅alias。服务器CRUD及import-options返回固定结构；connect不传remoteDir/authMode，状态增加connected/hasPassword。主执行者接入main依赖。

- [x] 新增失败回归：工作区拒绝authMode、档案认证共用、目录选择不重新认证、陈旧/被引用/活动修改或删除拒绝、目标变化不复用密码。
- [x] 实现集中解析与存储/路由，更新所有授权范围内调用者及替身。
- [x] 执行shared/server类型和关联测试、lint，报告main所需精确装配与边界调用变化。

## 2. 网页服务器入口、工作区、主题和引导（分工B）

文件：apps/web全部src/tests，允许调整index.html主题启动；不编辑shared/server/scripts/docs。消费A契约与`POST /api/local-session {}`、`GET/POST /api/settings/environment`（EnvironmentReport不变）。

- [x] 先回归：启动握手成功前不请求工作区/启动WS；服务器统一保存/选择/认证；工作区不出现密码或认证字段；浅色默认/切换记忆；环境缺失有指引。
- [x] 服务器集中dialog，入口在顶栏并可由向导打开。复用已有服务器表单、SshPasswordField、HostKeyConfirmation和连接hook，不复制认证实现。
- [x] 简化向导为本地目录、服务器/远端目录、同步与确认的可理解流程；服务器管理关闭返回草稿，仍用验证票创建。已有工作区SSH入口转统一管理。
- [x] bootstrap握手可重试，API/WS只在成功后启动；主题在首屏正确应用，显式深浅文字按钮；启动环境共享查询和手动重试，指引仅显示。
- [x] 类型、组件/纯函数测试、lint与构建，报告实际网页验证所需入口。

## 3. 本机会话、环境后端与整合（主执行者）

文件：server/http/{auth,security,app,product-settings.routes}、config/main、settings/environment及tests；scripts/dev；docs。

- [x] RED：无token同源POST成功获Cookie；匿名API/跨站/未知Host/无Origin被拒绝；旧auth入口不存在；iframe防护。
- [x] 实现握手和安全头，打印干净入口，开发脚本与fixture改用握手。
- [x] RED：未知版本但执行成功可用，超时/截断不可用，启动GET复用探测结果、POST刷新。实现一次环境service和CLI摘要；不自动安装。
- [x] 装配A的服务器档案与活动保护，更新scripts所有新契约调用。
- [x] 执行check各阶段与web build；临时配置/合成SSH中验证纯端口、服务器管理、两个工作区复用认证与两种主题。真实网页截图和证据不冒充真实服务器或模型验收。
- [x] 一次集中审查，修复普通复用误触发重认证和删除遗留凭据两项问题并复验；更新D37、当前文档、历史替代声明和验收。
- Git交付流程：分组提交，两级no-ff并推送，main精确SHA双平台CI成功后清理小分支；实际状态以仓库历史、Actions和最终交付记录为准。

## 审查重点

- 无登录首页不能让第三方网页获取授权或跨站写操作；同源启动顺序避免401竞态。
- 服务器修改不使已有固定目标静默换向，活动事务与陈旧快照同时阻断。
- 已保存密码在新后端和另一工作区复用，认证失败/取消仍失效且不泄密。
- 浅色首次加载不闪回默认深色，切换不销毁编辑器/PTY实例。
- 缺少一个或全部Agent不会阻止服务器管理；检测只证明可执行，不假报模型已登录。

## 实施证据

已汇合后端与网页分工，清理旧`/api/ssh-hosts`接线及远端浏览类型残留；本机完整检查基准845项通过、5项Linux专用跳过，审查修复后20文件160项定向通过。真实后端8项入口检查、Edge双工作区认证复用、密码清理及同一PTY主题切换均通过。详细范围与边界见[本轮验收](../../guides/local-entry-server-profiles-acceptance.md)。
