// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AppearanceActions } from '../../src/app/TopBar';
import { useUiPreferences } from '../../src/ui/ui-preferences';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
it('顶栏显示明确目标主题文字，切换保存偏好而不卸载其他区域', () => {
  useUiPreferences.setState({ theme: 'light' });
  render(<AppearanceActions />);
  expect(screen.getByRole('button', { name: '切换深色主题' }).textContent).toBe('深色');
  fireEvent.click(screen.getByRole('button', { name: '切换深色主题' }));
  expect(screen.getByRole('button', { name: '切换浅色主题' }).textContent).toBe('浅色');
  expect(JSON.parse(localStorage.getItem('ssh-server.ui.v1')!).theme).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: '切换浅色主题' }));
  expect(useUiPreferences.getState().theme).toBe('light');
});
