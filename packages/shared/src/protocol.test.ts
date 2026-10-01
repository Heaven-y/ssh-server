import { describe, expect, it } from 'vitest';
import { ClientMessageSchema } from './protocol';
import { WorkspaceInputSchema } from './workspace';

describe('ClientMessageSchema', () => {
  const send = { type: 'chat.send', workspaceId: 'w1', text: '你好', clientTurnId: 'c1' };

  it('接受合法的 chat.send', () => {
    expect(ClientMessageSchema.safeParse(send).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...send, sessionId: 's1', model: 'sonnet' }).success).toBe(true);
  });

  it('拒绝空消息', () => {
    expect(ClientMessageSchema.safeParse({ ...send, text: '' }).success).toBe(false);
  });

  it('拒绝缺少 workspaceId 的 chat.send', () => {
    const { workspaceId: _omit, ...rest } = send;
    expect(ClientMessageSchema.safeParse(rest).success).toBe(false);
  });

  it('接受带拒绝原因的 permission.respond', () => {
    const msg = { type: 'permission.respond', requestId: 'r1', allow: false, message: '不允许' };
    expect(ClientMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('接受 chat.interrupt', () => {
    expect(ClientMessageSchema.safeParse({ type: 'chat.interrupt', turnId: 't1' }).success).toBe(true);
  });

  it('拒绝未知类型', () => {
    expect(ClientMessageSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });
});

describe('WorkspaceInputSchema', () => {
  const base = { name: 'demo', localDir: 'D:/work/demo', sshHost: 'my-server', remoteDir: '~/projects/demo' };

  it('接受以 ~ 或 / 开头的服务器目录，允许空格和中文', () => {
    expect(WorkspaceInputSchema.safeParse(base).success).toBe(true);
    expect(WorkspaceInputSchema.safeParse({ ...base, remoteDir: '/data/项目 a' }).success).toBe(true);
  });

  it('拒绝相对路径和含换行的服务器目录', () => {
    expect(WorkspaceInputSchema.safeParse({ ...base, remoteDir: 'projects' }).success).toBe(false);
    expect(WorkspaceInputSchema.safeParse({ ...base, remoteDir: '~/a\nb' }).success).toBe(false);
  });

  it('接受停用的规则列表', () => {
    const r = WorkspaceInputSchema.safeParse({ ...base, policy: { disabledRules: ['privilege'] } });
    expect(r.success).toBe(true);
  });
});
