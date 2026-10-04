# 产品设置实施计划

> Native，executing-plans逐项实施；用户授权自主决策，核心实现后一次Review再补少量回归，覆盖每步TDD和重复确认。禁止astra，不续接历史代理。

目标：本机产品设置和只读环境检测，贯通新会话/新向导与现有同步/资源调度。
设计：docs/superpowers/specs/2026-10-05-product-settings-design.md。
架构：严格JSON与摘要原子保存；共享查询管理偏好，实际工作区保留快照；使用现有SDK/子进程解析及React Query。

## 约束与Review Focus

中文、UTF-8/LF，敏感参数只在ignored运行时；不改原生配置默认、旧工作区或历史模型；不安装远端工具、不调用模型探测。sync间隔15秒（5–300），资源5秒（2–60）、超时8秒（2–30），过期max(15秒,3倍间隔)。双平台门禁后两级--no-ff。

1. 首次偏好迟到及跨窗口刷新不覆盖已输入、手动模型/Agent、历史或运行轮次。
2. 新向导同步默认仅复制一次，设置失败或迟到不能覆盖修改、导致验证票漂移。
3. 改变间隔/隐藏恢复不叠加同步或资源采样，缩短缓存间隔有效且共享身份不分裂。
4. 并发保存、坏文件/外部变化和失败保留草稿/原文件，未知字段和超界拒绝。
5. 环境检测有界且使用真实启动路径，不把非零/异常输出当作可用，不输出凭据或执行模型/网络初始化。

## 任务1：严格协议、产品存储与HTTP

文件：shared/product-settings.ts/index.ts；server/settings/{product-settings,environment}.ts、http/product-settings.routes.ts、main.ts。
接口：ProductSettingsSchema、ProductSettingsDocument={settings,revision}、ProductSettingsInput={settings,revision}；createProductSettings({configDir}).read()/save(input)；detectEnvironment(signal?)；GET/PUT /api/settings/product，POST /api/settings/environment。

- [ ] 实现默认读取、严格校验、摘要复验、串行原子保存；缺失不落盘、坏文件不覆盖。
- [ ] 有界工具检测并接线访问控制；每工具5秒/2KiB，只返回版本/通用失败。
- [ ] shared/server类型、相关lint/格式及已有设置/访问控制回归通过，提交协议与设计/计划。

## 任务2：调度及新建默认接线

文件：web/settings/use-product-settings.ts；chat/chat-store.ts、AgentControls.tsx；workspaces/setup/use-workspace-setup.ts；sync/{scheduler,use-workspace-sync,SyncPanel}.ts(x)；resources/ResourcesPanel.tsx；server/resources/{cache,service}.ts、main.ts。
接口：useProductSettings查询产品document；chat.setDefaults(settings)、模型来源default/explicit；scheduleVisibleSync options.intervalMs/restart无重复即时tick；ResourceCache.get(...,timing)和service settings依赖。

- [ ] 新会话与初始空白加载遵守迟到/来源规则，历史不接受隐式默认覆盖。
- [ ] 新向导复制sync快照，加载失败可重试，编辑后不受迟到设置影响。
- [ ] 动态同步调度及资源缓存/超时/过期，页面隐藏暂停且同key不重叠。
- [ ] 相关类型/静态检查及既有chat/scheduler/resources/setup回归，提交。

## 任务3：设置界面与环境报告

文件：settings/{SettingsDialog,ProductSettingsDialog,NativeConfigDialog,EnvironmentReport}.tsx、App.tsx、lib/api.ts。

- [ ] 产品偏好与原生配置入口分开，保留现有原生编辑保存/dirty保护。
- [ ] 默认Agent/按Agent模型、同步默认过滤/大小/间隔与资源参数；校验、单次保存、失败保留、未保存离开提示及环境按钮。
- [ ] 网页相关类型/lint/build及已有原生设置回归，提交。

## 任务4：一次Review、核心验证与整合

- [ ] 一次独立核心Review（新gpt-6.1-sol代理），逐项裁定Focus，不重复派审。
- [ ] 核心回归配置默认/持久/并发/错误、历史与迟到默认、草稿快照、动态计时器/缓存、工具缺失/超时/输出约束；重要问题RED→GREEN。
- [ ] Edge960/1280/1920保存/失败/重开、真实版本检测与SSH资源参数增量，正式需求/架构/决策/roadmap/验收同步。
- [ ] 工程门禁、PR双平台CI及两级--no-ff/main CI，继续工作区黑名单和界面/M6。

自查：T1协议由T2/T3消费一致；T2动态参数先于T3设置入口；版本检测复用已有实际解析而非另猜PATH；默认源与显式源分开避免历史模型误改；测试只补核心，阶段范围不含黑名单和顶栏概览。
