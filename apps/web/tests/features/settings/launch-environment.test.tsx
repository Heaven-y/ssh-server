// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { ProductSettingsSchema, type LaunchEnvironmentDocument } from '@agentdeck/shared';
import SettingsDialog from '../../../src/features/settings/SettingsDialog';
import { queryClient } from '../../../src/lib/query-client';

const environment: LaunchEnvironmentDocument = {
  agent: 'codex',
  revision: 'a'.repeat(64),
  encryptionAvailable: true,
  note: '仅补充原生配置不能表达的启动变量。',
  variables: [
    { name: 'OPENAI_API_KEY', label: 'API 密钥', sensitive: true, mode: 'set', source: 'configured', hasValue: true },
    {
      name: 'OPENAI_BASE_URL',
      label: '服务地址',
      sensitive: false,
      mode: 'inherit',
      source: 'inherited',
      hasValue: true,
    },
  ],
};
let response: LaunchEnvironmentDocument;
let conflict = false;
let fetchMock: MockInstance<typeof fetch>;
async function openEnvironment() {
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Codex' }));
  fireEvent.click(await screen.findByRole('button', { name: '启动环境与高级认证' }));
  await screen.findByRole('heading', { name: 'CLI 启动环境 · Codex' });
  return screen.findByLabelText('API 密钥模式');
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  response = environment;
  conflict = false;
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input as string;
    if (url === '/api/settings/product')
      return Response.json({ settings: ProductSettingsSchema.parse({}), revision: 'missing' });
    if (url.startsWith('/api/settings/models/'))
      return Response.json({
        agent: url.split('/').at(-1),
        revision: 'missing',
        displayPath: 'settings.json',
        fields: [],
        warnings: [],
      });
    if (url === '/api/settings/environment') return Response.json({ tools: [], checkedAt: 1 });
    if (url.endsWith('/restart')) return new Response(null, { status: 204 });
    if (init?.method === 'PUT' && conflict)
      return Response.json({ message: '启动环境已变化，请重新读取。' }, { status: 409 });
    if (url === '/api/settings/launch-environment/codex') return Response.json(response);
    throw new Error(`未声明的测试接口：${url}`);
  });
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  vi.restoreAllMocks();
});

it('启动环境只显示来源，新值显式保存且保存后清空；重启由单独操作触发', async () => {
  await openEnvironment();
  expect(screen.getByText('工作台设置')).toBeTruthy();
  expect(screen.getByText('继承进程环境')).toBeTruthy();
  const secret = screen.getByLabelText<HTMLInputElement>('API 密钥新值');
  expect(secret.value).toBe('');
  expect(secret.type).toBe('password');
  fireEvent.change(secret, { target: { value: 'synthetic-new-secret' } });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新启动 CLI' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '保存启动环境' }));
  await screen.findByText(/启动环境已保存/);
  const saved = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(saved[1]?.body as string)).toEqual({
    revision: 'a'.repeat(64),
    variables: [{ name: 'OPENAI_API_KEY', mode: 'set', value: 'synthetic-new-secret' }],
  });
  expect(screen.getByLabelText<HTMLInputElement>('API 密钥新值').value).toBe('');
  expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain('synthetic-new-secret');
  expect(fetchMock.mock.calls.some(([url]) => (url as string).endsWith('/restart'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '重新启动 CLI' }));
  await screen.findByText(/下一次发送时将重新启动/);
  expect(fetchMock.mock.calls.filter(([url]) => (url as string).endsWith('/restart'))).toHaveLength(1);
});

it('停用和恢复继承不发送旧密钥；冲突保留新值与未保存保护', async () => {
  await openEnvironment();
  fireEvent.change(screen.getByLabelText('API 密钥模式'), { target: { value: 'disabled' } });
  fireEvent.click(screen.getByRole('button', { name: '保存启动环境' }));
  await screen.findByText(/启动环境已保存/);
  const saved = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(saved[1]?.body as string)).toMatchObject({
    variables: [{ name: 'OPENAI_API_KEY', mode: 'disabled' }],
  });
  conflict = true;
  fireEvent.change(screen.getByLabelText('API 密钥新值'), { target: { value: 'synthetic-retained-draft' } });
  fireEvent.click(screen.getByRole('button', { name: '保存启动环境' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText<HTMLInputElement>('API 密钥新值').value).toBe('synthetic-retained-draft');
  fireEvent.click(screen.getByRole('button', { name: '返回模型设置' }));
  expect(screen.getByRole('heading', { name: 'CLI 启动环境 · Codex' })).toBeTruthy();
  expect(window.confirm).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('API 密钥模式'), { target: { value: 'inherit' } });
  expect(screen.queryByLabelText('API 密钥新值')).toBeNull();
});

it('加密不可用时禁止重填密钥，但允许显式停用该变量', async () => {
  response = { ...environment, encryptionAvailable: false };
  await openEnvironment();
  expect(screen.getByLabelText<HTMLInputElement>('API 密钥新值').disabled).toBe(true);
  expect(
    within(screen.getByLabelText('API 密钥模式')).getByRole<HTMLOptionElement>('option', {
      name: '在工作台中单独设置',
      hidden: true,
    }).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('API 密钥模式'), { target: { value: 'disabled' } });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存启动环境' }).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '保存启动环境' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
});
