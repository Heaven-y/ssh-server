import path from 'node:path';
import { once } from 'node:events';
import type { ReadStream, Stats } from 'ssh2';
import { workspaceTarget } from '../ssh/connection';
import type { SshPool } from '../ssh/pool';
import { createSftpReader } from '../ssh/sftp';
import { RemoteFilesError } from './errors';
import { remoteOperation } from './operation';
import { remotePath } from './paths';
import type { RemoteFilesService } from './service';

const sameFile = (a: Stats, b: Stats) =>
  a.isFile() &&
  b.isFile() &&
  !a.isSymbolicLink() &&
  !b.isSymbolicLink() &&
  a.size === b.size &&
  a.mtime === b.mtime &&
  a.mode === b.mode &&
  a.uid === b.uid &&
  a.gid === b.gid;

/** SFTP 流独占通道；Fastify 消费速度提供背压，不写入本地镜像。 */
export function createFileDownloads(deps: {
  pool: Pick<SshPool, 'openSftp'>;
  browse: Pick<RemoteFilesService, 'context'>;
}) {
  return {
    prepare(workspaceId: string, sessionId: string, input: string, signal: AbortSignal) {
      return remoteOperation(signal, async (opening) => {
        const context = await deps.browse.context(workspaceId, sessionId, opening);
        const file = remotePath(input, context.info.root, context.info.home);
        const channel = await deps.pool.openSftp(workspaceTarget(context.workspace));
        const reader = createSftpReader(channel);
        let stream: ReadStream | undefined;
        const close = () => {
          stream?.destroy();
          reader.close();
          opening.removeEventListener('abort', close);
          signal.removeEventListener('abort', close);
        };
        opening.addEventListener('abort', close, { once: true });
        signal.addEventListener('abort', close, { once: true });
        try {
          opening.throwIfAborted();
          if ((await reader.realpath(path.posix.dirname(file))) !== path.posix.dirname(file))
            throw new RemoteFilesError('linked_parent');
          const before = await reader.lstat(file);
          if (!before.isFile() || before.isSymbolicLink()) throw new RemoteFilesError('unsupported_file');
          if (!Number.isSafeInteger(before.size) || before.size < 0) throw new RemoteFilesError('unsupported_file');
          stream = channel.createReadStream(file, { highWaterMark: 65_536, autoClose: true });
          stream.on('error', () => undefined);
          const opened: unknown[] = await once(stream, 'open', { signal: opening });
          const handle = opened[0];
          if (!Buffer.isBuffer(handle)) throw new RemoteFilesError('operation_failed');
          if (!sameFile(before, await reader.fstat(handle)) || !sameFile(before, await reader.lstat(file)))
            throw new RemoteFilesError('stale_preflight');
          await deps.browse.context(workspaceId, sessionId, opening);
          opening.throwIfAborted();
          opening.removeEventListener('abort', close);
          stream.once('close', close);
          reader.signal.addEventListener('abort', close, { once: true });
          return { stream, close, size: before.size, name: path.posix.basename(file) };
        } catch (error) {
          close();
          throw error;
        }
      });
    },
  };
}

export type FileDownloads = ReturnType<typeof createFileDownloads>;
