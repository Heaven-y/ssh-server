import { describe, expect, it } from 'vitest';
import { isBoundWorkspace, WorkspaceInputSchema, WorkspaceSchema } from '../src/workspace';

describe('WorkspaceInputSchema', () => {
  it('接受只有名称和目录的最小工作区', () => {
    const parsed = WorkspaceInputSchema.parse({ name: '示例项目', dir: 'E:\\web\\demo' });
    expect(parsed).toEqual({ name: '示例项目', dir: 'E:\\web\\demo' });
  });

  it('接受可选的服务器绑定', () => {
    const parsed = WorkspaceInputSchema.parse({
      name: '示例项目',
      dir: '/home/dev/demo',
      server: 'my-server',
      remoteDir: '~/projects/demo',
    });
    expect(parsed.server).toBe('my-server');
    expect(parsed.remoteDir).toBe('~/projects/demo');
  });

  it('拒绝空名称与空目录', () => {
    expect(WorkspaceInputSchema.safeParse({ name: '  ', dir: '/tmp' }).success).toBe(false);
    expect(WorkspaceInputSchema.safeParse({ name: 'x', dir: '' }).success).toBe(false);
  });

  it('丢弃旧格式的 sync、policy、sshHost、localDir 字段', () => {
    const parsed = WorkspaceInputSchema.parse({
      name: '旧项目',
      dir: '/tmp/demo',
      sshHost: 'my-server',
      localDir: '/tmp/demo',
      sync: { mode: 'bisync' },
      policy: { disabledRules: ['privilege'] },
    });
    expect(parsed).toEqual({ name: '旧项目', dir: '/tmp/demo' });
  });

  it('拒绝不合法的服务器目录，接受以 ~ 或 / 开头的目录', () => {
    const base = { name: '示例项目', dir: '/tmp/demo', server: 'my-server' };
    expect(WorkspaceInputSchema.safeParse({ ...base, remoteDir: 'projects' }).success).toBe(false);
    expect(WorkspaceInputSchema.safeParse({ ...base, remoteDir: '~/a\nb' }).success).toBe(false);
    expect(WorkspaceInputSchema.safeParse({ ...base, remoteDir: '/data/项目 a' }).success).toBe(true);
  });
});

describe('WorkspaceSchema', () => {
  it('要求 id 非空', () => {
    expect(WorkspaceSchema.safeParse({ id: '', name: '示例项目', dir: '/tmp/demo' }).success).toBe(false);
    expect(WorkspaceSchema.parse({ id: 'w1', name: '示例项目', dir: '/tmp/demo' }).id).toBe('w1');
  });
});

describe('isBoundWorkspace', () => {
  it('同时有服务器与默认目录才可打开服务器面板', () => {
    expect(isBoundWorkspace({ id: 'w1', name: '示例项目', dir: '/tmp/demo' })).toBe(false);
    expect(isBoundWorkspace({ id: 'w1', name: '示例项目', dir: '/tmp/demo', server: 'my-server' })).toBe(false);
    expect(
      isBoundWorkspace({ id: 'w1', name: '示例项目', dir: '/tmp/demo', server: 'my-server', remoteDir: '~/demo' }),
    ).toBe(true);
  });
});
