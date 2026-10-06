// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteDownloadDialog } from '../../../src/features/remote-files/RemoteDownloadDialog';

const session = { id: 'session', workspaceId: 'workspace', sshHost: 'my-server', root: '/project', home: '/home/demo' };
const entry = {
  name: '结果.txt',
  path: '/project/结果.txt',
  type: 'file' as const,
  size: 3,
  scope: 'excluded' as const,
};
const setup = () =>
  render(<RemoteDownloadDialog workspaceId="workspace" session={session} entry={entry} close={vi.fn()} />);
function setPicker(value: unknown) {
  Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, writable: true, value });
}
function fileHandle() {
  const writable = {
    write: vi.fn(async (_data: Uint8Array) => undefined),
    close: vi.fn(async (): Promise<void> => undefined),
    abort: vi.fn(async () => undefined),
  };
  return { writable, handle: { createWritable: vi.fn(async () => writable) } };
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  setPicker(undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
});
afterEach(() => {
  cleanup();
  setPicker(undefined);
  vi.unstubAllGlobals();
});

describe('服务器文件下载的唯一保存路径', () => {
  it('没有文件保存能力时明确不可用，不提供另一下载入口或请求正文', () => {
    setup();
    expect(screen.getByRole('alert').textContent).toContain('文件保存');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: '选择保存位置并下载' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('取消选择保存位置不开始下载', async () => {
    setPicker(
      vi.fn(async () => {
        throw new DOMException('cancelled', 'AbortError');
      }),
    );
    setup();
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并下载' }));
    expect((await screen.findByRole('alert')).textContent).toContain('取消');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('流式写入并关闭成功后才确认保存，不重复提交', async () => {
    const { writable, handle } = fileHandle();
    let finish!: () => void;
    writable.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const picker = vi.fn(async () => handle);
    setPicker(picker);
    setup();
    const button = screen.getByRole('button', { name: '选择保存位置并下载' });
    fireEvent.click(button);
    await waitFor(() => expect(writable.close).toHaveBeenCalledOnce());
    fireEvent.click(button);
    expect(picker).toHaveBeenCalledOnce();
    expect(picker).toHaveBeenCalledWith({ suggestedName: '结果.txt' });
    expect(writable.write).toHaveBeenCalledOnce();
    expect(Array.from(writable.write.mock.calls[0]![0])).toEqual([1, 2, 3]);
    expect(screen.getByRole('status').textContent).toContain('3 字节');
    expect(screen.queryByText(/下载流已写入并关闭/)).toBeNull();
    await act(async () => finish());
    expect((await screen.findByRole('status')).textContent).toContain('下载流已写入并关闭');
    expect(writable.abort).not.toHaveBeenCalled();
  });

  it('文件关闭期间取消，迟到的关闭完成不能标为下载成功', async () => {
    const { writable, handle } = fileHandle();
    let finish!: () => void;
    writable.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    setPicker(vi.fn(async () => handle));
    setup();
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并下载' }));
    await waitFor(() => expect(writable.close).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '取消下载' }));
    await act(async () => finish());
    expect((await screen.findByRole('alert')).textContent).toContain('取消');
    expect(screen.queryByRole('status')).toBeNull();
    expect(writable.abort).not.toHaveBeenCalled();
  });

  it('写入失败会中止流，不声称完整保存', async () => {
    const { writable, handle } = fileHandle();
    writable.write.mockRejectedValueOnce(new Error('磁盘写入失败'));
    setPicker(vi.fn(async () => handle));
    setup();
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并下载' }));
    expect((await screen.findByRole('alert')).textContent).toContain('磁盘写入失败');
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(writable.close).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('传输中取消会中止请求和写入，不显示完成', async () => {
    const { writable, handle } = fileHandle();
    setPicker(vi.fn(async () => handle));
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), {
            once: true,
          });
        }),
    );
    setup();
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并下载' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '取消下载' }));
    expect((await screen.findByRole('alert')).textContent).toContain('取消');
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(writable.close).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('选择器尚未返回时关闭面板，迟到结果不能创建文件或开始请求', async () => {
    const { handle } = fileHandle();
    let select!: (value: typeof handle) => void;
    setPicker(
      vi.fn(
        () =>
          new Promise<typeof handle>((resolve) => {
            select = resolve;
          }),
      ),
    );
    const view = setup();
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并下载' }));
    view.unmount();
    await act(async () => select(handle));
    expect(handle.createWritable).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
