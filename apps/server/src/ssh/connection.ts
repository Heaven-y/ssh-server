// exec 与同步共用的连接解析器；返回值仅供后端使用，不能发送给网页或 Agent。
import { createHash } from 'node:crypto';
import { readFile as fsReadFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SshAuthMode, Workspace } from '@ssh-server/shared';
import { createCredentialVault } from './credentials';
import { knownHostRecordsForTarget } from './known-hosts';
import { parseSshConfig, resolveHost, type SshHostConfig } from './ssh-config';

export type SshTarget = { alias: string };
export type RegisteredSshHost = SshHostConfig & { authMode: SshAuthMode };
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

export type ConnectionDeps = {
  homeDir?: string;
  readFile?: (file: string) => Promise<Buffer>;
  lookupHost?: (alias: string) => Promise<RegisteredSshHost | undefined>;
};
export const workspaceTarget = (ws: Pick<Workspace, 'sshHost'>): SshTarget => ({ alias: ws.sshHost });
export const targetAlias = (target: SshTarget): string => target.alias;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa'];
const targetIdentity = (host: SshHostConfig, username: string) => JSON.stringify([host.hostname, host.port, username]);
export const connectionIdentity = (config: Pick<ResolvedConnection, 'hostname' | 'port' | 'username'>): string =>
  JSON.stringify([config.hostname, config.port, config.username]);

/** 脚本可显式选择原生 SSH config 来源；生产档案解析器不作任何隐式回退。 */
export function createSshConfigLookup(deps: Pick<ConnectionDeps, 'homeDir' | 'readFile'> & { authMode: SshAuthMode }) {
  const homeDir = deps.homeDir ?? os.homedir();
  const readFile = deps.readFile ?? fsReadFile;
  return async (alias: string): Promise<RegisteredSshHost | undefined> => {
    const text = (await readFile(path.join(homeDir, '.ssh', 'config'))).toString('utf8');
    const host = resolveHost(parseSshConfig(text, homeDir), alias);
    return host ? { ...host, authMode: deps.authMode } : undefined;
  };
}

export function createConnectionResolver(deps: ConnectionDeps = {}) {
  const homeDir = deps.homeDir ?? os.homedir();
  const readFile = deps.readFile ?? ((file: string) => fsReadFile(file));
  const sshDir = path.join(homeDir, '.ssh');
  const vault = createCredentialVault();
  let resetGeneration = 0;

  async function loadHost(alias: string): Promise<RegisteredSshHost> {
    const host = await deps.lookupHost?.(alias);
    if (!host) throw new SshConnectionError('unsupported_config', '服务器未登记，请先在服务器管理中保存档案');
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
    const host = await loadHost(alias);
    const authMode = host.authMode;
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
      cacheKey: digest(
        JSON.stringify([
          alias,
          identity,
          authMode,
          keyDigest,
          knownHostRecordsForTarget(knownHosts, host.hostname, host.port),
        ]),
      ),
      ...auth,
    };
  }

  return {
    resolve,
    async fingerprint(alias: string): Promise<string> {
      const host = await loadHost(alias);
      const knownHosts = await readFile(path.join(sshDir, 'known_hosts')).catch(() => Buffer.alloc(0));
      const key = host.authMode === 'key' ? await loadKey(host).catch(() => undefined) : undefined;
      return digest(
        JSON.stringify([
          targetIdentity(host, host.user ?? os.userInfo().username),
          host.authMode,
          host.identityFiles,
          knownHostRecordsForTarget(knownHosts.toString('utf8'), host.hostname, host.port),
          key ? [key.keyFile, digest(key.privateKey)] : null,
        ]),
      );
    },
    async authentication(alias: string): Promise<{ authMode: SshAuthMode; hasPassword: boolean }> {
      const host = await loadHost(alias);
      const password = vault.get(alias, targetIdentity(host, host.user ?? os.userInfo().username));
      return { authMode: host.authMode, hasPassword: host.authMode === 'password' && password !== undefined };
    },
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
