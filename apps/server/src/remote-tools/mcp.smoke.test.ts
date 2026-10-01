// 冒烟：真实启动 remote-tools MCP 子进程，连接一个假后端
import { createServer, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRemoteToolsCommand } from './launch';

let server: Server | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  client = undefined;
  server = undefined;
});

function stringEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return { ...env, ...extra };
}

describe('remote-tools MCP 子进程', () => {
  it('列出工具，并把调用转发到后端内部接口', async () => {
    const seen: Array<{ url?: string; auth?: string; body: string }> = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body });
        res.setHeader('content-type', 'application/json');
        const cmd = (JSON.parse(body) as { command?: string }).command ?? '';
        res.end(
          JSON.stringify(
            cmd.includes('sudo')
              ? { denied: { ruleId: 'privilege', reason: '禁止提权命令' } }
              : { stdout: 'fake-host\n', stderr: '', exitCode: 0, timedOut: false, truncated: false, durationMs: 5 },
          ),
        );
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;

    const { command, args } = resolveRemoteToolsCommand();
    client = new Client({ name: 'smoke', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command,
        args,
        env: stringEnv({ SSH_SERVER_INTERNAL_URL: `http://127.0.0.1:${port}`, SSH_SERVER_SESSION_TOKEN: 'tok-1' }),
      }),
    );

    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['remote_exec', 'remote_peek']);

    const ok = (await client.callTool({ name: 'remote_exec', arguments: { command: 'hostname' } })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(ok.isError).toBeFalsy();
    expect(ok.content[0]!.text).toContain('fake-host');
    expect(seen[0]).toMatchObject({ url: '/internal/remote-exec', auth: 'Bearer tok-1' });

    const denied = (await client.callTool({ name: 'remote_exec', arguments: { command: 'sudo ls' } })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(denied.isError).toBe(true);
    expect(denied.content[0]!.text).toContain('命令被拒绝');
  }, 30_000);
});
