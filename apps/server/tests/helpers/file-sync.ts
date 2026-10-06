import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SyncSettingsSchema, type Workspace } from '@ssh-server/shared';
import { eligibleFile, excludedPath } from '../../src/sync/filters';
import { localInventory } from '../../src/sync/inventory';
import type { RcloneContext, SyncDriver } from '../../src/sync/rclone';

async function replaceTree(directory: string, contents: Map<string, string>) {
  for (const name of await readdir(directory)) await rm(path.join(directory, name), { recursive: true, force: true });
  for (const [file, content] of contents) {
    const destination = path.join(directory, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

/** 受控传输替身操作真实临时镜像，保存每个固定镜像的双向基线及实际上传记录。 */
export function fileSyncFixture() {
  const remote = new Map<string, string>();
  const baselines = new Map<string, Map<string, string>>();
  const uploads: string[] = [];
  const controls = { failPull: false, pull: undefined as ((signal: AbortSignal) => Promise<void>) | undefined };
  const driver: SyncDriver = {
    async open(ws, settings) {
      const root = ws.remoteDir;
      const closed = new AbortController();
      const inventory = (includeLarge = false) =>
        new Map(
          [...remote]
            .filter(
              ([file, content]) =>
                file.startsWith(root + '/') &&
                !excludedPath(file.slice(root.length + 1), settings) &&
                (includeLarge || eligibleFile(file.slice(root.length + 1), Buffer.byteLength(content), settings)),
            )
            .map(([file, content]) => [file.slice(root.length + 1), content]),
        );
      const context: RcloneContext = {
        signature: 'fixture-target-' + ws.id,
        baselineLayout: 'combine-v1',
        close: () => closed.abort(new Error('fixture_closed')),
        listRemote: async (large) =>
          [...inventory(large)].map(([file, content]) => ({
            path: file,
            size: Buffer.byteLength(content),
            modTime: '2026-01-01T00:00:00Z',
          })),
        readRemote: async (file) => {
          closed.signal.throwIfAborted();
          const content = remote.get(path.posix.join(root, file));
          if (content === undefined) throw new Error('fixture_missing');
          return Buffer.from(content);
        },
        restore: async (file) => {
          const destination = path.join(ws.localDir, file);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, remote.get(path.posix.join(root, file))!, { flag: 'wx' });
        },
        moveRemote: async (from, to) => {
          remote.set(path.posix.join(root, to), remote.get(path.posix.join(root, from))!);
          remote.delete(path.posix.join(root, from));
        },
        deleteRemote: async (file) => {
          remote.delete(path.posix.join(root, file));
        },
        pullMirror: async (directory) => {
          if (controls.failPull) throw new Error('fixture_transfer_failed');
          await controls.pull?.(closed.signal);
          closed.signal.throwIfAborted();
          await replaceTree(directory, inventory());
        },
        bisync: async (options) => {
          const directory = options.localDir!;
          const previous = baselines.get(directory) ?? new Map<string, string>();
          const local = new Map<string, string>();
          for (const file of (await localInventory(directory, settings)).included)
            local.set(file.path, await readFile(path.join(directory, file.path), 'utf8'));
          if (!options.remoteAuthoritative) {
            for (const file of new Set([...local.keys(), ...previous.keys()])) {
              const value = local.get(file);
              if (value === previous.get(file)) continue;
              const destination = path.posix.join(root, file);
              if (value === undefined) remote.delete(destination);
              else {
                remote.set(destination, value);
                uploads.push(destination);
              }
            }
          }
          const current = inventory();
          await replaceTree(directory, current);
          baselines.set(directory, new Map(current));
        },
      };
      return context;
    },
  };
  return { driver, remote, uploads, controls };
}

export async function fixtureWorkspace(directory: string, id: string): Promise<Workspace> {
  const localDir = path.join(directory, id);
  await mkdir(localDir, { recursive: true });
  return {
    id,
    name: id,
    sshHost: 'my-server',
    remoteDir: path.posix.join(path.posix.sep, 'fixture', id),
    localDir,
    sync: SyncSettingsSchema.parse({ maxFileBytes: 64 }),
  };
}
