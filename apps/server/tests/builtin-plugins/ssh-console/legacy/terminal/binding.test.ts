import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { BoundWorkspace } from '@agentdeck/shared/projects';
import { workspaceTerminalTarget } from '@agentdeck/shared/ssh';
import { createTerminalBindings } from '../../../../../src/builtin-plugins/ssh-console/legacy/terminal/binding';
import { createConnectionResolver } from '../../../../../src/builtin-plugins/ssh-console/ssh/connection';
import { createBrowseBinding } from '../../../../../src/builtin-plugins/ssh-console/legacy/remote-files/binding';

afterEach(() => vi.useRealTimers());
const workspace: BoundWorkspace = {
  id: 'w',
  name: '工作区',
  dir: path.resolve('fixture'),
  server: 'my-server',
  remoteDir: '~/projects/demo',
};
const target = workspaceTerminalTarget(workspace);
const signal = new AbortController().signal;

it('令牌到期不能open、只能刷新同一目标，篡改/删除/代次变化均拒绝', async () => {
  vi.useFakeTimers();
  let current: BoundWorkspace | undefined = workspace;
  let fingerprint = 'a';
  let generation = 0;
  const bindings = createTerminalBindings({
    store: { get: async () => current },
    pool: { fingerprint: async () => fingerprint, generation: () => generation },
  });
  const binding = await bindings.issue(target, { signal });
  expect(Object.keys(binding).sort()).toEqual(['binding', 'expiresAt', 'target']);
  expect((await bindings.verify(target, binding.binding, signal)).workspace).toBe(workspace);
  await expect(
    bindings.verify(target, `${binding.binding.slice(0, -1)}${binding.binding.endsWith('0') ? '1' : '0'}`, signal),
  ).rejects.toMatchObject({ code: 'target_changed' });
  vi.advanceTimersByTime(300000);
  await expect(bindings.verify(target, binding.binding, signal)).rejects.toMatchObject({ code: 'binding_expired' });
  const next = await bindings.issue(target, { signal, previousBinding: binding.binding });
  fingerprint = 'b';
  await expect(bindings.issue(target, { signal, previousBinding: next.binding })).rejects.toMatchObject({
    code: 'target_changed',
  });
  fingerprint = 'a';
  generation++;
  await expect(bindings.verify(target, next.binding, signal)).rejects.toMatchObject({ code: 'target_changed' });
  current = undefined;
  await expect(bindings.verify(target, next.binding, signal)).rejects.toMatchObject({ code: 'workspace_missing' });
});

it('更改IdentityFile或所选私钥内容后拒绝旧标签刷新', async () => {
  const homeDir = path.resolve('fixture-home');
  let keyFile = 'first-key';
  let key = Buffer.from('key-one');
  const resolver = createConnectionResolver({
    homeDir,
    lookupHost: async (alias) => ({
      alias,
      hostname: 'fixture',
      port: 22,
      user: 'demo',
      authMode: 'key',
      identityFiles: [keyFile],
      unsupported: [],
    }),
    readFile: async (file) => {
      if (file === path.join(homeDir, '.ssh', 'config'))
        return Buffer.from(`Host my-server\n HostName fixture\n User demo\n IdentityFile ${keyFile}\n`);
      if (file === path.join(homeDir, '.ssh', 'known_hosts')) return Buffer.alloc(0);
      return key;
    },
  });
  const bindings = createTerminalBindings({
    store: { get: async () => workspace },
    pool: { fingerprint: resolver.fingerprint, generation: () => 0 },
  });
  const first = await bindings.issue(target, { signal });
  keyFile = 'second-key';
  await expect(bindings.issue(target, { signal, previousBinding: first.binding })).rejects.toMatchObject({
    code: 'target_changed',
  });
  const second = await bindings.issue(target, { signal });
  key = Buffer.from('key-two');
  await expect(bindings.issue(target, { signal, previousBinding: second.binding })).rejects.toMatchObject({
    code: 'target_changed',
  });
});

it('中央认证方式变化使旧终端和浏览绑定失效，调用目标不能覆盖档案认证', async () => {
  let authMode: 'key' | 'password' = 'key';
  const resolver = createConnectionResolver({
    lookupHost: async (alias) => ({
      alias,
      hostname: 'fixture',
      port: 22,
      user: 'demo',
      authMode,
      identityFiles: [],
      unsupported: [],
    }),
    readFile: async () => Buffer.from('fixture-key'),
  });
  const store = { get: async () => workspace };
  const pool = { fingerprint: resolver.fingerprint, generation: () => 0 };
  const terminal = createTerminalBindings({ store, pool });
  const browse = createBrowseBinding(store, pool);
  const before = await terminal.issue(target, { signal });
  const browser = await browse(workspace.id, { sshHost: workspace.server, remoteDir: workspace.remoteDir }, signal);
  authMode = 'password';
  await expect(terminal.verify(target, before.binding, signal)).rejects.toMatchObject({ code: 'target_changed' });
  expect(
    (await browse(workspace.id, { sshHost: workspace.server, remoteDir: workspace.remoteDir }, signal)).binding,
  ).not.toBe(browser.binding);
  await resolver.setPassword(workspace.server, 'fixture-password');
  const uncheckedTarget = { alias: workspace.server, authMode: 'key' };
  expect(await resolver.resolve(uncheckedTarget)).toMatchObject({ authMode: 'password', password: 'fixture-password' });
});

it('重认证代次变化也使未打开的浏览绑定失效', async () => {
  let generation = 0;
  const browse = createBrowseBinding(
    { get: async () => workspace },
    { fingerprint: async () => 'same-profile', generation: () => generation },
  );
  const before = await browse(workspace.id, { sshHost: workspace.server, remoteDir: workspace.remoteDir }, signal);
  generation++;
  expect(
    (await browse(workspace.id, { sshHost: workspace.server, remoteDir: workspace.remoteDir }, signal)).binding,
  ).not.toBe(before.binding);
});

// 项目现在可以不绑定服务器：服务器面板与终端在这种项目上必须明确拒绝，
// 而不是拿 undefined 去拼目标或读到一个不存在的远程目录。
for (const shape of [
  { label: '没有 server 与 remoteDir', patch: { server: undefined, remoteDir: undefined } },
  { label: '只有 server 没有 remoteDir', patch: { remoteDir: undefined } },
  { label: '只有 remoteDir 没有 server', patch: { server: undefined } },
] as const) {
  it(`未绑定服务器的项目（${shape.label}）不能签发终端与浏览绑定`, async () => {
    const unbound = { ...workspace, ...shape.patch } as unknown as BoundWorkspace;
    const bindings = createTerminalBindings({
      store: { get: async () => unbound },
      pool: { fingerprint: async () => 'a', generation: () => 0 },
    });
    await expect(bindings.issue(target, { signal })).rejects.toMatchObject({ code: 'workspace_missing' });
    const browse = createBrowseBinding(
      { get: async () => unbound },
      { fingerprint: async () => 'a', generation: () => 0 },
    );
    await expect(
      browse(workspace.id, { sshHost: workspace.server, remoteDir: workspace.remoteDir }, signal),
    ).rejects.toMatchObject({ code: 'workspace_missing' });
  });
}

it('停用使旧绑定和在途签发失效，重新启用只接受新绑定', async () => {
  let enabled = true;
  let hold: ((value: string) => void) | undefined;
  let delayed = false;
  const bindings = createTerminalBindings({
    store: { get: async () => workspace },
    pool: {
      generation: () => 0,
      fingerprint: async () =>
        delayed
          ? new Promise<string>((resolve) => {
              hold = resolve;
            })
          : 'same',
    },
    isEnabled: () => enabled,
  });
  const old = await bindings.issue(target, { signal });
  delayed = true;
  const pending = bindings.issue(target, { signal });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'target_changed' });
  await vi.waitFor(() => expect(hold).toBeDefined());
  enabled = false;
  bindings.invalidate();
  await expect(bindings.issue(target, { signal })).rejects.toMatchObject({ code: 'plugin_disabled' });
  enabled = true;
  delayed = false;
  hold!('same');
  await rejected;
  await expect(bindings.verify(target, old.binding, signal)).rejects.toMatchObject({ code: 'target_changed' });
  const fresh = await bindings.issue(target, { signal });
  expect((await bindings.verify(target, fresh.binding, signal)).workspace).toBe(workspace);
});
