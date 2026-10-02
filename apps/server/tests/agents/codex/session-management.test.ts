import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionActionInput } from '@ssh-server/shared';
import { listCodexSessions, mutateCodexSession } from '../../../src/agents/codex';

type Message = { method?: string; params?: Record<string, unknown>; fixtureCompleted?: string };
const dirs: string[] = [];
const command = {
  command: process.execPath,
  args: ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./fake-app-server.ts', import.meta.url))],
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(mode = 'normal') {
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-codex-management-'));
  dirs.push(dir);
  const log = path.join(dir, 'rpc.jsonl');
  const options = { command, env: { CODEX_HOME: dir, CODEX_TEST_MODE: mode, CODEX_TEST_LOG: log } };
  const messages = async (): Promise<Message[]> => {
    try {
      return (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Message);
    } catch {
      return [];
    }
  };
  return { dir, options, messages };
}

describe('Codex 原生会话管理', () => {
  it('四种操作均先读 metadata，再发送对应官方请求', async () => {
    const { dir, options, messages } = await setup();
    const actions: SessionActionInput[] = [
      { action: 'rename', title: '新会话标题' },
      { action: 'archive' },
      { action: 'unarchive' },
      { action: 'delete', confirmed: true },
    ];
    for (const action of actions) await mutateCodexSession('native-thread', dir, action, options);
    const requests = (await messages()).filter((value) => value.method?.startsWith('thread/'));
    const metadata = { method: 'thread/read', params: { threadId: 'native-thread', includeTurns: false } };
    expect(requests.map(({ method, params }) => ({ method, params }))).toEqual([
      metadata,
      { method: 'thread/name/set', params: { threadId: 'native-thread', name: '新会话标题' } },
      metadata,
      { method: 'thread/archive', params: { threadId: 'native-thread' } },
      metadata,
      { method: 'thread/unarchive', params: { threadId: 'native-thread' } },
      metadata,
      { method: 'thread/delete', params: { threadId: 'native-thread' } },
    ]);
  });

  it.each([
    { mode: 'normal', id: 'foreign', status: 404, code: 'session_missing' },
    { mode: 'wrong-session-id', id: 'native-thread', status: 404, code: 'session_missing' },
    { mode: 'active-session', id: 'native-thread', status: 409, code: 'session_busy' },
    { mode: 'subagent-session', id: 'native-thread', status: 400, code: 'unsupported_action' },
  ])('阻断 $mode/$id，不向原生发送删除请求', async ({ mode, id, status, code }) => {
    const { dir, options, messages } = await setup(mode);
    await expect(mutateCodexSession(id, dir, { action: 'delete', confirmed: true }, options)).rejects.toMatchObject({
      status,
      code,
    });
    expect(
      (await messages()).filter((value) => value.method?.startsWith('thread/')).map((value) => value.method),
    ).toEqual(['thread/read']);
  });

  it('已归档列表的每一页都携带 archived 参数并保持工作区过滤', async () => {
    const { dir, options, messages } = await setup();
    expect((await listCodexSessions(dir, { ...options, archived: true })).map((value) => value.sessionId)).toEqual([
      'native-thread',
      'second',
    ]);
    const pages = (await messages()).filter((value) => value.method === 'thread/list');
    expect(pages).toHaveLength(2);
    for (const page of pages) expect(page.params).toMatchObject({ cwd: dir, archived: true });
  });

  it('管理请求已发送后收到 abort，仍等原生结果而不假称回滚', async () => {
    const { dir, options, messages } = await setup('delayed-mutation');
    const controller = new AbortController();
    const pending = mutateCodexSession(
      'native-thread',
      dir,
      { action: 'delete', confirmed: true },
      { ...options, signal: controller.signal },
    );
    await vi.waitFor(async () =>
      expect((await messages()).some((value) => value.method === 'thread/delete')).toBe(true),
    );
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect((await messages()).some((value) => value.fixtureCompleted === 'thread/delete')).toBe(true);
  });
});
