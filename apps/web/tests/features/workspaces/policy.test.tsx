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
  fireEvent.click(screen.getByRole('button', { name: /高级：自定义拦截/ }));
  fireEvent.click(screen.getByRole('button', { name: '追加规则' }));
  fireEvent.change(screen.getByLabelText('程序名'), { target: { value: '/bin/python' } });
  fireEvent.change(screen.getByLabelText('拒绝原因'), { target: { value: '暂不运行' } });
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  expect(save).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByLabelText('程序名')).toBe(document.activeElement));
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
  fireEvent.click(await screen.findByRole('button', { name: /高级：自定义拦截/ }));
  const pattern = screen.getByLabelText('命令包含的字符串');
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
  fireEvent.click(screen.getByRole('button', { name: /高级：自定义拦截/ }));
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

it('默认规则保持启用，自定义空列表默认折叠且可选，教程不自动追加规则', async () => {
  vi.spyOn(api, 'readWorkspacePolicy').mockResolvedValue(initial);
  const save = vi.spyOn(api, 'saveWorkspacePolicy');
  render(<WorkspacePolicyDialog workspaceId="w1" name="demo" onClose={vi.fn()} />);
  const advanced = await screen.findByRole('button', { name: /高级：自定义拦截/ });
  expect(advanced.getAttribute('aria-expanded')).toBe('false');
  expect(advanced.textContent).toContain('0 条');
  expect(screen.getByText('需要额外限制时，可添加自定义规则。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '追加规则' })).toBeNull();
  expect(screen.getAllByRole<HTMLInputElement>('checkbox').every((item) => item.checked)).toBe(true);
  fireEvent.click(advanced);
  expect(screen.getByText('scancel')).toBeTruthy();
  expect(screen.getByText('--purge-cache')).toBeTruthy();
  expect(screen.getByText(/区分大小写.*字面匹配.*误拦/)).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存规则' }).disabled).toBe(true);
});

it('已有规则给出数量且按需展开；隐藏的无效草稿保存时自动展开并聚焦字段', async () => {
  const rule = { id: 'custom-demo', kind: 'program' as const, pattern: 'scancel', reason: '作业取消由我确认' };
  vi.spyOn(api, 'readWorkspacePolicy').mockResolvedValue({ ...initial, policy: { customRules: [rule] } });
  const save = vi.spyOn(api, 'saveWorkspacePolicy');
  render(<WorkspacePolicyDialog workspaceId="w1" name="demo" onClose={vi.fn()} />);
  const advanced = await screen.findByRole('button', { name: /高级：自定义拦截/ });
  expect(advanced.textContent).toContain('1 条');
  expect(advanced.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('textbox', { name: '程序名' })).toBeNull();
  fireEvent.click(advanced);
  const pattern = screen.getByRole<HTMLInputElement>('textbox', { name: '程序名' });
  expect(pattern.value).toBe('scancel');
  fireEvent.change(pattern, { target: { value: '/bin/scancel' } });
  fireEvent.click(advanced);
  expect(screen.queryByRole('textbox', { name: '程序名' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  await waitFor(() => expect(document.activeElement).toBe(pattern));
  expect(advanced.getAttribute('aria-expanded')).toBe('true');
  expect(pattern.value).toBe('/bin/scancel');
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '拒绝原因' }).value).toBe(rule.reason);
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(pattern, { target: { value: 'squeue' } });
  expect(advanced.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('textbox', { name: '程序名' })).toBe(pattern);
  expect(document.activeElement).toBe(pattern);
});
