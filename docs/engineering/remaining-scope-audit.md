# 剩余范围核对

更新日期：2026-10-05。本轮完整链路已补齐实际SSH/rclone、双Agent编辑、版本恢复、文件管理、并发、长负载压缩和保存密码后端重建组合，见[完整链路验收](../guides/real-workflow-acceptance.md)。本页保留[路线图](../roadmap.md)中的剩余缺口；真实、受控与未验范围分别记录，不扩大证据。

## 1. 实施缺口

| 需求或目标 | 当前源码证据 | 仍需交付 |
|---|---|---|
| F1.1–F1.3 完整连接向导 | 五步表单、手动目标、只读浏览及验证票已接入；真实SSH/rclone首次初始化与网页通过，见[向导验收](../guides/workspace-setup-acceptance.md) | 核心创建完成；A12密码DPAPI/后端重建/实际rclone/SFTP/Python/PTY组合已补齐，不声称用户服务器开启密码认证 |
| F1.5 工作区删除 | 侧栏入口、配置摘要确认、活动/持久阻断、所属通道与迟到网页收尾已实现；真实SSH/Edge三宽度通过，见[验收](../guides/workspace-removal-acceptance.md) | 核心范围完成；不删除项目/原生历史，不强停外部训练或独立客户端 |
| F1.8 未知主机指纹 | 无认证实际握手、一次挑战及显式确认追加已接入新建向导和已有SSH详情；变化/吊销/过期/陈旧/重放核心回归通过 | 核心范围完成，保持实际目标和信任记录边界 |
| F3.4 工作区规则追加 | 严格默认id目录、有界程序名/字符串自定义、串行摘要保存、侧栏独立草稿及实际执行接线已完成；一次Review的null保护RED→GREEN，见[规则验收](../guides/workspace-policy-acceptance.md) | 核心范围完成；实际模型/SSH/rclone链路已补齐，规则不作用网页终端及在途已检查命令 |
| F4 / A10 网页终端 | 固定目标、独立PTY、背压、多标签/分屏与可调布局完成；本机网页及真实htop/nvitop绘制、重绘/退出、独立关闭和并发通过 | 原生OS输入法仍待验；Windows界面读取被策略拒绝，保留合成IME原范围 |
| F5.2 创建前同步预览 | 用户触发的两端计数/字节/排除例子、过滤和上限已实现；独立rclone lsjson不建立基线，真实只读预览通过 | 核心范围完成；超限/工具缺失继续返回未完成，不能伪造总量 |
| F9 / A18 资源面板 | [资源服务](../../apps/server/src/resources/service.ts)及[资源详情](../../apps/web/src/features/resources/ResourcesPanel.tsx)支持固定目标、空值/过期和可见性；真实SSH及网页证据见[验收](../guides/resources-acceptance.md) | 完整Agent/双PTY/资源两帧/实际同步/远端任务组合已通过；网页隐藏/缓存核心回归保留原范围，不调用模型 |
| 界面第 7 节产品设置 | 独立本机偏好、产品/原生视图、手动版本检测、新会话默认与向导快照已贯通；一次Review三项修复和真实/网页证据见[设置验收](../guides/product-settings-acceptance.md) | 工作区黑名单已独立贯通；产品默认空值保持跟随原生，历史只保留显式覆盖 |
| 可调定时同步间隔 | [调度](../../apps/web/src/features/sync/scheduler.ts)默认15秒、可配置5–300秒，保留隐藏/忙/待确认门禁 | 核心范围与实际多活动并发通过；同工作区同步串行 |
| 界面第 1/3/4/5 节目标 | [布局/导航](../guides/workspace-navigation-acceptance.md)、[时间线](../guides/conversation-timeline-acceptance.md)和[净差异/行反馈/放弃](../guides/conversation-changes-acceptance.md)已接入 | 实际原生长负载自动/手动压缩及记忆续接已补齐；仍不把合成IME当作OS输入法通过 |

## 2. 验收缺口与证据边界

| 验收 | 已有证据及其范围 | 尚需核对 |
|---|---|---|
| A5、A7、A12、A13 及 A19 的完整串联 | Edge保存/版本恢复/删除确认、双Agent原生编辑/实际rclone/SSH/Python、小结果及密码后端重建组合已补齐；A19沿用真实同步门禁和核心回归 | 不把受控密码网关扩大为用户服务器认证设置；真实参数只在ignored配置 |
| A8 原生会话删除 | [会话管理验收](../guides/session-management-acceptance.md)记录网页和原生 API/存储结果 | 在独立 VS Code 插件界面与 CLI 列表实际刷新确认，不用后端文件检查代替客户端显示 |
| A14–A16 与长会话体验 | 原生能力/补全网页与时间线负载基准保持；真实MCP长文本触发auto完成、原ID记忆续接和官方manual完成 | 采用隔离阈值14000而非修改产品默认；缺失比例仍不可用 |
| A20–A23 远端文件管理 | 真实同/跨FS大文件、实际rclone混合迁移、冲突/链接/复制取消、Firefox独立磁盘下载及并发响应通过；真实权限、源/目标变化和独立连接中断后的持久重开/核对/不重放已补齐 | Edge系统保存选择器仍未验；[失败验收](../guides/remote-file-failure-acceptance.md)未扩大为共享池或全网络故障证据 |
| A10、A18 与架构 V16 | 实际15秒Agent SSH期间双全屏PTY、资源两帧、远端任务响应；单PTY关闭、同步排队及重复轮次拒绝通过 | 原生OS输入法待验；超时/输出限制保留相关核心回归 |
| Windows长配置路径 | combine短逻辑根、长配置根六项真实SSH、特殊字符及旧基线/任务升级通过，见[验收](../guides/sync-session-names-acceptance.md) | 状态单文件名已修复；Windows rclone对反斜杠根的转换保留工具边界，旧清单不删除 |

用户已授权自主完成及记录决策。Windows原生界面读取被自动策略检查拒绝后停止相应界面验收，不绕过；已完成的独立核心工作继续整合。真实连接不写公开仓库，临时原生副本仅ignored；被策略拒绝的本机目录清理保留并在最终交付单独说明。

## 3. 后续依赖与分支

终端沿用认证池和访问控制，设计/计划、一次独立Review及本机基础验收已完成。完整向导已把手动目标和草稿连接贯通到现有resolver，保留已存工作区兼容；资源采样在同一目标身份上共享，同时将磁盘指标绑定实际目录，不能仅按Host别名合并所有结果。

工作区删除、产品设置与命令规则已完成核心范围；布局与长会话改动已按实际影响完成视觉/负载验证，真实SSH与多活动并发已串联。原生界面策略拒绝、Windows rclone反斜杠根及未扩充的共享池/全网络故障证据继续保留；长状态文件名已有独立修复与真实升级证据，独立连接故障已补齐。各阶段从 `feat/ssh-workflow` 创建 `codex/` 小分支，代码和对应正式文档一起提交，验证后按两级 `--no-ff` 整合；纯验收阶段不为满足形式修改产品。

## 4. 第一版需求总对照

本表对照F1–F10及A1–A23，区分实现与证据范围；详细失败条件继续查各验收记录，不能由一个成功场景推导所有外部环境均可用。

| 需求 / 验收 | 交付及证据 | 剩余范围 |
|---|---|---|
| F1 / A12 | [连接向导](../guides/workspace-setup-acceptance.md)、[生命周期](../guides/workspace-removal-acceptance.md)、[实际密码组合](../guides/real-workflow-acceptance.md) | 本机密码网关透传真实通道，用户服务器认证设置未变 |
| F2 / A6、A7、A14–A16 | [原生配置](../guides/agent-config-acceptance.md)、[能力](../guides/native-capabilities-acceptance.md)、[补全](../guides/slash-completion-acceptance.md)、[真实长会话](../guides/real-workflow-acceptance.md) | 按官方运行时能力和版本显示限制，不估造缺失统计 |
| F3 / A1、A2、A11、A17、A19 | 实际双Agent编辑、SSH/Python执行、小JSON返回及同步串行；[黑名单](../guides/workspace-policy-acceptance.md)和[同步门禁](../guides/m2-acceptance.md) | 阻断/故障边界保留核心回归；没有自动训练完成检测或自动分析 |
| F4 / A10 | [网页终端](../guides/web-terminal-acceptance.md)、真实全屏PTY和独立关闭/并发组合 | 原生OS输入法未验 |
| F5 / A3、A4、A9 | [实际过滤、删除和冲突](../guides/m2-acceptance.md)、[真实删确认和测试根收尾](../guides/real-workflow-acceptance.md) | 长状态名及旧基线/任务升级已验；Windows rclone反斜杠根仍受工具约束，被拒绝清理的是本机ignored副本 |
| F6 / A5 | [本地Git版本](../guides/local-versions-acceptance.md)与实际Edge/SSH/rclone单文件恢复 | HEAD/index和未保存缓冲边界保留 |
| F7 / A8 | [原生会话管理](../guides/session-management-acceptance.md)，网页及官方API/存储已验 | 独立VS Code插件和CLI交互列表刷新未验 |
| F8 / A13 | [文件编辑](../guides/workspace-files-acceptance.md)与实际Edge保存/同步 | 真实文件系统最后检查与写入间隙不承诺跨进程事务 |
| F9 / A18 | [资源采样](../guides/resources-acceptance.md)及实际Agent/双PTY/资源/任务组合 | 缺工具和故障显示不可用；隐藏状态沿用受控网页证据 |
| F10 / A20–A23 | [浏览](../guides/remote-files-browser-acceptance.md)、[任务](../guides/remote-file-operations-acceptance.md)、[同步协调](../guides/remote-file-sync-acceptance.md)、实际同/跨FS/混合迁移/Firefox下载及[真实失败](../guides/remote-file-failure-acceptance.md) | Edge系统选择器未验；独立SSH断线证据不扩大为共享池/全网络或完整网页故障 |
| UI布局与设置 | [界面](../guides/workspace-ui-acceptance.md)、[导航](../guides/workspace-navigation-acceptance.md)、[设置](../guides/product-settings-acceptance.md)、[时间线](../guides/conversation-timeline-acceptance.md)、[本轮改动](../guides/conversation-changes-acceptance.md) | 保留原生IME未验和既有构建chunk体积提示 |

第一版排除项继续按需求第5节执行：不新增完整IDE、多Agent编排、集群监控、服务器软件安装、多用户、打包迁移或自动续跑。核心实现与可执行验收已交付，原生界面缺口和工具限制未消除前，整个Goal保持进行中。
