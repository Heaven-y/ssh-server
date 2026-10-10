import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionActionInput } from '@ssh-server/shared';
import { forkCodexSession, listCodexSessions, mutateCodexSession, readCodexSession } from '../../../src/agents/codex';

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
  const dir = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? tmpdir(), 'ssh-codex-management-'));
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

describe('Codex thread/fork', () => {
  it('指定点原样使用 inclusive lastTurnId；不覆盖 cwd/配置，不修改源线程或回退文件', async () => {
    const { dir, options, messages } = await setup('fork-normal');
    const result = await forkCodexSession('native-thread', dir, { pointId: 'old-turn' }, options);
    expect(result).toEqual({
      session: { sessionId: 'forked-thread', summary: '原生会话', lastModified: 10_000, nativeModel: 'native-model' },
      cwd: dir,
    });
    expect(
      (await messages())
        .filter((value) => value.method?.startsWith('thread/'))
        .map(({ method, params }) => ({ method, params })),
    ).toEqual([
      { method: 'thread/read', params: { threadId: 'native-thread', includeTurns: false } },
      { method: 'thread/read', params: { threadId: 'native-thread', includeTurns: true } },
      { method: 'thread/fork', params: { threadId: 'native-thread', lastTurnId: 'old-turn' } },
    ]);
  });

  it('默认末尾省略 lastTurnId，返回 thread.id 而不是共用的 sessionId 树根', async () => {
    const { dir, options, messages } = await setup('fork-normal');
    expect((await forkCodexSession('native-thread', dir, {}, options)).session.sessionId).toBe('forked-thread');
    expect((await messages()).find((value) => value.method === 'thread/fork')?.params).toEqual({
      threadId: 'native-thread',
    });
  });

  it.each([
    { mode: 'fork-normal', id: 'foreign', input: {}, status: 404, code: 'session_missing' },
    { mode: 'wrong-session-id', id: 'native-thread', input: {}, status: 404, code: 'session_missing' },
    { mode: 'active-session', id: 'native-thread', input: {}, status: 409, code: 'session_busy' },
    { mode: 'subagent-session', id: 'native-thread', input: {}, status: 400, code: 'unsupported_action' },
    {
      mode: 'fork-in-progress',
      id: 'native-thread',
      input: { pointId: 'old-turn' },
      status: 409,
      code: 'session_busy',
    },
    { mode: 'fork-in-progress', id: 'native-thread', input: {}, status: 409, code: 'session_busy' },
    {
      mode: 'fork-normal',
      id: 'native-thread',
      input: { pointId: 'foreign-point' },
      status: 400,
      code: 'invalid_fork_point',
    },
    {
      mode: 'fork-unknown-status',
      id: 'native-thread',
      input: { pointId: 'old-turn' },
      status: 400,
      code: 'invalid_fork_point',
    },
  ])('$mode/$id 不向原生发送分叉请求', async ({ mode, id, input, status, code }) => {
    const { dir, options, messages } = await setup(mode);
    await expect(forkCodexSession(id, dir, input, options)).rejects.toMatchObject({ status, code });
    expect((await messages()).some((value) => value.method === 'thread/fork')).toBe(false);
    if (id === 'foreign') expect((await messages()).some((value) => value.params?.includeTurns === true)).toBe(false);
  });

  it.each([
    'fork-same-id',
    'fork-empty-id',
    'fork-invalid-id',
    'fork-wrong-cwd',
    'fork-child-agent',
    'fork-wrong-source',
  ])('%s 新会话身份异常不误报成功', async (mode) => {
    const { dir, options, messages } = await setup(mode);
    await expect(forkCodexSession('native-thread', dir, {}, options)).rejects.toMatchObject({
      status: 503,
      code: 'session_runtime_failed',
    });
    expect(
      (await messages()).filter((value) => value.method?.startsWith('thread/')).map((value) => value.method),
    ).toEqual(['thread/read', 'thread/read', 'thread/fork']);
  });

  it('历史每个已结束原生轮次输出对应分叉点', async () => {
    const { dir, options } = await setup('fork-normal');
    const history = await readCodexSession('native-thread', dir, options);
    expect(history.events.filter((event) => event.type === 'turn_end')).toEqual([
      { type: 'turn_end', isError: false, forkPoint: 'old-turn' },
      { type: 'turn_end', isError: false, forkPoint: 'later-turn' },
    ]);
  });

  it('部分历史不能验证指定点；原生 RPC 错误不泄露诊断', async () => {
    const partial = await setup('partial-history');
    await expect(
      forkCodexSession('native-thread', partial.dir, { pointId: 'old-turn' }, partial.options),
    ).rejects.toThrow('尚未完整加载');
    expect((await partial.messages()).some((value) => value.method === 'thread/fork')).toBe(false);
    const failure = await setup('fork-rpc-error');
    const result = await forkCodexSession('native-thread', failure.dir, {}, failure.options).catch(
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).not.toContain('fixture-sensitive-fork-diagnostic');
  });

  it('分叉请求发出后的 abort 继续等待原生完成；发出前取消不启动进程', async () => {
    const { dir, options, messages } = await setup('fork-delayed');
    const controller = new AbortController();
    const pending = forkCodexSession('native-thread', dir, {}, { ...options, signal: controller.signal });
    await vi.waitFor(async () => expect((await messages()).some((value) => value.method === 'thread/fork')).toBe(true));
    controller.abort();
    await expect(pending).resolves.toMatchObject({ session: { sessionId: 'forked-thread' } });
    expect((await messages()).some((value) => value.fixtureCompleted === 'thread/fork')).toBe(true);
    const cancelled = await setup();
    await expect(
      forkCodexSession('native-thread', cancelled.dir, {}, { ...cancelled.options, signal: controller.signal }),
    ).rejects.toThrow('已取消');
    expect(await cancelled.messages()).toEqual([]);
  });
});
