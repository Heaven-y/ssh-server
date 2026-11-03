# AgentDeck

本机 Windows 桌面应用：把本机 Claude Code、Codex、Antigravity 的原生会话统一到一个窗口里管理，附带一个 SSH 服务器控制台。

会话是这些 CLI 自己的会话，配置是它们自己的配置。本应用不含模型引擎、不存对话正文、不另造配置体系——只负责把原生内容摆整齐、画出来、能接着聊。

## 功能

| 能力 | 工作方式 |
|---|---|
| 项目 | 以本地绝对路径标识；可选绑定服务器档案；移除只删配置，不动磁盘文件与原生会话 |
| 会话 | 三个 CLI 的本机会话统一列出，按原生 `cwd` 判定归属，按 CLI 分组；正文来自原生存储，不复制、不导入 |
| 对话 | 流式回复与工具卡片、中断、会话级参数；Claude/Codex 走原生审批，Antigravity 的软拒原因在界面可见 |
| 原生配置 | 直接编辑用户级与项目级（`CLAUDE.md`、`AGENTS.md`、`settings.json`、`config.toml`、`.agents/` 等）；密钥字段默认掩码，可展开 |
| 启动环境 | 每个 CLI 一组白名单环境变量，Windows 加密保存；Antigravity 的自定义端点靠这个注入 |
| 服务器控制台 | 多标签/分屏 SSH 终端、GPU/CPU/内存/磁盘/负载采样、Slurm 只读查询、服务器文件浏览与新建/重命名/移动/复制/删除 |
| 桌面形态 | Electron 壳起本机后端并加载窗口；关窗口即退出，无孤儿进程 |

**明确不做**：代码同步、本地 git 版本记录、改动视图与行内反馈、服务器文件下载、把 CLI 的终端界面塞进应用。

## 环境与启动

- Windows 10/11；Node.js 22+。
- 按需安装 `claude`、`codex`、`agy`，并以**本机安装的版本**为准——本应用不打包、不锁定版本，按能力探测而非版本号判断。
- SSH 需要可用的账号密码或私钥；服务器使用已有工具与 Python 环境，不自动安装依赖。

```powershell
npm.cmd ci
npm.cmd run dev
```

开发期会同时起后端与界面。打包后的桌面应用（`npm.cmd start` 与安装包）在 M4 落地，当前阶段直接跑开发循环。

环境变量、代码规范与验证方法见[开发指南](docs/guides/dev-environment.md)。

## 请求策略

本应用**绝不自动发请求**。任何会消耗额度、打到你自己配置端点的动作都必须由你点击触发：

- 第一档（随时）：`--version`、`--help`、读会话与配置文件、目录监听。
- 第二档（只在点「刷新能力」时）：启动 CLI 检查账号与斜杠命令/模型清单，结果缓存。
- 第三档（只在点发送时）：真正发一轮 prompt。

自定义端点与密钥只在启动子进程时作为环境变量传入，后端自己不发起任何模型请求；密钥不写日志、不回传前端明文、不进错误信息。本应用不读取 cc-switch 等工具的数据库。

## 当前状态

产品转向进行中：同步、版本、本地文件镜像三个域已删除，正在按里程碑重建。进度见[路线图](docs/roadmap.md)，设计见[设计文档](docs/superpowers/specs/2026-11-03-native-cli-workbench-design.md)。

## 文档与开发

- [文档导航](docs/README.md)
- [需求](docs/product/requirements.md)、[界面](docs/product/ui-layout.md)、[架构](docs/engineering/architecture.md)、[路线图](docs/roadmap.md)
- [设计决策](docs/engineering/decisions.md)：仍约束当前产品的取舍与被放弃方案；上一代产品的决策通过提交锚点追溯
- `npm run check`：类型、ESLint、格式、重复率与覆盖率完整门禁
- 分支使用 `main`、`feat/<功能域>` 大功能分支与 `<类型>/<主题>` 小分支，合并统一 `git merge --no-ff`；提交与推送须获授权，见[分支规范](docs/guides/dev-environment.md#16-本仓库的-git-分支与提交)

## 安全

后端只监听本机回环地址，拒绝非本机地址。首页通过严格同源握手取得 HttpOnly、SameSite=Strict 会话 Cookie；API 与 WebSocket 继续校验会话、Host 与请求来源，禁止外部 iframe 嵌入。不要暴露到局域网或公网。服务器密码仅在必要内存中处理，可选 Windows 当前用户加密保存；不进入项目配置、Agent 输入或服务器。明文密码不出现在日志、配置或对话记录里。不要用 root 账号连接服务器。
