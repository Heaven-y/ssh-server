import path from 'node:path';
import { expect, it } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import { syncImpact } from '../../src/remote-files/sync-impact';
import type { RemoteActionPlan } from '../../src/remote-files/executor';

const root = path.posix.join(path.posix.sep, 'fixture-project');
const workspace: Workspace = {
  id: 'w1',
  name: 'demo',
  sshHost: 'my-server',
  remoteDir: root,
  localDir: path.resolve('fixture-local'),
};
const source = path.posix.join(path.posix.sep, 'outside', 'tree');
const destination = path.posix.join(root, 'tree');
function plan(entries: NonNullable<RemoteActionPlan['sourceEntries']>): RemoteActionPlan {
  return {
    kind: 'move',
    roots: [root],
    source,
    destination,
    sourceType: 'directory',
    entries: entries.length,
    files: entries.length,
    bytes: 4,
    crossFilesystem: false,
    sourceEntries: entries,
  };
}
const action = { kind: 'move' as const, source, destination };

it('混合目录只统计小文件，排除大文件、权重和链接', () => {
  const result = syncImpact(
    [workspace],
    plan([
      { path: 'code.py', type: 'file', size: 4 },
      { path: 'weights.bin', type: 'file', size: 1024 ** 3 },
      { path: 'weights.pt', type: 'file', size: 4 },
      { path: 'oversized.txt', type: 'file', size: 1024 ** 3 },
      { path: 'link.py', type: 'link', size: 4 },
    ]),
    action,
  );
  expect(result.affected).toMatchObject([{ sourceFiles: 0, destinationFiles: 1 }]);
  expect(result.complete).toBe(true);
});

it('移入目录的大小写分量碰撞在远端操作前拒绝', () => {
  const mixed = plan([
    { path: 'Foo/a.py', type: 'file', size: 2 },
    { path: 'foo/b.py', type: 'file', size: 2 },
  ]);
  expect(() => syncImpact([workspace], mixed, action)).toThrow('大小写');
});

it('移入同步路径拒绝Windows保留名，排除的大文件不受本地名称规则限制', () => {
  expect(() => syncImpact([workspace], plan([{ path: 'CON.py', type: 'file', size: 4 }]), action)).toThrow('文件名');
  expect(
    syncImpact([workspace], plan([{ path: 'large:data.bin', type: 'file', size: 1024 ** 3 }]), action).affected,
  ).toEqual([]);
});
