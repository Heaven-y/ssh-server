import { afterEach, expect, it, vi } from 'vitest';
import { chatApi, chatKeys } from '../../../src/features/chat/api';
import { respond } from '../../fixtures/http';
afterEach(() => vi.unstubAllGlobals());
it('能力请求按工作区与 Agent 隔离缓存键，并传递取消信号和 no-store', async () => {
  const result = { agent: 'codex', entries: [], models: [], warnings: ['部分能力不可用'] };
  respond(200, result);
  const controller = new AbortController();
  await expect(chatApi.agentCapabilities('w/1', 'codex', controller.signal)).resolves.toEqual(result);
  expect(vi.mocked(fetch).mock.calls[0]).toEqual([
    '/api/workspaces/w%2F1/agent-capabilities?agent=codex',
    expect.objectContaining({ signal: controller.signal, cache: 'no-store' }),
  ]);
  expect(chatKeys.agentCapabilities('w/1', 'codex')).toEqual(['agent-capabilities', 'w/1', 'codex']);
  expect(chatKeys.agentCapabilities('w/1', 'codex')).not.toEqual(chatKeys.agentCapabilities('w/1', 'claude'));
  expect(chatKeys.agentCapabilities('w/1', 'codex')).not.toEqual(chatKeys.agentCapabilities('w2', 'codex'));
  await chatApi.agentCapabilities('w/1', 'codex', controller.signal, 'native/id');
  expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(
    '/api/workspaces/w%2F1/agent-capabilities?agent=codex&sessionId=native%2Fid',
  );
  expect(chatKeys.agentCapabilities('w/1', 'codex', 'one')).not.toEqual(
    chatKeys.agentCapabilities('w/1', 'codex', 'two'),
  );
});
it('显式刷新能力走POST，普通读取仍是GET', async () => {
  respond(200, { agent: 'antigravity', entries: [], models: [], warnings: [] });
  await chatApi.agentCapabilities('project/one', 'antigravity');
  await chatApi.refreshAgentCapabilities('project/one', 'antigravity');
  const [read, refresh] = vi.mocked(fetch).mock.calls;
  expect(read?.[1]?.method).toBeUndefined();
  expect(refresh?.[0]).toBe('/api/workspaces/project%2Fone/agent-capabilities?agent=antigravity');
  expect(refresh?.[1]).toMatchObject({ method: 'POST', cache: 'no-store', body: '{}' });
});
