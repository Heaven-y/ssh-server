# 本机直接访问与集中服务器连接设计

日期：2026-10-07。用户已确认尚未投入使用，要求直接全部改好，只维护新版本，不做旧配置迁移；沿前述交流明确实施，不再反复询问相同范围。

## 目标和范围

1. `npm.cmd start`后直接打开`http://127.0.0.1:4317/`可用，刷新或后端重启后重新打开也不需要复制令牌。
2. 服务器档案统一管理地址、账号、认证方式和密码保存状态；工作区仅选名称、本地目录、服务器、远端目录及同步规则。
3. 首次浅色，顶栏显式一键深浅切换；复用现有样式、编辑器/终端主题和浏览器偏好。
4. 启动自动检测已有工具，网页显示同份结果及安装/配置指引。只检查能否执行，不维护版本符合性矩阵，不调用模型/SSH、不自动安装或升级。

## 单一服务器模型与接口

- `ManagedServer`保留稳定`alias`，`ManualServerInput`新增必填`authMode: 'key'|'password'`，私钥路径仅对私钥模式有效。服务器列表只返回已登记档案，SSH config为显式导入来源，不再让工作区直接隐式使用未登记Host。
- `WorkspaceInput`删除`authMode`，保留`sshHost`作为稳定服务器档案引用，schema拒绝该旧字段；终端目标也不携带认证方式。后端`SshTarget`统一`{ alias: string }`，解析器从服务器档案取得认证方式，执行/同步/浏览/终端/资源共用。
- `GET /api/ssh-targets`返回`ManagedServer[]`；`POST`接受`ManualServerInput`返回新档案。`GET /api/ssh-targets/import-options`返回`SshHostInfo & { keyFile?: string }`数组，读取SSH config，显示不支持项；网页选中后填入表单，确认保存成唯一档案，不改写SSH config。
- `PUT /api/ssh-targets/:alias`接受`{ input: ManualServerInput, expected: ManagedServer }`；`DELETE`接受`{ expected: ManagedServer, confirmed: true }`。更新串行比较expected，陈旧409。已有工作区引用时不能改变主机/端口/账号/私钥目标或删除；允许空闲时修改显示名称及认证方式，必须重验、失效旧连接/密码内存；活动/未解决任务拒绝认证变更。绑定保护仍核对实际身份、信任及认证代次。
- `POST /api/ssh/connect`接受`{ sshHost, password?, savePassword? }`，不再由网页提交认证方式或项目目录；只验证服务器认证（home目录只读命令），实际项目目录由向导verify校验。`GET/PUT /api/ssh/credentials`、disconnect继续按服务器alias作用，状态包含`connected`与`hasPassword`，不返回密码正文。连接/重认证/断开提示该服务器的全部受影响工作区。
- 前端工作区向导仍走验证票和首次同步确认，不提供直接CRUD；服务器步骤只选档案与跳转统一管理，不复制密码表单。工作区内SSH详情仅展示状态、跳转统一管理。
- 无旧状态迁移。非法/旧结构拒绝并保留原文件，不删除用户配置，不读用户秘密做验收。

## 本地会话

- 删除用户携带token的`/auth`登录入口。后端内部仍使用随机进程会话秘密与HttpOnly/SameSite=Strict Cookie，不向JS或URL返回秘密。
- 新`POST /api/local-session`只接受空对象；允许已核对的本机Host和精确Origin（含显式配置开发Origin），拒绝未知/null/跨站Origin；存在Fetch Metadata时拒绝cross-site。此路由无需已有Cookie，其他API与WebSocket继续校验Cookie。
- 网页启动先完成同源握手，再开始API查询和WS连接；页面失败显示可重试提示而不是半可用侧栏。不自动放行每个匿名API请求；不允许外部iframe嵌套（frame-ancestors、X-Frame-Options）。纯端口首页与页面重开是正式单一路径。
- 更新开发fixture和脚本为同源POST，不保留旧auth链接兼容。

## 环境与主题

- 复用`detectEnvironment`实际启动定位；启动发起一次有界并行探测，GET环境报告返回该次结果，POST重新检测并更新同一报告。CLI输出简明结果及干净入口，不输出秘密。
- 可执行且退出正常即可用，版本解析失败仅版本未知，超时/输出截断/失败不能报可用。Claude沿SDK原生入口，Codex沿正式resolver，Node显示当前版本；Git/rclone工具运行内部安全要求不因启动提示调整而悄悄删除。
- 未安装Agent时网页仍可管理服务器与工作区；显示清楚哪个Agent不可用，安装指引链接/命令只展示不执行，不把版本探测当模型登录成功。
- 顶栏`浅色/深色`有文字和可访问名称，初次浅色；保留用户已保存主题。主题切换不重建编辑器或PTY，不新增第三套主题或兼容数据迁移。

## 验证和交付

先失败回归再实现；新数据契约、跨工作区共享认证、旧字段拒绝、配置变更与活动保护、主页无需token、跨站被拒绝、无依赖/检测超时、双主题记忆及真实网页流程均覆盖。使用合成SSH与临时配置，不碰真实服务器。全仓门禁+网页构建、相关实际浏览器验证、一次集中审查，具体缺陷定向复测。历史决策保留并新增D37，更新当前文档。复用现有工作树短分支，两级no-ff、正常推送和main双平台CI，沿已有授权收尾。
