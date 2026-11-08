// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PermissionOptionsMenu } from '../../../src/features/chat/PermissionOptionsMenu';
import { useChat } from '../../../src/features/chat/chat-store';

afterEach(cleanup);
it.each([
  ['claude', '自动审查', 'auto'],
  ['codex', '帮我批准', 'auto-review'],
  ['antigravity', '自动模式', 'auto'],
] as const)('%s 菜单选择写入对应原生模式且可回到原生配置', async (agent, label, mode) => {
  useChat.setState(useChat.getInitialState(), true);
  useChat.getState().newSession(agent);
  const { rerender } = render(<PermissionOptionsMenu disabled={false} />);
  const trigger = screen.getByRole('button', { name: '权限模式' });
  expect(trigger.textContent).toBe('');
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('menuitemradio', { name: new RegExp('^' + label) }));
  expect(useChat.getState().permission).toEqual({ agent, mode });
  expect(trigger.textContent).toContain(label);
  rerender(<PermissionOptionsMenu disabled />);
  expect((trigger as HTMLButtonElement).disabled).toBe(true);
  rerender(<PermissionOptionsMenu disabled={false} />);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('menuitem', { name: '重置权限' }));
  expect(useChat.getState().permission).toEqual(agent === 'codex' ? { agent: 'codex', mode: 'native' } : undefined);
});
