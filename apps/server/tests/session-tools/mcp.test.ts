import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { formatSessionReference } from '@agentdeck/shared/conversation';
import { createSessionReader, type SessionReadPage } from '../../src/session-tools/reader';
import { createSessionToolsServer, startSessionToolsStdio } from '../../src/session-tools/mcp';

const reference = formatSessionReference({ workspaceId: 'demo', agent: 'codex', sessionId: 'native-session' });
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function reader() {
  return createSessionReader({
    store: { get: async () => ({ id: 'demo', name: '演示', dir: path.join(os.tmpdir(), 'demo') }) },
    sessions: {
      read: async () => ({
        session: { agent: 'codex', sessionId: 'native-session', summary: '演示', lastModified: 1 },
        events: [
          { type: 'user_message', text: '用户问题' },
          { type: 'tool_call', id: 'tool-1', name: 'read_file', input: { path: 'demo.txt' } },
        ],
      }),
    },
  });
}

describe('会话 MCP 协议', () => {
  it('握手只声明只读工具，tool call 返回有界历史并脱敏无效请求', async () => {
    const server = createSessionToolsServer(reader());
    const client = new Client({ name: 'fixture', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    cleanups.push(
      () => server.close(),
      () => client.close(),
    );
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(client.getServerCapabilities()).toEqual({ tools: {} });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'read_session',
      annotations: { readOnlyHint: true, destructiveHint: false },
    });
    const result = await client.callTool({ name: 'read_session', arguments: { reference } });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text).items).toEqual([
      { type: 'user_message', content: '用户问题', index: 0, offset: 0, complete: true },
      {
        type: 'tool_call',
        content: '{"id":"tool-1","name":"read_file","input":{"path":"demo.txt"}}',
        index: 1,
        offset: 0,
        complete: true,
      },
    ]);
    const invalid = await client.callTool({
      name: 'read_session',
      arguments: { reference, cursor: 'raw-private-secret' },
    });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid)).toContain('invalid_cursor');
    expect(JSON.stringify(invalid)).not.toContain('raw-private-secret');
    const unknown = await client.callTool({ name: 'raw-private-tool', arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(JSON.stringify(unknown)).not.toContain('raw-private-tool');
  });

  it('stdin 关闭后释放原生管理服务且清理幂等', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const dispose = vi.fn(async () => undefined);
    const runtime = await startSessionToolsStdio({ reader: reader(), dispose, stdin, stdout });
    cleanups.push(() => runtime.close());
    stdin.end();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    await runtime.close();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('真实 stdio 入口用隔离配置读取原生 Claude 历史，原文件保持不变', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-session-tools-'));
    cleanups.push(() => rm(configDir, { recursive: true, force: true }));
    const workspaceDir = path.join(configDir, 'workspace');
    await mkdir(workspaceDir);
    const claudeDir = path.join(configDir, 'native-claude');
    const nativeId = '11111111-1111-4111-8111-111111111111';
    const projectKey = (await realpath(workspaceDir)).replace(/[^a-zA-Z0-9]/g, '-');
    const transcript = path.join(claudeDir, 'projects', projectKey, `${nativeId}.jsonl`);
    await mkdir(path.dirname(transcript), { recursive: true });
    const userId = '22222222-2222-4222-8222-222222222222';
    const assistantId = '33333333-3333-4333-8333-333333333333';
    const nativeToolOutput = '隔离原生工具结果'.repeat(5000) + '读取末尾';
    const history =
      [
        {
          type: 'user',
          uuid: userId,
          parentUuid: null,
          sessionId: nativeId,
          cwd: workspaceDir,
          message: { role: 'user', content: '隔离原生用户内容' },
        },
        {
          type: 'assistant',
          uuid: assistantId,
          parentUuid: userId,
          sessionId: nativeId,
          cwd: workspaceDir,
          message: {
            id: 'fixture-message',
            role: 'assistant',
            model: 'fixture-model',
            content: [
              { type: 'text', text: '隔离原生助手内容' },
              { type: 'tool_use', id: 'fixture-tool', name: 'read_file', input: { path: 'demo.txt' } },
            ],
          },
        },
        {
          type: 'user',
          uuid: '44444444-4444-4444-8444-444444444444',
          parentUuid: assistantId,
          sessionId: nativeId,
          cwd: workspaceDir,
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'fixture-tool', content: nativeToolOutput }],
          },
        },
      ]
        .map((message) => JSON.stringify(message))
        .join('\n') + '\n';
    await writeFile(transcript, history);
    await writeFile(
      path.join(configDir, 'workspaces.json'),
      JSON.stringify([{ id: 'demo', name: '演示', dir: workspaceDir }]),
    );
    const client = new Client({ name: 'stdio-fixture', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL('../../src/session-tools/main.ts', import.meta.url)),
        '--config-dir',
        configDir,
      ],
      stderr: 'pipe',
      env: { CLAUDE_CONFIG_DIR: claudeDir },
    });
    cleanups.push(() => client.close());
    await client.connect(transport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['read_session']);
    const response = await client.callTool({
      name: 'read_session',
      arguments: {
        reference: formatSessionReference({ workspaceId: 'missing', agent: 'claude', sessionId: nativeId }),
      },
    });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response)).toContain('session_missing');
    expect(JSON.stringify(response)).not.toContain(configDir);
    const result = await client.callTool({
      name: 'read_session',
      arguments: { reference: formatSessionReference({ workspaceId: 'demo', agent: 'claude', sessionId: nativeId }) },
    });
    expect(result.isError).not.toBe(true);
    let page = JSON.parse((result.content as { text: string }[])[0]!.text) as SessionReadPage;
    const items = [...page.items];
    let pages = 1;
    while (page.nextCursor) {
      const next = await client.callTool({
        name: 'read_session',
        arguments: { reference: page.reference, cursor: page.nextCursor },
      });
      expect(next.isError).not.toBe(true);
      page = JSON.parse((next.content as { text: string }[])[0]!.text) as SessionReadPage;
      items.push(...page.items);
      expect(++pages).toBeLessThan(30);
    }
    expect([...new Set(items.map((item) => item.type))]).toEqual([
      'user_message',
      'assistant_message',
      'tool_call',
      'tool_result',
    ]);
    expect(items[0]!.content).toBe('隔离原生用户内容');
    expect(items[1]!.content).toBe('隔离原生助手内容');
    const fullTool = JSON.parse(
      items
        .filter((item) => item.type === 'tool_result')
        .map((item) => item.content)
        .join(''),
    ) as { output: string };
    expect(fullTool.output.length).toBe(nativeToolOutput.length);
    expect(fullTool.output.endsWith('读取末尾')).toBe(true);
    expect(fullTool.output === nativeToolOutput).toBe(true);
    expect(await readFile(transcript, 'utf8')).toBe(history);
  });
});
