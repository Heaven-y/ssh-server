# 本轮改动与行内反馈验收

日期：2026-10-05。取舍见[C01–C15](../superpowers/specs/2026-10-05-conversation-changes-design.md)，正式决策D27。该阶段验证真实本地Git和网页交互；模型、SSH及同步状态使用受控替身，后续实际 rclone、A5/A13 与 M6 已有[独立证据](real-workflow-acceptance.md)，本页 Git/受控状态证据保持原范围。

## 本地快照与生命周期

独立临时Git项目验证预存脏内容、Unicode、新增/删除/二进制、改后复原净零、HEAD和index字节保持、所属引用释放、独立暂存拒绝、陈旧预览、新增删除及无HEAD。两快照表示期间真实本地净差异，包括外部编辑；没有初始化或采集失败明确不可用，Agent继续。

真实21轮采集后保留20条和40个所属引用，会话/过滤身份隔离，重启running转incomplete且不重放。元数据落盘失败释放本次新引用，保留旧基线，缓存不假成功。HTTP拒绝任意对象字段，no-store；放弃复用同步transaction。

受控轮次核对基线→runner→既有同步→结果、首次原生id、采集中取消等待与租约保持、采集/同步故障收尾；纯压缩不采集、不追加同步。以上为模块行为证据；后续真实模型与远端串联见[完整链路](real-workflow-acceptance.md)，不由本页受控轮次代替。

## 实际Edge

960、1280、1920宽度与暗/亮主题：所属快照清单、旧侧第2行点击映射、侧别键盘ArrowDown、无效行999拒绝；待发反馈保持正文，普通消息成功后消费并附比较来源。1920另核对能力选择禁发、取消选择、真实浏览器offline与socket终止后反馈/正文保留、新会话清反馈不清正文。

原CodeMirror DOM标记及未保存return999跨视图保持；新增文件明确删除预览，勾选前不可执行，删除实际落盘与服务器删除待确认分别反馈；磁盘main.py保持return3，不把未保存缓冲写入。增量核对二进制、截断及无效patch无行反馈；外部改为return444后放弃返回409、内容保留且预览清理；迟到历史query不进入新会话。

默认差异主题暗色标点实际对比度为3.30:1。选择组件自带GitHub高对比双主题后，按真实语法文字合成行底色/单词底色逐个取样，暗色最低5.57:1、亮色最低6.46:1；没有降低4.5:1门槛。六张最终截图重新生成并检查，无横向溢出，样例不含真实连接参数。

| 宽度 | 暗色 | 亮色 |
|---|---|---|
| 960 | [截图](../assets/conversation-changes-dark-960.png) | [截图](../assets/conversation-changes-light-960.png) |
| 1280 | [截图](../assets/conversation-changes-dark-1280.png) | [截图](../assets/conversation-changes-light-1280.png) |
| 1920 | [截图](../assets/conversation-changes-dark-1920.png) | [截图](../assets/conversation-changes-light-1920.png) |

## 工程验证

Task1既有版本/HTTP2文件14项、Task2轮次/会话/HTTP3文件31项、Task3相关既有3文件35项通过；类型、相关静态检查与网页构建通过。差异组件按需加载，保留构建原有大chunk警告，不调整阈值。一次新独立gpt-6.1-sol/high审查6e1670b..9ac4fb5：Critical无、Important两项、Minor一项。两项Important分别是采集排除信息丢失导致虚假HEAD回退、失效缓存仍可评论；按C13/C14一轮RED→GREEN。Minor的结束落盘失败会使running容量持续占用，按实际功能可用性升级Important，按C15一轮RED→GREEN；无需复审，无遗留Minor。明确后续的核心测试/正式文档和真实M6不判作本次实现遗漏。

最少核心回归新增11项：真实Git净变化/HEAD/index/引用和单文件放弃、两端超限排除并集、落盘失败同进程终态恢复、真实21轮保留/重启/会话及规则隔离、采集中取消及纯压缩、反馈身份/容量/失败保留/成功消费、失效缓存/目标变化与单文件放弃Hook。相关5文件先按核心选择运行9项通过，新增的面板3项通过；最终全套结果在工程门禁记录。增量实际Edge验证真实过滤修改后旧diff和行反馈撤下、历史记录不重新合回；无二次Reviewer或重复未受影响全量验收。

最终npm run check通过：类型、静态检查、格式、重复率及覆盖率通过；108个测试文件/717项通过，1文件/5项平台相关跳过。Statements85.52%、Branches78.81%、Functions86.41%、Lines89.14%；重复行0.35%，未修改门槛。最终网页构建通过，保留原大chunk警告。文档本地链接及最终六图已检查；PR、双平台CI及两级整合按实际状态补记。
