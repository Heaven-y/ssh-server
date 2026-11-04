import { expect, it, vi } from 'vitest';
import { createConfiguredRunner } from '../../src/agents/configured-runner';
import type { AgentTurnInput, TurnRunner } from '../../src/agents/types';
import path from 'node:path';

const input = (sessionId?: string): AgentTurnInput => ({
  workspace: { id: 'project', name: '示例', dir: path.resolve('fixtures', 'project') },
  sessionId,
  text: '本地夹具',
  emit: vi.fn(),
  requestPermission: vi.fn(),
});
it('新进程读取环境，已有会话保持快照，显式重启后采用新环境', async () => {
  let key = 'first';
  const applied: string[] = [];
  const dispose = vi.fn(async () => undefined);
  const runner = createConfiguredRunner({
    environment: async () => ({ API_KEY: key }),
    create: (env) => {
      applied.push(env.API_KEY!);
      const native: TurnRunner = (value) => {
        value.emit({
          type: 'session',
          sessionId: value.sessionId ?? 'learned',
          model: 'fixture',
          cwd: value.workspace.dir,
        });
        return { done: Promise.resolve(), interrupt: async () => undefined };
      };
      native.dispose = dispose;
      return native;
    },
  });
  await runner(input()).done;
  key = 'second';
  await runner(input('learned')).done;
  expect(applied).toEqual(['first']);
  await runner.restart();
  await runner(input('learned')).done;
  expect(applied).toEqual(['first', 'second']);
  expect(dispose).toHaveBeenCalledTimes(1);
  await runner.dispose?.();
});
it('环境准备中停止不投递正文，准备和运行期间不允许重启', async () => {
  let resolve!: (env: NodeJS.ProcessEnv) => void;
  const create = vi.fn(() => vi.fn() as TurnRunner);
  const runner = createConfiguredRunner({
    environment: () =>
      new Promise((done) => {
        resolve = done;
      }),
    create,
  });
  const handle = runner(input());
  await expect(runner.restart()).rejects.toThrow();
  const stopped = handle.interrupt();
  resolve({});
  await stopped;
  await handle.done;
  expect(create).not.toHaveBeenCalled();
  await runner.dispose?.();
});

it('退出不等待永不结束的interrupt才调用原生清理', async () => {
  const dispose = vi.fn(async () => undefined);
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const native: TurnRunner = () => {
    started();
    return { done: new Promise(() => undefined), interrupt: () => new Promise(() => undefined) };
  };
  native.dispose = dispose;
  const runner = createConfiguredRunner({ environment: async () => ({}), create: () => native });
  runner(input('running'));
  await running;
  await runner.dispose?.();
  expect(dispose).toHaveBeenCalledOnce();
});
