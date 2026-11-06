# 文档导航

更新于 2026-11-06。按产品、实现、开发和进度组织当前资料；旧方案与历史验收通过 Git 查询，避免与现行规则并列。

| 阅读顺序 | 文档 | 负责说明 |
|---|---|---|
| 1 | [项目入口](../README.md) | 产品定位、当前基础、启动入口 |
| 2 | [产品需求](product/requirements.md) | 功能范围、行为边界和验收条件 |
| 3 | [界面与交互](product/ui-layout.md) | 会话主区、导航、状态、原生配置与插件页面 |
| 4 | [架构](engineering/architecture.md) | 模块、协议、生命周期与实现预算 |
| 5 | [现行决策](engineering/decisions.md) | 仍有效的选择、理由、约束和替代关系 |
| 6 | [开发指南](guides/dev-environment.md) | 环境、代码规范、分支、技能和验证方法 |
| 7 | [路线图](roadmap.md) | 已交付基础、当前主线、后续顺序与证据边界 |

## 接入与使用

| 文档 | 用途 |
|---|---|
| [原生对话接入](engineering/native-dialogue.md) | 三 CLI 主流程的本轮边界与接口选择 |
| [原生配置与启动环境](engineering/native-configuration.md) | 各 CLI 配置入口、显式正文编辑和启动变量的边界 |
| [CLI 用量与执行轨迹](engineering/cli-observability.md) | 三 CLI 统计口径、执行轨迹接线与仍需验证的边界 |
| [模型身份与推理强度](engineering/model-capabilities.md) | 模型显示、Claude `[1m]`、上下文和精确推理档位 |
| [工作台插件接口](engineering/workbench-plugins.md) | 自有 v1 插件格式、宿主接口、SSH Console 与兼容边界 |
| [本地安装与打包](guides/local-installation.md) | 安装版、便携版、数据保存、构建和隔离验收 |

## 维护规则

- 功能做什么写进需求；界面怎么呈现写进交互；技术怎么运行写进架构；为什么这样取舍写进决策。具体数值只在负责该参数的文件定义，其他文件引用。
- 迭代始终优先保证对话主流程；扩展接口按真实交付版本记录，不提前承诺尚未实现的宿主能力。
- 每个 CLI 的原生配置和权限按实际支持接入。工作台插件与 CLI 原生扩展各自说明，不要求三种 CLI 使用相同层级。
- 已实现、待实现、受控验证、真实验证分别记录。删除过时材料不改变过去的通过、失败或未验证结论。
- 阶段计划只保留当前仍执行的版本；完成或被替代的计划归入 Git 记录，避免持续维护两份产品规范。

## 已退出的资料

2026-11-03 的原生 CLI 设计及 M1 实施计划、上一代停靠工作台验收和配套图片已从当前资料集移除。仍适用的理由和约束迁入现行文档，旧原文在 `c686ef2` 中可查；更早决策的锚点为 `ec33148`。

完整路径与读取命令见[历史追溯](engineering/decisions.md#历史追溯)。

三 CLI 对话核心接线计划已经完成，原始步骤与验证记录在 `6e33803:docs/superpowers/plans/2026-11-04-native-dialogue.md`。其仍有效的运行边界继续保留在原生对话接入说明中。

会话管理实施计划已归档，完成版本为 `68e4ce1:docs/superpowers/plans/2026-11-04-session-management.md`；实现和整合提交分别为 `bd503b1`、`a3e29ab`。管理入口及并发规则继续由需求、架构和接入说明维护。

整体交付计划的实现与验收已完成，步骤记录保存于 `33ffd9d:docs/superpowers/plans/2026-11-04-workbench-completion.md`。原生配置、工作台插件、本地包分别见上表的长期说明；阶段提交及未验证边界集中在路线图，不再保留并行维护的已完成计划。

DSH 界面对齐和整体验证计划归档至 `08ed6df:docs/superpowers/plans/2026-11-05-dsh-ui-alignment.md`。现行布局、生命周期与验收分别由交互、架构和路线图维护，Git 合并结果以分支历史为准。

执行轨迹实施前的能力评估保存在 `3c8d0ac:docs/engineering/cli-observability.md`。其中“尚未实施”的结论属于当时状态，现行接线与限制由上表的 CLI 用量与执行轨迹文档继续维护。

内部结构迁移已完成。迁移前独立审查保存在 `cdcef47:docs/engineering/structure-review.md`，执行完成的计划保存在 `d6028db:docs/superpowers/plans/2026-11-06-workbench-structure.md`。当前模块边界由架构文档维护，取舍和验收分别归现行决策与路线图；不继续并列维护完成计划和旧路径清单。
