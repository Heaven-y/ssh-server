import { once } from 'node:events';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { startRemoteSftpFixture } from '../helpers/remote-sftp';
import { createRemoteFilesService } from '../../src/remote-files/service';
import { createFileDownloads } from '../../src/remote-files/downloads';
import { registerRemoteFileActionRoutes } from '../../src/http/remote-file-actions.routes';
import type { FilePreflights } from '../../src/remote-files/preflight';
import type { FileTasks } from '../../src/remote-files/tasks';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function setup() {
  const remote = await startRemoteSftpFixture({ downloads: true });
  const browse = createRemoteFilesService({ pool: remote.pool, store: { get: async () => remote.workspace } });
  cleanups.push(async () => {
    browse.dispose();
    await remote.close();
  });
  const session = await browse.open(remote.workspace.id, {
    ...remote.target,
    ...(await browse.binding(remote.workspace.id, remote.target)),
  });
  const downloads = createFileDownloads({ pool: remote.pool, browse });
  return { ...remote, browse, session, downloads };
}

it('真实 SFTP 普通文件经 HTTP 附件流传输，不访问同步或 Git，并拒绝链接', async () => {
  const remote = await setup();
  const app = Fastify();
  cleanups.push(() => app.close());
  const tasks = { dispose: async () => undefined } as FileTasks;
  registerRemoteFileActionRoutes(app, { downloads: remote.downloads, tasks, preflights: {} as FilePreflights });
  const base = `/api/workspaces/${remote.workspace.id}/remote-files/sessions/${remote.session.id}/download`;
  const response = await app.inject(
    `${base}?${new URLSearchParams({ path: path.posix.join(remote.root, 'train.py') }).toString()}`,
  );
  expect(response.statusCode).toBe(200);
  expect(response.payload).toBe('print(1)\nabc');
  expect(response.headers['content-length']).toBe('12');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-disposition']).toContain('attachment;');
  expect(remote.audit.commands).toBe(0);
  const before = remote.audit.bodyReads;
  const rejected = await app.inject(
    `${base}?${new URLSearchParams({ path: path.posix.join(remote.root, 'dataset-link') }).toString()}`,
  );
  expect(rejected.statusCode).toBe(400);
  expect(rejected.json().code).toBe('unsupported_file');
  expect(remote.audit.bodyReads).toBe(before);
});

it('暂停消费时保持有界缓冲，取消只关闭下载流，浏览会话仍可使用', async () => {
  const remote = await setup();
  const controller = new AbortController();
  const download = await remote.downloads.prepare(
    remote.workspace.id,
    remote.session.id,
    path.posix.join(remote.root, 'weights.bin'),
    controller.signal,
  );
  // 只拉取一段，然后停止消费；不能预读整个 4 MiB 文件。
  download.stream.read(1);
  await vi.waitFor(() => expect(download.stream.readableLength).toBeGreaterThan(0));
  // ssh2 的启动读取与预取可同时在途，水位是调度阈值而非硬上限。
  expect(download.stream.readableLength).toBeLessThanOrEqual(2 * 65_536);
  expect(remote.audit.bytesRead).toBeLessThanOrEqual(131_072);
  const closed = once(download.stream, 'close');
  controller.abort();
  await closed;
  expect(download.stream.destroyed).toBe(true);
  expect((await remote.browse.list(remote.workspace.id, remote.session.id, { path: '' })).path).toBe(remote.root);
  remote.browse.close(remote.workspace.id, remote.session.id);
  await vi.waitFor(() => expect(remote.resources().handles).toBe(0));
});
