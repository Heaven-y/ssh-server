import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema } from '@ssh-server/shared';
import { createRemoteToolsServer, formatDenied, formatExecResult } from '../../src/remote-tools/tools';

const base = { stdout: '', stderr: '', exitCode: 0, timedOut: false, truncated: false, durationMs: 12 };

describe('formatExecResult', () => {
  it('包含退出码与 stdout', () => {
    const text = formatExecResult({ ...base, stdout: 'h1\n' });
    expect(text).toContain('退出码：0');
    expect(text).toContain('h1');
  });

  it('超时与截断时给出说明', () => {
    const text = formatExecResult({ ...base, exitCode: null, timedOut: true, truncated: true, stderr: 'oops' });
    expect(text).toContain('已超时');
    expect(text).toContain('已截断');
    expect(text).toContain('oops');
  });
});

describe('formatDenied', () => {
  it('说明拒绝原因和规则', () => {
    expect(formatDenied({ ruleId: 'privilege', reason: '禁止提权命令' })).toBe(
      '命令被拒绝：禁止提权命令（规则 privilege）',
    );
  });
});

/** 通过内存传输连接 MCP 服务，fetch 用假实现，返回调用记录与工具结果 */
async function callTool(name: string, args: Record<string, unknown>, reply: () => Promise<Response>) {
  const fetch = vi.fn(reply);
  const server = createRemoteToolsServer({ internalUrl: 'http://127.0.0.1:1', token: 't0', fetch });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  await client.close();
  return { fetch, text: result.content[0]?.text ?? '', isError: result.isError === true };
}

const json =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status });

describe('createRemoteToolsServer', () => {
  it('remote_exec 转发到内部接口并带上会话令牌', async () => {
    const r = await callTool('remote_exec', { command: 'hostname' }, json({ ...base, stdout: 'h1' }));
    const [url, init] = r.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:1/internal/remote-exec');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer t0');
    expect(JSON.parse(init.body as string)).toEqual({ command: 'hostname' });
    expect(r.text).toContain('h1');
    expect(r.isError).toBe(false);
  });

  it('退出码非 0 标记为错误', async () => {
    const r = await callTool('remote_exec', { command: 'false' }, json({ ...base, exitCode: 1 }));
    expect(r.isError).toBe(true);
  });

  it('被黑名单拒绝、后端错误、后端非 2xx、连不上后端都返回错误文本', async () => {
    const denied = await callTool(
      'remote_exec',
      { command: 'sudo ls' },
      json({ denied: { ruleId: 'privilege', reason: '禁止提权' } }),
    );
    expect(denied).toMatchObject({ isError: true, text: '命令被拒绝：禁止提权（规则 privilege）' });

    const failed = await callTool('remote_exec', { command: 'ls' }, json({ error: '连接断开' }));
    expect(failed).toMatchObject({ isError: true, text: '执行失败：连接断开' });

    const unauthorized = await callTool('remote_exec', { command: 'ls' }, json({ message: '令牌无效' }, 401));
    expect(unauthorized).toMatchObject({ isError: true, text: '后端返回 401：令牌无效' });

    const down = await callTool('remote_exec', { command: 'ls' }, async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(down).toMatchObject({ isError: true, text: '无法连接本地后端：ECONNREFUSED' });
  });

  it('remote_peek 转发 path、action、lines', async () => {
    const r = await callTool(
      'remote_peek',
      { path: 'a.log', action: 'tail', lines: 5 },
      json({ ...base, stdout: 'x' }),
    );
    const [url, init] = r.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:1/internal/remote-peek');
    expect(JSON.parse(init.body as string)).toEqual({ path: 'a.log', action: 'tail', lines: 5 });
  });
  it('sync_now 返回同步状态，后同步失败保留真实命令结果', async () => {
    const sync = {
      phase: 'error',
      message: '同步连接失败',
      deletions: [],
      conflicts: [],
      settings: SyncSettingsSchema.parse({}),
    };
    const manual = await callTool('sync_now', {}, json({ sync }));
    expect(manual.isError).toBe(true);
    expect(manual.text).toContain('同步连接失败');
    const completed = await callTool(
      'remote_exec',
      { command: 'hostname' },
      json({ ...base, stdout: 'actual output', sync }),
    );
    expect(completed.text).toContain('退出码：0');
    expect(completed.text).toContain('actual output');
    expect(completed.text).toContain('同步连接失败');
  });
});
