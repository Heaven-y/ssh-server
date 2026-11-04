// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TopBar } from '../../src/app/TopBar';

afterEach(cleanup);
it('搜索与操作只有一个明确按钮入口，点击交给原命令面板流程', () => {
  const open = vi.fn();
  render(
    <TopBar
      onOpenSettings={vi.fn()}
      onOpenServers={vi.fn()}
      onOpenTerminal={vi.fn()}
      terminalOpen={false}
      onOpenCommands={open}
    />,
  );
  const entries = screen.getAllByRole('button', { name: '搜索与操作' });
  expect(entries).toHaveLength(1);
  expect(entries[0]!.getAttribute('title')).toContain('Ctrl+K / Cmd+K');
  fireEvent.click(entries[0]!);
  expect(open).toHaveBeenCalledTimes(1);
});

it('顶栏只保留项目、搜索、终端、服务器、设置与外观，不再有资源与文件入口', () => {
  render(
    <TopBar
      workspace={{ id: 'p1', name: '示例项目', dir: 'E:\\web\\demo' }}
      onOpenSettings={vi.fn()}
      onOpenServers={vi.fn()}
      onOpenTerminal={vi.fn()}
      terminalOpen={false}
      onOpenCommands={vi.fn()}
    />,
  );
  expect(screen.getByText('E:\\web\\demo')).toBeTruthy();
  for (const name of ['终端', '服务器', '设置', '搜索与操作'])
    expect(screen.getByRole('button', { name })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '资源' })).toBeNull();
  expect(screen.queryByRole('button', { name: '文件' })).toBeNull();
});
