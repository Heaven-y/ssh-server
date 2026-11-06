import path from 'node:path';
import { z } from 'zod';
import {
  AgentKindSchema,
  NativeSessionIdSchema,
  type AgentKind,
  type SessionRef,
} from '@agentdeck/shared/conversation';
import { nativeFileTransaction } from '../platform/files/transactions';
import {
  assertDirectoryUnchanged,
  inspectDirectory,
  MAX_CONFIG_BYTES,
  readConfigFile,
  writeConfigFile,
} from '../platform/files/safe-file';

const Entry = z.strictObject({ agent: AgentKindSchema, sessionId: NativeSessionIdSchema });
const Stored = z.strictObject({ version: z.literal(1), archived: z.array(Entry).max(3000) });
type Preferences = z.infer<typeof Stored>;
const sameSession = (left: SessionRef, right: SessionRef) =>
  left.agent === right.agent && left.sessionId === right.sessionId;

export class SessionPreferencesError extends Error {
  readonly status = 503;
  readonly code = 'session_preferences_unavailable';
  constructor() {
    super('工作台会话归档暂不可用，请检查本机配置文件。');
  }
}

/** 只存会话身份，不保存标题、项目路径或正文；外部更新仍须通过文件身份核对。 */
export function createSessionPreferences({ configDir }: { configDir: string }) {
  const directory = path.resolve(configDir);
  const file = path.join(directory, 'session-preferences.json');
  async function load() {
    const parents = await inspectDirectory(directory);
    const snapshot = parents ? await readConfigFile(file) : { content: '', revision: 'missing' };
    if (parents) await assertDirectoryUnchanged(parents);
    const stored: Preferences =
      snapshot.revision === 'missing' ? { version: 1, archived: [] } : Stored.parse(JSON.parse(snapshot.content));
    return { snapshot, stored };
  }
  function transaction<T>(operation: () => Promise<T>): Promise<T> {
    return nativeFileTransaction(file, operation).catch(() => {
      throw new SessionPreferencesError();
    });
  }
  async function setArchived(session: SessionRef, archived: boolean) {
    return transaction(async () => {
      Entry.parse(session);
      const { snapshot, stored } = await load();
      const entries = stored.archived.filter((entry) => !sameSession(entry, session));
      if (archived) entries.push({ agent: session.agent, sessionId: session.sessionId });
      if (JSON.stringify(entries) === JSON.stringify(stored.archived)) return;
      const next = Stored.parse({ version: 1, archived: entries });
      const data = Buffer.from(JSON.stringify(next, null, 2) + '\n');
      if (data.length > MAX_CONFIG_BYTES) throw new SessionPreferencesError();
      const parents = await inspectDirectory(directory, true);
      await writeConfigFile(file, data, snapshot, parents!);
    });
  }
  return {
    archived: (agent: AgentKind) =>
      transaction(
        async () =>
          new Set(
            (await load()).stored.archived.filter((entry) => entry.agent === agent).map((entry) => entry.sessionId),
          ),
      ),
    setArchived,
    remove: (session: SessionRef) => setArchived(session, false),
  };
}
export type SessionPreferences = ReturnType<typeof createSessionPreferences>;
