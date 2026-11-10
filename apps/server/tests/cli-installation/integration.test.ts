import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { startServer } from '../../src/server';
import { runProcess } from '../../src/platform/process/run';
import type { CliInstallation } from '../../src/cli-installation/types';
import type { CliInstallationStatus } from '@agentdeck/shared/settings';

it('正式服务接通安装任务：受控子进程更新后重新读取版本，重开请求可取得结果', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-cli-operation-'));
  const versionFile = path.join(root, 'version.txt');
  await writeFile(versionFile, '1.0.0');
  let executes = 0;
  let checks = 0;
  const inspect = async (): Promise<CliInstallation> => ({
    agent: 'claude',
    installed: true,
    version: await readFile(versionFile, 'utf8'),
    source: 'npm',
    identity: await readFile(versionFile, 'utf8'),
    command: { command: process.execPath, args: [] },
    prefix: root,
    canInstall: false,
    canUpdate: true,
    message: null,
    guideUrl: 'https://example.com/cli',
  });
  const server = await startServer(
    { port: 0, host: '127.0.0.1', configDir: path.join(root, 'config'), token: 'fixture-token' },
    {
      legacyDir: path.join(root, 'legacy'),
      log: () => undefined,
      logError: () => undefined,
      probeRunner: async (_command, args) => ({
        stdout: Buffer.from(
          args[0] === '--version'
            ? '2.0.0 (Claude Code)'
            : '--print --input-format --output-format --permission-prompts',
        ),
        stderr: Buffer.alloc(0),
        exitCode: 0,
      }),
      cliInstallationBackend: {
        inspect,
        latest: async () => {
          checks++;
          return { version: '2.0.0' };
        },
        execute: async (_installation, target, signal) => {
          executes++;
          const result = await runProcess(
            process.execPath,
            ['-e', "require('node:fs').writeFileSync(process.argv[1],process.argv[2])", versionFile, target],
            { timeoutMs: 3000, outputCap: 1024, signal },
          );
          expect(result.exitCode).toBe(0);
        },
      },
    },
  );
  const headers = {
    origin: new URL(server.url).origin,
    cookie: 'AGENTDECK_session=fixture-token',
    'content-type': 'application/json',
  };
  const url = new URL('api/settings/cli-installation/claude', server.url);
  try {
    const unauthorized = await fetch(url);
    expect(unauthorized.status).toBe(401);
    const current = await fetch(url, { headers });
    expect(await current.json()).toMatchObject({ currentVersion: '1.0.0', latestVersion: null });
    expect(checks).toBe(0);
    const checked = await fetch(`${url.href}/check`, { headers, method: 'POST', body: '{}' });
    const status = (await checked.json()) as CliInstallationStatus;
    expect(status).toMatchObject({ latestVersion: '2.0.0', canUpdate: true });
    const started = await fetch(`${url.href}/operations`, {
      headers,
      method: 'POST',
      body: JSON.stringify({ action: 'update', revision: status.revision }),
    });
    expect(started.status).toBe(202);
    await expect
      .poll(async () => ((await (await fetch(url, { headers })).json()) as CliInstallationStatus).phase)
      .toBe('succeeded');
    const reopened = (await (await fetch(url, { headers })).json()) as CliInstallationStatus;
    expect(reopened.currentVersion).toBe('2.0.0');
    expect(executes).toBe(1);
    expect(checks).toBe(1);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
