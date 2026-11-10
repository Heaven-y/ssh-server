import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatSessionReference, type AgentEvent, type AgentKind } from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';
import type { SessionProvider } from '../../src/agents/contracts';
import { SessionError } from '../../src/agents/errors';
import { createSessionsService } from '../../src/sessions/service';
import { createSessionReader, type SessionReadPage } from '../../src/session-tools/reader';

const workspace: Workspace = { id: 'demo', name: '演示', dir: path.join(os.tmpdir(), 'session-reader', 'demo') };
const reference = (agent: AgentKind = 'claude', workspaceId = workspace.id) =>
  formatSessionReference({ workspaceId, agent, sessionId: 'native-session' });

function fixture(events?: AgentEvent[]) {
  const state = { events, cwd: workspace.dir, projects: [workspace], error: undefined as Error | undefined };
  function provider(agent: AgentKind): SessionProvider {
    return {
      list: async () => [],
      assertBelongs: async () => state.cwd,
      read: async (id, dir) => {
        if (state.error) throw state.error;
        return {
          session: { sessionId: id, summary: '摘要', lastModified: 1 },
          cwd: dir,
          events: state.events ?? [
            { type: 'user_message', text: `${agent} 用户` },
            { type: 'text', delta: `${agent} 回复` },
          ],
        };
      },
      mutate: async () => {
        throw new Error('只读工具不能修改原生会话');
      },
      fork: async () => {
        throw new Error('只读工具不能分叉原生会话');
      },
    };
  }
  const sessions = createSessionsService(
    { claude: provider('claude'), codex: provider('codex'), antigravity: provider('antigravity') },
    {
      projects: async () => state.projects,
      withIdleSession: async () => {
        throw new Error('只读工具不能请求写入');
      },
    },
  );
  const reader = createSessionReader({
    sessions,
    store: { get: async (id) => state.projects.find((item) => item.id === id) },
  });
  return { reader, state };
}

describe('跨 CLI 只读会话工具', () => {
  it.each(['claude', 'codex', 'antigravity'] as const)('按引用读取 %s 原生用户和助手历史', async (agent) => {
    const { reader } = fixture();
    const result = await reader.read({ reference: reference(agent) });
    expect(result.items.map((item) => [item.type, item.content])).toEqual([
      ['user_message', `${agent} 用户`],
      ['assistant_message', `${agent} 回复`],
    ]);
    expect(result.nextCursor).toBeUndefined();
  });

  it('工具调用和结果保留，系统、诊断和思考事件不会进入输出', async () => {
    const { reader } = fixture([
      { type: 'session', sessionId: 'native-session', model: 'internal', cwd: workspace.dir },
      { type: 'user_message', text: '请读取文件' },
      { type: 'reasoning', delta: '不可公开的思考' },
      { type: 'tool_call', id: 'call-1', name: 'read_file', input: { file: 'demo.txt' } },
      { type: 'tool_result', id: 'call-1', output: '文件内容', isError: false },
      { type: 'text', delta: '读取完成' },
      { type: 'error', message: 'raw-secret-diagnostic' },
    ]);
    const result = await reader.read({ reference: reference() });
    expect(result.items.map((item) => item.type)).toEqual([
      'user_message',
      'tool_call',
      'tool_result',
      'assistant_message',
    ]);
    expect(JSON.parse(result.items[1]!.content)).toEqual({
      id: 'call-1',
      name: 'read_file',
      input: { file: 'demo.txt' },
    });
    expect(JSON.parse(result.items[2]!.content)).toEqual({ id: 'call-1', output: '文件内容', isError: false });
    expect(JSON.stringify(result)).not.toMatch(/raw-secret|不可公开|internal/);
  });

  it('长工具输出、转义和多字节文本可逐页无损重建且每页有界', async () => {
    const output = '中文😀\n"\\'.repeat(15_000);
    const { reader } = fixture([
      { type: 'user_message', text: '' },
      { type: 'tool_result', id: 'large', output, isError: false },
      ...Array.from({ length: 80 }, (_, index): AgentEvent => ({ type: 'text', delta: `尾部${index}` })),
    ]);
    const items: SessionReadPage['items'] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await reader.read({ reference: reference(), ...(cursor ? { cursor } : {}) });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(32_768);
      expect(page.items.length).toBeLessThanOrEqual(32);
      expect(page.items.length).toBeGreaterThan(0);
      items.push(...page.items);
      cursor = page.nextCursor;
      expect(++pages).toBeLessThan(150);
    } while (cursor);
    const tool = items.filter((item) => item.index === 1);
    expect(tool[0]!.offset).toBe(0);
    expect(tool.at(-1)!.complete).toBe(true);
    expect(JSON.parse(tool.map((item) => item.content).join(''))).toEqual({ id: 'large', output, isError: false });
    expect(items.filter((item) => item.type === 'assistant_message').map((item) => item.content)).toEqual(
      Array.from({ length: 80 }, (_, index) => `尾部${index}`),
    );
    expect(items[0]).toMatchObject({ index: 0, content: '', complete: true });
  });

  it('引用必须匹配唯一项目归属，包括项目嵌套时的配置顺序', async () => {
    const { reader, state } = fixture();
    state.cwd = path.join(workspace.dir, 'nested');
    state.projects.push({ id: 'nested', name: '子项目', dir: state.cwd });
    await expect(reader.read({ reference: reference('codex', 'nested') })).rejects.toMatchObject({
      code: 'session_missing',
    });
    expect((await reader.read({ reference: reference('codex') })).items).toHaveLength(2);
    state.cwd = path.join(os.tmpdir(), 'unrelated');
    await expect(reader.read({ reference: reference() })).rejects.toMatchObject({ code: 'session_missing' });
    await expect(reader.read({ reference: reference('claude', 'unknown') })).rejects.toMatchObject({
      code: 'session_missing',
    });
  });

  it('分页边界上的空消息仍被读取，嵌套的工具 JSON 仍有界', async () => {
    const priorRead = JSON.stringify({ content: '嵌套引用'.repeat(10_000) });
    const { reader } = fixture([
      ...Array.from({ length: 32 }, (): AgentEvent => ({ type: 'text', delta: '短回复' })),
      { type: 'user_message', text: '' },
      { type: 'tool_result', id: 'nested-read', output: priorRead, isError: false },
    ]);
    const first = await reader.read({ reference: reference() });
    const second = await reader.read({ reference: reference(), cursor: first.nextCursor });
    expect(second.items[0]).toMatchObject({ index: 32, content: '', complete: true });
    expect(Buffer.byteLength(JSON.stringify(second))).toBeLessThanOrEqual(32_768);
  });

  it('拒绝路径引用、伪造或跨引用游标；快照变化后要求从头读取', async () => {
    const { reader, state } = fixture([{ type: 'text', delta: '长内容'.repeat(30_000) }]);
    const first = await reader.read({ reference: reference() });
    expect(first.nextCursor).toBeTypeOf('string');
    for (const input of [
      { reference: 'file:///private/session' },
      { reference: reference(), cursor: 'eyJpbmRleCI6OTk5OTk5fQ' },
      { reference: reference(), cursor: `${first.nextCursor!}a` },
      { reference: reference('codex'), cursor: first.nextCursor },
      { reference: reference(), cursor: '' },
    ])
      await expect(reader.read(input)).rejects.toMatchObject({
        code: expect.stringMatching(/invalid_(reference|cursor)/),
      });
    state.events!.push({ type: 'text', delta: '运行中的会话新增回复' });
    await expect(reader.read({ reference: reference(), cursor: first.nextCursor })).rejects.toMatchObject({
      code: 'stale_cursor',
    });
  });

  it.each([new Error('raw-token-secret'), new SessionError(503, 'session_runtime_failed', 'raw-token-secret')])(
    '原生异常不回传原始诊断',
    async (error) => {
      const { reader, state } = fixture();
      state.error = error;
      await expect(reader.read({ reference: reference() })).rejects.toMatchObject({
        code: 'read_failed',
        message: '会话读取失败，请检查本机 CLI 与配置。',
      });
    },
  );
});
