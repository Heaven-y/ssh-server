// 在 SSH 通道上执行一条命令，收集输出并处理超时、截断
import type { EventEmitter } from 'node:events';

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
};

/** ssh2 ClientChannel 中用到的部分 */
export type ChannelLike = EventEmitter & { stderr: EventEmitter; close(): void };

export type ExecOptions = { localTimeoutMs: number; outputCap: number };

/** 只保留末尾 cap 字节的缓冲区 */
class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  dropped = 0;

  constructor(private readonly cap: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.cap && this.chunks.length > 0) {
      const overflow = this.size - this.cap;
      const first = this.chunks[0]!;
      if (first.length <= overflow) {
        this.chunks.shift();
        this.size -= first.length;
        this.dropped += first.length;
      } else {
        this.chunks[0] = first.subarray(overflow);
        this.size -= overflow;
        this.dropped += overflow;
      }
    }
  }

  text(): string {
    const body = Buffer.concat(this.chunks).toString('utf8');
    return this.dropped > 0 ? `[已截断前 ${this.dropped} 字节]\n${body}` : body;
  }
}

/** open 负责打开通道（发出 exec 请求）；超时从调用时开始计算 */
export function runExec(
  open: (cmd: string) => Promise<ChannelLike>,
  cmd: string,
  opts: ExecOptions,
): Promise<ExecResult> {
  const started = Date.now();
  const stdout = new TailBuffer(opts.outputCap);
  const stderr = new TailBuffer(opts.outputCap);
  let exitCode: number | null = null;
  let channel: ChannelLike | undefined;
  let settled = false;
  let timedOut = false;

  return new Promise<ExecResult>((resolve, reject) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: stdout.text(),
        stderr: stderr.text(),
        exitCode,
        timedOut,
        truncated: stdout.dropped > 0 || stderr.dropped > 0,
        durationMs: Date.now() - started,
      });
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      channel?.close();
      finish();
    }, opts.localTimeoutMs);

    open(cmd).then(
      (ch) => {
        if (settled) {
          ch.close(); // 已超时，直接关闭迟到的通道
          return;
        }
        channel = ch;
        ch.on('data', (d: Buffer) => stdout.push(d));
        ch.stderr.on('data', (d: Buffer) => stderr.push(d));
        ch.on('exit', (code: number | null) => {
          exitCode = typeof code === 'number' ? code : null;
        });
        ch.on('close', (code?: number) => {
          if (typeof code === 'number') exitCode = code;
          finish();
        });
        ch.on('error', (e: Error) => fail(e));
      },
      (e: Error) => fail(e),
    );
  });
}
