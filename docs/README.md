# 文档导航与适用范围

更新日期：2026-10-07。

## 当前规范

| 文档 | 用途 |
|---|---|
| [需求](product/requirements.md) | 第一版功能、边界及验收条件 |
| [界面布局](product/ui-layout.md) | 当前网页布局和交互 |
| [架构](engineering/architecture.md) | 当前技术栈、接口和数据流 |
| [设计决策](engineering/decisions.md) | 取舍依据；最新决策标明被替代的旧约定 |
| [开发环境](guides/dev-environment.md) | 运行、代码规范和质量门禁 |
| [路线图](roadmap.md) | 当前功能完成状态，不重复历史任务流水 |
| [范围核对](engineering/remaining-scope-audit.md) | 全仓整理的覆盖、结论与边界 |
| [本机入口与服务器档案验收](guides/local-entry-server-profiles-acceptance.md) | 当前D37入口、认证、主题及启动环境证据 |

冲突时，以用户最新确认及上述当前规范为准。现行实现只维护一种业务路径；不为已移除的客户端契约、存储布局或浏览器分支保留迁移兼容。当前格式的重启恢复、错误处理、取消及数据保护不是迁移兼容。

## 历史与复盘

- [历史路线图](roadmap-history.md)、[历史范围核对](engineering/remaining-scope-history.md)保存原阶段进度及证据。
- `superpowers/specs/`、`superpowers/plans/`保留当时设计、执行计划和裁定；现行入口与认证按[D37设计](superpowers/specs/2026-10-07-local-entry-server-profiles-design.md)，维护范围继续遵循[D36收敛设计](superpowers/specs/2026-10-07-current-implementation-cleanup-design.md)。旧令牌入口、工作区认证字段和默认深色仅属于历史。
- `guides/*-acceptance.md`为对应日期的验收记录。测试数字、真实/受控范围及失败事实不回写成后来的结果；旧流程通过不意味着产品仍保留旧流程。
- `engineering/decisions.md`及终端、资源等专题决策保留选型与被放弃方案，用于解释“为什么这样做”，不是要求维护多个实现。
- `assets/`保留历史实际截图，不能仅凭旧截图判断当前代码或兼容范围。

VS Code、原生CLI交互列表、浏览器系统选择器和OS输入法是可采用的检查环境或手段。未观察事实可以记录，但不能自行扩大成功条件、反复创建兼容任务，或宣称没有做过的检查已通过。产品有明确功能问题时，才按实际影响修复和验证。
