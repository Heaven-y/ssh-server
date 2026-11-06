import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, request } from '../../src/lib/http';
import { respond } from '../fixtures/http';
afterEach(() => vi.unstubAllGlobals());
it('成功时返回 JSON；POST 带 content-type', async () => {
  respond(201, { alias: 'my-server' });
  await expect(request('/api/fixture', { method: 'POST', body: JSON.stringify({ name: 'n' }) })).resolves.toEqual({
    alias: 'my-server',
  });
  const [url, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(url).toBe('/api/fixture');
  expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
});
it('接口错误保留字段名、分类及部分恢复路径', async () => {
  respond(400, { field: 'dir', message: '项目目录不存在' });
  const err = await request('/api/fixture').catch((e: unknown) => e);
  expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/fixture');
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 400, field: 'dir', message: '项目目录不存在' });
  respond(500, { code: 'partial_restore', message: '部分文件恢复失败', affectedPaths: ['main.py'] });
  await expect(
    request('/api/fixture', { method: 'DELETE', body: JSON.stringify({ confirmed: true }) }),
  ).rejects.toMatchObject({
    status: 500,
    code: 'partial_restore',
    affectedPaths: ['main.py'],
  });
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({ confirmed: true });
});
it('401 提示刷新本机会话；无 JSON 的错误给出状态码', async () => {
  respond(401);
  await expect(request('/api/fixture')).rejects.toThrow('刷新页面');
  respond(500);
  await expect(request('/api/fixture')).rejects.toThrow('请求失败（500）');
});
