import { sshConsoleDefinition } from '../../src/builtin-plugins/ssh-console/manifest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WorkbenchPluginManifest } from '@agentdeck/shared/plugins';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkbenchPlugins } from '../../src/plugins/service';

const roots: string[] = [];
const manifest: WorkbenchPluginManifest = {
  id: 'demo-plugin',
  name: '示例插件',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'index.html',
  permissions: ['storage', 'project-context'],
  commands: [{ id: 'open-demo', title: '打开示例' }],
};
const html = '<!doctype html><html lang="zh"><body><script>document.body.dataset.ready="yes"</script></body></html>';
async function fixture(onDisable?: (id: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-plugins-'));
  roots.push(root);
  const directory = path.join(root, 'package');
  const configDir = path.join(root, 'config');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'agentdeck.plugin.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(directory, 'index.html'), html);
  return {
    root,
    directory,
    configDir,
    service: createWorkbenchPlugins({ builtins: [sshConsoleDefinition], configDir, onDisable }),
  };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('工作台插件宿主', () => {
  it('读取前保守禁用，清理中的插件同步阻止新资源，完成后采用磁盘状态', async () => {
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const { service } = await fixture(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          enter();
        }),
    );
    expect(service.isEnabled('ssh-console')).toBe(false);
    const initial = await service.list();
    expect(service.isEnabled('ssh-console')).toBe(true);
    const disabling = service.update('ssh-console', { enabled: false, revision: initial.revision });
    await entered;
    expect(service.isEnabled('ssh-console')).toBe(false);
    release();
    await disabling;
    expect(service.isEnabled('ssh-console')).toBe(false);
  });
  it('内置 SSH 默认启用且不可卸载，外部安装仅复制并保持停用', async () => {
    const { service, directory, configDir } = await fixture();
    const initial = await service.list();
    expect(initial).toMatchObject({
      revision: 'missing',
      plugins: [{ builtin: true, enabled: true, manifest: { id: 'ssh-console' } }],
    });
    await expect(service.remove('ssh-console', { revision: initial.revision })).rejects.toMatchObject({
      code: 'builtin_plugin',
    });
    const catalog = await service.install({ directory });
    expect(catalog.plugins.find((plugin) => plugin.manifest.id === 'demo-plugin')).toMatchObject({
      builtin: false,
      enabled: false,
    });
    await expect(service.page('demo-plugin')).rejects.toMatchObject({ code: 'plugin_disabled' });
    expect(await createWorkbenchPlugins({ builtins: [sshConsoleDefinition], configDir }).list()).toEqual(catalog);
    await fs.writeFile(path.join(directory, 'index.html'), '外部包被修改');
    const enabled = await service.update('demo-plugin', { enabled: true, revision: catalog.revision });
    expect(enabled.plugins.find((plugin) => plugin.manifest.id === 'demo-plugin')?.enabled).toBe(true);
    expect(await service.page('demo-plugin')).toEqual({ html });
  });

  it('停用先完成资源清理，清理失败保持启用状态且不泄露异常', async () => {
    const cleaned: string[] = [];
    let fails = true;
    const { service, directory } = await fixture(async (id) => {
      cleaned.push(id);
      if (fails) throw new Error('secret-private');
    });
    const installed = await service.install({ directory });
    const enabled = await service.update('demo-plugin', { enabled: true, revision: installed.revision });
    const failure: unknown = await service
      .update('demo-plugin', { enabled: false, revision: enabled.revision })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'cleanup_failed' });
    expect(String(failure)).not.toContain('secret-private');
    expect(service.isEnabled('demo-plugin')).toBe(true);
    expect((await service.list()).plugins.find((plugin) => plugin.manifest.id === 'demo-plugin')?.enabled).toBe(true);
    fails = false;
    const disabled = await service.update('demo-plugin', { enabled: false, revision: enabled.revision });
    expect(disabled.plugins.find((plugin) => plugin.manifest.id === 'demo-plugin')?.enabled).toBe(false);
    expect(cleaned).toEqual(['demo-plugin', 'demo-plugin']);
  });

  it('存储隔离在已启用且有权限的插件，修订冲突不覆盖；卸载仅删除自有文件', async () => {
    const { service, directory } = await fixture();
    const installed = await service.install({ directory });
    await expect(service.readStorage('demo-plugin')).rejects.toMatchObject({ code: 'plugin_disabled' });
    const enabled = await service.update('demo-plugin', { enabled: true, revision: installed.revision });
    expect(await service.readStorage('demo-plugin')).toEqual({ value: {}, revision: 'missing' });
    const saved = await service.saveStorage('demo-plugin', { value: { count: 3 }, revision: 'missing' });
    expect(await service.readStorage('demo-plugin')).toEqual(saved);
    await expect(
      service.saveStorage('demo-plugin', { value: { count: 4 }, revision: 'missing' }),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(
      service.saveStorage('demo-plugin', { value: { text: 'a'.repeat(65536) }, revision: saved.revision }),
    ).rejects.toMatchObject({ code: 'too_large' });
    await expect(service.readStorage('ssh-console')).rejects.toMatchObject({ code: 'permission_denied' });
    const removed = await service.remove('demo-plugin', { revision: enabled.revision });
    expect(removed.plugins).toHaveLength(1);
    expect(await fs.readFile(path.join(directory, 'index.html'), 'utf8')).toBe(html);
    await expect(service.page('demo-plugin')).rejects.toMatchObject({ code: 'plugin_missing' });
  });

  it('拒绝重复安装、旧修订及安装包中的路径穿越、代码执行入口与凭据文件', async () => {
    const { service, directory } = await fixture();
    const installed = await service.install({ directory });
    await expect(service.install({ directory })).rejects.toMatchObject({ code: 'already_installed' });
    for (const unsupported of ['relative/plugin', `\\\\${path.basename(directory)}\\package`])
      await expect(service.install({ directory: unsupported })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.update('demo-plugin', { enabled: true, revision: 'missing' })).rejects.toMatchObject({
      code: 'revision_conflict',
    });
    expect((await service.list()).revision).toBe(installed.revision);
    for (const patch of [
      { entry: '../outside.html' },
      { entry: 'nested\\entry.html' },
      { apiVersion: 2 },
      { permissions: ['shell'] },
    ]) {
      const other = await fixture();
      await fs.writeFile(
        path.join(other.directory, 'agentdeck.plugin.json'),
        JSON.stringify({ ...manifest, ...patch }),
      );
      await expect(other.service.install({ directory: other.directory })).rejects.toMatchObject({
        code: 'invalid_manifest',
      });
      expect((await other.service.list()).plugins).toHaveLength(1);
    }
    for (const name of ['.env', 'private.key', 'package.json', 'credentials.json', 'server.ts']) {
      const other = await fixture();
      await fs.writeFile(path.join(other.directory, name), 'private-sentinel');
      const failure: unknown = await other.service
        .install({ directory: other.directory })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'package_rejected' });
      expect(String(failure)).not.toContain('private-sentinel');
    }
  });

  it('拒绝目录/文件链接和超量包，已安装入口被替换也不能越界读取', async () => {
    const { root, directory, service, configDir } = await fixture();
    const outside = path.join(root, 'outside.html');
    await fs.writeFile(outside, 'private-sentinel');
    await fs.symlink(outside, path.join(directory, 'linked.html'), 'file');
    await expect(service.install({ directory })).rejects.toMatchObject({ code: 'unsafe_path' });
    await fs.unlink(path.join(directory, 'linked.html'));
    const installed = await service.install({ directory });
    const enabled = await service.update('demo-plugin', { enabled: true, revision: installed.revision });
    const copied = path.join(configDir, 'workbench-plugins', 'packages', 'demo-plugin', 'index.html');
    await fs.unlink(copied);
    await fs.symlink(outside, copied, 'file');
    await expect(service.page('demo-plugin')).rejects.toMatchObject({ code: 'unsafe_path' });
    await expect(service.remove('demo-plugin', { revision: enabled.revision })).rejects.toMatchObject({
      code: 'unsafe_path',
    });
    expect(await fs.readFile(outside, 'utf8')).toBe('private-sentinel');
    const oversized = await fixture();
    await fs.writeFile(path.join(oversized.directory, 'large.js'), Buffer.alloc(10 * 1024 * 1024));
    await expect(oversized.service.install({ directory: oversized.directory })).rejects.toMatchObject({
      code: 'too_large',
    });
    const excessive = await fixture();
    for (let index = 0; index < 255; index++)
      await fs.writeFile(path.join(excessive.directory, `asset-${index}.css`), '');
    await expect(excessive.service.install({ directory: excessive.directory })).rejects.toMatchObject({
      code: 'too_large',
    });
  });
});

it('内置注册项各自保存状态，v1 停用选择迁移后不丢失且不回写旧格式', async () => {
  const { configDir } = await fixture();
  const folder = path.join(configDir, 'workbench-plugins');
  await fs.mkdir(folder, { recursive: true });
  const registryFile = path.join(folder, 'registry.json');
  const previous = JSON.stringify({ version: 1, sshConsoleEnabled: false, plugins: [] });
  await fs.writeFile(registryFile, previous);
  const builtins = [
    { manifest: { ...manifest, id: 'ssh-console' }, defaultEnabled: true },
    { manifest: { ...manifest, id: 'other-builtin' }, defaultEnabled: true },
  ];
  const service = createWorkbenchPlugins({ configDir, builtins });
  const old = await service.list();
  expect(old.plugins.map((entry) => [entry.manifest.id, entry.enabled])).toEqual([
    ['ssh-console', false],
    ['other-builtin', true],
  ]);
  expect(await fs.readFile(registryFile, 'utf8')).toBe(previous);
  const updated = await service.update('other-builtin', { enabled: false, revision: old.revision });
  expect(updated.plugins.every((entry) => !entry.enabled)).toBe(true);
  expect(JSON.parse(await fs.readFile(registryFile, 'utf8'))).toMatchObject({
    version: 2,
    builtinEnabled: { 'ssh-console': false, 'other-builtin': false },
  });
  expect(await createWorkbenchPlugins({ configDir, builtins }).list()).toEqual(updated);
});
