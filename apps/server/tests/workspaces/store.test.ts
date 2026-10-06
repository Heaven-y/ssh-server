import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceStore, WorkspaceValidationError } from '../../src/workspaces/store';

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
    await expect(make().create({ ...input(), localDir: 'relative/dir' })).rejects.toBeInstanceOf(
      WorkspaceValidationError,
    );
  });

  it('SSH Host 不在 ~/.ssh/config 中时报 sshHost 字段错误', async () => {
    await expect(make().create({ ...input(), sshHost: 'unknown' })).rejects.toMatchObject({ field: 'sshHost' });
  });

  it('服务器目录不合法时报 remoteDir 字段错误', async () => {
    await expect(make().create({ ...input(), remoteDir: 'projects' })).rejects.toMatchObject({ field: 'remoteDir' });
  });

  it.each(['{private-secret', '{}', '[null]', '[{"id":"secret"}]'])('%s损坏拒绝读写并保留原文', async (text) => {
    const file = path.join(configDir, 'workspaces.json');
    await writeFile(file, text, 'utf8');
    const store = make();
    for (const operation of [
      () => store.list(),
      () => store.get('secret'),
      () => store.create(input()),
      () => store.update('secret', { name: 'changed' }),
      () => store.remove('secret'),
    ]) {
      await expect(operation()).rejects.toMatchObject({ name: 'WorkspaceStorageError' });
      await expect(operation()).rejects.not.toThrow('secret');
      expect(await readFile(file, 'utf8')).toBe(text);
    }
    expect(await readdir(configDir)).toEqual(['workspaces.json']);
  });

  it('非ENOENT读取失败不能视为空配置', async () => {
    await mkdir(path.join(configDir, 'workspaces.json'));
    await expect(make().list()).rejects.toMatchObject({ name: 'WorkspaceStorageError' });
    await expect(make().create(input())).rejects.toMatchObject({ name: 'WorkspaceStorageError' });
  });

  it('混合有效与无效条目不能过滤后写回', async () => {
    const valid = await make().create(input());
    const file = path.join(configDir, 'workspaces.json');
    const text = JSON.stringify([valid, { ...valid, id: 'other', authMode: 'invalid' }]);
    await writeFile(file, text, 'utf8');
    await expect(make().remove(valid.id)).rejects.toMatchObject({ name: 'WorkspaceStorageError' });
    expect(await readFile(file, 'utf8')).toBe(text);
  });

  it('当前可选字段与默认配置合法，不要求SSH或目录仍在线', async () => {
    const valid = await make().create({ ...input(), authMode: 'password' });
    expect(await make({ dirExists: false }).list()).toEqual([valid]);
    expect(await make().update(valid.id, { name: 'renamed' })).toMatchObject({ authMode: 'password' });
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
