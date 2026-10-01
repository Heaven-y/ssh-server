import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('默认值', () => {
    const c = loadConfig({}, []);
    expect(c.port).toBe(4317);
    expect(c.host).toBe('127.0.0.1');
    expect(c.configDir.endsWith('ssh-server')).toBe(true);
    expect(c.token.length).toBeGreaterThanOrEqual(43);
    expect(c.devOrigin).toBeUndefined();
  });

  it('只允许监听本机地址', () => {
    expect(() => loadConfig({ SSH_SERVER_HOST: '0.0.0.0' }, [])).toThrow();
    expect(() => loadConfig({ SSH_SERVER_HOST: '192.168.1.2' }, [])).toThrow();
    expect(loadConfig({ SSH_SERVER_HOST: '::1' }, []).host).toBe('::1');
  });

  it('读取环境变量', () => {
    const c = loadConfig({ SSH_SERVER_TOKEN: 't', SSH_SERVER_PORT: '0', SSH_SERVER_CONFIG_DIR: 'D:/cfg' }, []);
    expect(c.token).toBe('t');
    expect(c.port).toBe(0);
    expect(c.configDir).toBe('D:/cfg');
  });

  it('端口不合法时抛错', () => {
    expect(() => loadConfig({ SSH_SERVER_PORT: 'abc' }, [])).toThrow();
    expect(() => loadConfig({ SSH_SERVER_PORT: '70000' }, [])).toThrow();
  });

  it('从命令行参数或环境变量读取开发来源', () => {
    expect(loadConfig({}, ['--dev-origin', 'http://127.0.0.1:5173/']).devOrigin).toBe('http://127.0.0.1:5173');
    expect(loadConfig({ SSH_SERVER_DEV_ORIGIN: 'http://localhost:5173' }, []).devOrigin).toBe('http://localhost:5173');
  });
});
