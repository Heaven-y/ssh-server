import { afterEach, expect, it, vi } from 'vitest';
import { resourcesApi } from '../../../../../src/builtin-plugins/ssh-console/legacy/resources/api';
import { respond } from '../../../../fixtures/http';
afterEach(() => vi.unstubAllGlobals());
it('Slurm只读请求固定目标、取消信号和no-store，不发送认证材料或任务动作', async () => {
  const target = { workspaceId: 'w/1', sshHost: 'my-server', remoteDir: '~/projects/demo & notes' };
  const result = { status: 'available', sampledAt: 1, output: '', truncated: false };
  respond(200, result);
  expect(resourcesApi).toHaveProperty('readSlurm', expect.any(Function));
  const controller = new AbortController();
  await expect(resourcesApi.readSlurm(target, controller.signal)).resolves.toEqual(result);
  const [url, options] = vi.mocked(fetch).mock.calls[0]!;
  const parsed = new URL(url as string, 'https://example.invalid');
  expect(parsed.pathname).toBe('/api/workspaces/w%2F1/slurm');
  expect(JSON.parse(parsed.searchParams.get('target')!)).toEqual(target);
  expect(options).toMatchObject({ signal: controller.signal, cache: 'no-store' });
  expect(options?.body).toBeUndefined();
  expect(options?.method).toBeUndefined();
});
