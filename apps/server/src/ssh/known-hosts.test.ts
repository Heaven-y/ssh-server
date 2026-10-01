import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyHostKey } from './known-hosts';

const key = randomBytes(32);
const other = randomBytes(32);
const b64 = (b: Buffer) => b.toString('base64');

function hashed(name: string): string {
  const salt = randomBytes(20);
  const hash = createHmac('sha1', salt).update(name).digest();
  return `|1|${b64(salt)}|${b64(hash)}`;
}

describe('verifyHostKey', () => {
  it('普通条目在默认端口匹配', () => {
    expect(verifyHostKey(`h1 ssh-ed25519 ${b64(key)}\n`, 'h1', 22, key)).toBe('match');
  });

  it('[host]:port 条目只匹配对应端口', () => {
    const text = `[h1]:2222 ssh-ed25519 ${b64(key)}\n`;
    expect(verifyHostKey(text, 'h1', 2222, key)).toBe('match');
    expect(verifyHostKey(text, 'h1', 22, key)).toBe('unknown');
  });

  it('支持逗号分隔的多个主机名', () => {
    expect(verifyHostKey(`h0,h1 ssh-rsa ${b64(key)}\n`, 'h1', 22, key)).toBe('match');
  });

  it('支持哈希条目', () => {
    expect(verifyHostKey(`${hashed('[h1]:2222')} ssh-ed25519 ${b64(key)}\n`, 'h1', 2222, key)).toBe('match');
    expect(verifyHostKey(`${hashed('h1')} ssh-ed25519 ${b64(key)}\n`, 'h1', 22, key)).toBe('match');
  });

  it('@revoked 条目视为拒绝', () => {
    expect(verifyHostKey(`@revoked h1 ssh-ed25519 ${b64(key)}\n`, 'h1', 22, key)).toBe('revoked');
  });

  it('主机存在但密钥不同时返回 mismatch', () => {
    expect(verifyHostKey(`h1 ssh-ed25519 ${b64(other)}\n`, 'h1', 22, key)).toBe('mismatch');
  });

  it('没有条目时返回 unknown，忽略注释和空行', () => {
    expect(verifyHostKey(`# comment\n\nh2 ssh-ed25519 ${b64(key)}\r\n`, 'h1', 22, key)).toBe('unknown');
  });
});
