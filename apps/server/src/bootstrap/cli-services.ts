// 可编程启动：读取配置、组装依赖、只在本机地址上启动，并返回关闭函数。
// CLI（main.ts）与 Electron 桌面壳共用这里，业务路由与清理路径保持原样。
import type { FastifyInstance } from 'fastify';
import { createAntigravityRunner } from '../agents/antigravity/adapter';
import { discoverAntigravityCapabilities } from '../agents/antigravity/capabilities';
import { createAntigravitySessionManagement } from '../agents/antigravity/management';
import { createAntigravitySessions } from '../agents/antigravity/sessions';
import { createClaudeRunner } from '../agents/claude/adapter';
import { discoverClaudeCapabilities } from '../agents/claude/capabilities';
import { createClaudeSessions } from '../agents/claude/sessions';
import {
  assertCodexSession,
  createCodexRunner,
  discoverCodexCapabilities,
  forkCodexSession,
  listCodexSessions,
  pageCodexSessions,
  mutateCodexSession,
  readCodexSession,
} from '../agents/codex';
import { withCapabilityDirectory } from '../agents/common/capability-directory';
import { createConfiguredRunner } from '../agents/common/configured-runner';
import { createCapabilitiesService } from '../chat/capabilities';
import { TurnManager } from '../chat/turn-manager';
import { registerAgentConfigRoutes } from '../http/agent-config.routes';
import { registerCapabilityRoutes } from '../http/capabilities.routes';
import { registerLaunchEnvironmentRoutes } from '../http/launch-environment.routes';
import { registerModelCatalogRoutes } from '../http/model-catalog.routes';
import { registerModelSettingsRoutes } from '../http/model-settings.routes';
import { registerNativeResourceRoutes } from '../http/native-resources.routes';
import { registerSessionRoutes } from '../http/sessions.routes';
import { registerSessionToolsRoutes } from '../http/session-tools.routes';
import { createSessionPreferences } from '../sessions/preferences';
import { createSessionsService } from '../sessions/service';
import { createLaunchEnvironment } from '../settings/launch-environment';
import { createModelSettingsService } from '../settings/model-settings';
import { createNativeConfigService } from '../settings/native-config';
import { createNativeResourcesService } from '../settings/native-resources';
import { createSessionToolsService } from '../settings/session-tools';

import type { WorkspaceActivity } from '../workspaces/activity';
import type { WorkspaceStore } from '../workspaces/store';

export function createCliServices({
  configDir,
  store,
  activity,
}: {
  configDir: string;
  store: WorkspaceStore;
  activity: WorkspaceActivity;
}) {
  const acquireWorkspace = (id: string) => activity.acquire(id);
  const launchEnvironment = createLaunchEnvironment({
    configDir: configDir,
    onSaved: (agent) => capabilities.invalidate(agent),
  });
  const capabilities = createCapabilitiesService(
    {
      claude: withCapabilityDirectory(async (dir, signal) =>
        discoverClaudeCapabilities(dir, { signal, env: await launchEnvironment.resolve('claude') }),
      ),
      codex: withCapabilityDirectory(async (dir, signal) =>
        discoverCodexCapabilities(dir, { signal, env: await launchEnvironment.resolve('codex') }),
      ),
      antigravity: withCapabilityDirectory(async (dir, signal) =>
        discoverAntigravityCapabilities(dir, { signal, env: await launchEnvironment.resolve('antigravity') }),
      ),
    },
    { configDir: configDir },
  );
  const nativeResources = createNativeResourcesService({ onSaved: (agent) => capabilities.invalidate(agent) });
  const antigravityManagement = createAntigravitySessionManagement({
    environment: () => launchEnvironment.resolve('antigravity'),
  });
  // 会话服务与轮次管理器互相引用：会话服务里的回调只在调用时读 turns，声明顺序保持原样。
  const sessions = createSessionsService(
    {
      claude: createClaudeSessions(),
      antigravity: createAntigravitySessions({ management: antigravityManagement }),
      codex: {
        list: (dir, signal, archived) => listCodexSessions(dir, { signal, archived }),
        page: (dir, input, signal, archived) => pageCodexSessions(dir, input, { signal, archived }),
        read: (id, dir, signal) => readCodexSession(id, dir, { signal }),
        assertBelongs: (id, dir, signal) => assertCodexSession(id, dir, { signal }),
        mutate: (id, dir, input) => mutateCodexSession(id, dir, input),
        fork: (id, dir, input) => forkCodexSession(id, dir, input),
      },
    },
    {
      withIdleSession: (session, operation) => turns.withIdleSession(session, operation),
      isRunning: (s) => turns.isRunning(s),
      // 归属裁决要比较全部项目目录，不能只看当前项目。
      projects: () => store.list(),
      preferences: createSessionPreferences({ configDir: configDir }),
    },
  );
  const runners = {
    claude: createConfiguredRunner({
      environment: () => launchEnvironment.resolve('claude'),
      create: (env) => createClaudeRunner({ env }),
    }),
    codex: createConfiguredRunner({
      environment: () => launchEnvironment.resolve('codex'),
      create: (env) => createCodexRunner({ env }),
    }),
    antigravity: createConfiguredRunner({
      environment: () => launchEnvironment.resolve('antigravity'),
      create: (env) =>
        createAntigravityRunner({
          env,
          readTrajectory: antigravityManagement.readTrajectory?.bind(antigravityManagement),
        }),
    }),
  };
  const turns: TurnManager = new TurnManager({
    getWorkspace: (id) => store.get(id),
    sessions,
    capabilities,
    runners,
    acquireWorkspace,
  });

  return {
    turns,
    disposeSessionManagement: () => antigravityManagement.dispose(),
    registerRoutes(a: FastifyInstance) {
      registerSessionRoutes(a, { store, sessions, activity });
      registerCapabilityRoutes(a, { store, capabilities, sessions });
      registerModelCatalogRoutes(a, { store, capabilities });
      registerAgentConfigRoutes(a, {
        service: createNativeConfigService({ onSaved: (agent) => capabilities.invalidate(agent) }),
      });
      registerNativeResourceRoutes(a, { service: nativeResources, store, activity });
      registerModelSettingsRoutes(
        a,
        createModelSettingsService({ resources: nativeResources, environment: launchEnvironment }),
      );
      registerLaunchEnvironmentRoutes(a, {
        service: launchEnvironment,
        restart: (agent) => turns.withIdleAgent(agent, () => runners[agent].restart()),
      });
      registerSessionToolsRoutes(a, {
        service: createSessionToolsService({
          configDir,
          environment: (agent) => launchEnvironment.resolve(agent),
          withIdleAgent: (agent, operation) => turns.withIdleAgent(agent, operation),
          restart: (agent) => runners[agent].restart(),
          onSaved: (agent) => capabilities.invalidate(agent),
        }),
      });
    },
  };
}
