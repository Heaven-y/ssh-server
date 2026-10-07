// 真实链路验收：Claude → MCP → 本地后端 → SSH；只执行 hostname，不打印服务器身份。
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type {
  AgentEvent,
  ClientMessage,
  ServerMessage,
  ManagedServer,
  SshHostInfo,
  WorkspaceInput,
  WorkspaceSetupResult,
  WorkspaceSetupVerification,
} from '../../packages/shared/src/index';
import { createSshPool } from '../../apps/server/src/ssh/pool';
import { buildRemoteCommand } from '../../apps/server/src/ssh/remote-command';
import { createSshConfigLookup } from '../../apps/server/src/ssh/connection';

const TURN_TIMEOUT_MS = 180_000;
const START_TIMEOUT_MS = 30_000;
const ROOT = path.resolve(import.meta.dirname, '../..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

function requireArg(name: string): string {
  const value = arg(name);
  if (!value || value.startsWith('--')) throw new Error(`缺少 ${name} 参数，使用 --help 查看用法`);
  return value;
}

function launchServer(configDir: string): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SSH_SERVER_CONFIG_DIR: configDir,
      SSH_SERVER_PORT: '0',
      SSH_SERVER_HOST: '127.0.0.1',
      SSH_SERVER_DEV_ORIGIN: '',
    },
  });
}

function waitForServer(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('后端启动超时')), START_TIMEOUT_MS);
    child.once('error', reject);
    child.once('exit', () => reject(new Error('后端在验收前退出，请检查本机启动环境')));
    child.stdout?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-10_000);
      const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    // 不输出原始启动错误，避免私有地址或本机配置进入共享验收日志。
    child.stderr?.resume();
  });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await once(killer, 'close');
  } else {
    child.kill('SIGTERM');
    await once(child, 'close');
  }
}

async function login(accessUrl: string): Promise<{ origin: string; cookie: string }> {
  const origin = new URL(accessUrl).origin;
  const response = await fetch(`${origin}/api/local-session`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{}',
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (response.status !== 204 || !cookie) throw new Error('本机会话握手失败');
  return { origin, cookie };
}

async function jsonRequest<T>(url: string, cookie: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin: new URL(url).origin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`本地验收接口失败（HTTP ${response.status}）`);
  return (await response.json()) as T;
}

async function createWorkspace(origin: string, cookie: string, input: WorkspaceInput) {
  const verified = await jsonRequest<WorkspaceSetupVerification>(`${origin}/api/workspace-setup/verify`, cookie, input);
  if (!verified.local.empty || !verified.remote.empty) throw new Error('验收仅接受两端专用空目录，不初始化已有项目');
  const result = await jsonRequest<WorkspaceSetupResult>(`${origin}/api/workspaces`, cookie, {
    input,
    verification: verified.verification,
    initializationConfirmed: true,
  });
  if (result.sync.phase !== 'ready') throw new Error('验收工作区首次同步未成功');
  return result.workspace;
}

type TurnResult = { events: AgentEvent[]; firstEventMs: number; totalMs: number };

function collectTurn(socket: WebSocket, workspaceId: string): Promise<TurnResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const events: AgentEvent[] = [];
    let firstEventMs = 0;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('close', onClose);
      if (error) reject(error);
      else resolve({ events, firstEventMs, totalMs: performance.now() - start });
    };
    const timer = setTimeout(() => finish(new Error('Agent 轮次超过 180 秒，已终止验收')), TURN_TIMEOUT_MS);
    const onClose = () => finish(new Error('WebSocket 在轮次完成前断开'));
    const onMessage = (data: Buffer) => {
      const message = JSON.parse(data.toString('utf8')) as ServerMessage;
      if (message.type === 'error') finish(new Error('后端报告轮次错误；原始信息未写入验收日志'));
      if (message.type === 'agent.event') {
        if (!events.length) firstEventMs = performance.now() - start;
        events.push(message.event);
        if (message.event.type === 'permission_request') {
          socket.send(
            JSON.stringify({
              type: 'permission.respond',
              turnId: message.turnId,
              requestId: message.event.requestId,
              allow: false,
              message: '只读验收仅允许 remote_exec 执行 hostname，拒绝其他操作',
            }),
          );
        }
      }
      if (message.type === 'turn.finished') finish();
    };
    socket.on('message', onMessage);
    socket.once('close', onClose);
    socket.send(
      JSON.stringify({
        type: 'chat.send',
        agent: 'claude',
        workspaceId,
        clientTurnId: randomUUID(),
        text: '这是只读验收。请只使用 remote_exec 工具执行 hostname，并原样告诉我输出。不修改文件，不执行其他命令，不访问工作区之外的目录。',
      } satisfies ClientMessage),
    );
  });
}

function assertSuccessfulTurn(events: AgentEvent[]): void {
  if (events.some((e) => e.type === 'error' || (e.type === 'turn_end' && e.isError)))
    throw new Error('Agent 轮次包含错误，不能判为通过');
}

function assertResult(result: TurnResult, hostname: string): { model: string; sessionId: string } {
  assertSuccessfulTurn(result.events);
  const call = result.events.find((e) => e.type === 'tool_call' && e.name.endsWith('remote_exec'));
  if (!call || call.type !== 'tool_call') throw new Error('未观察到 remote_exec 工具调用');
  const toolResult = result.events.find((e) => e.type === 'tool_result' && e.id === call.id);
  if (toolResult?.type !== 'tool_result' || toolResult.isError || !toolResult.output.includes(hostname))
    throw new Error('工具返回值与直接 SSH 的 hostname 输出不一致');
  const session = result.events.find((e) => e.type === 'session');
  if (session?.type !== 'session' || !session.model.trim()) throw new Error('未收到实际模型与原生会话标识');
  return session;
}
let stage = '参数与环境';

async function importServer(origin: string, cookie: string, host: string) {
  const options = await jsonRequest<Array<SshHostInfo & { keyFile?: string }>>(
    `${origin}/api/ssh-targets/import-options`,
    cookie,
  );
  const selected = options.find((item) => item.alias === host);
  if (!selected || selected.unsupported.length || !selected.user)
    throw new Error('所选SSH配置不能导入，请检查账号和不支持的选项');
  const server = await jsonRequest<ManagedServer>(`${origin}/api/ssh-targets`, cookie, {
    name: host,
    hostname: selected.hostname,
    port: selected.port,
    username: selected.user,
    authMode: 'key',
    ...(selected.keyFile ? { keyFile: selected.keyFile } : {}),
  });
  await jsonRequest(`${origin}/api/ssh/connect`, cookie, { sshHost: server.alias });
  return server;
}

async function run(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log('用法：npm run e2e:m1 -- --host my-server --remote-dir ~/projects/demo [--local-dir <专用空目录>]');
    console.log('两端必须是专用空目录，正式向导验证并初始化后仅执行 hostname；官方运行时保留本机验收会话。');
    return;
  }
  const host = requireArg('--host');
  const remoteDir = requireArg('--remote-dir');
  const temp = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? os.tmpdir(), 'ssh-server-e2e-'));
  const localDir = arg('--local-dir') ?? path.join(temp, 'project');
  if (!arg('--local-dir')) await mkdir(localDir);
  const pool = createSshPool({ lookupHost: createSshConfigLookup({ authMode: 'key' }) });
  const child = launchServer(path.join(temp, 'config'));
  let socket: WebSocket | undefined;
  try {
    stage = '后端启动与登录';
    const { origin, cookie } = await login(await waitForServer(child));
    stage = '直接 SSH';
    const direct = await pool.exec({ alias: host }, buildRemoteCommand(remoteDir, 'hostname', 30), {
      localTimeoutMs: 60_000,
      outputCap: 10_000,
    });
    const hostname = direct.stdout.trim();
    if (direct.exitCode !== 0 || !hostname) throw new Error('直接 SSH 只读检查失败');
    const server = await importServer(origin, cookie, host);
    const workspace = await createWorkspace(origin, cookie, {
      name: '链路验收',
      localDir,
      sshHost: server.alias,
      remoteDir,
    });
    socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { headers: { origin, cookie } });
    await once(socket, 'open');
    stage = 'Claude → MCP → SSH';
    const result = await collectTurn(socket, workspace.id);
    const report = arg('--report');
    if (report) await writeFile(report, JSON.stringify(result, null, 2), 'utf8');
    const session = assertResult(result, hostname);
    stage = '原生会话历史';
    const sessions = await jsonRequest<Array<{ sessionId: string }>>(
      `${origin}/api/workspaces/${workspace.id}/sessions?agent=claude`,
      cookie,
    );
    if (!sessions.some((s) => s.sessionId === session.sessionId)) throw new Error('原生历史列表中未找到验收会话');
    console.log(
      `PASS：Claude → MCP → SSH，模型 ${session.model}，首事件 ${Math.round(result.firstEventMs)} ms，总耗时 ${Math.round(result.totalMs)} ms；主机名已核对，历史列表可见。`,
    );
  } finally {
    socket?.terminate();
    pool.dispose();
    await stopServer(child);
    await rm(temp, { recursive: true, force: true });
  }
}

run().catch(async (error: unknown) => {
  const report = arg('--report');
  if (report) await writeFile(`${report}.error`, (error as Error).stack ?? String(error), 'utf8');
  console.error(`FAIL（${stage}）：请核对本机 Claude 配置、SSH 认证、目录与模型服务可用性；私有错误未输出。`);
  process.exitCode = 1;
});
