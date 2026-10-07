import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, Workspace } from '@ssh-server/shared';
import type { PermissionAnswer } from '../../../src/agents/types';
import { runCodexTurn, listCodexSessions, readCodexSession, assertCodexSession } from '../../../src/agents/codex';
import { CodexClient } from '../../../src/agents/codex/client';
import { CodexEventMapper } from '../../../src/agents/codex/mapper';

const dirs: string[] = [];
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
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(mode = 'normal') {
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-codex-test-'));
  dirs.push(dir);
  const workspace: Workspace = {
    id: 'workspace',
    name: '测试',
    localDir: dir,
    sshHost: 'my-server',
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
  const waitForMethod = async (method: string) =>
    vi.waitFor(async () => expect((await messages()).some((value) => value.method === method)).toBe(true));
  return { dir, workspace, options, messages, waitForMethod };
}

describe('Codex app-server 核心边界', () => {
  it('真实子进程处理 UTF-8 分片、超时和意外退出且不透出 stderr', async () => {
    const { dir, options } = await setup();
    const client = await CodexClient.start({ ...options, cwd: dir, timeoutMs: 500 });
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

  it('默认配置只追加指令与自己的 MCP，实际令牌不进入协议参数', async () => {
    const { workspace, options, messages } = await setup();
    const events: AgentEvent[] = [];
    await runCodexTurn(
      {
        workspace,
        text: '你好',
        mcpEnv: { SSH_SERVER_TOKEN: 'synthetic-private-value' },
        emit: (event) => events.push(event),
        requestPermission: async () => ({ allow: false }),
      },
      options,
    ).done;
    const records = await messages();
    const start = records.find((value) => value.method === 'thread/start')?.params;
    expect(start).toMatchObject({ cwd: workspace.localDir, sandbox: 'workspace-write', approvalPolicy: 'on-request' });
    expect(start?.developerInstructions).toContain('原生约束');
    expect(start?.developerInstructions).toContain('remote_exec');
    expect(start?.config?.['mcp_servers.ssh-server']).toMatchObject({ required: true, env_vars: ['SSH_SERVER_TOKEN'] });
    expect(start?.config?.['shell_environment_policy.set.SSH_SERVER_TOKEN']).toBe('');
    expect(JSON.stringify(records)).not.toContain('synthetic-private-value');
    expect(start).not.toHaveProperty('model');
    expect(start).not.toHaveProperty('modelProvider');
    expect(events.filter((event) => event.type === 'session')).toEqual([
      { type: 'session', sessionId: 'native-thread', cwd: workspace.localDir, model: 'native-model', agent: 'codex' },
    ]);
    expect(events.filter((event) => event.type === 'text')).toEqual([{ type: 'text', delta: '流式回复' }]);
    expect(events.filter((event) => event.type === 'turn_end')).toHaveLength(1);
  });

  it('准备阶段取消后不创建线程也不启动模型', async () => {
    const { workspace, options, messages, waitForMethod } = await setup('wait-config');
    const events: AgentEvent[] = [];
    const handle = runCodexTurn(
      {
        workspace,
        text: '你好',
        mcpEnv: {},
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
        mcpEnv: {},
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
      { type: 'turn_end', isError: false, durationMs: 30 },
    ]);
  });

  it('原生进程不回应停止时，5 秒后强制结束', async () => {
    const { workspace, options, waitForMethod } = await setup('ignore-interrupt');
    const events: AgentEvent[] = [];
    const handle = runCodexTurn(
      {
        workspace,
        text: '你好',
        mcpEnv: {},
        emit: (event) => events.push(event),
        requestPermission: async () => ({ allow: false }),
      },
      options,
    );
    await waitForMethod('turn/start');
    await handle.interrupt();
    await handle.done;
    expect(events.filter((event) => event.type === 'turn_end')).toEqual([{ type: 'turn_end', isError: false }]);
  }, 10_000);

  it.each(['approval-command', 'approval-permissions'])('审批 %s 使用原始 RPC ID 与单次权限', async (mode) => {
    const { workspace, options, messages } = await setup(mode);
    const events: AgentEvent[] = [];
    await runCodexTurn(
      {
        workspace,
        text: '执行',
        mcpEnv: {},
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
    const handle = runCodexTurn(
      {
        workspace,
        text: '执行',
        mcpEnv: {},
        emit: (event) => events.push(event),
        requestPermission: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
      options,
    );
    await vi.waitFor(() => expect(events.some((event) => event.type === 'permission_request')).toBe(true));
    await handle.interrupt();
    await handle.done;
    answer({ allow: true });
    await Promise.resolve();
    expect((await messages()).filter((value) => value.id === 'native-approval-id')).toEqual([
      { id: 'native-approval-id', result: { decision: 'cancel' } },
    ]);
    expect(events.filter((event) => event.type === 'permission_resolved')).toMatchObject([{ decision: 'cancelled' }]);
  });

  it('未知服务器交互返回 JSON-RPC 不支持错误', async () => {
    const { workspace, options, messages } = await setup('unknown-request');
    await runCodexTurn(
      { workspace, text: '执行', mcpEnv: {}, emit: () => {}, requestPermission: async () => ({ allow: true }) },
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
        mcpEnv: {},
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
        mcpEnv: {},
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
  it('遍历全部分页并排除其他目录与内部子代理', async () => {
    const { dir, options, messages } = await setup();
    expect((await listCodexSessions(dir, options)).map((value) => value.sessionId)).toEqual([
      'native-thread',
      'second',
    ]);
    const records = (await messages()).filter((value) => value.method === 'thread/list');
    expect(records).toHaveLength(2);
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
        mcpEnv: {},
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
      { type: 'turn_end', isError: false },
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
