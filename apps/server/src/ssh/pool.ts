// SSH 连接池：按解析后的目标与认证周期复用；密码留在内存 resolver 中。
import type { Client, ClientChannel } from 'ssh2';
import { connectSshClient } from './client';
import {
  createConnectionResolver,
  SshConnectionError,
  targetAlias,
  type ConnectionDeps,
  type ConnectionResolver,
  type ResolvedConnection,
  type SshTarget,
} from './connection';
import { runExec, type ChannelLike, type ExecOptions, type ExecResult } from './exec';

export type SshPool = {
  exec(target: SshTarget, cmd: string, opts: ExecOptions): Promise<ExecResult>;
  resolveConnection(target: SshTarget): Promise<ResolvedConnection>;
  setPassword(alias: string, password: string): Promise<void>;
  generation(alias: string): number;
  onCredentialsChanged(alias: string, notify: () => void): () => void;
  disconnect(alias: string, expectedGeneration?: number): void;
  dispose(): void;
};
export type SshPoolDeps = ConnectionDeps & { resolver?: ConnectionResolver };
type Cached = { alias: string; key: string; pending: Promise<Client> };
const endClient = (pending: Promise<Client>) => {
  void pending.then((client) => client.end()).catch(() => undefined);
};

export function createSshPool(deps: SshPoolDeps = {}): SshPool {
  const resolver = deps.resolver ?? createConnectionResolver(deps);
  const clients = new Map<string, Cached>();
  const epochs = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();
  const epoch = (alias: string) => epochs.get(alias) ?? 0;
  let disposed = false;

  function closeAlias(alias: string): void {
    epochs.set(alias, epoch(alias) + 1);
    for (const notify of listeners.get(alias) ?? []) notify();
    for (const [slot, cached] of clients) {
      if (cached.alias !== alias) continue;
      clients.delete(slot);
      endClient(cached.pending);
    }
  }

  async function getClient(target: SshTarget): Promise<Client> {
    const alias = targetAlias(target);
    const generation = epoch(alias);
    const config = await resolver.resolve(target);
    if (disposed || epoch(alias) !== generation)
      throw new SshConnectionError('connection_cancelled', '连接认证周期已结束，请重新连接');
    const slot = JSON.stringify([alias, config.authMode]);
    const cached = clients.get(slot);
    if (cached?.key === config.cacheKey) return cached.pending;
    if (cached) {
      clients.delete(slot);
      endClient(cached.pending);
    }
    const isCurrent = () => !disposed && epoch(alias) === generation && clients.get(slot)?.key === config.cacheKey;
    const pending = connectSshClient(config, {
      isCurrent,
      authenticationFailed: () => {
        resolver.clear(alias);
        closeAlias(alias);
      },
    });
    clients.set(slot, { alias, key: config.cacheKey, pending });
    const remove = () => {
      if (clients.get(slot)?.pending === pending) clients.delete(slot);
    };
    void pending.then((client) => {
      client.once('close', remove);
    }, remove);
    return pending;
  }

  return {
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
    resolveConnection: (target) => resolver.resolve(target),
    async setPassword(alias, password) {
      closeAlias(alias);
      await resolver.setPassword(alias, password);
      closeAlias(alias);
    },
    disconnect(alias, expectedGeneration) {
      if (expectedGeneration !== undefined && expectedGeneration !== epoch(alias)) return;
      resolver.clear(alias);
      closeAlias(alias);
    },
    async exec(target, cmd, opts) {
      const client = await getClient(target);
      const open = (command: string) =>
        new Promise<ChannelLike>((resolve, reject) => {
          client.exec(command, (error: Error | undefined, channel: ClientChannel) =>
            error ? reject(error) : resolve(channel),
          );
        });
      return runExec(open, cmd, opts);
    },
    dispose() {
      disposed = true;
      resolver.clearAll();
      for (const alias of listeners.keys()) closeAlias(alias);
      listeners.clear();
      for (const cached of clients.values()) endClient(cached.pending);
      clients.clear();
    },
  };
}
