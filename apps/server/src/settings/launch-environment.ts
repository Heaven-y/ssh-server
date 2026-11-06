import {
  LaunchEnvironmentInputSchema,
  type LaunchEnvironmentDocument,
  type LaunchEnvironmentInput,
} from '@agentdeck/shared/settings';
import { type AgentKind } from '@agentdeck/shared/conversation';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { NativeConfigError, anonymousConfigError } from '../agents/common/configuration/legacy-errors';
import { cliConfigurations } from '../agents/registry';
import {
  assertDirectoryUnchanged,
  inspectDirectory,
  readConfigFile,
  writeConfigFile,
} from '../platform/files/safe-file';
import { createWindowsProtector, type SecretProtector } from '../platform/secrets/windows-protection';

const Entry = z.strictObject({ mode: z.enum(['set', 'disabled']), protected: z.string().max(32768).optional() });
const Entries = z.record(z.string(), Entry);
const Stored = z.strictObject({ version: z.literal(1), claude: Entries, codex: Entries, antigravity: Entries });
type StoredEnvironment = z.infer<typeof Stored>;
type Deps = {
  configDir: string;
  env?: NodeJS.ProcessEnv;
  protector?: SecretProtector;
  onSaved?: (agent: AgentKind) => void | Promise<void>;
};
const entropy = (agent: AgentKind, name: string) =>
  createHash('sha256').update(`AgentDeck:launch:${agent}:${name}`).digest();

function validateStored(value: unknown): StoredEnvironment {
  const stored = Stored.parse(value);
  for (const agent of ['claude', 'codex', 'antigravity'] as const) {
    const allowed = new Set(cliConfigurations[agent].launchVariables.map((item) => item.name));
    for (const [name, entry] of Object.entries(stored[agent])) {
      if (!allowed.has(name) || (entry.mode === 'set' && !entry.protected))
        throw new NativeConfigError('invalid_request');
    }
  }
  return stored;
}
function checkValue(name: string, value: string | undefined) {
  if (value === undefined) return;
  if (!name.endsWith('_BASE_URL')) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NativeConfigError('invalid_request');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new NativeConfigError('invalid_request');
}
function checkChanges(agent: AgentKind, input: LaunchEnvironmentInput) {
  const allowed = new Set(cliConfigurations[agent].launchVariables.map((item) => item.name));
  const seen = new Set<string>();
  for (const item of input.variables) {
    if (!allowed.has(item.name) || seen.has(item.name) || (item.mode !== 'set' && item.value !== undefined))
      throw new NativeConfigError('invalid_request');
    seen.add(item.name);
    checkValue(item.name, item.value);
    if (item.value !== undefined) cliConfigurations[agent].validateVariable?.(item.name, item.value);
  }
}
function stateOf(entry: z.infer<typeof Entry> | undefined, inherited: string | undefined) {
  if (entry?.mode === 'disabled') return 'disabled' as const;
  if (entry?.mode === 'set') return 'configured' as const;
  return inherited ? ('inherited' as const) : ('unset' as const);
}

/** 只保存系统密文，GET 和保存响应均不包含现有值；不修改全局 process.env。 */
export function createLaunchEnvironment(deps: Deps) {
  const directory = path.resolve(deps.configDir);
  const file = path.join(directory, 'launch-environment.json');
  const inherited = deps.env ?? process.env;
  const protector = deps.protector ?? createWindowsProtector();
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(action, action).catch((error: unknown) => {
      throw anonymousConfigError(error);
    });
    queue = result.catch(() => undefined);
    return result;
  };
  async function load() {
    const parents = await inspectDirectory(directory);
    const snapshot = parents ? await readConfigFile(file) : { content: '', revision: 'missing' };
    if (parents) await assertDirectoryUnchanged(parents);
    const stored =
      snapshot.revision === 'missing'
        ? { version: 1 as const, claude: {}, codex: {}, antigravity: {} }
        : validateStored(JSON.parse(snapshot.content));
    return { stored, snapshot };
  }
  function metadata(agent: AgentKind, stored: StoredEnvironment, revision: string): LaunchEnvironmentDocument {
    return {
      agent,
      revision,
      encryptionAvailable: protector.available,
      note: cliConfigurations[agent].launchNote,
      variables: cliConfigurations[agent].launchVariables.map((item) => {
        const entry = stored[agent][item.name];
        const source = stateOf(entry, inherited[item.name]);
        return {
          ...item,
          mode: entry?.mode ?? 'inherit',
          source,
          hasValue: source === 'configured' || source === 'inherited',
        };
      }),
    };
  }
  async function change(
    agent: AgentKind,
    stored: StoredEnvironment,
    item: LaunchEnvironmentInput['variables'][number],
  ) {
    if (item.mode === 'inherit') {
      delete stored[agent][item.name];
      return;
    }
    if (item.mode === 'disabled') {
      stored[agent][item.name] = { mode: 'disabled' };
      return;
    }
    if (item.value === undefined) {
      if (stored[agent][item.name]?.mode !== 'set') throw new NativeConfigError('invalid_request');
      return;
    }
    if (!protector.available) throw new NativeConfigError('io_error');
    const value = Buffer.from(item.value);
    try {
      const protectedValue = await protector.protect(value, entropy(agent, item.name));
      stored[agent][item.name] = { mode: 'set', protected: protectedValue.toString('base64') };
    } finally {
      value.fill(0);
    }
  }
  return {
    read: (agent: AgentKind) =>
      serial(async () => {
        const { stored, snapshot } = await load();
        return metadata(agent, stored, snapshot.revision);
      }),
    save: (agent: AgentKind, input: LaunchEnvironmentInput) =>
      serial(async () => {
        const parsed = LaunchEnvironmentInputSchema.safeParse(input);
        if (!parsed.success) throw new NativeConfigError('invalid_request');
        checkChanges(agent, parsed.data);
        const { stored, snapshot } = await load();
        if (snapshot.revision !== input.revision) throw new NativeConfigError('revision_conflict');
        for (const item of input.variables) await change(agent, stored, item);
        const parents = await inspectDirectory(directory, true);
        await writeConfigFile(file, Buffer.from(JSON.stringify(stored, null, 2) + '\n'), snapshot, parents!);
        await deps.onSaved?.(agent);
        const updated = await load();
        return metadata(agent, updated.stored, updated.snapshot.revision);
      }),
    resolve: (agent: AgentKind) =>
      serial(async () => {
        const { stored } = await load();
        const env = { ...inherited };
        for (const [name, entry] of Object.entries(stored[agent])) {
          // undefined 在 spawn 时移除变量，同时阻止 SDK 再合并 process.env 时恢复继承值。
          if (entry.mode === 'disabled') {
            env[name] = undefined;
            continue;
          }
          const data = await protector.unprotect(Buffer.from(entry.protected!, 'base64'), entropy(agent, name));
          try {
            env[name] = new TextDecoder('utf-8', { fatal: true }).decode(data);
          } finally {
            data.fill(0);
          }
        }
        return env;
      }),
  };
}
export type LaunchEnvironment = ReturnType<typeof createLaunchEnvironment>;
