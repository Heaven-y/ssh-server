import { homedir } from 'node:os';
import { resolveLocalCommand } from '../platform/process/executable';
import { runProcess } from '../platform/process/run';
import type { CliInstallationBackend } from './types';
import { BackendError, type BackendContext, type BackendOptions } from './backend-support';
import { inspectInstallation } from './discovery';
import { latestRelease } from './catalog';
import { executeInstallation } from './installer';
import { runInstallationProcess } from './installation-process';

export { BackendError } from './backend-support';
export type { BackendOptions } from './backend-support';

export function createCliInstallationBackend(options: BackendOptions = {}): CliInstallationBackend {
  const context: BackendContext = {
    environment: options.environment ?? (() => Promise.resolve(process.env)),
    run: options.run ?? runProcess,
    operationRun: options.run ?? runInstallationProcess,
    fetch: options.fetch ?? globalThis.fetch,
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
    homeDir: options.homeDir ?? homedir(),
    resolveCommand: options.resolveCommand ?? resolveLocalCommand,
  };
  return {
    inspect: (agent, signal) => inspectInstallation(context, agent, signal),
    latest: (installation, signal) => latestRelease(context, installation, signal),
    async execute(installation, version, signal) {
      const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
      const current = await inspectInstallation(context, installation.agent, operationSignal);
      if (current.identity !== installation.identity)
        throw new BackendError('installation_changed', 'CLI 安装路径、版本或更新配置已变化，请重新检查。');
      if (current.installed ? !current.canUpdate : !current.canInstall)
        throw new BackendError(
          'installation_unsupported',
          current.message ?? '当前安装来源不支持自动操作，请查看官方指引。',
        );
      await executeInstallation(context, current, version, operationSignal);
    },
  };
}
