# rclone 远端根路径安全验收

日期：2026-10-06。对应 F5.11、D35。保持 rclone 1.75.1、Node.js/TypeScript/Fastify 和现有 SSH/同步架构，不新增依赖或服务器安装。

## 1. 本阶段范围

续接前核对需求 F1–F10、验收 A1–A23、路线图、架构、界面目标和剩余范围。主要功能已有实现与分范围验收，本轮不重新开发已交付模块。基线 `main` 为 `f5b6385`，Git fetch 后本地/远端一致，对应 [CI37283499050](https://github.com/Heaven-y/ssh-server/actions/runs/37283499050) 成功。

沿已记录的 Windows rclone 反斜杠限制核对代码，发现两个具体缺口：

- 同步和预览对 `pwd -P` 输出使用 `trim()`，会改变合法尾随空格，也会隐藏首尾异常换行/回车；同步入口没有拒绝 `truncated`。
- Windows rclone 会把实际根中的反斜杠转换为斜杠，产品此前未在数据命令前拒绝。如果转换后的目录存在，不能靠“目录不存在”报错保证目标正确。

## 2. 修改与结果

生产修改限定在 `apps/server/src/sync/rclone.ts`：两个入口共用精确解析，只移除命令追加的一个 LF；要求绝对根且拒绝剩余换行、回车、NUL、缺少终止符。同步还检查截断标记，预览保留原 `executeMetadataCommand` 的失败/超时/截断保护。Windows 反斜杠根返回 `unsafe_remote` 和处理建议，在创建 rclone 传输状态、转交凭据或读取清单前停止。

| 验证 | 实际结果与边界 |
|---|---|
| 固定二进制无网络探针 | 本机 rclone 1.75.1 对 memory backend 输入 `:memory:/projects/demo\root`，诊断中的规范根为 `:memory:projects/demo/root`，退出码3（测试目录不存在）；确认路径转换，不冒充真实SSH传输 |
| 改动前基准 | 安装锁文件依赖后，原 rclone/preview 两文件12项通过；依赖版本和锁文件未修改 |
| 测试先行 | 新路径文件19项中13项在旧代码失败、6项既有安全不变量通过；原CSV映射用例加入合法Unicode/尾随空格后也失败，共14项预期失败 |
| 修复后关联验证 | 11文件116项通过，覆盖路径/过滤/进程/快照/同步状态机、向导、同步HTTP、文件任务与影响分类 |
| 路径与状态 | 同步和预览均保留 `workspace:/projects/中文 demo ` 的尾随空格；普通路径继续工作；异常路径只运行版本检测，不启动数据命令，也不建立传输状态 |
| combine映射 | 引号翻倍、Unicode、尾随空格及本地逻辑根保留；子进程成功/异常清理凭据副本的原回归继续通过 |
| Windows路径门禁 | 本机同步/预览均拒绝反斜杠根，错误说明不得直接替换路径字符；同一用例在非Windows CI上核对原路径保留 |
| 类型与静态检查 | `npm run typecheck`、全仓 `npm run lint`、`npm run format:check`、`npm run dup` 全部通过；重复行0.35%，低于3%门槛；完整覆盖率门禁由最终main双平台CI核对 |

本机关联命令：

```powershell
npm.cmd test -- apps/server/tests/sync apps/server/tests/remote-files/sync-coordination.test.ts apps/server/tests/remote-files/sync-impact.test.ts apps/server/tests/workspaces/setup.test.ts apps/server/tests/http/sync.routes.test.ts
npm.cmd run typecheck
npx.cmd --no-install eslint apps/server/src/sync/rclone.ts apps/server/tests/sync/rclone-root-safety.test.ts apps/server/tests/sync/rclone.test.ts apps/server/tests/sync/setup-preview.test.ts
```

## 3. 兼容与未验边界

- 普通根的目标摘要算法 `mirror-v1`、清单布局 `combine-v1` 未改。此前若摘要使用被裁剪的错误根，精确根不同会进入既有目标变化保护，不自动迁移或清除旧基线/文件任务。
- 不自动改名、不直接替换路径分隔符，也不升级或修改 rclone。Windows 反斜杠根仍不支持同步；本次修复的是明确拒绝与防止目标换向。
- SSH服务器文件浏览、用户终端、模型适配器及网页布局未改；本轮没有新增真实远端传输或浏览器验收，不重跑未受影响的模型/网页基准。
- A8 独立 VS Code/CLI 列表刷新、原生 OS 输入法和 Edge 系统保存选择器仍未验；此前策略拒绝的界面读取及清理不绕过。整个项目不据此标为全部完成。

## 4. 提交与分支决策

用户授权自主决定并记录。复用当前干净工作区，从保留分支 `feat/ssh-workflow` 创建 `codex/rclone-root-safety`；另一工作树保留大分支，不新增第三工作树。当前安装依赖只恢复锁文件工具链，不提交 `node_modules` 或临时探针。

代码、测试与本文及需求/架构/决策/路线图成组提交。关联验证通过后先 `--no-ff` 合入 feat，再 `--no-ff` 阶段合入 main；每次核对目标工作树干净和合并后树一致，再正常推送。最终 main 双平台 CI 成功后确认包含关系并只删除已合并小分支，保留 main、feat 和原始提交。精确提交、远端状态及CI见本次交付和Git历史，不为回填自身SHA再制造文档合并循环。
