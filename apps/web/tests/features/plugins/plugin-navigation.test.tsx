// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkbenchPlugin } from '@agentdeck/shared';
import { PluginNavigation } from '../../../src/features/plugins/PluginNavigation';
import { useUiPreferences } from '../../../src/ui/ui-preferences';

const plugin = (id: string, name: string, enabled = true): WorkbenchPlugin => ({
  manifest: { id, name, version: '1.0.0', apiVersion: 1, entry: 'index.html', permissions: [], commands: [] },
  builtin: id === 'ssh-console',
  enabled,
});

beforeEach(() => useUiPreferences.setState({ sidebarCollapsed: false, sidebarAutoCollapsed: false }));
afterEach(cleanup);

it('提供插件管理与启用插件入口，SSH优先且没有重复对话入口', () => {
  const open = vi.fn();
  const manage = vi.fn();
  render(
    <PluginNavigation
      plugins={[plugin('notes', '笔记'), plugin('disabled', '禁用插件', false), plugin('ssh-console', 'SSH Console')]}
      selected="ssh-console"
      open={open}
      manage={manage}
    />,
  );
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['插件', 'SSH Console', '笔记']);
  expect(screen.queryByRole('button', { name: '对话' })).toBeNull();
  expect(screen.getByRole('button', { name: 'SSH Console' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: '插件' }));
  fireEvent.click(screen.getByRole('button', { name: 'SSH Console' }));
  expect(manage).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledExactlyOnceWith('ssh-console');
});

it('折叠导航仍能按可访问名称打开插件', () => {
  useUiPreferences.setState({ sidebarCollapsed: true });
  const open = vi.fn();
  render(<PluginNavigation plugins={[plugin('ssh-console', 'SSH Console')]} open={open} manage={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'SSH Console' }));
  expect(open).toHaveBeenCalledExactlyOnceWith('ssh-console');
  expect(screen.getByRole('button', { name: '插件' })).toBeTruthy();
});
