// 独立本机服务器表；不改写SSH config，不保存密码或私钥正文。
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ManagedServerSchema, ManualServerInputSchema, type ManagedServer } from '@ssh-server/shared';
import type { SshHostConfig } from './ssh-config';

export class ServerTargetsError extends Error {
  constructor(readonly code: 'invalid_target' | 'too_many_targets' | 'target_storage_failed') {
    super(
      {
        invalid_target: '手动服务器字段不合法，请检查地址、端口、账号和私钥路径',
        too_many_targets: '本机服务器连接已达到128项上限',
        target_storage_failed: '本机服务器连接配置不可读取或保存，请检查配置目录',
      }[code],
    );
  }
}
const ServersSchema = z.array(ManagedServerSchema).max(128);
const identity = (server: ManagedServer) =>
  JSON.stringify([server.hostname, server.port, server.username, server.keyFile]);
export function serverHostConfig(server: ManagedServer): SshHostConfig {
  return {
    alias: server.alias,
    hostname: server.hostname,
    port: server.port,
    user: server.username,
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
  async function persist(servers: ManagedServer[]) {
    const temp = `${file}.tmp-${randomUUID()}`;
    try {
      await mkdir(configDir, { recursive: true });
      await writeFile(temp, JSON.stringify(servers, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      await rename(temp, file);
    } catch {
      throw new ServerTargetsError('target_storage_failed');
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }
  return {
    list: () => serial(load),
    get: (alias: string) => serial(async () => (await load()).find((server) => server.alias === alias)),
    save: (input: unknown) =>
      serial(async () => {
        const parsed = ManualServerInputSchema.safeParse(input);
        if (!parsed.success) throw new ServerTargetsError('invalid_target');
        const server: ManagedServer = {
          ...parsed.data,
          keyFile: privateKeyPath(parsed.data.keyFile, homeDir),
          alias: 'managed-ssh-' + randomUUID(),
        };
        const servers = await load();
        const index = servers.findIndex((item) => identity(item) === identity(server));
        if (index >= 0) {
          server.alias = servers[index]!.alias;
          servers[index] = server;
        } else {
          if (servers.length >= 128) throw new ServerTargetsError('too_many_targets');
          servers.push(server);
        }
        await persist(servers);
        return server;
      }),
  };
}
export type ServerTargets = ReturnType<typeof createServerTargets>;
