import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@agentdeck/shared/conversation';
import type { AgentTurnInput, PermissionAnswer } from '../../../src/agents/contracts';
import type { CodexClient } from '../../../src/agents/codex/client';
import { CodexEventMapper } from '../../../src/agents/codex/mapper';
import { CodexPermissions, CODEX_PERMISSION_TIMEOUT_MS } from '../../../src/agents/codex/permissions';
import type { ServerRequest } from '../../../src/agents/codex/types';

afterEach(() => {
  vi.useRealTimers();
});

function setup(requestPermission: AgentTurnInput['requestPermission']) {
  const events: AgentEvent[] = [];
  const client = { respond: vi.fn(), rejectRequest: vi.fn() };
  const mapper = new CodexEventMapper();
  const input: AgentTurnInput = {
    workspace: { id: 'workspace', name: '审批测试', dir: '.', server: 'my-server', remoteDir: '~/projects/demo' },
    text: '',
    emit: (event) => events.push(event),
    requestPermission,
  };
  // 审批只依赖 RPC 回答接口，纯内存桩避免为五分钟超时启动真实进程。
  const permissions = new CodexPermissions(client as unknown as CodexClient, input, mapper);
  return { permissions, events, client, mapper };
}

const request = (method: string, id: string | number = 'native-request'): ServerRequest => ({
  id,
  method,
  params: {
    itemId: 'file-item',
    cwd: '.',
    reason: '请求本次确认',
    permissions: { network: { enabled: true }, fileSystem: null },
  },
});

const mcpRequest = (): ServerRequest => ({
  id: 'mcp-request',
  method: 'mcpServer/elicitation/request',
  params: {
    serverName: 'my-server',
    mode: 'form',
    requestedSchema: { type: 'object', properties: {} },
    _meta: { codex_approval_kind: 'mcp_tool_call', tool_params: { command: 'pwd' } },
  },
});

describe('Codex 原生 MCP 工具确认', () => {
  it.each([true, false])('只在用户答复后返回本次工具确认：允许=%s', async (allow) => {
    let answer!: (value: PermissionAnswer) => void;
    const { permissions, client, events } = setup(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    permissions.request(mcpRequest());
    expect(client.respond).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({
      type: 'permission_request',
      toolName: 'MCP 工具',
      input: { server: 'my-server', arguments: { command: 'pwd' } },
    });
    answer({ allow });
    await Promise.resolve();
    expect(client.respond).toHaveBeenCalledExactlyOnceWith('mcp-request', {
      action: allow ? 'accept' : 'decline',
      content: allow ? {} : null,
    });
    expect(events.at(-1)).toMatchObject({ type: 'permission_resolved', decision: allow ? 'allowed' : 'denied' });
  });
  it('取消审批后迟到的批准不能重新放行工具', async () => {
    let answer!: (value: PermissionAnswer) => void;
    const { permissions, client } = setup(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    permissions.request(mcpRequest());
    permissions.cancel();
    answer({ allow: true });
    await Promise.resolve();
    expect(client.respond).toHaveBeenCalledExactlyOnceWith('mcp-request', { action: 'cancel', content: null });
  });
  it.each([
    { mode: 'url', url: 'https://example.com/login' },
    { _meta: {} },
    { requestedSchema: { type: 'object', properties: { name: { type: 'string' } } } },
    { requestedSchema: { type: 'object', properties: {}, required: ['name'] } },
    { requestedSchema: { type: 'object', properties: {}, allOf: [{ required: ['account'] }] } },
    { requestedSchema: { type: 'object', properties: {}, minProperties: 1 } },
  ])('URL或需填写的表单不当作简单工具确认：%j', (params) => {
    const answer = vi.fn<AgentTurnInput['requestPermission']>();
    const { permissions, client, events } = setup(answer);
    const request = mcpRequest();
    permissions.request({ ...request, params: { ...request.params, ...params } });
    expect(answer).not.toHaveBeenCalled();
    expect(client.rejectRequest).toHaveBeenCalledWith('mcp-request');
    expect(client.respond).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: 'error', message: 'Codex 请求了暂不支持的交互操作，已拒绝。' }]);
  });
});

describe('Codex 审批失效与拒绝', () => {
  it('文件审批展示原生 diff，并把网页拒绝按原始数字 ID 仅回答一次', async () => {
    const { permissions, events, client, mapper } = setup(async () => ({ allow: false }));
    const changes = [{ path: 'example.ts', kind: { type: 'update' }, diff: '-old\n+new' }];
    mapper.map('item/started', { item: { id: 'file-item', type: 'fileChange', changes, status: 'inProgress' } });
    permissions.request(request('item/fileChange/requestApproval', 42));
    await Promise.resolve();
    permissions.resolved(42);
    expect(events[0]).toMatchObject({ type: 'permission_request', toolName: 'fileChange', input: { changes } });
    expect(client.respond.mock.calls).toEqual([[42, { decision: 'decline' }]]);
    expect(events.filter((event) => event.type === 'permission_resolved')).toMatchObject([{ decision: 'denied' }]);
  });

  it('网页审批失败时不给权限；允许时仅授予请求中存在的网络权限', async () => {
    const answer = vi
      .fn<AgentTurnInput['requestPermission']>()
      .mockRejectedValueOnce(new Error('网页已断开'))
      .mockResolvedValueOnce({ allow: true });
    const { permissions, client } = setup(answer);
    permissions.request(request('item/permissions/requestApproval', 'denied'));
    await Promise.resolve();
    permissions.request(request('item/permissions/requestApproval', 'allowed'));
    await Promise.resolve();
    expect(client.respond.mock.calls).toEqual([
      ['denied', { permissions: {}, scope: 'turn' }],
      ['allowed', { permissions: { network: { enabled: true } }, scope: 'turn' }],
    ]);
  });

  it('超时自动拒绝，随后到达的允许答复不能恢复执行', async () => {
    vi.useFakeTimers();
    let answer!: (value: PermissionAnswer) => void;
    const { permissions, client, events } = setup(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    permissions.request(request('item/commandExecution/requestApproval'));
    await vi.advanceTimersByTimeAsync(CODEX_PERMISSION_TIMEOUT_MS);
    answer({ allow: true });
    await Promise.resolve();
    expect(client.respond.mock.calls).toEqual([['native-request', { decision: 'decline' }]]);
    expect(events.filter((event) => event.type === 'permission_resolved')).toMatchObject([{ decision: 'denied' }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('原生取消后清理网页审批；本轮停止后拒绝新到的审批', async () => {
    vi.useFakeTimers();
    let answer!: (value: PermissionAnswer) => void;
    const { permissions, client, events } = setup(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    permissions.request(request('item/permissions/requestApproval'));
    permissions.resolved('native-request');
    answer({ allow: true });
    await Promise.resolve();
    expect(client.respond).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === 'permission_resolved')).toMatchObject([{ decision: 'cancelled' }]);
    permissions.cancel();
    permissions.request(request('item/permissions/requestApproval', 'late'));
    expect(client.respond.mock.calls).toEqual([['late', { permissions: {}, scope: 'turn' }]]);
    expect(events.filter((event) => event.type === 'permission_request')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
