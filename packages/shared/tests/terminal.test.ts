import { expect, it } from 'vitest';
import { TerminalClientMessageSchema, TerminalSizeSchema, workspaceTerminalTarget } from '../src/terminal';

it('严格限制行列、控制字段与canonical base64', () => {
  for (const value of [1, 501, 2.5])
    expect(TerminalSizeSchema.safeParse({ cols: value, rows: 24 }).success).toBe(false);
  for (const data of ['', 'YR==', 'YQ=', '%%%=', Buffer.alloc(32769).toString('base64')])
    expect(TerminalClientMessageSchema.safeParse({ type: 'input', data }).success).toBe(false);
  expect(TerminalClientMessageSchema.safeParse({ type: 'input', data: 'YQ==' }).success).toBe(true);
  expect(TerminalClientMessageSchema.safeParse({ type: 'close', extra: true }).success).toBe(false);
});

it('工作区目标默认私钥且仅包含固定身份字段', () => {
  expect(
    workspaceTerminalTarget({
      id: 'w',
      name: '工作区',
      localDir: 'local',
      sshHost: 'my-server',
      remoteDir: '~/projects/demo',
    }),
  ).toEqual({ workspaceId: 'w', sshHost: 'my-server', authMode: 'key', remoteDir: '~/projects/demo' });
});
