// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type WorkspacePolicyDocument } from '@ssh-server/shared';
import WorkspacePolicyDialog from '../../../src/features/workspaces/WorkspacePolicyDialog';
import { api, ApiError } from '../../../src/lib/api';
import { queryClient } from '../../../src/lib/query-client';

const initial: WorkspacePolicyDocument = { policy: {}, revision: 'a'.repeat(64) };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  vi.restoreAllMocks();
});
it('默认恢复保留自定义，校验错误定位，连续保存单次并发布后刷新', async () => {
  vi.spyOn(api, 'readWorkspacePolicy').mockResolvedValue(initial);
  const pending = deferred<WorkspacePolicyDocument>();
  const save = vi.spyOn(api, 'saveWorkspacePolicy').mockReturnValue(pending.promise);
  const cancel = vi.spyOn(queryClient, 'cancelQueries');
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const close = vi.fn();
  render(<WorkspacePolicyDialog workspaceId="w1" name="demo" onClose={close} />);
  const privilege = await screen.findByRole('checkbox', { name: /禁止提权/ });
  fireEvent.click(privilege);
  fireEvent.click(screen.getByRole('button', { name: '追加规则' }));
  fireEvent.change(screen.getByLabelText('程序名'), { target: { value: '/bin/python' } });
  fireEvent.change(screen.getByLabelText('拒绝原因'), { target: { value: '暂不运行' } });
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  expect(save).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('alert')).toBe(document.activeElement));
  expect(screen.getByLabelText('程序名').getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(screen.getByLabelText('程序名'), { target: { value: 'python' } });
  fireEvent.click(screen.getByRole('button', { name: '恢复默认规则' }));
  expect((privilege as HTMLInputElement).checked).toBe(true);
  const button = screen.getByRole('button', { name: '保存规则' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]![1]).toMatchObject({
    revision: initial.revision,
    policy: { disabledRules: [], customRules: [{ kind: 'program', pattern: 'python', reason: '暂不运行' }] },
  });
  await act(async () => pending.resolve({ policy: save.mock.calls[0]![1].policy, revision: 'b'.repeat(64) }));
  await screen.findByText(/命令规则已保存/);
  expect(cancel).toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭命令规则：demo' }));
  expect(close).toHaveBeenCalledTimes(1);
});
it('409保留草稿，dirty重读须放弃，重读后可删除追加规则', async () => {
  const rule = { id: 'custom-demo', kind: 'contains' as const, pattern: 'old', reason: '拒绝原因示例' };
  vi.spyOn(api, 'readWorkspacePolicy').mockResolvedValue({ ...initial, policy: { customRules: [rule] } });
  vi.spyOn(api, 'saveWorkspacePolicy').mockRejectedValue(new ApiError(409, '工作区配置已变化'));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const close = vi.fn();
  render(<WorkspacePolicyDialog workspaceId="w1" name="demo" onClose={close} />);
  const pattern = await screen.findByLabelText('命令包含的字符串');
  fireEvent.change(pattern, { target: { value: 'draft' } });
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  await screen.findByText('工作区配置已变化');
  expect((pattern as HTMLInputElement).value).toBe('draft');
  fireEvent.click(screen.getByRole('button', { name: '关闭命令规则：demo' }));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  expect((pattern as HTMLInputElement).value).toBe('draft');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('命令包含的字符串').value).toBe('old'));
  fireEvent.click(screen.getByRole('button', { name: '移除规则1' }));
  expect(screen.queryByLabelText('命令包含的字符串')).toBeNull();
});
it('读取失败可重试，卸载后迟到读写结果不能发布旧工作区', async () => {
  const read = vi
    .spyOn(api, 'readWorkspacePolicy')
    .mockRejectedValueOnce(new Error('读取失败'))
    .mockResolvedValue(initial);
  const late = deferred<WorkspacePolicyDocument>();
  const save = vi.spyOn(api, 'saveWorkspacePolicy').mockReturnValue(late.promise);
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const mounted = render(<WorkspacePolicyDialog workspaceId="w1" name="demo" onClose={() => undefined} />);
  await screen.findByText('读取失败');
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /禁止提权/ }));
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  expect(save).toHaveBeenCalledTimes(1);
  mounted.unmount();
  await act(async () => late.resolve({ policy: {}, revision: 'b'.repeat(64) }));
  expect(invalidate).not.toHaveBeenCalled();
  const stale = deferred<WorkspacePolicyDocument>();
  read.mockReturnValue(stale.promise);
  const pending = render(<WorkspacePolicyDialog workspaceId="w2" name="other" onClose={() => undefined} />);
  pending.unmount();
  await act(async () => stale.resolve(initial));
  expect(screen.queryByRole('dialog')).toBeNull();
});
