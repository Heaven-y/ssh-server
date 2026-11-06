import { afterEach, expect, it, vi } from 'vitest';
import { sessionsApi, sessionsKeys } from '../../../src/features/sessions/api';
import { respond } from '../../fixtures/http';
afterEach(() => vi.unstubAllGlobals());
it('会话请求和缓存按 Agent 隔离，历史读取传递取消信号', async () => {
  respond(200, []);
  await sessionsApi.sessionEvents('w/1', 's 1', 'claude');
  expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/projects/w%2F1/sessions/claude/s%201');
  await sessionsApi.listSessions('w/1', 'codex');
  expect(vi.mocked(fetch).mock.calls[1]).toEqual([
    '/api/projects/w%2F1/sessions?agent=codex',
    expect.objectContaining({ cache: 'no-store' }),
  ]);
  const controller = new AbortController();
  await sessionsApi.sessionEvents('w/1', 's 1', 'codex', controller.signal);
  expect(vi.mocked(fetch).mock.calls[2]).toEqual([
    '/api/projects/w%2F1/sessions/codex/s%201',
    expect.objectContaining({ cache: 'no-store', signal: controller.signal }),
  ]);
  expect(sessionsKeys.sessions('w/1', 'claude')).not.toEqual(sessionsKeys.sessions('w/1', 'codex'));
});
it('归档查询独立缓存，管理 POST 保留确认且不绑定取消信号', async () => {
  respond(200, []);
  await sessionsApi.listSessions('w/1', 'claude');
  await sessionsApi.listSessions('w/1', 'codex', true);
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
    '/api/projects/w%2F1/sessions?agent=claude',
    '/api/projects/w%2F1/sessions?agent=codex&archived=true',
  ]);
  expect(sessionsKeys.sessions('w/1', 'codex')).toEqual(['sessions', 'w/1', 'codex']);
  expect(sessionsKeys.sessions('w/1', 'codex', true)).toEqual(['sessions', 'w/1', 'codex', 'archived']);

  respond(204);
  await expect(
    sessionsApi.sessionAction('w/1', 's 1', 'codex', { action: 'delete', confirmed: true }),
  ).resolves.toBeUndefined();
  const [url, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(url).toBe('/api/projects/w%2F1/sessions/codex/s%201/actions');
  expect(init).toMatchObject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'delete', confirmed: true }),
  });
  expect(init).not.toHaveProperty('signal');
});
