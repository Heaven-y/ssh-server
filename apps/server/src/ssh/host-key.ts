// 只取得本次SSH握手实际公钥，hostVerifier拒绝继续；不发送认证凭据。
import ssh2, { type ServerHostKeyAlgorithm } from 'ssh2';
import { SshConnectionError } from './connection';
import { hostKeyAlgorithms, knownHostKeyTypes } from './known-hosts';

export type HostIdentity = { hostname: string; port: number; username: string };
export function probeSshHostKey(target: HostIdentity, knownHosts: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const client = new ssh2.Client();
  const algorithms = hostKeyAlgorithms(knownHostKeyTypes(knownHosts, target.hostname, target.port));
  return new Promise((resolve, reject) => {
    let finished = false;
    let key: Buffer | undefined;
    const stop = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      client.destroy();
      if (!error && key) resolve(key);
      else reject(error ?? new SshConnectionError('connection_failed', '无法取得服务器本次握手的主机指纹'));
    };
    const abort = () => stop(new SshConnectionError('connection_cancelled', '指纹检查已取消'));
    const timer = setTimeout(() => stop(new SshConnectionError('connection_failed', '服务器指纹检查超时')), 8000);
    signal.addEventListener('abort', abort, { once: true });
    client.on('error', () => stop());
    client.once('close', () => stop());
    try {
      client.connect({
        host: target.hostname,
        port: target.port,
        username: target.username,
        readyTimeout: 8000,
        ...(algorithms.length ? { algorithms: { serverHostKey: algorithms as ServerHostKeyAlgorithm[] } } : {}),
        hostVerifier: (actual: Buffer) => {
          key = Buffer.from(actual);
          return false;
        },
      });
    } catch {
      stop(new SshConnectionError('connection_failed', '服务器指纹握手未能启动'));
    }
    if (signal.aborted) abort();
  });
}
