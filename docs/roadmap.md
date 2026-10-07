# 路线图

更新日期：2026-10-07。当前范围以[需求](product/requirements.md)为准，历史阶段过程保留在[历史路线图](roadmap-history.md)。文档分类见[导航](README.md)。

## 第一版功能状态

| 里程碑 | 已实现范围 | 证据入口 |
|---|---|---|
| M0 工程基础 | 模块划分、共享协议、测试及双平台质量门禁 | [开发指南](guides/dev-environment.md) |
| M1 远程对话 | Claude对话、审批/中断、MCP远程执行、命令规则 | [真实链路](guides/real-workflow-acceptance.md)、[规则](guides/policy-web-acceptance.md) |
| M2 认证与同步 | 私钥/密码与系统加密、小文件双向同步、删除确认/冲突、执行门禁 | [认证同步](guides/m2-acceptance.md)、[路径保护](guides/rclone-root-safety-acceptance.md) |
| M3 编辑与版本 | 本地轻量编辑、保存后同步、本地Git版本/差异/恢复 | [文件](guides/workspace-files-acceptance.md)、[版本](guides/local-versions-acceptance.md) |
| M4 原生Agent能力 | Codex、固定Agent会话、历史/管理、模型/技能/命令、原生上下文与压缩 | [会话](guides/session-management-acceptance.md)、[能力](guides/native-capabilities-acceptance.md)、[真实长会话](guides/real-workflow-acceptance.md) |
| M5 工作区与服务器工具 | 向导、服务器文件管理/同步协调/下载、多PTY、资源概览 | [向导](guides/workspace-setup-acceptance.md)、[文件任务](guides/remote-file-failure-acceptance.md)、[终端](guides/web-terminal-acceptance.md)、[资源](guides/resources-acceptance.md) |
| M6 交互与设置 | 产品/原生配置、生命周期、布局/主题、长时间线、本轮差异与行反馈 | [设置](guides/product-settings-acceptance.md)、[布局](guides/workspace-navigation-acceptance.md)、[改动](guides/conversation-changes-acceptance.md) |

以上核心功能已有实现与分范围证据，不将历史检查手段扩大为新的产品功能。A8以网页和官方接口确认原生删除为准，不以外部VSCode/CLI界面刷新为交付前提。

## 当前整理阶段

2026-10-07按用户要求统一现行方案：移除旧CRUD旁路、通用PATCH、隐式Agent协议、旧内部重载与测试兼容契约；取消旧存储格式迁移；保留坏文件并阻断操作；下载收敛为File System Access API一条路径；当前文档与历史分离。

实现、本机完整门禁、一次集中审查及发现问题的定向修复复测已完成，具体证据见[整理验收](guides/current-implementation-cleanup-acceptance.md)。取舍见[D36](engineering/decisions.md)，交付采用既定两级no-ff流程；精确整合提交与main双平台CI以Git/Actions和本次交付结果为准，不新增历史检查手段待办。

## 本机入口与服务器档案

2026-10-07按用户尚未使用、只维护一个版本的确认，完成纯端口同源入口、集中服务器档案和认证、无认证字段的工作区向导、默认浅色与主题记忆、共享启动环境检测和缺失指引。旧入口和旧字段直接删除，不提供迁移或兼容分支。

本机完整门禁各阶段、真实进程、Edge与SSH夹具验收及一次集中审查后的定向修复均已有证据，见[本轮验收](guides/local-entry-server-profiles-acceptance.md)；现行规则为[D37](engineering/decisions.md)。Git交付沿既定两级no-ff流程，精确main提交和双平台CI以最终交付记录为准。

## 界面与流程一致性

2026-10-07完成D38：分类设置与独立工作区同步规则、状态式验证/过期就地重验、密码档案连接引导、单行会话标题与有依据的模型信息、输入底栏、自主明暗资源仪表，以及统一目录/右键/快捷键/拖动文件交互。原生配置范围、960px最小宽度及所有确认保护保持。

一次集中审查的三项问题已修复：续验绑定真实连接与凭据代次，模型/推理Enter不误发，刷新列表和已打开详情不被旧模型缓存覆盖。最终本机完整门禁902项通过、5项平台跳过，生产构建和受控Edge/SSH复验通过；完整范围及限制见[本轮验收](guides/ui-workflow-consistency-acceptance.md)。交付按两级no-ff流程，精确提交与双平台CI以最终记录为准。

## 已知边界，不另设开发里程碑

- 仅维护当前正式契约及数据格式；旧/坏状态明确拒绝并保留原文件，不自动迁移、清空或重放远端任务。当前格式中断恢复继续提供。
- Windows rclone不支持含反斜杠的远端根，产品会提前拒绝；不自动换路径或升级工具。
- 下载需要支持File System Access API的当前桌面浏览器；不维护下载管理器备用分支。
- 历史记录未覆盖的OS输入法、系统选择器或外部客户端显示仍不标为通过；它们是验证边界，不自行扩为兼容项目。
- 不包含完整IDE、多用户、集群监控、服务器安装、独立安装器或自动检测训练完成/自动分析。

## 后续工作方式

实际使用发现问题时，围绕可复现的具体缺陷修复并验证；新增功能须有明确需求。不要重复已完成链路、重开历史计划或仅为维持“开发中”状态添加任务。[范围核对](engineering/remaining-scope-audit.md)记录本轮覆盖和保留项。
