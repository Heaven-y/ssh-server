import path from 'node:path';
import { stat } from 'node:fs/promises';
import { createAntigravitySessionManagement } from '../agents/antigravity/management';
import { createAntigravitySessions } from '../agents/antigravity/sessions';
import { createClaudeSessions } from '../agents/claude/sessions';
import { assertCodexSession, readCodexSession } from '../agents/codex/sessions';
import { SessionError } from '../agents/errors';
import { createSessionsService } from '../sessions/service';
import { createLaunchEnvironment } from '../settings/launch-environment';
import { createWorkspaceStore } from '../workspaces/store';
import { createSessionReader } from './reader';

function unsupported(): Promise<never> {
  return Promise.reject(new SessionError(400, 'unsupported_action', '会话阅读工具不提供写入操作。'));
}

export function sessionToolsConfigDir(argv: string[]): string {
  if (
    argv.length !== 2 ||
    argv[0] !== '--config-dir' ||
    !argv[1] ||
    !path.isAbsolute(argv[1]) ||
    /[\r\n\0]/.test(argv[1])
  )
    throw new Error('会话阅读工具需要明确的绝对配置目录。');
  return path.resolve(argv[1]);
}

/** 沿用原生提供方与归属服务，不扫描或复制 CLI 的会话数据库。 */
export function createSessionToolsRuntime(configDir: string) {
  const store = createWorkspaceStore({
    configDir,
    dirExists: async (directory) => (await stat(directory)).isDirectory(),
    knownHosts: () => Promise.resolve([]),
  });
  const environment = createLaunchEnvironment({ configDir });
  const management = createAntigravitySessionManagement({ environment: () => environment.resolve('antigravity') });
  const sessions = createSessionsService(
    {
      // Claude SDK 只读接口没有 env/configDir 参数；MCP entry 固定 AgentDeck 的原生
      // 目录环境，避免继承调用方 CLI 的不同档案。此处不修改进程全局环境。
      claude: createClaudeSessions(undefined, undefined, { preserveToolContent: true }),
      codex: {
        list: unsupported,
        mutate: unsupported,
        fork: unsupported,
        assertBelongs: async (id, dir, signal) =>
          assertCodexSession(id, dir, { signal, env: await environment.resolve('codex') }),
        read: async (id, dir, signal) =>
          readCodexSession(id, dir, { signal, env: await environment.resolve('codex'), preserveToolContent: true }),
      },
      antigravity: createAntigravitySessions({ management, preserveToolContent: true }),
    },
    { projects: () => store.list(), withIdleSession: unsupported },
  );
  return { reader: createSessionReader({ store, sessions }), dispose: () => management.dispose() };
}
