# 工作区命令规则实施计划

> 使用executing-plans在本会话Native逐项实施。用户授权自主决策和整合，核心完成后一次独立Review再补少量回归，覆盖逐步TDD与重复确认；不调用astra，不续接历史代理。

目标：F3.4按工作区追加规则与默认规则管理贯通存储、网页和Agent执行。
架构：shared严格policy与目录；store串行写盘内摘要guard；独立policy HTTP；复用既有命令解析；按需dialog持有独立草稿。
技术：TypeScript、zod、Fastify、React19、TanStack Query、现有原生dialog。
设计：docs/superpowers/specs/2026-10-05-workspace-policy-design.md。

## 全局约束与Review Focus

中文UTF-8/LF；20条自定义，模式256字符/原因160字符，字面且区分大小写；只按工作区保存，不影响网页终端/在途执行；配置版本在串行写盘内复验；不泄露真实目标；两级--no-ff。

1. 同版本并发保存与同时修改sync/目标时，陈旧请求409且不覆盖其他字段。
2. 缺省/旧合法/坏policy和未知/重复/超界字段不静默降低规则保护。
3. 包装、shell-c/eval/替换、路径程序名及原始字符串命中保持可解释，先于同步与SSH。
4. 打开弹窗后切换工作区/卸载、迟到GET/PUT、外部修改与409不得覆盖另一草稿或缓存。
5. dirty重读/关闭、连续点击保存、键盘访问、错误定位和最大20条在三宽度可操作。

## 任务1：协议、串行存储与执行接线

文件：shared/{policy,workspace,index}.ts；server/policy/{default-rules,policy}.ts；workspaces/{store,policy}.ts；http/{workspace-policy.routes,workspaces.routes,internal.routes}.ts、main.ts。
接口：WorkspacePolicySchema、WorkspacePolicyInputSchema、WorkspacePolicyDocument={policy,revision}；store.update(id,patch,beforePersist?)；createWorkspacePolicy(store).read(id)/save(id,input)；registerWorkspacePolicyRoutes(app,service)。

- [x] 定义严格默认id目录、可选旧配置兼容和自定义schema；执行前验证并编译字面Rule。
- [x] 增加串行current摘要guard，只更新policy，独立GET/PUT和错误/no-store；通用PATCH阻止绕过。
- [x] 接入生产和remote-exec；相关类型/lint及既有policy/store/internal/workspaces回归通过，提交。

## 任务2：网页工作区规则管理

文件：web/features/workspaces/{WorkspaceSidebar,WorkspacePolicyDialog,WorkspacePolicyForm}.tsx、use-workspace-policy.ts、lib/api.ts。
消费任务1document/input/schema/catalog。独立dialog读取基线与草稿，保存后取消旧workspaces查询并刷新，不发布旧workspace对象。

- [x] 增加按工作区按需入口、默认checkbox/恢复、自定义新增/编辑/移除及字段错误。
- [x] 单次保存、dirty保护、失败/409保留、重读与卸载取消；成功刷新。
- [x] 相关类型/lint/build及既有生命周期/设置网页回归通过，提交。

## 任务3：一次Review、核心验收与整合

- [x] 一次新gpt-6.1-sol独立核心Review，逐项裁定，不重复派审。
- [x] 最少核心测试协议拒绝、实际存储持久化/并发/保留其他字段、内部拒绝零执行、网页保存/409/恢复；重要问题RED→GREEN。
- [x] Edge960/1280/1920及允许真实SSH无副作用命令；同步正式文档和W系列决策。
- [x] 工程门禁、PR双平台CI，两级--no-ff/main CI；继续剩余界面和完整M6。

自查：T1schema/catalog被T2直接消费；update guard在队列内而非GET后检查；T2成功只刷新全局列表；T3测试核心与Review发现，不逐改动重复全量。
