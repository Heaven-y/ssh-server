# 文档导航

更新日期：2026-10-09。

| 文档 | 用途 |
|---|---|
| [项目入口](../README.md) | 功能、启动和安全边界 |
| [需求](product/requirements.md) | 第一版功能、边界及验收条件 |
| [界面布局](product/ui-layout.md) | 当前停靠工作台、面板和交互 |
| [架构](engineering/architecture.md) | 技术栈、接口、数据流和生命周期 |
| [设计决策](engineering/decisions.md) | 长期保留的取舍、原因、替代关系及[Git追溯入口](engineering/decisions.md#决策追溯与保留规则) |
| [开发环境](guides/dev-environment.md) | 运行、操作注意事项、代码规范和质量门禁 |
| [路线图](roadmap.md) | 当前交付状态，不重复历史任务流水 |
| [最新验收](guides/ui-usability-optimization-acceptance.md) | D42质量门禁、浏览器交互、人工视觉检查状态与4张代表图；历史阶段单独标注 |

## 适用规则

- 资源与文件按[D42](engineering/decisions.md#d42-停靠工作台会话操作与设置收敛2026-10-09)自适应停靠：宽屏四列、较窄右侧上下、更窄默认收起左栏；保留独立活动与编辑/PTY生命周期。
- 只维护一种正式业务路径和数据格式，不恢复旧API或备用分支。历史阶段的测试数字、截图与验收范围只在[最新验收](guides/ui-usability-optimization-acceptance.md)中按实际运行记录。
- 重复设计/计划、验收流水和旧图可以精简；决策记录长期保留，独有取舍先并入现行说明。
- VS Code、CLI、系统选择器和OS输入法是可选检查手段；实际问题按影响范围修复验证。
