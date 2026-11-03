# 文档导航

更新日期：2026-11-03。

| 文档 | 用途 |
|---|---|
| [项目入口](../README.md) | 功能、启动和安全边界 |
| [需求](product/requirements.md) | 产品功能、边界及验收条件 |
| [界面布局](product/ui-layout.md) | 三段式布局、面板和交互 |
| [架构](engineering/architecture.md) | 技术栈、接口、数据流和生命周期 |
| [设计决策](engineering/decisions.md) | 长期保留的取舍、原因、替代关系及[Git追溯入口](engineering/decisions.md#决策追溯与保留规则) |
| [开发环境](guides/dev-environment.md) | 运行、操作注意事项、代码规范和质量门禁 |
| [路线图](roadmap.md) | 里程碑状态与运行边界 |
| [设计文档](superpowers/specs/2026-11-03-native-cli-workbench-design.md) | 本轮产品转向的设计依据、关键决策与风险 |
| [M1 实施计划](superpowers/plans/2026-11-03-native-cli-workbench-m1.md) | 逐任务实施步骤 |
| [最新验收](guides/ui-usability-optimization-acceptance.md) | D42 阶段的质量门禁与浏览器检查结果，含 4 张代表图（**属上一代产品形态，仅作历史记录**） |

## 适用规则

- 产品形态是本机 Windows 桌面应用（Electron 壳），不是浏览器网页；三段式布局：左栏项目与会话、主区对话、右侧服务器面板。见[设计文档 §1.1](superpowers/specs/2026-11-03-native-cli-workbench-design.md#11-形态桌面应用不是浏览器网页)。
- 参数归属：产品可见阈值与验收条件写在[需求](product/requirements.md)，交互与呈现写在[界面布局](product/ui-layout.md)，实现预算、协议与模块约束写在[架构](engineering/architecture.md)，取舍理由与替代关系写在[设计决策](engineering/decisions.md)；同一数值只在一处定义，其余引用。
- 只维护一种正式业务路径和数据格式；历史阶段的测试数字、截图与验收范围只在[最新验收](guides/ui-usability-optimization-acceptance.md)中按实际运行记录，重复计划与旧图可以精简，决策记录长期保留。
- [D45](engineering/decisions.md#d45-产品转向原生-cli-会话工作台与桌面形态2026-11-03) 取代 D36–D44 中关于同步、版本、本地文件与网页形态的取舍；被删能力不再恢复，相关旧文档条款按历史记录看待。
