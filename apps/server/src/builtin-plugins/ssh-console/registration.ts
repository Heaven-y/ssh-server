import { sshConsoleDefinition } from './manifest';
// 可编程启动：读取配置、组装依赖、只在本机地址上启动，并返回关闭函数。
// CLI（main.ts）与 Electron 桌面壳共用这里，业务路由与清理路径保持原样。
import { registerRemoteFileActionRoutes } from './http/remote-file-actions.routes';
import { registerRemoteFileRoutes } from './http/remote-files.routes';
import { registerResourcesRoutes } from './http/resources.routes';
import { registerSlurmRoutes } from './http/slurm.routes';
import { registerSshConsoleRoutes } from './http/ssh-console.routes';
import { registerHostTrustRoutes } from './http/ssh-host-trust.routes';
import { registerSshTargetRoutes } from './http/ssh-targets.routes';
import { registerSshRoutes } from './http/ssh.routes';
import { registerTerminalRoutes } from './http/terminal.routes';
import { createRemoteExecutor } from './legacy/remote-files/executor';
import { createFilePreflights } from './legacy/remote-files/preflight';
import { createRemoteFilesService } from './legacy/remote-files/service';
import { createFileTasks } from './legacy/remote-files/tasks';
import { createResourcesService } from './legacy/resources/service';
import { createSlurmService } from './legacy/slurm/service';
import { createSshConsoleService } from './console/service';
import { createHostTrust } from './ssh/host-trust';
import { createPasswordStore } from './ssh/password-store';
import { createSshPool } from './ssh/pool';
import { createServerProfiles } from './ssh/profiles';
import { serverHostConfig } from './ssh/targets';
import { createTerminalBindings } from './legacy/terminal/binding';
import { createTerminalManager } from './legacy/terminal/manager';

import type { BuiltinPluginRegistration } from '../../plugins/contracts';
import type { WorkspaceStore } from '../../workspaces/store';
import type { WorkspaceActivity } from '../../workspaces/activity';
import type { ProductSettingsStore } from '../../settings/product-settings';
import type { ServerTargets } from './ssh/targets';

export function createSshConsolePlugin({
  configDir,
  store,
  activity,
  productSettings,
  targets,
  isEnabled,
  logError,
}: {
  configDir: string;
  store: WorkspaceStore;
  activity: WorkspaceActivity;
  productSettings: ProductSettingsStore;
  targets: ServerTargets;
  isEnabled: () => boolean;
  logError: (message: string) => void;
}): BuiltinPluginRegistration {
  const pool = createSshPool({
    passwordStore: createPasswordStore({ configDir: configDir }),
    lookupHost: async (alias) => {
      const server = await targets.get(alias);
      return server ? serverHostConfig(server) : undefined;
    },
  });
  const sshConsole = createSshConsoleService({ pool, isEnabled: isEnabled });
  const terminalBindings = createTerminalBindings({ store, pool, isEnabled: isEnabled });
  const acquireWorkspace = (id: string) => activity.acquire(id);
  const terminals = createTerminalManager({
    store,
    pool,
    bindings: terminalBindings,
    isEnabled: isEnabled,
  });
  const resources = createResourcesService({
    store,
    pool,
    settings: async () => (await productSettings.read()).settings,
  });
  const slurm = createSlurmService({ store, pool });
  const browse = createRemoteFilesService({ store, pool });
  const executor = createRemoteExecutor(pool);
  const preflights = createFilePreflights({ store, pool, browse, executor });
  const tasks = createFileTasks({
    configDir: configDir,
    preflights,
    executor,
    acquireWorkspace,
    onCorrupt: (name) => logError(`文件任务记录损坏，已保留原文件，未重放操作：${name}`),
  });
  const profiles = createServerProfiles({ targets, store, pool });
  return {
    ...sshConsoleDefinition,
    registerRoutes(app) {
      registerSshConsoleRoutes(app, sshConsole);
      registerSshRoutes(app, { pool, profiles });
      registerSshTargetRoutes(app, profiles);
      registerHostTrustRoutes(app, createHostTrust({ pool }));
      registerRemoteFileRoutes(app, browse);
      registerRemoteFileActionRoutes(app, { preflights, tasks });
      registerTerminalRoutes(app, { terminals, bindings: terminalBindings });
      registerResourcesRoutes(app, resources);
      registerSlurmRoutes(app, slurm);
    },
    disable() {
      terminalBindings.invalidate();
      terminals.closeAll();
      sshConsole.dispose();
    },
    async dispose() {
      await Promise.allSettled(
        [
          () => sshConsole.dispose(),
          () => terminals.dispose(),
          () => resources.dispose(),
          () => slurm.dispose(),
          () => browse.dispose(),
          () => tasks.dispose(),
        ].map((close) => Promise.resolve().then(close)),
      );
      pool.dispose();
    },
  };
}
