# 目录与模块边界审查

审查日期：2026-11-06。独立审查基线为 `feat/model-controls`、提交 `a6cf5ab`。子智能体只读代码、需求、构建和测试组织，未修改产品或调用真实模型、SSH；主线程复核关键依赖后将最终报告纳入文档。Codex 自动压缩阈值已由主线程另行补齐和验证。本文的目录树与阶段均为迁移建议，尚未实施，当前实现事实以[架构](architecture.md)为准。

## 结论

需要重新组织内部模块，但不需要推倒重写整个仓库。现有 `apps/desktop`、`apps/server`、`apps/web`、`packages/shared` 与技术栈符合当前产品：Electron 管桌面生命周期，Fastify 管本机服务，React 共用会话界面，shared 管跨进程契约。

优先级最高的是把 CLI 专属配置、通用文件安全、会话契约和插件业务的责任放回正确位置。把所有文件按 Claude/Codex/Antigravity 拆成三套产品会破坏已有统一会话、项目归属和 UI；单纯把目录改名也不会解决依赖方向。

建议四项原则：

1. 每个 CLI 的运行、历史、能力发现、原生配置字段与补丁、资源发现计划放在同一适配目录。
2. 通用服务只编排已声明的接口，不识别各 CLI 的配置键、模型别名或原生存储格式。
3. 公共 UI 继续只有一套；CLI 特有控制与模型规则放在前端的 CLI 能力模块。
4. 插件宿主负责注册、权限和生命周期，内置 SSH 的页面、服务与旧工具属于插件业务；外部插件继续保持 v1 静态页面边界。

## 发现与依据

严重性中的 P2 表示应安排修复或迁移的具体耦合，P3 表示可随相关迁移完成的组织问题。本次未发现需要立即重写系统的 P0/P1；以下行为问题没有通过真实 SSH 重演，不将静态审查当作运行验收。

### P2：CLI 配置逻辑散落在通用 settings 中，依赖方向双向

证据：

- `apps/server/src/settings/model-settings-fields.ts:50`、`:149`、`:178` 在同一文件定义 Claude、Codex、Antigravity 字段与认证细节；`:208` 还负责解析 AGY 默认模型。
- `apps/server/src/settings/model-settings.ts:38`、`:93`、`:97`、`:105` 在通用读写流程中分支判断具体 CLI，尤其将 AGY 模型选择、环境写入和恢复流程直接嵌入服务。
- `apps/server/src/settings/model-settings-patch.ts:93`、`:179`、`:207` 混合 JSON/TOML 写入及各 CLI 字段规则。
- `apps/server/src/agents/antigravity/model-catalog.ts:5` 反向导入通用设置表单中的 `antigravityModelId` 和 `selectedAntigravityModel`；`apps/server/src/settings/model-settings-antigravity.ts:2` 又导入 AGY 运行目录发现。这里确认的是层级双向依赖，不声称已经存在运行时循环引用。
- `apps/server/src/settings/native-resources-catalog.ts:105`、`:142`、`:194` 聚合三种 CLI 的资源路径；`apps/server/src/settings/native-resources-discovery.ts:140` 在扫描器里继续分支选择规则文件名。

影响：本轮增加 Codex 压缩阈值，或以后新增第四个 CLI，需要同时修改公共表单、补丁、资源目录、环境流程等多处。运行器与配置页共享 AGY 模型身份规则是合理的，但规则的归属应是 AGY 适配器，不是表单描述文件。

建议：保留 `createModelSettingsService` 作为事务协调器，将各 CLI 的 `fields/parse/patch/resourcePlan/launchVariables` 移入各自 `apps/server/src/agents/<cli>/configuration/`。抽出很小的配置适配契约，由一个静态注册表提供实现。AGY 的文件加环境复合 revision、写入恢复仍由其配置适配实现；通用安全读写和文件事务不要复制三遍。

### P2：适配器契约与错误类型定义在会话服务实现里

证据：`apps/server/src/chat/sessions.ts:26` 声明 `SessionProvider`，`:48` 声明带 HTTP 状态的 `SessionError`。Claude 会话适配器 `apps/server/src/agents/claude-sessions.ts:12`、Codex `apps/server/src/agents/codex/sessions.ts:4`、AGY `apps/server/src/agents/antigravity/sessions.ts:3` 和其管理 RPC/轨迹读取都导入这个服务实现。甚至 `apps/server/src/agents/claude-effort.ts:2` 与 `apps/server/src/agents/capability-directory.ts:2` 也为了错误类型依赖会话服务。

影响：底层 CLI 参数校验会加载本不相关的服务模块；修改服务文件成为多个适配器的共同变更点。单把 Claude 文件移进文件夹无法解决这个问题。

建议：将 `TurnRunner`、`SessionProvider`、能力发现接口与边界错误放到 `apps/server/src/agents/contracts.ts` 及小型 `apps/server/src/agents/errors.ts`；业务服务消费它们，CLI 实现它们。已有状态码和错误分类先保持，后续需要时再由 HTTP 层映射，避免在一次搬家中改动错误行为。

### P2：插件宿主写死 SSH，且停用资源边界存在缺口

结构证据：

- `apps/server/src/plugins/registry.ts:19` 内置 SSH manifest；`:40` 的存储字段叫 `sshConsoleEnabled`，`:59` 直接拼 SSH 条目。
- `apps/server/src/plugins/service.ts:90` 为 SSH id 保留分支，`:119` 对任意 builtin 都写 `sshConsoleEnabled`。增加第二个内置插件必须改宿主存储和业务流程。
- `apps/web/src/features/plugins/PluginWorkspace.tsx:8` 直接加载 SSH 页面，`:60` 包含 SSH 与旧工具的切换状态，`:130` 写死 id。
- `apps/web/src/features/plugins/PluginManager.tsx:11` 与 `:81` 直接负责 SSH 旧终端清理和专属确认文案；`apps/web/src/features/plugins/use-plugin-pages.ts:35` 还返回专门的 ssh 条目。

行为缺口：`apps/server/src/server.ts:186` 的停用回调只调用 `sshConsole.dispose()`；旧 `terminal/manager.ts` 在 `apps/server/src/server.ts:195` 单独创建，只在应用退出时 dispose。前端 PluginManager 收到停用成功后才删除旧标签，促使组件卸载、WebSocket 关闭。`apps/server/src/http/terminal.routes.ts:18` 与 `:34` 没有插件启用校验。因此直接调用已授权本机 HTTP 停用接口，或停用已写入但响应未到达仍存活的前端时，旧 PTY 没有服务端保证被回收；还可通过旧路由新建。它与需求 F6 的“停用会结束两种终端”不一致。

建议：先把生命周期缺口作为独立修复，在后端为该插件持有所有 PTY/待绑定操作的停用回收与重启能力，不依赖前端成功回调。不能直接调用当前 `terminalManager.dispose()` 后继续复用，因为它永久设置 `disposed=true`；应有可重启的停用关闭方法或重建实例。随后将 manifest、页面、停用提示和资源清理组成内置插件描述，由宿主注册表消费。外部插件不因此获得 Node、SSH、凭据或任意后端执行权限。

### P2：基础设施藏在业务目录，导致无关域反向依赖

证据：

- `apps/server/src/settings/launch-environment.ts:10` 为通用凭据加密依赖 `ssh/windows-protection`。
- `apps/server/src/plugins/files.ts:4`、`apps/server/src/plugins/registry.ts:9`、`apps/server/src/plugins/storage.ts:4`、`apps/server/src/sessions/preferences.ts:4` 复用 `apps/server/src/settings/safe-file` 和 `native-resources-transactions`。
- `apps/server/src/plugins/errors.ts:1` 还需要识别带 Claude/Codex 文案的 `NativeConfigError`，说明文件安全错误归属也被旧配置域绑定。
- `apps/server/src/http/terminal.routes.ts:8` 从远端文件路由导入通用的 `requestSignal`。

建议：建立小而明确的 `platform/files`、`platform/secrets` 和 `apps/server/src/http/request-signal`。保留现有实现、文件身份检查和写入锁，先移动并调整导入，再局部清理错误映射。不要建立一个无边界的 `utils` 或把这些 Node 能力放进浏览器可见的 shared。

### P2：前端模型规则跨功能借用，CLI 特有交互混入公共组件

证据：`apps/web/src/features/settings/ModelSettingsPanel.tsx:9` 从 `apps/web/src/features/chat/model-capabilities` 导入推理规则；后者 `:34` 放 Claude 后缀，`:48` 放多家提供方规则，`:84` 放 AGY 变体。`apps/web/src/features/chat/ModelOptionsMenu.tsx:222` 自己实现 Claude 上下文选择。`apps/web/src/features/settings/use-model-settings.ts:22`、`:54` 继续识别 AGY 认证模式并决定字段显隐/清理。

影响：模型规则改变同时影响对话和设置，但代码归属却是 chat；后续接入 Codex 窗口与压缩阈值，若继续添加特例，公共菜单会变成各 CLI 参数的分支集合。

建议：前端保留统一 `apps/web/src/features/chat`、`apps/web/src/features/sessions`、`apps/web/src/features/settings`，另设 `cli/{shared,claude,codex,antigravity}` 管表示规则、能力策略与确有差异的控件。将模型身份/effort 查询放到 `cli/shared`，Claude 后缀选择放 `cli/claude`，设置和对话共同消费。不要为每个 CLI 复制 ChatView、消息列表、轨迹和状态 store。

### P3：文件与公共 API 的组织仍保留早期历史，不必全量删除

- Claude 有 10 个平铺的 `apps/server/src/agents/claude-*.ts`，Codex 和 AGY 已各自成目录。这是应做的低风险一致化，不构成重写三个运行器的理由。
- 会话服务在 `chat/sessions.ts`，会话归属/偏好又在 `apps/server/src/sessions/`；应归到同一通用会话域。`apps/server/src/agents/session-scope.ts` 中有磁盘 realpath 语义，而 `apps/server/src/sessions/ownership.ts` 刻意使用同步路径语义，不能为了“去重”合并二者并改变行为。
- `apps/web/src/lib/api.ts:106` 的一个对象包含模型、原生文件、SSH、远端文件、终端、会话和项目；`:388` 又集中所有查询键。建议按已有功能域拆 API，`lib` 只留 fetch/ApiError/基础连接。不需要同时更改 URL 或请求结构。
- `apps/web/src/features/chat/chat-store.ts:31`、`:266`、`:350` 共 557 行，混合当前导航、消息发送、历史读取和管理操作。可以抽独立的纯 helper 或 action 模块，暂时保留一个状态源，避免拆成多个 store 后引入跨 store 竞争。
- `apps/web/src/features/chat/trajectory-model.ts:3` 作为数据投影反向导入 `ActivityCard.tsx` 的状态文字函数。把共用纯函数移到展示辅助文件即可，不需重做轨迹系统。
- `packages/shared/src/session.ts:30` 的 `nativeSessionCapabilities` 带实现默认值，前后端又用它兼容缺少 capabilities 的旧数据。长期应以适配器提供的能力为准；shared 保留契约，必要的旧默认单独命名兼容逻辑。它目前不等于所有 AGY 管理动作被禁用，服务端 provider 会覆盖。
- shared 一共 19 个源码文件、约 1,091 行，规模不足以支持再拆成多个 npm 包；先按 `conversation/settings/plugins/ssh` 做文件夹或子路径入口即可。`packages/shared/src/product-settings.ts:6` 仍有旧服务器采样字段，属于兼容业务，不能因 UI 不展示就删除用户数据。

### P3：迁移路径会影响构建与验收，不应只改 import

`apps/desktop/electron.vite.config.ts:30` 指向 `server/src/remote-files/remote-helper.py`；`apps/server/src/remote-files/executor.ts:64` 在模块加载时按相对路径读取该文件。移动旧工具目录必须同时更新复制插件、运行时资产定位与桌面打包检查，否则 Web 测试可能通过而桌面启动缺文件。

桌面生产依赖与 `MAIN_EXTERNALS` 显式维护（`apps/desktop/electron.vite.config.ts:15`、两份 package.json），是当前源码合包方案的一部分；此轮不建议改成动态插件加载或再拆 CLI npm 包。`vitest.config.ts:8` 与 `:33` 有路径型覆盖率范围，目录迁移后须更新并核对，不可用旧路径导致新代码退出统计。当前 ESLint 限制复杂度，但没有模块导入边界；迁移后加少量 `no-restricted-imports` 约束即可，不需要引入重型架构平台。

## 建议目标结构

以下是阶段目标，不是要求一次创建所有空目录；只有存在对应实现时才拆分子目录。

```text
apps/
  desktop/                         # 继续只负责 Electron、preload、窗口与本机服务生命周期
  server/src/
    server.ts                      # 薄组装入口
    bootstrap/
      cli-services.ts              # 注册三个适配器、原生配置与通用服务
      builtin-plugins.ts           # 注册内置业务及清理钩子
    agents/
      contracts.ts                 # runner、session、catalog、configuration 接口
      errors.ts                    # 稳定的适配边界错误
      registry.ts                  # 静态注册，不建设动态 CLI 插件装载器
      common/                      # configured-runner、共用目录核验等
      claude/
        runtime.ts、adapter.ts、sessions.ts、capabilities.ts、mapper.ts…
        configuration/             # 字段、补丁、资源发现计划、别名与后缀规则
      codex/
        runtime.ts、client.ts、sessions.ts、capabilities.ts…
        configuration/             # TOML 字段、provider、窗口和压缩阈值
      antigravity/
        adapter.ts、sessions.ts、management*.ts、history.ts…
        configuration/             # custom model、label/ID、连接环境与资源计划
    application/
      conversations/               # TurnManager 与通用能力编排/缓存
      sessions/                    # 列表、归属、归档索引、会话服务
      projects/                    # 项目目录、占用与旧项目迁移
      settings/                    # 产品偏好、原生资源和表单事务协调
    platform/
      process/                     # 现有子进程解析、启动和取消
      files/                       # safe-file、revision、文件事务、通用格式工具
      secrets/                     # Windows DPAPI 保护
    plugins/                       # 插件宿主、manifest、包校验、registry、storage
    builtin-plugins/
      ssh-console/
        registration.ts            # manifest、服务/路由和生命周期注册
        ssh/、console/              # 复用现有基础和独立控制台
        legacy/                    # 现有 terminal/resources/slurm/remote-files
    http/
      app.ts、security.ts、auth.ts、request-signal.ts
      conversations/、sessions/、projects/、settings/、plugins/
  web/src/
    app/                           # DSH 外壳、工作区布局、导航与跨页面组合
    cli/
      shared/                      # 模型身份、能力目录缓存、通用模型展示
      claude/、codex/、antigravity/ # 少量专属控制与展示策略
    features/
      chat/、sessions/、projects/、settings/
      plugins/                     # 通用插件管理、iframe 与宿主 bridge
    builtin-plugins/ssh-console/
      registration.tsx、console/、ssh/、legacy/
    ui/                            # 无业务的控件、图标、样式
    lib/                           # fetch、query client、桌面桥、通用连接
packages/shared/src/
  conversation/、projects/、settings/、plugins/、ssh/
  index.ts                         # 迁移期间兼容出口，逐步改子路径导入
scripts/dev/、scripts/packaging/    # 保留开发与交付职责
```

也可保留 `chat/`、`apps/server/src/sessions/`、`workspaces/` 原目录名而不增加 `application/` 这一层；真正的验收标准是依赖方向，不是是否使用上面的目录文字。第一阶段应先移出错放的规则和接口，再决定是否值得统一加这一层。

依赖方向应为：

```text
bootstrap → application + agents 实现 + plugins/builtin 注册
application → agents 契约 + platform + shared 契约
agents/<cli> → agents 契约/common + platform + shared 契约
plugins 宿主 → platform + shared 插件契约
内置 SSH → plugins 注册契约 + platform + shared SSH 契约
web app → features + cli + builtin 注册
web features → cli 的公共接口 + ui + lib + shared 契约
shared → Zod/类型（不反向依赖 apps）
```

## 迁移顺序与验收

| 阶段 | 具体产出 | 保留边界 | 最小验证范围 |
|---|---|---|---|
| 0：先修行为 | 服务端统一停用 SSH 资源、旧终端禁用校验与重新启用 | 外部插件权限不扩大；停用不删除用户档案或任务 | 插件 service/route、SSH console、旧 terminal 与停用失败/再启用回归；合成 WebSocket 验证，不连接真实 SSH |
| 1：基础设施与契约 | 提取文件事务/安全、DPAPI、requestSignal；提取 SessionProvider/Error；Claude 放入同级目录 | 不改请求、配置格式、错误语义和生命周期 | 直接及间接消费者 TypeScript；safe-file/配置事务、插件存储、会话/CLI adapter、HTTP 边界；只搬路径不新增镜像测试 |
| 2：按 CLI 收拢配置 | 每个 CLI 的字段、补丁、资源计划、env 定义归入适配器；服务使用静态注册 | 原生作用域、未知字段、JSON/TOML 格式、AGY复合事务保持 | 各 CLI 配置与发现、保存失效、模型缓存和实际发送参数；服务接口与设置组件回归 |
| 3：前端职责归位 | 抽 cli 能力层、API 按功能拆分；从 ModelOptionsMenu 抽专属控制 | 统一 ChatView/轨迹/状态源；一次只调整相关 feature | 模型菜单/设置/历史选择/缓存迟到结果；800/1024/1440 宽度、对话与插件来回切换；无模型请求 |
| 4：内置插件注册化 | SSH manifest、页面、确认文本、资源钩子归入内置插件；旧工具集中 legacy | 保留 v1 registry 迁移、旧 API、项目绑定及任务数据 | 插件启停/安装、iframe 权限、草稿保留、终端持有/停止、旧工具；桌面 helper 资产与退出清理 |
| 5：契约和过渡入口整理 | shared 子目录/子路径导出，通用 API 删除重复出口前盘点调用方，更新架构文档和导入边界 | 不因文件移动改变 native session 数据；不自动删旧文件接口或 URL | shared schema/消费者类型、旧接口兼容测试、文档和构建；全域路径最后整合时扩大到全量静态检查与相关桌面构建 |

阶段 1–4 应按可审阅提交推进，结构搬移与行为修改分开。沿用 `feat/<功能域>` 大分支和 `refactor/<主题>`/`fix/<主题>` 小分支规则；未经新授权不合 main、不推送、升版本或重打安装包。本报告只建议顺序，没有创建或合并分支。

现有测试已按包和领域分类，应随源码目录一起移动；公共契约测试、受控 CLI 假进程、HTTP 归属与会话占用测试继续保留。新增测试只覆盖真实缺口，如“直接 HTTP 停用也关闭旧 PTY”，不为文件位置或导出名字写测试。仅结构重组不需要再消耗模型额度。

## 应保留与暂缓

保留：三 CLI 独立协议、运行器、历史存储读取和真实事件映射；共享 TurnManager、项目占用、会话归属；本机 HTTP 访问控制；安全配置写入；统一对话/轨迹/设置壳；外部静态插件 iframe；现有 SSH 连接池和终端基础。

暂缓：把每个 CLI 拆成独立 npm 包、引入通用依赖注入容器、创建全能 Agent 基类、统一所有 CLI 的配置作用域/参数、为外部插件开放 Node 后端、把所有工具塞进 common、为三种 CLI 复制三套 React 页面。当前规模用静态注册和窄接口即可表达，不必为未来假设建立额外框架。

旧服务器文件、Slurm、项目绑定终端不是当前对话主线，但产品需求 F6 仍保留它们。建议集中到内置 SSH 的 legacy 范围并标明入口，不能把“需求变了”直接解释为允许删除这些功能及其磁盘数据。若后续决定退出旧功能，需另立数据保留和兼容期限。

`[1m]` 应只由 Claude 适配负责；Codex 的数字窗口与自动压缩阈值属于 Codex 原生配置；AGY maxTokens 和模型变体也保持其独立含义。共用的是表单控件与保存流程，不是把三种含义强行合并成一个“上下文大小”字段。

## 审查验证边界

本报告使用源码引用和依赖读取确认上述边界，抽查了服务启动/关闭、协议类型、原生模型配置与资源目录、插件宿主/SSH/旧终端、前端模型/设置/导航、测试配置和 Electron 构建路径。没有执行产品改动，因此未重复运行已通过的全量测试。P2 生命周期项是可从当前接线推导的具体缺口，实施前仍应以受控 WebSocket/假 SSH 场景建立回归。

建议将本报告作为一次结构重整的输入，正式决定迁移后把最终边界写入现有 architecture/decisions/roadmap，避免长期维护另一份相互竞争的架构规范。
