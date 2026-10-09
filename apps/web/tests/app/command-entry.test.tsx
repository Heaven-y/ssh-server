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
      onOpenFiles={vi.fn()}
      filesOpen={false}
      onOpenResources={vi.fn()}
      resourcesOpen={false}
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
