import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { SyncSettingsSchema, type Workspace } from '@ssh-server/shared';
import { createVersionsService } from '../../src/vcs/service';
import { git, gitText } from '../../src/vcs/git';
import { createTurnChanges } from '../../src/chat/turn-changes';

vi.setConfig({ testTimeout: 60_000 });
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'turn-changes-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  await git(repo, ['init', '--quiet']);
  const ws: Workspace = {
    id: randomUUID(),
    name: 'demo',
    localDir: repo,
    sshHost: 'my-server',
    remoteDir: '~/projects/demo',
  };
  const configDir = path.join(root, 'config');
  const versions = createVersionsService();
  const target = { agent: 'codex' as const, sessionId: randomUUID() };
  return { root, repo, ws, configDir, versions, target };
}
it('瞬时元数据落盘失败后同一进程恢复终态，释放新引用且保持既有基线', async () => {
  const f = await fixture();
  let failingEdge: 'base' | 'result' | undefined = 'base';
  const wrapped = {
    ...f.versions,
    captureTurn: async (...args: Parameters<typeof f.versions.captureTurn>) => {
      const snapshot = await f.versions.captureTurn(...args);
      if (args[2] === failingEdge) {
        await fs.rename(f.configDir, `${f.configDir}-backup`);
        await fs.writeFile(f.configDir, '阻断元数据');
      }
      return snapshot;
    },
  };
  const changes = createTurnChanges({ configDir: f.configDir, versions: wrapped });
  const restore = async () => {
    await fs.unlink(f.configDir);
    await fs.rename(`${f.configDir}-backup`, f.configDir);
  };
  const failedBase = randomUUID();
  await expect(changes.begin(f.ws, failedBase, f.target)).rejects.toThrow();
  expect(await gitText(f.repo, ['for-each-ref', '--format=%(refname)', 'refs/ssh-server/turns/'])).toBe('');
  await restore();
  expect((await changes.list(f.ws, f.target)).find((record) => record.turnId === failedBase)?.phase).toBe('incomplete');
  failingEdge = undefined;
  const id = randomUUID();
  await changes.begin(f.ws, id, f.target);
  failingEdge = 'result';
  await expect(changes.finish(f.ws, id, { sessionId: f.target.sessionId, interrupted: false })).rejects.toThrow();
  expect(
    (await gitText(f.repo, ['for-each-ref', '--format=%(refname)', 'refs/ssh-server/turns/'])).split('\n'),
  ).toHaveLength(1);
  await restore();
  expect((await changes.list(f.ws, f.target)).find((record) => record.turnId === id)?.phase).toBe('incomplete');
});

it('真实21轮保留20轮与40引用，重启恢复且目录/会话/规则隔离', async () => {
  const f = await fixture();
  const changes = createTurnChanges(f);
  await fs.writeFile(path.join(f.repo, 'main.txt'), 'base\n');
  let first = '';
  for (let index = 0; index < 21; index++) {
    const id = randomUUID();
    if (!index) first = id;
    await changes.begin(f.ws, id, f.target);
    await fs.writeFile(path.join(f.repo, 'main.txt'), `${index}\n`);
    const record = await changes.finish(f.ws, id, { sessionId: f.target.sessionId, interrupted: index === 20 });
    expect(record?.phase).toBe(index === 20 ? 'incomplete' : 'complete');
    expect(record?.changes).toHaveLength(1);
  }
  const records = await changes.list(f.ws, f.target);
  expect(records).toHaveLength(20);
  expect(records.some((record) => record.turnId === first)).toBe(false);
  expect(
    (await gitText(f.repo, ['for-each-ref', '--format=%(refname)', 'refs/ssh-server/turns/'])).split('\n'),
  ).toHaveLength(40);
  expect(await changes.list(f.ws, { ...f.target, agent: 'claude' })).toEqual([]);
  expect(await changes.list(f.ws, { agent: 'codex' })).toEqual([]);
  expect(await changes.list({ ...f.ws, remoteDir: '~/projects/other' }, f.target)).toEqual([]);
  expect(await changes.list({ ...f.ws, sync: SyncSettingsSchema.parse({ maxFileBytes: 100 }) }, f.target)).toEqual([]);
  await expect(changes.diff(f.ws, records[0]!.turnId, { ...f.target, agent: 'claude' })).rejects.toMatchObject({
    code: 'changes_missing',
  });
  expect((await changes.diff(f.ws, records[0]!.turnId, f.target, 'main.txt')).changes).toHaveLength(1);
  const pending = randomUUID();
  await changes.begin(f.ws, pending, f.target);
  await expect(changes.begin(f.ws, pending, f.target)).rejects.toMatchObject({ code: 'changes_duplicate' });
  expect((await changes.list(f.ws, f.target)).find((record) => record.turnId === pending)?.phase).toBe('running');
  const restarted = createTurnChanges(f);
  expect((await restarted.list(f.ws, f.target)).find((record) => record.turnId === pending)?.phase).toBe('incomplete');
  await expect(restarted.diff(f.ws, pending, f.target)).rejects.toMatchObject({ code: 'changes_unavailable' });
}, 120_000);
