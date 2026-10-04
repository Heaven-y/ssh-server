import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHostTrust } from '../../src/ssh/host-trust';

afterEach(() => vi.restoreAllMocks());
const key = (value: number) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 11]),
    Buffer.from('ssh-ed25519'),
    Buffer.from([0, 0, 0, 32]),
    Buffer.alloc(32, value),
  ]);
function fixture() {
  const state = { known: '', actual: key(1), generation: 1, signature: 'original', username: 'demo' };
  const append = vi.fn((_file: string, line: string) => {
    state.known += line;
    return Promise.resolve();
  });
  const trust = createHostTrust({
    pool: {
      identity: () => Promise.resolve(JSON.stringify(['example.invalid', 22, state.username])),
      fingerprint: () => Promise.resolve(state.signature),
      generation: () => state.generation,
    },
    readFile: () => Promise.resolve(Buffer.from(state.known)),
    probe: () => Promise.resolve(state.actual),
    append,
  });
  return { state, trust, append };
}
describe('实际主机指纹的一次性确认', () => {
  it('仅追加实际公钥，匹配后不再发票，重放不能再写', async () => {
    const f = fixture();
    f.state.known = '# 保留原记录';
    const checked = await f.trust.probe('my-server', new AbortController().signal);
    const request = { challenge: checked.challenge!, fingerprint: checked.fingerprint, confirmed: true as const };
    expect(checked.status).toBe('unknown');
    expect((await f.trust.confirm(request, new AbortController().signal)).status).toBe('trusted');
    expect(f.state.known).toBe(`# 保留原记录\nexample.invalid ssh-ed25519 ${key(1).toString('base64')}\n`);
    const trusted = await f.trust.probe('my-server', new AbortController().signal);
    expect(trusted.status).toBe('trusted');
    expect(trusted.challenge).toBeUndefined();
    await expect(f.trust.confirm(request, new AbortController().signal)).rejects.toMatchObject({
      code: 'host_trust_expired',
    });
    expect(f.append).toHaveBeenCalledTimes(1);
    f.trust.dispose();
  });
  it.each(['公钥', '信任文件', '账号', '代次', '过期', '重查'] as const)(
    '%s变化拒绝旧确认且不写信任',
    async (change) => {
      const f = fixture();
      const checked = await f.trust.probe('my-server', new AbortController().signal);
      if (change === '公钥') f.state.actual = key(2);
      if (change === '信任文件') f.state.known = '# 外部修改\n';
      if (change === '账号') f.state.username = 'other';
      if (change === '代次') f.state.generation++;
      if (change === '过期') vi.spyOn(Date, 'now').mockReturnValue(checked.expiresAt! + 1);
      if (change === '重查') await f.trust.probe('my-server', new AbortController().signal);
      await expect(
        f.trust.confirm(
          { challenge: checked.challenge!, fingerprint: checked.fingerprint, confirmed: true },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code: ['过期', '重查'].includes(change) ? 'host_trust_expired' : 'host_trust_changed',
      });
      expect(f.append).not.toHaveBeenCalled();
      f.trust.dispose();
    },
  );
  it.each(['mismatch', 'revoked'] as const)('已登记公钥%s时不能重新信任', async (mode) => {
    const f = fixture();
    f.state.known = `${mode === 'revoked' ? '@revoked ' : ''}example.invalid ssh-ed25519 ${key(mode === 'revoked' ? 1 : 2).toString('base64')}\n`;
    await expect(f.trust.probe('my-server', new AbortController().signal)).rejects.toMatchObject({
      code: mode === 'revoked' ? 'host_key_revoked' : 'host_key_mismatch',
    });
    expect(f.append).not.toHaveBeenCalled();
    f.trust.dispose();
  });
});
