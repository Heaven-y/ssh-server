// @vitest-environment jsdom
import { ApiError } from '../../../src/lib/http';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NativeModelSettingsDocument } from '@agentdeck/shared/settings';
import ProductSettingsDialog from '../../../src/features/settings/ProductSettingsDialog';
import { modelSettingsApi } from '../../../src/features/settings/model-settings-api';
import { queryClient } from '../../../src/lib/query-client';

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
  vi.spyOn(modelSettingsApi, 'catalog').mockResolvedValue({
    agent: 'claude',
    models: [],
    entries: [],
    warnings: [],
    discovered: false,
  });
  vi.spyOn(modelSettingsApi, 'refreshCatalog').mockResolvedValue({
    agent: 'claude',
    models: [],
    entries: [],
    warnings: [],
    discovered: true,
  });
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
  expect(secret.placeholder).toBe('••••••••');
  fireEvent.click(screen.getByRole('button', { name: '更换API Key' }));
  expect(globalThis.document.activeElement).toBe(secret);
  fireEvent.change(model, { target: { value: 'custom-model' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('配置已保存');
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

it('AGY 设置列表合并已确认的同名原生别名，选择当前 High 不改写已有值', async () => {
  const label = 'Gemini Example (High)';
  vi.mocked(modelSettingsApi.read).mockResolvedValue({
    ...document,
    agent: 'antigravity',
    fields: [{ key: 'model', label: '默认模型', value: label, group: 'model' }],
  });
  vi.mocked(modelSettingsApi.catalog).mockResolvedValue({
    agent: 'antigravity',
    models: [
      { id: 'gemini-example-high', label },
      { id: 'custom', label, modelId: label },
      { id: 'gemini-example-low', label: 'Gemini Example (Low)' },
    ],
    defaultModel: 'custom',
    entries: [],
    warnings: [],
    discovered: true,
  });
  render(<ProductSettingsDialog initialPage="antigravity" onClose={vi.fn()} onNative={vi.fn()} />);
  const input = await screen.findByLabelText<HTMLInputElement>('默认模型');
  fireEvent.click(await screen.findByRole('button', { name: '展开默认模型选项' }));
  const list = await screen.findByRole('listbox', { name: '默认模型选项' });
  expect(within(list).getAllByRole('option', { name: label })).toHaveLength(1);
  expect(within(list).getByRole('option', { name: 'Gemini Example (Low)' })).toBeTruthy();
  fireEvent.click(within(list).getByRole('option', { name: label }));
  expect(input.value).toBe(label);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存配置' }).disabled).toBe(true);
  expect(modelSettingsApi.save).not.toHaveBeenCalled();
});

it('Codex 登录或环境认证均可直接填写 Key，切换服务商丢弃旧草稿', async () => {
  const providerFields = (value: string, mode: string) => [
    { key: 'baseUrl', label: '服务地址', value, group: 'connection' as const },
    { key: 'authMode', label: '认证方式', value: mode, group: 'connection' as const, advanced: true },
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
      { id: 'first', label: '第一服务', fields: providerFields('https://first.example/v1', 'native') },
      { id: 'second', label: '第二服务', fields: providerFields('https://second.example/v1', 'env') },
    ],
  });
  render(<ProductSettingsDialog initialPage="codex" onClose={vi.fn()} onNative={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText('服务地址'), { target: { value: 'https://draft.example/v1' } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'synthetic-draft-secret' } });
  fireEvent.click(screen.getByLabelText('服务商'));
  fireEvent.click(await screen.findByRole('option', { name: '第二服务' }));
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
  fireEvent.click(screen.getByText('高级设置'));
  for (const name of ['Codex', '关闭设置', '编辑 Claude Code 配置文件', '重新读取配置'])
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

it('缓存模型可直接选择，显式获取先保存修改，参数和高级字段按原生能力呈现', async () => {
  const catalog = {
    agent: 'claude' as const,
    models: [{ id: 'custom-model', label: '自定义模型', reasoningEfforts: ['low', 'high'] }],
    entries: [],
    warnings: [],
    discovered: true,
  };
  vi.mocked(modelSettingsApi.catalog).mockResolvedValue(catalog);
  vi.mocked(modelSettingsApi.refreshCatalog).mockResolvedValue(catalog);
  vi.mocked(modelSettingsApi.read).mockResolvedValue({
    ...document,
    fields: [
      ...document.fields,
      { key: 'reasoningEffort', label: '推理强度', value: '', group: 'model' },
      { key: 'contextWindow', label: '上下文窗口', value: '由模型决定', group: 'model', readOnly: true },
      { key: 'authToken', label: 'Auth Token', value: '', secret: true, group: 'connection', advanced: true },
    ],
  });
  const saveResult = deferred<NativeModelSettingsDocument>();
  vi.mocked(modelSettingsApi.save).mockReturnValue(saveResult.promise);
  render(<ProductSettingsDialog projectId="demo" onClose={vi.fn()} onNative={vi.fn()} />);
  const model = await screen.findByLabelText<HTMLInputElement>('默认模型');
  await screen.findByRole('button', { name: '重新获取' });
  expect(modelSettingsApi.catalog).toHaveBeenCalledWith('claude', 'demo', expect.any(AbortSignal));
  expect(modelSettingsApi.refreshCatalog).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '展开默认模型选项' }));
  const options = await screen.findByRole('listbox', { name: '默认模型选项' });
  fireEvent.click(within(options).getByRole('option', { name: '自定义模型' }));
  expect(model.value).toBe('custom-model');
  expect(screen.getByLabelText<HTMLInputElement>('上下文窗口').readOnly).toBe(true);
  expect(screen.queryByRole('textbox', { name: 'Auth Token' })).toBeNull();
  fireEvent.change(model, { target: { value: 'custom-model' } });
  fireEvent.click(screen.getByRole('button', { name: '展开推理强度选项' }));
  expect(within(await screen.findByRole('listbox', { name: '推理强度选项' })).getAllByRole('option')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '保存并获取模型' }));
  await waitFor(() => expect(modelSettingsApi.save).toHaveBeenCalledOnce());
  expect(modelSettingsApi.refreshCatalog).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存并获取模型' }).disabled).toBe(true);
  await act(async () => saveResult.resolve(saved));
  await waitFor(() => expect(modelSettingsApi.refreshCatalog).toHaveBeenCalledOnce());
  expect(modelSettingsApi.refreshCatalog).toHaveBeenCalledWith('claude', 'demo', expect.any(AbortSignal));
});

it('Codex窗口与压缩阈值分别保存，保存失败时保留草稿且不继续获取模型', async () => {
  vi.mocked(modelSettingsApi.read).mockResolvedValue({
    ...document,
    agent: 'codex',
    fields: [
      ...document.fields,
      { key: 'contextWindow', label: '上下文窗口', value: '128000', group: 'model' },
      { key: 'autoCompactTokenLimit', label: '自动压缩阈值', value: '', group: 'model' },
    ],
  });
  vi.mocked(modelSettingsApi.save).mockRejectedValueOnce(new ApiError(409, '配置已变化'));
  render(<ProductSettingsDialog initialPage="codex" onClose={vi.fn()} onNative={vi.fn()} />);
  const windowSize = await screen.findByRole<HTMLInputElement>('textbox', { name: '上下文窗口' });
  fireEvent.change(windowSize, { target: { value: '1.5M' } });
  const threshold = screen.getByRole<HTMLInputElement>('textbox', { name: '自动压缩阈值' });
  fireEvent.change(threshold, { target: { value: '128K' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并获取模型' }));
  await screen.findByRole('alert');
  expect(modelSettingsApi.refreshCatalog).not.toHaveBeenCalled();
  expect(windowSize.value).toBe('1.5M');
  expect(threshold.value).toBe('128K');
  expect(modelSettingsApi.save).toHaveBeenCalledWith(
    'codex',
    { revision: document.revision, changes: { contextWindow: '1.5M', autoCompactTokenLimit: '128K' } },
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('配置已保存');
  expect(modelSettingsApi.save).toHaveBeenCalledTimes(2);
});
