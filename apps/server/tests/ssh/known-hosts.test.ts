import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hostKeyAlgorithms, knownHostKeyTypes, knownHostsForTarget, verifyHostKey } from '../../src/ssh/known-hosts';

/** 构造 SSH 线格式的公钥：string(type) + string(随机内容)，每段以 4 字节长度开头 */
function lenPrefixed(b: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
}
function blob(type: string): Buffer {
  return Buffer.concat([lenPrefixed(Buffer.from(type)), lenPrefixed(randomBytes(32))]);
}

const ed = blob('ssh-ed25519');
const edOther = blob('ssh-ed25519');
const ecdsa = blob('ecdsa-sha2-nistp256');
const b64 = (b: Buffer) => b.toString('base64');

function hashed(name: string): string {
  const salt = randomBytes(20);
  const hash = createHmac('sha1', salt).update(name).digest();
  return `|1|${b64(salt)}|${b64(hash)}`;
}

describe('verifyHostKey', () => {
  it('普通条目在默认端口匹配', () => {
    expect(verifyHostKey(`h1 ssh-ed25519 ${b64(ed)}\n`, 'h1', 22, ed)).toBe('match');
  });

  it('[host]:port 条目只匹配对应端口', () => {
    const text = `[h1]:2222 ssh-ed25519 ${b64(ed)}\n`;
    expect(verifyHostKey(text, 'h1', 2222, ed)).toBe('match');
    expect(verifyHostKey(text, 'h1', 22, ed)).toBe('unknown');
  });

  it('支持逗号分隔的多个主机名', () => {
    expect(verifyHostKey(`h0,h1 ssh-ed25519 ${b64(ed)}\n`, 'h1', 22, ed)).toBe('match');
  });

  it('支持哈希条目', () => {
    expect(verifyHostKey(`${hashed('[h1]:2222')} ssh-ed25519 ${b64(ed)}\n`, 'h1', 2222, ed)).toBe('match');
    expect(verifyHostKey(`${hashed('h1')} ssh-ed25519 ${b64(ed)}\n`, 'h1', 22, ed)).toBe('match');
  });

  it('@revoked 条目视为拒绝', () => {
    expect(verifyHostKey(`@revoked h1 ssh-ed25519 ${b64(ed)}\n`, 'h1', 22, ed)).toBe('revoked');
  });

  it('同类型密钥不同时返回 mismatch', () => {
    expect(verifyHostKey(`h1 ssh-ed25519 ${b64(edOther)}\n`, 'h1', 22, ed)).toBe('mismatch');
  });

  it('只登记了其他类型的密钥时不算不一致，返回 unknown', () => {
    expect(verifyHostKey(`h1 ecdsa-sha2-nistp256 ${b64(ecdsa)}\n`, 'h1', 22, ed)).toBe('unknown');
  });

  it('同一主机登记多种类型时按类型比对', () => {
    const text = `h1 ecdsa-sha2-nistp256 ${b64(ecdsa)}\nh1 ssh-ed25519 ${b64(ed)}\n`;
    expect(verifyHostKey(text, 'h1', 22, ecdsa)).toBe('match');
    expect(verifyHostKey(text, 'h1', 22, ed)).toBe('match');
  });

  it('没有条目时返回 unknown，忽略注释和空行', () => {
    expect(verifyHostKey(`# comment\n\nh2 ssh-ed25519 ${b64(ed)}\r\n`, 'h1', 22, ed)).toBe('unknown');
  });
});

describe('knownHostKeyTypes', () => {
  it('返回该主机已登记的密钥类型（不含 @revoked）', () => {
    const text = [
      `[h1]:2222 ecdsa-sha2-nistp256 ${b64(ecdsa)}`,
      `[h1]:2222 ssh-rsa ${b64(ed)}`,
      `@revoked [h1]:2222 ssh-ed25519 ${b64(ed)}`,
      `h2 ssh-ed25519 ${b64(ed)}`,
    ].join('\n');
    expect(knownHostKeyTypes(text, 'h1', 2222)).toEqual(['ecdsa-sha2-nistp256', 'ssh-rsa']);
    expect(knownHostKeyTypes(text, 'h3', 22)).toEqual([]);
  });
});

describe('hostKeyAlgorithms', () => {
  it('把密钥类型映射为协商用的算法名，ssh-rsa 展开为 rsa-sha2-*', () => {
    expect(hostKeyAlgorithms(['ecdsa-sha2-nistp256', 'ssh-rsa'])).toEqual([
      'ecdsa-sha2-nistp256',
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-rsa',
    ]);
  });

  it('过滤掉 ssh2 不支持的类型，避免连接时报错', () => {
    expect(hostKeyAlgorithms(['sk-ssh-ed25519@openssh.com', 'ssh-ed25519'])).toEqual(['ssh-ed25519']);
    expect(hostKeyAlgorithms(['sk-ecdsa-sha2-nistp256@openssh.com'])).toEqual([]);
  });
});

describe('rclone 使用的目标信任记录', () => {
  it('只保留匹配目标，哈希与通配符规范化并保留吊销记录', () => {
    const text = [
      `${hashed('[h1]:2222')} ssh-ed25519 ${b64(ed)}`,
      `@revoked [h*]:2222 ssh-ed25519 ${b64(edOther)}`,
      'unrelated ssh-ed25519 invalid!base64',
      `![h1]:2222,[h*]:2222 ssh-ed25519 ${b64(edOther)}`,
    ].join('\n');
    const selected = knownHostsForTarget(text, 'h1', 2222);
    expect(selected).toBe(`[h1]:2222 ssh-ed25519 ${b64(ed)}\n@revoked [h1]:2222 ssh-ed25519 ${b64(edOther)}\n`);
    expect(verifyHostKey(selected, 'h1', 2222, ed)).toBe('match');
    expect(verifyHostKey(selected, 'h1', 2222, edOther)).toBe('revoked');
    expect(knownHostsForTarget(text, 'unknown', 22)).toBe('');
  });
  it('格式损坏的匹配密钥不能被自动修正为可信记录', () => {
    const invalid = `h1 ssh-ed25519 ${b64(ed).slice(0, 12)}!${b64(ed).slice(12)}`;
    expect(verifyHostKey(invalid, 'h1', 22, ed)).toBe('unknown');
    expect(knownHostsForTarget(invalid, 'h1', 22)).toBe('');
  });
});
