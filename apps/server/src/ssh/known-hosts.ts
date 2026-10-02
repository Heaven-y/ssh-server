// 校验服务器主机密钥是否与 ~/.ssh/known_hosts 中的记录一致
import { createHmac, timingSafeEqual } from 'node:crypto';

export type HostKeyCheck = 'match' | 'unknown' | 'mismatch' | 'revoked';

type Entry = { marker?: string; hosts: string[]; type: string; key: Buffer };

function validBase64(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '');
}

function parseEntries(text: string): Entry[] {
  const out: Entry[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const marker = parts[0]!.startsWith('@') ? parts.shift() : undefined;
    const [hosts, type, keyB64] = parts;
    if (!hosts || !type || !keyB64) continue;
    if (!validBase64(keyB64)) continue;
    out.push({ marker, hosts: hosts.split(','), type, key: Buffer.from(keyB64, 'base64') });
  }
  return out;
}

/** known_hosts 中的主机名写法：默认端口直接写主机名，其他端口写成 [host]:port */
function hostName(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

function wildcardMatch(pattern: string, name: string): boolean {
  const re = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  );
  return re.test(name);
}

function hostMatches(pattern: string, name: string): boolean {
  if (pattern.startsWith('|1|')) {
    const [, , saltB64, hashB64] = pattern.split('|');
    if (!saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = createHmac('sha1', Buffer.from(saltB64, 'base64')).update(name).digest();
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  return wildcardMatch(pattern, name);
}

function entryMatchesHost(e: Entry, name: string): boolean {
  if (e.hosts.some((p) => p.startsWith('!') && hostMatches(p.slice(1), name))) return false;
  return e.hosts.some((p) => !p.startsWith('!') && hostMatches(p, name));
}

function entriesFor(text: string, host: string, port: number): Entry[] {
  const name = hostName(host, port);
  return parseEntries(text).filter((e) => entryMatchesHost(e, name));
}

/** 从 SSH 线格式公钥中读出类型（开头是 4 字节长度 + 类型名） */
function keyType(key: Buffer): string | undefined {
  if (key.length < 4) return undefined;
  const len = key.readUInt32BE(0);
  return len > 0 && 4 + len <= key.length ? key.subarray(4, 4 + len).toString('latin1') : undefined;
}

/** 从已有信任记录筛出该目标；不读取或信任远端新密钥，也不修改用户 known_hosts。 */
export function knownHostsForTarget(text: string, host: string, port: number): string {
  const name = hostName(host, port);
  return entriesFor(text, host, port)
    .filter((entry) => entry.marker === undefined || entry.marker === '@revoked')
    .filter((entry) => keyType(entry.key) === entry.type)
    .map((entry) => `${entry.marker ? `${entry.marker} ` : ''}${name} ${entry.type} ${entry.key.toString('base64')}\n`)
    .join('');
}

const sameKey = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/**
 * 与 OpenSSH 一致：只和同类型的记录比较。
 * key 是服务器发来的公钥（SSH 线格式，与 known_hosts 中 base64 解码后的内容一致）。
 */
export function verifyHostKey(knownHostsText: string, host: string, port: number, key: Buffer): HostKeyCheck {
  const type = keyType(key);
  const entries = entriesFor(knownHostsText, host, port).filter((e) => e.type === type);

  if (entries.some((e) => e.marker === '@revoked' && sameKey(e.key, key))) return 'revoked';
  const plain = entries.filter((e) => e.marker === undefined);
  if (plain.some((e) => sameKey(e.key, key))) return 'match';
  return plain.length > 0 ? 'mismatch' : 'unknown';
}

/** 该主机在 known_hosts 中已登记的密钥类型（按出现顺序，去重，不含 @ 标记的条目） */
export function knownHostKeyTypes(knownHostsText: string, host: string, port: number): string[] {
  const types = entriesFor(knownHostsText, host, port)
    .filter((e) => e.marker === undefined)
    .map((e) => e.type);
  return [...new Set(types)];
}

/** ssh2 支持的主机密钥算法（不在其中的类型传给 ssh2 会直接报错） */
const SSH2_HOST_KEY_ALGORITHMS = new Set([
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'rsa-sha2-512',
  'rsa-sha2-256',
  'ssh-rsa',
  'ssh-dss',
]);

/**
 * 把已登记的密钥类型转换为协商用的主机密钥算法列表。
 * 与 OpenSSH 一致：主机已在 known_hosts 中登记时只协商登记过的类型，
 * 否则服务器可能出示一种未登记的密钥，导致校验失败。
 */
export function hostKeyAlgorithms(types: string[]): string[] {
  const algos = types.flatMap((t) => (t === 'ssh-rsa' ? ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'] : [t]));
  return [...new Set(algos)].filter((a) => SSH2_HOST_KEY_ALGORITHMS.has(a));
}
