# 长会话与工具分组验收

日期：2026-10-05。设计与全部取舍见[L01–L07](../superpowers/specs/2026-10-05-conversation-timeline-design.md)。本阶段改善网页长历史展示，不将受控数据解释为原生自动压缩或完整M6。

## Edge显示与流式负载

载入2000轮、14000个原始条目，投影为10000行。每轮包含用户、助手、三个明确读取工具、独立remote_exec及Markdown代码块；末组包含成功、失败和结果未返回。数据来自独立临时Fastify/网页WebSocket替身，不调用模型、不连接SSH，不修改原生会话记录。

| 宽度 | 首屏挂载行 | 点击历史至末轮出现 | 流式增长后距底部 |
|---|---:|---:|---:|
| 960 | 7 | 1178ms | 0px |
| 1280 | 7 | 1147ms | 0px |
| 1920 | 8 | 1157ms | 0px |

这些耗时是本机一次受控测量，不承诺其他设备同速。滚到开头时DOM仍少于100行；返底后外组和内部工具的展开状态恢复。分组显示独立失败/未返回计数，remote_exec始终独立。用户实际滚轮上翻800px后继续同assistant条目增高，scrollTop偏差小于5px；返底与同条目动态高度跟随通过。每个宽度经真实网页WebSocket发送受控消息、原生id通知及独立审批，三次批准均由后端确认，无重复请求。

两主题960/1280/1920无横向溢出、无pageerror；最终六张图已实际检查。图中my-server、示例脚本与工具结果均为展示数据；同步/版本接口不可用状态只是隔离环境边界。长输出可在原工具内滚动，关闭或虚拟卸载不更改执行状态。

| 宽度 | 暗色 | 亮色 |
|---|---|---|
| 960 | [截图](../assets/conversation-timeline-dark-960.png) | [截图](../assets/conversation-timeline-light-960.png) |
| 1280 | [截图](../assets/conversation-timeline-dark-1280.png) | [截图](../assets/conversation-timeline-light-1280.png) |
| 1920 | [截图](../assets/conversation-timeline-dark-1920.png) | [截图](../assets/conversation-timeline-light-1920.png) |

## 工程与证据边界

一次新的gpt-6.1-sol核心Review检查8a18738..676f28b：Critical无，Important一项，Minor无。连续1000个读取最初压成一行，折叠仍挂载1001个details/2000个pre；此前每组三项的外层行统计无法覆盖。按L07拆为最多40项的稳定段，折叠卸载内部卡片。一轮修复的纯投影/组件与实际Edge均RED→GREEN：折叠时10个外层行、9个details、0个pre；展开后47个details、80个pre，内部卡片保持有界。原有展开状态留在父层；修正后只复验受影响分组、虚拟卸载、返底及两主题三宽度。

核心3文件35项通过，新增6项覆盖分组边界/状态/稳定key/1000连续读取、折叠与展开DOM、视图代次及首次原生id；既有会话逻辑继续通过。实施类型、相关静态检查、网页构建与既有会话2文件37项已通过，最终工程门禁及PR/两级整合按实际结果补记。

最终npm run check通过：类型、静态检查、格式、重复率及覆盖率均通过；106个测试文件/706项通过，1文件/5项平台相关跳过。覆盖率Statements85.84%、Branches79.28%、Functions86.41%、Lines89.46%；重复行0.38%，未修改门槛。Review修复后的网页构建、连续1000项负载和两主题三宽度分组复验均通过。

Review另用只读Edge验证键盘PageUp和tabIndex=0；上翻后缩小窗口并追加屏外内容，scrollTop保持12548。未提供真实读屏器播报证据，保留该限制；真实原生自动压缩和续接在M6继续核对。文件改动聚合、主题/分栏变化期间的持续并发及完整SSH验收仍按需求实施，不能从万条静态载入推断其全部通过。

整合完成：[PR13](https://github.com/Heaven-y/ssh-server/pull/13)已合入feat，双平台CI37251447782成功。两级--no-ff分别为feat6e1670b与mainfe69a681，合并树均与已验收f2812dc相同；main CI37252353935成功。核对已合入main且无工作树占用后，删除本地及远端codex/conversation-timeline，保留feat/ssh-workflow；本轮改动阶段从feat6e1670b继续。
