import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listHosts, parseSshConfig, resolveHost } from '../../src/ssh/ssh-config';

const fixtureHome = path.join(os.tmpdir(), 'ssh-server-fixture', 'home');

describe('parseSshConfig / resolveHost', () => {
  it('处理 BOM、CRLF 与带引号的中文别名', () => {
    const text = '\uFEFFHost "测试 服务器"\r\n  HostName 10.0.0.1\r\n  Port 2222\r\n  User demo\r\n';
    const h = resolveHost(parseSshConfig(text, fixtureHome), '测试 服务器');
    expect(h).toMatchObject({ alias: '测试 服务器', hostname: '10.0.0.1', port: 2222, user: 'demo' });
  });

  it('未设置时 hostname 取别名、port 取 22', () => {
    const h = resolveHost(parseSshConfig('Host a\n  User u\n', fixtureHome), 'a');
    expect(h).toMatchObject({ hostname: 'a', port: 22, user: 'u' });
  });

  it('各匹配块中先出现的值优先，Host * 提供默认值', () => {
    const text = ['Host a', '  User first', 'Host b', '  HostName b.example', 'Host *', '  User fallback'].join('\n');
    const cfg = parseSshConfig(text, fixtureHome);
    expect(resolveHost(cfg, 'a')?.user).toBe('first');
    expect(resolveHost(cfg, 'b')?.user).toBe('fallback');
  });

  it('展开 IdentityFile 中的 ~', () => {
    const h = resolveHost(parseSshConfig('Host a\n  IdentityFile ~/.ssh/k\n', fixtureHome), 'a');
    expect(h?.identityFiles).toEqual([path.join(fixtureHome, '.ssh', 'k')]);
  });

  it('跳过 Match 块，记录不支持的选项', () => {
    const text = ['Host a', '  ProxyJump j', 'Match host a', '  User from-match', 'Host x', '  User x'].join('\n');
    const h = resolveHost(parseSshConfig(text, fixtureHome), 'a');
    expect(h?.user).toBeUndefined();
    expect(h?.unsupported).toContain('ProxyJump');
  });

  it('支持 关键字=值 写法与一行多个别名', () => {
    const cfg = parseSshConfig('Host a b\n  HostName=1.2.3.4\n', fixtureHome);
    expect(resolveHost(cfg, 'b')?.hostname).toBe('1.2.3.4');
  });

  it('只被通配符匹配的别名视为未配置', () => {
    expect(resolveHost(parseSshConfig('Host *\n  User u\n', fixtureHome), 'nope')).toBeUndefined();
  });

  it('Host * 写在前面时显式别名仍能解析，且先出现的值优先', () => {
    const cfg = parseSshConfig(
      ['Host *', '  User fallback', 'Host a', '  User later', '  Port 2200'].join('\n'),
      fixtureHome,
    );
    expect(resolveHost(cfg, 'a')).toMatchObject({ user: 'fallback', port: 2200 });
  });

  it('! 取反的模式使整个块不匹配', () => {
    const cfg = parseSshConfig(['Host a', '  HostName a.example', 'Host * !a', '  Port 2222'].join('\n'), fixtureHome);
    expect(resolveHost(cfg, 'a')?.port).toBe(22);
  });

  it('多个 IdentityFile 按顺序全部保留；全局 Include 记为不支持', () => {
    const text = ['Include other.conf', 'Host a', '  IdentityFile ~/.ssh/k1', '  IdentityFile ~/.ssh/k2'].join('\n');
    const h = resolveHost(parseSshConfig(text, fixtureHome), 'a');
    expect(h?.identityFiles).toEqual([path.join(fixtureHome, '.ssh', 'k1'), path.join(fixtureHome, '.ssh', 'k2')]);
    expect(h?.unsupported).toContain('Include');
  });
});

describe('listHosts', () => {
  it('只列出不含通配符的别名', () => {
    const text = ['Host my-server', '  HostName 10.0.0.2', 'Host dev-*', '  User d', 'Host *', '  User u'].join('\n');
    const hosts = listHosts(parseSshConfig(text, fixtureHome));
    expect(hosts.map((h) => h.alias)).toEqual(['my-server']);
    expect(hosts[0]).toMatchObject({ hostname: '10.0.0.2', user: 'u', port: 22, unsupported: [] });
  });
});
