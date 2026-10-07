// SSH 连接、保存凭据与同步共用认证代次；主动断开后只能显式连接恢复。
import type { Client, ClientChannel, SFTPWrapper } from 'ssh2';
import type { SshAuthMode, TerminalSize } from '@ssh-server/shared';
import { openGuardedSshChannel } from './channel-open';
import { connectSshClient } from './client';
import {
  connectionIdentity,
  createConnectionResolver,
  SshConnectionError,
  targetAlias,
  type ConnectionDeps,
  type ConnectionResolver,
  type ResolvedConnection,
  type SshTarget,
} from './connection';
import { CredentialStorageError } from './credential-storage-error';
import { runExec, type ChannelLike, type ExecOptions, type ExecResult } from './exec';
import type { PasswordStore } from './password-store';
import { buildRemoteCommand } from './remote-command';
import { openSftpChannel, protectSftpChannel } from './sftp';

export type CredentialStatus = {
  saved: boolean;
  savingAvailable: boolean;
  paused: boolean;
  connected: boolean;
  hasPassword: boolean;
};
export type ConnectInput = {
  sshHost: string;
  password?: string;
  savePassword?: boolean;
};
export type SshPool = {
  fingerprint(alias: string): Promise<string>;
  identity(alias: string): Promise<string>;
  openExec(target: SshTarget, command: string, signal?: AbortSignal): Promise<ClientChannel>;
  openSftp(target: SshTarget, guard?: SshChannelGuard): Promise<SFTPWrapper>;
  openShell(target: SshTarget, options: TerminalSize & { guard: SshChannelGuard }): Promise<ClientChannel>;
  exec(target: SshTarget, cmd: string, opts: ExecOptions): Promise<ExecResult>;
  resolveConnection(target: SshTarget): Promise<ResolvedConnection>;
  connect(input: ConnectInput): Promise<CredentialStatus & { connected: true; authMode: SshAuthMode }>;
  credentialStatus(alias: string): Promise<CredentialStatus>;
  clearSavedPassword(alias: string): Promise<CredentialStatus>;
  forgetServerCredentials(server: Pick<ResolvedConnection, 'alias' | 'hostname' | 'port' | 'username'>): Promise<void>;
  invalidateCredentials(alias: string, expectedGeneration?: number): Promise<void>;
  setPassword(alias: string, password: string): Promise<void>;
  generation(alias: string): number;
  onCredentialsChanged(alias: string, notify: () => void): () => void;
  disconnect(alias: string, expectedGeneration?: number): void;
  dispose(): void;
};
export type SshPoolDeps = ConnectionDeps & { resolver?: ConnectionResolver; passwordStore?: PasswordStore };
export type SshChannelGuard = { generation: number; cacheKey: string; signal: AbortSignal };
type Cached = { alias: string; key: string; pending: Promise<Client>; ready: boolean };
type CredentialAttempt = { generation: number; order: number };
type CredentialChange = { order: number; owner?: string; generation?: number };
const cancelled = () => new SshConnectionError('connection_cancelled', '连接认证周期已结束，请重新连接');
const endClient = (pending: Promise<Client>) => {
  void pending.then((client) => client.end()).catch(() => undefined);
};

export function createSshPool(deps: SshPoolDeps = {}): SshPool {
  const resolver = deps.resolver ?? createConnectionResolver(deps);
  const store = deps.passwordStore;
  const clients = new Map<string, Cached>();
  const epochs = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();
  const identities = new Map<string, string>();
  const credentialChanges = new Map<string, CredentialChange>();
  const invalidated = new Set<string>();
  const paused = new Set<string>();
  const resolving = new Map<string, Promise<ResolvedConnection>>();
  const epoch = (alias: string) => epochs.get(alias) ?? 0;
  let disposed = false;
  let credentialOrder = 0;

  function closeAlias(alias: string): void {
    finishCredentialChange(identities.get(alias), alias, epoch(alias));
    epochs.set(alias, epoch(alias) + 1);
    for (const notify of listeners.get(alias) ?? []) notify();
    for (const [slot, cached] of clients) {
      if (cached.alias !== alias) continue;
      clients.delete(slot);
      endClient(cached.pending);
    }
  }
  function assertCurrent(alias: string, generation: number): void {
    if (disposed || epoch(alias) !== generation) throw cancelled();
  }
  function assertActive(alias: string): void {
    if (disposed) throw cancelled();
    if (paused.has(alias)) throw new SshConnectionError('connection_paused', '连接已主动断开，请点击连接后继续');
  }
  function beginCredentialChange(identity: string, alias: string, attempt: CredentialAttempt): void {
    if ((credentialChanges.get(identity)?.order ?? 0) > attempt.order) throw cancelled();
    credentialChanges.set(identity, { order: attempt.order, owner: alias, generation: attempt.generation });
    // 一个实际目标的密码替换会终止其他别名的旧认证及传输。
    for (const [other, current] of identities) {
      if (current !== identity || other === alias) continue;
      resolver.clear(other);
      closeAlias(other);
    }
  }
  function finishCredentialChange(identity: string | undefined, alias: string, generation: number): void {
    if (identity === undefined) return;
    const change = credentialChanges.get(identity);
    if (change?.owner === alias && change.generation === generation)
      credentialChanges.set(identity, { order: change.order });
  }
  function assertCredentialReadable(identity: string, alias: string, generation: number): void {
    const change = credentialChanges.get(identity);
    if (change?.owner !== undefined && (change.owner !== alias || change.generation !== generation)) throw cancelled();
  }
  function disconnect(alias: string, expectedGeneration?: number): void {
    if (expectedGeneration !== undefined && expectedGeneration !== epoch(alias)) return;
    paused.add(alias);
    resolver.clear(alias);
    closeAlias(alias);
  }
  async function assertIdentity(alias: string, identity: string, generation: number): Promise<void> {
    const current = await resolver.identity(alias);
    assertCurrent(alias, generation);
    if (current !== identity) {
      disconnect(alias, generation);
      throw cancelled();
    }
  }
  async function credentialStatus(alias: string): Promise<CredentialStatus> {
    const generation = epoch(alias);
    const identity = await resolver.identity(alias);
    // 失效只阻止认证复用；删除失败时仍显示磁盘保存项，让用户能够重试清除。
    const saved = (await store?.has(identity)) === true;
    const { hasPassword } = await resolver.authentication(alias);
    if (generation !== epoch(alias)) throw cancelled();
    const connected = [...clients.values()].some((client) => client.alias === alias && client.ready);
    return { saved, savingAvailable: store?.available === true, paused: paused.has(alias), connected, hasPassword };
  }
  async function invalidateIdentity(identity: string): Promise<void> {
    credentialChanges.set(identity, { order: ++credentialOrder });
    invalidated.add(identity);
    for (const [alias, current] of identities) {
      if (current !== identity) continue;
      resolver.clear(alias);
      closeAlias(alias);
    }
    await store?.forget(identity);
  }
  async function invalidateCredentials(alias: string, expectedGeneration?: number): Promise<void> {
    if (expectedGeneration !== undefined && expectedGeneration !== epoch(alias)) return;
    const identity = identities.get(alias);
    if (identity !== undefined) await invalidateIdentity(identity);
    else disconnect(alias, expectedGeneration);
  }
  async function resolveCurrent(target: SshTarget, generation: number): Promise<ResolvedConnection> {
    const alias = targetAlias(target);
    const identity = await resolver.identity(alias);
    assertCurrent(alias, generation);
    assertCredentialReadable(identity, alias, generation);
    const previous = identities.get(alias);
    if (previous !== undefined && previous !== identity) {
      disconnect(alias, generation);
      throw cancelled();
    }
    identities.set(alias, identity);
    const config = await resolver.resolve(target, async (resolvedIdentity) => {
      if (resolvedIdentity !== identity) throw cancelled();
      const password = invalidated.has(identity) ? undefined : await store?.load(identity);
      assertCurrent(alias, generation);
      return password;
    });
    await assertIdentity(alias, identity, generation);
    if (connectionIdentity(config) !== identity) throw cancelled();
    return config;
  }
  async function resolveConnection(target: SshTarget): Promise<ResolvedConnection> {
    const alias = targetAlias(target);
    assertActive(alias);
    const generation = epoch(alias);
    const slot = JSON.stringify([target, generation]);
    const existing = resolving.get(slot);
    if (existing) return existing;
    const pending = resolveCurrent(target, generation);
    resolving.set(slot, pending);
    void pending
      .finally(() => {
        if (resolving.get(slot) === pending) resolving.delete(slot);
      })
      .catch(() => undefined);
    return pending;
  }
  async function getClient(target: SshTarget, guard?: SshChannelGuard): Promise<Client> {
    const alias = targetAlias(target);
    const generation = epoch(alias);
    const config = await resolveConnection(target);
    assertCurrent(alias, generation);
    if (guard) {
      guard.signal.throwIfAborted();
      if (guard.generation !== generation || guard.cacheKey !== config.cacheKey) throw cancelled();
    }
    const slot = JSON.stringify([alias, config.authMode]);
    const cached = clients.get(slot);
    if (cached?.key === config.cacheKey) return cached.pending;
    if (cached) {
      clients.delete(slot);
      endClient(cached.pending);
    }
    const isCurrent = () => !disposed && epoch(alias) === generation && clients.get(slot)?.pending === pending;
    const pending = connectSshClient(config, {
      isCurrent,
      authenticationFailed: async () => {
        if (config.authMode === 'password') await invalidateCredentials(alias, generation);
        else {
          resolver.clear(alias);
          closeAlias(alias);
        }
      },
    });
    const entry: Cached = { alias, key: config.cacheKey, pending, ready: false };
    clients.set(slot, entry);
    const remove = () => {
      if (clients.get(slot)?.pending === pending) clients.delete(slot);
    };
    void pending.then((client) => {
      entry.ready = true;
      client.once('close', remove);
    }, remove);
    return pending;
  }
  async function exec(target: SshTarget, cmd: string, opts: ExecOptions): Promise<ExecResult> {
    const alias = targetAlias(target);
    const generation = epoch(alias);
    const client = await getClient(target);
    assertCurrent(alias, generation);
    const open = (command: string) =>
      new Promise<ChannelLike>((resolve, reject) => {
        client.exec(command, (error: Error | undefined, channel: ClientChannel) =>
          error ? reject(error) : resolve(channel),
        );
      });
    return runExec(open, cmd, opts);
  }
  async function savePreference(
    input: ConnectInput,
    config: ResolvedConnection,
    attempt: CredentialAttempt,
  ): Promise<void> {
    if (config.authMode !== 'password' || input.savePassword === undefined) return;
    const identity = connectionIdentity(config);
    if (input.savePassword) {
      beginCredentialChange(identity, input.sshHost, attempt);
      if (!store?.available)
        throw new CredentialStorageError(
          'password_storage_unavailable',
          '当前平台不支持系统加密保存，仍可使用临时密码',
        );
      await store.save(identity, config.password!, async () => {
        if (disposed || epoch(input.sshHost) !== attempt.generation) return false;
        const current = await resolver.identity(input.sshHost);
        return !disposed && epoch(input.sshHost) === attempt.generation && current === identity;
      });
      assertCurrent(input.sshHost, attempt.generation);
      invalidated.delete(identity);
    } else await store?.forget(identity);
  }
  async function checkAuthenticationInput(input: ConnectInput, generation: number) {
    const { authMode } = await resolver.authentication(input.sshHost);
    assertCurrent(input.sshHost, generation);
    if (authMode !== 'password' && (input.password !== undefined || input.savePassword !== undefined))
      throw new SshConnectionError('credentials_required', '该服务器档案使用私钥认证，不能提交密码或密码保存选项');
  }
  function clearFailedConnect(alias: string, generation: number, replacing: boolean) {
    const connected = [...clients.values()].some((client) => client.alias === alias && client.ready);
    if (epoch(alias) !== generation || (!replacing && connected)) return;
    resolver.clear(alias);
    closeAlias(alias);
  }
  async function connect(input: ConnectInput): Promise<CredentialStatus & { connected: true; authMode: SshAuthMode }> {
    if (disposed) throw cancelled();
    const alias = input.sshHost;
    // 无新凭据的连接测试复用当前连接，不打断同服务器其他工作区。
    const replacing = input.password !== undefined;
    if (replacing) closeAlias(alias);
    paused.delete(alias);
    if (input.password !== undefined) resolver.clear(alias);
    const generation = epoch(alias);
    const attempt = { generation, order: ++credentialOrder };
    let identity: string | undefined;
    try {
      identity = await resolver.identity(alias);
      assertCurrent(alias, generation);
      identities.set(alias, identity);
      await checkAuthenticationInput(input, generation);
      if (input.password !== undefined) {
        beginCredentialChange(identity, alias, attempt);
        await resolver.setPassword(alias, input.password, identity);
      }
      assertCurrent(alias, generation);
      const target = { alias };
      const config = await resolveConnection(target);
      const result = await exec(target, buildRemoteCommand('~', 'test -d . && test -r . && test -x .', 20), {
        localTimeoutMs: 30_000,
        outputCap: 1000,
      });
      await assertIdentity(alias, identity, generation);
      if (result.exitCode !== 0 || result.timedOut)
        throw new SshConnectionError('remote_directory_unavailable', '服务器目录不存在、无法进入或连接测试超时');
      await savePreference(input, config, attempt);
      await assertIdentity(alias, identity, generation);
      const status = await credentialStatus(alias);
      assertCurrent(alias, generation);
      return { ...status, connected: true, authMode: config.authMode };
    } catch (error) {
      clearFailedConnect(alias, generation, replacing);
      throw error;
    } finally {
      finishCredentialChange(identity, alias, generation);
    }
  }
  return {
    fingerprint: (alias) => resolver.fingerprint(alias),
    identity: (alias) => resolver.identity(alias),
    async openExec(target, command, signal) {
      const alias = targetAlias(target);
      const generation = epoch(alias);
      signal?.throwIfAborted();
      const client = await getClient(target);
      assertCurrent(alias, generation);
      signal?.throwIfAborted();
      return new Promise<ClientChannel>((resolve, reject) => {
        const cancelled = () => reject(signal?.reason instanceof Error ? signal.reason : new Error('执行已取消'));
        signal?.addEventListener('abort', cancelled, { once: true });
        client.exec(command, (error, channel) => {
          signal?.removeEventListener('abort', cancelled);
          if (error) return reject(error);
          if (signal?.aborted || generation !== epoch(alias)) {
            channel.on('error', () => undefined);
            channel.close();
            reject(signal?.reason instanceof Error ? signal.reason : new Error('SSH 认证已变化'));
            return;
          }
          resolve(channel);
        });
      });
    },
    generation: epoch,
    onCredentialsChanged(alias, notify) {
      const callbacks = listeners.get(alias) ?? new Set<() => void>();
      listeners.set(alias, callbacks);
      callbacks.add(notify);
      return () => {
        callbacks.delete(notify);
        if (!callbacks.size) listeners.delete(alias);
      };
    },
    resolveConnection,
    async openShell(target, { cols, rows, guard }) {
      const alias = targetAlias(target);
      guard.signal.throwIfAborted();
      const client = await getClient(target, guard);
      assertCurrent(alias, guard.generation);
      guard.signal.throwIfAborted();
      return openGuardedSshChannel<ClientChannel>(
        (done) => client.shell({ term: 'xterm-256color', cols, rows }, done),
        {
          signal: guard.signal,
          current: () => !disposed && !guard.signal.aborted && epoch(alias) === guard.generation,
          release: (channel) => {
            channel.on('error', () => undefined);
            channel.close();
          },
        },
      );
    },
    async openSftp(target, guard) {
      const alias = targetAlias(target);
      const generation = epoch(alias);
      guard?.signal.throwIfAborted();
      const client = await getClient(target, guard);
      assertCurrent(alias, generation);
      const channel = await (guard
        ? openGuardedSshChannel<SFTPWrapper>(
            (done) =>
              client.sftp((error, sftp) => {
                if (sftp) protectSftpChannel(sftp);
                done(error, sftp);
              }),
            {
              signal: guard.signal,
              current: () => !disposed && !guard.signal.aborted && epoch(alias) === guard.generation,
              release: (late) => {
                late.on('error', () => undefined);
                late.end();
              },
            },
          )
        : openSftpChannel(client));
      try {
        assertCurrent(alias, generation);
        return channel;
      } catch (error) {
        channel.end();
        throw error;
      }
    },
    connect,
    exec,
    credentialStatus,
    invalidateCredentials,
    disconnect,
    async forgetServerCredentials(server) {
      // 使用档案事务已核对的身份，不重入档案队列或重新解析已删除的别名。
      disconnect(server.alias);
      const identity = connectionIdentity(server);
      identities.set(server.alias, identity);
      await invalidateIdentity(identity);
    },
    async clearSavedPassword(alias) {
      disconnect(alias);
      const generation = epoch(alias);
      const identity = await resolver.identity(alias);
      assertCurrent(alias, generation);
      identities.set(alias, identity);
      await invalidateIdentity(identity);
      return credentialStatus(alias);
    },
    async setPassword(alias, password) {
      if (disposed) throw cancelled();
      closeAlias(alias);
      paused.delete(alias);
      const generation = epoch(alias);
      const attempt = { generation, order: ++credentialOrder };
      const identity = await resolver.identity(alias);
      assertCurrent(alias, generation);
      identities.set(alias, identity);
      beginCredentialChange(identity, alias, attempt);
      try {
        await resolver.setPassword(alias, password, identity);
        assertCurrent(alias, generation);
      } finally {
        finishCredentialChange(identity, alias, generation);
      }
    },
    dispose() {
      disposed = true;
      resolver.clearAll();
      for (const alias of new Set([...epochs.keys(), ...listeners.keys()])) closeAlias(alias);
      listeners.clear();
      for (const cached of clients.values()) endClient(cached.pending);
      clients.clear();
      resolving.clear();
    },
  };
}
