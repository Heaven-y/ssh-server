import path from 'node:path';
import { z } from 'zod';
import {
  AgentKindSchema,
  NativeSessionIdSchema,
  PermissionSelectionSchema,
  type AgentKind,
  type PermissionSelection,
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
const PermissionEntry = Entry.extend({ permission: PermissionSelectionSchema }).refine(
  (entry) => entry.agent === entry.permission.agent,
);
const Stored = z.strictObject({
  version: z.literal(1),
  archived: z.array(Entry).max(3000),
  permissions: z.array(PermissionEntry).max(3000).default([]),
});
type Preferences = z.infer<typeof Stored>;
const sameSession = (left: SessionRef, right: SessionRef) =>
  left.agent === right.agent && left.sessionId === right.sessionId;

export class SessionPreferencesError extends Error {
  readonly status = 503;
  readonly code = 'session_preferences_unavailable';
  constructor() {
    super('工作台会话偏好暂不可用，请检查本机配置文件。');
  }
}

/** 只存会话身份和用户手选权限，不保存标题、项目路径或正文；外部更新仍核对文件身份。 */
export function createSessionPreferences({ configDir }: { configDir: string }) {
  const directory = path.resolve(configDir);
  const file = path.join(directory, 'session-preferences.json');
  async function load() {
    const parents = await inspectDirectory(directory);
    const snapshot = parents ? await readConfigFile(file) : { content: '', revision: 'missing' };
    if (parents) await assertDirectoryUnchanged(parents);
    const stored: Preferences =
      snapshot.revision === 'missing'
        ? { version: 1, archived: [], permissions: [] }
        : Stored.parse(JSON.parse(snapshot.content));
    return { snapshot, stored };
  }
  function transaction<T>(operation: () => Promise<T>): Promise<T> {
    return nativeFileTransaction(file, operation).catch(() => {
      throw new SessionPreferencesError();
    });
  }
  function update(session: SessionRef, change: (stored: Preferences) => Preferences) {
    return transaction(async () => {
      Entry.parse(session);
      const { snapshot, stored } = await load();
      const next = Stored.parse(change(stored));
      if (JSON.stringify(next) === JSON.stringify(stored)) return;
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
    setArchived: (session: SessionRef, archived: boolean) =>
      update(session, (stored) => {
        const entries = stored.archived.filter((entry) => !sameSession(entry, session));
        if (archived) entries.push({ agent: session.agent, sessionId: session.sessionId });
        return { ...stored, archived: entries };
      }),
    permission: (session: SessionRef): Promise<PermissionSelection | undefined> =>
      transaction(async () => {
        Entry.parse(session);
        return (await load()).stored.permissions.find((entry) => sameSession(entry, session))?.permission;
      }),
    setPermission: (session: SessionRef, permission: PermissionSelection | null) =>
      update(session, (stored) => {
        const permissions = stored.permissions.filter((entry) => !sameSession(entry, session));
        if (permission) permissions.push(PermissionEntry.parse({ ...session, permission }));
        return { ...stored, permissions };
      }),
    remove: (session: SessionRef) =>
      update(session, (stored) => ({
        ...stored,
        archived: stored.archived.filter((entry) => !sameSession(entry, session)),
        permissions: stored.permissions.filter((entry) => !sameSession(entry, session)),
      })),
  };
}
export type SessionPreferences = ReturnType<typeof createSessionPreferences>;
