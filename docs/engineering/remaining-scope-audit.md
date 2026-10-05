# 剩余范围核对

更新日期：2026-10-05。基于当前源码和阶段验收核对，终端本机基础已完成。本页补充[路线图](../roadmap.md)中的实施缺口；既有阶段的运行证据仍以各验收记录为准，各阶段按实际运行证据更新，不扩大已通过的验收范围。

## 1. 实施缺口

| 需求或目标 | 当前源码证据 | 仍需交付 |
|---|---|---|
| F1.1–F1.3 完整连接向导 | 五步表单、独立手动目标、两端只读草稿浏览及绑定快照/身份的验证票已接入；真实SSH/rclone首次初始化与网页通过，见[向导验收](../guides/workspace-setup-acceptance.md) | 核心创建范围完成；完整密码/终端/rclone多活动组合继续按A12/M6核对 |
| F1.5 工作区删除 | 侧栏入口、配置摘要确认、活动/持久阻断、所属通道与迟到网页收尾已实现；真实SSH/Edge三宽度通过，见[验收](../guides/workspace-removal-acceptance.md) | 核心范围完成；不删除项目/原生历史，不强停外部训练或独立客户端 |
| F1.8 未知主机指纹 | 无认证实际握手、一次挑战及显式确认追加已接入新建向导和已有SSH详情；变化/吊销/过期/陈旧/重放核心回归通过 | 核心范围完成，保持实际目标和信任记录边界 |
| F3.4 工作区规则追加 | 严格默认id目录、有界程序名/字符串自定义、串行摘要保存、侧栏独立草稿及实际执行接线已完成；一次Review的null保护RED→GREEN，见[规则验收](../guides/workspace-policy-acceptance.md) | 核心范围完成；完整模型对话与实际rclone串联继续按M6核对，规则不作用网页终端及在途已检查命令 |
| F4 / A10 网页终端 | 后端终端协议、绑定、目录确认、PTY 路由与背压已接入；网页多标签、分屏和可调主区已接入，核心回归及本机真实ssh2网页验收完成；[书面设计](../superpowers/specs/2026-10-04-web-terminal-design.md)已确认，[实施计划](../superpowers/plans/2026-10-04-web-terminal.md)已确认，实施中 | 真实服务器已有全屏工具、原生OS输入法和密码保存重启串联；[本机验收](../guides/web-terminal-acceptance.md)覆盖基础交互和通道回收 |
| F5.2 创建前同步预览 | 用户触发的两端计数/字节/排除例子、过滤和上限已实现；独立rclone lsjson不建立基线，真实只读预览通过 | 核心范围完成；超限/工具缺失继续返回未完成，不能伪造总量 |
| F9 / A18 资源面板 | [资源服务](../../apps/server/src/resources/service.ts)及HTTP已接入；[资源详情](../../apps/web/src/features/resources/ResourcesPanel.tsx)支持固定目标、空值/时间/过期和可见性；真实SSH、核心回归及网页证据见[验收](../guides/resources-acceptance.md) | 产品参数和顶栏单controller概览已贯通，真实SSH入口与共享详情复验见[导航验收](../guides/workspace-navigation-acceptance.md)；原生页面隐藏及完整多活动组合仍待验，不调用模型 |
| 界面第 7 节产品设置 | 独立本机偏好、产品/原生视图、手动版本检测、新会话默认与向导快照已贯通；一次Review三项修复和真实/网页证据见[设置验收](../guides/product-settings-acceptance.md) | 工作区黑名单已独立贯通；产品默认空值保持跟随原生，历史只保留显式覆盖 |
| 可调定时同步间隔 | [调度](../../apps/web/src/features/sync/scheduler.ts)默认15秒、可配置5–300秒；替换旧计时器不增加立即同步，保留隐藏/忙/待确认门禁 | 核心范围完成；完整对话/PTY/同步/资源并发继续按M6验收 |
| 界面第 1/3/4/5 节目标 | [布局/导航](../guides/workspace-navigation-acceptance.md)已完成侧栏折叠、可调分栏、亮色与cmdk；[时间线](../guides/conversation-timeline-acceptance.md)已接入动态虚拟列表及明确读取工具分组；文件/版本页提供已有diff | 本轮改动聚合和diff行内反馈；实际原生长负载仍按A14–A16验收，不以受控显示或单次界面改版作为全部完成 |

## 2. 验收缺口与证据边界

| 验收 | 已有证据及其范围 | 尚需核对 |
|---|---|---|
| A5、A7、A12、A13 及 A19 的完整串联 | [文件](../guides/workspace-files-acceptance.md)、[版本](../guides/local-versions-acceptance.md)、[Codex 对话](../guides/codex-conversation-acceptance.md)及[认证同步](../guides/m2-acceptance.md)保留各阶段真实/受控链路记录 | 新入口在允许的真实 SSH 目标上串联；密码、同步门禁、保存/恢复和模型运行时分别核对，不把受控同步替身当作实际 rclone |
| A8 原生会话删除 | [会话管理验收](../guides/session-management-acceptance.md)记录网页和原生 API/存储结果 | 在独立 VS Code 插件界面与 CLI 列表实际刷新确认，不用后端文件检查代替客户端显示 |
| A14–A16 与长会话体验 | [原生能力](../guides/native-capabilities-acceptance.md)及[补全验收](../guides/slash-completion-acceptance.md)记录协议、短程真实运行与网页证据 | 实际长会话的自动压缩、续接和显示负载；缺少原生比例时保持不可用，不自行估计为已确认用量 |
| A20–A23 远端文件管理 | [浏览](../guides/remote-files-browser-acceptance.md)、[操作](../guides/remote-file-operations-acceptance.md)、[同步协调](../guides/remote-file-sync-acceptance.md)明确本机和受控范围 | 真实大文件、同/跨文件系统移动与复制、实际 rclone 迁移、冲突/取消后的结果、浏览器磁盘保存及并发响应 |
| A10、A18 与架构 V16 | 终端已实现并完成本机验收，真实全屏工具及资源service已复验；资源网页和缓存核心验证完成，当前没有完整并发验收证据 | 对话、多个 PTY、资源采样、同步及文件任务同时工作；按通道核对输入、输出限制、独立取消/失败和串行边界，不仅检查静态页面 |

用户已授权自主完成，后续从本机既有SSH配置和工作区恢复真实目标，并在可确认范围内选择独立临时目录。临时Agent配置不包含SSH目标；真实连接信息不写入仓库。

## 3. 后续依赖与分支

终端沿用认证池和访问控制，设计/计划、一次独立Review及本机基础验收已完成。完整向导已把手动目标和草稿连接贯通到现有resolver，保留已存工作区兼容；资源采样在同一目标身份上共享，同时将磁盘指标绑定实际目录，不能仅按Host别名合并所有结果。

工作区删除、产品设置与命令规则已完成核心范围；布局与长会话改动按实际影响扩大视觉/负载验证。最后再串联真实 SSH 与多活动并发，更新原验收编号。各阶段从 `feat/ssh-workflow` 创建 `codex/` 小分支，代码和对应正式文档一起提交，验证后按两级 `--no-ff` 整合。
