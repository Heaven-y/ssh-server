import { SSH_CONSOLE_LIMITS } from '@agentdeck/shared/ssh';
import { SshConsoleError } from './errors';

/** 始终保留精确的字节尾部，不因单次大输出突破上限。 */
export class ConsoleScrollback {
  private data = Buffer.alloc(0);
  seq = 0;
  get start() {
    return this.seq - this.data.length;
  }
  append(bytes: Buffer) {
    this.seq += bytes.length;
    const limit = SSH_CONSOLE_LIMITS.terminalBytes;
    this.data =
      bytes.length >= limit
        ? Buffer.from(bytes.subarray(-limit))
        : Buffer.concat([this.data.subarray(Math.max(0, this.data.length + bytes.length - limit)), bytes]);
  }
  read(fromSeq: number) {
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 0 || fromSeq > this.seq)
      throw new SshConsoleError('invalid_request');
    const reset = fromSeq < this.start;
    const from = Math.max(fromSeq, this.start);
    const bytes = this.data.subarray(from - this.start, from - this.start + SSH_CONSOLE_LIMITS.terminalReadBytes);
    return { data: bytes.toString('base64'), nextSeq: from + bytes.length, reset };
  }
}
