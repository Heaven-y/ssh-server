import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createClaudeStream, nativeClaudeQuery } from '../../../src/agents/claude/query';
import { createLocalRunner } from '../../../src/agents/common/probe';

// 只截获 SDK 的启动参数，永不启动真实 CLI 或检查账号。
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(process.versions, 'electron');
  vi.clearAllMocks();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('Electron 宿主的显式脚本入口使用真实 Node，找不到时拒绝以桌面程序运行脚本', async () => {
  const dir = await directory();
  const file = path.join(dir, 'cli.cjs');
  await writeFile(file, '', 'utf8');
  Object.defineProperty(process.versions, 'electron', { configurable: true, value: 'fixture' });
  const env = { PATH: dir, CLAUDE_CODE_EXECUTABLE: file };
  expect(() => nativeClaudeQuery({ prompt: createClaudeStream().prompt, options: { env } })).toThrow(/Node/);
  const node = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
  await writeFile(node, '', 'utf8');
  nativeClaudeQuery({ prompt: createClaudeStream().prompt, options: { env } });
  expect(query).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({ pathToClaudeCodeExecutable: node, executableArgs: [file] }),
    }),
  );
});

async function directory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-claude-launch-'));
  directories.push(dir);
  return dir;
}

it('显式本机入口同时用于探测和 SDK 驱动，不使用 SDK 内置版本', async () => {
  const dir = await directory();
  const file = path.join(dir, 'local-claude.cjs');
  await writeFile(file, "console.log('3.2.1 (Claude Code)')", 'utf8');
  const env = { PATH: dir, CLAUDE_CODE_EXECUTABLE: file };
  const result = await createLocalRunner(() => env)('claude', ['--version'], { timeoutMs: 5000, outputCap: 1024 });
  expect(result.stdout.toString()).toContain('3.2.1 (Claude Code)');
  nativeClaudeQuery({ prompt: createClaudeStream().prompt, options: { env } });
  expect(query).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        pathToClaudeCodeExecutable: process.execPath,
        executableArgs: [file],
      }),
    }),
  );
});

it('本机入口缺失或覆盖无效时拒绝启动，不回退到包内或其他程序', async () => {
  const dir = await directory();
  for (const override of ['', path.join(dir, 'missing.exe')]) {
    expect(() =>
      nativeClaudeQuery({
        prompt: createClaudeStream().prompt,
        options: {
          env: { PATH: dir, CLAUDE_CODE_EXECUTABLE: override },
        },
      }),
    ).toThrow(/未找到|不存在/);
  }
  expect(query).not.toHaveBeenCalled();
});

it.skipIf(process.platform !== 'win32')('Windows npm 包装脚本解析到真实入口，并保留同目录 Node', async () => {
  const dir = await directory();
  const bin = path.join(dir, 'node_modules', 'fixture-cli');
  await mkdir(bin, { recursive: true });
  const file = path.join(bin, 'entry.js');
  const node = path.join(dir, 'node.exe');
  await writeFile(file, '', 'utf8');
  await writeFile(node, '', 'utf8');
  await writeFile(
    path.join(dir, 'claude.cmd'),
    '@ECHO off\r\n"%~dp0node.exe" "%~dp0node_modules/fixture-cli/entry.js" %*\r\n',
    'utf8',
  );
  nativeClaudeQuery({
    prompt: createClaudeStream().prompt,
    options: { env: { PATH: dir, CLAUDE_CODE_EXECUTABLE: '' } },
  });
  expect(query).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        pathToClaudeCodeExecutable: node,
        executableArgs: [file],
      }),
    }),
  );
});
