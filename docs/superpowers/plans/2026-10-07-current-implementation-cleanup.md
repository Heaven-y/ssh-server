# 当前实现收敛实施计划

> 执行方式：按用户自主执行授权，由主执行者推进前端、文档与整合；两个独立后端范围分工实现，不交叉编辑。使用 subagent-driven-development 的任务记录方式，按仓库上层规则只安排一次集中审查。

**目标：** 删除已确认旧兼容/迁移/重复实现，统一现行入口，修复整理中发现的数据保护问题，保留历史决策。
**架构：** 保持既有模块和技术栈，以严格当前契约替代兼容分支；未知持久数据拒绝操作而非自动重建。
**技术栈：** Node.js 22、TypeScript、Fastify、React19、现有固定SDK/rclone。
**设计：** [当前实现收敛设计](../specs/2026-10-07-current-implementation-cleanup-design.md)

## 全局约束

不改用户配置和两端项目数据；不新增依赖、不改安全门槛；历史记录保留。UTF-8/LF，PowerShell脚本保留BOM。测试替身跟随现行生产契约，不能反过来要求产品保留旧路径。

## 任务

### 1. 存储、同步与SSH收敛（C02/C03）

- 文件：server的ssh/connection、sync/{rclone,state,manager,remote-changes}、remote-files/{tasks,task-record,errors}、workspaces/store及相应tests。
- 先增加坏配置/任务目录不可读/任务缺字段不放行、旧布局即使确认也不迁移等失败回归。
- 统一SshTarget对象；删除旧布局升级路径；当前状态读取失败保留原文拒绝写；任务必填派发及同步标志且初始化失败有明确阻断。
- rclone共用版本检查，验证并发缓存与失败重试。
- 执行对应测试及范围内lint，报告接口改动供主执行者更新范围外调用者。
- [x] 实现与范围验证完成；集中审查补充的无签名基线和任务null路径边界已修复复测。

### 2. Agent、聊天及HTTP入口收敛（C01/C02）

- 文件：shared/protocol与测试，server的agents/claude-*、chat/{sessions,turn-manager}、http/{workspaces.routes,workspace-setup.routes,sessions.routes,app}、resources/sample、main及相应tests。
- 先增加缺Agent/旧POST与DELETE/通用PATCH不可修改配置的失败回归。
- 删除旧CRUD旁路和PATCH；统一runners、必需Claude控制方法/会话管理/锁；采样只接收选项对象。
- 保留官方多类事件、审批、缺cwd读取与严格管理、超时/取消和无数据展示。
- 对应测试与lint通过；scripts和web调用方交主执行者处理。
- [x] 实现、类型契约与范围验证完成。

### 3. 前端与开发调用方收敛（C01/C04）

- 文件：web/lib/api、RemoteDownloadDialog及其tests；scripts/dev中受新SSH/Agent契约影响的调用者。
- 删除旧createWorkspace，API/查询键显式Agent；现行创建测试保留凭据不串入工作区请求的保护。
- 下载只保留选择器流式路径；组件回归覆盖无能力不发请求、选择取消、成功进度、写失败/中断清理。
- 核对当前网页下载入口与布局，无需读取OS选择器；执行前端相关测试与构建。
- [x] 实现与验证完成；脚本跟随正式入口，取消关闭时序已补组件与Edge复验。

### 4. 当前文档与历史整理（C05）

- 原docs/roadmap.md移至docs/roadmap-history.md；原remaining-scope-audit移至同目录remaining-scope-history.md，保留内容与相对链接。
- 写简明现行路线图与范围核对，修正README尾部旧状态；需求/架构/布局/开发指南同步删除旧兼容承诺和重复待办。
- decisions新增D36及历史优先级说明，阶段验收和既有设计保留供复盘。
- [x] 文档及链接/锚点、编码、历史正文完整性核对完成。

### 5. 集成验证与交付

- [x] 汇合后npm run check、web构建通过，旧入口及调用方核对完成。
- [x] 一次集中审查完成；三项具体问题先复现后修复，关联198项及静态/浏览器复验通过。
- Git交付沿既有授权执行：代码/测试与文档分组提交，两级--no-ff、正常推送、精确main双平台CI后清理小分支；结果由实际Git节点和交付报告记录，不预写未执行的提交哈希。

完整证据见[整理验收](../../guides/current-implementation-cleanup-acceptance.md)。

## 审查重点

坏状态不能变空数据；旧格式不能借初始化绕过；当前未完成任务仍可恢复且不重放；取消下载不能标完整；缺Agent不能误用另一运行时。每项已列入相应任务测试，不另外增加外部客户端验收。
