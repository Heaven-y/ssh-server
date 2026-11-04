import { StringDecoder } from 'node:string_decoder';

/** 单行有界，UTF-8 跨块字符交给标准库处理；stdout 与 stderr 独立解码。 */
export class AntigravityLines {
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';
  constructor(
    private readonly accept: (line: string) => void,
    private readonly limit = 1_048_576,
  ) {}

  push(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.check(line);
      if (line.trim()) this.accept(line);
      newline = this.buffer.indexOf('\n');
    }
    this.check(this.buffer);
  }

  end(): void {
    this.buffer += this.decoder.end();
    this.check(this.buffer);
    if (this.buffer.trim()) this.accept(this.buffer);
    this.buffer = '';
  }

  private check(text: string): void {
    if (Buffer.byteLength(text, 'utf8') > this.limit) throw new Error('Antigravity 单条输出超限，已停止本轮');
  }
}
