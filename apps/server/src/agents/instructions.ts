// 按会话注入给 Agent 的工作区指令（不写入工作区文件，避免被同步到服务器）
import type { Workspace } from '@ssh-server/shared';

export function buildInstructions(ws: Workspace): string {
  return [
    `你在操作 SSH 服务器 ${ws.sshHost} 上的目录 ${ws.remoteDir}。本地工作目录是 ${ws.localDir}。`,
    '- 运行、训练、测试、查看数据：使用 remote_exec 工具（mcp__ssh-server__remote_exec），命令在上述服务器目录下执行。',
    '- 查看大文件、目录占用：使用 remote_peek 工具（mcp__ssh-server__remote_peek）。',
    '- 编辑代码使用本地文件工具；remote_exec 执行前同步代码与小文件，执行后再拉取小结果。同步失败、删除待确认或冲突未处理会阻断执行。',
    '- 需要主动同步时使用 sync_now（mcp__ssh-server__sync_now）；轮次结束也会同步，但不会自动发起新轮次或分析。',
    '- 大数据、模型权重和超过工作区阈值的文件留在服务器；.git 不同步。不要把依赖安装、凭据或 AI 会话上传到服务器。',
    '- 不要在本地用 Bash 运行项目代码：本地没有服务器上的环境和数据。分析优先使用服务器已有的 Python 与依赖；缺少依赖时说明情况。',
    '- 长时间任务用 nohup 或 Slurm 提交。只有用户发消息要求查看进度或分析结果时才检查；不要自动监测完成或继续分析。',
  ].join('\n');
}
