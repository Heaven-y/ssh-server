import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCliInstallationBackend } from '../../src/cli-installation';
import type { ProcessRunner, ProcessOptions } from '../../src/platform/process/run';
import { runProcess } from '../../src/platform/process/run';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'agentdeck-cli-install-'));
  roots.push(root);
  const prefix = path.join(root, 'node');
  const windows = process.platform === 'win32';
  const bin = windows ? prefix : path.join(prefix, 'bin');
  const modules = path.join(prefix, windows ? 'node_modules' : 'lib/node_modules');
  const node = path.join(bin, windows ? 'node.exe' : 'node');
  const npmEntry = path.join(modules, 'npm/bin/npm-cli.js');
  const homeDir = path.join(root, 'home');
  const localAppData = path.join(root, 'local');
  await Promise.all([mkdir(prefix), mkdir(homeDir), mkdir(localAppData)]);
  const put = async (file: string, contents = '') => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  };
  const env = {
    PATH: bin,
    HOME: homeDir,
    USERPROFILE: homeDir,
    LOCALAPPDATA: localAppData,
    ANTHROPIC_API_KEY: 'secret-model-key',
    OPENAI_API_KEY: 'secret-model-key',
  };
  const launcher = async (name: string, entry: string) => {
    const file = path.join(bin, windows ? `${name}.cmd` : name);
    await mkdir(bin, { recursive: true });
    await rm(file, { force: true });
    if (windows) await put(file, `@"${node}" "${entry}" %*`);
    else await symlink(entry, file);
  };
  const calls: { executable: string; args: string[]; options: ProcessOptions }[] = [];
  const run: ProcessRunner = async (executable, args, options) => {
    calls.push({ executable, args, options });
    const stdout = args.includes('--version') ? '2.1.100 (Claude Code)' : args.includes('prefix') ? prefix : '';
    return { stdout: Buffer.from(stdout), stderr: Buffer.alloc(0), exitCode: 0 };
  };
  const npm = async () => {
    await put(node);
    await put(npmEntry);
    await launcher('npm', npmEntry);
    await put(
      path.join(modules, 'npm/package.json'),
      JSON.stringify({ name: 'npm', version: '11.0.0', bin: { npm: 'bin/npm-cli.js' } }),
    );
  };
  const claude = async (name = '@anthropic-ai/claude-code') => {
    const packageDir = path.join(modules, '@anthropic-ai/claude-code');
    await put(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name, version: '2.1.100', bin: { claude: 'bin/claude.exe' } }),
    );
    await put(path.join(packageDir, 'bin/claude.exe'));
    // 原生入口的 shim 只能列出真实入口，不能让解析器先拾取 Node 本身。
    const entry = path.join(packageDir, 'bin/claude.exe');
    if (windows) await put(path.join(bin, 'claude.cmd'), `@"${entry}" %*`);
    else await launcher('claude', entry);
    return packageDir;
  };
  return {
    root,
    prefix,
    bin,
    modules,
    node,
    npmEntry,
    homeDir,
    localAppData,
    env,
    calls,
    run,
    put,
    npm,
    claude,
    launcher,
  };
}

describe('CLI 安装后端', () => {
  it.each(['claude', 'codex'] as const)(
    '安装 %s 时命令行官方源和 TLS 校验优先于用户 npmrc，保留代理证书',
    async (agent) => {
      const f = await fixture();
      await f.npm();
      const scope = agent === 'claude' ? '@anthropic-ai' : '@openai';
      const config = path.join(f.homeDir, '.npmrc');
      const certificate = path.join(f.homeDir, 'certificate.pem');
      await f.put(certificate, '');
      await f.put(
        config,
        `${scope}:registry=http://untrusted.example/\nstrict-ssl=false\nproxy=https://proxy.example/\ncafile=${certificate.replaceAll('\\', '/')}\n`,
      );
      const npmCli = path.join(path.dirname(process.env.npm_execpath!), 'npm-cli.js');
      const actualValues: string[] = [];
      const run: ProcessRunner = async (command, args, options) => {
        if (!args.includes('install')) return f.run(command, args, options);
        // 实际运行 npm 配置解析器，沿用后端产生的安装选项；从不调用 install 或访问网络。
        const flags = args.slice(args.indexOf('install') + 1, -1);
        for (const key of [`${scope}:registry`, 'strict-ssl', 'proxy', 'cafile']) {
          const result = await runProcess(
            process.execPath,
            [npmCli, 'config', 'get', key, ...flags, '--userconfig', config],
            { ...options, timeoutMs: 5000 },
          );
          expect(result.exitCode).toBe(0);
          actualValues.push(result.stdout.toString('utf8').trim());
        }
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 };
      };
      const backend = createCliInstallationBackend({ environment: async () => f.env, homeDir: f.homeDir, run });
      await backend.execute(await backend.inspect(agent), '1.2.3', new AbortController().signal);
      expect(actualValues[0]).toBe('https://registry.npmjs.org');
      expect(actualValues[1]).toBe('true');
      expect(actualValues[2]).toBe('https://proxy.example/');
      expect(path.resolve(actualValues[3]!)).toBe(path.resolve(certificate));
    },
    20_000,
  );

  it('真实 npm Claude 原生入口更新精确包及 prefix，且不向安装进程传模型密钥', async () => {
    const f = await fixture();
    await f.npm();
    await f.claude();
    const backend = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      run: f.run,
    });
    const current = await backend.inspect('claude');
    expect(current).toMatchObject({
      installed: true,
      source: 'npm',
      version: '2.1.100',
      canUpdate: true,
      prefix: f.prefix,
    });
    await backend.execute(current, '2.1.101', new AbortController().signal);
    const install = f.calls.find((call) => call.args.includes('install'))!;
    expect(install.executable).toBe(f.node);
    expect(install.args).toEqual([
      f.npmEntry,
      'install',
      '--global',
      '--prefix',
      f.prefix,
      '--registry=https://registry.npmjs.org',
      '--@anthropic-ai:registry=https://registry.npmjs.org',
      '--strict-ssl=true',
      '@anthropic-ai/claude-code@2.1.101',
    ]);
    expect(install.options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(install.options.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(install.options.timeoutMs).toBeLessThanOrEqual(300_000);
    expect(install.options.outputCap).toBeLessThanOrEqual(1024 * 1024);
  });

  it('看似官方目录但 package 名不符时禁止更新', async () => {
    const f = await fixture();
    await f.npm();
    await f.claude('unexpected-package');
    const backend = createCliInstallationBackend({ environment: async () => f.env, homeDir: f.homeDir, run: f.run });
    const current = await backend.inspect('claude');
    expect(current).toMatchObject({ installed: true, source: 'unknown', canUpdate: false });
    await expect(backend.execute(current, '2.1.101', new AbortController().signal)).rejects.toThrow();
    expect(f.calls.some((call) => call.args.includes('install'))).toBe(false);
  });

  it('shim 解析到包外程序以及 npm prefix 不符均不能被当作官方 npm 来源', async () => {
    const f = await fixture();
    await f.npm();
    await f.claude();
    const other = path.join(f.root, 'other.exe');
    await f.put(other);
    await f.launcher('claude', other);
    const backend = createCliInstallationBackend({ environment: async () => f.env, homeDir: f.homeDir, run: f.run });
    expect(await backend.inspect('claude')).toMatchObject({ source: 'unknown', canUpdate: false });
    await f.claude();
    const mismatch = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      run: async (...args) =>
        args[1].includes('prefix')
          ? { stdout: Buffer.from(f.root), stderr: Buffer.alloc(0), exitCode: 0 }
          : f.run(...args),
    });
    expect(await mismatch.inspect('claude')).toMatchObject({ source: 'unknown', canUpdate: false });
  });

  it('确认后包清单变化使操作失效', async () => {
    const f = await fixture();
    await f.npm();
    const dir = await f.claude();
    const backend = createCliInstallationBackend({ environment: async () => f.env, homeDir: f.homeDir, run: f.run });
    const current = await backend.inspect('claude');
    await f.put(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: '@anthropic-ai/claude-code', version: '2.1.101', bin: { claude: 'bin/claude.exe' } }),
    );
    expect((await backend.inspect('claude')).identity).not.toBe(current.identity);
    await expect(backend.execute(current, '2.1.102', new AbortController().signal)).rejects.toThrow(/变化/);
    expect(f.calls.some((call) => call.args.includes('install'))).toBe(false);
  });

  it('缺失 CLI 时只允许能被当前启动环境找到的 npm 全局安装目录', async () => {
    const f = await fixture();
    await f.npm();
    const backend = createCliInstallationBackend({ environment: async () => f.env, homeDir: f.homeDir, run: f.run });
    expect(await backend.inspect('codex')).toMatchObject({
      installed: false,
      source: 'missing',
      canInstall: true,
      prefix: f.prefix,
    });
    const hidden = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      run: async (...args) =>
        args[1].includes('prefix')
          ? { stdout: Buffer.from(f.root), stderr: Buffer.alloc(0), exitCode: 0 }
          : f.run(...args),
    });
    expect(await hidden.inspect('codex')).toMatchObject({ canInstall: false });
  });

  it.runIf(process.platform === 'win32')('Claude 原生更新读取 stable 通道且保持原生命令', async () => {
    const f = await fixture();
    const bin = path.join(f.homeDir, '.local/bin');
    await f.put(path.join(bin, 'claude.exe'));
    const settings = path.join(f.homeDir, '.claude/settings.json');
    await f.put(settings, JSON.stringify({ autoUpdatesChannel: 'stable' }));
    const fetcher = vi.fn<typeof fetch>(async () => new Response('2.1.101'));
    const backend = createCliInstallationBackend({
      environment: async () => ({ ...f.env, PATH: bin }),
      homeDir: f.homeDir,
      run: f.run,
      fetch: fetcher,
    });
    const current = await backend.inspect('claude');
    expect(current).toMatchObject({ source: 'native', channel: 'stable', canUpdate: true });
    expect(await backend.latest(current)).toEqual({ version: '2.1.101' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://downloads.claude.ai/claude-code-releases/stable');
    await backend.execute(current, '2.1.101', new AbortController().signal);
    expect(f.calls.at(-1)?.args).toEqual(['update']);
    await f.put(settings, JSON.stringify({ autoUpdatesChannel: 'latest' }));
    expect((await backend.inspect('claude')).identity).not.toBe(current.identity);
  });

  it('AGY 默认目录识别原生版本并使用 update', async () => {
    const f = await fixture();
    await f.put(path.join(f.localAppData, 'agy/bin/agy.exe'));
    const run: ProcessRunner = async (...args) =>
      args[1].includes('--version')
        ? { stdout: Buffer.from('1.5.3'), stderr: Buffer.alloc(0), exitCode: 0 }
        : f.run(...args);
    const backend = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      platform: 'win32',
      run,
    });
    const current = await backend.inspect('antigravity');
    expect(current).toMatchObject({ source: 'native', version: '1.5.3', canUpdate: true });
    await backend.execute(current, '1.5.4', new AbortController().signal);
    expect(f.calls.at(-1)?.args).toEqual(['update']);
  });

  it('下载官方安装脚本到临时文件再执行，失败不泄露 stderr，结束清理文件', async () => {
    const f = await fixture();
    let file = '';
    const run: ProcessRunner = async (_exe, args, options) => {
      file = args[args.indexOf('-File') + 1]!;
      expect(await readFile(file, 'utf8')).toBe('Write-Host install');
      expect(options.env).not.toHaveProperty('OPENAI_API_KEY');
      return { stdout: Buffer.alloc(0), stderr: Buffer.from('private-error-secret'), exitCode: 1 };
    };
    const fetcher = vi.fn<typeof fetch>(async () => new Response('Write-Host install'));
    const backend = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      run,
      platform: 'win32',
      fetch: fetcher,
    });
    const current = await backend.inspect('antigravity');
    expect(current.canInstall).toBe(true);
    await expect(backend.execute(current, '1.5.4', new AbortController().signal)).rejects.toThrow(/安装|执行/);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://antigravity.google/cli/install.ps1');
    await expect(readFile(file)).rejects.toThrow();
  });

  it('官方响应仅接受安全版本与有界文本，403 不换下载镜像', async () => {
    const f = await fixture();
    await f.npm();
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ version: '1.2.3', token: 'private' })),
    );
    const backend = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      run: f.run,
      fetch: fetcher,
    });
    const current = await backend.inspect('codex');
    expect(await backend.latest(current)).toEqual({ version: '1.2.3' });
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ version: '1.2.3;whoami' })));
    await expect(backend.latest(current)).rejects.toThrow();
    fetcher.mockImplementation(async () => new Response('x'.repeat(300_000)));
    await expect(backend.latest(current)).rejects.toThrow(/上限|过大/);
    fetcher.mockImplementation(async () => new Response('private-error', { status: 403 }));
    await expect(backend.latest(current)).rejects.toThrow(/403/);
  });

  it('Claude 禁止更新设置不能被 npm 路径绕过', async () => {
    const f = await fixture();
    await f.npm();
    await f.claude();
    await f.put(path.join(f.homeDir, '.claude/settings.json'), JSON.stringify({ env: { DISABLE_UPDATES: '1' } }));
    const backend = createCliInstallationBackend({ environment: async () => f.env, homeDir: f.homeDir, run: f.run });
    const current = await backend.inspect('claude');
    expect(current).toMatchObject({ source: 'npm', canUpdate: false });
    await expect(backend.execute(current, '2.1.101', new AbortController().signal)).rejects.toThrow();
    await f.put(path.join(f.homeDir, '.claude/settings.json'), JSON.stringify({ requiredMinimumVersion: '3.0.0' }));
    const constrained = await backend.inspect('claude');
    expect(constrained).toMatchObject({ source: 'npm', canUpdate: false });
    await expect(backend.execute(constrained, '2.1.101', new AbortController().signal)).rejects.toThrow('版本限制');
  });

  it('Codex JavaScript 官方入口可更新，额外启动参数和包外入口不能更新', async () => {
    const f = await fixture();
    await f.npm();
    const dir = path.join(f.modules, '@openai/codex');
    const entry = path.join(dir, 'bin/codex.js');
    await f.put(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: '@openai/codex', version: '0.100.0', bin: { codex: 'bin/codex.js' } }),
    );
    await f.put(entry);
    await f.launcher('codex', entry);
    const run: ProcessRunner = async (...args) =>
      args[1].includes('--version')
        ? { stdout: Buffer.from('codex-cli 0.100.0'), stderr: Buffer.alloc(0), exitCode: 0 }
        : f.run(...args);
    const backend = createCliInstallationBackend({ environment: async () => f.env, homeDir: f.homeDir, run });
    const current = await backend.inspect('codex');
    expect(current).toMatchObject({ source: 'npm', canUpdate: true, version: '0.100.0' });
    await backend.execute(current, '0.101.0', new AbortController().signal);
    expect(f.calls.at(-1)?.args.at(-1)).toBe('@openai/codex@0.101.0');
    const changed = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      run,
      resolveCommand: () => ({ command: f.node, args: [entry, '--config', 'custom'] }),
    });
    expect(await changed.inspect('codex')).toMatchObject({ source: 'unknown', canUpdate: false });
  });

  it('npm 包版本与真实程序不一致时拒绝自动更新', async () => {
    const f = await fixture();
    await f.npm();
    const dir = await f.claude();
    await f.put(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: '@anthropic-ai/claude-code', version: '2.0.0', bin: { claude: 'bin/claude.exe' } }),
    );
    const backend = createCliInstallationBackend({ environment: async () => f.env, homeDir: f.homeDir, run: f.run });
    expect(await backend.inspect('claude')).toMatchObject({ canUpdate: false });
  });

  it('官方名称包的 bin 链接到包外程序时不能伪装 npm 来源', async () => {
    const f = await fixture();
    await f.npm();
    const dir = await f.claude();
    const entry = path.join(dir, 'bin/claude.exe');
    const external = path.join(f.root, 'external.exe');
    await f.put(external);
    await rm(entry);
    await symlink(external, entry, 'file');
    const backend = createCliInstallationBackend({ environment: async () => f.env, homeDir: f.homeDir, run: f.run });
    expect(await backend.inspect('claude')).toMatchObject({ source: 'unknown', canUpdate: false });
  });

  it('版本检查禁用后台自动更新，AGY 清单与 CPU 架构匹配', async () => {
    const f = await fixture();
    await f.put(path.join(f.localAppData, 'agy/bin/agy.exe'));
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            version: '1.5.4',
            url: 'https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.4-build/windows-arm64/cli_windows_arm64.exe',
            sha512: 'a'.repeat(128),
            ignored: 'secret',
          }),
        ),
    );
    const backend = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      arch: 'arm64',
      platform: 'win32',
      run: f.run,
      fetch: fetcher,
    });
    const current = await backend.inspect('antigravity');
    expect(f.calls.at(-1)?.options.env?.AGY_CLI_DISABLE_AUTO_UPDATE).toBe('true');
    expect(await backend.latest(current)).toEqual({ version: '1.5.4' });
    expect(fetcher.mock.calls[0]?.[0]).toMatch(/windows_arm64\.json$/);
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            version: '1.5.4',
            url: 'https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.4-build/windows-x64/cli_windows_x64.exe',
            sha512: 'a'.repeat(128),
          }),
        ),
    );
    await expect(backend.latest(current)).rejects.toThrow();
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ version: '1.5.4', url: 'https://untrusted.example/install.exe', sha512: 'a'.repeat(128) }),
        ),
    );
    await expect(backend.latest(current)).rejects.toThrow();
  });

  it('用户显式失效路径不触发新安装，非支持平台不猜测原生包管理器', async () => {
    const f = await fixture();
    await f.npm();
    const overridden = createCliInstallationBackend({
      environment: async () => ({ ...f.env, AGENTDECK_CODEX: path.join(f.root, 'missing.exe') }),
      homeDir: f.homeDir,
      run: f.run,
    });
    expect(await overridden.inspect('codex')).toMatchObject({ installed: false, canInstall: false });
    const unsupported = createCliInstallationBackend({
      platform: 'linux',
      environment: async () => ({ PATH: '' }),
      homeDir: f.homeDir,
      run: f.run,
    });
    expect(await unsupported.inspect('antigravity')).toMatchObject({ source: 'missing', canInstall: false });
  });

  it('Codex 官方安装器 403 只报告失败，既不执行内容也不换镜像', async () => {
    const f = await fixture();
    const fetcher = vi.fn<typeof fetch>(async () => new Response('private failure', { status: 403 }));
    const backend = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      platform: 'win32',
      run: f.run,
      fetch: fetcher,
    });
    const current = await backend.inspect('codex');
    expect(current.canInstall).toBe(true);
    await expect(backend.execute(current, '0.101.0', new AbortController().signal)).rejects.toThrow(/HTTP 403/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://chatgpt.com/codex/install.ps1');
    expect(f.calls).toEqual([]);
  });

  it('官方安装器仅跟随已核实的固定跳转并安装指定版本', async () => {
    const f = await fixture();
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      url === 'https://chatgpt.com/codex/install.ps1'
        ? new Response(null, { status: 302, headers: { location: 'https://releases.openai.com/codex/install.ps1' } })
        : new Response('Write-Host install'),
    );
    const backend = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      platform: 'win32',
      run: f.run,
      fetch: fetcher,
    });
    const current = await backend.inspect('codex');
    await backend.execute(current, '0.101.0', new AbortController().signal);
    const install = f.calls.at(-1)!;
    expect(install.args.slice(-2)).toEqual(['-Release', '0.101.0']);
    expect(install.options.env).toMatchObject({ CODEX_NON_INTERACTIVE: '1', OS: 'Windows_NT' });
    fetcher.mockImplementation(
      async () => new Response(null, { status: 302, headers: { location: 'https://untrusted.example/install.ps1' } }),
    );
    await expect(backend.execute(current, '0.101.0', new AbortController().signal)).rejects.toThrow(/跳转/);
  });

  it.runIf(process.platform === 'win32')('Codex 原生入口必须连接官方安装树，更新沿用官方安装器', async () => {
    const f = await fixture();
    const bin = path.join(f.localAppData, 'Programs/OpenAI/Codex/bin');
    const releaseBin = path.join(f.homeDir, '.codex/packages/standalone/releases/0.100.0-x86_64-pc-windows-msvc/bin');
    await f.put(path.join(releaseBin, 'codex.exe'));
    await mkdir(path.dirname(bin), { recursive: true });
    await symlink(releaseBin, bin, 'junction');
    const run: ProcessRunner = async (...args) =>
      args[1].includes('--version')
        ? { stdout: Buffer.from('codex-cli 0.100.0'), stderr: Buffer.alloc(0), exitCode: 0 }
        : f.run(...args);
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      typeof url === 'string' && url.endsWith('/channels/latest')
        ? new Response(JSON.stringify({ tag_name: 'rust-v0.101.0', assets: [] }))
        : new Response('Write-Host install'),
    );
    const backend = createCliInstallationBackend({
      environment: async () => ({ ...f.env, PATH: bin }),
      homeDir: f.homeDir,
      run,
      fetch: fetcher,
    });
    const current = await backend.inspect('codex');
    expect(current).toMatchObject({ source: 'native', canUpdate: true });
    expect(await backend.latest(current)).toEqual({ version: '0.101.0' });
    await backend.execute(current, '0.101.0', new AbortController().signal);
    expect(f.calls.at(-1)?.args.slice(-2)).toEqual(['-Release', '0.101.0']);
    await rm(bin);
    await f.put(path.join(bin, 'codex.exe'));
    expect(await backend.inspect('codex')).toMatchObject({ source: 'unknown', canUpdate: false });
  });

  it('缺失 Claude 时无需预先把已知原生目录加入 PATH', async () => {
    const f = await fixture();
    const backend = createCliInstallationBackend({
      environment: async () => f.env,
      homeDir: f.homeDir,
      platform: 'win32',
      run: f.run,
    });
    expect(await backend.inspect('claude')).toMatchObject({ installed: false, source: 'missing', canInstall: true });
  });

  it.runIf(process.platform === 'win32')('已知 npm 用户目录可在 PATH 未刷新时完成首次安装', async () => {
    const f = await fixture();
    await f.npm();
    const appData = path.join(f.root, 'app-data');
    const prefix = path.join(appData, 'npm');
    const run: ProcessRunner = async (...args) =>
      args[1].includes('prefix')
        ? { stdout: Buffer.from(prefix), stderr: Buffer.alloc(0), exitCode: 0 }
        : f.run(...args);
    const backend = createCliInstallationBackend({
      environment: async () => ({ ...f.env, APPDATA: appData }),
      homeDir: f.homeDir,
      run,
    });
    expect(await backend.inspect('codex')).toMatchObject({ source: 'missing', canInstall: true, prefix });
  });

  it('原生自定义安装目录无法发现时不进行首次安装', async () => {
    const f = await fixture();
    const backend = createCliInstallationBackend({
      environment: async () => ({ ...f.env, CODEX_INSTALL_DIR: path.join(f.root, 'custom-bin') }),
      homeDir: f.homeDir,
      platform: 'win32',
      run: f.run,
    });
    expect(await backend.inspect('codex')).toMatchObject({ installed: false, canInstall: false });
  });
});
