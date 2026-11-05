// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NativeModelSettingsDocument } from '@agentdeck/shared';
import ProductSettingsDialog from '../../../src/features/settings/ProductSettingsDialog';
import { modelSettingsApi } from '../../../src/features/settings/model-settings-api';
import { queryClient } from '../../../src/lib/query-client';
import { ApiError } from '../../../src/lib/api';

const document: NativeModelSettingsDocument = {
  agent: 'claude',
  revision: 'a'.repeat(64),
  displayPath: '~/.claude/settings.json',
  warnings: [],
  fields: [
    { key: 'model', label: '默认模型', value: 'sonnet', group: 'model' },
    { key: 'baseUrl', label: '服务地址', value: '', group: 'connection' },
    { key: 'apiKey', label: 'API Key', value: '', secret: true, hasValue: true, group: 'connection' },
  ],
};
const saved = { ...document, revision: 'b'.repeat(64) };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(modelSettingsApi, 'read').mockResolvedValue(document);
  vi.spyOn(modelSettingsApi, 'save').mockResolvedValue(saved);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  vi.restoreAllMocks();
});

it('常用模型表单只发送修改字段，空密码保留且显式清除使用 null', async () => {
  render(<ProductSettingsDialog onClose={vi.fn()} onNative={vi.fn()} />);
  const model = await screen.findByLabelText('默认模型');
  const secret = screen.getByLabelText<HTMLInputElement>('API Key');
  expect(secret.type).toBe('password');
  expect(secret.value).toBe('');
  fireEvent.change(model, { target: { value: 'custom-model' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText(/已保存到原生配置/);
  expect(modelSettingsApi.save).toHaveBeenLastCalledWith(
    'claude',
    { revision: document.revision, changes: { model: 'custom-model' } },
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: '清除API Key' }));
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(modelSettingsApi.save).toHaveBeenCalledTimes(2));
  expect(modelSettingsApi.save).toHaveBeenLastCalledWith(
    'claude',
    { revision: saved.revision, changes: { apiKey: null } },
    expect.any(AbortSignal),
  );
});

it('切换 Codex 服务商丢弃前一个服务商未保存的地址与密钥', async () => {
  const providerFields = (value: string) => [
    { key: 'baseUrl', label: '服务地址', value, group: 'connection' as const },
    { key: 'apiKey', label: 'API Key', value: '', secret: true, hasValue: true, group: 'connection' as const },
  ];
  vi.mocked(modelSettingsApi.read).mockResolvedValue({
    ...document,
    agent: 'codex',
    fields: [
      document.fields[0]!,
      {
        key: 'provider',
        label: '服务商',
        value: 'first',
        group: 'connection',
        options: [
          { value: 'first', label: '第一服务' },
          { value: 'second', label: '第二服务' },
        ],
      },
    ],
    providers: [
      { id: 'first', label: '第一服务', fields: providerFields('https://first.example/v1') },
      { id: 'second', label: '第二服务', fields: providerFields('https://second.example/v1') },
    ],
  });
  render(<ProductSettingsDialog initialPage="codex" onClose={vi.fn()} onNative={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText('服务地址'), { target: { value: 'https://draft.example/v1' } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'synthetic-draft-secret' } });
  fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'second' } });
  expect(screen.getByLabelText<HTMLInputElement>('服务地址').value).toBe('https://second.example/v1');
  expect(screen.getByLabelText<HTMLInputElement>('API Key').value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(modelSettingsApi.save).toHaveBeenCalled());
  expect(modelSettingsApi.save).toHaveBeenLastCalledWith(
    'codex',
    { revision: document.revision, changes: { provider: 'second' } },
    expect.any(AbortSignal),
  );
  expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain('synthetic-draft-secret');
});

it('冲突保留草稿，侧栏、关闭、原始配置和重读共用未保存保护', async () => {
  vi.mocked(modelSettingsApi.save).mockRejectedValue(new ApiError(409, '原生文件已变化'));
  const close = vi.fn();
  const native = vi.fn();
  render(<ProductSettingsDialog onClose={close} onNative={native} />);
  fireEvent.change(await screen.findByLabelText('API Key'), { target: { value: 'synthetic-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByRole('alert');
  for (const name of ['Codex', '关闭设置', '修改 Claude Code 原始配置', '重新读取'])
    fireEvent.click(screen.getByRole('button', { name }));
  expect(window.confirm).toHaveBeenCalledTimes(4);
  expect(close).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
  expect(screen.getByLabelText<HTMLInputElement>('API Key').value).toBe('synthetic-secret');
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
  await waitFor(() => expect(modelSettingsApi.read).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText<HTMLInputElement>('API Key').value).toBe('');
});

it('离开 CLI 后取消读取，迟到结果不能覆盖新分类', async () => {
  const late = deferred<NativeModelSettingsDocument>();
  vi.mocked(modelSettingsApi.read)
    .mockReturnValueOnce(late.promise)
    .mockResolvedValue({
      ...document,
      agent: 'codex',
      fields: [{ ...document.fields[0]!, value: 'codex-model' }],
    });
  render(<ProductSettingsDialog onClose={vi.fn()} onNative={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
  await screen.findByDisplayValue('codex-model');
  expect(vi.mocked(modelSettingsApi.read).mock.calls[0]![1]?.aborted).toBe(true);
  await act(async () => {
    late.resolve(document);
  });
  expect(screen.getByLabelText<HTMLInputElement>('默认模型').value).toBe('codex-model');
});
