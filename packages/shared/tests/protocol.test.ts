import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClientMessageSchema } from '../src/protocol';
import { WorkspaceInputSchema } from '../src/workspace';

describe('ClientMessageSchema', () => {
  const send = { type: 'chat.send', agent: 'claude', workspaceId: 'w1', text: '你好', clientTurnId: 'c1' };

  it('接受合法的 chat.send', () => {
    expect(ClientMessageSchema.safeParse(send).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...send, sessionId: 's1', model: 'sonnet' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...send, agent: 'codex', reasoningEffort: 'high' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...send, agent: 'unknown' }).success).toBe(false);
  });

  it('拒绝未明确指定Agent的chat.send', () => {
    const { agent: _agent, ...withoutAgent } = send;
    expect(ClientMessageSchema.safeParse(withoutAgent).success).toBe(false);
  });

  it('拒绝空消息', () => {
    expect(ClientMessageSchema.safeParse({ ...send, text: '' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ ...send, text: '  ' }).success).toBe(false);
  });

  it('允许仅选择能力，并拒绝客户端指定原生调用路径', () => {
    expect(ClientMessageSchema.safeParse({ ...send, text: '', selection: { id: 'skill-1' } }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...send, text: '', selection: { id: '' } }).success).toBe(false);
    expect(
      ClientMessageSchema.safeParse({ ...send, selection: { id: 'skill-1', path: './arbitrary-skill' } }).success,
    ).toBe(false);
  });

  it('拒绝缺少 workspaceId 的 chat.send', () => {
    const { workspaceId: _omit, ...rest } = send;
    expect(ClientMessageSchema.safeParse(rest).success).toBe(false);
  });

  it('接受带拒绝原因的 permission.respond', () => {
    const msg = { type: 'permission.respond', turnId: 't1', requestId: 'r1', allow: false, message: '不允许' };
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
  const base = {
    name: 'demo',
    localDir: path.join(os.tmpdir(), 'ssh-server-fixture', 'demo'),
    sshHost: 'my-server',
    remoteDir: '~/projects/demo',
  };

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

  it('拒绝工作区认证方式和密码字段', () => {
    expect(WorkspaceInputSchema.safeParse({ ...base, authMode: 'password' }).success).toBe(false);
    expect(WorkspaceInputSchema.safeParse({ ...base, password: 'test-secret' }).success).toBe(false);
  });

  it('拒绝旧认证字段，无认证字段的工作区正常解析', () => {
    expect(WorkspaceInputSchema.safeParse({ ...base, authMode: 'automatic' }).success).toBe(false);
    expect(WorkspaceInputSchema.safeParse(base).success).toBe(true);
  });
});
