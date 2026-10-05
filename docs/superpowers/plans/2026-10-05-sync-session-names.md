# 同步清单短名称实施计划

> 执行方式：使用 executing-plans，由当前 Agent 原生实施；阶段末一次新核心 Reviewer。用户已授权后续自主决策和整合，不再等待确认。

**目标：** 长配置路径下的实际双向同步可用，旧基线可确认升级，旧文件任务可继续恢复。

**架构：** bisync 的双端根通过 combine 映射为短名称；状态持久化独立布局标记。目标签名和文件任务快照流程保持兼容。

**技术栈：** Node.js、TypeScript、Fastify、rclone 1.75.1，无新增依赖。

**设计：** [同步清单短名称设计](../specs/2026-10-05-sync-session-names-design.md)。

## 全局约束

- 中文、UTF-8/LF；真实连接及日志只写 ignored。
- 保持 mirror-v1 目标签名；旧清单保留，升级走现有冲突保留与确认恢复。
- Native 实施；核心 Review 后集中补核心回归，测试不写绝对路径。
- 两级 no-ff，不改写历史；不绕过既有自动策略拒绝。

## Review 重点

- Windows 长根仍只产生短 bisync 名称；任务镜像与固定镜像正确映射。
- 空格、引号、反斜杠遵循 CSV，不能改变实际 upstream。
- 旧基线门禁先于远端清单、删除、执行，失败不保存新布局。
- 旧持久文件任务允许内部布局变化，真实目标变化仍拒绝。
- 子进程额外环境不会延长凭据生命周期，取消与认证检查保持有效。

## 单一任务：驱动、恢复与验收整合

修改 rclone.ts、state.ts、manager.ts、remote-changes.ts；关联既有 rclone/manager/服务器文件任务测试与 e2e-m2。此接口升级作为一个可独立验收和拒绝的整体。

- [x] 原始长路径实际 CLI RED；combine 探测初始化与双向增量 GREEN，固定版本源码核对。
- [x] RcloneContext 增加 baselineLayout?: string；bisync 生成两端 combine 环境，invoke 支持本次额外环境并清理凭据副本。
- [x] StateSchema 增加可选 baselineLayout；checkSnapshot 在已有签名布局变化时进入 recovery；两条成功回写路径保存布局。
- [x] 调整受影响既有断言，运行相关旧同步/文件任务测试及类型检查。
- [x] 实际 SSH/rclone 的六项核心传输、长根和特殊字符，以及旧状态和持久任务升级通过。
- [x] 一次 fresh Reviewer；自行核对等级，一轮修复，不复审；随后最少核心回归在旧实现 RED、新实现 GREEN。
- [x] 根据影响范围完成质量门禁，更新正式需求、架构、决策、路线图、开发指南、范围核对与验收。
- [x] 成组提交、推送小分支，PR base feat，双平台 CI通过；产品两级本地 no-ff 已完成，feat已推送。

发布收尾采用独立文档小分支补真实整合记录，再两级no-ff后统一推送main；最终main CI及小分支安全清理由任务交付和Git实际核验，详见[整合记录](../../guides/sync-session-names-acceptance.md#已核对整合记录)。

自检：状态字段与驱动接口一致，所有成功回写路径已列出，升级/任务兼容和凭据副本均有验收要求，无范围外 UI 或模型调用。
