import { randomUUID } from 'node:crypto';
import {
  SyncSettingsSchema,
  type RemoteBrowseSession,
  type RemoteBrowseTarget,
  type Workspace,
} from '@ssh-server/shared';
import { connectionIdentity, workspaceTarget } from '../ssh/connection';
import type { SshPool } from '../ssh/pool';
import { createSftpReader, type SftpReader } from '../ssh/sftp';
import type { WorkspaceStore } from '../workspaces/store';
import { createBrowseBinding } from './binding';
import { createDirectoryCursor, type DirectoryCursor } from './directory';
import { RemoteFilesError } from './errors';
import { remoteOperation } from './operation';
import { remotePath } from './paths';

const SESSION_IDLE_MS = 15 * 60_000;
const MAX_SESSIONS = 32;
type Deps = {
  store: Pick<WorkspaceStore, 'get'>;
  pool: Pick<SshPool, 'fingerprint' | 'openSftp' | 'resolveConnection' | 'generation' | 'onCredentialsChanged'>;
};
type Session = {
  info: RemoteBrowseSession;
  workspace: Workspace;
  binding: string;
  key: string;
  identity: string;
  generation: number;
  lifetime: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  unsubscribe: () => void;
  directory?: DirectoryCursor;
  queue: Promise<unknown>;
};

export function createRemoteFilesService(deps: Deps) {
  const sessions = new Map<string, Session>();
  const bind = createBrowseBinding(deps.store, deps.pool);
  const lifetime = new AbortController();
  let opening = 0;

  function close(session: Session, reason = new RemoteFilesError('session_expired')) {
    if (session.lifetime.signal.aborted) return;
    sessions.delete(session.info.id);
    session.lifetime.abort(reason);
    clearTimeout(session.timer);
    session.unsubscribe();
    void session.directory?.close();
  }
  function touch(session: Session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => close(session), SESSION_IDLE_MS);
    session.timer.unref();
  }
  function parentSignal(parent?: AbortSignal, session?: Session): AbortSignal {
    return AbortSignal.any([
      lifetime.signal,
      ...(parent ? [parent] : []),
      ...(session ? [session.lifetime.signal] : []),
    ]);
  }
  async function readerFor(workspace: Workspace, signal: AbortSignal): Promise<SftpReader> {
    signal.throwIfAborted();
    const reader = createSftpReader(await deps.pool.openSftp(workspaceTarget(workspace)));
    const stop = () => reader.close(signal.reason as Error);
    signal.addEventListener('abort', stop, { once: true });
    reader.signal.addEventListener('abort', () => signal.removeEventListener('abort', stop), { once: true });
    if (signal.aborted) {
      stop();
      signal.throwIfAborted();
    }
    return reader;
  }
  async function validate(session: Session, signal: AbortSignal) {
    signal.throwIfAborted();
    if (sessions.get(session.info.id) !== session) throw new RemoteFilesError('session_expired');
    const current = await bind(session.info.workspaceId, session.workspace, signal);
    if (current.binding !== session.binding) {
      close(session, new RemoteFilesError('target_changed'));
      throw new RemoteFilesError('target_changed');
    }
    const connection = await deps.pool.resolveConnection(workspaceTarget(current.workspace));
    signal.throwIfAborted();
    if (connection.cacheKey !== session.key || deps.pool.generation(current.workspace.sshHost) !== session.generation) {
      close(session);
      throw new RemoteFilesError('session_expired');
    }
  }
  async function initialize(session: Session, signal: AbortSignal) {
    const reader = await readerFor(session.workspace, signal);
    try {
      await validate(session, signal);
      const home = await reader.realpath('.');
      const root = await reader.realpath(remotePath(session.workspace.remoteDir, home, home));
      if (!home.startsWith('/') || !root.startsWith('/') || /\0/.test(home + root))
        throw new RemoteFilesError('invalid_path');
      const stat = await reader.lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new RemoteFilesError('not_directory');
      await validate(session, signal);
      Object.assign(session.info, { home, root });
    } finally {
      reader.close();
    }
  }
  async function open(workspaceId: string, expected: RemoteBrowseTarget & { binding: string }, signal: AbortSignal) {
    let session: Session | undefined;
    try {
      const current = await bind(workspaceId, expected, signal);
      if (current.binding !== expected.binding) throw new RemoteFilesError('target_changed');
      const workspace = current.workspace;
      const generation = deps.pool.generation(workspace.sshHost);
      const connection = await deps.pool.resolveConnection(workspaceTarget(workspace));
      signal.throwIfAborted();
      session = {
        info: { id: randomUUID(), workspaceId, sshHost: workspace.sshHost, root: '', home: '' },
        workspace,
        binding: current.binding,
        key: connection.cacheKey,
        identity: connectionIdentity(connection),
        generation,
        lifetime: new AbortController(),
        unsubscribe: () => undefined,
        queue: Promise.resolve(),
      };
      const active = session;
      sessions.set(active.info.id, active);
      active.unsubscribe = deps.pool.onCredentialsChanged(workspace.sshHost, () => close(active));
      const abort = () => close(active);
      signal.addEventListener('abort', abort, { once: true });
      try {
        await initialize(active, signal);
        signal.throwIfAborted();
        touch(active);
        return { ...active.info };
      } finally {
        signal.removeEventListener('abort', abort);
      }
    } catch (error) {
      if (session) close(session);
      throw error;
    }
  }
  async function newDirectory(session: Session, path: string, signal: AbortSignal) {
    await session.directory?.close();
    signal.throwIfAborted();
    session.directory = undefined;
    const reader = await readerFor(session.workspace, signal);
    try {
      const stat = await reader.lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (await reader.realpath(path)) !== path)
        throw new RemoteFilesError('not_directory');
      const handle = await reader.opendir(path);
      signal.throwIfAborted();
      return createDirectoryCursor(reader, handle, {
        directory: path,
        root: session.info.root,
        settings: SyncSettingsSchema.parse(session.workspace.sync ?? {}),
      });
    } catch (error) {
      reader.close();
      throw error;
    }
  }
  async function read(session: Session, input: { path: string; cursor?: string }, signal: AbortSignal) {
    await validate(session, signal);
    const path = remotePath(input.path, session.info.root, session.info.home);
    if (input.cursor && session.directory?.path !== path) throw new RemoteFilesError('cursor_expired');
    const directory = input.cursor ? session.directory! : await newDirectory(session, path, signal);
    signal.throwIfAborted();
    session.directory = directory;
    const abort = () => {
      void directory.close();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const result = await directory.page(input.cursor);
      await validate(session, signal);
      touch(session);
      return result;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  return {
    binding: (id: string, target: RemoteBrowseTarget, signal?: AbortSignal) =>
      remoteOperation(parentSignal(signal), async (active) => ({ binding: (await bind(id, target, active)).binding })),
    open(id: string, target: RemoteBrowseTarget & { binding: string }, signal?: AbortSignal) {
      if (sessions.size + opening >= MAX_SESSIONS) return Promise.reject(new RemoteFilesError('too_many_sessions'));
      opening++;
      return remoteOperation(parentSignal(signal), (active) => open(id, target, active)).finally(() => {
        opening--;
      });
    },
    list(workspaceId: string, sessionId: string, input: { path: string; cursor?: string }, signal?: AbortSignal) {
      const session = sessions.get(sessionId);
      if (!session || session.info.workspaceId !== workspaceId)
        return Promise.reject(new RemoteFilesError('session_expired'));
      touch(session);
      const previous = session.queue;
      const run = remoteOperation(parentSignal(signal, session), async (active) => {
        await previous;
        active.throwIfAborted();
        return read(session, input, active);
      });
      session.queue = run.catch(() => undefined);
      return run;
    },
    context(workspaceId: string, sessionId: string, signal?: AbortSignal) {
      const session = sessions.get(sessionId);
      if (!session || session.info.workspaceId !== workspaceId)
        return Promise.reject(new RemoteFilesError('session_expired'));
      return remoteOperation(parentSignal(signal, session), async (active) => {
        await validate(session, active);
        touch(session);
        return {
          workspace: { ...session.workspace },
          info: { ...session.info },
          identity: session.identity,
          key: session.key,
          generation: session.generation,
        };
      });
    },
    close(workspaceId: string, sessionId: string) {
      const session = sessions.get(sessionId);
      if (session?.info.workspaceId === workspaceId) close(session);
    },
    closeWorkspace(workspaceId: string) {
      for (const session of sessions.values()) if (session.info.workspaceId === workspaceId) close(session);
    },
    dispose() {
      lifetime.abort(new RemoteFilesError('session_expired'));
      for (const session of sessions.values()) close(session);
    },
  };
}

export type RemoteFilesService = ReturnType<typeof createRemoteFilesService>;
