// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SidebarFooter } from '../../src/app/SidebarChrome';
import { useUiPreferences } from '../../src/ui/ui-preferences';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
it('侧栏底部菜单显示明确目标主题，切换后保存偏好', async () => {
  useUiPreferences.setState({ theme: 'light' });
  render(<SidebarFooter collapsed={false} />);
  fireEvent.click(screen.getByRole('button', { name: '设置与外观' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '切换为深色模式' }));
  expect(JSON.parse(localStorage.getItem('agentdeck.ui.v1')!).theme).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: '设置与外观' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '切换为浅色模式' }));
  expect(useUiPreferences.getState().theme).toBe('light');
});
