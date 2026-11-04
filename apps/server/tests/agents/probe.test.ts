import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createAgentProbes, createLocalRunner } from '../../src/agents/probe';
import { ProcessError, type ProcessRunner } from '../../src/process/run';

// 只验证第一层探测：假 run 不启动真实 CLI，夹具目录只放临时脚本。
const CLAUDE_HELP = '--print --input-format stream-json --output-format stream-json --permission-prompts host';
const AGY_HELP = '--print --input-format --output-format --conversation';

type Reply = { code?: number; stdout?: string; stderr?: string; files?: Record<string, string> };

function fixtureKey(command: string, args: string[]): string {
  return args[0] === 'app-server' ? `${command} app-server generate-json-schema` : `${command} ${args.join(' ')}`;
}

function fakeRun(replies: Record<string, Reply>, options: { enoent?: string[] } = {}): ProcessRunner {
  return async (command, args) => {
    if (options.enoent?.includes(command)) throw new ProcessError('executable_missing', '无法启动程序');
    const reply = replies[fixtureKey(command, args)];
    if (!reply) throw new ProcessError('executable_missing', '无法启动程序');
    if (reply.files) {
      const out = args[args.indexOf('--out') + 1];
      if (!out) throw new Error('夹具缺少 --out 参数');
      await mkdir(out, { recursive: true });
      for (const [name, content] of Object.entries(reply.files)) await writeFile(path.join(out, name), content, 'utf8');
    }
    return {
      stdout: Buffer.from(reply.stdout ?? ''),
      stderr: Buffer.from(reply.stderr ?? ''),
      exitCode: reply.code ?? 0,
    };
  };
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureDirectory(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-probe-fixture-'));
  dirs.push(dir);
  return dir;
}

function versionFixture(version: string, help: string): string {
  return [
    'const args = process.argv.slice(2);',
    `if (args[0] === '--version') console.log(${JSON.stringify(version)});`,
    `else if (args[0] === '--help') console.log(${JSON.stringify(help)});`,
    'else process.exit(2);',
  ].join('\n');
}

// Windows 走 npm 风格的 .cmd shim，其余平台走带 shebang 的脚本；两条路径都真实执行。
const CODEX_FIXTURE = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  'const args = process.argv.slice(2);',
  "if (args[0] === '--version') console.log('codex-cli 0.166.0');",
  "else if (args[0] === '--help') console.log('Commands: app-server');",
  "else if (args[0] === 'app-server' && args[1] === 'generate-json-schema') {",
  "  const out = args[args.indexOf('--out') + 1];",
  '  fs.mkdirSync(out, { recursive: true });',
  "  fs.writeFileSync(path.join(out, 'ServerRequest.json'), JSON.stringify({ title: 'ServerRequest' }));",
  '} else process.exit(2);',
].join('\n');

async function addExecutable(dir: string, name: string, source: string): Promise<void> {
  if (process.platform === 'win32') {
    await writeFile(path.join(dir, `${name}.cjs`), source, 'utf8');
    await writeFile(
      path.join(dir, `${name}.cmd`),
      `@ECHO off\r\n"${process.execPath}" "%~dp0${name}.cjs" %*\r\n`,
      'utf8',
    );
    return;
  }
  const file = path.join(dir, name);
  await writeFile(file, `#!${process.execPath}\n${source}`, 'utf8');
  await chmod(file, 0o755);
}

it('版本能解析时为 available', async () => {
  const probes = createAgentProbes({
    run: fakeRun({
      'claude --version': { code: 0, stdout: '2.1.317 (Claude Code)' },
      'claude --help': { code: 0, stdout: CLAUDE_HELP },
    }),
  });
  await expect(probes.probe('claude')).resolves.toEqual({
    agent: 'claude',
    status: 'available',
    version: '2.1.317',
  });
});

it('可执行文件找不到时为 missing', async () => {
  const probes = createAgentProbes({ run: fakeRun({}, { enoent: ['codex'] }) });
  const result = await probes.probe('codex');
  expect(result.status).toBe('missing');
  expect(result.message).toContain('codex');
});

it('--help 缺关键 flag 时为 changed 并列出缺项', async () => {
  const probes = createAgentProbes({
    run: fakeRun({
      'claude --version': { code: 0, stdout: '2.1.317 (Claude Code)' },
      'claude --help': { code: 0, stdout: '--print --output-format' },
    }),
  });
  const result = await probes.probe('claude');
  expect(result.status).toBe('changed');
  expect(result.version).toBe('2.1.317');
  expect(result.missing).toContain('--permission-prompts');
  expect(result.missing).toContain('--input-format');
});

it('启动环境缺必需变量时为 credential-missing', async () => {
  const probes = createAgentProbes({
    run: fakeRun({
      'agy --version': { code: 0, stdout: '1.4.12' },
      'agy --help': { code: 0, stdout: AGY_HELP },
    }),
    env: () => ({}),
  });
  const result = await probes.probe('antigravity');
  expect(result).toMatchObject({ status: 'credential-missing', version: '1.4.12' });
  expect(result.message).toContain('GEMINI_API_KEY');
});

it('版本号解析失败时按接口变化处理并指出 --version', async () => {
  const probes = createAgentProbes({
    run: fakeRun({ 'claude --version': { code: 0, stdout: 'nightly build 2026-11-04' } }),
  });
  const result = await probes.probe('claude');
  expect(result.status).toBe('changed');
  expect(result.missing).toEqual(['--version']);
  expect(result.message).toContain('claude');
});

it('探测超时按 missing 处理，错误文案带可执行文件名', async () => {
  const run: ProcessRunner = async () => {
    throw new ProcessError('timeout', '子进程超时，已停止');
  };
  const result = await createAgentProbes({ run }).probe('claude');
  expect(result.status).toBe('missing');
  expect(result.message).toContain('claude');
  expect(result.message).toContain('超时');
});

it('Codex 的 capability 是 schema 能成功写出 JSON，而不是版本号', async () => {
  const probes = createAgentProbes({
    run: fakeRun({
      'codex --version': { stdout: 'codex-cli 0.166.0\n' },
      'codex --help': { stdout: 'Commands:\n  app-server\n' },
      'codex app-server generate-json-schema': { files: { 'ServerRequest.json': '{"title":"ServerRequest"}' } },
    }),
  });
  await expect(probes.probe('codex')).resolves.toEqual({ agent: 'codex', status: 'available', version: '0.166.0' });
});

it('Codex schema 生成失败或不是 JSON 时按 changed 处理', async () => {
  for (const reply of [
    { code: 1, stdout: '' },
    { code: 0, files: { 'ServerRequest.json': 'not json' } },
    { code: 0 },
  ]) {
    const probes = createAgentProbes({
      run: fakeRun({
        'codex --version': { stdout: 'codex-cli 0.166.0\n' },
        'codex --help': { stdout: 'Commands: app-server\n' },
        'codex app-server generate-json-schema': reply,
      }),
    });
    const result = await probes.probe('codex');
    expect(result.status).toBe('changed');
    expect(result.missing).toEqual(['generate-json-schema']);
    expect(result.version).toBe('0.166.0');
  }
});

it('probeAll 保持稳定顺序，单个 CLI 失败不影响另外两个', async () => {
  const probes = createAgentProbes({
    run: fakeRun(
      {
        'claude --version': { stdout: '2.1.317 (Claude Code)' },
        'claude --help': { stdout: CLAUDE_HELP },
        'agy --version': { stdout: '1.4.12' },
        'agy --help': { stdout: AGY_HELP },
      },
      { enoent: ['codex'] },
    ),
    env: () => ({}),
  });
  const results = await probes.probeAll();
  expect(results.map(({ agent, status }) => [agent, status])).toEqual([
    ['claude', 'available'],
    ['codex', 'missing'],
    ['antigravity', 'credential-missing'],
  ]);
});

it('只运行白名单里的本地命令，不读能力目录也不带 prompt', async () => {
  const calls: string[][] = [];
  const run: ProcessRunner = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === '--version')
      return { stdout: Buffer.from(`${command}-cli 1.2.3\n`), stderr: Buffer.alloc(0), exitCode: 0 };
    if (args[0] === '--help') return { stdout: Buffer.from(CLAUDE_HELP), stderr: Buffer.alloc(0), exitCode: 0 };
    const out = args[args.indexOf('--out') + 1];
    if (out) await writeFile(path.join(out, 'ServerRequest.json'), '{}', 'utf8');
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 };
  };
  const probes = createAgentProbes({ run, env: () => ({ GEMINI_API_KEY: 'fixture-key' }) });
  await probes.probeAll();
  for (const [command, ...args] of calls) {
    expect(['claude', 'codex', 'agy']).toContain(command);
    const allowed =
      args[0] === '--version' ||
      args[0] === '--help' ||
      (args[0] === 'app-server' && args[1] === 'generate-json-schema');
    expect(allowed).toBe(true);
  }
  expect(calls.every(([, ...args]) => !args.includes('exec') && !args.includes('models'))).toBe(true);
});

it('真实夹具可执行文件：三个 CLI 均可用，Codex schema 落在临时目录', async () => {
  const dir = await fixtureDirectory();
  await addExecutable(dir, 'claude', versionFixture('2.1.317 (Claude Code)', CLAUDE_HELP));
  await addExecutable(dir, 'codex', CODEX_FIXTURE);
  await addExecutable(dir, 'agy', versionFixture('1.4.12', AGY_HELP));
  const env = () => ({ PATH: dir, GEMINI_API_KEY: 'fixture-key' });
  const probes = createAgentProbes({ run: createLocalRunner(env), env });
  const results = await probes.probeAll();
  expect(results.map(({ agent, status, version }) => ({ agent, status, version }))).toEqual([
    { agent: 'claude', status: 'available', version: '2.1.317' },
    { agent: 'codex', status: 'available', version: '0.166.0' },
    { agent: 'antigravity', status: 'available', version: '1.4.12' },
  ]);
  expect(JSON.stringify(results)).not.toContain('fixture-key');
}, 30_000);

it('真实夹具：PATH 找不到时报 missing，help 变样报 changed，缺启动变量报 credential-missing', async () => {
  const empty = await fixtureDirectory();
  const missingProbes = createAgentProbes({
    run: createLocalRunner(() => ({ PATH: empty })),
    env: () => ({ PATH: empty }),
  });
  for (const [agent, executable] of [
    ['claude', 'claude'],
    ['codex', 'codex'],
    ['antigravity', 'agy'],
  ] as const) {
    const result = await missingProbes.probe(agent);
    expect(result.status).toBe('missing');
    expect(result.message).toContain(executable);
  }

  const dir = await fixtureDirectory();
  await addExecutable(dir, 'claude', versionFixture('2.1.317 (Claude Code)', '--print --output-format'));
  await addExecutable(dir, 'agy', versionFixture('1.4.12', AGY_HELP));
  const changedProbes = createAgentProbes({
    run: createLocalRunner(() => ({ PATH: dir })),
    env: () => ({ PATH: dir }),
  });
  const claude = await changedProbes.probe('claude');
  expect(claude.status).toBe('changed');
  expect(claude.missing).toContain('--permission-prompts');
  const agy = await changedProbes.probe('antigravity');
  expect(agy.status).toBe('credential-missing');
  expect(agy.message).toContain('GEMINI_API_KEY');

  const readyEnv = () => ({ PATH: dir, GEMINI_API_KEY: 'fixture-key' });
  const ready = createAgentProbes({ run: createLocalRunner(readyEnv), env: readyEnv });
  await expect(ready.probe('antigravity')).resolves.toMatchObject({ status: 'available', version: '1.4.12' });
}, 30_000);

it('帮助输出写到 stderr 时也能识别能力（agy 的实际行为）', async () => {
  const dir = await fixtureDirectory();
  await addExecutable(
    dir,
    'agy',
    [
      'const args = process.argv.slice(2);',
      "if (args[0] === '--version') console.log('1.4.12');",
      `else if (args[0] === '--help') console.error(${JSON.stringify(AGY_HELP)});`,
      'else process.exit(2);',
    ].join('\n'),
  );
  const env = () => ({ PATH: dir, GEMINI_API_KEY: 'fixture-key' });
  const probes = createAgentProbes({ run: createLocalRunner(env), env });
  await expect(probes.probe('antigravity')).resolves.toMatchObject({ status: 'available', version: '1.4.12' });
}, 30_000);

it('显式指定的 Claude 可执行文件不存在时报 missing，而不是回退到 PATH', async () => {
  const env = () => ({
    PATH: '',
    CLAUDE_CODE_EXECUTABLE: path.join(tmpdir(), 'agentdeck-missing-claude-file.exe'),
  });
  const result = await createAgentProbes({ run: createLocalRunner(env), env }).probe('claude');
  expect(result.status).toBe('missing');
  expect(result.message).toContain('claude');
});
