import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, Workspace } from '@ssh-server/shared';
import { discoverCodexCapabilities, runCodexTurn } from '../../../src/agents/codex';
import { capabilityId } from '../../../src/agents/capability-types';
import type { AgentTurnInput } from '../../../src/agents/types';

type Message = {
  method?: string;
  params?: Record<string, unknown> & { config?: Record<string, unknown> };
  fixturePhase?: string;
};
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(mode = 'normal') {
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-codex-capability-'));
  dirs.push(dir);
  const log = path.join(dir, 'rpc.jsonl');
  const gate = path.join(dir, 'continue');
  const workspace: Workspace = {
    id: 'workspace',
    name: '能力测试',
    localDir: dir,
    sshHost: 'my-server',
    remoteDir: '~/projects/demo',
  };
  const options = {
    command: {
      command: process.execPath,
      args: ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./fake-app-server.ts', import.meta.url))],
    },
    env: { CODEX_HOME: dir, CODEX_TEST_MODE: mode, CODEX_TEST_LOG: log, CODEX_TEST_GATE: gate },
  };
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
  const waitFor = (predicate: (value: Message) => boolean) =>
    vi.waitFor(async () => expect((await messages()).some(predicate)).toBe(true));
  const events: AgentEvent[] = [];
  const input: AgentTurnInput = {
    workspace,
    text: '',
    mcpEnv: {},
    emit: (event) => events.push(event),
    requestPermission: async () => ({ allow: false }),
  };
  const skillPath = path.join(dir, '.agents', 'skills', 'example', 'SKILL.md');
  return { dir, options, messages, waitFor, events, input, skillPath, release: () => writeFile(gate, '', 'utf8') };
}

describe('Codex 原生能力目录与发送', () => {
  it('刷新技能、区分同名路径，完整分页模型且不返回默认覆盖', async () => {
    const { dir, options, messages, skillPath } = await setup('catalog');
    const catalog = await discoverCodexCapabilities(dir, options);
    const duplicates = catalog.entries.filter((entry) => entry.kind === 'skill' && entry.name === 'example');
    expect(new Set(duplicates.map((entry) => entry.id)).size).toBe(2);
    expect(duplicates).toContainEqual(
      expect.objectContaining({
        id: capabilityId('codex', 'skill', 'example', skillPath),
        invocation: { kind: 'skill', name: 'example', path: skillPath },
      }),
    );
    expect(catalog.entries.find((entry) => entry.name === 'disabled-skill')).toMatchObject({ available: false });
    expect(catalog.entries.find((entry) => entry.name === 'compact')).toMatchObject({
      available: true,
      requiresSession: true,
      supportsArguments: false,
    });
    expect(catalog.entries.find((entry) => entry.name === 'context')).toMatchObject({
      available: false,
      unavailableReason: expect.stringContaining('本机 CLI'),
    });
    expect(catalog.models).toEqual([
      {
        id: 'suggested-model',
        label: '建议模型',
        description: '仅作候选',
        reasoningEfforts: ['high', 'custom-effort'],
      },
      { id: 'other-model', label: '另一个模型', reasoningEfforts: [] },
    ]);
    expect(catalog.warnings).toHaveLength(1);
    expect(JSON.stringify(catalog.warnings)).not.toContain('fixture-private-diagnostic');
    const requests = await messages();
    expect(requests.find((value) => value.method === 'skills/list')?.params).toEqual({
      cwds: [dir],
      forceReload: true,
    });
    expect(requests.filter((value) => value.method === 'model/list').map((value) => value.params?.cursor)).toEqual([
      undefined,
      'next-page',
    ]);
  });

  it.each(['skills-fail', 'models-fail', 'model-loop'])('%s 只产生对应分支警告，不抹掉另一分支', async (mode) => {
    const { dir, options } = await setup(mode);
    const result = await discoverCodexCapabilities(dir, options);
    expect(result.models.length > 0).toBe(mode === 'skills-fail');
    expect(result.entries.some((entry) => entry.kind === 'skill')).toBe(mode !== 'skills-fail');
    expect(result.warnings).toHaveLength(1);
    expect(JSON.stringify(result.warnings)).not.toContain('fixture-private-diagnostic');
  });

  it('实际实例重新验证技能，允许无文本且不自动传模型或 effort', async () => {
    const { options, input, events, messages, skillPath } = await setup();
    await runCodexTurn({ ...input, invocation: { kind: 'skill', name: 'example', path: skillPath } }, options).done;
    const requests = await messages();
    expect(requests.filter((value) => value.method).map((value) => value.method)).toEqual([
      'initialize',
      'initialized',
      'config/read',
      'thread/start',
      'skills/list',
      'turn/start',
    ]);
    const start = requests.find((value) => value.method === 'turn/start')?.params;
    expect(start).toEqual({ threadId: 'native-thread', input: [{ type: 'skill', name: 'example', path: skillPath }] });
    const thread = requests.find((value) => value.method === 'thread/start')?.params;
    expect(thread).not.toHaveProperty('model');
    expect(thread?.config).not.toHaveProperty('model_reasoning_effort');
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', isError: false });
  });

  it.each(['unknown-path', 'skill-renamed', 'skill-disabled'])(
    '%s 在发送前明确拒绝，不静默降级为普通文本',
    async (mode) => {
      const { options, input, messages, events, skillPath } = await setup(mode);
      await runCodexTurn(
        {
          ...input,
          text: '任务正文',
          invocation: {
            kind: 'skill',
            name: 'example',
            path: mode === 'unknown-path' ? path.join(input.workspace.localDir, 'removed', 'SKILL.md') : skillPath,
          },
        },
        options,
      ).done;
      expect((await messages()).some((value) => value.method === 'skills/list')).toBe(true);
      expect((await messages()).some((value) => value.method === 'turn/start')).toBe(false);
      expect(events.filter((event) => event.type === 'error')).toMatchObject([
        { message: expect.stringContaining('失效、禁用或存在歧义') },
      ]);
      expect(events.at(-1)).toEqual({ type: 'turn_end', isError: true });
    },
  );

  it('等待同实例技能验证时停止，不发送模型轮次', async () => {
    const { options, input, messages, events, skillPath, waitFor } = await setup('wait-skills');
    const handle = runCodexTurn({ ...input, invocation: { kind: 'skill', name: 'example', path: skillPath } }, options);
    await waitFor((value) => value.method === 'skills/list');
    await handle.interrupt();
    await handle.done;
    expect((await messages()).some((value) => value.method === 'turn/start')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'turn_end', isError: false });
  });
});

describe('Codex 手动压缩', () => {
  const invocation = { kind: 'command' as const, name: 'compact' as const };
  it('resume 后调用官方压缩，收到 {} 仍等待当前 item 与 turn 完成', async () => {
    const { options, input, events, messages, waitFor, release } = await setup('compact-gated');
    const handle = runCodexTurn(
      { ...input, sessionId: 'native-thread', reasoningEffort: 'custom-effort', invocation },
      options,
    );
    try {
      await waitFor((value) => value.fixturePhase === 'compact-accepted');
      expect(events.filter((event) => event.type === 'compaction')).toMatchObject([
        { state: { status: 'running', trigger: 'manual' } },
      ]);
      expect(events.some((event) => event.type === 'turn_end')).toBe(false);
      const requests = await messages();
      expect(requests.find((value) => value.method === 'thread/resume')?.params?.config).toHaveProperty(
        'model_reasoning_effort',
        'custom-effort',
      );
      expect(requests.find((value) => value.method === 'thread/compact/start')?.params).toEqual({
        threadId: 'native-thread',
      });
      expect(requests.some((value) => value.method === 'turn/start')).toBe(false);
      await release();
      await handle.done;
      expect(events.filter((event) => event.type === 'compaction').map((event) => event.state.status)).toEqual([
        'running',
        'completed',
      ]);
      expect(events.at(-1)).toEqual({ type: 'turn_end', isError: false });
    } finally {
      await handle.interrupt();
      await handle.done;
    }
  });

  it.each(['compact-failed', 'compact-old-confirmation'])('%s 不能被误标为压缩成功', async (mode) => {
    const { options, input, events } = await setup(mode);
    await runCodexTurn({ ...input, sessionId: 'native-thread', invocation }, options).done;
    expect(events.filter((event) => event.type === 'compaction').map((event) => event.state.status)).toEqual([
      'running',
      'failed',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
  });

  it('已接受但尚无 turnId 时停止，收到当前 ID 后发送中断并显示 cancelled', async () => {
    const { options, input, events, messages, waitFor, release } = await setup('compact-gated-start');
    const handle = runCodexTurn({ ...input, sessionId: 'native-thread', invocation }, options);
    try {
      await waitFor((value) => value.fixturePhase === 'compact-accepted');
      await handle.interrupt();
      await release();
      await handle.done;
      expect((await messages()).find((value) => value.method === 'turn/interrupt')?.params).toEqual({
        threadId: 'native-thread',
        turnId: 'native-turn',
      });
      expect(events.filter((event) => event.type === 'compaction').map((event) => event.state.status)).toEqual([
        'running',
        'cancelled',
      ]);
    } finally {
      await handle.interrupt();
      await handle.done;
    }
  });
});
