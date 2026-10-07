// 独立本机服务器表；不改写SSH config，不保存密码或私钥正文。
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ManagedServerSchema, ManualServerInputSchema, type ManagedServer } from '@ssh-server/shared';
import type { RegisteredSshHost } from './connection';
import { listHosts, parseSshConfig, resolveHost } from './ssh-config';

const messages = {
  invalid_target: '服务器字段不合法，请检查地址、端口、账号和认证方式',
  too_many_targets: '本机服务器连接已达到128项上限',
  target_storage_failed: '本机服务器连接配置不可读取或保存，请检查配置目录',
  target_duplicate: '该服务器账号已登记，请修改已有档案',
  target_missing: '服务器档案不存在，请刷新列表',
  target_changed: '服务器档案已变化，请刷新后重新确认',
  target_referenced: '服务器仍被工作区引用，不能删除或改变地址、端口、账号和私钥目标',
  target_busy: '服务器关联工作区仍有活动或未解决任务，请结束并核对后重试',
};
export class ServerTargetsError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
  get status() {
    if (this.code === 'invalid_target') return 400;
    if (this.code === 'target_missing') return 404;
    return this.code === 'target_storage_failed' ? 500 : 409;
  }
}
const ServersSchema = z
  .array(ManagedServerSchema)
  .max(128)
  .refine(
    (servers) =>
      new Set(servers.map((server) => server.alias)).size === servers.length &&
      new Set(servers.map(identity)).size === servers.length,
  );
const identity = (server: ManagedServer) => JSON.stringify([server.hostname, server.port, server.username]);
export const serverDestination = (server: ManagedServer) => JSON.stringify([identity(server), server.keyFile]);
export function serverHostConfig(server: ManagedServer): RegisteredSshHost {
  return {
    alias: server.alias,
    hostname: server.hostname,
    port: server.port,
    user: server.username,
    authMode: server.authMode,
    identityFiles: server.keyFile ? [server.keyFile] : [],
    unsupported: [],
  };
}
function privateKeyPath(value: string | undefined, homeDir: string): string | undefined {
  if (!value) return undefined;
  const expanded = /^~[/\\]/.test(value) ? path.join(homeDir, value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw new ServerTargetsError('invalid_target');
  return path.resolve(expanded);
}
type BeforeCommit = (current: ManagedServer, next?: ManagedServer) => Promise<void>;
export function createServerTargets({ configDir, homeDir = os.homedir() }: { configDir: string; homeDir?: string }) {
  const file = path.join(configDir, 'servers.json');
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>) => {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run;
  };
  async function load(): Promise<ManagedServer[]> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ServerTargetsError('target_storage_failed');
    }
    try {
      return ServersSchema.parse(JSON.parse(text));
    } catch {
      throw new ServerTargetsError('target_storage_failed');
    }
  }
  async function persist(servers: ManagedServer[], beforeCommit?: () => Promise<void>) {
    const temp = `${file}.tmp-${randomUUID()}`;
    try {
      try {
        await mkdir(configDir, { recursive: true });
        await writeFile(temp, JSON.stringify(servers, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      } catch {
        throw new ServerTargetsError('target_storage_failed');
      }
      // 调用方在同一工作区快照和活动排他锁内再次核对；回调不得重入档案存储。
      await beforeCommit?.();
      await rename(temp, file).catch(() => {
        throw new ServerTargetsError('target_storage_failed');
      });
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }
  function normalize(input: unknown, alias: string): ManagedServer {
    const parsed = ManualServerInputSchema.safeParse(input);
    if (!parsed.success) throw new ServerTargetsError('invalid_target');
    const { keyFile: rawKeyFile, ...fields } = parsed.data;
    const keyFile = privateKeyPath(rawKeyFile, homeDir);
    return { ...fields, ...(keyFile ? { keyFile } : {}), alias };
  }
  function currentRecord(servers: ManagedServer[], alias: string, expected: ManagedServer) {
    if (!ManagedServerSchema.safeParse(expected).success) throw new ServerTargetsError('invalid_target');
    const current = servers.find((server) => server.alias === alias);
    if (!current) throw new ServerTargetsError('target_missing');
    if (!isDeepStrictEqual(current, expected)) throw new ServerTargetsError('target_changed');
    return current;
  }
  function assertUnique(servers: ManagedServer[], next: ManagedServer) {
    if (servers.some((server) => server.alias !== next.alias && identity(server) === identity(next)))
      throw new ServerTargetsError('target_duplicate');
  }
  return {
    list: () => serial(load),
    get: (alias: string) => serial(async () => (await load()).find((server) => server.alias === alias)),
    async importOptions() {
      let text: string;
      try {
        text = await readFile(path.join(homeDir, '.ssh', 'config'), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw new ServerTargetsError('target_storage_failed');
      }
      const config = parseSshConfig(text, homeDir);
      return listHosts(config).map((host) => ({ ...host, keyFile: resolveHost(config, host.alias)?.identityFiles[0] }));
    },
    save: (input: unknown) =>
      serial(async () => {
        const server = normalize(input, 'managed-ssh-' + randomUUID());
        const servers = await load();
        assertUnique(servers, server);
        if (servers.length >= 128) throw new ServerTargetsError('too_many_targets');
        await persist([...servers, server]);
        return server;
      }),
    update: (alias: string, input: unknown, expected: ManagedServer, beforeCommit?: BeforeCommit) =>
      serial(async () => {
        const servers = await load();
        const current = currentRecord(servers, alias, expected);
        const next = normalize(input, alias);
        assertUnique(servers, next);
        await persist(
          servers.map((server) => (server.alias === alias ? next : server)),
          () => beforeCommit?.(current, next) ?? Promise.resolve(),
        );
        return next;
      }),
    remove: (alias: string, expected: ManagedServer, beforeCommit?: BeforeCommit) =>
      serial(async () => {
        const servers = await load();
        const current = currentRecord(servers, alias, expected);
        await persist(
          servers.filter((server) => server.alias !== alias),
          () => beforeCommit?.(current) ?? Promise.resolve(),
        );
      }),
  };
}
export type ServerTargets = ReturnType<typeof createServerTargets>;
