import { randomUUID } from 'node:crypto';
import type { ClientChannel } from 'ssh2';
import type WebSocket from 'ws';
import type { RawData } from 'ws';
import {
  TERMINAL_LIMITS,
  TerminalClientMessageSchema,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from '@ssh-server/shared';
import type { SshPool } from '../ssh/pool';
import { workspaceTarget } from '../ssh/connection';
import type { TerminalBindings } from './binding';
import { TerminalError, terminalError } from './errors';
import { resolveTerminalDirectory } from './directory';
import { initializeTerminal } from './initialization';
import { createTerminalInput, type TerminalInput } from './input';
import { createTerminalOutput, type TerminalOutput } from './output';

type Pool = Pick<SshPool, 'generation' | 'onCredentialsChanged' | 'resolveConnection' | 'openSftp' | 'openShell'>;
export function createTerminalSession(options: {
  workspaceId: string;
  socket: WebSocket;
  pool: Pool;
  bindings: TerminalBindings;
  onClosed: () => void;
}) {
  const { workspaceId, socket, pool, bindings, onClosed } = options;
  const controller = new AbortController();
  let state: 'waiting' | 'starting' | 'ready' | 'draining' | 'ended' = 'waiting';
  let channel: ClientChannel | undefined;
  let input: TerminalInput | undefined;
  let output: TerminalOutput | undefined;
  let unsubscribe: () => void = () => undefined;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  let stdoutEnded = false;
  let stderrEnded = false;
  let exitReceived = false;
  let channelWasClosed = false;
  let pongAt = Date.now();
  const startup = setTimeout(() => stop(new TerminalError('startup_failed')), TERMINAL_LIMITS.startupMs);
  const heartbeat = setInterval(() => {
    if (Date.now() - pongAt >= TERMINAL_LIMITS.inactivityMs) stop(new TerminalError('connection_lost'));
    else if (socket.readyState === 1) socket.ping();
  }, TERMINAL_LIMITS.pingMs);
  heartbeat.unref();
  function send(message: TerminalServerMessage) {
    if (socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      close();
    }
  }
  function detachChannel() {
    channel?.removeListener('data', data);
    channel?.stderr.removeListener('data', data);
    channel?.removeListener('exit', exited);
    channel?.removeListener('end', stdoutEnd);
    channel?.stderr.removeListener('end', stderrEnd);
    channel?.removeListener('close', channelClosed);
    channel?.removeListener('error', channelError);
  }
  function close() {
    if (state === 'ended') return;
    state = 'ended';
    clearTimeout(startup);
    clearInterval(heartbeat);
    unsubscribe();
    input?.dispose();
    output?.dispose();
    detachChannel();
    controller.abort(new TerminalError('cancelled'));
    if (channel) {
      channel.on('error', () => undefined);
      channel.close();
    }
    socket.removeListener('message', message);
    socket.removeListener('pong', pong);
    socket.removeListener('close', close);
    socket.removeListener('error', close);
    socket.on('error', () => undefined);
    onClosed();
    if (socket.readyState < 2) socket.close(1000);
    if (socket.readyState !== 3) {
      const timer = setTimeout(() => socket.terminate(), 1000);
      timer.unref();
      socket.once('close', () => clearTimeout(timer));
    }
  }
  function stop(error: TerminalError) {
    if (state === 'ended') return;
    send({ type: 'error', code: error.code, message: error.message });
    if (channel) send({ type: 'exit', exitCode, signal: exitSignal, outputComplete: false });
    close();
  }
  const data = (bytes: Buffer) => output?.push(bytes);
  const channelError = () => stop(new TerminalError('connection_lost'));
  function drainExit() {
    if (
      (state !== 'ready' && state !== 'draining') ||
      !stdoutEnded ||
      !stderrEnded ||
      (!exitReceived && !channelWasClosed)
    )
      return;
    state = 'draining';
    input?.dispose();
    output?.finish({ exitCode, signal: exitSignal });
  }
  const stdoutEnd = () => {
    stdoutEnded = true;
    drainExit();
  };
  const stderrEnd = () => {
    stderrEnded = true;
    drainExit();
  };
  const exited = (code: number | null, signal?: string) => {
    exitCode = typeof code === 'number' ? code : null;
    exitSignal = signal ?? null;
    exitReceived = true;
    if (state === 'starting') return;
    state = 'draining';
    input?.dispose();
    send({ type: 'input-flow', paused: true });
    drainExit();
  };
  const channelClosed = () => {
    channelWasClosed = true;
    if (state === 'starting') stop(new TerminalError('startup_failed'));
    else {
      state = 'draining';
      input?.dispose();
      drainExit();
    }
  };
  function wireChannel() {
    stdoutEnded = channel!.readableEnded;
    stderrEnded = channel!.stderr.readableEnded;
    channel!.on('exit', exited);
    channel!.once('end', stdoutEnd);
    channel!.stderr.once('end', stderrEnd);
    channel!.once('close', channelClosed);
  }
  function assertChannelActive() {
    if (channelWasClosed || channel!.closed || channel!.destroyed) throw new TerminalError('startup_failed');
  }
  async function open(request: Extract<TerminalClientMessage, { type: 'open' }>) {
    if (state !== 'waiting' || request.target.workspaceId !== workspaceId) throw new TerminalError('invalid_request');
    state = 'starting';
    const checked = await bindings.verify(request.target, request.binding, controller.signal);
    unsubscribe = pool.onCredentialsChanged(request.target.sshHost, () => stop(new TerminalError('target_changed')));
    const connection = await pool.resolveConnection(workspaceTarget(checked.workspace));
    const guard = { generation: checked.generation, cacheKey: connection.cacheKey, signal: controller.signal };
    const confirmed = await bindings.verify(request.target, request.binding, controller.signal);
    if (confirmed.fingerprint !== checked.fingerprint || confirmed.generation !== checked.generation)
      throw new TerminalError('target_changed');
    const startDir = await resolveTerminalDirectory({ workspace: checked.workspace, pool, guard });
    channel = await pool.openShell(workspaceTarget(checked.workspace), { ...request.size, guard });
    channel.on('error', channelError);
    // 开启后立即收集退出/EOF，初始化至复验的await窗口也不能丢事件。
    wireChannel();
    const initialized = await initializeTerminal({ channel, startDir, signal: controller.signal });
    await bindings.verify(request.target, request.binding, controller.signal);
    controller.signal.throwIfAborted();
    assertChannelActive();
    clearTimeout(startup);
    state = exitReceived ? 'draining' : 'ready';
    input = createTerminalInput({ channel, notify: (paused) => send({ type: 'input-flow', paused }), fail: stop });
    output = createTerminalOutput({ channel, socket, fail: stop, ended: close });
    channel.on('data', data);
    channel.stderr.on('data', data);
    send({ type: 'ready', sessionId: randomUUID(), target: request.target, startDir });
    for (const tail of initialized.trailing) output.push(tail);
    if (exitReceived) send({ type: 'input-flow', paused: true });
    output.push(Buffer.alloc(0));
    drainExit();
  }
  function handle(request: TerminalClientMessage) {
    if (request.type === 'close') {
      close();
      return;
    }
    if (request.type === 'open') {
      void open(request).catch((error: unknown) => stop(terminalError(error)));
      return;
    }
    if (request.type === 'ack' && output) {
      output.ack(request.bytes);
      return;
    }
    if (state !== 'ready') {
      stop(new TerminalError('invalid_request'));
      return;
    }
    if (request.type === 'input') input!.enqueue(Buffer.from(request.data, 'base64'));
    else if (request.type === 'resize') channel!.setWindow(request.size.rows, request.size.cols, 0, 0);
  }
  function message(raw: RawData, binary: boolean) {
    if (state === 'ended') return;
    const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer);
    if (binary || bytes.length > TERMINAL_LIMITS.controlBytes) {
      stop(new TerminalError('invalid_request'));
      return;
    }
    try {
      const parsed = TerminalClientMessageSchema.safeParse(JSON.parse(bytes.toString('utf8')));
      if (!parsed.success) stop(new TerminalError('invalid_request'));
      else handle(parsed.data);
    } catch {
      stop(new TerminalError('invalid_request'));
    }
  }
  const pong = () => {
    pongAt = Date.now();
  };
  socket.on('message', message);
  socket.on('pong', pong);
  socket.once('close', close);
  socket.on('error', close);
  return { close };
}
export type TerminalSession = ReturnType<typeof createTerminalSession>;
