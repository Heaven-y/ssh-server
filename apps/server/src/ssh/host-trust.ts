import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { HostTrustConfirmation, HostTrustStatus } from '@ssh-server/shared';
import type { SshPool } from './pool';
import { SshConnectionError } from './connection';
import { hostKeyType, knownHostName, verifyHostKey } from './known-hosts';
import { probeSshHostKey, type HostIdentity } from './host-key';

export class HostTrustError extends Error {
  constructor(readonly code: 'host_trust_expired' | 'host_trust_changed' | 'host_trust_full' | 'host_trust_storage') {
    super(
      {
        host_trust_expired: '指纹确认已过期或使用，请重新检查',
        host_trust_changed: '目标、信任记录或主机公钥已变化，请重新核对',
        host_trust_full: '指纹检查数量已满，请关闭旧检查或稍后重试',
        host_trust_storage: '主机信任记录不可读取或追加，请检查本机known_hosts权限',
      }[code],
    );
  }
}
const IdentitySchema = z.tuple([z.string().min(1), z.number().int().min(1).max(65535), z.string().min(1)]);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('base64').replace(/=+$/, '');
type Snapshot = { alias: string; target: HostIdentity; signature: string; generation: number; knownHosts: string };
type Challenge = { snapshot: Snapshot; key: Buffer; status: HostTrustStatus; expiresAt: number };
type Deps = {
  pool: Pick<SshPool, 'identity' | 'fingerprint' | 'generation'>;
  homeDir?: string;
  readFile?: (file: string) => Promise<Buffer>;
  append?: (file: string, line: string) => Promise<void>;
  probe?: typeof probeSshHostKey;
};
export function createHostTrust(deps: Deps) {
  const file = path.join(deps.homeDir ?? os.homedir(), '.ssh', 'known_hosts');
  const read = deps.readFile ?? readFile;
  const handshake = deps.probe ?? probeSshHostKey;
  const lifetime = new AbortController();
  const challenges = new Map<string, Challenge>();
  let queue: Promise<unknown> = Promise.resolve();
  async function knownHosts() {
    try {
      return (await read(file)).toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw new HostTrustError('host_trust_storage');
    }
  }
  async function snapshot(alias: string, signal: AbortSignal): Promise<Snapshot> {
    signal.throwIfAborted();
    const generation = deps.pool.generation(alias);
    const [hostname, port, username] = IdentitySchema.parse(JSON.parse(await deps.pool.identity(alias)));
    const signature = await deps.pool.fingerprint(alias);
    const records = await knownHosts();
    signal.throwIfAborted();
    if (signature !== (await deps.pool.fingerprint(alias)) || generation !== deps.pool.generation(alias))
      throw new HostTrustError('host_trust_changed');
    return { alias, target: { hostname, port, username }, signature, generation, knownHosts: records };
  }
  async function validate(prior: Snapshot, signal: AbortSignal) {
    const current = await snapshot(prior.alias, signal);
    if (
      current.signature !== prior.signature ||
      current.generation !== prior.generation ||
      digest(current.knownHosts) !== digest(prior.knownHosts) ||
      JSON.stringify(current.target) !== JSON.stringify(prior.target)
    )
      throw new HostTrustError('host_trust_changed');
    return current;
  }
  function checkTrust(snapshot: Snapshot, key: Buffer) {
    const check = verifyHostKey(snapshot.knownHosts, snapshot.target.hostname, snapshot.target.port, key);
    if (check === 'mismatch')
      throw new SshConnectionError('host_key_mismatch', '主机密钥与known_hosts不一致，已拒绝接受');
    if (check === 'revoked') throw new SshConnectionError('host_key_revoked', '主机密钥已吊销，已拒绝接受');
    return check;
  }
  function cleanup() {
    for (const [id, challenge] of challenges) if (challenge.expiresAt <= Date.now()) challenges.delete(id);
  }
  async function confirm(input: HostTrustConfirmation, parent: AbortSignal) {
    const signal = AbortSignal.any([parent, lifetime.signal]);
    cleanup();
    const item = challenges.get(input.challenge);
    challenges.delete(input.challenge);
    if (!item) throw new HostTrustError('host_trust_expired');
    if (!input.confirmed || input.fingerprint !== item.status.fingerprint)
      throw new HostTrustError('host_trust_changed');
    const before = await validate(item.snapshot, signal);
    const actual = await handshake(before.target, before.knownHosts, signal);
    if (!actual.equals(item.key)) throw new HostTrustError('host_trust_changed');
    const current = await validate(before, signal);
    if (checkTrust(current, actual) !== 'unknown') throw new HostTrustError('host_trust_changed');
    const prefix = current.knownHosts && !current.knownHosts.endsWith('\n') ? '\n' : '';
    const line = `${prefix}${knownHostName(current.target.hostname, current.target.port)} ${item.status.algorithm} ${actual.toString('base64')}\n`;
    signal.throwIfAborted();
    try {
      if (deps.append) await deps.append(file, line);
      else {
        await mkdir(path.dirname(file), { recursive: true });
        await appendFile(file, line, { encoding: 'utf8', mode: 0o600 });
      }
    } catch {
      throw new HostTrustError('host_trust_storage');
    }
    return { ...item.status, status: 'trusted' as const, challenge: undefined, expiresAt: undefined };
  }
  return {
    async probe(alias: string, parent: AbortSignal): Promise<HostTrustStatus> {
      const signal = AbortSignal.any([parent, lifetime.signal]);
      const before = await snapshot(alias, signal);
      const key = await handshake(before.target, before.knownHosts, signal);
      await validate(before, signal);
      const check = checkTrust(before, key);
      const algorithm = hostKeyType(key);
      if (!algorithm) throw new SshConnectionError('connection_failed', '服务器公钥格式不可识别');
      const status: HostTrustStatus = {
        status: check === 'match' ? 'trusted' : 'unknown',
        alias,
        target: before.target,
        algorithm,
        fingerprint: 'SHA256:' + digest(key),
      };
      if (status.status === 'trusted') return status;
      cleanup();
      for (const [id, old] of challenges) if (old.snapshot.alias === alias) challenges.delete(id);
      if (challenges.size >= 32) throw new HostTrustError('host_trust_full');
      status.challenge = randomUUID();
      status.expiresAt = Date.now() + 120000;
      challenges.set(status.challenge, { snapshot: before, key, status, expiresAt: status.expiresAt });
      return { ...status };
    },
    confirm(input: HostTrustConfirmation, signal: AbortSignal) {
      const run = queue.then(
        () => confirm(input, signal),
        () => confirm(input, signal),
      );
      queue = run.catch(() => undefined);
      return run;
    },
    dispose() {
      lifetime.abort();
      challenges.clear();
    },
  };
}
export type HostTrust = ReturnType<typeof createHostTrust>;
