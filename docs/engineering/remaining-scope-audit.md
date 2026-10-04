# 剩余范围核对

日期：2026-10-04。基于 `d60ffd6` 的产品源码和正式文档只读核对。本页补充[路线图](../roadmap.md)中的实施缺口；既有阶段的运行证据仍以各验收记录为准，本次没有重新运行产品测试，也不据此扩大已通过的验收范围。

## 1. 实施缺口

| 需求或目标 | 当前源码证据 | 仍需交付 |
|---|---|---|
| F1.1 手动填写服务器目标 | [工作区表单](../../apps/web/src/features/workspaces/WorkspaceForm.tsx)仅选择已有 Host；[工作区 schema](../../packages/shared/src/workspace.ts)和[连接解析器](../../apps/server/src/ssh/connection.ts)按别名解析 SSH config | 地址、端口、账号和私钥/密码选择；同一目标贯通测试、浏览、执行、同步及终端，不写真实连接信息到仓库 |
| F1.2 本地/远端目录选择 | 表单只有路径输入；[服务器浏览路由](../../apps/server/src/http/remote-files.routes.ts)绑定已经存在的工作区 | 创建前的本地目录浏览和独立远端草稿目标浏览；用户点击后才计算目录占用。不能先落盘工作区来绕过创建前选择与校验 |
| F1.3 创建前验证 | 表单对密码方式要求最近一次验证；私钥方式仍可不测试而提交，[工作区存储](../../apps/server/src/workspaces/store.ts)创建时检查本地目录和 Host 别名 | 两种认证都核对目标和远端目录，并将验证结果绑定到提交时的目标；取消、目标变化和迟到结果不绕过验证 |
| F1.5 工作区删除 | [工作区路由](../../apps/server/src/http/workspaces.routes.ts)已提供删除配置接口，存储不删除项目文件；[侧栏](../../apps/web/src/features/workspaces/WorkspaceSidebar.tsx)只有选择和新建 | 网页删除入口、影响说明及活动会话/编辑/任务/终端的生命周期协调；保持本地及服务器项目文件不删除 |
| F1.8 未知主机指纹 | [SSH 客户端](../../apps/server/src/ssh/client.ts)拒绝未知、变化和吊销密钥，提示用户在本机终端核对 | 网页展示实际指纹并显式确认未知主机；确认绑定目标及本次握手，变化和吊销仍拒绝，避免接受后的目标或密钥竞态 |
| F3.4 工作区规则追加 | schema 仅有 `disabledRules`；[黑名单](../../apps/server/src/policy/policy.ts)过滤默认规则，[执行路由](../../apps/server/src/http/internal.routes.ts)只传停用项 | 追加自定义规则的配置、验证与执行接线；默认规则的网页管理入口也未提供，不把已有默认黑名单标为完整设置功能 |
| F4 / A10 网页终端 | 后端终端协议、绑定、目录确认、PTY 路由与背压已接入；网页模块及验收尚未完成；[书面设计](../superpowers/specs/2026-10-04-web-terminal-design.md)已确认，[实施计划](../superpowers/plans/2026-10-04-web-terminal.md)已确认，实施中 | PTY、默认目录确认、固定目标、独立 WebSocket、复制粘贴、多标签/分屏、尺寸变化与通道回收；实际检查交互和全屏程序 |
| F5.2 创建前同步预览 | [同步路由](../../apps/server/src/http/sync.routes.ts)已有状态、同步、初始化及规则保存，没有创建前预览入口 | 用户触发的文件数/总大小与排除项统计；预览不传输正文、不自动遍历大项目，首次同步的两端处理方式明确确认 |
| F9 / A18 资源面板 | [后端注册](../../apps/server/src/main.ts)未接采样服务或资源路由，前端没有资源面板 | SSH 只读采样、结构化指标、实际主机/时间/可用性、同目标共享、可见性暂停/降频、失败退避；不检测训练完成或调用模型 |
| 界面第 7 节产品设置 | [设置弹窗](../../apps/web/src/features/settings/SettingsDialog.tsx)只编辑原生 Agent 配置；[同步规则表单](../../apps/web/src/features/sync/SyncSettingsForm.tsx)只改当前工作区过滤规则 | 新会话 Agent/模型默认值、产品同步默认值与刷新参数、工作区规则管理及环境检测入口。默认“跟随本地配置”不能被目录候选或历史实际模型转成覆盖参数 |
| 可调定时同步间隔 | [可见性调度](../../apps/web/src/features/sync/scheduler.ts)目前固定为 15 秒；隐藏和忙状态的既有门禁已实现 | 可配置间隔与生命周期接线；设置变化不叠加计时器，不绕过同工作区串行和待确认门禁 |
| 界面第 1/3/4/5 节目标 | 现有[App](../../apps/web/src/app/App.tsx)与侧栏固定布局；[对话](../../apps/web/src/features/chat/ChatView.tsx)直接映射条目，[工具卡](../../apps/web/src/features/chat/ToolCard.tsx)逐个渲染；文件/版本页提供已有 diff | 可折叠侧栏、可调分栏与亮色切换、网页命令面板、长会话虚拟列表、连续读取工具分组、本轮改动聚合和 diff 行内反馈；按原界面目标继续实施，不以单次界面改版作为全部完成 |

## 2. 验收缺口与证据边界

| 验收 | 已有证据及其范围 | 尚需核对 |
|---|---|---|
| A5、A7、A12、A13 及 A19 的完整串联 | [文件](../guides/workspace-files-acceptance.md)、[版本](../guides/local-versions-acceptance.md)、[Codex 对话](../guides/codex-conversation-acceptance.md)及[认证同步](../guides/m2-acceptance.md)保留各阶段真实/受控链路记录 | 新入口在允许的真实 SSH 目标上串联；密码、同步门禁、保存/恢复和模型运行时分别核对，不把受控同步替身当作实际 rclone |
| A8 原生会话删除 | [会话管理验收](../guides/session-management-acceptance.md)记录网页和原生 API/存储结果 | 在独立 VS Code 插件界面与 CLI 列表实际刷新确认，不用后端文件检查代替客户端显示 |
| A14–A16 与长会话体验 | [原生能力](../guides/native-capabilities-acceptance.md)及[补全验收](../guides/slash-completion-acceptance.md)记录协议、短程真实运行与网页证据 | 实际长会话的自动压缩、续接和显示负载；缺少原生比例时保持不可用，不自行估计为已确认用量 |
| A20–A23 远端文件管理 | [浏览](../guides/remote-files-browser-acceptance.md)、[操作](../guides/remote-file-operations-acceptance.md)、[同步协调](../guides/remote-file-sync-acceptance.md)明确本机和受控范围 | 真实大文件、同/跨文件系统移动与复制、实际 rclone 迁移、冲突/取消后的结果、浏览器磁盘保存及并发响应 |
| A10、A18 与架构 V16 | 终端和资源面板尚未实现，当前没有完整并发验收证据 | 对话、多个 PTY、资源采样、同步及文件任务同时工作；按通道核对输入、输出限制、独立取消/失败和串行边界，不仅检查静态页面 |

真实 SSH 仍需用户指定允许测试的 Host 和独立临时目录。已读取的临时 Agent 配置不提供该授权；不重复发起已经待答的问题，不自行猜测服务器或项目路径。

## 3. 后续依赖与分支

终端沿用已完成的认证池和访问控制，可先独立实施；其书面设计与实施计划需完成仓库技能规定的审阅。完整向导需要把手动目标和草稿连接贯通到现有 resolver，保留已存工作区兼容；资源采样在同一目标身份上共享，同时将磁盘指标绑定实际目录，不能仅按 Host 别名合并所有结果。

产品设置和工作区删除分别作为可审阅子功能，补齐上述源码缺口；布局与长会话改动按实际影响扩大视觉/负载验证。最后再串联真实 SSH 与多活动并发，更新原验收编号。各阶段从 `feat/ssh-workflow` 创建 `codex/` 小分支，代码和对应正式文档一起提交，验证后按两级 `--no-ff` 整合。
