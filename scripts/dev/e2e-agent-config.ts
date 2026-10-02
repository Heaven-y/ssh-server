// 仅操作隔离测试目录；替代配置和可选认证文件由运行时参数提供，绝不改写源文件。
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { parse, stringify } from 'smol-toml';
import { z } from 'zod';
import { createNativeConfigService } from '../../apps/server/src/settings/native-config';

const Message = z.object({
  id: z.number().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number() }).passthrough().optional(),
});
type Waiter = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
const TurnNotification = z.object({
  threadId: z.string(),
  delta: z.string().optional(),
  turn: z.object({ status: z.string(), error: z.object({ message: z.string() }).nullish() }).optional(),
  error: z.object({ message: z.string() }).optional(),
});
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const MARKER = 'CONFIG_RELOAD_OK';
let stage = '初始化参数';
function modelFailure(message: string): string {
  if (/unauthorized|authentication|api.?key|not logged|401|403/i.test(message)) return '认证未通过';
  if (/model.*not|not.*model|unsupported model/i.test(message)) return '模型不可用';
  if (/connect|timeout|network|fetch|TLS|certificate/i.test(message)) return '连接失败';
  return '服务返回失败';
}
function turnFailure(params: z.infer<typeof TurnNotification>): string | undefined {
  const error = params.error ?? params.turn?.error;
  return error ? modelFailure(error.message) : undefined;
}
function completedTurn(params: z.infer<typeof TurnNotification>, output: string, failure: string) {
  if (params.turn?.status === 'completed' && output.includes(MARKER)) return;
  return new Error(`真实调用失败：${failure}`);
}
function isolatedConfig(content: string) {
  return {
    ...parse(content),
    notify: [],
    plugins: {},
    marketplaces: {},
    mcp_servers: {},
  };
}
function configuredCopy(content: string, apiPrefix?: string): string {
  const changed = {
    ...isolatedConfig(content),
    developer_instructions: `When the user asks CONFIG_CHECK, reply exactly ${MARKER}. Do not use tools.`,
  };
  if (!apiPrefix) return stringify(changed);
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(apiPrefix)) throw new Error('API 前缀不合法');
  const config = z
    .object({
      model_provider: z.string(),
      model_providers: z.record(z.string(), z.object({ base_url: z.string() }).passthrough()),
    })
    .passthrough()
    .parse(changed);
  const provider = config.model_providers[config.model_provider];
  if (!provider) throw new Error('测试配置没有所选服务商');
  const url = new URL(provider.base_url);
  url.pathname = url.pathname.replace(/\/$/, '') + apiPrefix;
  provider.base_url = url.toString();
  return stringify(config);
}

function startRuntime(executable: string, home: string, cwd: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const child = spawn(
    executable,
    [
      'app-server',
      '--stdio',
      '-c',
      'notify=[]',
      '-c',
      'features.shell_tool=false',
      '-c',
      'features.multi_agent=false',
      '-c',
      'features.apps=false',
      '-c',
      'web_search="disabled"',
    ],
    {
      cwd,
      env: { ...process.env, CODEX_HOME: home },
      windowsHide: true,
      stdio: 'pipe',
      signal,
    },
  );
  const pending = new Map<number, Waiter>();
  const subscribers = new Set<(method: string, params: unknown) => void>();
  let nextId = 0;
  let terminal = false;
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  child.stderr.resume(); // 运行时可能打印配置诊断；不将原始内容转入测试报告。
  const send = (value: object) => {
    child.stdin.write(JSON.stringify(value) + '\n');
  };
  const fail = () => {
    if (terminal) return;
    terminal = true;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Codex 子进程已结束'));
    }
    pending.clear();
    for (const listener of subscribers) listener('runtime/closed', undefined);
  };
  child.once('error', fail);
  child.once('close', fail);
  child.stdin.on('error', fail);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message: z.infer<typeof Message>;
    try {
      message = Message.parse(JSON.parse(line));
    } catch {
      return;
    }
    if (message.id !== undefined && message.method) {
      send({ id: message.id, error: { code: -32601, message: '此验收不允许工具或额外交互' } });
    } else if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`Codex RPC 失败（${message.error.code}）`));
      else waiter.resolve(message.result);
    } else if (message.method) {
      for (const listener of subscribers) listener(message.method, message.params);
    }
  });
  return {
    request(method: string, params: object): Promise<unknown> {
      if (terminal) return Promise.reject(new Error('Codex 子进程不可用'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Codex RPC 超时'));
        }, 30_000);
        pending.set(id, { resolve, reject, timer });
        send({ id, method, params });
      });
    },
    async initialize() {
      await this.request('initialize', { clientInfo: { name: 'ssh_server_config_check', version: '1' } });
      send({ method: 'initialized', params: {} });
    },
    async modelCheck(cwd: string) {
      const result = z.object({ thread: z.object({ id: z.string() }) }).parse(
        await this.request('thread/start', {
          cwd,
          ephemeral: true,
          sandbox: 'read-only',
          approvalPolicy: 'never',
        }),
      );
      const threadId = result.thread.id;
      if (terminal) throw new Error('Codex 子进程不可用');
      let output = '';
      let failure = '未返回预期文本';
      let cancel = () => {};
      const complete = new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          subscribers.delete(listener);
          if (error) reject(error);
          else resolve();
        };
        const listener = (method: string, raw: unknown) => {
          if (method === 'runtime/closed') {
            finish(new Error('Codex 子进程已结束'));
            return;
          }
          const params = TurnNotification.safeParse(raw);
          if (!params.success || params.data.threadId !== threadId) return;
          failure = turnFailure(params.data) ?? failure;
          if (method === 'item/agentMessage/delta') output += params.data.delta ?? '';
          if (method === 'turn/completed') finish(completedTurn(params.data, output, failure));
        };
        const timer = setTimeout(() => finish(new Error('真实调用超时')), 90_000);
        subscribers.add(listener);
        cancel = () => finish(new Error('已结束本次验收'));
      });
      const turn = this.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: 'CONFIG_CHECK。不要使用工具。', text_elements: [] }],
      });
      try {
        await Promise.all([turn, complete]);
      } finally {
        cancel();
      }
    },
    async close() {
      lines.close();
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 1000);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function parameters() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      codex: { type: 'string' },
      'auth-file': { type: 'string' },
      'api-prefix': { type: 'string' },
      'with-model': { type: 'boolean', default: false },
    },
  });
  if (!values.config || !values.codex) throw new Error('需要 --config 替代配置路径与 --codex 原生可执行文件路径');
  const source = path.resolve(values.config);
  const baseline = path.join(path.dirname(source), 'config.toml');
  const originals = await Promise.all(
    [source, baseline].map(async (file) => ({ file, hash: await readFile(file).then(digest, () => 'missing') })),
  );
  return {
    source,
    originals,
    executable: values.codex,
    authFile: values['auth-file'],
    apiPrefix: values['api-prefix'],
    withModel: values['with-model'],
  };
}

async function cleanup(root: string, originals: Array<{ file: string; hash: string }>) {
  const checks = await Promise.all(
    originals.map(async (entry) => (await readFile(entry.file).then(digest, () => 'missing')) === entry.hash),
  );
  const absolute = path.resolve(root);
  if (
    path.dirname(absolute) !== path.resolve(os.tmpdir()) ||
    !path.basename(absolute).startsWith('ssh-agent-config-check-')
  )
    throw new Error('临时目录清理边界不合法');
  await rm(absolute, { recursive: true, force: true });
  if (checks.some((unchanged) => !unchanged)) throw new Error('源配置摘要发生变化，请检查外部程序');
  console.log('源配置摘要保持不变，隔离测试目录已清理。');
}

async function run(signal: AbortSignal) {
  const { source, originals, executable, authFile, apiPrefix, withModel } = await parameters();
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-agent-config-check-'));
  const home = path.join(root, 'codex');
  const cwd = path.join(root, 'project');
  let runtime: ReturnType<typeof startRuntime> | undefined;
  try {
    await mkdir(home);
    await mkdir(cwd);
    await copyFile(source, path.join(home, 'config.toml'));
    if (authFile) await copyFile(path.resolve(authFile), path.join(home, 'auth.json'));
    const service = createNativeConfigService({ homeDir: root, env: { CODEX_HOME: home } });
    const original = await service.read('codex');
    if (original.content !== (await readFile(source, 'utf8'))) throw new Error('隔离配置副本不一致');
    // 首次启动前也移除外部集成，避免 MCP 等在创建会话之前自动运行。
    const isolated = await service.save('codex', {
      content: stringify(isolatedConfig(original.content)),
      revision: original.revision,
    });
    stage = '启动原生运行时';
    runtime = startRuntime(executable, home, cwd, signal);
    await runtime.initialize();
    stage = '读取原生配置';
    await runtime.request('config/read', { cwd, includeLayers: false });
    stage = '保存隔离配置';
    await service.save('codex', { content: configuredCopy(isolated.content, apiPrefix), revision: isolated.revision });
    stage = '核对重新读取';
    const effective = z
      .object({ config: z.object({ developer_instructions: z.string() }) })
      .parse(await runtime.request('config/read', { cwd, includeLayers: false }));
    if (!effective.config.developer_instructions.includes(MARKER)) throw new Error('运行时未重新读取保存后的配置');
    await runtime.close();
    runtime = undefined;
    if (withModel) {
      stage = '重启原生运行时';
      runtime = startRuntime(executable, home, cwd, signal);
      await runtime.initialize();
      stage = '真实模型调用';
      await runtime.modelCheck(cwd);
    }
    signal.throwIfAborted();
    console.log(
      withModel
        ? 'Codex 隔离配置读写、原生重读和真实下一次调用通过。'
        : 'Codex 隔离配置读写与原生重读通过；未运行真实模型调用。',
    );
  } finally {
    try {
      await runtime?.close();
    } finally {
      await cleanup(root, originals);
    }
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

main().catch((error: unknown) => {
  const reason =
    error instanceof Error &&
    /^(Codex RPC 失败（-?\d+）|真实调用失败：(认证未通过|模型不可用|连接失败|服务返回失败|未返回预期文本))$/.test(
      error.message,
    )
      ? error.message
      : '已隐藏底层诊断';
  console.error(`配置运行时验收失败（${stage}，${reason}）。`);
  process.exitCode = 1;
});
