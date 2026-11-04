import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceStore, WorkspaceValidationError } from '../../src/workspaces/store';

let configDir: string;
let projectDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-cfg-'));
  projectDir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-project-'));
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});

const make = (opts: { dirExists?: boolean } = {}) =>
  createWorkspaceStore({
    configDir,
    dirExists: async () => opts.dirExists ?? true,
    knownHosts: async () => ['my-server'],
  });

const input = () => ({ name: 'demo', dir: projectDir, server: 'my-server', remoteDir: '~/projects/demo' });

describe('createWorkspaceStore', () => {
  it('创建后返回 UUID，并持久化到磁盘', async () => {
    const ws = await make().create(input());
    expect(ws.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await make().list()).toEqual([ws]);
  });

  it('不绑定服务器的项目也能创建', async () => {
    const ws = await make().create({ name: '纯本地项目', dir: projectDir });
    expect(ws).toMatchObject({ name: '纯本地项目', dir: path.resolve(projectDir) });
    expect(ws).not.toHaveProperty('server');
  });

  it('dir 保存为 path.resolve 后的绝对路径', async () => {
    const raw = projectDir.replace(/\\/g, '/');
    const ws = await make().create({ ...input(), dir: raw });
    expect(ws.dir).toBe(path.resolve(raw));
  });

  it('项目目录不存在时报 dir 字段错误', async () => {
    await expect(make({ dirExists: false }).create(input())).rejects.toMatchObject({
      name: 'WorkspaceValidationError',
      field: 'dir',
    });
    await expect(make({ dirExists: false }).create(input())).rejects.toThrow(/项目目录不存在/);
  });

  it('相对路径的项目目录报错', async () => {
    await expect(make().create({ ...input(), dir: 'relative/dir' })).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('未登记的服务器时报 server 字段错误', async () => {
    await expect(make().create({ ...input(), server: 'unknown' })).rejects.toMatchObject({ field: 'server' });
    await expect(make().create({ ...input(), server: 'unknown' })).rejects.toThrow(/服务器未登记/);
  });

  it('服务器目录不合法时报 remoteDir 字段错误', async () => {
    await expect(make().create({ ...input(), remoteDir: 'projects' })).rejects.toMatchObject({ field: 'remoteDir' });
  });

  it('未绑定服务器时不能设置默认目录', async () => {
    await expect(make().create({ name: 'demo', dir: projectDir, remoteDir: '~/projects/demo' })).rejects.toMatchObject({
      field: 'remoteDir',
      message: '未绑定服务器时不能设置服务器目录',
    });
  });

  it('绑定服务器时必须同时设置服务器目录，不能留下半绑定项目', async () => {
    // 只有 server 的项目打不开任何服务器面板，却会占住 target_referenced 名额。
    await expect(make().create({ name: 'demo', dir: projectDir, server: 'my-server' })).rejects.toMatchObject({
      name: 'WorkspaceValidationError',
      field: 'remoteDir',
      message: '绑定服务器时必须设置服务器目录',
    });
  });

  it('update 不能把已绑定项目改成半绑定，也不能只解绑一半', async () => {
    const store = make();
    const ws = await store.create(input());
    await expect(store.update(ws.id, { remoteDir: undefined })).rejects.toMatchObject({ field: 'remoteDir' });
    await expect(store.update(ws.id, { server: undefined })).rejects.toMatchObject({ field: 'remoteDir' });
    expect(await store.get(ws.id)).toEqual(ws);
    // 同时解绑两半是允许的：项目退回纯本地。
    const unbound = await store.update(ws.id, { server: undefined, remoteDir: undefined });
    expect(unbound).toMatchObject({ id: ws.id });
    expect(unbound).not.toHaveProperty('server');
    expect(unbound).not.toHaveProperty('remoteDir');
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
    const text = JSON.stringify([valid, { ...valid, id: 'other', dir: '' }]);
    await writeFile(file, text, 'utf8');
    await expect(make().remove(valid.id)).rejects.toMatchObject({ name: 'WorkspaceStorageError' });
    expect(await readFile(file, 'utf8')).toBe(text);
  });

  it('落盘文件里的相对目录同样阻止读取，不能带病当 cwd 用', async () => {
    const valid = await make().create(input());
    const file = path.join(configDir, 'workspaces.json');
    const text = JSON.stringify([valid, { ...valid, id: 'other', dir: 'relative/dir' }]);
    await writeFile(file, text, 'utf8');
    await expect(make().list()).rejects.toMatchObject({ name: 'WorkspaceStorageError' });
    expect(await readFile(file, 'utf8')).toBe(text);
  });

  const halfBoundPatches = [
    { label: '只有服务器没有服务器目录', patch: { remoteDir: undefined } },
    { label: '只有服务器目录没有服务器', patch: { server: undefined } },
  ] as const;
  it.each(halfBoundPatches)('落盘文件里的半绑定条目（$label）同样阻止读取', async ({ patch }) => {
    const valid = await make().create(input());
    const file = path.join(configDir, 'workspaces.json');
    const text = JSON.stringify([{ ...valid, id: 'other', ...patch }]);
    await writeFile(file, text, 'utf8');
    await expect(make().list()).rejects.toMatchObject({ name: 'WorkspaceStorageError' });
    expect(await readFile(file, 'utf8')).toBe(text);
  });

  it('当前可选字段与默认配置合法，不要求SSH或目录仍在线', async () => {
    const valid = await make().create(input());
    expect(await make({ dirExists: false }).list()).toEqual([valid]);
    expect(await make().update(valid.id, { name: 'renamed' })).toMatchObject({ server: valid.server });
  });

  it('update 只改指定字段，id 不变', async () => {
    const store = make();
    const ws = await store.create(input());
    const updated = await store.update(ws.id, { name: '新名字' });
    expect(updated).toMatchObject({ id: ws.id, name: '新名字', remoteDir: ws.remoteDir });
    expect(await store.get(ws.id)).toEqual(updated);
  });

  it('目录暂时离线时仍能改名和解绑，不能变成只能手改文件的死条目', async () => {
    const ws = await make().create(input());
    // 移动硬盘没插：目录查不到存在，但记录还在。
    const offline = make({ dirExists: false });
    expect(await offline.update(ws.id, { name: '改名' })).toMatchObject({ name: '改名' });
    expect(await offline.update(ws.id, { server: undefined, remoteDir: undefined })).not.toHaveProperty('server');
    // 但真正换到一个不存在的目录仍要被拦住。
    await expect(offline.update(ws.id, { dir: path.join(projectDir, 'missing') })).rejects.toMatchObject({
      field: 'dir',
    });
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
    expect(existsSync(projectDir)).toBe(true);
  });

  it('并发创建不会丢失记录', async () => {
    const store = make();
    await Promise.all([1, 2, 3, 4, 5].map((i) => store.create({ ...input(), name: `w${i}` })));
    expect((await make().list()).map((w) => w.name).sort()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
  });
});
