// exec 与同步共用的连接解析器；返回值仅供后端使用，不能发送给网页或 Agent。
import { createHash } from 'node:crypto';
import { readFile as fsReadFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SshAuthMode, Workspace } from '@ssh-server/shared';
import { createCredentialVault } from './credentials';
import { parseSshConfig, resolveHost, type SshHostConfig } from './ssh-config';

export type SshTarget = string | { alias: string; authMode?: SshAuthMode };
export type SshErrorCode =
  | 'credentials_required'
  | 'authentication_failed'
  | 'connection_failed'
  | 'connection_cancelled'
  | 'connection_paused'
  | 'remote_directory_unavailable'
  | 'host_key_unknown'
  | 'host_key_mismatch'
  | 'host_key_revoked'
  | 'unsupported_config';

export class SshConnectionError extends Error {
  override name = 'SshConnectionError';
  constructor(
    public readonly code: SshErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ResolvedConnection = {
  alias: string;
  hostname: string;
  port: number;
  username: string;
  authMode: SshAuthMode;
  cacheKey: string;
  knownHosts: string;
  knownHostsFile: string;
  privateKey?: Buffer;
  keyFile?: string;
  password?: string;
};

export type ConnectionDeps = { homeDir?: string; readFile?: (file: string) => Promise<Buffer> };
export const workspaceTarget = (ws: Workspace): SshTarget =>
  ws.authMode ? { alias: ws.sshHost, authMode: ws.authMode } : ws.sshHost;
export const targetAlias = (target: SshTarget): string => (typeof target === 'string' ? target : target.alias);
const targetAuthMode = (target: SshTarget): SshAuthMode =>
  typeof target === 'string' ? 'key' : (target.authMode ?? 'key');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa'];
const targetIdentity = (host: SshHostConfig, username: string) => JSON.stringify([host.hostname, host.port, username]);
export const connectionIdentity = (config: ResolvedConnection): string =>
  JSON.stringify([config.hostname, config.port, config.username]);

export function createConnectionResolver(deps: ConnectionDeps = {}) {
  const homeDir = deps.homeDir ?? os.homedir();
  const readFile = deps.readFile ?? ((file: string) => fsReadFile(file));
  const sshDir = path.join(homeDir, '.ssh');
  const vault = createCredentialVault();
  let resetGeneration = 0;

  async function loadHost(alias: string): Promise<SshHostConfig> {
    const text = (await readFile(path.join(sshDir, 'config')).catch(() => Buffer.alloc(0))).toString('utf8');
    const host = resolveHost(parseSshConfig(text, homeDir), alias);
    if (!host) throw new SshConnectionError('unsupported_config', 'SSH config 中没有指定 Host');
    if (host.unsupported.length)
      throw new SshConnectionError('unsupported_config', `暂不支持 SSH 选项：${host.unsupported.join('、')}`);
    return host;
  }

  async function loadKey(host: SshHostConfig): Promise<{ privateKey: Buffer; keyFile: string }> {
    const candidates = host.identityFiles.length
      ? host.identityFiles
      : DEFAULT_KEYS.map((file) => path.join(sshDir, file));
    for (const keyFile of candidates) {
      const privateKey = await readFile(keyFile).catch(() => undefined);
      if (privateKey) return { privateKey, keyFile };
    }
    throw new SshConnectionError('credentials_required', '找不到可读私钥，请配置私钥或改用密码认证');
  }

  async function resolve(
    target: SshTarget,
    loadPassword?: (identity: string) => Promise<string | undefined>,
  ): Promise<ResolvedConnection> {
    const alias = targetAlias(target);
    const generation = resetGeneration;
    let revision = vault.revision(alias);
    const assertCurrent = () => {
      if (generation !== resetGeneration || revision !== vault.revision(alias))
        throw new SshConnectionError('connection_cancelled', '连接认证周期已结束，请重新连接');
    };
    const authMode = targetAuthMode(target);
    const host = await loadHost(alias);
    assertCurrent();
    const username = host.user ?? os.userInfo().username;
    const identity = targetIdentity(host, username);
    // 即使本次使用私钥，也使指向旧目标的密码失效。
    let password = vault.get(alias, identity);
    revision = vault.revision(alias);
    if (authMode === 'password' && password === undefined && loadPassword) {
      password = await loadPassword(identity);
      assertCurrent();
      if (password !== undefined) {
        vault.set(alias, identity, password);
        revision = vault.revision(alias);
      }
    }
    if (authMode === 'password' && password === undefined)
      throw new SshConnectionError('credentials_required', 'SSH 密码未提供或认证周期已结束，请重新输入密码');
    const auth = authMode === 'password' ? { password } : await loadKey(host);
    const knownHostsFile = path.join(sshDir, 'known_hosts');
    const knownHosts = (await readFile(knownHostsFile).catch(() => Buffer.alloc(0))).toString('utf8');
    assertCurrent();
    const keyDigest = 'privateKey' in auth ? digest(auth.privateKey) : vault.revision(alias);
    return {
      alias,
      hostname: host.hostname,
      port: host.port,
      username,
      authMode,
      knownHostsFile,
      knownHosts,
      cacheKey: digest(JSON.stringify([alias, identity, authMode, keyDigest, digest(knownHosts)])),
      ...auth,
    };
  }

  return {
    resolve,
    async identity(alias: string): Promise<string> {
      const host = await loadHost(alias);
      return targetIdentity(host, host.user ?? os.userInfo().username);
    },
    async setPassword(alias: string, password: string, expectedIdentity?: string): Promise<void> {
      if (!password.length || password.length > 4096 || /[\r\n\0]/.test(password))
        throw new SshConnectionError('credentials_required', '密码长度或格式不合法');
      const generation = resetGeneration;
      vault.clear(alias);
      const revision = vault.revision(alias);
      const host = await loadHost(alias);
      const identity = targetIdentity(host, host.user ?? os.userInfo().username);
      if (
        generation !== resetGeneration ||
        revision !== vault.revision(alias) ||
        (expectedIdentity !== undefined && expectedIdentity !== identity)
      )
        throw new SshConnectionError('connection_cancelled', '连接认证周期已结束，请重新连接');
      vault.set(alias, identity, password);
    },
    clear: (alias: string) => vault.clear(alias),
    clearAll: () => {
      resetGeneration += 1;
      vault.clearAll();
    },
  };
}

export type ConnectionResolver = ReturnType<typeof createConnectionResolver>;
