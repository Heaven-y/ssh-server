import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { NativeConfigAgent, NativeConfigDocument, NativeConfigInput } from '@ssh-server/shared';
import { anonymousConfigError, NativeConfigError } from './errors';
import {
  assertDirectoryUnchanged,
  contentRevision,
  decodeUtf8,
  inspectDirectory,
  MAX_CONFIG_BYTES,
  readConfigFile,
  writeConfigFile,
} from './safe-file';

export type { NativeConfigAgent, NativeConfigDocument, NativeConfigInput } from '@ssh-server/shared';
type Deps = { homeDir?: string; env?: NodeJS.ProcessEnv };

function validateContent(agent: NativeConfigAgent, content: string): Buffer {
  const data = Buffer.from(content, 'utf8');
  if (data.length > MAX_CONFIG_BYTES) throw new NativeConfigError('too_large');
  if (decodeUtf8(data) !== content) throw new NativeConfigError('invalid_utf8');
  const text = content.replace(/^\uFEFF/, '');
  try {
    if (agent === 'codex') parseToml(text);
    else {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    }
  } catch {
    throw new NativeConfigError(agent === 'claude' ? 'invalid_json' : 'invalid_toml');
  }
  return data;
}

export function createNativeConfigService(deps: Deps = {}) {
  const homeDir = path.resolve(deps.homeDir ?? os.homedir());
  const env = deps.env ?? process.env;
  const queues = new Map<NativeConfigAgent, Promise<unknown>>();

  function target(agent: NativeConfigAgent) {
    if (agent !== 'claude' && agent !== 'codex') throw new NativeConfigError('invalid_agent');
    const override = agent === 'claude' ? env.CLAUDE_CONFIG_DIR : env.CODEX_HOME;
    const basename = agent === 'claude' ? 'settings.json' : 'config.toml';
    const directory = path.resolve(override || path.join(homeDir, `.${agent}`));
    return {
      directory,
      file: path.join(directory, basename),
      displayPath: override ? path.join(directory, basename) : `~/.${agent}/${basename}`,
      format: agent === 'claude' ? ('json' as const) : ('toml' as const),
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
        const data = validateContent(agent, input.content);
        await inspectDirectory(location.directory);
        const previous = await readConfigFile(location.file);
        if (input.revision !== previous.revision) throw new NativeConfigError('revision_conflict');
        const directory = await inspectDirectory(location.directory, true);
        await writeConfigFile(location.file, data, previous, directory!);
        return {
          agent,
          displayPath: location.displayPath,
          format: location.format,
          content: input.content,
          revision: contentRevision(data),
          exists: true,
        };
      });
    },
  };
}

export type NativeConfigService = ReturnType<typeof createNativeConfigService>;
