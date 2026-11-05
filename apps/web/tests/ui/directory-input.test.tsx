// @vitest-environment jsdom
import path from 'node:path';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectoryInput } from '../../src/ui/DirectoryInput';

const initial = path.resolve('fixtures', 'initial');
const chosen = path.resolve('fixtures', 'chosen');
const replacement = path.resolve('fixtures', 'replacement');
afterEach(() => {
  cleanup();
  delete window.agentDeck;
});

function StatefulDirectory() {
  const [value, setValue] = useState(initial);
  return <DirectoryInput id="directory" value={value} onChange={setValue} />;
}

it('浏览器环境保留路径输入，不展示无法实现的系统选择按钮', () => {
  render(<StatefulDirectory />);
  expect(screen.queryByRole('button', { name: '选择文件夹' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: chosen } });
  expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe(chosen);
});

it('原生选择填入目录，取消保留路径；失败提示后能再次选择', async () => {
  const selectDirectory = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('native failure'));
  selectDirectory.mockResolvedValueOnce(chosen);
  window.agentDeck = { platform: process.platform, selectDirectory };
  render(<StatefulDirectory />);
  const choose = () => fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
  choose();
  await waitFor(() => expect(screen.queryByRole('button', { name: '选择中…' })).toBeNull());
  expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe(initial);
  choose();
  await screen.findByRole('alert');
  expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe(initial);
  choose();
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe(chosen));
  expect(selectDirectory).toHaveBeenNthCalledWith(1, initial);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('待选时不重复请求；路径或禁用状态变化后丢弃旧结果并允许重试', async () => {
  let resolve!: (result: string | null) => void;
  const selectDirectory = vi.fn(
    () =>
      new Promise<string | null>((done) => {
        resolve = done;
      }),
  );
  window.agentDeck = { platform: process.platform, selectDirectory };
  const change = vi.fn();
  const view = render(<DirectoryInput id="directory" value={initial} onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
  fireEvent.click(screen.getByRole('button', { name: '选择中…' }));
  expect(selectDirectory).toHaveBeenCalledTimes(1);
  view.rerender(<DirectoryInput id="directory" value={replacement} onChange={change} />);
  await act(async () => resolve(chosen));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
  view.rerender(<DirectoryInput id="directory" value={replacement} onChange={change} disabled />);
  await act(async () => resolve(chosen));
  expect(change).not.toHaveBeenCalled();
  view.rerender(<DirectoryInput id="directory" value={replacement} onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
  await act(async () => resolve(chosen));
  expect(change).toHaveBeenCalledWith(chosen);
});

it('组件卸载后返回的目录不会更新项目草稿', async () => {
  let resolve!: (result: string | null) => void;
  window.agentDeck = {
    platform: process.platform,
    selectDirectory: () =>
      new Promise((done) => {
        resolve = done;
      }),
  };
  const change = vi.fn();
  const view = render(<DirectoryInput id="directory" value={initial} onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
  view.unmount();
  await act(async () => resolve(chosen));
  expect(change).not.toHaveBeenCalled();
});
