import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveCodexCommand } from '../../../src/agents/codex/launch';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function installation() {
  const dir = await mkdtemp(path.join(tmpdir(), 'codex installation '));
  dirs.push(dir);
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const env = { [pathKey]: [path.join(dir, 'missing'), dir].join(path.delimiter), SSH_SERVER_CODEX: undefined };
  const addFile = async (...parts: string[]) => {
    const file = path.join(dir, ...parts);
    await mkdir(path.dirname(file), { recursive: true });
    // 只验证文件发现，不执行占位文件。
    await writeFile(file, '', 'utf8');
    return file;
  };
  return { dir, env, addFile };
}

describe('Codex 启动发现', () => {
  it('显式命令优先于环境设置，JavaScript 入口通过当前 Node 启动', async () => {
    const { addFile, env } = await installation();
    const js = await addFile('custom entry.mjs');
    const executable = await addFile('custom executable');
    expect(await resolveCodexCommand({ env: { ...env, SSH_SERVER_CODEX: js } })).toEqual({
      command: process.execPath,
      args: [js],
    });
    expect(await resolveCodexCommand({ command: executable, env: { ...env, SSH_SERVER_CODEX: js } })).toEqual({
      command: executable,
      args: [],
    });
  });

  it.runIf(process.platform === 'win32')('PATH 发现官方 npm JS 入口，安装原生运行时后优先使用 exe', async () => {
    const { addFile, env } = await installation();
    const js = await addFile('node_modules', '@openai', 'codex', 'bin', 'codex.js');
    expect(await resolveCodexCommand({ env })).toEqual({ command: process.execPath, args: [js] });
    const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const native = await addFile(
      'node_modules',
      '@openai',
      'codex',
      'node_modules',
      '@openai',
      `codex-win32-${process.arch}`,
      'vendor',
      target,
      'bin',
      'codex.exe',
    );
    expect(await resolveCodexCommand({ env })).toEqual({ command: native, args: [] });
    const direct = await addFile('codex.exe');
    expect(await resolveCodexCommand({ env })).toEqual({ command: direct, args: [] });
  });

  it('仅将官方 npm 包旁的 cmd 转成程序入口，未知包装脚本明确拒绝', async () => {
    const { dir, addFile, env } = await installation();
    const wrapper = await addFile('codex.cmd');
    await expect(resolveCodexCommand({ command: wrapper, env })).rejects.toThrow('官方 JavaScript 入口');
    const js = await addFile('node_modules', '@openai', 'codex', 'bin', 'codex.js');
    expect(await resolveCodexCommand({ command: path.join(dir, 'codex.cmd'), env })).toEqual({
      command: process.execPath,
      args: [js],
    });
  });

  it.runIf(process.platform === 'win32')('隔离 PATH 没有官方运行时，返回可操作错误且不回退到宿主安装', async () => {
    const { env } = await installation();
    await expect(resolveCodexCommand({ env })).rejects.toThrow('找不到 Codex');
  });
});
