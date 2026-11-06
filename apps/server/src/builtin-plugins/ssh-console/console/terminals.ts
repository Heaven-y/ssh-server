import { randomUUID } from 'node:crypto';
import type { ClientChannel } from 'ssh2';
import {
  SSH_CONSOLE_LIMITS,
  SshConsoleTerminalCreateSchema,
  TerminalClientMessageSchema,
  TerminalSizeSchema,
  type SshConsoleTerminal,
  type SshConsoleTerminalCreate,
  type TerminalSize,
} from '@agentdeck/shared/ssh';
import type { SshPool } from '../ssh/pool';
import { createSftpReader } from '../ssh/sftp';
import { createTerminalInput, type TerminalInput } from '../legacy/terminal/input';
import { initializeTerminal } from '../legacy/terminal/initialization';
import type { ConsoleAccess, ConsoleLease } from './access';
import { consoleDirectory } from './files';
import { SshConsoleError } from './errors';
import { ConsoleScrollback } from './scrollback';

type Entry = {
  meta: SshConsoleTerminal;
  output: ConsoleScrollback;
  controller: AbortController;
  lease?: ConsoleLease;
  channel?: ClientChannel;
  input?: TerminalInput;
  ready: boolean;
  closed: boolean;
  ending: boolean;
  cleanup?: () => void;
};

/** PTY 属于后端注册表，页面和 HTTP 请求结束都不会销毁已打开的 shell。 */
export function createConsoleTerminals(pool: SshPool, access: ConsoleAccess) {
  const entries = new Map<string, Entry>();
  function remove(entry: Entry) {
    if (entry.closed) return;
    entry.closed = true;
    entries.delete(entry.meta.id);
    entry.controller.abort(new SshConsoleError('cancelled'));
    entry.input?.dispose();
    entry.cleanup?.();
    entry.lease?.close();
    entry.channel?.on('error', () => undefined);
    entry.channel?.close();
  }
  async function find(serverId: string, terminalId: string) {
    access.assertEnabled();
    const entry = entries.get(terminalId);
    if (!entry || entry.meta.serverId !== serverId || !entry.ready) throw new SshConsoleError('terminal_missing');
    try {
      await entry.lease!.recheck();
    } catch (error) {
      remove(entry);
      throw error;
    }
    if (entry.closed) throw new SshConsoleError('terminal_missing');
    return entry;
  }
  function metadata(entry: Entry): SshConsoleTerminal {
    return { ...entry.meta, start: entry.output.start, seq: entry.output.seq };
  }
  function reserve(serverId: string, input: SshConsoleTerminalCreate) {
    access.assertEnabled();
    if (!SshConsoleTerminalCreateSchema.safeParse(input).success) throw new SshConsoleError('invalid_request');
    const count = [...entries.values()].filter((entry) => entry.meta.serverId === serverId).length;
    if (count >= SSH_CONSOLE_LIMITS.terminalsPerServer || entries.size >= SSH_CONSOLE_LIMITS.terminalsTotal)
      throw new SshConsoleError('terminal_limit');
    const entry: Entry = {
      meta: {
        id: randomUUID(),
        serverId,
        cols: input.cols,
        rows: input.rows,
        startDir: '',
        startedAt: Date.now(),
        exited: false,
        exitCode: null,
        signal: null,
        seq: 0,
        start: 0,
        inputPaused: false,
      },
      output: new ConsoleScrollback(),
      controller: new AbortController(),
      ready: false,
      closed: false,
      ending: false,
    };
    entries.set(entry.meta.id, entry);
    return entry;
  }
  function wire(entry: Entry, channel: ClientChannel) {
    const data = (bytes: Buffer) => {
      if (!entry.closed) entry.output.append(bytes);
    };
    const exit = (code: number | null, signal?: string) => {
      entry.ending = true;
      entry.meta.exitCode = typeof code === 'number' ? code : null;
      entry.meta.signal = signal ?? null;
      entry.input?.dispose();
      entry.meta.inputPaused = true;
    };
    const closed = () => {
      entry.ending = true;
      entry.meta.exited = true;
      entry.input?.dispose();
    };
    const failed = () => {
      closed();
      channel.close();
    };
    channel.on('exit', exit);
    channel.once('close', closed);
    channel.on('error', failed);
    entry.cleanup = () => {
      channel.off('data', data);
      channel.stderr.off('data', data);
      channel.off('exit', exit);
      channel.off('close', closed);
      channel.off('error', failed);
    };
    return () => {
      channel.on('data', data);
      channel.stderr.on('data', data);
    };
  }
  async function startDirectory(lease: ConsoleLease, directory: string) {
    const reader = createSftpReader(await pool.openSftp(lease.target, lease.guard));
    const abort = () => reader.close();
    lease.signal.addEventListener('abort', abort, { once: true });
    try {
      lease.check();
      const resolved = await consoleDirectory(reader, directory);
      if (!(await reader.lstat(resolved)).isDirectory()) throw new SshConsoleError('directory_unavailable');
      return resolved;
    } finally {
      lease.signal.removeEventListener('abort', abort);
      reader.close();
    }
  }
  async function initialize(entry: Entry, input: SshConsoleTerminalCreate) {
    const lease = await access.capture(entry.meta.serverId, entry.controller.signal);
    entry.lease = lease;
    lease.signal.addEventListener('abort', () => remove(entry), { once: true });
    lease.check();
    const startDir = await startDirectory(lease, input.remoteDir ?? '~');
    const channel = await pool.openShell(lease.target, { cols: input.cols, rows: input.rows, guard: lease.guard });
    // 关闭或代次失效后才到达的通道仍由本次创建负责释放。
    if (entry.closed || lease.signal.aborted) {
      channel.on('error', () => undefined);
      channel.close();
      throw new SshConsoleError('cancelled');
    }
    entry.channel = channel;
    const capture = wire(entry, channel);
    const result = await initializeTerminal({ channel, startDir, signal: lease.signal });
    await lease.recheck();
    if (entry.meta.exited || channel.closed || channel.destroyed) throw new SshConsoleError('terminal_exited');
    entry.meta.startDir = startDir;
    entry.input = createTerminalInput({
      channel,
      notify: (paused) => {
        entry.meta.inputPaused = paused;
      },
      fail: () => remove(entry),
    });
    capture();
    for (const bytes of result.trailing) entry.output.append(bytes);
    entry.ready = true;
    channel.resume();
    channel.stderr.resume();
    return metadata(entry);
  }
  return {
    async createTerminal(serverId: string, input: SshConsoleTerminalCreate) {
      const entry = reserve(serverId, input);
      const timer = setTimeout(() => remove(entry), 30_000);
      try {
        return await initialize(entry, input);
      } catch (error) {
        remove(entry);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    async listTerminals(serverId: string) {
      access.assertEnabled();
      await pool.fingerprint(serverId);
      access.assertEnabled();
      const candidates = [...entries.values()].filter((entry) => entry.ready && entry.meta.serverId === serverId);
      const checked = await Promise.all(
        candidates.map((entry) => find(serverId, entry.meta.id).catch(() => undefined)),
      );
      access.assertEnabled();
      return { terminals: checked.filter((entry) => entry !== undefined).map(metadata) };
    },
    readTerminal(serverId: string, terminalId: string, fromSeq: number) {
      return Promise.resolve().then(async () => {
        const entry = await find(serverId, terminalId);
        return { ...metadata(entry), ...entry.output.read(fromSeq) };
      });
    },
    writeTerminal(serverId: string, terminalId: string, data: string) {
      return Promise.resolve().then(async () => {
        const parsed = TerminalClientMessageSchema.safeParse({ type: 'input', data });
        if (!parsed.success) throw new SshConsoleError('invalid_request');
        const entry = await find(serverId, terminalId);
        if (entry.ending) throw new SshConsoleError('terminal_exited');
        const bytes = Buffer.from(data, 'base64');
        entry.input!.enqueue(bytes);
        if (entry.closed) throw new SshConsoleError('terminal_exited');
        return { written: bytes.length };
      });
    },
    resizeTerminal(serverId: string, terminalId: string, size: TerminalSize) {
      return Promise.resolve().then(async () => {
        if (!TerminalSizeSchema.safeParse(size).success) throw new SshConsoleError('invalid_request');
        const entry = await find(serverId, terminalId);
        if (entry.ending) throw new SshConsoleError('terminal_exited');
        entry.channel!.setWindow(size.rows, size.cols, 0, 0);
        entry.meta.cols = size.cols;
        entry.meta.rows = size.rows;
        return metadata(entry);
      });
    },
    closeTerminal(serverId: string, terminalId: string) {
      return Promise.resolve().then(async () => remove(await find(serverId, terminalId)));
    },
    dispose() {
      for (const entry of [...entries.values()]) remove(entry);
    },
  };
}
