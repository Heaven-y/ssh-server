import type { Workspace } from '@ssh-server/shared';
import { workspaceTarget } from '../ssh/connection';
import type { SshPool, SshChannelGuard } from '../ssh/pool';
import { createSftpReader } from '../ssh/sftp';
import { remotePath } from '../remote-files/paths';
import { TerminalError } from './errors';

export async function resolveTerminalDirectory(options: {
  workspace: Workspace;
  pool: Pick<SshPool, 'openSftp'>;
  guard: SshChannelGuard;
}): Promise<string> {
  const { workspace, pool, guard } = options;
  const reader = createSftpReader(await pool.openSftp(workspaceTarget(workspace), guard));
  const cancel = () => reader.close(new TerminalError('cancelled'));
  guard.signal.addEventListener('abort', cancel, { once: true });
  try {
    guard.signal.throwIfAborted();
    const home = await reader.realpath('.');
    const root = await reader.realpath(remotePath(workspace.remoteDir, home, home));
    if (!home.startsWith('/') || !root.startsWith('/') || /[\r\n\0]/.test(home + root) || root.length > 4096)
      throw new TerminalError('directory_unavailable');
    const stat = await reader.lstat(root);
    if (!stat.isDirectory()) throw new TerminalError('directory_unavailable');
    guard.signal.throwIfAborted();
    return root;
  } catch (error) {
    guard.signal.throwIfAborted();
    throw error instanceof TerminalError ? error : new TerminalError('directory_unavailable');
  } finally {
    guard.signal.removeEventListener('abort', cancel);
    reader.close();
  }
}
