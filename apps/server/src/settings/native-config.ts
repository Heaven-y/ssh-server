import { resourcePlan } from './resource-plan';
import { cliConfigurations } from '../agents/registry';
import type { NativeConfigAgent, NativeConfigDocument, NativeConfigInput } from '@agentdeck/shared/settings';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { anonymousConfigError, NativeConfigError } from '../agents/common/configuration/legacy-errors';
import {
  assertDirectoryUnchanged,
  contentRevision,
  decodeUtf8,
  inspectDirectory,
  MAX_CONFIG_BYTES,
  readConfigFile,
  writeConfigFile,
} from '../platform/files/safe-file';
import { nativeFileTransaction } from '../platform/files/transactions';

export type { NativeConfigAgent, NativeConfigDocument, NativeConfigInput } from '@agentdeck/shared';
type Deps = {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  onSaved?: (agent: NativeConfigAgent) => void | Promise<void>;
};

function validateContent(agent: NativeConfigAgent, content: string): Buffer {
  const data = Buffer.from(content, 'utf8');
  if (data.length > MAX_CONFIG_BYTES) throw new NativeConfigError('too_large');
  if (decodeUtf8(data) !== content) throw new NativeConfigError('invalid_utf8');
  const text = content.replace(/^\uFEFF/, '');
  try {
    if (cliConfigurations[agent].format === 'toml') parseToml(text);
    else {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    }
  } catch {
    throw new NativeConfigError(cliConfigurations[agent].format === 'json' ? 'invalid_json' : 'invalid_toml');
  }
  return data;
}

export function createNativeConfigService(deps: Deps = {}) {
  const homeDir = path.resolve(deps.homeDir ?? os.homedir());
  const env = deps.env ?? process.env;
  const queues = new Map<NativeConfigAgent, Promise<unknown>>();

  function target(agent: NativeConfigAgent) {
    if (agent !== 'claude' && agent !== 'codex') throw new NativeConfigError('invalid_agent');
    const resource = resourcePlan({ agent, homeDir, env }).targets.find(
      (entry) => entry.kind === 'settings' && entry.scope === 'user',
    );
    if (!resource) throw new NativeConfigError('invalid_agent');
    return {
      directory: path.dirname(resource.file),
      file: resource.file,
      displayPath: path.isAbsolute(resource.displayPath) ? path.normalize(resource.displayPath) : resource.displayPath,
      format: cliConfigurations[agent].format,
    };
  }

  function transaction<T>(agent: NativeConfigAgent, action: () => Promise<T>): Promise<T> {
    const run = (queues.get(agent) ?? Promise.resolve()).then(action, action).catch((error: unknown) => {
      throw anonymousConfigError(error);
    });
    queues.set(agent, run);
    void run
      .finally(() => {
        if (queues.get(agent) === run) queues.delete(agent);
      })
      .catch(() => undefined);
    return run;
  }

  return {
    read(agent: NativeConfigAgent): Promise<NativeConfigDocument> {
      return transaction(agent, async () => {
        const location = target(agent);
        const directory = await inspectDirectory(location.directory);
        const current = directory ? await readConfigFile(location.file) : { content: '', revision: 'missing' };
        if (directory) await assertDirectoryUnchanged(directory);
        return {
          agent,
          displayPath: location.displayPath,
          format: location.format,
          content: current.content,
          revision: current.revision,
          exists: current.revision !== 'missing',
        };
      });
    },
    save(agent: NativeConfigAgent, input: NativeConfigInput): Promise<NativeConfigDocument> {
      return transaction(agent, async () => {
        const location = target(agent);
        return nativeFileTransaction(location.file, async () => {
          const data = validateContent(agent, input.content);
          await inspectDirectory(location.directory);
          const previous = await readConfigFile(location.file);
          if (input.revision !== previous.revision) throw new NativeConfigError('revision_conflict');
          const directory = await inspectDirectory(location.directory, true);
          await writeConfigFile(location.file, data, previous, directory!);
          await deps.onSaved?.(agent);
          return {
            agent,
            displayPath: location.displayPath,
            format: location.format,
            content: input.content,
            revision: contentRevision(data),
            exists: true,
          };
        });
      });
    },
  };
}

export type NativeConfigService = ReturnType<typeof createNativeConfigService>;
