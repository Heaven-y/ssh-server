# AgentDeck

Windows 本机桌面工作台，按项目集中使用 Claude Code、Codex 和 Antigravity 的原生会话。整体交互参考 DSH；各 CLI 保留自己的会话、配置、工具与权限语义，工作台扩展采用 AgentDeck 自有插件接口。

**当前优先完成原生对话主流程，再补配置，最后接入插件。** 插件方向已经确定，但不兼容或直接安装 DSH 插件包。

## 功能与进度

| 部分 | 当前基础与下一步 |
|---|---|
| 桌面与项目 | Electron 窗口、单实例和退出清理已具备；项目按本地目录组织，移除列表记录不删除目录或原生会话 |
| 会话历史 | 三个 CLI 可发现会话；Claude/Codex 可读历史；Antigravity 仅有摘要，私有轨迹无法回放 |
| 原生对话 | M2 当前主线：接通三个 CLI 的新建、续接、流式事件、中断和原生参数；审批或软拒提示遵循各自权限机制 |
| 原生配置 | 已有 Claude `settings.json` 与 Codex `config.toml` 的编辑基础；后续逐项核实各 CLI 支持的作用域和入口 |
| SSH | 现有项目绑定式终端、资源、Slurm 与服务器文件能力暂保留；后续按 SSH Console 的实际体验接入插件 |
| 插件 | M4 扩展方向：自己的插件接口；SSH Console 是首个业务插件，尚未作为插件交付 |

完成状态和验证边界统一记录在[路线图](docs/roadmap.md)。旧同步、版本快照、本地文件镜像及 Agent→SSH 桥已经移除。

## 启动

需要 Windows 10/11、Node.js 22+。按需安装对应 CLI，服务器使用已有 SSH 与运行环境。

```powershell
npm.cmd ci
npm.cmd run dev:desktop
```

桌面开发入口会先构建前端，再打开 Electron 窗口。当前还没有安装包；浏览器开发可运行 `npm.cmd run dev`，生产式本机服务可运行 `npm.cmd start`。环境变量和隔离验证方式见[开发指南](docs/guides/dev-environment.md)。

## 使用边界

- 会话正文保存在各 CLI 原生存储中；本产品不维护第二份对话数据库。
- 启动与浏览只做本机探测、配置和历史读取。可能触网的能力刷新由用户触发，模型回合只在显式发送后启动。
- CLI 支持什么能力、配置放在哪个作用域，以该 CLI 的实际接口为准。不同 CLI 的差异会明确展示。
- 后端仅监听回环地址，并校验会话与请求来源；SSH 凭据不进入项目配置或模型输入。
- AgentDeck 插件扩展工作台；CLI 原生 Skills、MCP 和插件仍由各 CLI 解释执行。

## 文档与开发

从[文档导航](docs/README.md)依次阅读产品需求、界面约定、架构和现行决策。`npm run check` 是完整工程门禁，日常按改动影响范围验证；提交、合并与推送遵循[分支规范](docs/guides/dev-environment.md#16-本仓库的-git-分支与提交)。

旧版设计、计划和验收材料已退出当前文档集，可通过 `c686ef2` 查阅；更早的决策见 `ec33148`。追溯方式见[现行决策](docs/engineering/decisions.md#历史追溯)。
