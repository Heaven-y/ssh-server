// 按会话注入给 Agent 的项目指令（不写入工作区文件）
import type { Workspace } from '@agentdeck/shared';

export function buildInstructions(ws: Workspace): string {
  return [
    `当前工作在本地项目目录 ${ws.dir}。`,
    '- 代码、测试、脚本都在本机这个目录里读写；不涉及任何远程服务器。',
    '- 需要运行命令时直接用本机的 Bash。',
  ].join('\n');
}
