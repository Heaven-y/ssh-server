import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { remoteFilesApi } from '../../../../../src/builtin-plugins/ssh-console/legacy/remote-files/api';
import { respond } from '../../../../fixtures/http';
afterEach(() => vi.unstubAllGlobals());
it('服务器浏览请求保留绑定令牌并正确传递工作区、目录和游标', async () => {
  const target = { sshHost: 'my-server', remoteDir: '~/projects/demo' };
  respond(200, { binding: 'fixture-binding' });
  const identity = await remoteFilesApi.bindRemoteBrowseTarget('w/1', target);
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/workspaces/w%2F1/remote-files/bindings');
  respond(200, { id: 'session/one' });
  const controller = new AbortController();
  await remoteFilesApi.createRemoteBrowseSession('w/1', target, identity.binding, controller.signal);
  const created = vi.mocked(fetch).mock.calls[0]?.[1];
  const createdBody = JSON.parse(created?.body as string);
  expect(createdBody).toMatchObject({ ...target, binding: identity.binding });
  // 绑定快照只带服务器别名与目录；工作区模型收敛后不再发送本地目录。
  expect(createdBody).not.toHaveProperty('localDir');
  expect(created?.signal).toBe(controller.signal);
  const remote = path.posix.join(path.posix.sep, 'fixture-home', 'data & weights');
  respond(200, { path: remote, entries: [] });
  await remoteFilesApi.listRemoteFiles('w/1', 'session/one', { path: remote, cursor: 'next-page' }, controller.signal);
  const [url, options] = vi.mocked(fetch).mock.calls[0]!;
  const parsed = new URL(url as string, 'https://example.invalid');
  expect(parsed.pathname).toBe('/api/workspaces/w%2F1/remote-files/sessions/session%2Fone');
  expect(parsed.searchParams.get('path')).toBe(remote);
  expect(parsed.searchParams.get('cursor')).toBe('next-page');
  expect(options).toMatchObject({ signal: controller.signal, cache: 'no-store' });
  respond(204);
  await remoteFilesApi.closeRemoteBrowseSession('w/1', 'session/one');
  expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE', keepalive: true });
});
it('远端文件操作只走对应工作区接口，提交绑定确认预检', async () => {
  respond(200, { path: 'a.txt' });
  await remoteFilesApi.remoteFileTaskAction('w/1', 'task 1', 'check');
  expect(vi.mocked(fetch).mock.calls[0]).toEqual([
    '/api/workspaces/w%2F1/remote-files/tasks/task%201/check',
    expect.objectContaining({ method: 'POST', body: '{}' }),
  ]);
  respond(200, { id: 'preflight' });
  await remoteFilesApi.submitRemoteFileTask('w/1', 'preflight-1');
  expect(vi.mocked(fetch).mock.calls[0]).toEqual([
    '/api/workspaces/w%2F1/remote-files/tasks',
    expect.objectContaining({ body: JSON.stringify({ preflightId: 'preflight-1', confirmed: true }) }),
  ]);
  expect(remoteFilesApi).not.toHaveProperty('recoverRemoteFileTask');
});
