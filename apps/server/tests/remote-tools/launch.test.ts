import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRemoteToolsCommand } from '../../src/remote-tools/launch';

describe('resolveRemoteToolsCommand', () => {
  it('用当前 node 加 tsx 加载器启动 remote-tools 入口', () => {
    const { command, args } = resolveRemoteToolsCommand();
    expect(command).toBe(process.execPath);
    expect(args[0]).toBe('--import');
    expect(args[1]!.startsWith('file:')).toBe(true);
    expect(path.isAbsolute(args[2]!)).toBe(true);
    expect(args[2]!.replace(/\\/g, '/').endsWith('remote-tools/main.ts')).toBe(true);
  });
});
