import { describe, expect, it } from 'vitest';
import { ManualServerInputSchema, TerminalTargetSchema, WorkspaceInputSchema } from '../src/index';

const workspace = { name: '项目', dir: '/local', server: 'my-server', remoteDir: '~/projects/demo' };
const server = { name: '服务器', hostname: 'example.invalid', username: 'demo' };
describe('集中服务器契约', () => {
  it('工作区不承载认证方式与同步设置，只描述项目目录与服务器绑定', () => {
    expect(WorkspaceInputSchema.parse(workspace)).toEqual(workspace);
    expect(WorkspaceInputSchema.parse({ ...workspace, authMode: 'password' })).toEqual(workspace);
  });
  it('档案必须明确认证方式，密码模式不能保存私钥路径', () => {
    expect(ManualServerInputSchema.safeParse(server).success).toBe(false);
    expect(ManualServerInputSchema.safeParse({ ...server, authMode: 'password' }).success).toBe(true);
    expect(ManualServerInputSchema.safeParse({ ...server, authMode: 'password', keyFile: '/key' }).success).toBe(false);
  });
  it('终端目标只有工作区、服务器引用和目录', () => {
    const target = { workspaceId: 'workspace', sshHost: workspace.server, remoteDir: workspace.remoteDir };
    expect(TerminalTargetSchema.safeParse(target).success).toBe(true);
    expect(TerminalTargetSchema.safeParse({ ...target, authMode: 'key' }).success).toBe(false);
  });
});
