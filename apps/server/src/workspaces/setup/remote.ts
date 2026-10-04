import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { SshAuthMode, Workspace, SetupDirectoryInfo } from '@ssh-server/shared';
import { createRemoteFilesService } from '../../remote-files/service';
import { remotePath } from '../../remote-files/paths';
import { createSftpReader, type SftpReader } from '../../ssh/sftp';
import { workspaceTarget } from '../../ssh/connection';
import type { SshPool } from '../../ssh/pool';
import { executeMetadataCommand } from '../../ssh/metadata-exec';
import { buildRemoteCommand } from '../../ssh/remote-command';
import { WorkspaceSetupError } from './errors';

export type SetupTarget = { sshHost: string; authMode?: SshAuthMode; remoteDir?: string };
type Draft = { workspace: Workspace; session?: string; expiresAt: number };
export function createSetupRemote(pool: SshPool) {
  const drafts = new Map<string, Draft>();
  const browser = createRemoteFilesService({
    store: { get: (id) => Promise.resolve(drafts.get(id)?.workspace) },
    pool,
  });
  const sessions = new Map<string, string>();
  const close = (session: string) => {
    const id = sessions.get(session);
    if (!id) return;
    browser.close(id, session);
    sessions.delete(session);
    drafts.delete(id);
  };
  const timer = setInterval(() => {
    for (const [id, draft] of drafts) {
      if (draft.expiresAt > Date.now()) continue;
      if (draft.session) close(draft.session);
      else drafts.delete(id);
    }
  }, 60000);
  timer.unref();
  const get = (session: string) => {
    const id = sessions.get(session);
    const draft = id ? drafts.get(id) : undefined;
    if (!id || !draft || draft.expiresAt <= Date.now()) {
      close(session);
      throw new WorkspaceSetupError('setup_session_expired', '目录浏览已失效，请重新打开');
    }
    draft.expiresAt = Date.now() + 15 * 60000;
    return { id, draft };
  };
  return {
    async open(target: SetupTarget, signal: AbortSignal) {
      if (drafts.size >= 32) throw new WorkspaceSetupError('setup_session_full', '目录浏览数量已满，请关闭旧浏览');
      const id = randomUUID();
      const workspace: Workspace = {
        id,
        name: '创建前目录浏览',
        localDir: os.homedir(),
        sshHost: target.sshHost,
        authMode: target.authMode ?? 'key',
        remoteDir: target.remoteDir ?? '~',
      };
      const draft: Draft = { workspace, expiresAt: Date.now() + 15 * 60000 };
      drafts.set(id, draft);
      try {
        const { binding } = await browser.binding(id, workspace, signal);
        const session = await browser.open(id, { ...workspace, binding }, signal);
        draft.session = session.id;
        sessions.set(session.id, id);
        signal.throwIfAborted();
        return session;
      } catch (error) {
        if (draft.session) close(draft.session);
        drafts.delete(id);
        throw error;
      }
    },
    list(session: string, input: { path: string; cursor?: string }, signal: AbortSignal) {
      const { id } = get(session);
      return browser.list(id, session, input, signal);
    },
    async size(session: string, directory: string, signal: AbortSignal) {
      const { id, draft } = get(session);
      const context = await browser.context(id, session, signal);
      const root = remotePath(directory, context.info.root, context.info.home);
      await inspectRemoteRoot(pool, { ...draft.workspace, remoteDir: root }, signal);
      const output = await executeMetadataCommand(pool, workspaceTarget(draft.workspace), {
        command: buildRemoteCommand(root, 'du -sk -- .', 20),
        signal,
        timeoutMs: 22000,
        outputCap: 4096,
      });
      await browser.context(id, session, signal);
      const kb = /^([0-9]+)\s+/.exec(output)?.[1];
      const bytes = Number(kb) * 1024;
      if (!kb || !Number.isSafeInteger(bytes))
        throw new WorkspaceSetupError('directory_size_unavailable', '目录大小暂不可用，未完成统计');
      return { path: root, bytes, sampledAt: Date.now() };
    },
    close,
    dispose() {
      clearInterval(timer);
      browser.dispose();
      sessions.clear();
      drafts.clear();
    },
  };
}

async function remoteEmpty(reader: SftpReader, root: string, signal: AbortSignal) {
  const handle = await reader.opendir(root);
  try {
    while (true) {
      signal.throwIfAborted();
      const entries = await reader.readdir(handle);
      if (!entries) return true;
      if (entries.some((entry) => entry.filename !== '.' && entry.filename !== '..')) return false;
    }
  } finally {
    await reader.closeHandle(handle);
  }
}
export async function inspectRemoteRoot(
  pool: SshPool,
  workspace: Workspace,
  signal: AbortSignal,
): Promise<SetupDirectoryInfo> {
  const generation = pool.generation(workspace.sshHost);
  const config = await pool.resolveConnection(workspaceTarget(workspace));
  signal.throwIfAborted();
  const reader = createSftpReader(
    await pool.openSftp(workspaceTarget(workspace), { generation, cacheKey: config.cacheKey, signal }),
  );
  const abort = () => reader.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const home = await reader.realpath('.');
    const input = remotePath(workspace.remoteDir, home, home);
    const stat = await reader.lstat(input);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new WorkspaceSetupError('remote_directory_invalid', '服务器同步根必须是普通目录');
    const root = await reader.realpath(input);
    if (root !== input || !root.startsWith('/'))
      throw new WorkspaceSetupError('remote_directory_invalid', '服务器同步根不能经过符号链接');
    const empty = await remoteEmpty(reader, root, signal);
    const git = await reader.lstat(path.posix.join(root, '.git')).then(
      () => true,
      (error: unknown) => {
        if ((error as { code?: unknown }).code === 2) return false;
        throw error;
      },
    );
    await executeMetadataCommand(pool, workspaceTarget(workspace), {
      command: buildRemoteCommand(root, 'test -d . && test -r . && test -w . && test -x .', 20),
      signal,
      timeoutMs: 22000,
      outputCap: 4096,
    });
    const current = await pool.resolveConnection(workspaceTarget(workspace));
    signal.throwIfAborted();
    if (current.cacheKey !== config.cacheKey || pool.generation(workspace.sshHost) !== generation)
      throw new WorkspaceSetupError('setup_target_changed', '服务器认证或配置已变化，请重新验证');
    return { path: root, empty, git };
  } finally {
    signal.removeEventListener('abort', abort);
    reader.close();
  }
}
