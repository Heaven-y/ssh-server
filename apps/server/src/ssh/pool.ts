// SSH 连接池：每个 Host 别名一条长连接，读取本机 ~/.ssh/config、私钥与 known_hosts
import { readFile as fsReadFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';
import type { Client as Ssh2Client, ClientChannel, ServerHostKeyAlgorithm } from 'ssh2';
import { runExec, type ChannelLike, type ExecOptions, type ExecResult } from './exec';
import { hostKeyAlgorithms, knownHostKeyTypes, verifyHostKey, type HostKeyCheck } from './known-hosts';
import { parseSshConfig, resolveHost, type SshHostConfig } from './ssh-config';

export type SshPool = {
  exec(alias: string, cmd: string, opts: ExecOptions): Promise<ExecResult>;
  dispose(): void;
};

export type SshPoolDeps = {
  homeDir?: string;
  readFile?: (p: string) => Promise<Buffer>;
};

const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa'];
const READY_TIMEOUT_MS = 20_000;
const KEEPALIVE_MS = 15_000;

function hostKeyError(alias: string, check: HostKeyCheck): string {
  switch (check) {
    case 'unknown':
      return `known_hosts 中没有 ${alias} 的主机密钥，请先在终端执行一次 ssh ${alias} 并确认指纹`;
    case 'mismatch':
      return `${alias} 的主机密钥与 known_hosts 中的记录不一致，可能存在中间人攻击，已拒绝连接`;
    case 'revoked':
      return `${alias} 的主机密钥已在 known_hosts 中标记为吊销，已拒绝连接`;
    default:
      return `${alias} 的主机密钥校验失败`;
  }
}

export function createSshPool(deps: SshPoolDeps = {}): SshPool {
  const homeDir = deps.homeDir ?? os.homedir();
  const readFile = deps.readFile ?? ((p: string) => fsReadFile(p));
  const sshDir = path.join(homeDir, '.ssh');
  const clients = new Map<string, Promise<Ssh2Client>>();

  async function loadHost(alias: string): Promise<SshHostConfig> {
    const text = (await readFile(path.join(sshDir, 'config')).catch(() => Buffer.alloc(0))).toString('utf8');
    const host = resolveHost(parseSshConfig(text, homeDir), alias);
    if (!host) throw new Error(`~/.ssh/config 中没有 Host ${alias}`);
    return host;
  }

  async function loadKey(host: SshHostConfig): Promise<Buffer> {
    const candidates = host.identityFiles.length > 0 ? host.identityFiles : DEFAULT_KEYS.map((k) => path.join(sshDir, k));
    for (const file of candidates) {
      try {
        return await readFile(file);
      } catch {
        // 尝试下一个
      }
    }
    throw new Error(`找不到 ${host.alias} 可用的私钥（已尝试：${candidates.join('、')}）`);
  }

  async function connect(alias: string): Promise<Ssh2Client> {
    const host = await loadHost(alias);
    const [privateKey, knownHosts] = await Promise.all([
      loadKey(host),
      readFile(path.join(sshDir, 'known_hosts')).then((b) => b.toString('utf8')).catch(() => ''),
    ]);

    const client = new ssh2.Client();
    let check: HostKeyCheck | undefined;
    client.once('close', () => {
      // 断开后从池中移除，下次使用时重连
      if (clients.get(alias) === pending) clients.delete(alias);
    });

    const pending = new Promise<Ssh2Client>((resolve, reject) => {
      client.once('ready', () => resolve(client));
      client.once('error', (e: Error) => {
        reject(new Error(check && check !== 'match' ? hostKeyError(alias, check) : `SSH 连接 ${alias} 失败：${e.message}`));
      });
      // 只协商 known_hosts 中已登记的密钥类型（与 OpenSSH 一致），否则服务器可能出示未登记的类型而被判为未知
      const preferred = hostKeyAlgorithms(knownHostKeyTypes(knownHosts, host.hostname, host.port));
      client.connect({
        host: host.hostname,
        port: host.port,
        username: host.user ?? os.userInfo().username,
        privateKey,
        readyTimeout: READY_TIMEOUT_MS,
        keepaliveInterval: KEEPALIVE_MS,
        // 必须传完整数组：ssh2 的 prepend 会跳过默认列表中已有的算法，无法调整顺序
        ...(preferred.length > 0 ? { algorithms: { serverHostKey: preferred as ServerHostKeyAlgorithm[] } } : {}),
        hostVerifier: (key: Buffer) => {
          check = verifyHostKey(knownHosts, host.hostname, host.port, key);
          return check === 'match';
        },
      });
    });
    return pending;
  }

  function getClient(alias: string): Promise<Ssh2Client> {
    let p = clients.get(alias);
    if (!p) {
      p = connect(alias);
      clients.set(alias, p);
      p.catch(() => {
        if (clients.get(alias) === p) clients.delete(alias);
      });
    }
    return p;
  }

  return {
    async exec(alias, cmd, opts) {
      const client = await getClient(alias);
      const open = (c: string) =>
        new Promise<ChannelLike>((resolve, reject) => {
          client.exec(c, (err: Error | undefined, ch: ClientChannel) => (err ? reject(err) : resolve(ch as unknown as ChannelLike)));
        });
      return runExec(open, cmd, opts);
    },
    dispose() {
      for (const p of clients.values()) p.then((c) => c.end()).catch(() => undefined);
      clients.clear();
    },
  };
}
