// 按会话注入给 Agent 的工作区指令（不写入工作区文件，避免被同步到服务器）
import type { Workspace } from '@ssh-server/shared';

export function buildInstructions(ws: Workspace): string {
  return [
    `你在操作 SSH 服务器 ${ws.sshHost} 上的目录 ${ws.remoteDir}。本地工作目录是 ${ws.localDir}。`,
    '- 运行、训练、测试、查看数据：使用 remote_exec 工具（mcp__ssh-server__remote_exec），命令在上述服务器目录下执行。',
    '- 查看大文件、目录占用：使用 remote_peek 工具（mcp__ssh-server__remote_peek）。',
    '- 当前版本尚未实现同步：你在本地文件夹中修改的文件不会出现在服务器上，不要假设已同步。',
    '- 不要在本地用 Bash 运行项目代码：本地没有服务器上的环境和数据。',
    '- 长时间任务用 nohup 或 Slurm 提交，再用 remote_exec 查看进度。',
  ].join('\n');
}
