// SSH 握手与主机密钥校验；不把底层配置或认证内容放进错误。
import ssh2 from 'ssh2';
import type { Client, ServerHostKeyAlgorithm } from 'ssh2';
import { SshConnectionError, type ResolvedConnection } from './connection';
import { hostKeyAlgorithms, knownHostKeyTypes, verifyHostKey, type HostKeyCheck } from './known-hosts';

const HOST_ERRORS = {
  unknown: ['host_key_unknown', 'known_hosts 未登记主机密钥，请先在本机终端通过 ssh 核对指纹'],
  mismatch: ['host_key_mismatch', '主机密钥与 known_hosts 不一致，已拒绝连接'],
  revoked: ['host_key_revoked', '主机密钥已吊销，已拒绝连接'],
} as const;

function connectionError(check: HostKeyCheck | undefined, error: Error & { level?: string }): SshConnectionError {
  if (check && check !== 'match') {
    const [code, message] = HOST_ERRORS[check];
    return new SshConnectionError(code, message);
  }
  return error.level === 'client-authentication'
    ? new SshConnectionError('authentication_failed', 'SSH 认证失败，请检查认证方式并重新输入密码或核对私钥')
    : new SshConnectionError('connection_failed', 'SSH 连接失败，请检查网络、服务器与本机 SSH 配置');
}

export function connectSshClient(
  config: ResolvedConnection,
  hooks: { isCurrent(): boolean; authenticationFailed(): void | Promise<void> },
): Promise<Client> {
  const client = new ssh2.Client();
  let failurePending = false;
  let check: HostKeyCheck | undefined;
  const preferred = hostKeyAlgorithms(knownHostKeyTypes(config.knownHosts, config.hostname, config.port));
  return new Promise((resolve, reject) => {
    client.once('ready', () => {
      if (!hooks.isCurrent()) {
        client.end();
        reject(new SshConnectionError('connection_cancelled', '连接认证周期已结束，请重新连接'));
      } else resolve(client);
    });
    // ready 后的网络错误也必须有监听者，防止未处理的 EventEmitter error 结束后端。
    client.on('error', (error: Error & { level?: string }) => {
      const failure = connectionError(check, error);
      if (failure.code === 'authentication_failed' && hooks.isCurrent()) {
        failurePending = true;
        void Promise.resolve(hooks.authenticationFailed()).then(() => reject(failure), reject);
      } else reject(failure);
      client.end();
    });
    client.once('close', () => {
      if (!failurePending) reject(new SshConnectionError('connection_failed', 'SSH 连接已关闭'));
    });
    try {
      client.connect({
        host: config.hostname,
        port: config.port,
        username: config.username,
        ...(config.authMode === 'password' ? { password: config.password } : { privateKey: config.privateKey }),
        readyTimeout: 20_000,
        keepaliveInterval: 15_000,
        ...(preferred.length ? { algorithms: { serverHostKey: preferred as ServerHostKeyAlgorithm[] } } : {}),
        hostVerifier: (key: Buffer) => {
          check = verifyHostKey(config.knownHosts, config.hostname, config.port, key);
          return check === 'match';
        },
      });
    } catch {
      client.end();
      reject(new SshConnectionError('connection_failed', 'SSH 启动失败，请核对私钥格式或本机连接配置'));
    }
  });
}
