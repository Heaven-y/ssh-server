import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClientMessageSchema } from '../../src/conversation/protocol';
import { WorkspaceInputSchema } from '../../src/projects/workspace';

describe('ClientMessageSchema', () => {
  const send = { type: 'chat.send', agent: 'claude', workspaceId: 'w1', text: '你好', clientTurnId: 'c1' };

  it('接受合法的 chat.send', () => {
    expect(ClientMessageSchema.safeParse(send).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...send, sessionId: 's1', model: 'sonnet' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...send, agent: 'codex', reasoningEffort: 'high' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...send, agent: 'unknown' }).success).toBe(false);
  });

  it('Claude只接受SDK推理档位，Codex保留原生自定义值，省略不覆盖', () => {
    for (const reasoningEffort of ['low', 'medium', 'high', 'xhigh', 'max'])
      expect(ClientMessageSchema.safeParse({ ...send, reasoningEffort }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ ...send, reasoningEffort: 'turbo' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ ...send, agent: 'codex', reasoningEffort: 'custom-native' }).success).toBe(
      true,
    );
    expect(ClientMessageSchema.parse(send)).not.toHaveProperty('reasoningEffort');
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
    dir: path.join(os.tmpdir(), 'agentdeck-fixture', 'demo'),
    server: 'my-server',
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

  it('丢弃已删除的 sync、policy 与旧字段名，而不是整份拒绝', () => {
    const parsed = WorkspaceInputSchema.parse({
      ...base,
      localDir: base.dir,
      sshHost: base.server,
      sync: { mode: 'bisync' },
      policy: { disabledRules: ['privilege'] },
    });
    expect(parsed).toEqual(base);
  });

  it('工作区不承载认证方式与密码，未知字段一律丢弃', () => {
    for (const extra of [{ authMode: 'password' }, { password: 'test-secret' }, { authMode: 'automatic' }])
      expect(WorkspaceInputSchema.parse({ ...base, ...extra })).toEqual(base);
  });
});

it('权限选择携带 CLI 身份，拒绝跨来源、未知模式与额外参数', () => {
  const send = { type: 'chat.send', agent: 'claude', workspaceId: 'w', text: '任务', clientTurnId: 'c' };
  expect(ClientMessageSchema.parse({ ...send, permission: { agent: 'claude', mode: 'auto' } })).toHaveProperty(
    'permission',
    { agent: 'claude', mode: 'auto' },
  );
  expect(ClientMessageSchema.parse(send)).not.toHaveProperty('permission');
  for (const permission of [
    { agent: 'codex', mode: 'full-access' },
    { agent: 'claude', mode: 'unknown' },
    { agent: 'claude', mode: 'auto', allowAll: true },
  ]) {
    expect(ClientMessageSchema.safeParse({ ...send, permission }).success).toBe(false);
  }
});
