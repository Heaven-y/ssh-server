import { afterEach, expect, it, vi } from 'vitest';
import type { WorkbenchPluginManifest } from '@agentdeck/shared/plugins';
import { handlePluginRequest, pluginDocument } from '../../../src/features/plugins/plugin-bridge';
import { pluginApi } from '../../../src/features/plugins/plugin-api';

const manifest: WorkbenchPluginManifest = {
  id: 'fixture',
  name: '夹具',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'index.html',
  permissions: [],
  commands: [],
};
const request = (method: string, params?: unknown) => ({
  type: 'agentdeck.plugin.request',
  id: 'request',
  method,
  params,
});
afterEach(() => vi.restoreAllMocks());
it('未声明权限的插件不能访问项目或持久存储，也不接受任意HTTP调用', async () => {
  const read = vi.spyOn(pluginApi, 'storage');
  await expect(handlePluginRequest(manifest, request('storage.get'))).rejects.toThrow('权限');
  await expect(handlePluginRequest(manifest, request('project.get'))).rejects.toThrow('权限');
  await expect(handlePluginRequest(manifest, request('fetch', '/api/ssh/credentials'))).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
it('授权项目仅返回名称和目录，存储目标固定为清单身份', async () => {
  const allowed = { ...manifest, permissions: ['storage', 'project-context'] as const };
  const plugin = { ...allowed, permissions: [...allowed.permissions] };
  const read = vi.spyOn(pluginApi, 'storage').mockResolvedValue({ value: {}, revision: 'missing' });
  await handlePluginRequest(plugin, request('storage.get'));
  expect(read).toHaveBeenCalledExactlyOnceWith('fixture');
  const project = await handlePluginRequest(plugin, request('project.get'), {
    id: 'project',
    name: '示例',
    dir: 'fixtures',
    server: 'my-server',
    remoteDir: '~/projects/demo',
  });
  expect(project).toEqual({ id: 'project', name: '示例', dir: 'fixtures' });
});
it('外部文档最先应用禁止网络与表单的策略，再注入窄SDK', () => {
  const html = pluginDocument('<h1>夹具</h1><script>window.started=true</script>');
  expect(html.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain("form-action 'none'");
  expect(html.indexOf("Object.defineProperty(window, 'agentdeck'")).toBeLessThan(html.indexOf('<h1>夹具'));
});
