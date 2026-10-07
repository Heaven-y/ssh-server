// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SyncSettingsSchema,
  ProductSettingsSchema,
  type WorkspaceSetupVerification,
  type WorkspaceSetupResult,
  type WorkspaceInput,
} from '@ssh-server/shared';
import { api, queryKeys } from '../../../src/lib/api';
import { useWorkspaceSetup } from '../../../src/features/workspaces/setup/use-workspace-setup';
import { useCancelableRequest } from '../../../src/features/workspaces/setup/use-cancelable-request';

const input: WorkspaceInput = {
  name: '演示',
  localDir: 'fixture-project',
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const ticket: WorkspaceSetupVerification = {
  verification: '00000000-0000-4000-8000-000000000000',
  expiresAt: Date.now() + 300000,
  local: { path: input.localDir, empty: false, git: false },
  remote: { path: input.remoteDir, empty: false, git: false },
  target: { sshHost: 'my-server', authMode: 'key' },
};
const created: WorkspaceSetupResult = {
  workspace: { ...input, id: 'fixture' },
  sync: { phase: 'ready', settings: SyncSettingsSchema.parse({}), deletions: [], conflicts: [] },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const clients: QueryClient[] = [];
function setup(seedDefaults = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  if (seedDefaults)
    client.setQueryData(queryKeys.productSettings, { settings: ProductSettingsSchema.parse({}), revision: 'missing' });
  const callbacks = { onCreated: vi.fn(), onCancel: vi.fn(), onBusyChange: vi.fn() };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </StrictMode>
  );
  const hook = renderHook(() => useWorkspaceSetup(callbacks), { wrapper });
  return { ...hook, client, callbacks };
}
beforeEach(() => {
  vi.spyOn(api, 'readProductSettings').mockResolvedValue({
    settings: ProductSettingsSchema.parse({}),
    revision: 'missing',
  });
  vi.spyOn(api, 'revokeWorkspaceVerification').mockResolvedValue({ revoked: true });
  vi.spyOn(api, 'verifyWorkspace').mockResolvedValue({ ...ticket, expiresAt: Date.now() + 300000 });
  vi.spyOn(api, 'createVerifiedWorkspace').mockResolvedValue(created);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe('向导Hook的生命周期', () => {
  it('只选择服务器档案就能继续，工作区草稿与验证请求不携带认证字段', async () => {
    const f = setup();
    expect(f.result.current.input).not.toHaveProperty('authMode');
    act(() => f.result.current.change(input));
    act(() => f.result.current.navigate(1));
    act(() => f.result.current.navigate(2));
    expect(f.result.current.step).toBe(2);
    await act(() => f.result.current.verify());
    expect(vi.mocked(api.verifyWorkspace).mock.calls[0]?.[0]).not.toHaveProperty('authMode');
  });
  it('没有可用默认快照时失败阻止验证，重读复制一次后全局刷新不覆盖草稿', async () => {
    vi.mocked(api.readProductSettings).mockRejectedValueOnce(new Error('偏好读取失败'));
    const f = setup(false);
    await waitFor(() => expect(f.result.current.defaultsError?.message).toBe('偏好读取失败'));
    act(() => f.result.current.change(input));
    await act(() => f.result.current.verify());
    expect(api.verifyWorkspace).not.toHaveBeenCalled();
    await act(async () => {
      await f.result.current.retryDefaults();
    });
    await waitFor(() => expect(f.result.current.defaultsReady).toBe(true));
    const edited = SyncSettingsSchema.parse({ maxFileBytes: 1024 });
    act(() => f.result.current.change({ sync: edited }));
    act(() => {
      f.client.setQueryData(queryKeys.productSettings, {
        settings: ProductSettingsSchema.parse({ syncDefaults: { maxFileBytes: 2048 } }),
        revision: 'a'.repeat(64),
      });
    });
    expect(f.result.current.input.sync).toEqual(edited);
    await act(() => f.result.current.verify());
    expect(api.verifyWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ sync: edited }),
      expect.any(AbortSignal),
    );
  });
  it('步骤校验、未应用规则、返回撤票及取消均执行各自边界', async () => {
    const f = setup();
    act(() => f.result.current.navigate(1));
    expect(f.result.current.message).toContain('名称');
    act(() => f.result.current.change(input));
    act(() => f.result.current.navigate(1));
    act(() => f.result.current.change({ sshHost: '' }));
    act(() => f.result.current.navigate(2));
    expect(f.result.current.message).toContain('选择');
    act(() => f.result.current.change({ sshHost: input.sshHost }));
    act(() => f.result.current.navigate(2));
    act(() => f.result.current.change({ remoteDir: 'invalid' }));
    act(() => f.result.current.navigate(3));
    expect(f.result.current.message).toContain('服务器目录');
    act(() => f.result.current.change({ remoteDir: input.remoteDir }));
    act(() => f.result.current.navigate(3));
    act(() => f.result.current.setSyncDirty(true));
    act(() => f.result.current.navigate(4));
    expect(f.result.current.message).toContain('应用');
    act(() => f.result.current.navigate(2));
    expect(f.result.current.syncDirty).toBe(false);
    await act(() => f.result.current.verify());
    expect(f.result.current.ticket).toBeTruthy();
    act(() => f.result.current.navigate(1));
    expect(f.result.current.ticket).toBeUndefined();
    expect(api.revokeWorkspaceVerification).toHaveBeenCalled();
    act(() => f.result.current.cancel());
    expect(f.callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(f.result.current.input).not.toHaveProperty('authMode');
  });
  it('预览和验证的迟到响应不能复活修改后的草稿，迟到票主动撤销', async () => {
    const f = setup();
    act(() => f.result.current.change(input));
    const preview = deferred<Awaited<ReturnType<typeof api.previewWorkspace>>>();
    vi.spyOn(api, 'previewWorkspace').mockReturnValueOnce(preview.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = f.result.current.previewFiles();
    });
    act(() => f.result.current.change({ name: '新的草稿' }));
    await act(async () => {
      preview.resolve({
        local: { included: { files: 999, bytes: 0 }, excluded: { files: 0, bytes: 0, examples: [] } },
        remote: { included: { files: 0, bytes: 0 }, excluded: { files: 0, bytes: 0, examples: [] } },
        sampledAt: 1,
      });
      await pending;
    });
    expect(f.result.current.preview).toBeUndefined();
    const verification = deferred<WorkspaceSetupVerification>();
    vi.mocked(api.verifyWorkspace).mockReturnValueOnce(verification.promise);
    act(() => {
      pending = f.result.current.verify();
    });
    act(() => f.result.current.change({ name: '下一份草稿' }));
    await act(async () => {
      verification.resolve(ticket);
      await pending;
    });
    expect(f.result.current.ticket).toBeUndefined();
    expect(api.revokeWorkspaceVerification).toHaveBeenCalledWith(ticket.verification);
  });
  it('无票或未确认不创建，提交中不能关闭，成功刷新列表后明确打开', async () => {
    const f = setup();
    const done = deferred<WorkspaceSetupResult>();
    vi.mocked(api.createVerifiedWorkspace).mockReturnValueOnce(done.promise);
    const invalidation = vi.spyOn(f.client, 'invalidateQueries');
    act(() => f.result.current.change(input));
    act(() => f.result.current.submit());
    expect(api.createVerifiedWorkspace).not.toHaveBeenCalled();
    await act(() => f.result.current.verify());
    act(() => f.result.current.submit());
    expect(api.createVerifiedWorkspace).not.toHaveBeenCalled();
    act(() => f.result.current.setConfirmed(true));
    act(() => f.result.current.submit());
    await waitFor(() => expect(f.result.current.creating).toBe(true));
    act(() => f.result.current.cancel());
    act(() => f.result.current.navigate(1));
    expect(f.callbacks.onCancel).not.toHaveBeenCalled();
    expect(f.result.current.step).toBe(0);
    await act(async () => done.resolve(created));
    await waitFor(() => expect(f.result.current.result).toEqual(created));
    expect(invalidation).toHaveBeenCalled();
    expect(f.callbacks.onCreated).not.toHaveBeenCalled();
    act(() => f.result.current.finish());
    expect(f.callbacks.onCreated).toHaveBeenCalledWith(created.workspace);
    expect(f.result.current.ticket).toBeUndefined();
  });
  it('验证过期及创建失败均撤票，允许重新验证', async () => {
    const f = setup();
    act(() => f.result.current.change(input));
    vi.mocked(api.verifyWorkspace).mockResolvedValueOnce({ ...ticket, expiresAt: 1 });
    await act(() => f.result.current.verify());
    act(() => f.result.current.setConfirmed(true));
    act(() => f.result.current.submit());
    expect(f.result.current.message).toContain('过期');
    vi.mocked(api.createVerifiedWorkspace).mockRejectedValueOnce(new Error('目标变化'));
    await act(() => f.result.current.verify());
    act(() => f.result.current.setConfirmed(true));
    act(() => f.result.current.submit());
    await waitFor(() => expect(f.result.current.message).toBe('目标变化'));
    expect(f.result.current.ticket).toBeUndefined();
    expect(f.result.current.confirmed).toBe(false);
  });
  it('卸载后的创建结果仍刷新列表，已有票卸载时撤销', async () => {
    const f = setup();
    act(() => f.result.current.change(input));
    await act(() => f.result.current.verify());
    const done = deferred<WorkspaceSetupResult>();
    vi.mocked(api.createVerifiedWorkspace).mockReturnValueOnce(done.promise);
    const invalidation = vi.spyOn(f.client, 'invalidateQueries');
    act(() => f.result.current.setConfirmed(true));
    act(() => f.result.current.submit());
    await waitFor(() => expect(f.result.current.creating).toBe(true));
    f.unmount();
    await act(async () => done.resolve(created));
    await waitFor(() => expect(invalidation).toHaveBeenCalled());
    expect(f.callbacks.onCreated).not.toHaveBeenCalled();
    expect(api.revokeWorkspaceVerification).toHaveBeenCalledWith(ticket.verification);
  });
  it('非法草稿不发验证请求，检查错误可重试', async () => {
    const f = setup();
    await act(() => f.result.current.verify());
    expect(f.result.current.message).toContain('请检查');
    expect(api.verifyWorkspace).not.toHaveBeenCalled();
    act(() => f.result.current.change(input));
    vi.mocked(api.verifyWorkspace).mockRejectedValueOnce(new Error('服务器不可达'));
    await act(() => f.result.current.verify());
    expect(f.result.current.message).toBe('服务器不可达');
    await act(() => f.result.current.verify());
    expect(f.result.current.ticket).toBeTruthy();
  });
});
describe('可取消请求Hook', () => {
  it('新请求替代旧请求，错误恢复且卸载后不接收迟到值', async () => {
    const f = renderHook(() => useCancelableRequest(), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    const late = deferred<number>();
    let first!: Promise<number | undefined>;
    act(() => {
      first = f.result.current.run(() => late.promise);
    });
    await act(async () => expect(await f.result.current.run(() => Promise.resolve(2))).toBe(2));
    await act(async () => {
      late.resolve(1);
      expect(await first).toBeUndefined();
    });
    expect(f.result.current.busy).toBe(false);
    await act(() => f.result.current.run(() => Promise.reject(new Error('检查未完成'))));
    expect(f.result.current.error).toContain('未完成');
    act(() => f.result.current.abort());
    expect(f.result.current.error).toBeUndefined();
    const gone = deferred<number>();
    let pending!: Promise<number | undefined>;
    act(() => {
      pending = f.result.current.run(() => gone.promise);
    });
    f.unmount();
    gone.resolve(3);
    expect(await pending).toBeUndefined();
  });
});
