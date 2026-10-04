// 每个文件面板独占 SFTP 通道；关闭通道不会断开共享 SSH 连接。
import type { Client, FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2';

export class SftpChannelError extends Error {
  constructor(readonly code: 'sftp_closed' | 'sftp_timeout') {
    super(code);
  }
}

export function openSftpChannel(client: Pick<Client, 'sftp'>): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      reject(new SftpChannelError('sftp_timeout'));
    }, 15_000);
    client.sftp((error, channel) => {
      // 请求超时后的迟到通道也必须释放。
      if (finished) {
        channel?.on('error', () => undefined);
        channel?.end();
        return;
      }
      finished = true;
      clearTimeout(timer);
      if (error) return reject(error);
      channel.on('error', () => undefined);
      resolve(channel);
    });
  });
}

export function createSftpReader(channel: SFTPWrapper) {
  const controller = new AbortController();
  const close = (reason: Error = new SftpChannelError('sftp_closed')) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    channel.end();
  };
  channel.once('close', () => close());
  channel.once('end', () => close());
  channel.once('error', () => close());

  function call<T>(invoke: (done: (error: Error | undefined | null, value: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      if (controller.signal.aborted) return reject(controller.signal.reason as Error);
      const abort = () => {
        clearTimeout(timer);
        reject(controller.signal.reason as Error);
      };
      const timer = setTimeout(() => close(new SftpChannelError('sftp_timeout')), 15_000);
      controller.signal.addEventListener('abort', abort, { once: true });
      const done = (error: Error | undefined | null, value: T) => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(value);
      };
      try {
        invoke(done);
      } catch (error) {
        done(error instanceof Error ? error : new SftpChannelError('sftp_closed'), undefined as T);
      }
    });
  }

  return {
    signal: controller.signal,
    close,
    realpath: (path: string) => call<string>((done) => channel.realpath(path, done)),
    lstat: (path: string) => call<Stats>((done) => channel.lstat(path, done)),
    fstat: (handle: Buffer) => call<Stats>((done) => channel.fstat(handle, done)),
    opendir: (path: string) => call<Buffer>((done) => channel.opendir(path, done)),
    // 按句柄读取时 ssh2 返回 SFTP EOF(1)，统一转换为目录结束。
    readdir: (handle: Buffer) =>
      call<FileEntryWithStats[] | false>((done) =>
        channel.readdir(handle, (error, items) => {
          if (error && (error as { code?: unknown }).code === 1) done(undefined, false);
          else done(error, items);
        }),
      ),
    closeHandle: (handle: Buffer) => call<void>((done) => channel.close(handle, (error) => done(error, undefined))),
  };
}

export type SftpReader = ReturnType<typeof createSftpReader>;
