import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceStore, WorkspaceValidationError } from './store';

let configDir: string;
let localDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(path.join(os.tmpdir(), 'ssh-server-cfg-'));
  localDir = await mkdtemp(path.join(os.tmpdir(), 'ssh-server-local-'));
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
  await rm(localDir, { recursive: true, force: true });
});

const make = (opts: { dirExists?: boolean } = {}) =>
  createWorkspaceStore({
    configDir,
    dirExists: async () => opts.dirExists ?? true,
    knownHosts: async () => ['my-server'],
  });

const input = () => ({ name: 'demo', localDir, sshHost: 'my-server', remoteDir: '~/projects/demo' });

describe('createWorkspaceStore', () => {
  it('创建后返回 UUID，并持久化到磁盘', async () => {
    const ws = await make().create(input());
    expect(ws.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await make().list()).toEqual([ws]);
  });

  it('localDir 保存为 path.resolve 后的绝对路径', async () => {
    const raw = localDir.replace(/\\/g, '/');
    const ws = await make().create({ ...input(), localDir: raw });
    expect(ws.localDir).toBe(path.resolve(raw));
  });

  it('本地文件夹不存在时报 localDir 字段错误', async () => {
    await expect(make({ dirExists: false }).create(input())).rejects.toMatchObject({
      name: 'WorkspaceValidationError',
      field: 'localDir',
    });
  });

  it('相对路径的本地文件夹报错', async () => {
    await expect(make().create({ ...input(), localDir: 'relative/dir' })).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('SSH Host 不在 ~/.ssh/config 中时报 sshHost 字段错误', async () => {
    await expect(make().create({ ...input(), sshHost: 'unknown' })).rejects.toMatchObject({ field: 'sshHost' });
  });

  it('服务器目录不合法时报 remoteDir 字段错误', async () => {
    await expect(make().create({ ...input(), remoteDir: 'projects' })).rejects.toMatchObject({ field: 'remoteDir' });
  });

  it('配置文件损坏时备份并从空列表开始', async () => {
    await writeFile(path.join(configDir, 'workspaces.json'), '{坏', 'utf8');
    expect(await make().list()).toEqual([]);
    const files = await readdir(configDir);
    expect(files.some((f) => f.startsWith('workspaces.json.bak-'))).toBe(true);
  });

  it('update 只改指定字段，id 不变', async () => {
    const store = make();
    const ws = await store.create(input());
    const updated = await store.update(ws.id, { name: '新名字' });
    expect(updated).toMatchObject({ id: ws.id, name: '新名字', remoteDir: ws.remoteDir });
    expect(await store.get(ws.id)).toEqual(updated);
  });

  it('update / remove 不存在的 id', async () => {
    const store = make();
    expect(await store.update('nope', { name: 'x' })).toBeUndefined();
    expect(await store.remove('nope')).toBe(false);
  });

  it('remove 只删配置，不删本地文件夹', async () => {
    const store = make();
    const ws = await store.create(input());
    expect(await store.remove(ws.id)).toBe(true);
    expect(await store.get(ws.id)).toBeUndefined();
    expect(existsSync(localDir)).toBe(true);
  });

  it('并发创建不会丢失记录', async () => {
    const store = make();
    await Promise.all([1, 2, 3, 4, 5].map((i) => store.create({ ...input(), name: `w${i}` })));
    expect((await make().list()).map((w) => w.name).sort()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
  });
});
