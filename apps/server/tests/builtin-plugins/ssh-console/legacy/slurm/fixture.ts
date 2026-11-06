import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import type { ClientChannel } from 'ssh2';

/** 只替代外部 SSH 通道；收集、预算、取消与解析仍运行生产代码。 */
export class SlurmChannel extends EventEmitter {
  stderr = new EventEmitter();
  close = vi.fn(() => this.emit('close'));
  finish(stdout: string, exitCode = 0, stderr = '') {
    this.stderr.emit('data', Buffer.from(stderr));
    this.emit('data', Buffer.from(stdout));
    this.emit('exit', exitCode);
    this.emit('close');
  }
  asClient() {
    return this as unknown as ClientChannel;
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export const slurmHeader =
  '             JOBID PARTITION                     NAME     USER ST       TIME  NODES NODELIST(REASON)';
export const slurmOutput = (id = 101) =>
  [
    String(id).padStart(18),
    'gpu'.padStart(9),
    'synthetic-job'.padStart(24),
    'demo'.padStart(8),
    'PD',
    '0:00'.padStart(10),
    '1'.padStart(6),
    '(Resources)',
  ].join(' ') + '\n';
