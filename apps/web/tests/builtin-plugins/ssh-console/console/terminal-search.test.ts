// @vitest-environment jsdom
import { afterAll, expect, it, vi } from 'vitest';
import type { Terminal as Xterm } from '@xterm/xterm';
import { countTerminalMatches } from '../../../../src/builtin-plugins/ssh-console/console/terminal-search';

// 只执行真实解析器与缓冲，不启动画布渲染。
const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
const { Terminal } = await import('@xterm/xterm');
afterAll(() => canvas.mockRestore());
const write = (terminal: Xterm, text: string) => new Promise<void>((resolve) => terminal.write(text, resolve));
it('按真实终端缓冲统计跨行中文命中，序号使用字符列映射', async () => {
  const terminal = new Terminal({ cols: 6, rows: 5, allowProposedApi: true });
  try {
    await write(terminal, '中ab中Z\r\n中Z');
    expect(countTerminalMatches(terminal.buffer.active, '中Z', { start: { x: 4, y: 0 }, end: { x: 1, y: 1 } })).toEqual(
      { total: 2, index: 1 },
    );
    expect(countTerminalMatches(terminal.buffer.active, '中Z', { start: { x: 0, y: 2 }, end: { x: 3, y: 2 } })).toEqual(
      { total: 2, index: 2 },
    );
  } finally {
    terminal.dispose();
  }
});
it('命中数量超过装饰上限仍完整，回滚中重叠匹配和清空不误报', async () => {
  const terminal = new Terminal({ cols: 20, rows: 5, scrollback: 5000, allowProposedApi: true });
  try {
    await write(terminal, 'demo\r\n'.repeat(1501) + 'aaa');
    expect(
      countTerminalMatches(terminal.buffer.active, 'DEMO', { start: { x: 0, y: 1199 }, end: { x: 4, y: 1199 } }),
    ).toEqual({ total: 1501, index: 1200 });
    expect(countTerminalMatches(terminal.buffer.active, 'aa')).toEqual({ total: 2, index: 0 });
    expect(countTerminalMatches(terminal.buffer.active, '')).toEqual({ total: 0, index: 0 });
  } finally {
    terminal.dispose();
  }
});
