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
| [路线图](roadmap.md) | 当前交付状态与运行边界 |
| [最新验收](guides/ui-usability-optimization-acceptance.md) | D42质量门禁、浏览器交互与人工视觉检查结果，含4张代表图 |

## 适用规则

- 资源与文件按[D42](engineering/decisions.md#d42-停靠工作台会话操作与设置收敛2026-10-09)自适应停靠：宽屏四列、较窄右侧上下、更窄默认收起左栏；保留独立活动与已打开文件/PTY生命周期，本地文件只读（[D44](engineering/decisions.md#d44-本地文件只读设置入口与服务器点击即编辑2026-10-15)）。
- 参数归属：产品可见阈值与验收条件写在[需求](product/requirements.md)，交互与呈现写在[界面布局](product/ui-layout.md)，实现预算、协议与模块约束写在[架构](engineering/architecture.md)，取舍理由与替代关系写在[设计决策](engineering/decisions.md)；同一数值只在一处定义，其余引用。
- 只维护一种正式业务路径和数据格式；历史阶段的测试数字、截图与验收范围只在[最新验收](guides/ui-usability-optimization-acceptance.md)中按实际运行记录，重复计划与旧图可以精简，决策记录长期保留。
