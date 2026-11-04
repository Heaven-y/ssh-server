# 路线图

更新日期：2026-11-04。功能与验收条件以[需求](product/requirements.md)为准，设计与取舍见[设计文档](superpowers/specs/2026-11-03-native-cli-workbench-design.md)，文档入口见[导航](README.md)。

## 产品转向

原主线「本地改代码 → rclone 双向同步 → 服务器上跑」整体移除。同步、版本、本地文件镜像三个域连同改动视图与行内反馈、工作区创建向导、命令黑名单、Agent→SSH 的 MCP 桥一并删除，不保留开关与兼容路径。新主线是**本机工作台，统一管理 Claude Code / Codex / Antigravity 的原生会话**；SSH 能力作为附带工具保留。

产品名由 `ssh-server` 改为 **AgentDeck**（包作用域 `@agentdeck/*`，数据目录 `%LOCALAPPDATA%\AgentDeck`），旧数据一次性迁移。

## 里程碑

| 期 | 内容 | 状态 |
|---|---|---|
| M1 只读工作台 | 删除三个域与旧向导；项目模型与两层旧数据迁移；三个 CLI 的本机探测、会话枚举与归属裁决；三段式外壳；项目添加；只读会话历史 | **已完成** |
| M1.5 桌面壳 | `apps/desktop` 加入 Electron 主进程与 preload；`electron-vite` 开发循环；单实例与退出编排 | 未开始 |
| M2 对话 | 输入框与流式回合、工具卡片实时更新、Claude/Codex 审批、Antigravity 软拒提示、中断、会话级参数、分叉与删除 | 未开始 |
| M3 配置与服务器 | 原生配置完整编辑（用户级 + 项目级）、启动环境注入、服务器面板改以服务器档案为键、命令面板补齐 | 未开始 |
| M4 打磨 | 目录监听实时刷新、键盘操作、空态与错误态、CLI 升级后重新探测、安装包与自动更新、验收记录 | 未开始 |

### M1 实际交付

- 项目：`{ id, name, dir, server?, remoteDir? }`，目录必填且必须存在，服务器与默认目录同进同退；`GET/POST /api/projects`、`PATCH/DELETE /api/projects/:id`；旧目录复制与旧字段改写两层迁移。界面只接入「添加项目」，改名、移除与绑定服务器还没有表单。
- 会话：Claude 走 Agent SDK 会话接口，Codex 走 `app-server` 的 `thread/*`，Antigravity 读本机 SQLite 摘要表；统一按 `cwd` / `workspace_uris` 裁决归属，解析不出即 `null`，界面默认隐藏。
- 历史：`GET /api/projects/:id/sessions/:agent/:sessionId` 只读渲染；Antigravity 返回 501 `session_not_replayable` 并显示说明页。
- 探测：`GET /api/agents/probes` 按 `--version`、`--help` 与 Codex schema 生成判断四态，不比较版本号。
- 界面：三段式外壳、左栏项目树与会话分组、主区历史、右侧服务器面板（终端 / 资源 / 文件）、`Ctrl+K` 命令面板、深浅主题与有界尺寸记忆。服务器面板要求项目已绑定服务器，而 M1 界面还不能新建绑定，所以只有迁移过来的已绑定项目能用它。
- 验证：`npm run check` 覆盖类型、ESLint、格式、文档一致性、重复率与覆盖率；关键路径有单元与模块集成测试。

### M1 未交付（不要当成已完成）

- 项目改名、移除与服务器绑定没有界面表单，只有接口；界面新建的项目无法绑定服务器。
- 服务器文件下载的移除仍在计划里，代码与界面暂保留该入口。
- 原生配置只覆盖 Claude `settings.json` 与 Codex `config.toml` 两个文件，项目级配置与 Antigravity 配置未实现。
- 启动环境注入、服务器面板以档案为键、目录监听、Electron 壳、输入框与流式回合都未开始。

每期结束都要 `npm run check` 通过，并同步更新 `docs/` 下的需求、界面、架构与决策记录。

## 运行边界

- 三个 CLI 都在自升级，接口随时会变。本应用跟着本机装的那一版走，按能力探测而非版本号判断；探测失败时该 CLI 标记不可用，其余照常工作。
- **不自动发请求**：能力目录只在点「刷新能力」时读取，模型请求只在点发送时发生；M1 没有后两个入口。
- Antigravity 的历史轨迹是私有格式，没有公开结构，因此只保证列出会话，不保证正文可回放；界面如实说明，不存副本、不伪造。
- 同一会话在外部进程（终端里的 CLI、桌面端）是否也被驱动无法可靠探测，这是能力边界，界面只呈现本应用自己的运行状态。
- 服务器上的动作只能由人点出来：终端、只读采样、`squeue`、文件增删改移；不安装 Agent，也不接受模型驱动。

新增功能须有明确需求。提交、合并与推送另须授权，遵循[分支与提交规则](guides/dev-environment.md#16-本仓库的-git-分支与提交)。
