import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { createClaudeCapabilityDiscovery } from '../../src/agents/claude-capabilities';
import { CLAUDE_CONTROL_TIMEOUT_MS, type QueryFn } from '../../src/agents/claude-query';

const directory = path.join(os.tmpdir(), 'ssh-server-fixture', 'capabilities');
const fixture = { name: 'fixture', description: '项目技能', argumentHint: '<任务>' };
function discovery(readCommands: () => Promise<SlashCommand[]>) {
  const calls: Array<Parameters<QueryFn>[0]> = [];
  const close = vi.fn();
  const queryFn: QueryFn = (input) => {
    calls.push(input);
    return Object.assign((async function* () {})(), {
      interrupt: async () => undefined,
      close,
      supportedCommands: readCommands,
      supportedModels: async (): Promise<ModelInfo[]> => [
        {
          value: 'native-suggestion',
          displayName: '原生建议',
          description: '仅建议',
          supportedEffortLevels: ['low', 'high'],
        },
      ],
      getContextUsage: async () => {
        throw new Error('能力发现不应读取上下文');
      },
    });
  };
  return { discover: createClaudeCapabilityDiscovery(queryFn), calls, close };
}
afterEach(() => vi.useRealTimers());

describe('Claude 原生能力发现', () => {
  it('空消息发现保留技能身份与不可用压缩占位，模型目录不变成默认覆盖', async () => {
    const fake = discovery(async () => [
      { ...fixture, name: 'compact' },
      fixture,
      { ...fixture, name: 'duplicate' },
      { ...fixture, name: 'duplicate' },
      { name: 'usage', description: '原生用量', argumentHint: '', builtin: true, aliases: ['cost'] },
    ]);
    const catalog = await fake.discover(directory);
    const compact = catalog.entries.filter((entry) => entry.name === 'compact');
    expect(compact).toMatchObject([
      { kind: 'skill', available: true, invocation: { kind: 'skill', name: 'compact' } },
      { kind: 'command', available: false, requiresSession: true },
    ]);
    expect(new Set(compact.map((entry) => entry.id)).size).toBe(2);
    expect(catalog.entries.find((entry) => entry.name === 'duplicate')).toMatchObject({ available: false });
    expect(catalog.entries.find((entry) => entry.name === 'usage')).toMatchObject({
      available: false,
      aliases: ['cost'],
    });
    expect(catalog.entries.find((entry) => entry.name === 'context')).toMatchObject({
      available: true,
      supportsArguments: false,
      requiresSession: true,
    });
    expect(catalog.models).toEqual([
      { id: 'native-suggestion', label: '原生建议', description: '仅建议', reasoningEfforts: ['low', 'high'] },
    ]);
    expect(catalog.warnings).toEqual([]);
    const input = fake.calls[0]!;
    expect(input.options).toMatchObject({
      cwd: directory,
      settingSources: ['user', 'project', 'local'],
      persistSession: false,
    });
    expect(input.options).not.toHaveProperty('model');
    expect((await input.prompt[Symbol.asyncIterator]().next()).done).toBe(true);
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it('命令分支超时保留模型建议并关闭 Query', async () => {
    vi.useFakeTimers();
    const fake = discovery(() => new Promise(() => undefined));
    const pending = fake.discover(directory);
    await vi.advanceTimersByTimeAsync(CLAUDE_CONTROL_TIMEOUT_MS);
    const catalog = await pending;
    expect(catalog.entries).toEqual([]);
    expect(catalog.models[0]?.id).toBe('native-suggestion');
    expect(catalog.warnings).toHaveLength(1);
    expect(fake.close).toHaveBeenCalledOnce();
    expect((await fake.calls[0]!.prompt[Symbol.asyncIterator]().next()).done).toBe(true);
  });

  it('调用方取消发现会退出等待，不返回旧目录并释放输入', async () => {
    const fake = discovery(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = fake.discover(directory, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('取消');
    expect(fake.close).toHaveBeenCalledOnce();
    expect((await fake.calls[0]!.prompt[Symbol.asyncIterator]().next()).done).toBe(true);
  });
  it('命令调用失败保留模型分支，关闭Query且不透出底层异常', async () => {
    const fake = discovery(async () => {
      throw new Error('private-native-details');
    });
    const catalog = await fake.discover(directory);
    expect(catalog.entries).toEqual([]);
    expect(catalog.models[0]?.id).toBe('native-suggestion');
    expect(catalog.warnings).toEqual(['Claude 技能与命令读取失败，请刷新重试']);
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it('尚未创建Query的初始化失败不会被close掩盖', async () => {
    const discover = createClaudeCapabilityDiscovery(() => {
      throw new Error('初始化失败');
    });
    await expect(discover(directory)).rejects.toThrow('初始化失败');
  });
});
