// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalSessionGate } from '../../src/app/LocalSessionGate';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('握手成功前不挂载应用、不连接WS；失败可重试且不暴露令牌', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('离线'))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
  vi.stubGlobal('fetch', fetcher);
  const start = vi.fn();
  const app = vi.fn(() => <div>工作区侧栏</div>);
  render(<LocalSessionGate start={start} mountApp={app} />);
  await screen.findByRole('alert');
  expect(start).not.toHaveBeenCalled();
  expect(app).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重试连接' }));
  expect(screen.queryByText('工作区侧栏')).toBeNull();
  finish(new Response(null, { status: 204 }));
  await screen.findByText('工作区侧栏');
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/local-session',
    expect.objectContaining({ method: 'POST', body: '{}', credentials: 'same-origin' }),
  );
  expect(start.mock.invocationCallOrder[0]).toBeLessThan(app.mock.invocationCallOrder[0]!);
});
