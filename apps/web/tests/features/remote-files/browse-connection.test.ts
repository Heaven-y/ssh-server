import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteBrowseSession, RemoteBrowseTarget } from '@ssh-server/shared';
import { ApiError, type api } from '../../../src/lib/api';
import { createBrowseConnection } from '../../../src/features/remote-files/browse-connection';

const root = path.posix.join(path.posix.sep, 'fixture-project');
const target: RemoteBrowseTarget = {
  sshHost: 'my-server',
  remoteDir: root,
  localDir: path.join(os.tmpdir(), 'browse-fixture'),
};
const session = (id: string): RemoteBrowseSession => ({
  id,
  workspaceId: 'fixture',
  sshHost: 'my-server',
  root,
  home: path.posix.sep,
});
const signal = () => new AbortController().signal;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const requests = {
    bindRemoteBrowseTarget: vi.fn(async () => ({ binding: 'original-binding' })),
    createRemoteBrowseSession: vi.fn<typeof api.createRemoteBrowseSession>(async () => session('s1')),
    closeRemoteBrowseSession: vi.fn(async () => undefined),
  };
  return { requests, connection: createBrowseConnection('fixture', target, requests) };
}

describe('服务器浏览连接生命周期', () => {
  it('登记不创建会话，重连复用原目标绑定，释放是幂等的', async () => {
    const { requests, connection } = fixture();
    await connection.bind();
    expect(requests.createRemoteBrowseSession).not.toHaveBeenCalled();
    const first = await connection.connect(signal());
    expect(await connection.connect(signal())).toBe(first);
    connection.release();
    connection.release();
    requests.bindRemoteBrowseTarget.mockResolvedValue({ binding: 'changed-binding' });
    requests.createRemoteBrowseSession.mockResolvedValue(session('s2'));
    expect((await connection.connect(signal())).id).toBe('s2');
    expect(requests.bindRemoteBrowseTarget).toHaveBeenCalledOnce();
    expect(requests.createRemoteBrowseSession.mock.calls).toEqual([
      ['fixture', target, 'original-binding', expect.any(AbortSignal)],
      ['fixture', target, 'original-binding', expect.any(AbortSignal)],
    ]);
    expect(requests.closeRemoteBrowseSession).toHaveBeenCalledExactlyOnceWith('fixture', 's1');
  });

  it('等待绑定时取消，不会在绑定迟到后创建会话', async () => {
    const { requests, connection } = fixture();
    const pending = deferred<{ binding: string }>();
    requests.bindRemoteBrowseTarget.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const opening = connection.connect(controller.signal).catch((error: unknown) => error);
    controller.abort();
    pending.resolve({ binding: 'original-binding' });
    expect(await opening).toMatchObject({ name: 'AbortError' });
    expect(requests.createRemoteBrowseSession).not.toHaveBeenCalled();
  });

  it('旧创建响应迟到时只关闭旧会话，不覆盖新会话', async () => {
    const { requests, connection } = fixture();
    await connection.bind();
    const pending = deferred<RemoteBrowseSession>();
    requests.createRemoteBrowseSession.mockReturnValueOnce(pending.promise);
    const old = connection.connect(signal()).catch((error: unknown) => error);
    await Promise.resolve();
    connection.release();
    requests.createRemoteBrowseSession.mockResolvedValue(session('new-session'));
    expect((await connection.connect(signal())).id).toBe('new-session');
    pending.resolve(session('old-session'));
    expect(await old).toMatchObject({ name: 'AbortError' });
    expect(requests.closeRemoteBrowseSession).toHaveBeenCalledExactlyOnceWith('fixture', 'old-session');
    expect((await connection.connect(signal())).id).toBe('new-session');
  });

  it('缓存绑定失败，读取和重连不能静默登记新目标', async () => {
    const { requests, connection } = fixture();
    requests.bindRemoteBrowseTarget.mockRejectedValueOnce(new ApiError(503, '配置不可用'));
    await expect(connection.connect(signal())).rejects.toMatchObject({ code: 'binding_failed' });
    connection.release();
    await expect(connection.connect(signal())).rejects.toMatchObject({ code: 'binding_failed' });
    expect(requests.bindRemoteBrowseTarget).toHaveBeenCalledOnce();
    expect(requests.createRemoteBrowseSession).not.toHaveBeenCalled();
  });

  it('创建失败后可重试，创建期间取消后关闭迟到会话', async () => {
    const { requests, connection } = fixture();
    requests.createRemoteBrowseSession.mockRejectedValueOnce(new ApiError(409, '请重新连接SSH'));
    await expect(connection.connect(signal())).rejects.toMatchObject({ status: 409 });
    const pending = deferred<RemoteBrowseSession>();
    requests.createRemoteBrowseSession.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const opening = connection.connect(controller.signal).catch((error: unknown) => error);
    await Promise.resolve();
    controller.abort();
    const forwarded = requests.createRemoteBrowseSession.mock.calls.at(-1)?.[3];
    expect(forwarded?.aborted).toBe(true);
    pending.resolve(session('late-session'));
    expect(await opening).toMatchObject({ name: 'AbortError' });
    expect(requests.closeRemoteBrowseSession).toHaveBeenCalledWith('fixture', 'late-session');
    expect(requests.bindRemoteBrowseTarget).toHaveBeenCalledOnce();
  });

  it('释放面板立即取消创建请求，并仍清理不遵守取消的迟到会话', async () => {
    const { requests, connection } = fixture();
    await connection.bind();
    const pending = deferred<RemoteBrowseSession>();
    requests.createRemoteBrowseSession.mockReturnValueOnce(pending.promise);
    const result = connection.connect(signal()).catch((error: unknown) => error);
    await Promise.resolve();
    const forwarded = requests.createRemoteBrowseSession.mock.calls.at(-1)?.[3];
    expect(forwarded?.aborted).toBe(false);
    connection.release();
    expect(forwarded?.aborted).toBe(true);
    pending.resolve(session('released-session'));
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(requests.closeRemoteBrowseSession).toHaveBeenCalledWith('fixture', 'released-session');
  });

  it('已取消的连接不发请求，关闭请求失败也不妨碍再次连接', async () => {
    const { requests, connection } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(connection.connect(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests.bindRemoteBrowseTarget).not.toHaveBeenCalled();
    await connection.connect(signal());
    requests.closeRemoteBrowseSession.mockRejectedValueOnce(new TypeError('网络断开'));
    connection.release();
    requests.createRemoteBrowseSession.mockResolvedValue(session('reconnected'));
    expect((await connection.connect(signal())).id).toBe('reconnected');
    expect(requests.bindRemoteBrowseTarget).toHaveBeenCalledOnce();
  });

  it('网络异常仍保留绑定失败结果并提供可读反馈', async () => {
    const { requests, connection } = fixture();
    requests.bindRemoteBrowseTarget.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(connection.connect(signal())).rejects.toMatchObject({
      code: 'binding_failed',
      message: expect.stringContaining('无法联系本机服务'),
    });
    await connection.bind();
    expect(requests.bindRemoteBrowseTarget).toHaveBeenCalledOnce();
    expect(requests.createRemoteBrowseSession).not.toHaveBeenCalled();
  });
});
