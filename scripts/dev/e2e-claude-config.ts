// 使用真实 Claude SDK/CLI 与本机受控 API，核验每次 query 重读原生配置；不访问模型服务。
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createNativeConfigService } from '../../apps/server/src/settings/native-config';

function answer(response: ServerResponse, marker: string, model: string, stream: boolean) {
  const message = {
    id: 'fixture-message',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: marker }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  if (!stream) {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(message));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = (type: string, fields: object) =>
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('message_start', { message: { ...message, content: [], stop_reason: null } });
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: marker } });
  event('content_block_stop', { index: 0 });
  event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
  event('message_stop', {});
  response.end();
}

async function cleanup(root: string) {
  const absolute = path.resolve(root);
  if (
    path.dirname(absolute) !== path.resolve(os.tmpdir()) ||
    !path.basename(absolute).startsWith('ssh-claude-config-check-')
  )
    throw new Error('清理边界不合法');
  await rm(absolute, { recursive: true, force: true });
}

async function queryMarker(
  { root, home, origin }: { root: string; home: string; origin: string },
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  // 只继承启动 CLI 所需的系统环境，隔离云供应商开关、认证、代理和路由覆盖。
  const systemVariables =
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|TEMP|TMP|TMPDIR|APPDATA|LOCALAPPDATA|LANG|LC_ALL|CLAUDE_CODE_GIT_BASH_PATH)$/i;
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => systemVariables.test(key))),
    CLAUDE_CONFIG_DIR: home,
    ANTHROPIC_BASE_URL: `${origin}/unconfigured`,
    ANTHROPIC_API_KEY: 'fixture-api-key',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  const abortController = new AbortController();
  const interrupt = () => abortController.abort();
  signal.addEventListener('abort', interrupt, { once: true });
  const timer = setTimeout(() => abortController.abort(), 30_000);
  let result = '';
  try {
    for await (const message of query({
      prompt: 'Reply with the configuration marker without using tools.',
      options: {
        cwd: root,
        settingSources: ['user'],
        env,
        model: 'sonnet',
        tools: [],
        persistSession: false,
        abortController,
      },
    })) {
      if (message.type === 'result' && message.subtype === 'success') result = message.result;
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', interrupt);
  }
  return result;
}

async function run(signal: AbortSignal) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-claude-config-check-'));
  const home = path.join(root, '.claude');
  const visits: string[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on('end', () => {
      if (request.url?.includes('count_tokens')) {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"input_tokens":1}');
        return;
      }
      if (!request.url?.includes('/v1/messages')) {
        response.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw) as { model: string; stream?: boolean };
      const marker = request.url.startsWith('/first/')
        ? 'FIRST'
        : request.url.startsWith('/second/')
          ? 'SECOND'
          : 'UNCONFIGURED';
      visits.push(marker);
      answer(response, marker, body.model, body.stream === true);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('受控 API 未启动');
    const origin = `http://127.0.0.1:${address.port}`;
    const service = createNativeConfigService({ homeDir: root, env: { CLAUDE_CONFIG_DIR: home } });
    for (const marker of ['FIRST', 'SECOND']) {
      const current = await service.read('claude');
      await service.save('claude', {
        revision: current.revision,
        content: JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: `${origin}/${marker.toLowerCase()}`,
            ANTHROPIC_API_KEY: 'fixture-api-key',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          },
        }),
      });
      const result = await queryMarker({ root, home, origin }, signal);
      if (!result.includes(marker)) throw new Error('Claude query 未读取本次保存的配置');
    }
    if (!visits.includes('FIRST') || !visits.includes('SECOND') || visits.includes('UNCONFIGURED'))
      throw new Error('配置未驱动实际 API 请求');
    signal.throwIfAborted();
    console.log('Claude 真实 SDK 的两次 query 分别读取保存后的配置，均请求受控本机 API。');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanup(root);
  }
}
async function main() {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    await run(controller.signal);
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
main().catch(() => {
  console.error('Claude 配置重读验收失败；未输出配置或底层诊断。');
  process.exitCode = 1;
});
