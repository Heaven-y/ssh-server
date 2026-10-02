import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema, type Workspace } from '@ssh-server/shared';
import { assertGitVersion, git, gitText } from '../../src/vcs/git';
import { createVersionsService } from '../../src/vcs/service';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, rename: vi.fn(original.rename) };
});
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(fs.rename).mockReset();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-vcs-'));
  roots.push(root);
  const localDir = path.join(root, 'repo');
  await fs.mkdir(localDir);
  const ws: Workspace = { id: 'w1', name: 'demo', localDir, sshHost: 'my-server', remoteDir: '~/projects/demo' };
  const versions = createVersionsService();
  await versions.initialize(ws);
  for (const [key, value] of [
    ['user.name', 'Fixture'],
    ['user.email', 'fixture@example.invalid'],
    ['core.autocrlf', 'false'],
    ['commit.gpgsign', 'false'],
  ]) {
    await git(localDir, ['config', '--local', key!, value!]);
  }
  const write = async (file: string, content: string | Buffer) => {
    const target = path.join(localDir, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  };
  const save = async (message = '记录改动', workspace = ws) =>
    versions.save(workspace, { message, revision: (await versions.status(workspace)).revision });
  const commit = async (message = '准备历史') => {
    await git(localDir, ['add', '--all']);
    await git(localDir, ['commit', '--quiet', '-m', message]);
    return gitText(localDir, ['rev-parse', 'HEAD']);
  };
  return { root, ws, versions, write, save, commit };
}

describe('本地 Git 版本服务', () => {
  it('Git 版本检查接受 2.43/3.x，拒绝旧版本与无法解析的输出', () => {
    for (const version of ['git version 2.43.0', 'git version 2.46.0.windows.1', 'git version 3.0.0']) {
      expect(() => assertGitVersion(version)).not.toThrow();
    }
    for (const version of ['git version 2.42.9', 'git version 1.99.0', 'git version 2.43broken', 'unrecognized']) {
      expect(() => assertGitVersion(version)).toThrow('版本记录需要 Git 2.43 或更新版本');
    }
  });

  it('幂等初始化无初始提交，过滤大小/忽略项并记录小型二进制，不创建空提交', async () => {
    const { ws, versions, write, save } = await fixture();
    expect((await versions.initialize(ws)).head).toBeUndefined();
    await write('.gitignore', 'ignored.txt\n');
    await write('ignored.txt', 'ignored');
    await write('small.bin', Buffer.from([0, 1, 2, 255]));
    await write('model.pt', 'excluded');
    await write('large.txt', 'x'.repeat(101));
    ws.sync = SyncSettingsSchema.parse({ maxFileBytes: 100 });
    const status = await versions.status(ws);
    expect(status.changes.map((change) => change.path)).toEqual(['.gitignore', 'small.bin']);
    expect(status.excluded.map((entry) => entry.path).sort()).toEqual(['large.txt', 'model.pt']);
    const workingDiff = await versions.diff(ws, { path: 'small.bin' });
    expect(workingDiff.files).toEqual(['small.bin']);
    expect(workingDiff.text).toContain('Binary files');
    const result = await save('  第一版  ');
    expect(result).toMatchObject({ created: true, commit: { subject: '第一版' } });
    expect(result.commit!.timestamp).toBeGreaterThan(1_000_000_000_000);
    expect((await git(ws.localDir, ['show', 'HEAD:small.bin'])).stdout).toEqual(Buffer.from([0, 1, 2, 255]));
    expect((await save()).created).toBe(false);
    expect((await versions.diff(ws)).files).toEqual([]);
    const history = await versions.history(ws);
    expect(history.commits).toHaveLength(1);
    const diff = await versions.diff(ws, { commit: result.commit!.id, path: 'small.bin' });
    expect(diff.files).toEqual(['small.bin']);
    expect(diff.text).toContain('Binary files');
    await write('.gitignore', 'ignored.txt\n# changed\n');
    expect((await versions.diff(ws, { path: '.gitignore' })).text).toContain('+# changed');
    expect(await fs.readdir(path.join(ws.localDir, '.git'))).not.toEqual(
      expect.arrayContaining([expect.stringContaining('.workspace-vcs-')]),
    );
  });

  it('父仓库内只提交工作区，保留外部及排除文件的暂存修改和删除', async () => {
    const { ws, versions, write, commit, save } = await fixture();
    for (const file of [
      'outside.txt',
      'outside-remove.txt',
      'project/main.py',
      'project/model.pt',
      'project/remove.pt',
    ])
      await write(file, 'base\n');
    await commit();
    await write('outside.txt', 'outside staged\n');
    await fs.unlink(path.join(ws.localDir, 'outside-remove.txt'));
    await write('project/model.pt', 'model staged\n');
    await fs.unlink(path.join(ws.localDir, 'project/remove.pt'));
    await write('project/main.py', 'old staged\n');
    await git(ws.localDir, ['add', '--all']);
    await write('project/main.py', 'latest working\n');
    const child = { ...ws, localDir: path.join(ws.localDir, 'project') };
    const result = await save('仅记录子工作区', child);
    expect(result.status.changes).toEqual([]);
    expect(await gitText(ws.localDir, ['show', 'HEAD:outside.txt'])).toBe('base');
    expect(await gitText(ws.localDir, ['show', 'HEAD:outside-remove.txt'])).toBe('base');
    expect(await gitText(ws.localDir, ['show', 'HEAD:project/model.pt'])).toBe('base');
    expect(await gitText(ws.localDir, ['show', 'HEAD:project/remove.pt'])).toBe('base');
    expect(await gitText(ws.localDir, ['show', 'HEAD:project/main.py'])).toBe('latest working');
    expect(await gitText(ws.localDir, ['show', ':outside.txt'])).toBe('outside staged');
    expect(await gitText(ws.localDir, ['show', ':project/model.pt'])).toBe('model staged');
    const staged = await gitText(ws.localDir, ['diff', '--cached', '--name-status']);
    expect(staged).toContain('D\toutside-remove.txt');
    expect(staged).toContain('D\tproject/remove.pt');
    expect(staged).not.toContain('main.py');
    expect((await versions.history(child)).commits[0]!.subject).toBe('仅记录子工作区');
    const base = await gitText(ws.localDir, ['rev-parse', 'HEAD:outside.txt']);
    const other = await gitText(ws.localDir, ['rev-parse', ':outside.txt']);
    await git(ws.localDir, ['update-index', '-z', '--index-info'], {
      input:
        `0 ${'0'.repeat(40)}\toutside.txt\0` +
        [1, 2, 3].map((stage) => `100644 ${stage === 1 ? base : other} ${stage}\toutside.txt\0`).join(''),
    });
    await write('project/main.py', 'after global conflict\n');
    const conflictedIndex = await fs.readFile(path.join(ws.localDir, '.git', 'index'));
    await expect(save('不能越过全仓冲突', child)).rejects.toMatchObject({ code: 'repository_busy' });
    const preview = await versions.previewRestore(child, { commit: result.commit!.id, path: 'main.py' });
    await expect(
      versions.restore(child, { commit: result.commit!.id, path: 'main.py', revision: preview.revision }),
    ).rejects.toMatchObject({ code: 'repository_busy' });
    expect(await fs.readFile(path.join(ws.localDir, '.git', 'index'))).toEqual(conflictedIndex);
  });

  it('恢复预览标出未跟踪覆盖，拒绝陈旧确认，恢复工作树而不改变 HEAD/索引', async () => {
    const { ws, versions, write, commit } = await fixture();
    await write('main.py', 'old\n');
    await write('revive.txt', 'historical\n');
    const first = await commit();
    await write('main.py', 'new\n');
    await fs.unlink(path.join(ws.localDir, 'revive.txt'));
    await write('added.txt', 'later\n');
    const latest = await commit();
    await write('revive.txt', 'untracked collision\n');
    await write('notes.txt', 'keep untracked\n');
    const preview = await versions.previewRestore(ws, { commit: first });
    expect(preview.changes).toContainEqual({ path: 'revive.txt', kind: 'modified', untrackedOverwrite: true });
    expect(preview.changes).toContainEqual({ path: 'added.txt', kind: 'deleted' });
    await write('main.py', 'external\n');
    await expect(versions.restore(ws, { commit: first, revision: preview.revision })).rejects.toMatchObject({
      code: 'stale_revision',
    });
    const current = await versions.previewRestore(ws, { commit: first });
    const index = await fs.readFile(path.join(ws.localDir, '.git', 'index'));
    const result = await versions.restore(ws, { commit: first, revision: current.revision });
    expect(result.restored.sort()).toEqual(['added.txt', 'main.py', 'revive.txt']);
    expect(await fs.readFile(path.join(ws.localDir, 'main.py'), 'utf8')).toBe('old\n');
    expect(await fs.readFile(path.join(ws.localDir, 'notes.txt'), 'utf8')).toBe('keep untracked\n');
    expect(await fs.readFile(path.join(ws.localDir, '.git', 'index'))).toEqual(index);
    expect(await gitText(ws.localDir, ['rev-parse', 'HEAD'])).toBe(latest);
    const single = await versions.previewRestore(ws, { commit: latest, path: 'main.py' });
    await versions.restore(ws, { commit: latest, path: 'main.py', revision: single.revision });
    expect(await fs.readFile(path.join(ws.localDir, 'main.py'), 'utf8')).toBe('new\n');
    expect(await fs.readFile(path.join(ws.localDir, 'revive.txt'), 'utf8')).toBe('historical\n');
  });

  it('遵守 autocrlf 和目标提交 .gitattributes，提交后没有伪改动', async () => {
    const { ws, versions, write, save } = await fixture();
    await git(ws.localDir, ['config', '--local', 'core.autocrlf', 'true']);
    await write('.gitattributes', '*.forced text eol=lf\n');
    await write('plain.txt', 'first\r\n');
    await write('code.forced', 'first\n');
    const first = await save('第一版行尾');
    expect(first.status.changes).toEqual([]);
    expect(await gitText(ws.localDir, ['status', '--porcelain'])).toBe('');
    await write('.gitattributes', '*.forced text eol=crlf\n');
    await write('plain.txt', 'second\r\n');
    await write('code.forced', 'second\r\n');
    const second = await save('第二版行尾');
    expect(second.status.changes).toEqual([]);
    expect((await save()).created).toBe(false);
    const preview = await versions.previewRestore(ws, { commit: first.commit!.id });
    await versions.restore(ws, { commit: first.commit!.id, revision: preview.revision });
    expect(await fs.readFile(path.join(ws.localDir, 'plain.txt'), 'utf8')).toBe('first\r\n');
    expect(await fs.readFile(path.join(ws.localDir, 'code.forced'), 'utf8')).toBe('first\n');
  });

  it('暂存区变化与并发保存拒绝旧版本，合并状态和缺失身份不写提交', async () => {
    const { ws, versions, write, save } = await fixture();
    await write('main.py', 'base\n');
    await save();
    await write('main.py', 'edited\n');
    const before = await versions.status(ws);
    await git(ws.localDir, ['add', 'main.py']);
    await expect(versions.save(ws, { message: '陈旧请求', revision: before.revision })).rejects.toMatchObject({
      code: 'stale_revision',
    });
    const current = await versions.status(ws);
    const results = await Promise.allSettled([
      versions.save(ws, { message: '并发一', revision: current.revision }),
      versions.save(ws, { message: '并发二', revision: current.revision }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'stale_revision' },
    });
    await write('main.py', 'next\n');
    await git(ws.localDir, ['config', '--local', 'user.email', '']);
    await expect(save()).rejects.toMatchObject({ code: 'identity_missing' });
    await fs.writeFile(path.join(ws.localDir, '.git', 'MERGE_HEAD'), `${current.head}\n`);
    await expect(save()).rejects.toMatchObject({ code: 'repository_busy' });
  });

  it('索引落盘失败时回滚已有或首次提交，保留原索引与文件内容', async () => {
    for (const existing of [false, true]) {
      const { ws, write, commit, save } = await fixture();
      await write('main.py', 'original\n');
      const head = existing ? await commit() : undefined;
      await write('model.pt', 'staged only\n');
      await git(ws.localDir, ['add', 'model.pt']);
      await write('main.py', 'edited\n');
      const indexPath = path.join(ws.localDir, '.git', 'index');
      const index = await fs.readFile(indexPath);
      const originalRename = vi.mocked(fs.rename).getMockImplementation()!;
      vi.mocked(fs.rename).mockImplementation(async (...args) => {
        if (path.basename(String(args[1])) === 'index') throw new Error('受控索引写入失败');
        return originalRename(...args);
      });
      await expect(save()).rejects.toMatchObject({ code: 'git_error' });
      vi.mocked(fs.rename).mockReset();
      const currentHead = await git(ws.localDir, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
      expect(currentHead.exitCode === 0 ? currentHead.stdout.toString().trim() : undefined).toBe(head);
      expect(await fs.readFile(indexPath)).toEqual(index);
      expect(await fs.readFile(path.join(ws.localDir, 'main.py'), 'utf8')).toBe('edited\n');
      expect(await gitText(ws.localDir, ['show', ':model.pt'])).toBe('staged only');
      await expect(fs.stat(`${indexPath}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('linked worktree 复用原生仓库，历史按 30 条分页', async () => {
    const { root, ws, versions, write, commit, save } = await fixture();
    for (let index = 0; index < 32; index++) {
      await write('counter.txt', `${index}\n`);
      await commit(`历史 ${index}`);
    }
    expect(await versions.history(ws)).toMatchObject({ hasMore: true });
    expect((await versions.history(ws)).commits).toHaveLength(30);
    expect(await versions.history(ws, 30)).toMatchObject({ hasMore: false });
    expect((await versions.history(ws, 30)).commits).toHaveLength(2);
    const original = await gitText(ws.localDir, ['rev-parse', 'HEAD']);
    const linkedDir = path.join(root, 'linked');
    await git(ws.localDir, ['worktree', 'add', '--quiet', '--detach', linkedDir, 'HEAD']);
    const linked = { ...ws, id: 'linked', localDir: linkedDir };
    expect((await versions.initialize(linked)).head).toBe(original);
    await fs.writeFile(path.join(linkedDir, 'counter.txt'), 'linked change\n');
    expect((await save('链接工作树改动', linked)).created).toBe(true);
    expect(await gitText(ws.localDir, ['rev-parse', 'HEAD'])).toBe(original);
  });

  it('文件目录替换不能吞掉排除暂存项，完整的小文件替换可以记录', async () => {
    const blocked = await fixture();
    await blocked.write('bundle/model.pt', 'base\n');
    const head = await blocked.commit();
    await blocked.write('bundle/model.pt', 'staged-only\n');
    await git(blocked.ws.localDir, ['add', 'bundle/model.pt']);
    await fs.rm(path.join(blocked.ws.localDir, 'bundle'), { recursive: true });
    await blocked.write('bundle', 'small replacement\n');
    const index = await fs.readFile(path.join(blocked.ws.localDir, '.git', 'index'));
    await expect(blocked.save()).rejects.toMatchObject({ code: 'hierarchy_conflict' });
    expect(await gitText(blocked.ws.localDir, ['rev-parse', 'HEAD'])).toBe(head);
    expect(await gitText(blocked.ws.localDir, ['show', ':bundle/model.pt'])).toBe('staged-only');
    expect(await fs.readFile(path.join(blocked.ws.localDir, '.git', 'index'))).toEqual(index);

    const limited = await fixture();
    await limited.write('large.txt', 'x'.repeat(100));
    await limited.write('staged.txt', 'base');
    const limitedHead = await limited.commit();
    await limited.write('staged.txt', 's'.repeat(100));
    await git(limited.ws.localDir, ['add', 'staged.txt']);
    limited.ws.sync = SyncSettingsSchema.parse({ maxFileBytes: 10 });
    for (const file of ['large.txt', 'staged.txt']) {
      await fs.unlink(path.join(limited.ws.localDir, file));
      await limited.write(`${file}/small.py`, '123');
    }
    const limitedIndex = await fs.readFile(path.join(limited.ws.localDir, '.git', 'index'));
    const limitedStatus = await limited.versions.status(limited.ws);
    expect(limitedStatus.excluded.map((entry) => entry.path).sort()).toEqual(['large.txt', 'staged.txt']);
    await expect(limited.save()).rejects.toMatchObject({ code: 'hierarchy_conflict' });
    expect(await gitText(limited.ws.localDir, ['rev-parse', 'HEAD'])).toBe(limitedHead);
    expect(await fs.readFile(path.join(limited.ws.localDir, '.git', 'index'))).toEqual(limitedIndex);

    const editable = await fixture();
    await editable.write('bundle/sub/child.txt', 'old child\n');
    const first = await editable.commit();
    await fs.rm(path.join(editable.ws.localDir, 'bundle'), { recursive: true });
    await editable.write('bundle', 'now a file\n');
    const fileVersion = await editable.save();
    expect(fileVersion.created).toBe(true);
    expect(await gitText(editable.ws.localDir, ['show', 'HEAD:bundle'])).toBe('now a file');
    const preview = await editable.versions.previewRestore(editable.ws, { commit: first });
    await editable.versions.restore(editable.ws, { commit: first, revision: preview.revision });
    expect(await fs.readFile(path.join(editable.ws.localDir, 'bundle', 'sub', 'child.txt'), 'utf8')).toBe(
      'old child\n',
    );
    expect((await editable.save()).created).toBe(true);
    expect(await gitText(editable.ws.localDir, ['show', 'HEAD:bundle/sub/child.txt'])).toBe('old child');
    await editable.write('.gitignore', '*.tmp\n');
    const previousPlan = await editable.versions.previewRestore(editable.ws, { commit: fileVersion.commit!.id });
    await editable.write('bundle/sub/ignored.tmp', 'must preserve\n');
    const changedPlan = await editable.versions.previewRestore(editable.ws, { commit: fileVersion.commit!.id });
    expect(changedPlan.excluded).toContainEqual(expect.objectContaining({ path: 'bundle' }));
    expect(changedPlan.revision).not.toBe(previousPlan.revision);
    await expect(
      editable.versions.restore(editable.ws, { commit: fileVersion.commit!.id, revision: previousPlan.revision }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    expect(await fs.readFile(path.join(editable.ws.localDir, 'bundle', 'sub', 'child.txt'), 'utf8')).toBe(
      'old child\n',
    );
  });

  it('已有空说明提交保留历史字段，合法 ..foo 子目录仍在作用域内', async () => {
    const { ws, versions, write, commit } = await fixture();
    await write('..foo/main.py', 'first\n');
    const first = await commit('正常说明');
    const tree = await gitText(ws.localDir, ['rev-parse', 'HEAD^{tree}']);
    const empty = await gitText(ws.localDir, ['commit-tree', tree, '-p', first], { input: '' });
    await git(ws.localDir, ['update-ref', 'HEAD', empty, first]);
    const history = await versions.history(ws);
    expect(history.commits).toHaveLength(2);
    expect(history.commits[0]).toMatchObject({ id: empty, subject: '' });
    expect(history.commits.every((entry) => Number.isFinite(entry.timestamp))).toBe(true);
    const child = { ...ws, localDir: path.join(ws.localDir, '..foo') };
    expect((await versions.initialize(child)).head).toBe(empty);
  });

  it('链接/嵌套仓库不记录，恢复系统失败可回滚且不能回滚时报告受影响范围', async () => {
    const { root, ws, versions, write, commit } = await fixture();
    await write('a.txt', 'old a\n');
    await write('b.txt', 'old b\n');
    await write('nested/tracked.txt', 'outer tracked\n');
    const first = await commit();
    await write('a.txt', 'new a\n');
    await write('b.txt', 'new b\n');
    await commit();
    const outside = path.join(root, 'outside.txt');
    await fs.writeFile(outside, 'outside');
    await fs.symlink(outside, path.join(ws.localDir, 'linked.txt'), 'file');
    await git(path.join(ws.localDir, 'nested'), ['init', '--quiet']);
    await write('nested/tracked.txt', 'nested changed\n');
    await git(ws.localDir, ['update-index', '--add', '--cacheinfo', `160000,${'f'.repeat(40)},submodule`]);
    const state = await versions.status(ws);
    expect(state.changes).toEqual([]);
    expect(state.excluded.some((entry) => entry.path === 'linked.txt')).toBe(true);
    expect(state.excluded.some((entry) => entry.path === 'nested/tracked.txt')).toBe(true);
    expect(state.excluded.some((entry) => entry.path === 'submodule')).toBe(true);
    await expect(versions.previewRestore(ws, { commit: 'HEAD;unsafe', path: '../outside.txt' })).rejects.toMatchObject({
      code: 'invalid_commit',
    });
    const preview = await versions.previewRestore(ws, { commit: first });
    const originalRename = vi.mocked(fs.rename).getMockImplementation()!;
    vi.mocked(fs.rename).mockImplementation(async (...args) => {
      if (String(args[1]).endsWith('b.txt')) throw new Error('secret-sentinel');
      return originalRename(...args);
    });
    await expect(versions.restore(ws, { commit: first, revision: preview.revision })).rejects.toMatchObject({
      code: 'git_error',
    });
    expect(await fs.readFile(path.join(ws.localDir, 'a.txt'), 'utf8')).toBe('new a\n');
    vi.mocked(fs.rename).mockReset();
    const next = await versions.previewRestore(ws, { commit: first });
    let calls = 0;
    vi.mocked(fs.rename).mockImplementation(async (...args) => {
      if (++calls > 1) throw new Error('secret-sentinel');
      return originalRename(...args);
    });
    await expect(versions.restore(ws, { commit: first, revision: next.revision })).rejects.toMatchObject({
      code: 'partial_restore',
      affectedPaths: ['a.txt'],
    });
    expect(await fs.readFile(outside, 'utf8')).toBe('outside');
  });
});
