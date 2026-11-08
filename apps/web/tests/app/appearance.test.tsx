// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SidebarFooter } from '../../src/app/SidebarChrome';
import { useUiPreferences } from '../../src/ui/ui-preferences';
import { AppearanceSettings } from '../../src/features/settings/AppearanceSettings';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
it('侧栏直接打开设置，主题只从设置内切换并保存', () => {
  useUiPreferences.setState({ theme: 'light' });
  const open = vi.fn();
  render(
    <>
      <SidebarFooter collapsed={false} onOpenSettings={open} />
      <AppearanceSettings />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menuitem')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '深色' }));
  expect(JSON.parse(localStorage.getItem('agentdeck.ui.v1')!).theme).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: '浅色' }));
  expect(useUiPreferences.getState().theme).toBe('light');
});
