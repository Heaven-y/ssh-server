// 校验服务器主机密钥是否与 ~/.ssh/known_hosts 中的记录一致
import { createHmac, timingSafeEqual } from 'node:crypto';

export type HostKeyCheck = 'match' | 'unknown' | 'mismatch' | 'revoked';

type Entry = { marker?: string; hosts: string[]; key: Buffer };

function parseEntries(text: string): Entry[] {
  const out: Entry[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const marker = parts[0]!.startsWith('@') ? parts.shift() : undefined;
    const [hosts, , keyB64] = parts;
    if (!hosts || !keyB64) continue;
    out.push({ marker, hosts: hosts.split(','), key: Buffer.from(keyB64, 'base64') });
  }
  return out;
}

/** known_hosts 中的主机名写法：默认端口直接写主机名，其他端口写成 [host]:port */
function hostName(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

function wildcardMatch(pattern: string, name: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
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

const sameKey = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/** key 是服务器发来的公钥（SSH 线格式，与 known_hosts 中 base64 解码后的内容一致） */
export function verifyHostKey(knownHostsText: string, host: string, port: number, key: Buffer): HostKeyCheck {
  const name = hostName(host, port);
  const entries = parseEntries(knownHostsText).filter((e) => entryMatchesHost(e, name));

  if (entries.some((e) => e.marker === '@revoked' && sameKey(e.key, key))) return 'revoked';
  const plain = entries.filter((e) => e.marker === undefined);
  if (plain.some((e) => sameKey(e.key, key))) return 'match';
  return plain.length > 0 ? 'mismatch' : 'unknown';
}
