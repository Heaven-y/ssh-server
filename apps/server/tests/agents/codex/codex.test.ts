import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent, Workspace } from '@agentdeck/shared';
import type { PermissionAnswer, TurnHandle } from '../../../src/agents/types';
import {
  runCodexTurn as nativeRunCodexTurn,
  listCodexSessions,
  readCodexSession,
  assertCodexSession,
} from '../../../src/agents/codex';
import { CodexClient } from '../../../src/agents/codex/client';
import { CodexEventMapper } from '../../../src/agents/codex/mapper';

const dirs: string[] = [];
const watchers: FSWatcher[] = [];
const turns: TurnHandle[] = [];
function runCodexTurn(...args: Parameters<typeof nativeRunCodexTurn>) {
  const handle = nativeRunCodexTurn(...args);
  turns.push(handle);
  return handle;
}
type LoggedMessage = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown> & { config?: Record<string, unknown> };
  result?: unknown;
};
const command = {
  command: process.execPath,
  args: ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./fake-app-server.ts', import.meta.url))],
};
afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.close();
  // 即使准备阶段的断言失败，也先停止本用例的进程，再清理其工作目录。
  await Promise.allSettled(
    turns.splice(0).map(async (handle) => {
      try {
        await handle.interrupt();
      } finally {
        await handle.done;
      }
    }),
  );
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(mode = 'normal') {
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-codex-test-'));
  dirs.push(dir);
  const workspace: Workspace = {
    id: 'workspace',
    name: '测试',
    dir,
    server: 'my-server',
    remoteDir: '~/projects/demo',
  };
  const log = path.join(dir, 'rpc.jsonl');
  const options = { command, env: { CODEX_HOME: dir, CODEX_TEST_MODE: mode, CODEX_TEST_LOG: log } };
  const messages = async (): Promise<LoggedMessage[]> => {
    try {
      return (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LoggedMessage);
    } catch {
      return [];
    }
  };
  const waitForMethod = (method: string) =>
    new Promise<void>((resolve, reject) => {
      const inspect = async () => {
        if (!(await messages()).some((value) => value.method === method)) return;
        watcher.close();
        resolve();
      };
      const watcher = watch(dir, () => {
        void inspect().catch(reject);
      });
      watchers.push(watcher);
      watcher.once('error', reject);
      // 日志只在假进程真正收到 RPC 后写入；不把父进程函数入队当作请求已送达。
      void inspect().catch(reject);
    });
  return { dir, workspace, options, messages, waitForMethod };
}

describe('Codex app-server 核心边界', () => {
  it('真实子进程处理 UTF-8 分片、超时和意外退出且不透出 stderr', async () => {
    const { dir, options } = await setup();
    // timeoutMs 既是「请求超时」这个产品行为的阈值，也是本次连接等子进程启动的预算。
    // 500ms 在并行跑 100+ worker 时不够 tsx 启动，会把 startup 慢误报成超时；
    // 3 秒仍能验证「挂起的请求一定会以超时失败」，又不会被调度噪声打成红灯。
    const client = await CodexClient.start({ ...options, cwd: dir, timeoutMs: 3000 });
    try {
      await client.initialize();
      expect(await client.request('echo', {})).toEqual({ value: '中文分片' });
      await expect(client.request('hang', {})).rejects.toThrow('超时');
      await expect(client.request('exit', {})).rejects.toThrow('意外退出');
    } finally {
      await client.close();
    }
  });

  it('超过 8 MiB 的响应明确失败', async () => {
    const { dir, options } = await setup();
    const client = await CodexClient.start({ ...options, cwd: dir });
    try {
      await expect(client.request('oversize', {})).rejects.toThrow('8 MiB');
    } finally {
      await client.close();
    }
  });

  it('限制待处理请求数量，并在关闭时拒绝所有等待者', async () => {
    const { dir, options } = await setup();
    const client = await CodexClient.start({ ...options, cwd: dir });
    try {
      await client.initialize();
      const pending = Promise.allSettled(Array.from({ length: 128 }, () => client.request('hang', {})));
      await expect(client.request('hang', {})).rejects.toThrow('请求过多');
      await client.close();
      expect((await pending).every((value) => value.status === 'rejected')).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('默认配置只保留原生指令，不追加应用约束或注入 MCP', async () => {
    const { workspace, options, messages } = await setup();
    const events: AgentEvent[] = [];
    await runCodexTurn(
      {
        workspace,
        text: '你好',
        emit: (event) => events.push(event),
        requestPermission: async () => ({ allow: false }),
      },
      options,
    ).done;
    const records = await messages();
    const start = records.find((value) => value.method === 'thread/start')?.params;
    expect(start).toMatchObject({ cwd: workspace.dir, approvalsReviewer: 'user' });
    // 审批与沙箱策略沿用原生配置，网页不再用常量覆盖
    expect(start).not.toHaveProperty('sandbox');
    expect(start).not.toHaveProperty('approvalPolicy');
    expect(start?.developerInstructions).toBe('原生约束');
    expect(start?.config).toEqual({});
    expect(JSON.stringify(records)).not.toContain('AGENTDECK');
    expect(start).not.toHaveProperty('model');
    expect(start).not.toHaveProperty('modelProvider');
    expect(events.filter((event) => event.type === 'session')).toEqual([
      { type: 'session', sessionId: 'native-thread', cwd: workspace.dir, model: 'native-model', agent: 'codex' },
    ]);
    expect(events.filter((event) => event.type === 'text')).toEqual([{ type: 'text', delta: '流式回复' }]);
    expect(events.filter((event) => event.type === 'turn_end')).toEqual([
      { type: 'turn_end', isError: false, durationMs: 30, forkPoint: 'native-turn' },
    ]);
  });

  it('准备阶段取消后不创建线程也不启动模型', async () => {
    const { workspace, options, messages, waitForMethod } = await setup('wait-config');
    const events: AgentEvent[] = [];
    const handle = runCodexTurn(
      {
        workspace,
        text: '你好',
        emit: (event) => events.push(event),
        requestPermission: async () => ({ allow: false }),
      },
      options,
    );
    await waitForMethod('config/read');
    await handle.interrupt();
    await handle.done;
    expect((await messages()).some((value) => value.method === 'thread/start' || value.method === 'turn/start')).toBe(
      false,
    );
    expect(events).toEqual([{ type: 'turn_end', isError: false }]);
  });

  it('turn/start 响应之前停止，获得原生 turnId 后补发 interrupt', async () => {
    const { workspace, options, messages, waitForMethod } = await setup('delayed-start');
    const events: AgentEvent[] = [];
    const handle = runCodexTurn(
      {
        workspace,
        text: '你好',
        model: 'selected-model',
        reasoningEffort: 'custom-effort',
        emit: (event) => events.push(event),
        requestPermission: async () => ({ allow: false }),
      },
      options,
    );
    await waitForMethod('turn/start');
    await handle.interrupt();
    await handle.done;
    const records = await messages();
    expect(records.find((value) => value.method === 'turn/start')?.params).toMatchObject({
      model: 'selected-model',
      effort: 'custom-effort',
    });
    expect(records.find((value) => value.method === 'turn/interrupt')?.params).toEqual({
      threadId: 'native-thread',
      turnId: 'native-turn',
    });
    expect(events.filter((event) => event.type === 'turn_end')).toEqual([
      { type: 'turn_end', isError: false, durationMs: 30, forkPoint: 'native-turn' },
    ]);
  });

  it('原生进程不回应停止时，5 秒后强制结束', async () => {
    const { workspace, options, waitForMethod } = await setup('ignore-interrupt');
    const events: AgentEvent[] = [];
    const handle = runCodexTurn(
      {
        workspace,
        text: '你好',
        emit: (event) => events.push(event),
        requestPermission: async () => ({ allow: false }),
      },
      options,
    );
    await waitForMethod('turn/start');
    await handle.interrupt();
    await handle.done;
    expect(events.filter((event) => event.type === 'turn_end')).toEqual([{ type: 'turn_end', isError: false }]);
    // 断言的是「5 秒后一定会被强杀」，不是「总共不超过 10 秒」。全量并行（100+ worker）时
    // 子进程调度会被拖慢，10 秒余量不够，故放宽外层超时；被测行为本身（5 秒强杀）不变。
  }, 30_000);

  it.each(['approval-command', 'approval-permissions'])('审批 %s 使用原始 RPC ID 与单次权限', async (mode) => {
    const { workspace, options, messages } = await setup(mode);
    const events: AgentEvent[] = [];
    await runCodexTurn(
      {
        workspace,
        text: '执行',
        emit: (event) => events.push(event),
        requestPermission: async () => ({ allow: true }),
      },
      options,
    ).done;
    const response = (await messages()).find((value) => value.id === 'native-approval-id');
    expect(response?.result).toEqual(
      mode === 'approval-command'
        ? { decision: 'accept' }
        : {
            permissions: { network: { enabled: true }, fileSystem: { read: ['project'], write: null } },
            scope: 'turn',
          },
    );
    const requested = events.find((event) => event.type === 'permission_request');
    expect(requested?.requestId).not.toBe('native-approval-id');
    expect(events.find((event) => event.type === 'permission_resolved')).toMatchObject({
      requestId: requested?.requestId,
      decision: 'allowed',
    });
  });

  it('停止清理待审批，迟到允许答复不能再次响应', async () => {
    const { workspace, options, messages } = await setup('approval-command');
    const events: AgentEvent[] = [];
    let answer!: (value: PermissionAnswer) => void;
    let requested!: () => void;
    const awaitingAnswer = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const handle = runCodexTurn(
      {
        workspace,
        text: '执行',
        emit: (event) => events.push(event),
        requestPermission: () =>
          new Promise((resolve) => {
            answer = resolve;
            requested();
          }),
      },
      options,
    );
    try {
      await Promise.race([
        awaitingAnswer,
        handle.done.then(() => {
          throw new Error('回合未请求审批就已结束');
        }),
      ]);
      expect(events.some((event) => event.type === 'permission_request')).toBe(true);
      await handle.interrupt();
      await handle.done;
      answer({ allow: true });
      await Promise.resolve();
      expect((await messages()).filter((value) => value.id === 'native-approval-id')).toEqual([
        { id: 'native-approval-id', result: { decision: 'cancel' } },
      ]);
      expect(events.filter((event) => event.type === 'permission_resolved')).toMatchObject([{ decision: 'cancelled' }]);
    } finally {
      await handle.interrupt();
      await handle.done;
    }
  });

  it('未知服务器交互返回 JSON-RPC 不支持错误', async () => {
    const { workspace, options, messages } = await setup('unknown-request');
    await runCodexTurn(
      {
        workspace,
        text: '执行',
        emit: () => {},
        requestPermission: async () => ({ allow: true }),
      },
      options,
    ).done;
    expect((await messages()).find((value) => value.id === 900)).toMatchObject({ error: { code: -32601 } });
  });

  it('待审批时异常退出，清理审批并仅结束一次', async () => {
    const { workspace, options } = await setup('approval-exit');
    const events: AgentEvent[] = [];
    await runCodexTurn(
      {
        workspace,
        text: '执行',
        emit: (event) => events.push(event),
        requestPermission: () => new Promise(() => {}),
      },
      options,
    ).done;
    expect(events.filter((event) => event.type === 'permission_resolved')).toMatchObject([{ decision: 'cancelled' }]);
    expect(events.filter((event) => event.type === 'turn_end')).toEqual([{ type: 'turn_end', isError: true }]);
  });

  it.each(['rpc-error', 'turn-failed'])('原生 %s 映射为明确的错误轮次，不暴露诊断原文', async (mode) => {
    const { workspace, options } = await setup(mode);
    const events: AgentEvent[] = [];
    await runCodexTurn(
      {
        workspace,
        sessionId: 'native-thread',
        text: '续接',
        emit: (event) => events.push(event),
        requestPermission: async () => ({ allow: false }),
      },
      options,
    ).done;
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn_end')).toMatchObject([{ isError: true }]);
    expect(JSON.stringify(events)).not.toContain('fixture-sensitive-diagnostic');
  });
});

describe('原生会话读取', () => {
  it('遍历全部目录分页并排除内部子代理，由服务统一裁决归属', async () => {
    const { dir, options, messages } = await setup();
    expect((await listCodexSessions(dir, options)).map((value) => value.sessionId)).toEqual([
      'native-thread',
      'foreign',
      'second',
    ]);
    const records = (await messages()).filter((value) => value.method === 'thread/list');
    expect(records).toHaveLength(2);
    expect(records.every((entry) => entry.params?.cwd === undefined)).toBe(true);
    expect(records[0]?.params).toMatchObject({
      sourceKinds: ['cli', 'vscode', 'exec', 'appServer'],
      modelProviders: [],
    });
  });
  it('列表复用原生分页模型元数据，不为每条记录读取历史', async () => {
    const { dir, options, messages } = await setup();
    const sessions = await listCodexSessions(dir, options);
    expect(sessions[0]).toMatchObject({ nativeModel: 'native-model' });
    expect((await messages()).some((value) => value.method === 'thread/read')).toBe(false);
  });
  it('读取完整历史之前验证 cwd，禁止跨工作区读取与续接', async () => {
    const { dir, workspace, options, messages } = await setup();
    await expect(assertCodexSession('foreign', dir, options)).rejects.toThrow('不属于');
    await expect(readCodexSession('foreign', dir, options)).rejects.toThrow('不属于');
    const events: AgentEvent[] = [];
    await runCodexTurn(
      {
        workspace,
        sessionId: 'foreign',
        text: '续接',
        emit: (event) => events.push(event),
        requestPermission: async () => ({ allow: false }),
      },
      options,
    ).done;
    expect(
      (await messages()).some((value) => value.method === 'thread/resume' || value.params?.includeTurns === true),
    ).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'turn_end', isError: true });
  });
  it('历史保留原生 thread.id、会话记录模型和毫秒时间，不把配置元数据当执行遥测', async () => {
    const { dir, options } = await setup();
    const history = await readCodexSession('native-thread', dir, options);
    expect(history.session).toMatchObject({ sessionId: 'native-thread', lastModified: 10_000 });
    expect(history.session).toMatchObject({ nativeModel: 'native-model' });
    expect(history.actualModel).toBeUndefined();
    expect(history.events).toEqual([
      { type: 'user_message', text: '历史问题' },
      { type: 'text', delta: '历史回复' },
      { type: 'turn_end', isError: false, forkPoint: 'old-turn' },
    ]);
  });
  it('重复 cursor 明确失败，避免把截断列表当作完整列表', async () => {
    const { dir, options } = await setup('cursor-loop');
    await expect(listCodexSessions(dir, options)).rejects.toThrow('分页异常');
  });
  it('原生只返回历史摘要时明确失败，不冒充完整记录', async () => {
    const { dir, options } = await setup('partial-history');
    await expect(readCodexSession('native-thread', dir, options)).rejects.toThrow('尚未完整加载');
  });
  it('读取准备阶段响应外部取消', async () => {
    const { dir, options } = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(listCodexSessions(dir, { ...options, signal: controller.signal })).rejects.toThrow('取消');
  });
});

it('映射工具调用与结果只输出一次，并限制工具输出长度', () => {
  const mapper = new CodexEventMapper();
  const item = {
    id: 'command',
    type: 'commandExecution',
    command: 'echo test',
    status: 'completed',
    aggregatedOutput: 'x'.repeat(25_000),
    exitCode: 1,
  };
  expect(mapper.map('item/started', { item })).toMatchObject([{ type: 'tool_call', id: 'command' }]);
  const completed = mapper.map('item/completed', { item });
  expect(completed).toMatchObject([{ type: 'tool_result', id: 'command', isError: true }]);
  expect(JSON.stringify(completed).length).toBeLessThan(21_000);
  expect(mapper.finishItems({ items: [item] })).toEqual([]);
});

it('实时分叉点核验完成快照自身的轮次身份，不采纳外来 turn.id', async () => {
  const { workspace, options } = await setup('foreign-turn-completion');
  const events: AgentEvent[] = [];
  await runCodexTurn(
    {
      workspace,
      text: '核验分叉点',
      emit: (event) => events.push(event),
      requestPermission: async () => ({ allow: false }),
    },
    options,
  ).done;
  expect(events.filter((event) => event.type === 'turn_end')).toEqual([
    { type: 'turn_end', isError: false, durationMs: 30, forkPoint: 'native-turn' },
  ]);
  expect(events).not.toContainEqual({ type: 'text', delta: '不属于本轮' });
});
