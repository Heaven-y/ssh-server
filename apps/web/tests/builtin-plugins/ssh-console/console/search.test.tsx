// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConsoleTerminalSearch } from '../../../../src/builtin-plugins/ssh-console/console/ConsoleTerminalSearch';
afterEach(cleanup);

it('输入即查且清空立即清理匹配，组字期间不搜索，展示实际匹配序号与总量', () => {
  const find = vi.fn(() => true);
  const close = vi.fn();
  render(<ConsoleTerminalSearch find={find} close={close} results={{ index: 1200, total: 1501 }} />);
  const field = screen.getByRole('textbox');
  fireEvent.change(field, { target: { value: 'demo' } });
  expect(find).toHaveBeenLastCalledWith('demo', false, true);
  expect(screen.getByText('1200 / 1501')).toBeTruthy();
  fireEvent.change(field, { target: { value: '' } });
  expect(find).toHaveBeenLastCalledWith('', false, true);
  const calls = find.mock.calls.length;
  fireEvent.compositionStart(field);
  fireEvent.change(field, { target: { value: '中' } });
  expect(find.mock.calls).toHaveLength(calls);
  fireEvent.compositionEnd(field, { data: '中' });
  expect(find).toHaveBeenLastCalledWith('中', false, true);
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});
