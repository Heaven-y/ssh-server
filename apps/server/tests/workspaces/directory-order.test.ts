import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createLocalDirectoryBrowser } from '../../src/workspaces/setup/local';
import { createWorkspaceFilesService } from '../../src/files/service';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'directory-order-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const browser = createLocalDirectoryBrowser();
  cleanups.push(() => browser.dispose());
  return { root, browser };
}

it('创建向导跨页采用文件夹优先及数字自然排序，不遗漏条目', async () => {
  const { root, browser } = await fixture();
  await Promise.all(
    Array.from({ length: 201 }, (_, i) => writeFile(path.join(root, `file${i + 1}.py`), 'fixture', 'utf8')),
  );
  await mkdir(path.join(root, 'z10'));
  await mkdir(path.join(root, 'z2'));
  const signal = new AbortController().signal;
  const first = await browser.list({ path: root }, signal);
  const second = await browser.list({ path: root, cursor: first.nextCursor }, signal);
  expect(first.entries.slice(0, 5).map((entry) => entry.name)).toEqual([
    'z2',
    'z10',
    'file1.py',
    'file2.py',
    'file3.py',
  ]);
  expect(second.entries.map((entry) => entry.name)).toEqual(['file199.py', 'file200.py', 'file201.py']);
  expect(second.nextCursor).toBeUndefined();
});

it('本地代码列表采用相同的文件夹优先与名称自然顺序', async () => {
  const { root } = await fixture();
  for (const name of ['file10.py', 'file2.py', 'file1.py']) await writeFile(path.join(root, name), 'fixture', 'utf8');
  for (const name of ['z10', 'z2']) await mkdir(path.join(root, name));
  const directory = await createWorkspaceFilesService().list({
    id: 'workspace',
    name: '演示',
    localDir: root,
    sshHost: 'my-server',
    remoteDir: '~/projects/demo',
  });
  expect(directory.entries.map((entry) => entry.name)).toEqual(['z2', 'z10', 'file1.py', 'file2.py', 'file10.py']);
});

it('有序分页期间目录变化仍拒绝陈旧游标', async () => {
  const { root, browser } = await fixture();
  await Promise.all(Array.from({ length: 201 }, (_, i) => writeFile(path.join(root, `file${i}.py`), '', 'utf8')));
  const first = await browser.list({ path: root }, new AbortController().signal);
  await mkdir(path.join(root, 'new-directory'));
  await expect(
    browser.list({ path: root, cursor: first.nextCursor }, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'local_cursor_expired' });
});

it('本地展示上限应用在排序之后，不让先读到的文件挤掉文件夹', async () => {
  const { root } = await fixture();
  await Promise.all(Array.from({ length: 501 }, (_, i) => writeFile(path.join(root, `file${i}.py`), '', 'utf8')));
  await mkdir(path.join(root, 'z-folder'));
  const directory = await createWorkspaceFilesService().list({
    id: 'workspace',
    name: '演示',
    localDir: root,
    sshHost: 'my-server',
    remoteDir: '~/projects/demo',
  });
  expect(directory.entries[0]).toMatchObject({ name: 'z-folder', kind: 'directory' });
  expect(directory.entries).toHaveLength(500);
  expect(directory.truncated).toBe(true);
});
