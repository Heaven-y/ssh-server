import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_DIR_NAME, LEGACY_CONFIG_DIR_NAME, legacyConfigDir, loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('默认值', () => {
    const c = loadConfig({}, []);
    expect(c.port).toBe(4317);
    expect(c.host).toBe('127.0.0.1');
    expect(c.configDir.endsWith(CONFIG_DIR_NAME)).toBe(true);
    expect(c.token.length).toBeGreaterThanOrEqual(43);
    expect(c.devOrigin).toBeUndefined();
  });

  it('旧数据目录与新目录是同级的不同目录', () => {
    const env = { LOCALAPPDATA: path.join(os.tmpdir(), 'agentdeck-localappdata') };
    expect(loadConfig(env, []).configDir.endsWith(CONFIG_DIR_NAME)).toBe(true);
    expect(legacyConfigDir(env).endsWith(LEGACY_CONFIG_DIR_NAME)).toBe(true);
    expect(legacyConfigDir(env)).not.toBe(loadConfig(env, []).configDir);
  });

  it('只允许监听本机地址', () => {
    expect(() => loadConfig({ AGENTDECK_HOST: '0.0.0.0' }, [])).toThrow();
    expect(() => loadConfig({ AGENTDECK_HOST: '192.168.1.2' }, [])).toThrow();
    expect(loadConfig({ AGENTDECK_HOST: '::1' }, []).host).toBe('::1');
  });

  it('读取环境变量', () => {
    const configDir = path.join(os.tmpdir(), 'agentdeck-fixture', 'config');
    const c = loadConfig({ AGENTDECK_TOKEN: 't', AGENTDECK_PORT: '0', AGENTDECK_CONFIG_DIR: configDir }, []);
    expect(c.token).toBe('t');
    expect(c.port).toBe(0);
    expect(c.configDir).toBe(configDir);
  });

  it('端口不合法时抛错', () => {
    expect(() => loadConfig({ AGENTDECK_PORT: 'abc' }, [])).toThrow();
    expect(() => loadConfig({ AGENTDECK_PORT: '70000' }, [])).toThrow();
  });

  it('从命令行参数或环境变量读取开发来源', () => {
    expect(loadConfig({}, ['--dev-origin', 'http://127.0.0.1:5173/']).devOrigin).toBe('http://127.0.0.1:5173');
    expect(loadConfig({ AGENTDECK_DEV_ORIGIN: 'http://localhost:5173' }, []).devOrigin).toBe('http://localhost:5173');
  });
});
