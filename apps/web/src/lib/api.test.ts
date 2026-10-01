import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('成功时返回 JSON；POST 带 content-type', async () => {
    respond(201, { id: 'w1' });
    await expect(api.createWorkspace({ name: 'n', localDir: 'E:\\x', sshHost: 'h', remoteDir: '~' })).resolves.toEqual({
      id: 'w1',
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/workspaces');
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
  });

  it('400 时抛出带字段名的 ApiError', async () => {
    respond(400, { field: 'localDir', message: '本地文件夹不存在' });
    const err = await api.listWorkspaces().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, field: 'localDir', message: '本地文件夹不存在' });
  });

  it('401 提示打开访问地址；无 JSON 的错误给出状态码', async () => {
    respond(401);
    await expect(api.listSshHosts()).rejects.toThrow('访问地址');
    respond(500);
    await expect(api.listSshHosts()).rejects.toThrow('请求失败（500）');
  });

  it('路径参数会转义', async () => {
    respond(200, []);
    await api.sessionEvents('w/1', 's 1');
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/workspaces/w%2F1/sessions/s%201/events');
  });
});
