# ssh-server

只在本机运行的网页工作区：和本机 Claude Code 或 Codex 对话，修改本地代码副本，经 SSH 同步并运行服务器项目。模型配置、凭据和对话留在本机；服务器无需安装本工具或 Git，大数据留在远端。

## 功能

| 能力 | 工作方式 |
|---|---|
| 工作区与SSH | 向导选择两端目录、导入或手动保存服务器、密码/私钥认证、主机指纹确认、Windows加密保存密码 |
| 对话 | Claude/Codex会话固定Agent，流式回复、工具卡、单次审批、中断、原生历史/管理 |
| 原生能力 | 沿用本机模型配置、skills和受支持命令；原生上下文与压缩，不另造历史或模型协议 |
| 同步与执行 | rclone双向代码/小文件同步；执行前同步门禁，删除确认、冲突保留，执行后回传小结果 |
| 编辑与版本 | CodeMirror轻量编辑；本地Git保存版本、历史、差异、恢复、本轮净变化与行反馈 |
| 服务器文件 | 同服务器浏览、新建、重命名、移动、复制、删除、结果核对；涉及同步范围时协调两端 |
| 下载 | 明确选择位置后流式保存，仅使用File System Access API；不自动进入同步或Git |
| 终端与资源 | 多标签/分屏SSH终端、独立资源采样；固定目标、可见性控制、不可用/过期反馈 |
| 设置与布局 | 产品默认值、原生配置编辑、工作区命令规则、主题与分栏、长对话列表 |

项目运行、训练、统计和绘图默认使用服务器已有环境。用户发消息后才检查训练结果，不自动检测完成或唤起Agent。保存文件不创建Git提交，只有“保存版本”才提交用户项目。

## 环境与启动

- Windows 10/11；Node.js 22+；Git 2.43+。
- 本机已安装并配置 Claude Code 和/或 Codex CLI，产品通过官方运行时接入；无需 VS Code 插件。
- rclone **1.75.1**：放入 PATH，或用 `SSH_SERVER_RCLONE` 指定已安装程序。服务器不需要安装rclone。
- SSH账号、可用密码/私钥和主机信任记录；服务器使用已有工具和Python环境，不自动安装依赖。
- 文件下载需要支持File System Access API的当前桌面Edge/Chrome；不提供下载管理器备用路径。

在仓库根目录运行：

```powershell
npm.cmd ci
npm.cmd start
```

打开后端打印的本机访问地址。开发热更新使用 `npm.cmd run dev`。认证、环境变量及验证方法见[开发指南](docs/guides/dev-environment.md)。

## 当前状态与边界

第一版核心功能已经实现，当前状态与证据见[路线图](docs/roadmap.md)。本轮统一当前契约、清理旧兼容和迁移，详情见[范围核对](docs/engineering/remaining-scope-audit.md)。只维护当前数据格式；旧或损坏配置/任务不会自动清空、迁移或重放，恢复使用前须先核对原始数据。

Windows rclone无法保留含反斜杠的远端根，产品会在传输前拒绝，不能直接替换路径字符重试。外部客户端界面和OS控件是检查手段，历史未观察事实不虚构通过，也不扩成额外产品功能。

不包含完整IDE、多Agent编排、多用户、集群全节点监控、服务器软件安装、独立安装器或自动结果分析。

## 文档与开发

- [文档导航](docs/README.md)：区分现行规范与历史记录。
- [需求](docs/product/requirements.md)、[界面](docs/product/ui-layout.md)、[架构](docs/engineering/architecture.md)。
- [设计决策](docs/engineering/decisions.md)：保留取舍、被放弃方案及后续替代关系，供复盘。
- `npm run check`：类型、ESLint、格式、重复率与覆盖率完整门禁；CI在Windows/Linux执行。
- 开发分支使用 `main → feat/ssh-workflow → codex/短期分支`，两级 `git merge --no-ff` 保留历史；提交与推送须获授权，见[分支规范](docs/guides/dev-environment.md#16-本仓库的-git-分支与提交)。

## 安全

后端只监听 `127.0.0.1`，校验令牌和请求来源，不要暴露到局域网或公网。密码仅在必要内存中处理，可选系统加密保存；不进入工作区配置、Agent输入或服务器。命令黑名单用于防误操作，不是安全沙箱；本人操作的网页终端不经过黑名单。不要用root账号连接服务器。
