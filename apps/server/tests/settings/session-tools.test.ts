import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { createSessionToolsService } from '../../src/settings/session-tools';
import { buildSessionToolsCommand } from '../../src/settings/session-tools-command';
import type { ProcessRunner } from '../../src/platform/process/run';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(['PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_DIR'])(
  '%s 便携环境不允许持久启停且没有磁盘或原生命令副作用',
  async (variable) => {
    const { homeDir, deps } = await fixture();
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', undefined);
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', undefined);
    vi.stubEnv(variable, path.join(homeDir, 'portable'));
    let commands = 0;
    const service = createSessionToolsService({
      ...deps,
      run: async () => {
        commands++;
        throw new Error('不应执行原生 CLI');
      },
    });
    for (const agent of ['claude', 'codex', 'antigravity'] as const) {
      const status = await service.read(agent);
      expect(status).toMatchObject({ available: false, message: '便携版的运行目录会变化，请使用安装版启用会话读取。' });
      for (const enabled of [true, false])
        await expect(service.save(agent, { enabled, revision: status.revision })).rejects.toMatchObject({
          status: 409,
          code: 'unsupported_runtime',
        });
    }
    expect(commands).toBe(0);
    expect(await readdir(homeDir)).toEqual([]);
  },
);
async function fixture() {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'session-tools-'));
  roots.push(homeDir);
  const command = {
    command: process.execPath,
    args: [path.join(homeDir, 'session-tools.mjs'), '--config-dir', homeDir],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
  const deps = {
    configDir: homeDir,
    homeDir,
    command,
    environment: async () => ({}),
    resolveCommand: () => ({ command: process.execPath, args: [] }),
  };
  return { homeDir, command, deps, service: createSessionToolsService(deps) };
}

it('Codex 只增删固定 MCP，保留已有表、注释与其他工具，拒绝旧 revision', async () => {
  const { homeDir, service } = await fixture();
  const file = path.join(homeDir, '.codex', 'config.toml');
  await mkdir(path.dirname(file));
  const original =
    '# 用户注释\r\nmodel = "example"\r\n[mcp_servers.other]\r\ncommand = "existing" # 保留\r\n[custom]\r\nactive = true\r\n';
  await writeFile(file, original);
  const before = await service.read('codex');
  const enabled = await service.save('codex', { enabled: true, revision: before.revision });
  expect(enabled).toMatchObject({ agent: 'codex', available: true, enabled: true });
  const content = await readFile(file, 'utf8');
  expect(content).toContain('# 用户注释\r\n');
  expect(content).toContain('command = "existing" # 保留\r\n[custom]\r\nactive = true');
  expect(parseToml(content)).toMatchObject({
    mcp_servers: {
      agentdeck_sessions: { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
      other: { command: 'existing' },
    },
  });
  await expect(service.save('codex', { enabled: false, revision: before.revision })).rejects.toMatchObject({
    status: 409,
    code: 'revision_conflict',
  });
  const disabled = await service.save('codex', { enabled: false, revision: enabled.revision });
  expect(disabled.enabled).toBe(false);
  expect(parseToml(await readFile(file, 'utf8'))).toEqual(parseToml(original));
});

it('同名他人 MCP 不可覆盖或删除，状态明确不可用', async () => {
  const { homeDir, service } = await fixture();
  const file = path.join(homeDir, '.gemini', 'config', 'mcp_config.json');
  await mkdir(path.dirname(file), { recursive: true });
  const content = '{"mcpServers":{"agentdeck_sessions":{"command":"someone-else"}},"unknown":true}\n';
  await writeFile(file, content);
  const status = await service.read('antigravity');
  expect(status).toMatchObject({ enabled: false, available: false });
  expect(status.message).toBeTruthy();
  for (const enabled of [true, false])
    await expect(service.save('antigravity', { enabled, revision: status.revision })).rejects.toMatchObject({
      code: 'entry_conflict',
      status: 409,
    });
  expect(await readFile(file, 'utf8')).toBe(content);
});

it.each(['table', 'dotted', 'inline'] as const)('Codex 能删除 %s 形式的自有 MCP，保留注释和邻居', async (form) => {
  const { homeDir, command, service } = await fixture();
  const file = path.join(homeDir, '.codex', 'config.toml');
  await mkdir(path.dirname(file));
  const values = `command = ${JSON.stringify(command.command)}, args = ${JSON.stringify(command.args)}, env = { ELECTRON_RUN_AS_NODE = "1" }`;
  const own =
    form === 'table'
      ? `[mcp_servers.agentdeck_sessions]\ncommand = ${JSON.stringify(command.command)}\nargs = ${JSON.stringify(command.args)}\n# 自有表注释\n[mcp_servers.agentdeck_sessions.env]\nELECTRON_RUN_AS_NODE = "1"\n`
      : form === 'dotted'
        ? `[mcp_servers]\nagentdeck_sessions.command = ${JSON.stringify(command.command)}\nagentdeck_sessions.args = ${JSON.stringify(command.args)}\nagentdeck_sessions.env = { ELECTRON_RUN_AS_NODE = "1" }\n`
        : `mcp_servers = { other = { command = "existing" }, agentdeck_sessions = { ${values} } }\n`;
  const other = form === 'inline' ? '' : '[mcp_servers.other]\ncommand = "existing"\n';
  await writeFile(file, `\uFEFF# 顶部注释\n${own}${other}`);
  const before = await service.read('codex');
  expect(before.enabled).toBe(true);
  await service.save('codex', { enabled: false, revision: before.revision });
  const content = await readFile(file, 'utf8');
  expect(content).toContain('\uFEFF# 顶部注释');
  if (form === 'table') expect(content).toContain('# 自有表注释');
  expect(parseToml(content.replace(/^\uFEFF/, ''))).toEqual({ mcp_servers: { other: { command: 'existing' } } });
});

it('各 CLI 路径跟随解析后的环境，环境切换使旧 revision 失效，JSON 未知配置保留', async () => {
  const { homeDir, deps } = await fixture();
  let env: NodeJS.ProcessEnv = {
    CODEX_HOME: path.join(homeDir, 'codex-custom'),
    HOME: path.join(homeDir, 'agy-home'),
    USERPROFILE: path.join(homeDir, 'agy-home'),
  };
  const service = createSessionToolsService({ ...deps, homeDir: undefined, environment: async () => env });
  const before = await service.read('codex');
  env = { ...env, CODEX_HOME: path.join(homeDir, 'codex-other') };
  await expect(service.save('codex', { enabled: true, revision: before.revision })).rejects.toMatchObject({
    code: 'revision_conflict',
  });
  await service.save('codex', { enabled: true, revision: (await service.read('codex')).revision });
  expect(await readFile(path.join(env.CODEX_HOME!, 'config.toml'), 'utf8')).toContain('agentdeck_sessions');
  const file = path.join(env.USERPROFILE!, '.gemini', 'config', 'mcp_config.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{"mcpServers":{"other":{"command":"existing"}},"unknown":{"keep":true}}');
  const on = await service.save('antigravity', {
    enabled: true,
    revision: (await service.read('antigravity')).revision,
  });
  expect(JSON.parse(await readFile(file, 'utf8')).mcpServers.agentdeck_sessions.tools).toEqual({
    read_session: { eager: true },
  });
  await service.save('antigravity', { enabled: false, revision: on.revision });
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
    mcpServers: { other: { command: 'existing' } },
    unknown: { keep: true },
  });
});

it('Claude 通过原生用户作用域增删，只在空闲锁内写入并重启，保留混合状态', async () => {
  const { homeDir, deps } = await fixture();
  const configDir = path.join(homeDir, 'claude-custom');
  const file = path.join(configDir, '.claude.json');
  await mkdir(configDir);
  await writeFile(file, '{"projects":{"demo":{"keep":true}},"mcpServers":{"other":{"command":"existing"}}}');
  let locked = false;
  let restarts = 0;
  const run: ProcessRunner = async (_executable, args, options) => {
    expect(locked).toBe(true);
    expect(options.env?.CLAUDE_CONFIG_DIR).toBe(configDir);
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (args[1] === 'add-json') {
      expect(args.slice(0, 5)).toEqual(['mcp', 'add-json', '--scope', 'user', 'agentdeck_sessions']);
      data.mcpServers.agentdeck_sessions = JSON.parse(args[5]!);
    } else {
      expect(args).toEqual(['mcp', 'remove', '--scope', 'user', 'agentdeck_sessions']);
      delete data.mcpServers.agentdeck_sessions;
    }
    await writeFile(file, JSON.stringify(data));
    return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  const service = createSessionToolsService({
    ...deps,
    environment: async () => ({ CLAUDE_CONFIG_DIR: configDir }),
    run,
    withIdleAgent: async (_agent, operation) => {
      locked = true;
      try {
        return await operation();
      } finally {
        locked = false;
      }
    },
    restart: async () => {
      expect(locked).toBe(true);
      restarts++;
    },
  });
  const before = await service.read('claude');
  const on = await service.save('claude', { enabled: true, revision: before.revision });
  expect(on.enabled).toBe(true);
  await service.save('claude', { enabled: false, revision: on.revision });
  expect(restarts).toBe(2);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
    projects: { demo: { keep: true } },
    mcpServers: { other: { command: 'existing' } },
  });
});

it('启动命令用绝对入口，桌面 Electron 带 Node 模式环境', () => {
  const directory = path.resolve(os.tmpdir(), 'agentdeck-command');
  const moduleUrl = pathToFileURL(path.join(directory, 'main.mjs')).href;
  const desktop = buildSessionToolsCommand(directory, {
    electron: true,
    moduleUrl,
    execPath: process.execPath,
    homeDir: directory,
    env: {},
  });
  expect(desktop).toEqual({
    command: process.execPath,
    args: [path.join(directory, 'session-tools.mjs'), '--config-dir', directory],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      HOME: directory,
      USERPROFILE: directory,
      CODEX_HOME: path.join(directory, '.codex'),
      CLAUDE_CONFIG_DIR: path.join(directory, '.claude'),
    },
  });
  const development = buildSessionToolsCommand(directory, {
    homeDir: directory,
    env: {
      CODEX_HOME: path.join(directory, 'codex-custom'),
      CLAUDE_CONFIG_DIR: path.join(directory, 'claude-custom'),
      API_SECRET: 'not-for-mcp',
    },
  });
  expect(development.args[0]).toBe('--import');
  expect(development.args[1]).toMatch(/^file:/);
  expect(path.isAbsolute(development.args[2]!)).toBe(true);
  expect(development.args.slice(-2)).toEqual(['--config-dir', directory]);
  expect(development.env).toEqual({
    HOME: directory,
    USERPROFILE: directory,
    CODEX_HOME: path.join(directory, 'codex-custom'),
    CLAUDE_CONFIG_DIR: path.join(directory, 'claude-custom'),
  });
});
