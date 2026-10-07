import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createServerTargets, serverHostConfig } from '../../src/ssh/targets';
import { createServerProfiles } from '../../src/ssh/profiles';
import { createSshPool } from '../../src/ssh/pool';
import { createPasswordStore } from '../../src/ssh/password-store';
import { connectionIdentity } from '../../src/ssh/connection';
import { createWorkspaceStore } from '../../src/workspaces/store';
import { createWorkspaceActivity } from '../../src/workspaces/activity';

it('删除档案清除真实凭据文件且不重入队列；重新登记同一目标和新后端均不复用旧密码', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'server-removal-'));
  const targets = createServerTargets({ configDir: root, homeDir: root });
  const input = {
    name: '演示',
    hostname: 'example.invalid',
    username: 'demo',
    port: 22,
    authMode: 'password' as const,
  };
  const server = await targets.save(input);
  // 此测试只验证真实文件生命周期；加解密使用合成保护器，DPAPI另有真实回归。
  const passwordStore = createPasswordStore({
    configDir: root,
    protector: {
      available: true,
      protect: async () => Buffer.from('synthetic-protected-value'),
      unprotect: async () => Buffer.from('fixture-secret'),
    },
  });
  const deps = {
    passwordStore,
    lookupHost: async (alias: string) => {
      const current = await targets.get(alias);
      return current ? serverHostConfig(current) : undefined;
    },
  };
  const pool = createSshPool(deps);
  const restarted = createSshPool(deps);
  const store = createWorkspaceStore({ configDir: root, knownHosts: async () => [], dirExists: async () => true });
  const profiles = createServerProfiles({
    targets,
    store,
    pool,
    activity: createWorkspaceActivity(),
    resources: { blockers: async () => [] },
  });
  try {
    await passwordStore.save(connectionIdentity(server), 'fixture-secret');
    await pool.setPassword(server.alias, 'fixture-secret');
    expect(await pool.credentialStatus(server.alias)).toMatchObject({ saved: true, hasPassword: true });
    await profiles.remove(server.alias, server);
    expect(await targets.list()).toEqual([]);
    expect(await passwordStore.load(connectionIdentity(server))).toBeUndefined();
    const replacement = await targets.save(input);
    expect(replacement.alias).not.toBe(server.alias);
    for (const backend of [pool, restarted])
      expect(await backend.credentialStatus(replacement.alias)).toMatchObject({ saved: false, hasPassword: false });
  } finally {
    pool.dispose();
    restarted.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
